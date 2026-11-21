import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1255/chrome-linux-arm64/chrome', args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 420, height: 900 } });
await p.goto('file:///root/森萝/演示版.html', { waitUntil: 'load' });
await p.waitForTimeout(1200);
// 填一个无效密钥
await p.evaluate(() => localStorage.setItem('dsh.apiKey', 'sk-invalid-key-for-test'));
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(1200);
// 发消息，触发真实调用
const ta = p.locator('textarea').first();
await ta.click();
await ta.pressSequentially('你好', { delay: 50 });
await p.waitForTimeout(500);
const val = await ta.inputValue();
console.log('输入框内容:', JSON.stringify(val));
const btns = await p.locator('button[aria-label]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
console.log('按钮列表:', btns.join(' | '));
// 点发送按钮更稳
const sendBtn = p.locator('button[aria-label="发送"]').first();
if (await sendBtn.count()) { await sendBtn.click(); } else { await ta.press('Enter'); }
await p.waitForTimeout(10000);
const t = await p.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
console.log('页面文本:', t.slice(0, 400));
await p.screenshot({ path: '/tmp/k5-error.png' });
await b.close();
