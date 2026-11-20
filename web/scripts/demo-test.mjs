import { build } from 'vite';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const out = mkdtempSync(join(process.cwd(), '.ssr-demo-'));
// 退出时清掉临时目录，否则每跑一次就在项目里留一个几 MB 的残渣
process.on('exit', () => {
  try { rmSync(out, { recursive: true, force: true }); } catch {}
});
writeFileSync(join(out, 'entry.jsx'), `
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MessageBubble from '/src/components/MessageBubble.jsx';
import { demoFetchHistory, demoFetchSessions, demoFetchContacts, demoStreamChat } from '/src/services/demo.js';
export { demoStreamChat };
export const history = (id) => demoFetchHistory(id);
export const sessions = () => demoFetchSessions();
export const contacts = () => demoFetchContacts();
export function bubble(props) { return renderToStaticMarkup(MessageBubble(props)); }
`);

await build({
  root: process.cwd(),
  logLevel: 'error',
  ssr: { noExternal: ['@deepseek-ai/dsh-client-ui-primitives'] },
  build: {
    outDir: join(out, 'dist'),
    ssr: join(out, 'entry.jsx'),
    emptyOutDir: true,
    rollupOptions: { external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'] },
    write: true,
  },
});

const mod = await import(join(out, 'dist', 'entry.js'));

const contacts = mod.contacts();
console.log('联系人数:', contacts.length, '→', contacts.map(c => c.name).join(', '));

const sessions = mod.sessions();
console.log('会话数:', sessions.length);
sessions.forEach(s => console.log(`  ${s.title} | 未读 ${s.unread} | ${(s.conversationId)}`));

const h = mod.history('demo-code');
console.log('\ndemo-code 消息数:', h.length);
const aiMsg = h.find(m => m.role === 'assistant');
const html = mod.bubble({
  message: aiMsg,
  contactName: 'Codex',
  useLogo: true,
  showActions: true,
  onRegenerate: () => {},
});

const checks = [
  ['渲染出 <pre>/<code> 代码块', /<pre|<code/.test(html)],
  ['渲染出 <table> 表格', /<table/.test(html)],
  ['渲染出 markdown 标题', /<h[23]/.test(html)],
  ['渲染出粗体', /<strong|<b>/.test(html)],
  ['渲染出思考面板', /思考|thinking/.test(html)],
  ['渲染出重新生成按钮', html.includes('aria-label="重新生成"')],
  ['渲染出复制按钮', html.includes('aria-label="复制"')],
];
let fail = 0;
console.log('\n气泡渲染检查:');
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  if (!ok) fail++;
}
console.log('\nHTML 长度:', html.length);
// ── 假流验证 ────────────────────────────────────
console.log('\n假流检查:');

async function runStream(opts) {
  const frames = [];
  await mod.demoStreamChat(opts, (ev, data) => frames.push({ ev, data }));
  return frames;
}

// 1. 帧顺序
const frames = await runStream({ message: '你好', signal: undefined, regenerate: false });
const evs = [...new Set(frames.map(f => f.ev))];
const first = frames[0]?.ev, last = frames[frames.length - 1]?.ev;
const thinkIdx = frames.findIndex(f => f.ev === 'reasoning');
const deltaIdx = frames.findIndex(f => f.ev === 'delta');
console.log(`  ${first === 'ready' ? '✅' : '❌'} 首帧是 ready（实际 ${first}）`);
console.log(`  ${last === 'done' ? '✅' : '❌'} 末帧是 done（实际 ${last}）`);
console.log(`  ${thinkIdx >= 0 && thinkIdx < deltaIdx ? '✅' : '❌'} reasoning 在 delta 之前（思考→正文）`);
console.log(`  ${frames.filter(f => f.ev === 'reasoning').length > 0 ? '✅' : '❌'} 有 reasoning 帧`);
console.log(`  ${frames.filter(f => f.ev === 'delta').length > 0 ? '✅' : '❌'} 有 delta 帧`);

// 2. 内容拼起来有意义
const full = frames.filter(f => f.ev === 'delta').map(f => f.data.text).join('');
console.log(`  ${full.length > 20 ? '✅' : '❌'} 正文长度 ${full.length}`);

// 3. 关键词路由
const codeOut = (await runStream({ message: '帮我写段代码', regenerate: false }))
  .filter(f => f.ev === 'delta').map(f => f.data.text).join('');
console.log(`  ${/```/.test(codeOut) ? '✅' : '❌'} 问代码时返回代码块`);

const emoOut = (await runStream({ message: '今天好累', regenerate: false }))
  .filter(f => f.ev === 'delta').map(f => f.data.text).join('');
console.log(`  ${/我在/.test(emoOut) ? '✅' : '❌'} 情绪表达走安抚分支`);

// 4. 重新生成内容不同
const regenOut = (await runStream({ message: '你好', regenerate: true }))
  .filter(f => f.ev === 'delta').map(f => f.data.text).join('');
console.log(`  ${regenOut !== full ? '✅' : '❌'} 重新生成的内容与首次不同`);

// 5. abort
const ctrl = new AbortController();
let aborted = false;
setTimeout(() => ctrl.abort(), 400);
try {
  await mod.demoStreamChat({ message: '你好', signal: ctrl.signal, regenerate: false }, () => {});
} catch (e) {
  aborted = e.name === 'AbortError';
}
console.log(`  ${aborted ? '✅' : '❌'} 中途 abort 抛出 AbortError`);

// 6. 新会话进侧栏
const after = mod.sessions();
console.log(`  ${after.some(s => s.conversationId === 'demo-live') ? '✅' : '❌'} 发过消息后侧栏出现新会话（共 ${after.length} 个）`);

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
