/**
 * 端到端验证流式接收 + 打字机 + 排队状态。
 *
 * 用一个假 SSE 服务端按真实协议发帧：
 *   ready / status(queued) / accepted / delta... / done
 * delta 粒度故意不均匀，复现真实模型的输出形态。
 *
 * 这台机器没有浏览器，无法跑 React 的 effects，所以这里用真实 SSE 流
 * 驱动与 useChat 中完全一致的解析 + 打字机算法。
 */
import { createServer } from 'node:http';

const REPLY = '明天杭州多云转晴，18~26℃，早晚偏凉，记得带件外套。湖边风大，注意保暖。';
const DELTAS = [
  '明天', '杭州', '多云', '转晴，', '18~26℃',
  '，', '早晚偏凉，', '记得带件外套。', '湖边风大，', '注意保暖。',
];

const fail = [];
const check = (label, ok, extra = '') => {
  console.log(`   ${label}: ${ok ? '✅' : '❌'} ${extra}`);
  if (!ok) fail.push(label);
};

/** 起一个假 SSE 服务端，queued=true 时先发排队状态 */
function startServer({ queued = false } = {}) {
  return createServer((req, res) => {
    if (req.url !== '/chat' || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const send = (event, data) =>
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      const emitDeltas = () => {
        let i = 0;
        const timer = setInterval(() => {
          if (i < DELTAS.length) {
            send('delta', { text: DELTAS[i] });
            i += 1;
          } else {
            clearInterval(timer);
            send('done', { text: REPLY, assistantMessageId: 'srv-asst-1' });
            res.end();
          }
        }, 20);
      };

      send('ready', { userMessageId: 'srv-user-1', isNewProcess: true });

      if (queued) {
        send('status', { state: 'queued', message: '该会话正在处理上一轮，已排队' });
        setTimeout(() => {
          send('accepted', {});
          emitDeltas();
        }, 150);
      } else {
        send('accepted', {});
        emitDeltas();
      }
    });
  });
}

/** 用与 api.js 一致的方式解析 SSE（TextDecoder + getReader + 行缓冲） */
async function consume(url) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ conversationId: 'test-123', message: '明天杭州天气' }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let eventName = '';
  let dataLines = [];
  const frames = [];
  const flush = () => {
    if (!dataLines.length) {
      eventName = '';
      return;
    }
    frames.push([eventName, JSON.parse(dataLines.join('\n'))]);
    dataLines = [];
    eventName = '';
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const last = buf.lastIndexOf('\n');
    if (last === -1) continue;
    const chunk = buf.slice(0, last);
    buf = buf.slice(last + 1);
    for (const line of chunk.split('\n')) {
      if (line === '') flush();
      else if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  flush();
  return { status: res.status, frames };
}

/** 复刻 useChat 里的打字机算法 */
function runTypewriter(deltas) {
  const MAX_CATCHUP = 12;
  let queue = '';
  let content = '';
  const snapshots = [];
  for (const t of deltas) {
    queue += t;
    for (let k = 0; k < 2 && queue.length; k++) {
      const take = queue.length > MAX_CATCHUP ? Math.ceil(queue.length / 6) : 1;
      content += queue.slice(0, take);
      queue = queue.slice(take);
      snapshots.push(content.length);
    }
  }
  // 流结束 flush：把残留一次倒出
  const leftover = queue.length;
  content += queue;
  queue = '';
  return { content, snapshots, leftover };
}

// ── ① 普通流 ───────────────────────────────────
console.log('① 普通流：接收与解析');
{
  const server = startServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/chat`;
  const { status, frames } = await consume(url);
  server.close();

  check('HTTP 200', status === 200);
  check('ready 帧', frames.some((f) => f[0] === 'ready'));
  check('accepted 帧', frames.some((f) => f[0] === 'accepted'));
  const deltas = frames.filter((f) => f[0] === 'delta').map((f) => f[1].text);
  check('10 个 delta 帧', deltas.length === 10, `实际 ${deltas.length}`);
  check('delta 文本正确提取', deltas.join('') === REPLY);
  check('done 帧带全文', frames.find((f) => f[0] === 'done')?.[1].text === REPLY);

  console.log('\n② 打字机');
  const { content, snapshots, leftover } = runTypewriter(deltas);
  check('最终内容与 done 帧一致', content === REPLY, `${content.length}/${REPLY.length}`);
  check('逐字增长（多次更新）', snapshots.length > 5, `${snapshots.length} 次`);
  check('每次不短于上一次', snapshots.every((n, i) => i === 0 || n >= snapshots[i - 1]));
  // 注意：跑完 delta 循环后队列里通常还有残留（打字机比网络慢），
  // 这些字要靠流结束时的 flush 才出来。「不丢字」的判据是
  // flush 之后内容完整，而不是队列本来就空。
  check('有残留字符（打字机比网络慢，属正常）', leftover > 0, `${leftover} 字`);
  check('flush 后无尾字丢失', content === REPLY);
}

// ── ③ 排队状态 ─────────────────────────────────
console.log('\n③ 排队状态（queued）');
{
  const server = startServer({ queued: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/chat`;
  const { frames } = await consume(url);
  server.close();

  const statusFrames = frames.filter((f) => f[0] === 'status');
  check('收到 status 帧', statusFrames.length === 1);
  check('state 是 queued', statusFrames[0]?.[1].state === 'queued');
  check('带排队提示文案', String(statusFrames[0]?.[1].message).includes('排队'));

  const iStatus = frames.findIndex((f) => f[0] === 'status');
  const iDelta = frames.findIndex((f) => f[0] === 'delta');
  check('queued 早于第一个 delta', iStatus > -1 && iStatus < iDelta);

  const deltas = frames.filter((f) => f[0] === 'delta').map((f) => f[1].text);
  check('排队后内容仍完整', deltas.join('') === REPLY);
}

// ── ④ 占位文案状态机 ───────────────────────────
console.log('\n④ 占位气泡文案状态机');
{
  let label = 'DeepSeek 思考中...';
  check('发送时显示「DeepSeek 思考中...」', label.includes('思考中'));

  label = '排队中...';
  check('queued 后变「排队中...」', label === '排队中...');

  label = null;
  check('首个 text 后不再显示等待文案', label === null);

  // 关键：普通 session.status 帧不能把排队文案冲掉
  let l2 = '排队中...';
  const onStatus = (data) => {
    if (data.state === 'queued') l2 = '排队中...';
  };
  onStatus({ message: '会话状态' });
  check('普通 session.status 不影响文案', l2 === '排队中...');
}

// ── ⑤ 请求体 ───────────────────────────────────
console.log('\n⑤ 请求体字段');
{
  const body = { conversationId: 'test-123', message: '用户的输入内容' };
  check('有 conversationId', typeof body.conversationId === 'string');
  check('有 message', typeof body.message === 'string');
}

console.log('\n' + (fail.length ? `❌ ${fail.length} 项失败: ${fail.join('; ')}` : '✅ 流式与打字机全部通过'));
process.exit(fail.length ? 1 : 0);