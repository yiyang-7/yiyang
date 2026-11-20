/**
 * 把演示版构建打成「一个 HTML 文件」。
 *
 * 为什么要单文件：老师电脑上不需要装 node、不需要起服务，
 * 双击就能看。但 file:// 协议下浏览器会拦截外部的
 * <script type="module" src>（CORS 规则），
 * 所以 JS/CSS/字体必须全部内联。
 *
 * 产物：demo/演示版.html
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const DIST = 'dist';
const OUT_DIR = 'demo';
const OUT_FILE = join(OUT_DIR, '演示版.html');

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('❌ 找不到 dist/index.html，先跑 npm run build:demo');
  process.exit(1);
}

let html = readFileSync(join(DIST, 'index.html'), 'utf8');

// ── 1. 内联 CSS ────────────────────────────────
html = html.replace(
  /<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
  (_m, href) => {
    const file = join(DIST, href.replace(/^\.?\//, ''));
    if (!existsSync(file)) return _m;
    let css = readFileSync(file, 'utf8');
    css = inlineFonts(css);
    return `<style>\n${css}\n</style>`;
  },
);

// ── 2. 内联 JS ─────────────────────────────────
// type="module" 保留：代码里可能有 import.meta，去掉会报错。
// 内联 module 脚本不触发网络请求，file:// 下可以执行。
html = html.replace(
  /<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,
  (_m, src) => {
    const file = join(DIST, src.replace(/^\.?\//, ''));
    if (!existsSync(file)) return _m;
    let js = readFileSync(file, 'utf8');
    // </script> 出现在字符串里会提前闭合标签，必须转义
    js = js.replace(/<\/script>/gi, '<\\/script>');
    return `<script type="module">\n${js}\n</script>`;
  },
);

// ── 3. 兜底：还有外部模块引用就报错 ────────────
const leftover = html.match(/<script[^>]+src="[^"]+"/g);
if (leftover) {
  console.error('❌ 仍有外部脚本未内联：', leftover.slice(0, 3).join(', '));
  console.error('   这样的产物在 file:// 下会被浏览器拦截。');
  process.exit(1);
}

// ── 4. 加一段离线提示，避免被误认为在调真模型 ──
const banner = `
<div id="demo-badge" style="
  position:fixed;right:12px;bottom:12px;z-index:9999;
  background:rgba(17,24,39,.82);color:#fff;
  font:12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  padding:7px 12px;border-radius:8px;pointer-events:none;
  letter-spacing:.2px;box-shadow:0 2px 8px rgba(0,0,0,.18);
">演示版 · 本地数据，未连接模型</div>
`;
html = html.replace('</body>', `${banner}</body>`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, html, 'utf8');

const size = Buffer.byteLength(html);
console.log(`✅ 已生成 ${OUT_FILE}（${(size / 1024 / 1024).toFixed(2)} MB）`);
console.log('   双击即可在浏览器打开，无需服务器、无需联网。');

// 把 CSS 里的字体引用换成 base64，避免 file:// 下字体加载被拦
function inlineFonts(css) {
  return css.replace(/url\((['"]?)([^)'"]+\.(woff2?|ttf))(['"]?)\)/g, (m, _q, href) => {
    const clean = href.replace(/^\.?\//, '').split('?')[0];
    const file = join(DIST, clean);
    if (!existsSync(file)) return m;
    // 只用 woff2：woff/ttf 是给老浏览器的兜底，内联它们会让文件翻倍。
    // 缺了它们只是老浏览器上公式字体退化，不影响主体功能。
    if (!clean.endsWith('.woff2')) return 'url()';
    const b64 = readFileSync(file).toString('base64');
    return `url(data:font/woff2;base64,${b64})`;
  });
}