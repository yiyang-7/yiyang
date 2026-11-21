/**
 * 验证 API 密钥入口全流程。
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

let fail = 0;
const assert = (n, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${n}${extra ? ' — ' + extra : ''}`);
  if (!ok) fail++;
};

await page.goto('file:///root/森萝/演示版.html', { waitUntil: 'load' });
await page.waitForTimeout(1500);

console.log('\n① 状态条（无密钥）');
const barText = await page.locator('[class*="keyBar"]').first().innerText().catch(() => '');
console.log('   状态条:', barText || '(未找到)');
assert('显示演示数据提示', /演示数据/.test(barText));
await page.screenshot({ path: '/tmp/k1-bar.png' });

console.log('\n② 点顶栏钥匙按钮');
const keyBtn = page.locator('button[aria-label="填 API 密钥"]');
assert('钥匙按钮存在', (await keyBtn.count()) > 0);
await keyBtn.click();
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/k2-panel.png' });

const panelText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
assert('直接打开到 API 密钥页', panelText.includes('API Key'), panelText.slice(-120));

console.log('\n③ 填写并保存密钥');
const keyInput = page.locator('#apikey');
assert('密钥输入框存在', (await keyInput.count()) > 0);
await keyInput.fill('sk-test-1234567890abcdef');
await page.locator('text=保存密钥').first().click();
await page.waitForTimeout(800);

const afterSave = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
assert('保存后提示成功', /已保存|已填入/.test(afterSave), afterSave.slice(-100));

console.log('\n④ 关闭面板，状态条应变化');
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
const bar2 = await page.locator('[class*="keyBar"]').first().innerText().catch(() => '');
console.log('   状态条:', bar2 || '(未找到)');
assert('状态条变为已连接', /已填入|真实模型/.test(bar2));
await page.screenshot({ path: '/tmp/k3-saved.png' });

console.log('\n⑤ 刷新后密钥仍生效（localStorage 持久化）');
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1800);
const bar3 = await page.locator('[class*="keyBar"]').first().innerText().catch(() => '');
console.log('   状态条:', bar3 || '(未找到)');
assert('刷新后仍显示已连接', /已填入|真实模型/.test(bar3));

console.log('\n⑥ 齿轮按钮进入外观页');
await page.locator('button[aria-label="设置"]').first().click();
await page.waitForTimeout(700);
const p2 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
assert('齿轮进的是角色外观页', /选一个 emoji/.test(p2));
await page.screenshot({ path: '/tmp/k4-avatar.png' });

console.log('\n═══ JS 错误 ═══');
assert('全程无错误', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 密钥入口全流程通过');
await browser.close();
process.exit(fail ? 1 : 0);