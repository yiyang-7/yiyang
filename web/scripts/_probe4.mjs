import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1255/chrome-linux-arm64/chrome', args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 420, height: 900 } });
p.on('pageerror', e => console.log('PAGEERROR:', e.message, '|', (e.stack||'').split('\n')[1]));
p.on('console', m => { const t=m.text(); if (t.includes('ERR')||t.includes('WARN')||m.type()==='error') console.log('['+m.type()+']', t.slice(0,300)); });
await p.goto('file:///root/森萝/演示版.html', { waitUntil: 'load' });
await p.waitForTimeout(1000);

const ta = p.locator('textarea').first();
await ta.click();
await ta.pressSequentially('你好', { delay: 40 });
await p.waitForTimeout(200);
await p.locator('button[aria-label="发送"]').click();

// 每 300ms 采样一次 DOM
for (let i = 0; i < 8; i++) {
  await p.waitForTimeout(350);
  const s = await p.evaluate(() => ({
    bubbles: document.querySelectorAll('[class*="bubble"]').length,
    hash: location.hash,
    txt: document.body.innerText.replace(/\s+/g,' ').slice(0, 80),
  }));
  console.log(`t+${(i+1)*350}ms 气泡=${s.bubbles} hash=${s.hash} | ${s.txt}`);
}
await b.close();
