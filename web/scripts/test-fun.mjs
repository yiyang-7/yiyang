/** 验证微信式交互：双击回应、长按引用、撤回、随机预设、微动画 */
import { chromium } from 'playwright-core';

const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1255/chrome-linux-arm64/chrome', args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 420, height: 900 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => m.type() === 'error' && errs.push(m.text()));

let fail = 0;
const ok = (n, c, extra='') => { console.log(`  ${c?'✅':'❌'} ${n}${extra?' — '+extra:''}`); if(!c) fail++; };

await p.goto('file:///root/森萝/演示版.html', { waitUntil: 'load' });
await p.waitForTimeout(1200);

ok('品牌名已改 lume', (await p.evaluate(() => document.body.innerText)).includes('lume'));

// 发一条消息
const ta = p.locator('textarea').first();
await ta.click();
await ta.pressSequentially('你好', { delay: 30 });
await p.waitForTimeout(200);
await p.locator('button[aria-label="发送"]').click();
await p.waitForTimeout(6000);

const bubbles = p.locator('[class*="bubble"]');
const n = await bubbles.count();
ok('消息已渲染', n >= 2, `${n} 个气泡`);

// 双击 AI 气泡
console.log('\n▶ 双击回应表情');
await bubbles.last().dblclick();
await p.waitForTimeout(700);
const picker = await p.locator('[class*="reactPicker"]').count();
ok('弹出表情选择器', picker > 0);
await p.screenshot({ path: '/tmp/f1-picker.png' });

if (picker > 0) {
  await p.locator('[class*="reactBtn"]').first().click();
  await p.waitForTimeout(700);
  const react = await p.locator('[class*="reaction"]').count();
  ok('消息上出现表情回应', react > 0);
  await p.screenshot({ path: '/tmp/f2-react.png' });
}

// 长按（右键）引用
console.log('\n▶ 长按引用');
await bubbles.first().click({ button: 'right' });
await p.waitForTimeout(600);
const qbar = await p.locator('[class*="quoteBar"]').count();
ok('出现引用条', qbar > 0);
await p.screenshot({ path: '/tmp/f3-quote.png' });

if (qbar > 0) {
  await ta.click();
  await ta.pressSequentially('引用测试', { delay: 25 });
  await p.waitForTimeout(200);
  await p.locator('button[aria-label="发送"]').click();
  await p.waitForTimeout(4000);
  const qblock = await p.locator('[class*="quote"]').count();
  ok('发出的消息带引用块', qblock > 0);
}

// 预设回复随机性
console.log('\n▶ 预设回复');
await p.waitForTimeout(3000);
const chips1 = await p.locator('[class*="chip"], [class*="quick"]').count();
ok('输出栏上方有预设选项', chips1 >= 1, `${chips1} 个`);

// 动画存在性
console.log('\n▶ 微动画');
const anims = await p.evaluate(() => {
  // 注意：页面上多个组件都有 row 类名，必须挑带头像的那个消息行，
  // 否则会拿到没有头像的 QuickReplies 行，误判成「没有动画」。
  // 只认 AI 那一侧：用户头像刻意不呼吸（两边一起动太吵），
  // 拿用户行会误判成没动画。
  const rowEl = [...document.querySelectorAll('[class*="row"]')]
    .find((r) => r.querySelector('[class*="avatar"]') && !/rowUser/.test(r.className));
  const av = rowEl?.querySelector('[class*="avatar"]');
  const dot = document.querySelector('[class*="onlineDot"]');
  return {
    row: rowEl ? getComputedStyle(rowEl).animationName : null,
    avatar: av ? getComputedStyle(av).animationName : null,
    online: dot ? getComputedStyle(dot).animationName : null,
  };
});
ok('消息有入场动画', anims.row && anims.row !== 'none', anims.row);
ok('头像有呼吸动画', anims.avatar && anims.avatar !== 'none', anims.avatar);
ok('在线点有脉冲', anims.online && anims.online !== 'none', anims.online);

console.log('\n═══ JS 错误 ═══');
ok('全程无错误', errs.length === 0, errs.slice(0,3).join(' | '));

await b.close();
console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
