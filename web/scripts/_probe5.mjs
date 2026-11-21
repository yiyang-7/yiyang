import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1255/chrome-linux-arm64/chrome', args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 420, height: 900 } });
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.goto('file:///root/森萝/演示版.html', { waitUntil: 'load' });
await p.waitForTimeout(1000);

const ta = p.locator('textarea').first();
await ta.click();
await ta.pressSequentially('你好', { delay: 40 });
await p.waitForTimeout(200);
console.log('输入值:', await ta.inputValue());
await p.locator('button[aria-label="发送"]').click();
await p.waitForTimeout(2000);

// 看 main 里到底有什么
const struct = await p.evaluate(() => {
  const main = document.querySelector('main');
  return { mainExists: !!main, childCount: main?.children.length, inner: main?.innerText?.slice(0,100), cls: main?.className };
});
console.log('main:', JSON.stringify(struct));
console.log('输入值(发送后):', await ta.inputValue());
await b.close();
