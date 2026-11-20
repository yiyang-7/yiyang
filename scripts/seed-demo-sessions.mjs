#!/usr/bin/env node
/**
 * 生成演示用会话数据（首页列表的「假数据」现在放在数据库里，而不是前端）。
 *
 * 为什么需要它：真实对话要么被模型额度挡住（402 QUOTA），
 * 要么只有用户消息、没有 assistant 回复，首页就看不到「最后一条消息 + 未读数」。
 * 这个脚本直接往库里写几条完整会话，让列表页有内容可看。
 *
 * 用法：
 *   node scripts/seed-demo-sessions.mjs                 # 给默认用户 u-web-demo 生成
 *   node scripts/seed-demo-sessions.mjs --user u-abc    # 指定用户
 *   node scripts/seed-demo-sessions.mjs --list          # 只打印现有会话，不写入
 *
 * 幂等：会话 id 固定为 demo-<contact>，重复运行会先清掉再重建，
 * 所以不会越跑越多。真实会话（非 demo- 前缀）完全不受影响。
 */

import { fileURLToPath } from 'node:url';
import { HistoryStore } from '../lib/history-store.mjs';
import { ContactsStore } from '../lib/contacts-store.mjs';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

// 注意：不能用 new URL(...).pathname —— 它保留百分号编码，
// 中文目录名会变成字面量 "%E6%A3%AE%E8%90%9D"，数据写进一个不存在的怪目录。
const DB =
  process.env.DSH_CHAT_DB ?? fileURLToPath(new URL('../history.db', import.meta.url));
const userId = argOf('user', 'u-web-demo');

const history = new HistoryStore(DB);
const contacts = new ContactsStore(DB);

if (args.includes('--list')) {
  const rows = history.listSessions({ limit: 100 });
  console.log(`共 ${rows.length} 条会话：`);
  for (const r of rows) {
    console.log(
      `  ${r.conversationId.padEnd(24)} user=${r.userId.padEnd(12)} ` +
        `contact=${r.contactId.padEnd(8)} unread=${r.unread} last=${JSON.stringify(r.lastMessage.slice(0, 24))}`,
    );
  }
  history.close();
  contacts.close();
  process.exit(0);
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const now = Date.now();

/** 每个会话的对话脚本：[role, 内容, 距今多少毫秒] */
const DEMO = [
  {
    contactId: 'catgirl',
    messages: [
      ['user', '帮我查一下明天杭州的天气喵', 3 * HOUR],
      ['assistant', '哼，才不是特意帮你查的呢…明天杭州多云转晴，18~26℃，记得带件外套。', 3 * HOUR - 20_000],
      ['user', '那要带伞吗', 2 * MIN],
      ['assistant', '不用啦，降水概率很低的。…别、别以为我是在关心你哦喵！', 1 * MIN],
    ],
  },
  {
    contactId: 'butler',
    messages: [
      ['user', '今天有什么安排', 5 * HOUR],
      ['assistant', '先生，您今日的行程已备好：上午审阅季度报表，下午三点与合作方会面。', 5 * HOUR - 30_000],
      ['user', '三点的会改到四点吧', 40 * MIN],
      ['assistant', '已为您调整，先生。三点的时间我另作了安排，稍后发送给您确认。', 38 * MIN],
    ],
  },
  {
    contactId: 'default',
    messages: [
      ['user', '帮我总结一下这份季度报告', 26 * HOUR],
      ['assistant', '我已经把这份文档整理成三个要点：营收增长、成本结构优化、下季度风险。需要我展开哪一部分？', 26 * HOUR - 60_000],
    ],
  },
];

let written = 0;
for (const demo of DEMO) {
  const conversationId = `demo-${demo.contactId}`;

  // 先清掉旧的演示会话，保证幂等
  history.deleteConversation({ conversationId });
  history.ensureConversation({ conversationId, userId, contactId: demo.contactId });

  for (const [role, content, ago] of demo.messages) {
    history.appendMessage({
      conversationId,
      role,
      content,
      status: 'completed',
      createdAt: now - ago,
    });
    written += 1;
  }

  // 让未读数和「最后几条 assistant 消息」对得上：
  // catgirl 留 2 条未读，butler 全已读，default 留 1 条未读
  const unreadPlan = { catgirl: 1, butler: 0, default: 0 };
  const keep = unreadPlan[demo.contactId] ?? 0;
  if (keep === 0) {
    history.markRead({ conversationId });
  }
}

const contactName = (id) => contacts.get(id)?.name ?? id;
console.log(`已为用户 ${userId} 写入 ${DEMO.length} 条演示会话（共 ${written} 条消息）：`);
for (const d of DEMO) {
  console.log(`  demo-${d.contactId.padEnd(9)} ${contactName(d.contactId)}`);
}
console.log('\n注意：这些是 demo-* 前缀的会话，和真实会话互不影响。');

history.close();
contacts.close();