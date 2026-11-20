/**
 * AI 联系人（人设）存储
 *
 * 每个联系人 = 一套人设 = 一套 profile patch 模版。
 * 拉进程时按 conversation 绑定的 contact 取 system_prompt，
 * 注入到 patch 的 personaPrefix 里，实现「同一个用户、不同 AI、不同进程」。
 *
 * 安全要点：人设只能来自这里，绝不能来自客户端请求体。
 * 早期版本从 req.body.persona 取，等于把 system prompt 的写权限交给了调用方。
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ai_contacts (
  id            TEXT    NOT NULL PRIMARY KEY,
  name          TEXT    NOT NULL,
  avatar        TEXT,
  system_prompt TEXT    NOT NULL,
  voice_id      TEXT,
  created_at    INTEGER NOT NULL
);
`;

/**
 * 内置联系人。
 *
 * 用 INSERT OR IGNORE：已有同名 id 的不覆盖，
 * 否则每次重启都会把运营改过的人设冲掉。
 */
const SEED = [
  {
    id: 'catgirl',
    name: '傲娇猫娘',
    avatar: '🐱',
    system_prompt:
      '你是傲娇的猫娘，名字叫小白。说话要带"喵"，嘴上嫌弃主人，但每次都认真帮忙解决问题。'
      + '被夸奖时会害羞地否认。不要承认自己是 AI 或语言模型。',
    voice_id: 'zh-female-soft',
  },
  {
    id: 'butler',
    name: '沉稳管家',
    avatar: '🎩',
    system_prompt:
      '你是一位沉稳、克制的英式管家。用简洁的中文回答，不寒暄、不卖萌，'
      + '直接给出结论和必要的解释。称呼对方为"先生"或"女士"。',
    voice_id: 'zh-male-deep',
  },
  {
    id: 'coder',
    name: '程序员老周',
    avatar: '👨‍💻',
    system_prompt:
      '你是一名资深后端工程师，说话严谨、干练，不寒暄、不说客套话。'
      + '回答技术问题时要给可直接运行的代码，标明语言和关键边界条件；'
      + '不确定的地方明确说"不确定"，绝不编造 API 或库的行为。'
      + '优先指出潜在的错误、性能问题和安全隐患。',
    voice_id: 'zh-male-neutral',
  },
  {
    id: 'default',
    name: '通用助手',
    avatar: '🤖',
    system_prompt: '',
    voice_id: null,
  },
];

export class ContactsStore {
  /** @param {string} path SQLite 文件路径，或 ':memory:' */
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.closed = false;
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);

    this.stmtGet = this.db.prepare(
      'SELECT id, name, avatar, system_prompt, voice_id, created_at FROM ai_contacts WHERE id = ?',
    );
    this.stmtList = this.db.prepare(
      'SELECT id, name, avatar, system_prompt, voice_id, created_at FROM ai_contacts ORDER BY created_at, id',
    );
    this.stmtInsert = this.db.prepare(
      `INSERT OR IGNORE INTO ai_contacts (id, name, avatar, system_prompt, voice_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.stmtUpsert = this.db.prepare(
      `INSERT INTO ai_contacts (id, name, avatar, system_prompt, voice_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         avatar = excluded.avatar,
         system_prompt = excluded.system_prompt,
         voice_id = excluded.voice_id`,
    );

    this.seed();
  }

  seed() {
    const now = Date.now();
    for (const c of SEED) {
      this.stmtInsert.run(c.id, c.name, c.avatar, c.system_prompt, c.voice_id, now);
    }
  }

  /** @returns {null | {id,name,avatar,systemPrompt,voiceId,createdAt}} */
  get(id) {
    if (this.closed) return null;
    const row = this.stmtGet.get(id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      avatar: row.avatar,
      systemPrompt: row.system_prompt,
      voiceId: row.voice_id,
      createdAt: row.created_at,
    };
  }

  list() {
    if (this.closed) return [];
    return this.stmtList.all().map((row) => ({
      id: row.id,
      name: row.name,
      avatar: row.avatar,
      systemPrompt: row.system_prompt,
      voiceId: row.voice_id,
      createdAt: row.created_at,
    }));
  }

  /** 新建或覆盖一个联系人（运营后台用）。 */
  upsert({ id, name, avatar = null, systemPrompt = '', voiceId = null }) {
    if (this.closed) return null;
    this.stmtUpsert.run(id, name, avatar, systemPrompt, voiceId, Date.now());
    return this.get(id);
  }

  close() {
    this.closed = true;
    try { this.db.close(); } catch {}
  }
}