/**
 * SSR 渲染重构后的界面，核对 DeepSeek 主框架 + 微信气泡的各项要求。
 *
 * 没有浏览器可截图，但 SSR 能证明 DOM 结构与需求一致。
 */
import { build } from 'vite';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = `
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatShort } from '/src/components/sidebar/SidebarContent.jsx';
import ChatInput from '/src/components/deepseek/ChatInput.jsx';
import Sidebar from '/src/components/sidebar/Sidebar.jsx';
import MessageBubble from '/src/components/MessageBubble.jsx';
import HistorySkeleton from '/src/components/chat/HistorySkeleton.jsx';
import * as icons from '/src/components/deepseek/icons.jsx';

export const iconNames = Object.keys(icons);
export { formatShort };
export const skeleton = (p = {}) => renderToStaticMarkup(HistorySkeleton(p));
const noop = () => {};
// 侧栏需要真实渲染才能验证未读红点是否存在（源码里写了不等于渲染出来）
// 必须走 createElement：直接调用组件函数会绕过 React 的 hooks 上下文，
// Sidebar 内部用了 useEffect，当普通函数调就会报 useRef/useEffect 为 null。
export const sidebar = (p = {}) =>
  renderToStaticMarkup(createElement(Sidebar, { open: true, onClose: noop, ...p }));
export function bubble(props) { return renderToStaticMarkup(MessageBubble(props)); }
`;

const out = mkdtempSync(join(process.cwd(), '.ssr-'));
writeFileSync(join(out, 'entry.jsx'), entry);

// 这里渲染的是**真实的**官方 primitives 组件，不再打桩——
// 打桩会让断言失去意义（桩永远不会暴露官方的真实 DOM 结构）。
// 代价是官方包内部 import .css，需要在下面用 noExternal 让 Vite 内联处理。

await build({
  root: process.cwd(),
  logLevel: 'error',
  plugins: [],
  // 官方包内部 import .css，SSR 外部化后 Node 直接加载会报
  // ERR_UNKNOWN_FILE_EXTENSION。让 Vite 内联处理（SSR 下导出的样式表为空对象，
  // 不影响类名访问）。
  ssr: { noExternal: ['@deepseek-ai/dsh-client-ui-primitives'] },
  build: {
    ssr: join(out, 'entry.jsx'),
    outDir: join(out, 'dist'),
    emptyOutDir: true,
    rollupOptions: { external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'] },
  },
});

const m = await import(pathToFileURL(join(out, 'dist', 'entry.js')).href);
const fail = [];
const check = (label, ok, extra = '') => {
  console.log(`   ${label}: ${ok ? '✅' : '❌'} ${extra}`);
  if (!ok) fail.push(label);
};

// ── 1. 输入区用 hooks，SSR 渲染不了，改查源码 + 已渲染的图标 ──
console.log('① 输入区功能按钮（源码核对）');
const inputSrc = readFileSync('src/components/deepseek/ChatInput.jsx', 'utf8');
check('深度思考 (R1) 开关', inputSrc.includes('深度思考 (R1)'));
check('联网搜索 开关', inputSrc.includes('联网搜索'));
check('附件图标按钮', inputSrc.includes('上传附件'));
check('语音输入图标按钮', inputSrc.includes('语音输入'));
check('发送按钮', inputSrc.includes('aria-label="发送"'));
check('停止按钮', inputSrc.includes('停止生成'));
check('有多行 textarea', inputSrc.includes('<textarea'));
check('开关用 aria-pressed 表达状态', inputSrc.includes('aria-pressed={deepThink}') && inputSrc.includes('aria-pressed={webSearch}'));
check('未接入的开关有悬停说明', inputSrc.includes('未接入') && inputSrc.includes('title='));
check('开启态有独立样式', inputSrc.includes('toggleOn'));

// ── 2. 侧边栏（源码核对） ──────────────────────
console.log('\n② 侧边栏（源码核对）');
// 外壳在 Sidebar.jsx，内容已拆到 SidebarContent.jsx
const sbSrc = readFileSync('src/components/sidebar/Sidebar.jsx', 'utf8');
const sbContent = readFileSync('src/components/sidebar/SidebarContent.jsx', 'utf8');

check('外壳渲染 SidebarContent', sbSrc.includes('<SidebarContent'));
check('关闭时不渲染', sbSrc.includes('if (!open) return null'));
check('ESC 关闭', sbSrc.includes("e.key === 'Escape'"));
check('遮罩点击关闭', sbSrc.includes('onClick={onClose}'));
check('打开时锁背景滚动', sbSrc.includes('body.style.overflow'));

check('DeepSeek 品牌名', sbContent.includes('DeepSeek'));
check('开启新对话按钮', sbContent.includes('开启新对话'));
check('历史对话分组标题', sbContent.includes('历史对话'));
check('空态提示', sbContent.includes('还没有历史对话'));
check('渲染会话列表', sbContent.includes('sessions.map'));
check('当前会话高亮', sbContent.includes('itemActive'));
check('标题优先于最后消息', sbContent.includes('s.title || s.lastMessage'));

// 人设切换：每个 AI 一个入口
check('渲染人设列表', sbContent.includes('contacts.map'));
check('人设分组标题', sbContent.includes('选择 AI'));
check('人设显示头像与名字', sbContent.includes('contactAvatar') && sbContent.includes('contactName'));
check('点人设回调向上传递', sbContent.includes('onPickContact?.(c)'));
check('人设说明用 systemPrompt', sbContent.includes('title={c.systemPrompt'));

// ── 社交状态：未读数 / 最后消息时间 ─────────────
const SESSIONS = [
  { conversationId: 'c-a', title: '猫娘那条', lastMessage: '喵', lastAt: Date.now(), unread: 3 },
  { conversationId: 'c-b', title: '没未读的', lastMessage: '收到', lastAt: Date.now() - 86400000, unread: 0 },
  { conversationId: 'c-c', title: '正在看的', lastMessage: '嗯', lastAt: Date.now(), unread: 5 },
];
const sbHtml = m.sidebar({ sessions: SESSIONS, activeConversationId: 'c-c' });
const sbAll = m.sidebar({ sessions: SESSIONS, activeConversationId: null });

check('有未读的会话渲染红点', /class="[^"]*badge/.test(sbHtml));
check('红点里写着未读数', sbHtml.includes('>3<'));
check('未读为 0 的会话不显示红点', !/c-b[\s\S]{0,400}badge/.test(sbHtml));
// 精确验证：把渲染结果按会话切段，数每一段里有几个红点。
// 之前的写法用了个猜出来的类名片段，永远匹配不上，等于没测。
const badgesIn = (html) => (html.match(/_badge_|class="[^"]*badge/g) || []).length;
const countFor = (html, title) => {
  // 以 title 属性切分，每段是「从该会话开始到下一个会话之前」
  const chunks = html.split(/<button[^>]*title="/).slice(1);
  const chunk = chunks.find((c) => c.startsWith(title + '"'));
  return chunk ? badgesIn(chunk) : -1;
};
check('未读会话各自渲染一个红点', countFor(sbHtml, '猫娘那条') === 1);
check('正在看的会话红点为 0（即使服务端算作未读）', countFor(sbHtml, '正在看的') === 0);
check('没未读的会话红点为 0', countFor(sbHtml, '没未读的') === 0);
check('切到别的会话后，那条的未读重新出现', countFor(sbAll, '正在看的') === 1);
check('超过 99 显示 99+',
  m.sidebar({ sessions: [{ conversationId: 'x', title: 't', lastAt: 1, unread: 120 }] }).includes('99+'));
check('每个会话都显示时间', (sbHtml.match(/itemTime/g) || []).length === 3);
check('未读有 aria-label 说明', sbHtml.includes('3 条未读'));

// 时间分档（纯函数，单独测）
const now = new Date('2026-03-18T12:00:00');
const at = (h, dAgo = 0) => new Date(2026, 2, 18 - dAgo, h, 30).getTime();
check('今天显示时分', m.formatShort(at(9), now) === '9:30');
check('昨天显示「昨天」', m.formatShort(at(9, 1), now) === '昨天');
check('三天前显示星期', /^星期[日一二三四五六]$/.test(m.formatShort(at(9, 3), now)));
check('更早显示日期', m.formatShort(new Date(2026, 0, 5).getTime(), now) === '1/5');
check('非法时间返回空串', m.formatShort('随便', now) === '' && m.formatShort(null, now) === '');

// 人设选择必须落到 App 的 key 里，否则换了 AI 组件不重建
const mainSrc = readFileSync('src/main.jsx', 'utf8');
check('App key 含 contactId', mainSrc.includes("activeContact?.id ?? 'default'"));
check('选中 AI 后回到新对话', mainSrc.includes('goNew()'));

// ── 2.5 社交状态：正在输入 / 有新消息浮标 ────────
console.log('\n②.5 社交状态');
const chatSrc = readFileSync('src/components/chat/ChatArea.jsx', 'utf8');
const appSrc2 = readFileSync('src/pages/App.jsx', 'utf8');

check('生成中顶栏显示「对方正在输入...」', appSrc2.includes('对方正在输入...'));
check('生成中不显示在线绿点', chatSrc.includes('{!chat.sending && <span className={styles.onlineDot} />}'));
check('浮标文案是「有新消息」', chatSrc.includes('有新消息'));
check('浮标由离开底部触发', chatSrc.includes('awayFromBottom'));
check('离开底部的阈值比贴底判定更大（带回差）',
  /AWAY_PX = (\d+)/.exec(chatSrc)?.[1] > /STICK_PX = (\d+)/.exec(chatSrc)?.[1]);
check('点浮标滚到底部', chatSrc.includes('jumpToBottom') && chatSrc.includes('el.scrollTop = el.scrollHeight'));
check('点浮标后恢复自动跟随', /jumpToBottom[\s\S]{0,220}stickToBottomRef\.current = true/.test(chatSrc));
check('浮标在滚动容器之外（否则会跟着内容滚走）',
  /<\/main>\s*\n\s*\{awayFromBottom && \(/.test(chatSrc));
check('发送时上报当前所在会话', readFileSync('src/hooks/useChat.js','utf8').includes('viewingConversationId'));
check('离开会话时上报 null',
  /reportPresence\(userId, null\)/.test(readFileSync('src/hooks/useChat.js','utf8')));
check('切到后台也算离开', readFileSync('src/hooks/useChat.js','utf8').includes('visibilitychange'));
check('流式结束后标记已读（自己聊完不算未读）',
  /markSessionRead\(convId/.test(readFileSync('src/hooks/useChat.js', 'utf8')));

// ── 对话控制 ────────────────────────────────────
console.log('\n②.7 对话控制');
const inputCss = readFileSync('src/components/deepseek/ChatInput.module.css', 'utf8');
const bubbleSrc = readFileSync('src/components/MessageBubble.jsx', 'utf8');
const useChatSrc = readFileSync('src/hooks/useChat.js', 'utf8');

// 停止按钮
check('流式中显示停止按钮', inputSrc.includes('aria-label="停止生成"'));
check('停止按钮用红色（不是品牌蓝）', /#f5222d/.test(inputCss));
check('红蓝颜色不能撞：发送按钮仍是蓝', /#4d6bfe/.test(inputCss));
check('点停止走 AbortController', /abortRef\.current\?\.abort\(\)/.test(useChatSrc));
check('停止后把消息标成 interrupted', /status: 'interrupted'/.test(useChatSrc));

// 操作栏渲染条件
const withActions = m.bubble({
  message: { id: 'a', role: 'assistant', content: '你好', status: 'completed' },
  contactName: 'DeepSeek', useLogo: true,
  showActions: true, onRegenerate: () => {},
});
check('操作栏：有重新生成', withActions.includes('aria-label="重新生成"'));
check('操作栏：有复制', withActions.includes('aria-label="复制"'));
check('操作栏图标是内联 SVG', (withActions.match(/<svg/g) || []).length >= 2);

const noActions = m.bubble({
  message: { id: 'a', role: 'assistant', content: '你好', status: 'completed' },
  contactName: 'DeepSeek', useLogo: true,
  showActions: false, onRegenerate: () => {},
});
check('showActions=false 时不渲染操作栏', !noActions.includes('aria-label="重新生成"'));

const streamingBubble = m.bubble({
  message: { id: 'a', role: 'assistant', content: '半截', status: 'streaming' },
  showActions: true, onRegenerate: () => {},
});
check('流式中不渲染操作栏（不能在生成时重发）',
  !streamingBubble.includes('aria-label="重新生成"'));

const userBubbleActions = m.bubble({
  message: { id: 'u', role: 'user', content: '我说的', status: 'completed' },
  showActions: true, onRegenerate: () => {},
});
check('用户气泡不渲染操作栏', !userBubbleActions.includes('aria-label="重新生成"'));

// 只挂在最后一条 AI 回复上
check('操作栏只挂在列表末尾的那条', /lastAiIndex !== messages\.length - 1/.test(chatSrc));
check('生成中隐藏操作栏', /showActions=\{i === lastAiIndex && !chat\.sending\}/.test(chatSrc));

// 重新生成
check('有 regenerate 导出', /^\s+regenerate,/m.test(useChatSrc));
check('重新生成先撤掉旧回复', /replaceFrom/.test(useChatSrc));
check('重新生成基于最后一条用户消息', /messages\[i\]\.role === 'user'/.test(useChatSrc.replace(/ /g, ' ')));

// streamChat 的 body 是显式白名单，漏一个字段就整条功能静默失效。
// 这个坑踩过两次（viewingConversationId 和 regenerate 都漏过），单独守一条。
const apiSrc = readFileSync('src/services/api.js', 'utf8');
check('streamChat 透传 viewingConversationId（漏了未读判据就恒为空）',
  /body: JSON\.stringify\(\{[\s\S]*?viewingConversationId[\s\S]*?\}\)/.test(apiSrc));
check('streamChat 透传 regenerate',
  /body: JSON\.stringify\(\{[\s\S]*?regenerate[\s\S]*?\}\)/.test(apiSrc));
check('生成中不允许重新生成', /if \(sending\) return;/.test(useChatSrc));

// 复制
check('复制有非安全上下文兜底（局域网 http 下 clipboard 不可用）',
  bubbleSrc.includes('execCommand') && bubbleSrc.includes('navigator.clipboard'));
check('复制成功有视觉反馈', bubbleSrc.includes('IconCheck'));
check('复制后的计时器会被清理', /clearTimeout\(timerRef\.current\)/.test(bubbleSrc));

// ── 3. 气泡 ────────────────────────────────────
console.log('\n③ 微信气泡');
const aiLogo = m.bubble({
  message: { id: 'a', role: 'assistant', content: '你好', status: 'completed' },
  contactName: 'DeepSeek', useLogo: true,
});
const userB = m.bubble({
  message: { id: 'u', role: 'user', content: '嗨', status: 'completed' },
});
check('AI 用 DeepSeek Logo 头像', aiLogo.includes('aria-label="DeepSeek"'));
check('AI 在左（bubbleLeft）', aiLogo.includes('bubbleLeft'));
check('AI 白气泡（不含 bubbleUser）', !aiLogo.includes('bubbleUser'));
check('用户在右（bubbleRight）', userB.includes('bubbleRight'));
check('用户绿气泡（bubbleUser）', userB.includes('bubbleUser'));
check('用户有头像', userB.includes('<img'));

// ── 3.5 深度思考面板 ───────────────────────────
console.log('\n③.5 深度思考面板');

// 思考中
const thinking = m.bubble({
  message: {
    id: 't1', role: 'assistant', content: '', thinking: '先想清楚再回答',
    thinkingStreaming: true, status: 'streaming', isStreaming: true,
  },
  contactName: 'DeepSeek', useLogo: true,
});
check('思考中有折叠面板', thinking.includes('aria-expanded'));
check('思考中标题为「思考中...」', thinking.includes('思考中...'));
check('思考内容已渲染', thinking.includes('先想清楚再回答'));
check('思考中带扫光动画', thinking.includes('shimmer'));
check('思考中不显示省略号占位', !thinking.includes('pendingText'));

// 思考结束（有正文，默认折叠）
const done1 = m.bubble({
  message: {
    id: 't2', role: 'assistant', content: '答案是 42', thinking: '先想清楚再回答',
    thinkingStreaming: false, thinkingMs: 3200, status: 'completed',
  },
  contactName: 'DeepSeek', useLogo: true,
});
check('结束后标题含用时', done1.includes('已深度思考（用时 3 秒）'), done1.match(/已深度思考[^<]*/)?.[0] ?? '');
check('结束后默认折叠', done1.includes('aria-expanded="false"'));
// 注意：DisclosureRow 折叠时不渲染 children（省 DOM），
// 所以这里查的是**回复正文**没有被面板吞掉，不是思考正文。
check('折叠后回复正文照常显示', done1.includes('答案是 42'));
check('结束后无扫光', !done1.includes('shimmer'));

// 没有思考内容：不渲染面板
const plain = m.bubble({
  message: { id: 't3', role: 'assistant', content: '普通回答', status: 'completed' },
  contactName: 'DeepSeek', useLogo: true,
});
check('无思考时不渲染面板', !plain.includes('aria-expanded'));

// 真组件（不是 stub）：这些 data-* 只有官方实现才有
check('用官方 DisclosureRow', thinking.includes('data-disclosure-row="true"'));
check('展开态 aria-expanded=true', thinking.includes('aria-expanded="true"'));
check('running 触发官方流光', thinking.includes('data-shimmer="true"'));
check('思考中用 StateDot 状态点', thinking.includes('data-state="ongoing"'));
check('结束后 aria-expanded=false', done1.includes('aria-expanded="false"'));
check('结束后无流光', !done1.includes('data-shimmer'));

// Markdown 渲染
const md = m.bubble({
  message: { id: 'md', role: 'assistant', content: '## 标题\n\n- 条目\n\n| a | b |\n|---|---|\n| 1 | 2 |', status: 'completed' },
  contactName: 'DeepSeek', useLogo: true,
});
check('AI 正文走 MarkdownText', md.includes('<h2'));
check('表格被渲染', md.includes('<table'));
check('列表被渲染', md.includes('<li'));
const userMd = m.bubble({
  message: { id: 'um', role: 'user', content: '## 不渲染', status: 'completed' },
});
check('用户正文不解析 Markdown', !userMd.includes('<h2'));

// 图标 sprite
const spriteSrc = readFileSync('src/components/deepseek/sprite.js', 'utf8');
check('注入 chevron sprite', spriteSrc.includes('chevron-up-outline-regular'));
check('只注入用到的符号', spriteSrc.includes('NEEDED') && !spriteSrc.includes('ICON_SYMBOLS)'));
check('遮罩已挂载', readFileSync('src/main.jsx', 'utf8').includes('mountIconSprite()'));

// ── 3.6 历史回显 ───────────────────────────────
console.log('\n③.6 历史回显');

// 骨架屏：至少 5 条占位块，含「加载中」文本、对读屏隐藏装饰
const sk = m.skeleton();
check('骨架屏有占位块', (sk.match(/class="[^"]*_bubble_/g) ?? []).length >= 5,
  `${(sk.match(/class="[^"]*_bubble_/g) ?? []).length} 条`);
check('骨架屏含加载文案', sk.includes('加载中'));
check('骨架屏装饰对读屏隐藏', sk.includes('aria-hidden="true"'));
check('骨架屏有 status 播报', sk.includes('role="status"'));

// 历史消息的字段映射：后端 recentMessages() 的产出直接喂给气泡
const histAi = m.bubble({
  message: {
    id: 'h1', role: 'assistant', status: 'completed',
    content: '历史正文', thinking: '历史思考内容', thinkingMs: 4200,
  },
  contactName: 'DeepSeek', useLogo: true,
});
check('历史消息渲染气泡', histAi.includes('历史正文'));
// 折叠态下 DisclosureRow 不渲染子节点，只能查标题；
// 思考正文是否还在，由展开态那条断言覆盖（见 ③.5）
check('历史消息恢复思考面板', histAi.includes('已深度思考'));
check('折叠态不渲染思考正文', !histAi.includes('历史思考内容'));
check('历史耗时写进标题', histAi.includes('用时 4 秒'));
check('历史思考默认折叠', histAi.includes('aria-expanded="false"'));
// 老数据没有 thinking 字段时不能崩
const oldRow = m.bubble({
  message: { id: 'h2', role: 'assistant', status: 'completed', content: '老消息' },
  contactName: 'DeepSeek', useLogo: true,
});
check('无 thinking 字段不崩', oldRow.includes('老消息') && !oldRow.includes('aria-expanded'));

// ── 4. 图标集 ──────────────────────────────────
console.log('\n④ 图标集');
const need = ['DeepSeekLogo', 'IconMenu', 'IconNewChat', 'IconThink', 'IconGlobe',
  'IconPaperclip', 'IconMic', 'IconSend', 'IconStop', 'IconClose', 'IconChat'];
const missing = need.filter((n) => !m.iconNames.includes(n));
check('所需图标齐全', missing.length === 0, missing.length ? `缺 ${missing.join(',')}` : `${m.iconNames.length} 个`);

const iconSrc = readFileSync('src/components/deepseek/icons.jsx', 'utf8');
// 只看真实 import，注释里提到包名不算
check('无第三方图标依赖', !/^import .*@deepseek-ai/m.test(iconSrc));
check('图标用 currentColor 上色', iconSrc.includes('currentColor'));

rmSync(out, { recursive: true, force: true });

// ── 5. CSS 类名完整性 ──────────────────────────
console.log('\n⑤ CSS Module 类名交叉核对');
const pairs = [
  ['src/pages/App.jsx', 'src/pages/App.module.css'],
  ['src/components/chat/ChatArea.jsx', 'src/components/chat/ChatArea.module.css'],
  ['src/components/sidebar/Sidebar.jsx', 'src/components/sidebar/Sidebar.module.css'],
  ['src/components/sidebar/SidebarContent.jsx', 'src/components/sidebar/SidebarContent.module.css'],
  ['src/components/deepseek/ChatInput.jsx', 'src/components/deepseek/ChatInput.module.css'],
  ['src/components/MessageBubble.jsx', 'src/components/MessageBubble.module.css'],
];
for (const [j, c] of pairs) {
  const jsx = readFileSync(j, 'utf8');
  const css = readFileSync(c, 'utf8');
  const used = [...new Set([...jsx.matchAll(/styles\.([a-zA-Z0-9_]+)/g)].map((x) => x[1]))];
  const defined = new Set([...css.matchAll(/^\.([a-zA-Z0-9_]+)/gm)].map((x) => x[1]));
  const miss = used.filter((u) => !defined.has(u));
  check(j.split('/').pop(), miss.length === 0, miss.length ? `缺 ${miss.join(',')}` : `${used.length} 个类`);
}

// ── 6. 布局约束 ────────────────────────────────
console.log('\n⑥ 布局约束');
const appCss = readFileSync('src/components/chat/ChatArea.module.css', 'utf8');
check('对话区 flex:1 占满', appCss.includes('flex: 1 1 auto'));
check('对话区 min-height:0（否则滚不动）', appCss.includes('min-height: 0'));
check('对话区可滚动', appCss.includes('overflow-y: auto'));
check('对话区浅灰背景', appCss.includes('var(--wx-bg)'));
check('输入区固定在底部', readFileSync('src/components/deepseek/ChatInput.module.css', 'utf8').includes('flex: 0 0 auto'));

console.log('\n' + (fail.length ? `❌ ${fail.length} 项失败: ${fail.join('; ')}` : '✅ 全部通过'));
process.exit(fail.length ? 1 : 0);