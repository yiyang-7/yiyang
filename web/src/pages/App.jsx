import { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from '../components/sidebar/Sidebar.jsx';
import ChatArea from '../components/chat/ChatArea.jsx';
import { useChat } from '../hooks/useChat.js';
import { fetchSessions } from '../services/api.js';
import { getUserId } from '../services/session.js';
import styles from './App.module.css';

/**
 * 应用外壳：数据编排 + 布局拼装。
 *
 * 职责边界：
 *   App          —— 拉会话列表、持有 UI 开关、处理导航（只管状态，不管 DOM）
 *   ChatArea     —— 主聊天区（顶栏 / 列表 / 提示条 / 输入框 / 滚动）
 *   Sidebar      —— 抽屉外壳（遮罩 / ESC / 锁滚动）
 *   SidebarContent —— 抽屉里的内容（品牌 / 新建 / 历史列表）
 *
 * 侧边栏是叠加抽屉，不占布局宽度。
 */
export default function App({ conversationId, contact, contacts = [], onPickContact, onNavigate }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [deepThink, setDeepThink] = useState(false);
  const [webSearch, setWebSearch] = useState(false);

  const userId = getUserId();
  const chat = useChat(contact, conversationId);

  // ── 历史对话列表 ────────────────────────────
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const list = await fetchSessions({ userId });
      setSessions(Array.isArray(list) ? list : []);
    } catch {
      // 侧栏拉不到历史不该打断主对话，静默失败即可
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // 一轮回答结束后刷新历史（标题/时间会变）
  const prevSendingRef = useRef(chat.sending);
  useEffect(() => {
    if (prevSendingRef.current && !chat.sending) loadSessions();
    prevSendingRef.current = chat.sending;
  }, [chat.sending, loadSessions]);

  // ── 交互 ────────────────────────────────────
  const handleNewChat = () => {
    setSidebarOpen(false);
    if (chat.sending) chat.stop();
    // 回到根路由 = 新对话；不预先分配 conversationId，首条消息时由后端建
    onNavigate({ name: 'new' });
    loadSessions();
  };

  const handleSelectSession = (s) => {
    setSidebarOpen(false);
    if (chat.sending) chat.stop();
    onNavigate({ name: 'chat', conversationId: s.conversationId });
  };

  const title = chat.messages.length > 0 ? (contact?.name || 'DeepSeek') : '新对话';
  // 顶栏副标题：AI 生成中显示「对方正在输入...」，空闲显示在线状态
  const subtitle = chat.sending ? '对方正在输入...' : '在线';

  return (
    <div className={styles.app}>
      <ChatArea
        chat={chat}
        contact={contact}
        title={title}
        subtitle={subtitle}
        onOpenSidebar={() => setSidebarOpen(true)}
        onNewChat={handleNewChat}
        deepThink={deepThink}
        onToggleDeepThink={() => setDeepThink((v) => !v)}
        webSearch={webSearch}
        onToggleWebSearch={() => setWebSearch((v) => !v)}
      />

      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        sessions={sessions}
        contacts={contacts}
        activeConversationId={conversationId}
        onSelect={handleSelectSession}
        onNewChat={handleNewChat}
        onPickContact={(c) => {
          setSidebarOpen(false);
          onPickContact?.(c);
        }}
        loading={sessionsLoading}
      />
    </div>
  );
}