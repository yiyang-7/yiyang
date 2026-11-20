import { useEffect } from 'react';
import SidebarContent from './SidebarContent.jsx';
import styles from './Sidebar.module.css';

/**
 * 历史对话抽屉。
 *
 * 用「抽屉 + 遮罩」而不是常驻侧栏：手机上空间不够常驻侧栏，
 * DeepSeek 官方 App 也是抽屉形态。
 *
 * 交互细节：
 *   - ESC 关闭
 *   - 打开时锁 body 滚动，避免背景跟着滚
 *   - 点击遮罩关闭
 */
export default function Sidebar({
  open,
  onClose,
  sessions = [],
  contacts = [],
  activeConversationId,
  onSelect,
  onNewChat,
  onPickContact,
  loading,
}) {
  // ESC 关闭 + 锁定背景滚动
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button className={styles.backdrop} onClick={onClose} aria-label="关闭侧边栏" />

      <aside className={styles.sidebar} role="dialog" aria-modal="true" aria-label="历史对话">
        <SidebarContent
          sessions={sessions}
          contacts={contacts}
          activeConversationId={activeConversationId}
          onSelect={onSelect}
          onNewChat={onNewChat}
          onPickContact={onPickContact}
          loading={loading}
        />
      </aside>
    </>
  );
}
