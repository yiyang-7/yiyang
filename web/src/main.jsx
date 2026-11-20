import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './pages/App.jsx';
import { fetchContacts, fetchSessions } from './services/api.js';
import { getConversationId, getUserId } from './services/session.js';
import { goChat, goNew, useRoute } from './hooks/useRoute.js';
import { mountIconSprite } from './components/deepseek/sprite.js';
import './styles/global.css';

// 官方 primitives 的图标是 <use href="#...">，依赖文档内的 <symbol>。
// 必须在首屏渲染前注入，否则折叠面板的箭头会是空白。
mountIconSprite();

/**
 * 入口：只管路由和联系人查找，布局全部交给 pages/App.jsx。
 *
 * 路由两种：
 *   #/                  新对话
 *   #/chat/<convId>     某个历史会话
 */
function Root() {
  const route = useRoute();
  const userId = getUserId();

  const [sessions, setSessions] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);

  // 当前选中的 AI（新建对话时用）。null = 还没选，用 default。
  // 切换 AI 等价于「换一个 contactId 开新会话」：人设绑定在 conversationId 上，
  // 服务端建会话时落库，之后不再变。
  const [pickedContactId, setPickedContactId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionList, contactList] = await Promise.all([
        fetchSessions({ userId }),
        fetchContacts().catch(() => []),
      ]);
      setSessions(Array.isArray(sessionList) ? sessionList : []);
      setContacts(Array.isArray(contactList) ? contactList : []);
    } catch {
      // 拉不到就让 App 用默认人设，不阻塞主界面
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  /** 当前会话对应的联系人。找不到就退回通用助手。 */
  const activeContact = useMemo(() => {
    if (route.name !== 'chat') {
      // 新对话：用用户在上一次选择里挑的 AI
      const picked = pickedContactId && contacts.find((c) => c.id === pickedContactId);
      return picked || contacts.find((c) => c.id === 'default') || null;
    }

    const convId = route.conversationId;
    const session = sessions.find((s) => s.conversationId === convId);
    if (session) {
      return { id: session.contactId, name: session.name, avatar: session.avatar };
    }
    const matched = contacts.find((c) => getConversationId(c.id) === convId);
    if (matched) return { id: matched.id, name: matched.name, avatar: matched.avatar };

    return contacts.find((c) => c.id === 'default') ?? null;
  }, [route, sessions, contacts, pickedContactId]);

  const conversationId = route.name === 'chat' ? route.conversationId : null;

  return (
    <div className="app-shell">
      <div className="app-frame">
        <App
          // key 保证换会话时状态重建，不串历史。
          // 新对话没有 conversationId，光用 'new' 会导致「换了 AI 但 key 没变」，
          // 组件里的 useChat 还攥着上一个人设的 conversationId —— 必须把 contactId 也算进 key。
          key={`${conversationId ?? 'new'}:${activeContact?.id ?? 'default'}`}
          conversationId={conversationId}
          contact={activeContact}
          contacts={contacts}
          onPickContact={(c) => {
            setPickedContactId(c.id);
            // 选完 AI 回到新对话页，之后发的消息就按这个人设走
            goNew();
          }}
          routing={loading}
          onNavigate={(next) => {
            if (next.name === 'chat') goChat(next.conversationId);
            else goNew();
          }}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Root />);