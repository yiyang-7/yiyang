/**
 * DSH Chat 服务端（完整版）
 *
 * 进程池逻辑在 lib/session-pool.mjs，/chat 在 lib/chat-route.mjs。
 * 这里只负责装配、配置和健康检查。
 *
 *   POST   /chat                            流式对话（SSE）
 *   GET    /healthz                         健康检查 + 环境自检
 *   DELETE /conversations/:conversationId   主动结束会话
 */

import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mountChat } from './lib/chat-route.mjs';
import { HistoryStore } from './lib/history-store.mjs';
import { ContactsStore } from './lib/contacts-store.mjs';
import { createPresence } from './lib/presence.mjs';
import { createScheduler, jobsFromEnv } from './lib/active-scheduler.mjs';
import {
  acquireProcess,
  probeHardlink,
  poolSnapshot,
  stopReaper,
  configurePool,
  RUNTIME,
  IDLE_TIMEOUT,
  MAX_POOL_SIZE,
} from './lib/session-pool.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// ── 配置加载 ────────────────────────────────────────────────────────────
function loadFileConfig() {
  const path = process.env.DSH_CHAT_CONFIG ?? join(here, 'server.config.json');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

const fileConfig = loadFileConfig();

// 会话根：环境变量 > 配置文件 > 默认（server-pool 已给的 cwd/.dsh-sessions）
if (fileConfig.sessionsBaseDir && !process.env.DSH_CHAT_SESSIONS) {
  RUNTIME.sessionsBaseDir = resolve(here, fileConfig.sessionsBaseDir);
}

// 人设：环境变量 > 配置文件。null 表示沿用 profile 自带人设，不覆盖成空。
const persona = {
  prefix: process.env.DSH_CHAT_PERSONA_PREFIX ?? fileConfig.persona?.prefix ?? null,
  suffix: process.env.DSH_CHAT_PERSONA_SUFFIX ?? fileConfig.persona?.suffix ?? null,
};

// 配置文件里的 pool / llm 设置必须显式应用：
// session-pool 的这些常量在模块加载时就定好了，配置文件是之后才读到的。
configurePool({
  idleTimeoutMs: process.env.DSH_IDLE_TIMEOUT_MS
    ? Number(process.env.DSH_IDLE_TIMEOUT_MS) : fileConfig.idleTimeoutMs,
  maxProcesses: fileConfig.maxProcesses,
});
if (fileConfig.profile && !process.env.DSH_CHAT_PROFILE) RUNTIME.profile = fileConfig.profile;
if (fileConfig.llm?.provider && !process.env.DSH_CHAT_PROVIDER) RUNTIME.provider = fileConfig.llm.provider;
if (fileConfig.llm?.model && !process.env.DSH_CHAT_MODEL) RUNTIME.model = fileConfig.llm.model;

// 历史库路径：环境变量 > 配置文件 > 项目内 history.db
const DB_PATH = process.env.DSH_CHAT_DB
  ?? (fileConfig.dbPath ? resolve(here, fileConfig.dbPath) : join(here, 'history.db'));
const history = new HistoryStore(DB_PATH);

// 上次进程若是被强杀，库里会留下 status='streaming' 的行。
// 启动时统一标记为 interrupted：这些轮次永远不会再有结果了，
// 而且它们会被 tail() 过滤掉，不会污染冷启动回灌。
{
  const n = history.markInterrupted();
  if (n) console.log(`[历史] 标记 ${n} 条上次未完成的回复为 interrupted`);
}

// 联系人（人设）库：与历史库同文件，各自一条连接（WAL 支持多连接）
const contacts = new ContactsStore(DB_PATH);
// 「用户此刻在看哪个会话」——内存态，不落库（见 lib/presence.mjs）
const presence = createPresence();
// 定期清掉过期的存在感记录，避免长期运行后 Map 无限增长
const presenceSweep = setInterval(() => presence.sweep(), 60_000);
presenceSweep.unref?.();

const PORT = Number(process.env.PORT ?? fileConfig.port ?? 3000);
const HOST = process.env.DSH_CHAT_HOST ?? fileConfig.host ?? '127.0.0.1';

const app = express();
app.use(express.json({ limit: '25mb' }));

// ── CORS ────────────────────────────────────────────────────────────
// 浏览器同源访问（Vite 代理）不需要它。但打包成 App 后 WebView 的
// origin 是 https://localhost 或 capacitor://localhost，对后端而言是跨域，
// 不放开的话所有请求都会被浏览器拦掉，表现为"App 打开是白屏 / 一直转圈"。
//
// 默认关闭：这个后端能读写所有会话，放开给任意网页等于把数据交给
// 任何用户访问过的站点。必须显式列出允许的来源。
const CORS_ORIGINS = (process.env.DSH_CHAT_CORS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (CORS_ORIGINS.length > 0) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    // App 的 WebView origin 是这两个之一；也允许显式列出的 http(s) 来源。
    const allowed = origin && (
      CORS_ORIGINS.includes('*') || CORS_ORIGINS.includes(origin)
    );
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
      // SSE 不需要凭证，但预检要能过
      res.setHeader('Access-Control-Max-Age', '600');
    }
    // 预检必须在路由之前结束，否则会掉进 404
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  console.log(`[CORS] 已放开来源：${CORS_ORIGINS.join(', ')}`);
}

// 人设不再从请求体注入。以前这里会把服务端默认人设塞进 req.body.persona，
// 等于允许调用方覆盖 system prompt；现在人设只能来自 ai_contacts 表。

// 启动自检：会话持久化后端需要硬链接支持
const hardlink = probeHardlink(RUNTIME.sessionsBaseDir);

// 健康检查必须以回调形式交给 mountChat —— 它内部先注册了 /healthz，
// 之后在外部再 app.get 同一个路径不会覆盖，只会被永远屏蔽。
// 联系人列表：客户端选人用的
app.get('/contacts', (req, res) => {
  res.json({ contacts: contacts.list() });
});

app.get('/contacts/:contactId', (req, res) => {
  const c = contacts.get(req.params.contactId);
  if (!c) return res.status(404).json({ error: '联系人不存在' });
  res.json(c);
});

// 用户此刻在看哪个会话。前端切换会话时上报，服务端据此决定
// 新到达的 AI 回复要不要计未读（见 lib/presence.mjs）。
app.post('/presence', (req, res) => {
  const { userId, conversationId } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: '缺少 userId' });
  // conversationId 为 null/空 = 离开了所有会话（比如切到新建页）
  presence.report(userId, conversationId || null);
  res.json({ ok: true, viewing: presence.current(userId) });
});

app.get('/presence', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: '缺少 userId' });
  res.json({ viewing: presence.current(userId) });
});

// 会话列表（首页）：把 DB 里的会话 + 联系人 + 最后一条消息 + 未读数拼起来。
// 客户端只负责渲染，不需要知道联系人和会话是两张表。
app.get('/sessions', (req, res) => {
  const userId = req.query.userId;
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  const rows = history.listSessions({ userId: userId || null, limit });
  // 联系人可能在会话创建后被删掉，这里要容错而不是丢掉整个会话
  const contactMap = new Map(contacts.list().map((c) => [c.id, c]));

  res.json({
    sessions: rows.map((s) => {
      const contact = contactMap.get(s.contactId);
      return {
        conversationId: s.conversationId,
        contactId: s.contactId,
        name: contact?.name ?? s.contactId,
        avatar: contact?.avatar ?? '🤖',
        lastMessage: summarize(s.lastMessage),
        lastRole: s.lastRole,
        lastAt: s.lastAt ?? s.createdAt,
        unread: s.unread,
        // 按游标现算的真实未读数。正常应与 unread 相等，
        // 不相等说明计数漂移（冗余字段的通病），前端/排查时能对照。
        unreadActual: s.unreadActual,
      };
    }),
  });
});

// 进入聊天页时把会话标记为已读
app.post('/conversations/:conversationId/read', (req, res) => {
  const conv = history.getConversation(req.params.conversationId);
  if (!conv) return res.status(404).json({ error: '会话不存在' });
  const userId = req.body?.userId ?? req.query.userId;
  if (userId && conv.userId !== userId) {
    return res.status(403).json({ error: '无权访问该会话' });
  }
  const changed = history.markRead({ conversationId: conv.conversationId });
  res.json({ ok: true, changed });
});

/** 摘要：压掉换行、截断过长内容，列表里只占一行 */
function summarize(text, max = 60) {
  if (!text) return '';
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

mountChat(app, {
  history,
  contacts,
  presence,
  healthz: () => ({
    ok: hardlink.ok,
    hardlink,
    profile: RUNTIME.profile,
    sessionsBaseDir: RUNTIME.sessionsBaseDir,
    idleTimeoutMs: IDLE_TIMEOUT,
    maxPoolSize: MAX_POOL_SIZE,
    persona,
    contacts: contacts.list().map((c) => ({ id: c.id, name: c.name })),
    llm: { provider: RUNTIME.provider, model: RUNTIME.model },
    sessions: poolSnapshot(),
    db: { path: DB_PATH, conversations: history.listConversations(3) },
  }),
});

// ── 主动消息调度 ──────────────────────────────────────────────────
// 默认关闭：它会凭空产生用户没发的消息，自动开启是危险的默认值。
// 要启用得显式设置 DSH_ACTIVE_MESSAGES=1 和 DSH_ACTIVE_CONVERSATIONS。
const ACTIVE_ENABLED = process.env.DSH_ACTIVE_MESSAGES === '1';
const scheduler = createScheduler({
  history,
  contacts,
  getProcess: acquireProcess,
  enabled: ACTIVE_ENABLED,
  timezone: process.env.DSH_ACTIVE_TZ?.trim() || undefined,
  jobs: jobsFromEnv(),
});

// 调试/测试用：立即对配置好的会话触发一次。
// 不配 DSH_ACTIVE_ALLOW_TRIGGER=1 就不挂这个接口 ——
// 否则任何人都能通过它让 AI 连发消息、刷爆上下文和未读数。
if (process.env.DSH_ACTIVE_ALLOW_TRIGGER === '1') {
  app.post('/active/trigger', async (req, res) => {
    const { id } = req.body ?? {};
    try {
      const result = id ? await scheduler.trigger(id) : await scheduler.triggerAll();
      res.json({ ok: true, result, jobs: scheduler.snapshot() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
}

app.get('/active/jobs', (_req, res) => {
  res.json({ enabled: ACTIVE_ENABLED, jobs: scheduler.snapshot() });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`服务端已启动：http://${HOST}:${PORT}`);
  console.log(`[配置] profile=${RUNTIME.profile} 会话根=${RUNTIME.sessionsBaseDir}`);
  console.log(`[配置] 历史库=${DB_PATH}`);
  if (!hardlink.ok) {
    console.warn(`[警告] 硬链接自检失败，会话落盘阶段会失败：\n         ${hardlink.reason}`);
  } else {
    console.log('[自检] ✔ 硬链接可用');
  }
});

function shutdown() {
  console.log('[关闭] 清理进程池…');
  scheduler.stop();
  server.close();
  stopReaper();
  history.close();
  for (const s of poolSnapshot()) {
    console.log(`[关闭] 结束会话 ${s.conversationId}`);
  }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, server };