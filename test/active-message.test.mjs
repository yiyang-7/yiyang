/**
 * 主动消息（Active Message）测试。
 *
 * 这条路径没有 HTTP 请求做背书，出错时表现为「要么静默不发，
 * 要么发出去但记录不对」，很难在界面上发现。所以边界要测。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runActiveTurn } from '../lib/active-message.mjs';
import { createScheduler, DEFAULT_PROMPT, jobsFromEnv } from '../lib/active-scheduler.mjs';
import { HistoryStore } from '../lib/history-store.mjs';
import { ContactsStore } from '../lib/contacts-store.mjs';

/** 假 agent：吐指定文本后结束，或按指定方式失败。 */
function makeAgent({ text = '早上好呀～', fail = null, empty = false, thinking = null } = {}) {
  const listeners = new Set();
  return {
    meta: { sessionsRoot: '/tmp/fake' },
    prompts: [],
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async prompt(t) {
      this.prompts.push(t);
      const emit = (e) => { for (const fn of listeners) fn('session.event', { event: e }); };
      if (thinking) {
        emit({ type: 'assistant/thinking', data: {} });
        emit({
          type: 'assistant/message',
          data: { message: { content: [{ type: 'thinking', text: thinking }] } },
        });
      }
      if (fail) {
        emit({ type: 'turn/end', data: { reason: { kind: 'error', error: { message: fail, code: 'X' } } } });
        return { messageId: 'm' };
      }
      if (!empty) {
        emit({
          type: 'assistant/message',
          data: { message: { content: [{ type: 'text', text }] } },
        });
      }
      emit({ type: 'turn/end', data: { reason: { kind: 'stop' } } });
      return { messageId: 'm' };
    },
  };
}

function fresh({ contactId = 'catgirl', withConversation = true } = {}) {
  const history = new HistoryStore(':memory:');
  const contacts = new ContactsStore(':memory:');
  if (withConversation) {
    history.ensureConversation({ conversationId: 'c1', userId: 'u1', contactId });
  }
  return { history, contacts };
}

const getProcessReturning = (agent, log = {}) => async (convId, opts) => {
  log.calls = log.calls ?? [];
  log.calls.push({ convId, opts });
  return { agent, isNew: log.isNew ?? true };
};

// ── runActiveTurn ────────────────────────────────

test('主动消息：拿回复、落库、标记未读', async () => {
  const { history, contacts } = fresh();
  try {
    const agent = makeAgent({ text: '早安，主人～' });
    const res = await runActiveTurn({
      conversationId: 'c1',
      prompt: '主动问候',
      history,
      contacts,
      getProcess: getProcessReturning(agent),
    });

    assert.equal(res.text, '早安，主人～');

    const msgs = history.tail({ conversationId: 'c1', limit: 10 });
    assert.equal(msgs.length, 1, '应写入一条 assistant 消息');
    assert.equal(msgs[0].role, 'assistant');
    assert.equal(msgs[0].content, '早安，主人～');

    const s = history.listSessions({ userId: 'u1' })[0];
    assert.equal(s.unread, 1, '主动消息必须点亮红点');
    assert.equal(s.unread, s.unreadActual);
  } finally { history.close(); }
});

test('主动消息：会话不存在时拒绝，不凭空造会话', async () => {
  const { history, contacts } = fresh({ withConversation: false });
  try {
    await assert.rejects(
      () => runActiveTurn({
        conversationId: 'nope', prompt: '早安', history, contacts,
        getProcess: getProcessReturning(makeAgent()),
      }),
      (e) => e.code === 'NO_CONVERSATION',
    );
    assert.equal(history.listConversations(10).length, 0, '不该创建新会话');
  } finally { history.close(); }
});

test('主动消息：空回复不落库', async () => {
  const { history, contacts } = fresh();
  try {
    await assert.rejects(
      () => runActiveTurn({
        conversationId: 'c1', prompt: '早安', history, contacts,
        getProcess: getProcessReturning(makeAgent({ empty: true })),
      }),
      (e) => e.code === 'EMPTY_REPLY',
    );
    assert.equal(history.tail({ conversationId: 'c1', limit: 10 }).length, 0);
  } finally { history.close(); }
});

test('主动消息：模型报错时抛错且不落库', async () => {
  const { history, contacts } = fresh();
  try {
    await assert.rejects(
      () => runActiveTurn({
        conversationId: 'c1', prompt: '早安', history, contacts,
        getProcess: getProcessReturning(makeAgent({ fail: '额度不足' })),
      }),
      /额度不足/,
    );
    assert.equal(history.tail({ conversationId: 'c1', limit: 10 }).length, 0);
  } finally { history.close(); }
});

test('主动消息：人设来自联系人表，且随会话绑定', async () => {
  const { history, contacts } = fresh({ contactId: 'coder' });
  try {
    const log = {};
    await runActiveTurn({
      conversationId: 'c1', prompt: '早安', history, contacts,
      getProcess: getProcessReturning(makeAgent(), log),
    });
    const call = log.calls[0];
    assert.equal(call.opts.contact?.id, 'coder');
    assert.ok(call.opts.persona.prefix.includes('后端工程师'), '应注入 coder 的人设');
  } finally { history.close(); }
});

test('主动消息：空人设不覆盖（default 联系人）', async () => {
  const { history, contacts } = fresh({ contactId: 'default' });
  try {
    const log = {};
    await runActiveTurn({
      conversationId: 'c1', prompt: '早安', history, contacts,
      getProcess: getProcessReturning(makeAgent(), log),
    });
    assert.equal(log.calls[0].opts.persona.prefix, null, '空 prompt 应为 null 而非空串');
  } finally { history.close(); }
});

test('主动消息：冷启动回灌历史，复用进程不回灌', async () => {
  const { history, contacts } = fresh();
  try {
    history.appendMessage({ conversationId: 'c1', role: 'user', content: '我昨天说想去爬山' });

    // 新进程 → 应回灌
    const freshAgent = makeAgent();
    await runActiveTurn({
      conversationId: 'c1', prompt: '早安', history, contacts,
      getProcess: getProcessReturning(freshAgent, { isNew: true }),
    });
    assert.ok(
      freshAgent.prompts[0].includes('我昨天说想去爬山'),
      '冷启动应把历史带进 prompt',
    );

    // 老进程 → 不该回灌（Harness 内部已有这些轮次）
    const warmAgent = makeAgent();
    await runActiveTurn({
      conversationId: 'c1', prompt: '早安', history, contacts,
      getProcess: getProcessReturning(warmAgent, { isNew: false }),
    });
    assert.equal(
      warmAgent.prompts[0], '早安',
      '复用进程时 prompt 应保持原样，不能重复喂历史',
    );
  } finally { history.close(); }
});

test('主动消息：和用户请求共用轮次锁，不会并发进同一进程', async () => {
  const { history, contacts } = fresh();
  try {
    // 从 chat-route 拿同一把锁
    const { acquireTurn } = await import('../lib/chat-route.mjs');

    const order = [];
    const agent = makeAgent();
    const orig = agent.prompt.bind(agent);
    agent.prompt = async (t) => { order.push(`start:${t}`); const r = await orig(t); order.push(`end:${t}`); return r; };

    // 先占住锁，模拟用户的请求正在进行
    const release = await acquireTurn('c1');
    const active = runActiveTurn({
      conversationId: 'c1', prompt: '主动问候', history, contacts,
      getProcess: getProcessReturning(agent),
    });

    // 主动消息在等锁时不该动 prompt
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(order, [], '用户请求未结束前，主动消息不该发出 prompt');

    release();
    await active;
    assert.deepEqual(order, ['start:主动问候', 'end:主动问候']);
  } finally { history.close(); }
});

test('主动消息：超时会放弃轮次并释放锁', async () => {
  const { history, contacts } = fresh();
  try {
    const listeners = new Set();
    const agent = {
      meta: {},
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      async prompt() { /* 永不结束 */ },
    };

    await assert.rejects(
      () => runActiveTurn({
        conversationId: 'c1', prompt: '早安', history, contacts,
        getProcess: getProcessReturning(agent),
        timeoutMs: 50,
      }),
      (e) => e.code === 'TIMEOUT',
    );

    // 锁必须释放，否则这个会话永久卡死
    const { acquireTurn } = await import('../lib/chat-route.mjs');
    const release = await Promise.race([
      acquireTurn('c1'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('锁没释放')), 500)),
    ]);
    release();
  } finally { history.close(); }
});

// ── 调度器 ────────────────────────────────────────

const quiet = () => {};

test('调度器：非法 cron 被跳过，不注册任务', () => {
  const { history, contacts } = fresh();
  try {
    const s = createScheduler({
      history, contacts, getProcess: async () => ({ agent: makeAgent(), isNew: true }),
      enabled: true, log: quiet,
      jobs: [{ conversationId: 'c1', cron: '这不是 cron' }],
    });
    assert.equal(s.snapshot().length, 0);
    s.stop();
  } finally { history.close(); }
});

test('调度器：缺少 conversationId 的任务被跳过', () => {
  const { history, contacts } = fresh();
  try {
    const s = createScheduler({
      history, contacts, getProcess: async () => ({ agent: makeAgent(), isNew: true }),
      enabled: true, log: quiet,
      jobs: [{ cron: '0 9 * * *' }],
    });
    assert.equal(s.snapshot().length, 0);
    s.stop();
  } finally { history.close(); }
});

test('调度器：enabled=false 时不注册任何任务', () => {
  const { history, contacts } = fresh();
  try {
    const s = createScheduler({
      history, contacts, getProcess: async () => ({ agent: makeAgent(), isNew: true }),
      enabled: false, log: quiet,
      jobs: [{ conversationId: 'c1', cron: '0 9 * * *' }],
    });
    assert.equal(s.snapshot().length, 0);
    s.stop();
  } finally { history.close(); }
});

test('调度器：手动触发产生一条未读消息', async () => {
  const { history, contacts } = fresh();
  try {
    const s = createScheduler({
      history, contacts,
      getProcess: async () => ({ agent: makeAgent({ text: '早！' }), isNew: true }),
      enabled: true, log: quiet,
      jobs: [{ id: 'j1', conversationId: 'c1', cron: '0 9 * * *' }],
    });

    const res = await s.trigger('j1');
    assert.equal(res.text, '早！');

    const snap = s.snapshot();
    assert.equal(snap[0].lastRun.ok, true, '应记录成功');

    const s2 = history.listSessions({ userId: 'u1' })[0];
    assert.equal(s2.unread, 1);
    s.stop();
  } finally { history.close(); }
});

test('调度器：未知任务 id 抛错', async () => {
  const { history, contacts } = fresh();
  try {
    const s = createScheduler({
      history, contacts, getProcess: async () => ({ agent: makeAgent(), isNew: true }),
      enabled: true, log: quiet, jobs: [],
    });
    await assert.rejects(() => s.trigger('不存在'), /没有这个任务/);
    s.stop();
  } finally { history.close(); }
});

test('调度器：任务失败不抛到 cron 外面，只记日志', async () => {
  const { history, contacts } = fresh();
  try {
    const logs = [];
    const s = createScheduler({
      history, contacts,
      getProcess: async () => ({ agent: makeAgent({ fail: '炸了' }), isNew: true }),
      enabled: true, log: (m) => logs.push(m),
      jobs: [{ id: 'j1', conversationId: 'c1', cron: '0 9 * * *' }],
    });

    const res = await s.trigger('j1');
    assert.equal(res.error, '炸了', '失败结果应被返回而不是抛出');
    assert.ok(logs.some((m) => m.includes('失败')), '应记日志');

    const snap = s.snapshot();
    assert.equal(snap[0].lastRun.ok, false);
    s.stop();
  } finally { history.close(); }
});

test('调度器：上一轮未结束时跳过本次（不堆积）', async () => {
  const { history, contacts } = fresh();
  try {
    let release;
    const gate = new Promise((r) => { release = r; });
    const listeners = new Set();
    const slowAgent = {
      meta: {},
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      async prompt() {
        await gate;
        const emit = (e) => { for (const fn of listeners) fn('session.event', { event: e }); };
        emit({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '久等了' }] } } });
        emit({ type: 'turn/end', data: { reason: { kind: 'stop' } } });
        return { messageId: 'm' };
      },
    };

    const s = createScheduler({
      history, contacts,
      getProcess: async () => ({ agent: slowAgent, isNew: true }),
      enabled: true, log: quiet,
      jobs: [{ id: 'j1', conversationId: 'c1', cron: '0 9 * * *' }],
    });

    const first = s.trigger('j1');
    await new Promise((r) => setTimeout(r, 20));

    const second = await s.trigger('j1');
    assert.equal(second.skipped, true, '上一轮还在跑时应跳过');
    assert.equal(second.reason, 'BUSY');

    release();
    await first;

    const one = history.tail({ conversationId: 'c1', limit: 10 });
    assert.equal(one.length, 1, '只应写入一条，没有堆积');
    s.stop();
  } finally { history.close(); }
});

test('调度器：默认 prompt 要求不发散', () => {
  assert.ok(DEFAULT_PROMPT.includes('早安'));
  assert.ok(DEFAULT_PROMPT.includes('一两句话'), '应限制长度，否则模型会写一篇散文');
});

// ── 环境变量配置 ──────────────────────────────────

test('jobsFromEnv：没配置时不产生任何任务', () => {
  assert.deepEqual(jobsFromEnv({}), [], '默认必须为空，不能自动对准所有会话');
});

test('jobsFromEnv：逗号分隔的会话列表', () => {
  const jobs = jobsFromEnv({
    DSH_ACTIVE_CONVERSATIONS: 'c1, c2 , ,c3',
    DSH_ACTIVE_CRON: '30 8 * * *',
  });
  assert.deepEqual(jobs.map((j) => j.conversationId), ['c1', 'c2', 'c3']);
  assert.ok(jobs.every((j) => j.cron === '30 8 * * *'));
});

test('jobsFromEnv：默认每天 9 点', () => {
  const jobs = jobsFromEnv({ DSH_ACTIVE_CONVERSATIONS: 'c1' });
  assert.equal(jobs[0].cron, '0 9 * * *');
});

test('jobsFromEnv：自定义 prompt', () => {
  const jobs = jobsFromEnv({
    DSH_ACTIVE_CONVERSATIONS: 'c1',
    DSH_ACTIVE_PROMPT: '提醒他喝水',
  });
  assert.equal(jobs[0].prompt, '提醒他喝水');
});