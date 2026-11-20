/**
 * 消息时间分隔与时间格式化。
 *
 * 微信式规则：相邻两条消息间隔超过 5 分钟才插一条居中的时间条。
 */

const GAP_MS = 5 * 60 * 1000;

export function shouldShowTimestamp(prev, current) {
  if (!prev) return true;                 // 第一条总是显示
  if (!prev.createdAt || !current.createdAt) return false;
  return current.createdAt - prev.createdAt >= GAP_MS;
}

export function formatClock(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';

  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return `昨天 ${hh}:${mm}`;
  }
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}