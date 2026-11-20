/**
 * 进程池（核心）
 *
 * 参考你给的 sessionPool 结构重写：
 *   Map<conversationId, { process, lastActive }>
 *   getOrCreateProcess(conversationId)  —— 有则复用并刷新活跃时间，无则创建
 *   定时器每分钟扫一遍，超时 kill + 从池子里删
 *
 * 但直接套用参考代码有 5 处会坏，下面每处都改了，原因写在对应注释里。
 */

import { spawn } from 'node:child_process';
import { mkdirSync, linkSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildContactPatch, materializePatch } from './patch-builder.mjs';

// ─────────────────────────────────────────────────────────────────────────
// 1. 进程池：存放 { conversationId: { process, lastActive } }
// ─────────────────────────────────────────────────────────────────────────
const sessionPool = new Map();
let IDLE_TIMEOUT = Number(process.env.DSH_IDLE_TIMEOUT_MS ?? 30 * 60 * 1000); // 30 分钟
let MAX_POOL_SIZE = Number(process.env.DSH_MAX_POOL ?? 8);

// 扫描间隔。参考代码写死 60 秒，导致 IDLE_TIMEOUT 设成 10 秒也要等最多 60 秒才回收，
// 测试和调试时很难受。这里放宽成可配置，默认仍是 60 秒。
let REAP_INTERVAL_MS = Number(process.env.DSH_REAP_INTERVAL_MS ?? 60 * 1000);

/** 会话配置：patch 从配置生成，不是写死的文件。 */
const RUNTIME = {
  // 【改动 1】参考代码 spawn('dsh', ...) 依赖 PATH。
  // 实测这台机器 `which dsh` 为空，spawn 会直接 ENOENT。
  // 必须给绝对路径，或用 node 显式执行 bin.js。
  // 注意：变量名不能叫 DSH_PROFILE —— 那是 dsh 启动器自己读的，
  // 而本进程（web profile 里的 agent）环境里就带着 DSH_PROFILE=web。
  // 直接复用会让服务端以为该启动 web profile，patch 生成器不认识它，
  // 结果产出空 patch，子进程一启动就退出。
  dshBin: process.env.DSH_CHAT_BIN
    ?? '/opt/dshapp/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
  profile: process.env.DSH_CHAT_PROFILE ?? 'sdk',
  sessionsBaseDir: process.env.DSH_CHAT_SESSIONS
    ?? join(process.cwd(), '.dsh-sessions'),
  provider: process.env.DSH_CHAT_PROVIDER ?? 'deepseek-official',
  model: process.env.DSH_CHAT_MODEL ?? 'deepseek-chat',
};

/**
 * 取出（必要时创建）某会话的 agent 结构。
 *
 * 返回 { agent, lastActive }，agent 内部封装了 Harness 子进程 + JSON-RPC。
 *
 * @param {string} conversationId
 * @param {object} [opts] { userId, cwd, persona }
 * @returns {Promise<object>} agent
 */
export async function acquireProcess(conversationId, opts = {}) {
  const session = sessionPool.get(conversationId);

  if (session && !session.agent.dead) {
    session.lastActive = Date.now();
    // 复用：Harness 内部已有上下文，不要再回灌历史。
    //
    // usedCount 记在池条目上而不是 agent 上：agent 是长期存活对象，
    // 把「本轮是否新建」这种一次性状态写在它身上，并发请求会互相覆盖
    // ——A 拿到 fresh=true 还没发消息，B 复用同一进程把它改成 false，
    // A 就漏了回灌。改为返回调用时刻的快照。
    return { agent: session.agent, isNew: false, reusedCount: session.usedCount ?? 0 };
  }
  if (session) sessionPool.delete(conversationId); // 死进程先清掉

  // 【改动 2】池子上限。参考代码没有上限，会话一多就会把机器打满。
  if (sessionPool.size >= MAX_POOL_SIZE) {
    evictOne();
  }

  const userId = opts.userId ?? 'anon';
  const sessionsRoot = join(RUNTIME.sessionsBaseDir, sanitize(userId), sanitize(conversationId));

  // 【改动 3】参考代码直接用 'dsh headless'。实测 headless 是
  // "Answer one task and exit" 的一次性 CLI，且任务在启动参数里传，
  // 不能 stdin 多轮常驻。要会话复用必须用 SDK profile 的 JSON-RPC 服务。
  // 按联系人生成 patch 模版：人设差异全部来自 contact.system_prompt。
  // 没有联系人时退化为服务端默认配置（config.persona）。
  const patch = buildContactPatch(opts.contact, {
    config: {
      profile: RUNTIME.profile,
      persona: opts.persona ?? { prefix: null, suffix: null },
    },
    // sessionsRoot 必须传：漏了它整份 patch 会退化成只有注释的空文件，
    // dsh 报 "must be a top-level YAML array"，进程启动即退出。
    sessionsRoot,
    cwd: opts.cwd,
  });
  // 文件名要带哈希：sanitize 会把 'a/b' 和 'a:b' 都压成 'a_b'，
  // 两个不同会话就会写同一个 patch 文件，后写的覆盖先写的 ——
  // 表现是「换了会话，人设却串成了上一个的」。
  // conversationId 来自客户端，这个碰撞是可控输入触发的，必须消除。
  const patchPath = materializePatch({
    dir: join(RUNTIME.sessionsBaseDir, '_patches', sanitize(userId)),
    name: patchFileName(conversationId),
    patch,
  });

  console.log(`[启动] 为会话 ${conversationId} 创建 dsh 进程`);
  const agent = new HarnessAgent({
    conversationId,
    args: ['--profile', RUNTIME.profile, '--patch', patchPath],
    cwd: opts.cwd ?? process.cwd(),
    meta: { userId, conversationId, sessionsRoot, patchPath },
  });

  // isNew=true 表示这是全新进程，内部无上下文，调用方应回灌历史
  const entry = { agent, lastActive: Date.now(), usedCount: 0 };
  sessionPool.set(conversationId, entry);

  try {
    // 【改动 4】参考代码 spawn 完就写 stdin，没有任何握手。
    // SDK profile 必须先 initialize 解析模型路由，否则 session/prompt 会被拒。
    await agent.initialize({
      cwd: entry.agent.cwd,
      provider: RUNTIME.provider,
      model: RUNTIME.model,
    });
  } catch (err) {
    sessionPool.delete(conversationId);
    agent.kill();
    throw err;
  }

  // 监听进程意外退出，清理池子
  agent.onExit((code, signal) => {
    console.log(`[退出] 会话 ${conversationId} 的进程退出，code: ${code} signal: ${signal}`);
    const cur = sessionPool.get(conversationId);
    if (cur && cur.agent === agent) sessionPool.delete(conversationId);
  });

  return { agent, isNew: true, reusedCount: 0 };
}

/**
 * 兼容旧调用方：只要 agent 本体。
 * 新代码请用 acquireProcess()，它同时告诉你进程是新起的还是复用的。
 */
export async function getOrCreateProcess(conversationId, opts = {}) {
  const { agent } = await acquireProcess(conversationId, opts);
  return agent;
}

/** 淘汰最久没动静的会话，给新会话腾位置。 */
function evictOne() {
  let victim = null;
  let oldest = Infinity;
  for (const [id, s] of sessionPool) {
    if (s.lastActive < oldest) {
      oldest = s.lastActive;
      victim = id;
    }
  }
  if (victim) {
    console.log(`[淘汰] 池满，回收最久未用的会话 ${victim}`);
    sessionPool.get(victim).agent.kill();
    sessionPool.delete(victim);
  }
}

/** 手动结束某个会话。 */
export function closeSession(conversationId) {
  const s = sessionPool.get(conversationId);
  if (!s) return false;
  s.agent.kill();
  sessionPool.delete(conversationId);
  return true;
}

export function poolSnapshot() {
  return [...sessionPool.entries()].map(([id, s]) => ({
    conversationId: id,
    lastActive: s.lastActive,
    alive: !s.agent.dead,
    sessionsRoot: s.agent.meta.sessionsRoot,
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// 3. 定时清理僵尸进程
// ─────────────────────────────────────────────────────────────────────────
let reaper = null;

function startReaper() {
  if (reaper) clearInterval(reaper);
  reaper = setInterval(() => {
    const now = Date.now();
    for (const [conversationId, session] of sessionPool.entries()) {
      if (now - session.lastActive > IDLE_TIMEOUT) {
        console.log(`[回收] 会话 ${conversationId} 超时，关闭进程`);
        session.agent.kill();
        sessionPool.delete(conversationId);
      }
    }
  }, REAP_INTERVAL_MS); // 默认每分钟检查一次
  reaper.unref?.();       // 不要因为定时器把进程钉住
}

startReaper();

export function stopReaper() {
  if (reaper) clearInterval(reaper);
  reaper = null;
}

// ─────────────────────────────────────────────────────────────────────────
// HarnessAgent：一个子进程 + JSON-RPC 会话
// ─────────────────────────────────────────────────────────────────────────
class HarnessAgent {
  constructor({ conversationId, args, cwd, meta }) {
    this.conversationId = conversationId;
    // 运行时会话 id 必须每个进程实例唯一。
    //
    // 不能直接用 conversationId：会话日志按 sessionId 落盘，进程重启后
    // 磁盘上还留着上一次的 session.v4.jsonl。/zstd 与 session.lock，
    // 新进程再用同一个 id 去 agents.create() 会直接报
    // `session "<id>" already exists`，表现为"重启后整个会话再也发不出消息"。
    //
    // 代价：重启后运行时内存上下文丢失（磁盘日志仍在，但 SDK 没有 resume 接口）。
    // 这正是本轮接受的行为——会话分组仍由 conversationId 承担。
    this.sessionId = `${conversationId}~${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.cwd = cwd;
    this.meta = meta;
    this.dead = false;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.exitHandlers = new Set();
    this.stderrTail = [];

    // 【改动 1 续】用 node 跑 bin.js，绕开 PATH 依赖。
    this.child = spawn(process.execPath, [RUNTIME.dshBin, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdin.on('error', () => {}); // 进程已死时写入会 EPIPE，别让它炸

    // 【改动 5】参考代码直接 stdout.on('data') 把字节串当文本塞进 SSE。
    // SDK 的 stdout 是"每行一条 JSON-RPC"，必须按行切帧再分发，
    // 否则一个 chunk 里可能夹着响应帧和多个通知帧，客户端无法解析。
    let buf = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.trim()) this.#onLine(line);
      }
    });

    // stderr 收集尾部，进程崩溃时能带回现场
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue;
        this.stderrTail.push(line);
        if (this.stderrTail.length > 50) this.stderrTail.shift();
      }
    });

    this.child.on('exit', (code, signal) => {
      this.dead = true;
      for (const [, p] of this.pending) {
        p.reject(new Error(`Harness 进程退出 (code=${code} signal=${signal})`));
      }
      this.pending.clear();
      for (const fn of this.exitHandlers) fn(code, signal);
    });
  }

  #onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // 非协议行（例如误写的日志）忽略
    }

    // 响应帧：有 id 无 method
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        const err = new Error(msg.error.message);
        err.code = msg.error.code;
        err.data = msg.error.data;
        p.reject(err);
      } else {
        p.resolve(msg.result);
      }
      return;
    }

    // 通知帧：有 method 无 id
    if (msg.method) {
      for (const fn of this.listeners) {
        try {
          fn(msg.method, msg.params ?? {});
        } catch {}
      }
    }
  }

  request(method, params) {
    if (this.dead) return Promise.reject(new Error('Harness 进程已退出'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async initialize(params) {
    const result = await this.request('initialize', params);
    this.serverInfo = result?.serverInfo;
    return result;
  }

  /** 发送一条用户消息。返回 { messageId }，只是入队回执。 */
  async prompt(text, images) {
    const contentBlocks = [{ type: 'text', text }];
    for (const img of images ?? []) {
      contentBlocks.push({ type: 'image', data: img.data, mimeType: img.mimeType });
    }
    return this.request('session/prompt', {
      sessionId: this.sessionId,
      contentBlocks,
    });
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onExit(fn) {
    this.exitHandlers.add(fn);
  }

  kill() {
    if (this.dead) return;
    try {
      this.child.kill('SIGTERM');
    } catch {}
    const t = setTimeout(() => {
      if (!this.dead) {
        try {
          this.child.kill('SIGKILL');
        } catch {}
      }
    }, 3000);
    t.unref?.();
  }
}

/** 外部 id → 安全目录名。 */
export function sanitize(id) {
  return String(id).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64) || 'anon';
}

/**
 * patch 文件名：可读前缀 + 原值的哈希后缀。
 *
 * 只用 sanitize 不够——它是**多对一**的，'a/b' 与 'a:b' 都会变成 'a_b'，
 * 两个会话共用一个 patch 文件，人设互相覆盖。
 * 后缀取原值的短哈希，保证不同 id 一定落到不同文件。
 */
export function patchFileName(conversationId) {
  const raw = String(conversationId);
  // FNV-1a 32 位：够用、同步、无依赖
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${sanitize(raw)}-${h.toString(16).padStart(8, '0')}`;
}

/**
 * 让配置文件里的值生效。
 *
 * 这些常量在模块加载时就从环境变量定好了，而 server.mjs 是在加载之后
 * 才读到 server.config.json 的，所以必须留一个显式的配置入口，
 * 否则配置文件里的 idleTimeoutMs / maxProcesses 会被静默忽略。
 */
function configurePool({ idleTimeoutMs, maxProcesses, reapIntervalMs } = {}) {
  if (Number.isFinite(idleTimeoutMs) && idleTimeoutMs > 0) {
    IDLE_TIMEOUT = idleTimeoutMs;
    startReaper();     // 用新值重建定时器
  }
  if (Number.isFinite(maxProcesses) && maxProcesses > 0) MAX_POOL_SIZE = maxProcesses;
  if (Number.isFinite(reapIntervalMs) && reapIntervalMs > 0) {
    REAP_INTERVAL_MS = reapIntervalMs;
    startReaper();
  }
}

// IDLE_TIMEOUT / MAX_POOL_SIZE / REAP_INTERVAL_MS 用 let 声明，
// ESM 的命名导出是活绑定，configurePool 改值后导入方读到的是新值。
export {
  sessionPool,
  RUNTIME,
  configurePool,
  IDLE_TIMEOUT,
  REAP_INTERVAL_MS,
  MAX_POOL_SIZE,
};
/**
 * 启动自检：目录是否支持硬链接。
 *
 * dsh 唯一的会话持久化后端用 fs.link() 原子发布日志，非 EEXIST 错误原样抛出。
 * f2fs 等文件系统上会返回 EACCES，表现为"权限不足"但实为不支持。
 */
export function probeHardlink(dir) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    return { ok: false, reason: `目录不可写: ${dir} (${err.code})` };
  }
  const a = join(dir, `.hl-${process.pid}.a`);
  const b = join(dir, `.hl-${process.pid}.b`);
  try {
    writeFileSync(a, 'probe');
    linkSync(a, b);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: `${dir} 不支持硬链接 (${err.code})；dsh 会话持久化需要 fs.link()，`
        + '请把 DSH_CHAT_SESSIONS 指到 ext4/xfs/btrfs/overlayfs。',
    };
  } finally {
    try { rmSync(a, { force: true }); rmSync(b, { force: true }); } catch {}
  }
}
