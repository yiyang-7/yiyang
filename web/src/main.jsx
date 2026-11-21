import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

  // 「新对话」发出首条消息后，路由会从 #/ 变成 #/chat/<新id>。
  // 如果 key 跟着变，App 会整个重建、useChat 的 messages 被清空，
  // 界面看起来像「按了发送没反应」。
  // 这里记住「这是从新对话自动分配来的 id」，让它不参与 key，
  // 等用户真正切到别的会话时再换 key。
  const autoConvRef = useRef(null);
  const prevConvRef = useRef(null);
  if (conversationId !== prevConvRef.current) {
    // 从 null 变成有值 = 首条消息自动分配
    if (prevConvRef.current === null && conversationId) autoConvRef.current = conversationId;
    // 切到别的会话（不是刚自动分配的那个）= 用户主动切换，清掉粘性
    else if (conversationId && conversationId !== autoConvRef.current) autoConvRef.current = null;
    else if (!conversationId) autoConvRef.current = null;
    prevConvRef.current = conversationId;
  }

  // 参与 key 的会话标识：自动分配的那个不参与
  const stableConvKey =
    conversationId && conversationId === autoConvRef.current
      ? 'new'   // 视同还在新对话，避免重建
      : (conversationId ?? 'new');

  return (
    <div className="app-shell">
      <div className="app-frame">
        <App
          // key 让「换会话 / 换人设」时 useChat 状态重建，不串历史。
          //
          // 注意不能直接把 conversationId 放进 key：
          // 新对话里发出首条消息时，conversationId 会从 null 变成新分配的 id，
          // key 一变 App 就整个卸载重建，useChat 的 messages 全被清空——
          // 表现为「在新对话里按发送，界面毫无反应」（消息其实发出去了）。
          //
          // 所以：新对话（route 为 new）时 key 只跟人设走，
          // 进入已有会话后才按会话 id 区分。首条消息落定前后 key 保持不变。
          key={`${stableConvKey}:${activeContact?.id ?? 'default'}`}
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