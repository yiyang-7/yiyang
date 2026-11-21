/**
 * 网关 API 封装。
 *
 * 所有请求走 /api 前缀，由 Vite dev server 代理到 3090，
 * 因此浏览器端不存在跨域问题。
 */

/**
 * API 基地址。
 *
 * 浏览器里是 `''`，请求走 `/api/*`，由 Vite dev server / 静态服务器同源代理。
 *
 * 打包成 App（Capacitor）后 WebView 的 origin 是 `https://localhost`，
 * 没有代理层了——这时必须有一个真实的后端地址，否则每个请求都是
 * 打到 App 自己的资源服务器上，全部 404。
 *
 * 通过 `VITE_API_BASE` 注入，例如构建 APK 时：
 *   VITE_API_BASE=http://192.168.1.10:3090 npm run build
 * 空值则保持相对路径，行为与浏览器一致。
 */
import { getApiKey } from './settings.js';
import {
  DEMO,
  demoFetchContacts,
  demoFetchHistory,
  demoFetchSessions,
  demoStreamChat,
} from './demo.js';

const API_BASE = (import.meta.env?.VITE_API_BASE ?? '').replace(/\/$/, '');

/**
 * 演示模式（VITE_DEMO=1 构建）。
 *
 * 所有接口短路到内置数据，不碰网络。这样单文件 HTML 双击就能展示：
 * 没有后端、没有模型额度、断网都正常。
 * UI 仍是真实组件在渲染，所以看到的效果和真机一致。
 */
export { DEMO as IS_DEMO };

/** 拼出完整 API 地址。/api 前缀只在有 VITE_API_BASE 时才省略。 */
function apiUrl(path) {
  // 后端路由不带 /api 前缀（代理层负责剥离），
  // 所以有基地址时直接拼路径，没有时才加 /api 走代理。
  return API_BASE ? `${API_BASE}${path}` : `/api${path}`;
}

export class ApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function getJson(path, { timeoutMs = 8000, signal } = {}) {
  // 没有超时的话，服务端假死时页面会一直卡在骨架屏上，
  // 用户完全不知道发生了什么。这里用 AbortController 兜底。
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(apiUrl(path), { signal: ctrl.signal });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      let code;
      try {
        const j = await res.json();
        msg = j.error ?? msg;
        code = j.code;
      } catch {
        /* 非 JSON 响应，保留状态码信息 */
      }
      throw new ApiError(msg, { status: res.status, code });
    }
    return res.json();
  } catch (e) {
    // AbortError 有两种来源：外部取消 或 超时。用 signal 是否已 abort 区分。
    if (e.name === 'AbortError') {
      if (signal?.aborted) throw e;
      throw new ApiError('请求超时，请检查网络或服务端是否在运行', { code: 'TIMEOUT' });
    }
    if (e instanceof TypeError) {
      // fetch 在网络层失败（断网、DNS、拒绝连接）统一抛 TypeError
      throw new ApiError('当前网络不可用，无法连接服务端', { code: 'NETWORK' });
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/** 联系人列表 */
export function fetchContacts() {
  if (DEMO) return Promise.resolve(demoFetchContacts());
  return getJson('/contacts').then((r) => r.contacts ?? []);
}

/**
 * 首页会话列表。
 * 每条包含：conversationId / contactId / name / avatar / lastMessage / lastAt / unread
 */
export async function fetchSessions({ userId, limit = 100 } = {}) {
  if (DEMO) return demoFetchSessions();
  const qs = new URLSearchParams();
  if (userId) qs.set('userId', userId);
  qs.set('limit', String(limit));
  const r = await getJson(`/sessions?${qs}`);
  return r.sessions ?? [];
}

/** 进入聊天页时把会话标记已读（失败不影响主流程，静默忽略） */
/**
 * 上报「我现在在看哪个会话」。
 *
 * 服务端据此决定新到达的 AI 回复要不要计未读。
 * 传 null 表示离开所有会话（比如回到新建页）。
 *
 * 失败静默：presence 只影响未读红点，不该因为网络抖动打断对话。
 */
export async function reportPresence(userId, conversationId) {
  if (DEMO) return;   // 演示模式没有服务端，未读状态由内置数据决定
  try {
    await fetch(apiUrl('/presence'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, conversationId: conversationId ?? null }),
    });
  } catch {
    /* 未读红点不值得打扰用户 */
  }
}

export async function markSessionRead(conversationId, userId) {
  if (DEMO) return;
  try {
    await fetch(apiUrl(`/conversations/${encodeURIComponent(conversationId)}/read`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
  } catch {
    /* 已读只是锦上添花，失败了不该弹错误 */
  }
}

/** 历史消息。会话不存在（404）时返回空数组，而不是抛错 */
export async function fetchHistory(conversationId, userId, limit = 100) {
  if (DEMO) return demoFetchHistory(conversationId);
  try {
    const r = await getJson(
      `/messages?conversationId=${encodeURIComponent(conversationId)}&userId=${encodeURIComponent(userId)}&limit=${limit}`,
    );
    return r.messages ?? [];
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return [];
    throw e;
  }
}

/**
 * 流式聊天。
 *
 * 用 fetch + ReadableStream 而不是 EventSource：
 * EventSource 只支持 GET，而 /chat 需要 POST body。
 *
 * @param {object} p
 * @param {(event: string, data: object) => void} p.onFrame
 * @param {AbortSignal} [p.signal]
 */
export async function streamChat(
  {
    conversationId, userId, message, contactId, signal,
    viewingConversationId, regenerate,
  },
  onFrame,
) {
  // 演示模式
  if (DEMO) {
    // 填了自己的 API Key 就尝试真连官方接口；
    // 没填（或连接失败）退回内置数据，保证演示永远不白屏。
    const key = getApiKey();
    if (key) {
      const r = await tryRealStream({ key, message, signal }, onFrame, {
        conversationId, userId, contactId,
      });
      if (r.ok) return;

      // 真连失败 → 明确告诉用户原因，再退回演示数据。
      // 关键：不能假装成功。用户填了密钥却看到演示回答，
      // 却不知道是余额不足还是密钥错了，那才是最糟的体验。
      onFrame('notice', {
        text: `真实模型调用失败：${explainApiError(r.status, r.detail)}（已临时用演示回复顶上）`,
      });
    }
    return demoStreamChat({ message, signal, regenerate }, onFrame);
  }

  // 开发用假流：地址栏加 ?mock=reasoning 即可，不需要后端
  if (shouldMockReasoning()) {
    return mockReasoningStream({ message, contactId, signal }, onFrame);
  }

  const res = await fetch(apiUrl('/chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    // 注意这里是显式白名单：新增字段不写进来就永远到不了服务端，
    // 而且不会报错，只是"功能静默失效"。viewingConversationId 就这样
    // 漏过一次——未读计数的判据一直是空值。
    body: JSON.stringify({
      conversationId, userId, message, contactId,
      ...(viewingConversationId !== undefined ? { viewingConversationId } : {}),
      ...(regenerate !== undefined ? { regenerate } : {}),
    }),
    signal,
  });

  // 非 2xx 返回的是 JSON 错误体，不是 SSE。
  // 不单独处理的话会被当成 SSE 解析，得到一个空流，
  // 表现为「点了发送没反应」——排查成本很高。
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let code;
    try {
      const j = await res.json();
      msg = j.error ?? msg;
      code = j.code;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, { status: res.status, code });
  }
  if (!res.body) throw new ApiError('响应没有可读流', { status: res.status });

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let eventName = '';
  let dataLines = [];

  const dispatch = () => {
    if (dataLines.length === 0) {
      eventName = '';
      return;
    }
    const raw = dataLines.join('\n');
    dataLines = [];
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { text: raw };
    }
    onFrame(eventName || 'message', data);
    eventName = '';
  };

  const handleLine = (line) => {
    // 空行 = 一个事件结束
    if (line === '') return dispatch();
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    // ':' 开头是心跳注释，忽略
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 只处理到最后一个换行，剩下的半行留到下一块。
      // TCP 分片不保证一次就是完整行，不这样做会把 JSON 切坏。
      const lastNewline = buffer.lastIndexOf('\n');
      if (lastNewline === -1) continue;
      const chunk = buffer.slice(0, lastNewline);
      buffer = buffer.slice(lastNewline + 1);
      for (const line of chunk.split('\n')) handleLine(line);
    }
    // 流结束时可能有未以空行收尾的残留
    if (buffer.length) handleLine(buffer);
    dispatch();
  } finally {
    reader.cancel().catch(() => {});
  }
}
/* ──────────────────────────────────────────────
 * 深度思考假流（仅开发调试用）
 *
 * 后端当前是 deepseek-chat（V3），不产生 reasoning_content，
 * 所以思考面板的 UI 用假流验证。地址栏加 `?mock=reasoning` 开启，
 * 刷新或去掉参数即回到真实链路。
 * ────────────────────────────────────────────── */

const MOCK_QUERY_KEY = 'mock';

export function shouldMockReasoning() {
  if (typeof window === 'undefined') return false;
  const v = new URLSearchParams(window.location.search).get(MOCK_QUERY_KEY);
  return v === 'reasoning' || v === '1' || v === 'true';
}

const MOCK_THINKING = [
  '用户问的是「量子纠缠」。先拆解：这个概念的核心不是超光速通信，',
  '而是两个粒子组成的联合态无法分解成各自的独立态。',
  '常见的误解是「测量一个会影响另一个」，实际上相关信息',
  '必须通过经典信道传递才能解读，这就是贝尔不等式实验的意义。',
  '表达上要避免公式，用「一枚硬币的两半」这类比喻，但要说明比喻的局限。',
];

const MOCK_REPLY = [
  '量子纠缠可以这样理解：',
  '把两个粒子想象成一对分装两个信封的卡片，',
  '一张写红、一张写蓝。在打开信封前，你不知道哪个是哪个，',
  '但一旦看到其中一个，另一个的颜色就立即确定了。\n\n',
  '纠缠和这个比喻的区别在于：卡片的颜色在装封时就已经确定，',
  '而纠缠粒子的状态在测量前是真正未定的。',
  '实验（贝尔不等式检验）已经排除了「它们其实早就定好了」这种解释。\n\n',
  '要注意的是，这并不意味着能超光速传信息：',
  '你必须知道对方测量了什么、结果是什么，才能解读自己这一侧的观测，',
  '而这个知情过程最快也只能以光速完成。',
];

/**
 * 模拟一次带 reasoning_content 的流式响应。
 *
 * 帧顺序刻意做成和真实后端一致：
 *   ready → accepted → reasoning × n → delta × n → done
 */
function mockReasoningStream({ signal }, onFrame) {
  const total = MOCK_THINKING.length + MOCK_REPLY.length;

  return new Promise((resolve, reject) => {
    let i = 0;
    let thinking = '';
    let reply = '';

    const tick = () => {
      if (signal?.aborted) {
        cleanup();
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        return;
      }

      if (i >= total) {
        cleanup();
        onFrame('done', { text: reply, assistantMessageId: null });
        resolve();
        return;
      }

      if (i < MOCK_THINKING.length) {
        // 思考阶段：每 50ms 一片 reasoning
        const t = MOCK_THINKING[i];
        thinking += t;
        onFrame('reasoning', { text: t });
      } else {
        // 正文阶段：每 50ms 一片 content
        const t = MOCK_REPLY[i - MOCK_THINKING.length];
        reply += t;
        onFrame('delta', { text: t });
      }
      i += 1;
      timer = setTimeout(tick, 50);
    };

    let timer = setTimeout(() => {
      onFrame('ready', { conversationId: 'mock', userMessageId: null, contactId: 'mock' });
      onFrame('accepted', {});
      timer = setTimeout(tick, 50);
    }, 30);

    const cleanup = () => clearTimeout(timer);
  });
}


/**
 * 浏览器直连 DeepSeek 官方接口。
 *
 * 注意这是「尽力而为」：官方接口通常不放行浏览器跨域，
 * 所以大概率会失败。失败时返回 false，调用方退回演示数据，
 * 而不是把错误抛到界面上——演示过程不该被网络问题打断。
 *
 * 真正的生产用法是走网关（见 README），密钥由后端代持。
 */
async function tryRealStream({ key, message, signal }, onFrame, meta) {
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        stream: true,
        messages: [{ role: 'user', content: message }],
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      // 把 HTTP 状态和官方错误原文带出去。
      // 不同原因的处理完全不同：
      //   401 → 密钥填错
      //   402 → 余额不足（这正是「没额度就没回答」的真实原因）
      //   429 → 请求太频繁
      // 静默退回演示数据会让用户以为"AI 就只会说这几句"。
      let detail = '';
      try {
        const j = await res.json();
        detail = j?.error?.message || '';
      } catch {}
      return { ok: false, status: res.status, detail };
    }

    onFrame('ready', {
      conversationId: meta.conversationId || 'live',
      userMessageId: null,
      contactId: meta.contactId,
    });
    onFrame('accepted', {});

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let full = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE 以空行分隔事件
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const block of parts) {
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let json;
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
          }
          const delta = json.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.reasoning_content) {
            onFrame('reasoning', { text: delta.reasoning_content });
          }
          if (delta.content) {
            full += delta.content;
            onFrame('delta', { text: delta.content });
          }
        }
      }
    }

    if (!full) return false;

    // 与真后端一致：done 帧带完整正文，避免气泡被判定为空而删除
    onFrame('done', { text: full, assistantMessageId: null });
    return { ok: true };
  } catch (e) {
    if (e?.name === 'AbortError') throw e;   // 用户主动停止，不算失败
    return { ok: false, status: 0, detail: e?.message || '网络请求失败' };
  }
}

/** 把失败原因翻译成人话 */
function explainApiError(status, detail) {
  if (status === 401) return 'API 密钥无效，请检查是否填错或已失效。';
  if (status === 402) return '账户余额不足，无法调用模型。请到 DeepSeek 官网充值后重试。';
  if (status === 429) return '请求过于频繁，稍等一下再试。';
  if (status === 0) return `网络请求失败：${detail}`;
  return detail ? `接口返回 ${status}：${detail}` : `接口返回 ${status}。`;
}
