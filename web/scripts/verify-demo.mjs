/**
 * 用真实 chromium 打开演示版，抓 JS 错误与渲染结果。
 *
 * 运行：node scripts/verify-demo.mjs [file]
 */
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const target = resolve(process.argv[2] || '/root/森萝/演示版.html');

// 浏览器路径可配置。CI 或没有浏览器的环境直接跳过，
// 不要让烟测本身成为阻塞——它只该抓真问题，不该制造假失败。
const CHROME =
  process.env.CHROME_PATH ||
  '/root/.cache/ms-playwright/chromium-1255/chrome-linux-arm64/chrome';

if (!existsSync(CHROME)) {
  console.log(`⏭ 跳过浏览器烟测：找不到 ${CHROME}`);
  console.log('   （设置 CHROME_PATH 环境变量可指定 chromium 路径）');
  process.exit(0);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});

const page = await browser.newPage({ viewport: { width: 420, height: 900 } });

const errors = [];
const logs = [];
const failed = [];

page.on('pageerror', (e) => errors.push({ type: 'pageerror', text: e.message, stack: (e.stack || '').split('\n').slice(0, 6).join('\n') }));
page.on('console', (m) => {
  const t = m.type();
  logs.push({ type: t, text: m.text() });
  if (t === 'error') errors.push({ type: 'console.error', text: m.text() });
});
page.on('requestfailed', (r) => failed.push({ url: r.url().slice(0, 120), err: r.failure()?.errorText }));

await page.goto('file://' + target, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(3000);

// 渲染检查
const info = await page.evaluate(() => {
  const root = document.getElementById('root') || document.querySelector('#app');
  return {
    rootExists: !!root,
    rootChildren: root ? root.children.length : -1,
    bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
    bubbleCount: document.querySelectorAll('[class*="bubble"]').length,
    inputExists: !!document.querySelector('textarea, input[type="text"]'),
    htmlLen: document.documentElement.outerHTML.length,
  };
});

await page.screenshot({ path: '/tmp/demo-shot.png', fullPage: false });

console.log('═══ 渲染结果 ═══');
console.log('  #root 存在:', info.rootExists);
console.log('  #root 子节点:', info.rootChildren, info.rootChildren > 0 ? '✅' : '❌ 空');
console.log('  气泡数量:', info.bubbleCount);
console.log('  输入框:', info.inputExists ? '✅' : '❌');
console.log('  可见文本:', info.bodyText.slice(0, 200));

console.log('\n═══ 错误 ═══');
if (errors.length === 0) console.log('  ✅ 无 JS 错误');
else {
  errors.slice(0, 8).forEach((e, i) => {
    console.log(`  ❌ [${i + 1}] ${e.type}: ${e.text}`);
    if (e.stack) console.log('     ' + e.stack.replace(/\n/g, '\n     '));
  });
}

console.log('\n═══ 失败请求 ═══');
if (failed.length === 0) console.log('  ✅ 无失败请求');
else failed.slice(0, 8).forEach((f) => console.log(`  ❌ ${f.err} ← ${f.url}`));

console.log('\n═══ 控制台输出 ═══');
logs.slice(0, 15).forEach((l) => console.log(`  [${l.type}] ${l.text.slice(0, 200)}`));

// ── 关键断言：页面必须真的渲染出内容 ──
console.log('\n═══ 断言 ═══');
let fail = 0;
const assert = (name, ok) => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  if (!ok) fail++;
};

assert('无 JS 错误', errors.length === 0);
assert('#root 有子节点（React 已挂载）', info.rootChildren > 0);
assert('输入框存在', info.inputExists);
assert('页面有可见文本（非白屏）', info.bodyText.length > 20);
assert('无失败的网络请求', failed.length === 0);

// 空状态下应看到欢迎语
const hasWelcome = /DeepSeek|你好|很高兴/.test(info.bodyText);
assert('显示欢迎语', hasWelcome);

if (fail) {
  console.log(`\n❌ 烟测失败 ${fail} 项`);
} else {
  console.log('\n✅ 浏览器烟测通过');
}

await browser.close();
process.exit(fail ? 1 : 0);