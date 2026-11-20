/**
 * 未读数的语义。
 *
 * 「未读」= 这个会话里在我上次看过之后，**又有新的 AI 回复落库**。
 * 最容易错的是：自己正在聊的会话也被算成未读。
 * 因为已读游标是进页面时推进的，而 AI 回复在流结束时才落库 ——
 * 时间顺序天然导致自己刚说完的话变成"未读 1 条"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HistoryStore } from '../lib/history-store.mjs';

function fresh() {
  const h = new HistoryStore(':memory:');
  h.ensureConversation({ conversationId: 'c1', userId: 'u', contactId: 'default' });
  h.ensureConversation({ conversationId: 'c2', userId: 'u', contactId: 'default' });
  return h;
}

// 注意：下面所有「AI 回复落库」都显式传 viewing: false。
// 新语义下默认 viewing: true 表示用户正看着这个会话，此时**不**计未读。
// 想模拟「回复在用户看不见的时候到达」，就必须显式声明。
const unreadOf = (h, conversationId) =>
  h.listSessions({ userId: 'u' }).find((s) => s.conversationId === conversationId).unread;

test('新会话没有未读', () => {
  const h = fresh();
  try {
    assert.equal(unreadOf(h, 'c1'), 0);
  } finally { h.close(); }
});

test('会话里出现 AI 回复后算未读', () => {
  const h = fresh();
  try {
    h.appendMessage({ conversationId: 'c1', role: 'user', content: 'hi' });
    assert.equal(unreadOf(h, 'c1'), 0, '只有用户消息时不算未读');

    h.appendMessage({ conversationId: 'c1', role: 'assistant', content: 'yo', viewing: false });
    assert.equal(unreadOf(h, 'c1'), 1, 'AI 回复后应为 1');
  } finally { h.close(); }
});

test('标记已读后清零', () => {
  const h = fresh();
  try {
    h.appendMessage({ conversationId: 'c1', role: 'user', content: 'hi' });
    h.appendMessage({ conversationId: 'c1', role: 'assistant', content: 'yo', viewing: false });
    assert.equal(unreadOf(h, 'c1'), 1);

    h.markRead({ conversationId: 'c1' });
    assert.equal(unreadOf(h, 'c1'), 0);
  } finally { h.close(); }
});

test('已读之后又来的回复重新计未读', () => {
  const h = fresh();
  try {
    h.appendMessage({ conversationId: 'c1', role: 'user', content: 'hi' });
    h.appendMessage({ conversationId: 'c1', role: 'assistant', content: 'yo', viewing: false });
    h.markRead({ conversationId: 'c1' });

    h.appendMessage({ conversationId: 'c1', role: 'user', content: '再问' });
    h.appendMessage({ conversationId: 'c1', role: 'assistant', content: '再答', viewing: false });
    assert.equal(unreadOf(h, 'c1'), 1, '应只算新增的那条');
  } finally { h.close(); }
});

test('未读只统计已完成的消息', () => {
  const h = fresh();
  try {
    const id = h.createMessage({ conversationId: 'c1', role: 'assistant', content: '' });
    assert.equal(unreadOf(h, 'c1'), 0, '流式中的消息尚未完成，不算未读');

    h.finalizeMessage({ id, content: '答完了', status: 'completed', viewing: false });
    assert.equal(unreadOf(h, 'c1'), 1, '完成后才算');
  } finally { h.close(); }
});

test('各会话的未读互不影响', () => {
  const h = fresh();
  try {
    h.appendMessage({ conversationId: 'c1', role: 'assistant', content: 'a', viewing: false });
    h.appendMessage({ conversationId: 'c2', role: 'assistant', content: 'b', viewing: false });
    h.markRead({ conversationId: 'c1' });

    assert.equal(unreadOf(h, 'c1'), 0, 'c1 读过了');
    assert.equal(unreadOf(h, 'c2'), 1, 'c2 没读过');
  } finally { h.close(); }
});

test('markRead 幂等，重复调用不报错', () => {
  const h = fresh();
  try {
    h.appendMessage({ conversationId: 'c1', role: 'assistant', content: 'a', viewing: false });
    h.markRead({ conversationId: 'c1' });
    h.markRead({ conversationId: 'c1' });
    assert.equal(unreadOf(h, 'c1'), 0);
  } finally { h.close(); }
});

test('markRead 不会把之后的消息误判为已读', () => {
  const h = fresh();
  try {
    h.appendMessage({ conversationId: 'c1', role: 'assistant', content: '旧的', viewing: false });
    h.markRead({ conversationId: 'c1' });

    // 新消息的时间戳一定晚于游标
    h.appendMessage({ conversationId: 'c1', role: 'assistant', content: '新的', viewing: false });
    assert.equal(unreadOf(h, 'c1'), 1, '游标只推进到标记那一刻，不能吃掉后来的消息');
  } finally { h.close(); }
});

test('别人的会话不出现在我的列表里', () => {
  const h = fresh();
  try {
    h.ensureConversation({ conversationId: 'other', userId: 'v', contactId: 'default' });
    h.appendMessage({ conversationId: 'other', role: 'assistant', content: '别人的', viewing: false });
    const mine = h.listSessions({ userId: 'u' }).map((s) => s.conversationId);
    assert.ok(!mine.includes('other'));
  } finally { h.close(); }
});

test('老库补 last_read_rowid：已读状态不倒退', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  const dir = mkdtempSync(join(tmpdir(), 'dsh-unread-'));
  const file = join(dir, 'old.db');
  try {
    // 造一个「只有 last_read_at、没有 last_read_rowid」的老库
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE conversations (
        conversation_id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        contact_id TEXT NOT NULL DEFAULT 'default',
        created_at INTEGER NOT NULL,
        last_read_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
        role TEXT NOT NULL, content TEXT NOT NULL,
        created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'completed',
        thinking TEXT NOT NULL DEFAULT '', thinking_ms INTEGER NOT NULL DEFAULT 0
      );
    `);
    const t = Date.now() - 10000;
    old.prepare('INSERT INTO conversations VALUES (?,?,?,?,?)')
      .run('c1', 'u', 'default', t, t + 2000); // 已读到第二条
    const ins = old.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?,?,?,?,?)',
    );
    ins.run('m1', 'c1', 'assistant', '第一条', t + 1000);
    ins.run('m2', 'c1', 'assistant', '第二条', t + 2000); // 已读
    ins.run('m3', 'c1', 'assistant', '第三条', t + 3000); // 未读
    old.close();

    // 用新版本打开：应自动迁移
    const h = new HistoryStore(file);
    try {
      const cols = h.db.prepare('PRAGMA table_info(conversations)').all().map((c) => c.name);
      assert.ok(cols.includes('last_read_rowid'), '应补出 last_read_rowid 列');

      assert.equal(unreadOf(h, 'c1'), 1,
        '迁移后应保留已读状态：只有第三条是未读');
    } finally { h.close(); }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── unread_count 冗余字段的语义 ─────────────────

test('用户正在看时，AI 回复不计未读', () => {
  const h = fresh();
  try {
    // 默认 viewing: true —— 同步对话里用户就盯着这个会话
    h.appendMessage({ conversationId: 'c1', role: 'assistant', content: '看到我了吗' });
    assert.equal(unreadOf(h, 'c1'), 0, '正在看的时候不该亮红点');
  } finally { h.close(); }
});

test('用户不在时，AI 回复逐条累加', () => {
  const h = fresh();
  try {
    for (let i = 0; i < 3; i++) {
      h.appendMessage({
        conversationId: 'c1', role: 'assistant', content: `第${i}条`, viewing: false,
      });
    }
    assert.equal(unreadOf(h, 'c1'), 3);
  } finally { h.close(); }
});

test('失败/中断的回复不计未读', () => {
  const h = fresh();
  try {
    h.appendMessage({
      conversationId: 'c1', role: 'assistant', content: '半截',
      status: 'interrupted', viewing: false,
    });
    assert.equal(unreadOf(h, 'c1'), 0, '没说完的不该提醒');
  } finally { h.close(); }
});

test('用户消息不计未读', () => {
  const h = fresh();
  try {
    h.appendMessage({ conversationId: 'c1', role: 'user', content: '我说的', viewing: false });
    assert.equal(unreadOf(h, 'c1'), 0, '只有 AI 的回复才值得提醒');
  } finally { h.close(); }
});

test('进入会话清零，之后新回复重新累加', () => {
  const h = fresh();
  try {
    h.appendMessage({ conversationId: 'c1', role: 'assistant', content: 'a', viewing: false });
    h.appendMessage({ conversationId: 'c1', role: 'assistant', content: 'b', viewing: false });
    assert.equal(unreadOf(h, 'c1'), 2);

    h.markRead({ conversationId: 'c1' });
    assert.equal(unreadOf(h, 'c1'), 0);

    h.appendMessage({ conversationId: 'c1', role: 'assistant', content: 'c', viewing: false });
    assert.equal(unreadOf(h, 'c1'), 1);
  } finally { h.close(); }
});

test('unread_count 与按游标现算的真实值保持一致', () => {
  const h = fresh();
  try {
    for (let i = 0; i < 4; i++) {
      h.appendMessage({
        conversationId: 'c1', role: 'assistant', content: `x${i}`, viewing: false,
      });
    }
    const s = h.listSessions({ userId: 'u' }).find((x) => x.conversationId === 'c1');
    assert.equal(s.unread, 4, '冗余计数');
    assert.equal(s.unreadActual, 4, '真实值');
    assert.equal(s.unread, s.unreadActual, '两者必须一致，否则说明计数漂移');
  } finally { h.close(); }
});

test('markRead 会把漂移的计数校正回来', () => {
  const h = fresh();
  try {
    h.appendMessage({ conversationId: 'c1', role: 'assistant', content: 'a', viewing: false });
    // 人为制造漂移（模拟重复 finalize 之类的异常路径）
    h.stmtBumpUnread.run(9, 'c1');
    assert.equal(unreadOf(h, 'c1'), 10, '漂移已注入');

    h.markRead({ conversationId: 'c1' });
    const s = h.listSessions({ userId: 'u' }).find((x) => x.conversationId === 'c1');
    assert.equal(s.unread, 0, '标记已读应校正为 0');
    assert.equal(s.unread, s.unreadActual, '校正后必须与真实值一致');
  } finally { h.close(); }
});

test('resetUnread 直接清零（不依赖游标）', () => {
  const h = fresh();
  try {
    h.appendMessage({ conversationId: 'c1', role: 'assistant', content: 'a', viewing: false });
    assert.equal(unreadOf(h, 'c1'), 1);
    h.resetUnread({ conversationId: 'c1' });
    assert.equal(unreadOf(h, 'c1'), 0);
  } finally { h.close(); }
});

test('老库补 unread_count：按游标回填，红点不丢', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  const dir = mkdtempSync(join(tmpdir(), 'dsh-unread2-'));
  const file = join(dir, 'old.db');
  try {
    // 老库：有 last_read_rowid，但没有 unread_count
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE conversations (
        conversation_id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        contact_id TEXT NOT NULL DEFAULT 'default',
        created_at INTEGER NOT NULL,
        last_read_at INTEGER NOT NULL DEFAULT 0,
        last_read_rowid INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
        role TEXT NOT NULL, content TEXT NOT NULL,
        created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'completed',
        thinking TEXT NOT NULL DEFAULT '', thinking_ms INTEGER NOT NULL DEFAULT 0
      );
    `);
    const t = Date.now() - 10000;
    old.prepare('INSERT INTO conversations VALUES (?,?,?,?,?,?)')
      .run('c1', 'u', 'default', t, t + 1000, 2); // 已读到 rowid 2
    const ins = old.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, created_at, status)
       VALUES (?,?,?,?,?,?)`,
    );
    ins.run('m1', 'c1', 'assistant', '已读一', t + 100, 'completed');  // rowid 1
    ins.run('m2', 'c1', 'assistant', '已读二', t + 200, 'completed');  // rowid 2
    ins.run('m3', 'c1', 'assistant', '未读一', t + 300, 'completed');  // rowid 3
    ins.run('m4', 'c1', 'assistant', '未读二', t + 400, 'completed');  // rowid 4
    old.close();

    const h = new HistoryStore(file);
    try {
      const cols = h.db.prepare('PRAGMA table_info(conversations)').all().map((c) => c.name);
      assert.ok(cols.includes('unread_count'), '应补出 unread_count 列');
      assert.equal(unreadOf(h, 'c1'), 2, '回填应等于游标之后的真实未读数，而不是 0');
    } finally { h.close(); }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── presence 与 /chat 的联动 ─────────────────────
// 这层最容易出错：计数在「流结束落库」时决定，
// 而用户是否在看，必须查那一刻的状态，不是请求开始时的。

test('presence：上报后立刻生效，可清除，可过期', async () => {
  const { createPresence } = await import('../lib/presence.mjs');
  let t = 1000;
  const p = createPresence({ ttlMs: 100, now: () => t });

  assert.equal(p.current('u'), null, '初始没有记录');
  p.report('u', 'c1');
  assert.equal(p.current('u'), 'c1');
  assert.equal(p.isViewing('u', 'c1'), true);
  assert.equal(p.isViewing('u', 'c2'), false);

  p.report('u', null);           // 离开所有会话
  assert.equal(p.current('u'), null);

  p.report('u', 'c1');
  t += 200;                      // 超时
  assert.equal(p.current('u'), null, '过期后视为不在任何会话');
});
