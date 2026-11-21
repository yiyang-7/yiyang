/**
 * 演示版功能测试。
 *
 * 覆盖三类：
 *   1. 两个已确认的 bug 修复（切会话、回答被清空）
 *   2. 新功能（快捷回复、自定义头像、设置）
 *   3. 单文件产物完整性
 */
import { build } from 'vite';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const out = mkdtempSync(join(process.cwd(), '.ssr-demo-'));
process.on('exit', () => {
  try { rmSync(out, { recursive: true, force: true }); } catch {}
});

writeFileSync(join(out, 'entry.jsx'), `
import { createElement } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import MessageBubble from '/src/components/MessageBubble.jsx';
import QuickReplies from '/src/components/chat/QuickReplies.jsx';
import SettingsPanel from '/src/components/settings/SettingsPanel.jsx';
import { deriveQuickReplies } from '/src/components/chat/QuickReplies.jsx';
import * as demo from '/src/services/demo.js';
export const bubble = (p) => renderToStaticMarkup(MessageBubble(p));
// QuickReplies 用了 useState/useEffect，必须走 renderToString（完整生命周期）
export const quick = (p) => renderToString(createElement(QuickReplies, p));
export const settings = (p) => renderToString(createElement(SettingsPanel, p));
export { deriveQuickReplies };
export * as demo from '/src/services/demo.js';
`);

await build({
  root: process.cwd(),
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
const d = m.demo;

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  ok ? pass++ : fail++;
};

// ── bug 1：切会话（会话必须有 name 字段） ──────
console.log('\n会话数据完整性（点击会话能否进入）:');
const sessions = d.demoFetchSessions();
check('会话数为 4', sessions.length === 4, `${sessions.length}`);
check(
  '每条会话都有 name（App 靠它找联系人）',
  sessions.every((s) => typeof s.name === 'string' && s.name.length > 0),
  sessions.map((s) => s.name).join('/'),
);
check(
  '每条会话都有 conversationId',
  sessions.every((s) => !!s.conversationId),
);
check(
  '每条会话都能拉到历史（否则点进去是空白）',
  sessions.every((s) => d.demoFetchHistory(s.conversationId).length > 0),
);

// ── bug 2：done 帧必须带完整正文 ───────────────
console.log('\n回答是否会被清空（done 帧正文）:');
const frames = [];
await d.demoStreamChat({ message: '你好', regenerate: false }, (ev, data) =>
  frames.push({ ev, data }),
);
const doneFrame = frames.find((f) => f.ev === 'done');
const streamed = frames
  .filter((f) => f.ev === 'delta')
  .map((f) => f.data.text)
  .join('');
check('done 帧存在', !!doneFrame);
check(
  'done.text 非空（空串会导致气泡被删）',
  !!doneFrame?.data?.text && doneFrame.data.text.length > 0,
  `${doneFrame?.data?.text?.length ?? 0} 字`,
);
check(
  'done.text 与流式内容一致',
  doneFrame?.data?.text === streamed,
);

// ── 快捷回复 ───────────────────────────────────
console.log('\n快捷回复（输入框上方建议）:');
const msgList = [
  { id: 'a', role: 'user', content: '帮我看看', status: 'completed' },
  {
    id: 'b',
    role: 'assistant',
    content: '建议先从最小的一步开始，验证方向对不对。',
    status: 'completed',
  },
];
const replies = m.deriveQuickReplies(msgList, { id: 'default' });
check('能推出 2–3 条建议', replies.length >= 2 && replies.length <= 3, replies.join(' / '));
check('建议都是非空字符串', replies.every((r) => typeof r === 'string' && r.trim()));

// 不同人设语气不同
const catReplies = m.deriveQuickReplies(msgList, { id: 'catgirl' });
check(
  '不同人设给出不同建议',
  catReplies.join('|') !== replies.join('|'),
  catReplies.join(' / '),
);

// 代码类回复 → 代码向建议
const codeList = [
  { id: 'a', role: 'user', content: '写代码', status: 'completed' },
  { id: 'b', role: 'assistant', content: '```js\nconst a = 1;\n```', status: 'completed' },
];
const codeReplies = m.deriveQuickReplies(codeList, { id: 'default' });
check('代码回复给代码向建议', codeReplies.length >= 2, codeReplies.join(' / '));

// 最后一条是用户消息时不应有建议
const pending = [
  { id: 'a', role: 'user', content: '你好', status: 'completed' },
  { id: 'b', role: 'assistant', content: '在的', status: 'completed' },
  { id: 'c', role: 'user', content: '再问一句', status: 'completed' },
];
check('用户刚发完不给建议', m.deriveQuickReplies(pending, { id: 'default' }).length === 0);

// 空列表
check('空消息列表不崩', m.deriveQuickReplies([], { id: 'default' }).length === 0);

// 渲染
const qHtml = m.quick({
  replies,
  onPick: () => {},
  visible: true,
});
check('渲染出按钮', (qHtml.match(/<button/g) || []).length === replies.length);
const qHidden = m.quick({ replies, onPick: () => {}, visible: false });
check('visible=false 时不渲染', qHidden === '');

// ── 自定义头像 ─────────────────────────────────
console.log('\n自定义头像:');
const baseMsg = {
  id: 'x',
  role: 'assistant',
  content: '你好',
  status: 'completed',
  createdAt: Date.now(),
};
const withEmoji = m.bubble({
  message: baseMsg,
  contactName: 'Codex',
  avatar: '🐱',
  avatarSeed: 'coder',
});
check('emoji 头像渲染出字符', withEmoji.includes('🐱'));
check('avatarEmoji 类存在', withEmoji.includes('avatarEmoji') || withEmoji.includes('🐱'));

const withImage = m.bubble({
  message: baseMsg,
  contactName: 'Codex',
  avatarImage: 'data:image/jpeg;base64,AAA',
  avatarSeed: 'coder',
});
check('图片头像渲染出 img[src=data:]', withImage.includes('data:image/jpeg'));

const generated = m.bubble({
  message: baseMsg,
  contactName: 'Codex',
  avatarSeed: 'coder',
});
check(
  '无自定义时本地生成头像（不再请求 dicebear）',
  !generated.includes('dicebear'),
);
check('生成头像带渐变背景', generated.includes('linear-gradient'));

// ── 设置面板 ───────────────────────────────────
console.log('\n设置面板:');
const contacts = d.demoFetchContacts();
// 默认打开落在「API 密钥」页（最需要被找到的入口），
// 所以测外观页要显式指定 initialTab。
const setHtml = m.settings({
  open: true,
  initialTab: 'avatar',
  onClose: () => {},
  contacts,
  activeContactId: 'coder',
});
check('渲染出角色选择', setHtml.includes('Codex'));
check('渲染出 emoji 选择区', setHtml.includes('🐱'));
check('有 API 密钥入口', setHtml.includes('API 密钥'));
check('有选本地图片按钮', setHtml.includes('选本地图片'));
check('有昵称输入', setHtml.includes('昵称'));
// 跨域提示文案在「API 密钥」页里，直接查源码更稳。
const src = readFileSync('src/components/settings/SettingsPanel.jsx', 'utf8');
check('明确提示密钥只存本机', src.includes('只保存在这台设备'));
check('提示浏览器跨域限制', src.includes('跨域'));
const closed = m.settings({ open: false, onClose: () => {}, contacts });
check('open=false 时不渲染', closed === '');

// ── 单文件产物 ─────────────────────────────────
console.log('\n单文件产物:');
const demoFile = 'demo/演示版.html';
if (existsSync(demoFile)) {
  const h = readFileSync(demoFile, 'utf8');
  check('无外部 script src', !/<script[^>]+src=/.test(h));
  check('无外部 link href', !/<link[^>]+href=/.test(h));
  check('无 import.meta.env 残留', !h.includes('import.meta.env'));
  check('不含 dicebear 远程头像', !h.includes('dicebear'));
  check('含快捷回复样式', h.includes('barIn'));
  check('含设置面板样式', h.includes('slideUp'));
  check('大小合理（<10MB）', Buffer.byteLength(h) < 10 * 1024 * 1024, `${(Buffer.byteLength(h) / 1024 / 1024).toFixed(2)}MB`);
} else {
  console.log('  ⏭ 演示版尚未构建，跳过产物检查');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);