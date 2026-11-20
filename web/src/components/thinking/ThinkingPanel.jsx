import { useCallback, useEffect, useRef, useState } from 'react';
import { DisclosureRow, StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import styles from './ThinkingPanel.module.css';

/**
 * 深度思考折叠面板 —— 基于官方 primitives 的 DisclosureRow。
 *
 * DisclosureRow 的既定契约（照官方 README）：
 *   - 24px 紧凑行，标题与内容左右排列
 *   - 收起时悬停预览向下箭头，展开后持续显示向上箭头（箭头内建，不用自己实现）
 *   - running=true 时标题走官方 TextShimmer 流光
 *   - 受控组件：open / onToggle 由调用方持有
 *
 * 所以这里只负责：状态推导、图标、以及折叠时的显隐。
 */

// 图标引用要稳定：DisclosureRow 用浅比较 memo，每次新建 React 节点会让它白渲染
const THINK_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 4.5a3 3 0 0 0-3 3v.2A3 3 0 0 0 7 13a3 3 0 0 0 1.6 5.1A2.8 2.8 0 0 0 12 20V4.5Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 4.5a3 3 0 0 1 3 3v.2A3 3 0 0 1 17 13a3 3 0 0 1-1.6 5.1A2.8 2.8 0 0 1 12 20"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function ThinkingPanel({ text, streaming = false, durationMs }) {
  // null = 还没手动点过，跟随 streaming 自动推导；true/false = 用户的选择
  //
  // 不用「useEffect 里 setOpen(false)」折叠：首帧渲染时 effect 还没跑，
  // 已结束的思考会先闪一下展开状态。派生出来就没有这一帧。
  const [manual, setManual] = useState(null);
  const contentRef = useRef(null);

  const open = manual !== null ? manual : streaming;
  const toggle = useCallback(
    () => setManual((v) => !(v !== null ? v : streaming)),
    [streaming],
  );

  // 思考内容流式增长时，面板内部也要跟到底
  useEffect(() => {
    if (!open || !streaming) return;
    const el = contentRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, open, streaming]);

  const seconds =
    durationMs != null ? Math.max(1, Math.round(durationMs / 1000)) : null;

  const title = streaming
    ? '思考中...'
    : seconds != null
      ? `已深度思考（用时 ${seconds} 秒）`
      : '已深度思考';

  return (
    <div className={styles.wrap}>
      <DisclosureRow
        icon={THINK_ICON}
        title={title}
        open={open}
        expandable
        onToggle={toggle}
        running={streaming}
        expandOnRowClick
      >
        <div className={styles.body} ref={contentRef}>
          <div className={styles.text}>
            {text}
            {streaming && <StateDot state="ongoing" />}
          </div>
        </div>
      </DisclosureRow>
    </div>
  );
}