/**
 * 历史记录存储（服务端拥有）
 *
 * 用 Node 24 内置的 node:sqlite，零依赖。
 *
 * 两张表：
 *   conversations  会话 ID、AI 联系人 ID、创建时间（+ 归属用户）
 *   messages       消息 ID、所属会话 ID、角色、内容、时间
 *
 * 关于 conversations.user_id：需求里的三个字段没提它，但必须有。
 * 用户归属如果只挂在 messages 上，改成两表结构后就没地方存了；
 * 而只靠 conversationId 定位会话，意味着猜到别人的 ID 就能读别人的历史。
 * 所以归属放 conversations，并在读取时做所有权校验。
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT    PRIMARY KEY,
  user_id         TEXT    NOT NULL,
  contact_id      TEXT    NOT NULL DEFAULT 'default',
  created_at      INTEGER NOT NULL,
  -- 已读游标：这个时间点之前的 assistant 消息算已读。
  -- 保留它是为了兼容老库，新逻辑改用 last_read_rowid。
  last_read_at    INTEGER NOT NULL DEFAULT 0,
  -- 已读游标（权威）：读过的那条消息的 rowid。
  -- 为什么不用时间戳：同一毫秒内落库的两条消息 created_at 完全相同，
  -- 游标推到 T 之后新消息也是 T，'created_at > 游标' 判定不成立，
  -- 那条回复就永远不算未读。rowid 严格单调，不受时钟精度影响。
  last_read_rowid INTEGER NOT NULL DEFAULT 0,
  -- 未读计数：AI 回复落库时，若用户不在这个会话就 +1；进入会话时清零。
  --
  -- 为什么要有这个冗余字段，而不是继续用 COUNT(*) 现算：
  --   1. 现算要求「用户此刻在看哪」这个信息在读取时可得，但它只在写入时可得；
  --   2. 计数是个会变化的业务状态（已读后清零），不是一个可推导的纯函数
  --      —— 同一个游标下，「刚产生 3 条」和「看完清零」在数据上完全一样。
  -- 冗余字段有代价：可能与真实消息数不一致。所以 markRead 时按实际游标
  -- 重算并覆盖，而不是简单置 0，避免长期漂移。
  unread_count    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT    NOT NULL PRIMARY KEY,
  conversation_id TEXT    NOT NULL
                  REFERENCES conversations (conversation_id) ON DELETE CASCADE,
  role            TEXT    NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT    NOT NULL,
  -- streaming  正在生成（占位，内容为空）
  -- completed  正常完成，可参与历史回灌
  -- failed     轮次失败但已有部分文本
  -- interrupted 服务端在生成中途退出（启动时由 markInterrupted 标记）
  status          TEXT    NOT NULL DEFAULT 'completed'
                  CHECK (status IN ('streaming','completed','failed','interrupted')),
  -- 深度思考正文（reasoning_content）。空串表示这条消息没有思考过。
  -- 历史回显时前端靠它恢复折叠面板，所以要跟正文一起落库。
  thinking        TEXT    NOT NULL DEFAULT '',
  -- 思考耗时（毫秒），面板标题「已深度思考（用时 X 秒）」用
  thinking_ms     INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conv
  ON messages (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_conversations_user
  ON conversations (user_id, created_at);
`;

export class HistoryStore {
  /**
   * @param {string} path SQLite 文件路径，或 ':memory:'
   */
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.closed = false;
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');   // 外键默认关闭，必须显式打开
    this.db.exec(SCHEMA);

    this.stmtGetConv = this.db.prepare(
      'SELECT conversation_id, user_id, contact_id, created_at FROM conversations WHERE conversation_id = ?',
    );
    this.migrateLegacySchema();

    this.stmtInsertConv = this.db.prepare(
      `INSERT INTO conversations (conversation_id, user_id, contact_id, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    this.stmtInsertMsg = this.db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, status, created_at, thinking, thinking_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // 只取 completed：streaming/failed/interrupted 的半截内容不该回灌给模型，
    // 否则新进程会以为助手上次就说了半句话。
    this.stmtTail = this.db.prepare(
      `SELECT id, role, content, status, created_at FROM messages
        WHERE conversation_id = ? AND status = 'completed'
        ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    );
    this.stmtFinalizeMsg = this.db.prepare(
      'UPDATE messages SET content = ?, status = ?, thinking = ?, thinking_ms = ? WHERE id = ?',
    );
    this.stmtDeleteMsg = this.db.prepare(
      'DELETE FROM messages WHERE id = ?',
    );
    this.stmtMarkInterrupted = this.db.prepare(
      `UPDATE messages SET status = 'interrupted' WHERE status = 'streaming'`,
    );
    // 与 stmtTail 不同：回显要看到全部状态（含 streaming / interrupted）
    this.stmtRecentAll = this.db.prepare(
      `SELECT id, role, content, status, created_at, thinking, thinking_ms FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    );
    this.stmtCount = this.db.prepare(
      'SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?',
    );
    this.stmtClearMsgs = this.db.prepare(
      'DELETE FROM messages WHERE conversation_id = ?',
    );
    this.stmtDeleteConv = this.db.prepare(
      'DELETE FROM conversations WHERE conversation_id = ?',
    );
    this.stmtListConvs = this.db.prepare(
      `SELECT c.conversation_id, c.user_id, c.contact_id, c.created_at,
              COUNT(m.id) AS messages
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.conversation_id
        GROUP BY c.conversation_id
        ORDER BY c.created_at DESC LIMIT ?`,
    );
    // 会话列表：一次查询带出「最后一条消息」和「未读数」。
    // 用相关子查询而不是 JOIN + 聚合，避免为每条会话扫描全部消息。
    this.stmtListSessions = this.db.prepare(
      `SELECT c.conversation_id, c.user_id, c.contact_id, c.created_at,
              (SELECT m.content FROM messages m
                WHERE m.conversation_id = c.conversation_id
                ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_content,
              (SELECT m.role FROM messages m
                WHERE m.conversation_id = c.conversation_id
                ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_role,
              (SELECT m.status FROM messages m
                WHERE m.conversation_id = c.conversation_id
                ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_status,
              (SELECT m.created_at FROM messages m
                WHERE m.conversation_id = c.conversation_id
                ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_at,
              (SELECT COUNT(*) FROM messages m
                WHERE m.conversation_id = c.conversation_id
                  AND m.role = 'assistant'
                  AND m.status = 'completed'
                  AND m.rowid > c.last_read_rowid) AS unread_actual,
              c.unread_count
         FROM conversations c
        ORDER BY COALESCE(last_at, c.created_at) DESC
        LIMIT ?`,
    );
    this.stmtMarkRead = this.db.prepare(
      'UPDATE conversations SET last_read_rowid = ?, last_read_at = ?, unread_count = ? WHERE conversation_id = ?',
    );
    // 写库时累加。用 MAX(0, ...) 兜底，理论上不会为负，但脏数据不该让红点变成负数。
    this.stmtBumpUnread = this.db.prepare(
      'UPDATE conversations SET unread_count = MAX(0, unread_count + ?) WHERE conversation_id = ?',
    );
    this.stmtResetUnread = this.db.prepare(
      'UPDATE conversations SET unread_count = 0 WHERE conversation_id = ?',
    );
  }

  /**
   * 确保会话存在；不存在则创建。
   *
   * 已存在时**不覆盖** contact_id —— 一个会话绑定哪个 AI 联系人是不可变的，
   * 中途换联系人会让历史对话语义错乱。
   *
   * @returns {{conversationId: string, userId: string, contactId: string, createdAt: number, created: boolean}}
   */
  ensureConversation({ conversationId, userId, contactId = 'default' }) {
    const row = this.stmtGetConv.get(conversationId);
    if (row) {
      return {
        conversationId: row.conversation_id,
        userId: row.user_id,
        contactId: row.contact_id,
        createdAt: row.created_at,
        created: false,
      };
    }
    const createdAt = Date.now();
    this.stmtInsertConv.run(conversationId, userId, contactId, createdAt);
    return { conversationId, userId, contactId, createdAt, created: true };
  }

  getConversation(conversationId) {
    const row = this.stmtGetConv.get(conversationId);
    if (!row) return null;
    return {
      conversationId: row.conversation_id,
      userId: row.user_id,
      contactId: row.contact_id,
      createdAt: row.created_at,
    };
  }

  /**
   * 追加一条消息。
   * @returns {string} messageId
   */
  appendMessage({
    conversationId, role, content, status = 'completed',
    thinking = '', thinkingMs = 0,
    id = randomUUID(), createdAt = Date.now(),
    // 与 finalizeMessage 保持一致的未读语义。
    // 漏了这里会有一个隐蔽后果：走 appendMessage 写 AI 消息的路径
    // （比如导入、补偿、测试）不会点亮红点，而走 finalizeMessage 的会。
    viewing = true,
  }) {
    if (this.closed) return id;
    this.stmtInsertMsg.run(
      id, conversationId, role, content, status, createdAt,
      thinking ?? '', thinkingMs ?? 0,
    );
    if (role === 'assistant' && status === 'completed') {
      if (viewing) this.markRead({ conversationId });
      else this.stmtBumpUnread.run(1, conversationId);
    }
    return id;
  }

  /**
   * 取最近 N 条历史，按时间正序返回（便于直接拼进 prompt）。
   * @returns {Array<{role: string, content: string}>}
   */
  tail({ conversationId, limit = 40 }) {
    const rows = this.stmtTail.all(conversationId, limit);
    return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
  }

  /**
   * 开启一条消息（内容可为空），返回 messageId。
   *
   * 流式场景用：assistant 回复还没生成完就先占位，之后用 updateMessageContent()
   * 不断把累积的文本写回。这样服务器中途崩溃也不会丢掉已经推给用户的内容。
   */
  createMessage({ conversationId, role, status = 'streaming', createdAt = Date.now(), id = randomUUID() }) {
    if (this.closed) return id;
    this.stmtInsertMsg.run(id, conversationId, role, '', status, createdAt, '', 0);
    return id;
  }

  /**
   * 收尾一条消息：写入最终内容与状态。
   * 流式回复在开始时只建占位行，正文在这里一次性写入（不逐字节写库）。
   */
  finalizeMessage({
    id,
    content,
    status = 'completed',
    thinking = '',
    thinkingMs = 0,
    conversationId = null,
    /** 用户是否正在这个会话里看着。false 时才累加未读。 */
    viewing = true,
  }) {
    if (this.closed) return 0;
    const changed = this.stmtFinalizeMsg.run(
      content, status, thinking ?? '', thinkingMs ?? 0, id,
    ).changes;

    // 未读累加必须和「消息真正落库」绑定在一起：
    // 只有 completed 的 assistant 消息才值得提醒；失败/中断的不该亮红点。
    // 调用方没给 conversationId 时退化为按消息反查，避免漏计。
    if (status === 'completed' && changed > 0) {
      const cid = conversationId ?? this.conversationIdOf(id);
      if (cid) {
        if (viewing) {
          // 用户正看着 → 这条回复对他而言立刻就是"已读"，游标要跟上去。
          //
          // 只把 unread_count 留在 0 是不够的：按游标现算的真实值会变成 1，
          // 两个数对不上；下次任何一次重算（markRead / 迁移 / 排查）
          // 都会凭空冒出一个红点。
          // 这条不变式放在数据层，而不是让每个调用方自己记得调 markRead。
          this.markRead({ conversationId: cid });
        } else {
          this.stmtBumpUnread.run(1, cid);
        }
      }
    }
    return changed;
  }

  /** 反查一条消息属于哪个会话（调用方没传 conversationId 时兜底）。 */
  conversationIdOf(messageId) {
    if (this.closed) return null;
    const row = this.db
      .prepare('SELECT conversation_id FROM messages WHERE id = ?')
      .get(messageId);
    return row?.conversation_id ?? null;
  }

  /** 直接把未读清零（进入会话时用，不做重算）。 */
  resetUnread({ conversationId }) {
    if (this.closed) return 0;
    return this.stmtResetUnread.run(conversationId).changes;
  }

  /**
   * 把上次进程遗留下来的 streaming 行标记为 interrupted。
   * 服务端启动时调用：这些行只可能是崩溃/被杀留下的孤儿。
   */
  markInterrupted() {
    if (this.closed) return 0;
    return this.stmtMarkInterrupted.run().changes;
  }

  /** 覆盖整条消息内容（调用方负责累积完整文本）。 */


  /**
   * 撤回「最后一轮」的 AI 回复，供重新生成使用。
   *
   * 只删最后那条用户消息**之后**的 assistant 消息，用户那句话保留：
   * 他要重新生成的是回复，不是否认自己问过。
   *
   * @returns {{removed: number, userMessage: {id:string, content:string}|null}}
   */
  rewindLastReply({ conversationId }) {
    if (this.closed) return { removed: 0, userMessage: null };

    // 找最后一条用户消息的 rowid，删掉它之后的 assistant 消息
    const lastUser = this.db
      .prepare(
        `SELECT rowid AS rid, id, content FROM messages
          WHERE conversation_id = ? AND role = 'user'
          ORDER BY rowid DESC LIMIT 1`,
      )
      .get(conversationId);

    if (!lastUser) return { removed: 0, userMessage: null };

    const removed = this.db
      .prepare(
        `DELETE FROM messages
          WHERE conversation_id = ? AND role = 'assistant' AND rowid > ?`,
      )
      .run(conversationId, lastUser.rid).changes;

    // 重新生成意味着用户正盯着这个会话——顺手把未读清零。
    // 只删回复不重置的话，红点会继续指向一个已经不存在的消息。
    this.stmtResetUnread.run(conversationId);

    return { removed, userMessage: { id: lastUser.id, content: lastUser.content } };
  }

  /** 删除一条消息（流式占位后判定为空回复时回收）。 */
  deleteMessage({ id }) {
    if (this.closed) return 0;
    return this.stmtDeleteMsg.run(id).changes;
  }

  /** 取最近 N 条完整记录（含 messageId / 时间），给接口回显用。 */
  recentMessages({ conversationId, limit = 50 }) {
    return this.stmtRecentAll.all(conversationId, limit).reverse().map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      status: r.status,
      createdAt: r.created_at,
      // 历史回显要恢复思考面板，两个字段都要带出去
      thinking: r.thinking ?? '',
      thinkingMs: r.thinking_ms ?? 0,
    }));
  }

  count({ conversationId }) {
    return this.stmtCount.get(conversationId)?.n ?? 0;
  }

  /** 清空某会话的消息，保留会话本身。 */
  clearMessages({ conversationId }) {
    return this.stmtClearMsgs.run(conversationId).changes;
  }

  /** 删除会话及其全部消息（外键级联）。 */
  deleteConversation({ conversationId }) {
    return this.stmtDeleteConv.run(conversationId).changes;
  }

  listConversations(limit = 50) {
    return this.stmtListConvs.all(limit).map((r) => ({
      conversationId: r.conversation_id,
      userId: r.user_id,
      contactId: r.contact_id,
      createdAt: r.created_at,
      messages: r.messages,
    }));
  }

  /**
   * 会话列表（首页用）：每条带出最后一条消息摘要、时间和未读数。
   *
   * @param {object} [opts]
   * @param {string} [opts.userId] 只取某个用户的会话；不传则取全部
   * @param {number} [opts.limit]
   */
  listSessions({ userId = null, limit = 100 } = {}) {
    const all = this.stmtListSessions.all(limit);
    return all
      .filter((r) => (userId ? r.user_id === userId : true))
      .map((r) => ({
        conversationId: r.conversation_id,
        userId: r.user_id,
        contactId: r.contact_id,
        createdAt: r.created_at,
        lastMessage: r.last_content ?? '',
        lastRole: r.last_role ?? null,
        lastStatus: r.last_status ?? null,
        lastAt: r.last_at ?? null,
        // unread 是写库时累加的冗余计数；unreadActual 是按游标现算的真实值。
        // 两者正常情况下相等，不一致说明有漏计/多计，调试时可对照。
        unread: r.unread_count ?? 0,
        unreadActual: r.unread_actual ?? 0,
      }));
  }

  /**
   * 把会话标记为已读（游标推进到「最后一条已完成 assistant 消息」）。
   *
   * 用 rowid 而不是时间戳：同一毫秒内落库的两条消息 created_at 相同，
   * 用时间戳做游标时，标记已读之后再来的那条会因为 'created_at > 游标'
   * 不成立而被算作已读 —— 用户明明没看过，红点却不亮。
   * rowid 是 SQLite 的插入序号，严格单调，能区分同一毫秒的消息。
   */
  markRead({ conversationId }) {
    if (this.closed) return 0;
    const row = this.db
      .prepare(
        `SELECT MAX(rowid) AS rid, MAX(created_at) AS at FROM messages
          WHERE conversation_id = ? AND role = 'assistant' AND status = 'completed'`,
      )
      .get(conversationId);
    // 没有已完成的消息时，游标停在 0：之后任何一条都算未读
    const rid = row?.rid ?? 0;
    const at = row?.at ?? 0;

    // 游标推进到 rid 之后，这个会话就没有未读了。
    //
    // 这里**重算并覆盖**而不是置 0：unread_count 是冗余字段，
    // 万一因为异常路径多加了（比如重复 finalize），置 0 只是把错误藏起来，
    // 下次读取又是错的。按真实游标算一遍，能让计数自我校正。
    const left = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages
          WHERE conversation_id = ? AND role = 'assistant'
            AND status = 'completed' AND rowid > ?`,
      )
      .get(conversationId, rid)?.n ?? 0;

    return this.stmtMarkRead.run(rid, at, left, conversationId).changes;
  }

  /**
   * 旧库迁移：早期版本用 message_id 且没有 status 列。
   * 开发期删库也能跑，但生产上不该因为加一列就丢历史。
   */
  migrateLegacySchema() {
    let cols;
    try {
      cols = this.db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
    } catch { return; }
    if (!cols.length) return;                       // 表还不存在
    if (cols.includes('message_id') && !cols.includes('id')) {
      this.db.exec('ALTER TABLE messages RENAME COLUMN message_id TO id');
    }
    if (!cols.includes('status')) {
      this.db.exec(
        `ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'`,
      );
    }
    // 深度思考：老库补列。已有消息视为「没有思考」，空串/null 都不影响渲染。
    if (!cols.includes('thinking')) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN thinking TEXT NOT NULL DEFAULT ''`);
    }
    if (!cols.includes('thinking_ms')) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN thinking_ms INTEGER NOT NULL DEFAULT 0`);
    }
    // conversations 后来加了已读游标，老库需要补列
    let convCols;
    try {
      convCols = this.db.prepare('PRAGMA table_info(conversations)').all().map((c) => c.name);
    } catch { return; }
    if (convCols.length && !convCols.includes('last_read_at')) {
      this.db.exec(
        'ALTER TABLE conversations ADD COLUMN last_read_at INTEGER NOT NULL DEFAULT 0',
      );
    }
    if (convCols.length && !convCols.includes('last_read_rowid')) {
      this.db.exec(
        'ALTER TABLE conversations ADD COLUMN last_read_rowid INTEGER NOT NULL DEFAULT 0',
      );
      // 老库只有时间戳游标，把它换算成 rowid 才能保持「已读」状态不倒退。
      // 不换算的话所有历史会话都会突然冒出未读红点。
      this.db.exec(
        `UPDATE conversations SET last_read_rowid = COALESCE((
           SELECT MAX(m.rowid) FROM messages m
            WHERE m.conversation_id = conversations.conversation_id
              AND m.role = 'assistant' AND m.status = 'completed'
              AND m.created_at <= conversations.last_read_at
         ), 0)
         WHERE last_read_at > 0`,
      );
    }

    // ── unread_count：补列 + 按游标回填 ──────────────────────────────
    // 放在最后，因为回填依赖 last_read_rowid（可能刚刚才补出来）。
    // 直接置 0 会让所有历史会话的红点消失 —— 它们本来靠游标现算是对的，
    // 加了冗余字段反而丢信息。所以必须按真实游标算一遍再写入。
    convCols = this.db.prepare('PRAGMA table_info(conversations)').all().map((c) => c.name);
    if (convCols.length && !convCols.includes('unread_count')) {
      this.db.exec(
        'ALTER TABLE conversations ADD COLUMN unread_count INTEGER NOT NULL DEFAULT 0',
      );
      this.db.exec(
        `UPDATE conversations SET unread_count = COALESCE((
           SELECT COUNT(*) FROM messages m
            WHERE m.conversation_id = conversations.conversation_id
              AND m.role = 'assistant' AND m.status = 'completed'
              AND m.rowid > conversations.last_read_rowid
         ), 0)`,
      );
    }
  }

  close() {
    // 标记关闭：关停/测试结束时可能还有异步 flush 在路上，
    // 让它们变成安全的空操作，而不是抛 "statement has been finalized"。
    this.closed = true;
    try { this.db.close(); } catch {}
  }
}

/**
 * 把历史记录拼成一段可注入的 transcript。
 *
 * 这是「历史进 prompt」的唯一可行路径：profile patch 只配置插件，
 * 没有任何字段能承载对话历史（已核实 dsh-base 及各插件 patch 均无 history 配置）。
 *
 * @param {Array<{role: string, content: string}>} history
 * @param {object} [opts]
 * @param {number} [opts.maxChars] 字符上限，防止把上下文撑爆
 * @returns {{ transcript: string, included: number, truncated: boolean }}
 */
export function formatTranscript(history, { maxChars = 8000 } = {}) {
  if (!history.length) return { transcript: '', included: 0, truncated: false };

  // 从最近往前取，直到超预算——保留最近的最重要
  const picked = [];
  let used = 0;
  let truncated = false;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    const line = `${m.role === 'user' ? '用户' : '助手'}：${m.content}`;
    if (used + line.length > maxChars) {
      truncated = true;
      break;
    }
    picked.unshift(line);
    used += line.length + 1;
  }
  return { transcript: picked.join('\n'), included: picked.length, truncated };
}

/**
 * 构造冷启动首轮的实际 prompt：历史 + 本轮消息。
 *
 * 注意：只在**进程新建**时拼接。进程存活期间 Harness 自己累积上下文，
 * 每轮都拼一遍会导致同一句话在上下文里出现多次。
 */
export function buildPrimedPrompt({ transcript, message }) {
  if (!transcript) return message;
  return [
    '以下是你与这位用户之前的对话记录，供你理解上下文：',
    '<history>',
    transcript,
    '</history>',
    '',
    '用户现在说：',
    message,
  ].join('\n');
}