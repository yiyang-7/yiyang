import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 目录部署需要绝对路径 /assets/...，
 * 但演示版要能从 file:// 双击打开，必须用相对路径。
 * 两者靠 VITE_DEMO 区分。
 */
const isDemo = process.env.VITE_DEMO === '1';

export default defineConfig({
  plugins: [react()],

  // 演示版：相对路径 + 打成一个 chunk。
  // file:// 下浏览器会用 CORS 规则拦截外部 <script type="module" src>，
  // 所以必须把所有代码收敛成单文件，再在构建后内联进 HTML。
  base: isDemo ? './' : '/',
  build: isDemo
    ? {
        rollupOptions: {
          output: {
            // 不分包：动态 import 也内联，保证产物只有一个 js
            inlineDynamicImports: true,
            entryFileNames: 'app.js',
            assetFileNames: 'app.[ext]',
          },
        },
        // 关掉 sourcemap，减小单文件体积
        sourcemap: false,
        cssCodeSplit: false,
      }
    : {},

  server: {
    host: '0.0.0.0',
    port: 5173,
    // 前端 5173 直接代理到网关 3090，避免浏览器跨域。
    // 走代理后前端只请求 /api/*，不需要任何 CORS 配置。
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3090',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
        // 后端没启动时代理默认回 HTML 500，前端只能看到「HTTP 500」，
        // 判断不出是「连不上」。改写成 503 + JSON，前端才能给出正确提示。
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if (!res || res.writableEnded || typeof res.writeHead !== 'function') return;
            res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(
              JSON.stringify({
                error: '当前网络不可用，无法连接服务端',
                code: 'NETWORK',
              }),
            );
          });
        },
      },
    },
  },
});