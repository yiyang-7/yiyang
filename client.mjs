/**
 * DSH Chat 客户端
 *
 * 职责只有三件：发消息、收流式响应、展示气泡。
 * 不感知 Harness、不 spawn 进程、不碰历史库——那些都在服务端。
 *
 * 用法：
 *   node client.mjs                         交互模式（多轮）
 *   node client.mjs "你的问题"               单轮
 *   node client.mjs --user u1 --conv c1     指定身份与会话
 */

import { createInterface } from 'node:readline';

// ── 参数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let userId = process.env.DSH_CHAT_USER ?? 'user-demo';
let conversationId = process.env.DSH_CHAT_CONV ?? `conv-${Date.now().toString(36)}`;
let baseUrl = (process.env.DSH_CHAT_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const words = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--user') userId = argv[++i];
  else if (a === '--conv') conversationId = argv[++i];
  else if (a === '--url') baseUrl = argv[++i].replace(/\/$/, '');
  else words.push(a);
}

// ── 终端宽度与中文对齐 ──────────────────────────────────────────────────
const WIDTH = Math.min(process.stdout.columns || 80, 96);
const INNER = WIDTH - 4; // "│ " + 内容 + " │" 的可用宽度

/** CJK / 全角字符占两列。 */
function charWidth(ch) {
  const c = ch.codePointAt(0);
  if (
    (c >= 0x1100 && c <= 0x115f)
    || (c >= 0x2e80 && c <= 0xa4cf)
    || (c >= 0xac00 && c <= 0xd7a3)
    || (c >= 0xf900 && c <= 0xfaff)
    || (c >= 0xfe30 && c <= 0xfe6f)
    || (c >= 0xff00 && c <= 0xff60)
    || (c >= 0xffe0 && c <= 0xffe6)
    || (c >= 0x1f300 && c <= 0x1f64f)
    || (c >= 0x20000 && c <= 0x3fffd)
  ) return 2;
  return 1;
}

function strWidth(s) {
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w;
}

/** 按显示宽度折行，保留原有换行。 */
function wrap(text, limit = INNER) {
  const out = [];
  for (const rawLine of String(text).split('\n')) {
    if (rawLine === '') { out.push(''); continue; }
    let line = '';
    let w = 0;
    for (const ch of rawLine) {
      const cw = charWidth(ch);
      if (w + cw > limit) { out.push(line); line = ''; w = 0; }
      line += ch;
      w += cw;
    }
    out.push(line);
  }
  return out;
}

// ── 气泡 ────────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
};

function rule(label, color) {
  const head = `─ ${label} `;
  const fill = Math.max(0, WIDTH - strWidth(head) - 1);
  return `${color}╭${head}${'─'.repeat(fill)}╮${C.reset}`;
}

function bottom(color) {
  return `${color}╰${'─'.repeat(WIDTH - 2)}╯${C.reset}`;
}

function bodyLine(content, color) {
  const pad = Math.max(0, INNER - strWidth(content));
  return `${color}│${C.reset} ${content}${' '.repeat(pad)} ${color}│${C.reset}`;
}

/** 一次性气泡（用户消息、错误提示）。 */
function printBubble(label, text, color) {
  console.log(rule(label, color));
  for (const line of wrap(text)) console.log(bodyLine(line, color));
  console.log(bottom(color));
}

/** 流式气泡：先开框，边收边写，结束再封底。 */
function openStreamBubble(label, color) {
  console.log(rule(label, color));
  let buffer = '';       // 尚未输出的部分
  let wrote = false;

  return {
    push(chunk) {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        emitWrapped(line);
      }
      // 行内超宽也要即时折行，否则会溢出边框
      while (strWidth(buffer) >= INNER) {
        let take = '';
        let w = 0;
        for (const ch of buffer) {
          const cw = charWidth(ch);
          if (w + cw > INNER) break;
          take += ch; w += cw;
        }
        console.log(bodyLine(take, color));
        buffer = buffer.slice(take.length);
        wrote = true;
      }
    },
    close() {
      if (buffer.length) emitWrapped(buffer);
      if (!wrote) console.log(bodyLine('', color));
      console.log(bottom(color));
    },
    get empty() { return !wrote && buffer.length === 0; },
  };

  function emitWrapped(line) {
    for (const l of wrap(line)) {
      console.log(bodyLine(l, color));
      wrote = true;
    }
  }
}

// ── SSE 解析 ────────────────────────────────────────────────────────────
async function* readSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      let event = 'message';
      const dataLines = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith(':')) continue;          // 心跳
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      let data;
      try { data = JSON.parse(dataLines.join('\n')); } catch { data = dataLines.join('\n'); }
      yield { event, data };
    }
  }
}

// ── 发送一轮 ────────────────────────────────────────────────────────────
async function sendTurn(message) {
  printBubble(`你 · ${userId}`, message, C.cyan);

  let res;
  try {
    res = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ userId, conversationId, message }),
    });
  } catch (err) {
    printBubble('错误', `连不上服务端 ${baseUrl}：${err.message}`, C.red);
    return false;
  }

  if (!res.ok || !res.body) {
    printBubble('错误', `HTTP ${res.status}：${await res.text().catch(() => '')}`, C.red);
    return false;
  }

  let bubble = null;
  const stopStream = () => { if (bubble) { bubble.close(); bubble = null; } };

  for await (const { event, data } of readSse(res.body)) {
    switch (event) {
      case 'delta':
        if (!bubble) bubble = openStreamBubble('助手', C.green);
        bubble.push(data.text);
        break;

      case 'done':
        stopStream();
        if (data.historyReplayed) {
          console.log(`${C.dim}(服务端回灌了 ${data.historyReplayed} 条历史)${C.reset}`);
        }
        return true;

      case 'error':
        stopStream();
        printBubble('错误', `${data.stage ? data.stage + ': ' : ''}${data.message}`
          + (data.code ? `\n(code=${data.code})` : ''), C.red);
        return false;

      case 'ready':
        if (process.env.DSH_VERBOSE) {
          console.log(`${C.dim}[ready] ${data.conversationId} 历史=${data.historyReplayed ?? 0}${C.reset}`);
        }
        break;

      case 'accepted':
        if (process.env.DSH_VERBOSE) console.log(`${C.dim}[accepted] ${data.messageId}${C.reset}`);
        break;

      case 'status':
        if (process.env.DSH_VERBOSE) console.log(`${C.dim}[status] ${data.status}${C.reset}`);
        break;

      default:
        if (process.env.DSH_VERBOSE) console.log(`${C.dim}[${event}]${C.reset}`);
    }
  }
  stopStream();
  return true;
}

// ── 主流程 ──────────────────────────────────────────────────────────────
async function main() {
  const once = words.join(' ');

  if (once) {
    const ok = await sendTurn(once);
    process.exit(ok ? 0 : 1);
  }

  console.log(`${C.dim}DSH Chat · ${baseUrl} · 用户=${userId} 会话=${conversationId}${C.reset}`);
  console.log(`${C.dim}输入内容回车发送，/exit 退出，/new 换会话${C.reset}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  const loop = () => new Promise((resolve) => {
    rl.question(`${C.bold}›${C.reset} `, resolve);
  });

  while (true) {
    let line;
    try { line = await loop(); } catch { break; }
    const msg = line.trim();
    if (!msg) continue;
    if (msg === '/exit' || msg === '/quit') break;
    if (msg === '/new') {
      conversationId = `conv-${Date.now().toString(36)}`;
      console.log(`${C.dim}新会话：${conversationId}${C.reset}\n`);
      continue;
    }
    await sendTurn(msg);
    console.log('');
  }

  rl.close();
}

main().catch((err) => {
  console.error(`${C.red}✘ ${err.message}${C.reset}`);
  process.exit(1);
});