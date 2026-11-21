import { DeepSeekLogo, IconChat, IconNewChat } from '../deepseek/icons.jsx';
import styles from './SidebarContent.module.css';

/**
 * 侧边栏内容：品牌、新建入口、历史对话列表、页脚。
 *
 * 与外壳（抽屉遮罩、滑入动画、ESC、锁滚动）分开，
 * 外壳在 Sidebar.jsx。分开的好处是换外壳时这里不用动。
 */
export default function SidebarContent({
  sessions = [],
  contacts = [],
  activeConversationId,
  onSelect,
  onNewChat,
  onPickContact,
  loading,
}) {
  return (
    <>
      <div className={styles.brand}>
        <DeepSeekLogo size={22} />
        <span className={styles.brandName}>lume</span>
      </div>

      <div className={styles.actions}>
        <button className={styles.actionBtn} onClick={onNewChat}>
          <IconNewChat size={18} />
          开启新对话
        </button>
      </div>

      {/* 人设入口：每个 AI 一个人设，点谁就用谁开新会话。
          人设由服务端 ai_contacts 决定，这里只是选择 switch 了哪个。 */}
      {contacts.length > 0 && (
        <>
          <div className={styles.sectionLabel}>选择 AI</div>
          <div className={styles.contacts}>
            {contacts.map((c) => (
              <button
                key={c.id}
                className={styles.contact}
                onClick={() => onPickContact?.(c)}
                title={c.systemPrompt || '通用助手'}
              >
                <span className={styles.contactAvatar}>{c.avatar || '🤖'}</span>
                <span className={styles.contactName}>{c.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className={styles.sectionLabel}>历史对话</div>

      <div className={styles.list}>
        {loading && sessions.length === 0 ? (
          <div className={styles.empty}>加载中…</div>
        ) : sessions.length === 0 ? (
          <div className={styles.empty}>
            还没有历史对话
            <br />
            发一条消息就会出现在这里
          </div>
        ) : (
          sessions.map((s) => {
            const active = s.conversationId === activeConversationId;
            // 正在看的会话永远不算未读：用户此刻就盯着它，
            // 再挂个红点只会让人以为漏了什么。
            const unread = active ? 0 : (s.unread ?? 0);
            return (
              <button
                key={s.conversationId}
                className={`${styles.item} ${active ? styles.itemActive : ''}`}
                onClick={() => onSelect(s)}
                title={s.title || s.lastMessage}
                aria-label={
                  unread > 0
                    ? `${s.title || s.lastMessage || '新对话'}，${unread} 条未读`
                    : undefined
                }
              >
                <span className={styles.itemIcon}>
                  <IconChat size={16} />
                </span>
                <span className={styles.itemTitle}>
                  {s.title || s.lastMessage || '新对话'}
                </span>
                {unread > 0 && (
                  <span className={styles.badge} aria-hidden="true">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
                <span className={styles.itemTime}>{formatShort(s.lastAt)}</span>
              </button>
            );
          })
        )}
      </div>

      <div className={styles.footer}>本地服务 · 对话存储在本机</div>
    </>
  );
}

/**
 * 会话列表里的时间，按微信的惯例分档：
 *   今天  → 15:42
 *   昨天  → 昨天
 *   本周  → 星期三
 *   更早  → 3/15
 *
 * 不写成「刚刚 / 3 分钟前」：列表会长期挂着不动，
 * 相对时间不刷新就会变成谎话（「刚刚」挂了半小时）。
 */
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function formatShort(ts, now = new Date()) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const t = d.getTime();

  if (t >= startOfToday) {
    // 同一天（含未来时间，时钟不同步时也按今天处理）
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (t >= startOfToday - dayMs) return '昨天';
  if (t >= startOfToday - 6 * dayMs) return WEEKDAYS[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}`;
}