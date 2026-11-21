/**
 * 历史回显端到端验证。
 *
 * 前面几套测试各自覆盖了一段：
 *   render-app   用**手写的假消息对象**渲染气泡
 *   npm test     验证后端**入库与接口**
 * 但两者的接缝没人测——数据库里的真实行，经接口出去，喂进气泡组件，
 * 字段名一旦对不上（thinking vs reasoning、thinkingMs vs thinking_ms），
 * 上面两套测试都会绿，界面上却是空面板。
 *
 * 这里补上的正是那段：真 SQLite → 真 HTTP → 真组件 SSR。
 */
import { build } from 'vite';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';

const ROOT = process.cwd();
const out = mkdtempSync(join(ROOT, '.e2e-'));
const fail = [];
const check = (label, ok, extra = '') => {
  console.log(`   ${label}: ${ok ? '✅' : '❌'} ${extra}`);
  if (!ok) fail.push(label);
};

// ── 造一个真的库，写进真数据 ────────────────────
const { HistoryStore } = await import('../../lib/history-store.mjs');
const { mountChat } = await import('../../lib/chat-route.mjs');

const history = new HistoryStore(':memory:');
history.ensureConversation({ conversationId: 'conv-1', userId: 'u1', contactId: 'catgirl' });

history.appendMessage({
  conversationId: 'conv-1',
  role: 'user',
  content: '帮我看看这段代码',
  createdAt: 1000,
});

// 一条带思考的助手回复：思考正文 + 耗时都要能原样回来
history.appendMessage({
  conversationId: 'conv-1',
  role: 'assistant',
  content: '这段代码有两个问题：\n\n1. 数组越界\n2. 没关句柄',
  thinking: '先看循环边界。\n上界用了 <=，会越界一位。\n句柄在异常路径漏了。',
  thinkingMs: 7400,
  createdAt: 2000,
});

// 一条没思考的普通回复：不能凭空长出面板
history.appendMessage({
  conversationId: 'conv-1',
  role: 'assistant',
  content: '另外建议加个单元测试。',
  createdAt: 3000,
});

// ── 通过真 HTTP 取回来 ──────────────────────────
const app = express();
app.use(express.json());
mountChat(app, { history, contacts: null, getProcess: async () => { throw new Error('不该被调用'); } });

const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const { port } = server.address();

const res = await fetch(`http://127.0.0.1:${port}/messages?conversationId=conv-1&userId=u1`);
const payload = await res.json();

// ── 用真实返回的行渲染真组件 ────────────────────
writeFileSync(join(out, 'entry.jsx'), `
import { renderToStaticMarkup } from 'react-dom/server';
import MessageBubble from '/src/components/MessageBubble.jsx';
export function bubble(message) {
  return renderToStaticMarkup(MessageBubble({
    message, contactName: '傲娇猫娘', useLogo: true,
  }));
}
`);

await build({
  root: ROOT,
  logLevel: 'error',
  ssr: { noExternal: ['@deepseek-ai/dsh-client-ui-primitives'] },
  build: {
    ssr: join(out, 'entry.jsx'),
    outDir: join(out, 'dist'),
    emptyOutDir: true,
    rollupOptions: { external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'] },
  },
});

const m = await import(join(out, 'dist', 'entry.js'));
const html = payload.messages.map((msg) => m.bubble(msg));

console.log('\n① 接口返回');
check('三条消息', payload.messages.length === 3, `${payload.messages.length} 条`);
check('按时间正序', payload.messages[0].role === 'user', payload.messages.map((r) => r.role).join(' → '));
check('带 thinking 字段', 'thinking' in payload.messages[1]);
check('带 thinkingMs 字段', 'thinkingMs' in payload.messages[1]);
check('思考正文完整', payload.messages[1].thinking.includes('上界用了 <='));
check('耗时原样返回', payload.messages[1].thinkingMs === 7400, `${payload.messages[1].thinkingMs}ms`);

console.log('\n② 气泡渲染（真数据 → 真组件）');
check('用户消息在右侧绿泡', html[0].includes('rowUser') || html[0].includes('bubbleRight'),
  html[0].match(/_row_[a-z0-9]+_\d+ \S*/)?.[0] ?? '');
check('用户正文原样显示', html[0].includes('帮我看看这段代码'));
check('用户消息不解析 Markdown', !html[0].includes('<ol'));

check('助手消息在左侧白泡', html[1].includes('bubbleLeft'));
check('助手正文走 Markdown', html[1].includes('<ol'), '有序列表被渲染');
check('助手有自己的 Logo', html[1].includes('aria-label="lume"'));

console.log('\n③ 思考面板随数据出现');
check('带思考的消息有面板', html[1].includes('data-disclosure-row="true"'));
check('标题含真实耗时', html[1].includes('已深度思考（用时 7 秒）'),
  html[1].match(/已深度思考[^<]*/)?.[0] ?? '');
check('历史默认折叠', html[1].includes('aria-expanded="false"'));
check('折叠时不渲染思考正文', !html[1].includes('上界用了 <='));

check('无思考的消息没有面板', !html[2].includes('data-disclosure-row'));
check('无思考消息正文正常', html[2].includes('另外建议加个单元测试'));

server.close();
history.close();
rmSync(out, { recursive: true, force: true });

console.log(fail.length ? `\n❌ ${fail.length} 项失败: ${fail.join(', ')}` : '\n✅ 历史回显端到端通过');
process.exit(fail.length ? 1 : 0);