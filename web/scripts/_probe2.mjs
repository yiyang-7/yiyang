import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1255/chrome-linux-arm64/chrome', args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 420, height: 900 } });
p.on('console', m => console.log('[' + m.type() + ']', m.text().slice(0,300)));
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.goto('file:///root/森萝/演示版.html', { waitUntil: 'load' });
await p.waitForTimeout(1200);

// 拦截 fetch 看是否真的发请求
await p.evaluate(() => {
  const of = window.fetch;
  window.fetch = function(...a) { console.log('FETCH:', String(a[0]).slice(0,80)); return of.apply(this, a); };
});

const ta = p.locator('textarea').first();
await ta.click();
await ta.pressSequentially('你好', { delay: 40 });
await p.waitForTimeout(300);
console.log('--- 点发送 ---');
await p.locator('button[aria-label="发送"]').click();
await p.waitForTimeout(2500);

const t = await p.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
console.log('结果:', t.slice(0, 150));
const msgs = await p.locator('[class*="bubble"]').count();
console.log('气泡数:', msgs);
console.log('URL hash:', await p.evaluate(() => location.hash));
await b.close();
