import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
