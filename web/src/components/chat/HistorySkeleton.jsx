import styles from './HistorySkeleton.module.css';

/**
 * 历史记录加载骨架屏。
 *
 * 微信的观感：不是一根转圈的进度条，而是「对话已经有形状了，内容还在来」。
 * 所以这里铺几条交替左右的气泡占位块，右边用绿色调的浅色块，
 * 让人一眼看出是自己的消息，整体带一道左→右的流光。
 *
 * 这些都是占位元素，对读屏没有意义，所以整块 aria-hidden，
 * 另用一个 role="status" 的文本节点告诉辅助技术「正在加载」。
 */

// 交替的宽度，模拟长短不一的消息，比等宽五条更像真实对话
const ROWS = [
  { side: 'ai', width: '58%' },
  { side: 'me', width: '42%' },
  { side: 'ai', width: '72%' },
  { side: 'ai', width: '36%' },
  { side: 'me', width: '54%' },
];

export default function HistorySkeleton({ label = '加载中...' }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.rows} aria-hidden="true">
        {ROWS.map((row, i) => (
          <div
            key={i}
            className={`${styles.row} ${row.side === 'me' ? styles.rowMe : ''}`}
          >
            <span className={styles.avatar} />
            <span
              className={`${styles.bubble} ${row.side === 'me' ? styles.bubbleMe : ''}`}
              style={{ width: row.width }}
            />
          </div>
        ))}
      </div>

      <div className={styles.hint} role="status" aria-live="polite">
        {label}
      </div>
    </div>
  );
}