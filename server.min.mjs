/**
 * 服务端入口（最小版）
 *
 * 就是参考代码那一版的结构，补上校验、按行切帧和轮次结束信号。
 */

import express from 'express';
import { mountChat } from './lib/chat-route.mjs';
import { stopReaper } from './lib/session-pool.mjs';

const app = express();
app.use(express.json({ limit: '25mb' }));

mountChat(app);

const PORT = Number(process.env.PORT ?? 3000);
const server = app.listen(PORT, () => {
  console.log(`服务端已启动：http://localhost:${PORT}`);
});

function shutdown() {
  console.log('[关闭] 清理进程池…');
  server.close();
  stopReaper();
  // 让 reaper 之外的进程也走 kill：直接退出即可，子进程随父进程组结束
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app };