import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1255/chrome-linux-arm64/chrome', args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 420, height: 900 } });
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
p.on('console', m => { if (m.type()==='error') console.log('CONSOLE:', m.text()); });
await p.goto('file:///root/森萝/演示版.html', { waitUntil: 'load' });
await p.waitForTimeout(1200);

const ta = p.locator('textarea').first();
await ta.click();
await ta.pressSequentially('你好', { delay: 40 });
await p.waitForTimeout(400);

const state = await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '发送');
  return { disabled: btn?.disabled, cls: btn?.className };
});
console.log('发送按钮状态:', JSON.stringify(state));

await ta.press('Enter');
await p.waitForTimeout(3000);
const t = await p.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
console.log('Enter 后:', t.slice(0, 120));
await b.close();
