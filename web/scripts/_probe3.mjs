import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1255/chrome-linux-arm64/chrome', args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 420, height: 900 } });
p.on('console', m => console.log('[' + m.type() + ']', m.text().slice(0,200)));
p.on('pageerror', e => console.log('PAGEERROR:', e.message, '\n', (e.stack||'').split('\n').slice(0,4).join('\n')));
await p.goto('file:///root/森萝/演示版.html', { waitUntil: 'load' });
await p.waitForTimeout(1000);
// localStorage 在 file:// 下是否可用
const ls = await p.evaluate(() => {
  try { localStorage.setItem('t','1'); const v = localStorage.getItem('t'); localStorage.removeItem('t'); return 'OK:' + v; }
  catch(e) { return 'ERR:' + e.message; }
});
console.log('localStorage:', ls);
await b.close();
