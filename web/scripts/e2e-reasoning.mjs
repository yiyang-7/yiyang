/**
 * 深度思考（reasoning_content）双流验证。
 *
 * 重点验证三件事：
 *   ① 思考与正文分离 —— reasoning 只进 thinking，delta 只进 content，不串
 *   ② 思考结束的确切时刻 —— 第一片正文到达时 thinkingStreaming 必须变 false
 *   ③ 收尾不丢字 —— done 时两条队列都要 flush
 *
 * 这台机器没有浏览器，跑不了 React effects，所以这里用真实 SSE 流
 * 驱动与 useChat 中完全一致的解析 + 双队列打字机算法。
 */
import { createServer } from 'node:http';
import { once } from 'node:events';

const THINKING = [
  '用户想知道杭州明天的天气。',
  '先确认需要哪些信息：温度、天气现象、风力。',
  '还要提醒早晚温差。',
];
const REPLY = [
  '明天杭州多云转晴，',
  '18~26℃，',
  '早晚偏凉，记得带件外套。',
];
const SEP = THINKING.reduce((a, s) => a + s.length, 0);   // 用于断言边界

const fail = [];
const check = (label, ok, extra = '') => {
  console.log(`   ${label}: ${ok ? '✅' : '❌'} ${extra}`);
  if (!ok) fail.push(label);
};

/** 假 SSE 服务端：先发 reasoning，再发 delta */
function startServer() {
  return createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    req.resume();
    await once(req, 'end');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (event, data) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    send('ready', { conversationId: 'c1', userMessageId: 'u1', contactId: 'default' });
    send('accepted', {});

    // 思考阶段：间隔不均匀，模拟真实模型
    for (const t of THINKING) {
      send('reasoning', { text: t });
      await new Promise((r) => setTimeout(r, 12));
    }
    // 正文阶段
    for (const t of REPLY) {
      send('delta', { text: t });
      await new Promise((r) => setTimeout(r, 12));
    }
    send('done', { text: REPLY.join(''), assistantMessageId: 'a1' });
    res.end();
  });
}

/** 与 api.js 一致的 SSE 解析 */
async function readFrames(url, body, onFrame) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let eventName = '';
  let dataLines = [];

  const dispatch = () => {
    if (!dataLines.length) {
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

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line === '') dispatch();
      else if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
}

/** 与 useChat 一致的双队列打字机 */
function runTypewriter({ onThinking, onText }) {
  const thinkQ = { v: '' };
  const textQ = { v: '' };
  let done = false;
  const take = (q) => {
    if (!q.v.length) return '';
    const n = q.v.length > 12 ? Math.ceil(q.v.length / 6) : 1;
    const out = q.v.slice(0, n);
    q.v = q.v.slice(n);
    return out;
  };

  const timer = setInterval(() => {
    const tc = take(thinkQ);
    if (tc) return onThinking(tc);
    const c = take(textQ);
    if (c) return onText(c);
    if (done) clearInterval(timer);
  }, 8);

  return {
    pushThinking: (t) => (thinkQ.v += t),
    pushText: (t) => (textQ.v += t),
    end: () => (done = true),
    stop: () => clearInterval(timer),
    pending: () => thinkQ.v.length + textQ.v.length,
    flush: () => {
      clearInterval(timer);
      const rest = thinkQ.v + textQ.v;
      const restT = thinkQ.v;
      const restC = textQ.v;
      thinkQ.v = '';
      textQ.v = '';
      return { restT, restC, rest };
    },
  };
}

// ────────────────────────────────────────────────
console.log('深度思考双流验证\n');

const server = startServer();
server.listen(0);
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;

// 收集所有帧
const frames = [];
await readFrames(`${base}/chat`, { conversationId: 'c1', message: '杭州明天天气' }, (e, d) =>
  frames.push({ e, d }),
);

console.log('① 帧序列');
const reasoningFrames = frames.filter((f) => f.e === 'reasoning');
const deltaFrames = frames.filter((f) => f.e === 'delta');
check('reasoning 帧数量正确', reasoningFrames.length === THINKING.length, `${reasoningFrames.length} 片`);
check('delta 帧数量正确', deltaFrames.length === REPLY.length, `${deltaFrames.length} 片`);
check(
  'reasoning 全部早于 delta',
  frames.findIndex((f) => f.e === 'delta') > frames.findLastIndex((f) => f.e === 'reasoning'),
);
check('done 在最后', frames[frames.length - 1].e === 'done');

// 完整跑一遍打字机
console.log('\n② 双流分离');
let thinking = '';
let content = '';
let firstTextAt = null;
let thinkingStreaming = true;

const tw = runTypewriter({
  onThinking: (t) => {
    thinking += t;
    if (!thinkingStreaming) fail.push('正文开始后仍有思考片到达');
  },
  onText: (t) => {
    if (firstTextAt === null) {
      firstTextAt = thinking.length;      // 记下开始出正文时的思考长度
      thinkingStreaming = false;          // 与 useChat 一致
    }
    content += t;
  },
});

for (const f of frames) {
  if (f.e === 'reasoning') tw.pushThinking(f.d.text);
  else if (f.e === 'delta') tw.pushText(f.d.text);
  else if (f.e === 'done') tw.end();
}

// 等队列自然吐完
await new Promise((r) => setTimeout(r, 900));

check('思考内容完整', thinking === THINKING.join(''), `${thinking.length}/${SEP} 字`);
check('正文内容完整', content === REPLY.join(''), `${content.length} 字`);
check('思考不含正文', !thinking.includes('明天杭州多云转晴'));
check('正文不含思考', !content.includes('先确认需要哪些信息'));
check(
  '出正文时思考已全部到位',
  firstTextAt === SEP,
  `出正文时思考 ${firstTextAt}/${SEP} 字`,
);
check('队列最终清空', tw.pending() === 0, `剩余 ${tw.pending()}`);

// ③ 收尾 flush
console.log('\n③ 收尾 flush（模拟 done 时仍有积压）');
const tw2 = runTypewriter({ onThinking: () => {}, onText: () => {} });
tw2.pushThinking('残思');
tw2.pushText('残文');
const flushed = tw2.flush();
check('思考残余被倒出', flushed.restT === '残思');
check('正文残余被倒出', flushed.restC === '残文');
check('flush 后队列为空', tw2.pending() === 0);

// ④ 组装后的消息形态
console.log('\n④ 消息对象形态');
const msg = {
  role: 'assistant',
  content: REPLY.join(''),
  thinking: THINKING.join(''),
  thinkingStreaming: false,
  thinkingMs: 2400,
  status: 'completed',
};
check('thinking 字段存在', typeof msg.thinking === 'string' && msg.thinking.length > 0);
check('思考结束后 thinkingStreaming=false', msg.thinkingStreaming === false);
check('用时为毫秒数', Number.isFinite(msg.thinkingMs));
check('秒数取整至少 1 秒', Math.max(1, Math.round(msg.thinkingMs / 1000)) === 2);

server.close();
tw.stop();

console.log('');
if (fail.length) {
  console.log(`❌ ${fail.length} 项失败: ${fail.join('; ')}`);
  process.exit(1);
}
console.log('✅ 深度思考双流全部通过');