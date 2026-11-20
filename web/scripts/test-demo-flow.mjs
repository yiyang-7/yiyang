/**
 * 演示版真实交互测试：点会话 → 发消息 → 等回复。
 *
 * 用真实 chromium 驱动，验证用户实际操作路径。
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1255/chrome-linux-arm64/chrome',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});

const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const step = (s) => console.log(`\n▶ ${s}`);

await page.goto('file:///root/森萝/演示版.html', { waitUntil: 'load' });
await page.waitForTimeout(1500);

// ── 1. 打开侧栏，点一个历史会话 ──
step('打开侧栏');
await page.click('button[aria-label*="菜单"], button[aria-label*="侧栏"]').catch(async () => {
  await page.locator('button').first().click();
});
await page.waitForTimeout(700);
await page.screenshot({ path: '/tmp/shot-1-sidebar.png' });

const sessionTexts = await page.locator('[class*="session"], [class*="item"]').count();
console.log('  侧栏条目数:', sessionTexts);

step('点击「今天想聊点轻松的」会话（带未读 2）');
const catSession = page.locator('text=今天想聊点轻松的').first();
const hasCat = await catSession.count();
console.log('  找到猫娘会话:', hasCat > 0 ? '✅' : '❌');

if (hasCat) {
  await catSession.click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: '/tmp/shot-2-chat.png' });

  const bubbles = await page.locator('[class*="bubble"]').count();
  const bodyText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log('  进入后气泡数:', bubbles, bubbles > 0 ? '✅' : '❌');
  console.log('  页面文本:', bodyText.slice(0, 150));

  // ── 2. 发消息 ──
  step('输入并发送消息');
  const input = page.locator('textarea').first();
  await input.fill('你好呀');
  await page.waitForTimeout(300);
  await input.press('Enter');

  // 等回复开始
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '/tmp/shot-3-sending.png' });
  const duringText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log('  发送后文本:', duringText.slice(-200));

  // ── 3. 关键：等流结束后，回复是否还在（用户报的 bug）──
  step('等待回复完成，检查气泡是否留存');
  await page.waitForTimeout(9000);
  await page.screenshot({ path: '/tmp/shot-4-done.png' });

  const finalBubbles = await page.locator('[class*="bubble"]').count();
  const finalText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log('  最终气泡数:', finalBubbles, finalBubbles >= bubbles + 2 ? '✅ 增加了' : '⚠️ 未增加');
  console.log('  最终文本尾部:', finalText.slice(-260));

  // 检查快捷回复
  const chips = await page.locator('[class*="chip"]').count();
  console.log('  快捷回复胶囊:', chips, chips > 0 ? '✅ 出现' : '⚠️ 未出现');
}

// ── 4. 设置面板 ──
step('关闭侧栏后打开设置面板');
// 先关侧栏（点遮罩或按 Esc）
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(500);
await page.locator('button[aria-label="设置"]').first().click({ timeout: 5000 }).catch(() => console.log('  未找到设置按钮'));
await page.waitForTimeout(900);
await page.screenshot({ path: '/tmp/shot-5-settings.png' });
const setText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('  设置面板文本:', setText.slice(-300));

console.log('\n═══ JS 错误 ═══');
console.log(errors.length === 0 ? '  ✅ 全程无错误' : errors.map((e) => '  ❌ ' + e).join('\n'));

await browser.close();