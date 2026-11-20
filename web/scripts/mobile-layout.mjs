/**
 * 移动端布局验证。
 *
 * 这台机器跑不了无头浏览器（proot 沙箱缺 libnspr4/libnss3，
 * chromium 启动即 SIGBUS），所以这里不做像素级验证，
 * 改为核对「抽屉布局成立的结构性前提」——这些条件满足，
 * 侧边栏在窄屏上就不可能挤占主区：
 *
 *   1. 侧边栏是 position: fixed（脱离文档流，不参与 flex 分配）
 *   2. 侧边栏有遮罩，且宽度设了上限
 *   3. 主聊天区不依赖侧边栏的宽度（不是 flex 兄弟节点）
 *   4. 没有写死的桌面级宽度（如 min-width: 900px 之类会撑破窄屏）
 *   5. 有 viewport meta，且有 dvh 处理（安卓地址栏会变）
 */
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`   ${name}: ✅ ${detail}`); }
  else { fail++; console.log(`   ${name}: ❌ ${detail}`); }
}

const sidebarCss = readFileSync('src/components/sidebar/Sidebar.module.css', 'utf8');
const chatCss = readFileSync('src/components/chat/ChatArea.module.css', 'utf8');
const indexHtml = readFileSync('index.html', 'utf8');
const sidebarJsx = readFileSync('src/components/sidebar/Sidebar.jsx', 'utf8');
const chatJsx = readFileSync('src/components/chat/ChatArea.jsx', 'utf8');

console.log('\n① 抽屉不挤占屏幕');

// 1. fixed 定位 = 脱离文档流
check('侧边栏脱离文档流（position: fixed）',
  /\.sidebar\s*\{[^}]*position:\s*fixed/.test(sidebarCss));

// 2. 有遮罩
check('有全屏遮罩（点击可关闭）',
  /\.backdrop\s*\{[^}]*position:\s*fixed/.test(sidebarCss)
  && /\.backdrop\s*\{[^}]*inset:\s*0/.test(sidebarCss));

// 3. 宽度上限，避免小屏上占满
const w = /\.sidebar\s*\{[^}]*\bwidth:\s*(\d+)px/.exec(sidebarCss);
const maxW = /\.sidebar\s*\{[^}]*max-width:\s*(\d+)vw/.exec(sidebarCss);
check('抽屉有固定宽度', !!w, w ? `${w[1]}px` : '未找到');
check('抽屉宽度有 vw 上限（小屏不会占满）', !!maxW, maxW ? `max-width: ${maxW[1]}vw` : '未找到');
check('小屏上抽屉宽度不超过屏幕 90%', maxW && Number(maxW[1]) <= 90,
  maxW ? `${maxW[1]}vw` : '');

// 4. 汉堡按钮存在
check('左上角有汉堡按钮', chatJsx.includes('aria-label="打开历史对话"'));

// 5. 主区不依赖侧边栏占位
check('主区没有为侧边栏预留 padding-left',
  !/\.(list|listWrap|container)\s*\{[^}]*(padding|margin)-left:\s*\d{3}px/.test(chatCss));
check('侧边栏之间用 grid/flex 兄弟布局把主区挤小',
  !/display:\s*grid[^}]*grid-template-columns:[^}]*\d{3}px/.test(chatCss));

console.log('\n② 窄屏不溢出');

// 6. 没有写死的超大宽度
// 注意：@media (min-width: 900px) 也是 min-width，但它不是元素属性。
// 先剥掉所有 @media 行再检查，否则会误报。
const cssNoMedia = chatCss.replace(/@media[^{]*\{/g, '@media {');
const hardWidths = [...cssNoMedia.matchAll(/min-width:\s*(\d+)px/g)]
  .filter((m) => Number(m[1]) > 360);
check('主区没有超过 360px 的 min-width（窄屏会横向溢出）',
  hardWidths.length === 0,
  hardWidths.length ? hardWidths.map((m) => `min-width:${m[1]}px`).join(', ') : '');

// 7. 宽屏约束是「只在宽屏生效」
check('860px 居中约束只在 ≥900px 生效（不会限制手机）',
  /@media\s*\(min-width:\s*900px\)/.test(chatCss));

// 8. viewport meta
check('viewport meta 存在', /name="viewport"/.test(indexHtml));
check('viewport 含 width=device-width', /width=device-width/.test(indexHtml));
check('viewport 用 interactive-widget=resizes-content（软键盘不挡输入框）',
  /interactive-widget=resizes-content/.test(indexHtml));

// 9. dvh
const globalCss = readFileSync('src/styles/global.css', 'utf8');
check('用 dvh 而非 100vh（安卓地址栏伸缩不会截断）',
  /@supports\s*\(height:\s*100dvh\)/.test(globalCss) && /height:\s*100dvh/.test(globalCss));

// 10. flex 收缩
check('滚动容器允许收缩（min-height: 0）', /min-height:\s*0/.test(chatCss));
check('输入框不被压缩（flex: 0 0 auto）', /flex:\s*0\s+0\s+auto/.test(chatCss));

console.log('\n③ 抽屉交互');

check('有 backdrop 可点击关闭', sidebarJsx.includes('onClose'));
check('抽屉有滑入动画',
  /@keyframes\s+slideIn[\s\S]{0,80}translateX\(-100%\)/.test(sidebarCss));
check('尊重 prefers-reduced-motion',
  /prefers-reduced-motion/.test(sidebarCss));
check('切会话时自动关闭抽屉',
  readFileSync('src/pages/App.jsx', 'utf8').includes('setSidebarOpen(false)'));

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
