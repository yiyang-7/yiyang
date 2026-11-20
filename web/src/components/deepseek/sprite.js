import { ICON_SYMBOLS } from '@deepseek-ai/dsh-client-ui-primitives';

/**
 * 注入官方 primitives 的图标 sprite。
 *
 * 官方图标组件产出的是 `<svg><use href="#dsw-icon-xxx" /></svg>`，
 * 图形本身由文档里的 `<symbol>` 提供。DSH 宿主靠 ui-theme 插件注入，
 * 我们没装那套主题系统，必须自己注。
 *
 * 只注入实际用到的几个，而不是整个 ICON_SYMBOLS（那是几百个符号）。
 * 目前用到的地方：
 *   DisclosureRow 展开 → chevron-up
 *   DisclosureRow 收起/悬停预览 → chevron-down
 *
 * 新增官方组件时如果出现图标不显示，先来这里补符号。
 * 缺符号的表现是「图标位置空白」而不是报错，很隐蔽。
 */
const NEEDED = [
  'dsw-icon-chevron-up-outline-regular',
  'dsw-icon-chevron-down-outline-regular',
];

/**
 * 把 <symbol> 拼成一段 HTML 字符串。
 *
 * 注意 ICON_SYMBOLS 的值是完整的 `<svg ...>...</svg>` 源码，
 * 必须把 viewBox / fill / stroke 等属性从 <svg> 搬到 <symbol> 上，
 * 否则图标会渲染成实心黑块。
 */
function buildSprite() {
  const parts = NEEDED.map((id) => {
    const raw = ICON_SYMBOLS[id];
    if (!raw) return '';
    const open = raw.match(/^<svg([^>]*)>/);
    if (!open) return '';
    const inner = raw.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    return `<symbol id="${id}"${open[1]}>${inner}</symbol>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${parts.join('')}</svg>`;
}

/**
 * 把 sprite 挂到 body 上。应用启动时调用一次即可，重复调用无副作用。
 */
export function mountIconSprite() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dsw-icon-sprite')) return;
  const holder = document.createElement('div');
  holder.id = 'dsw-icon-sprite';
  holder.innerHTML = buildSprite();
  document.body.insertBefore(holder, document.body.firstChild);
}