import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ChatInput from '../deepseek/ChatInput.jsx';
import HistorySkeleton from './HistorySkeleton.jsx';
import MessageBubble from '../MessageBubble.jsx';
import { DeepSeekLogo, IconKey, IconMenu, IconNewChat, IconSettings } from '../deepseek/icons.jsx';
import SettingsPanel from '../settings/SettingsPanel.jsx';
import { formatClock, shouldShowTimestamp } from './messageTime.js';
import QuickReplies, { deriveQuickReplies } from './QuickReplies.jsx';
import { getApiKey, getAvatar, isImageAvatar, getName } from '../../services/settings.js';
import { IS_DEMO } from '../../services/api.js';
import styles from './ChatArea.module.css';

/**
 * 主聊天区：顶栏 + 对话列表 + 提示条 + 输入区。
 *
 * 从 App.jsx 拆出来，职责单一：只负责渲染和滚动，不碰会话列表。
 * 会话数据由上层通过 chat 对象传入（useChat 的返回值）。
 */
export default function ChatArea({
  chat,
  contact,
  contacts = [],
  title,
  subtitle,
  onOpenSidebar,
  onNewChat,
  deepThink,
  onToggleDeepThink,
  webSearch,
  onToggleWebSearch,
}) {
  const scrollRef = useRef(null);
  const endRef = useRef(null);
  const stickToBottomRef = useRef(true);

  // 「有新消息」浮标：用户向上翻、离开了底部才出现。
  // 用 state 而不是纯 ref —— 它要驱动渲染，ref 改了不会重渲染。
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('api');
  // 密钥状态要跟着设置面板的保存动作实时变，不能每次渲染都去读 localStorage
  // （读到的是渲染时的快照，保存后不会重渲染）。关面板时刷新一次。
  const [apiKey, setApiKeyState] = useState(() => getApiKey());
  const refreshApiKey = () => setApiKeyState(getApiKey());

  // 打开设置时指定落在哪一页：钥匙按钮进 API 页，齿轮进外观页。
  const openSettings = (tab) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  const messages = chat.messages;

  // 自定义头像与昵称：本地存档覆盖内置值。
  // 拆成「图片」和「emoji」两条路，Avatar 组件按需选一个渲染。
  const customAvatar = contact?.id ? getAvatar(contact.id) : '';
  const avatarImage = isImageAvatar(customAvatar) ? customAvatar : '';
  const avatarEmoji = customAvatar && !avatarImage ? customAvatar : '';
  const displayName = (contact?.id && getName(contact.id)) || contact?.name;

  // 操作栏只挂在「最后一条 AI 回复」上。
  //
  // 判定用「从末尾往前找到的第一条 AI 消息」而不是「最后一条消息角色为
  // assistant」：用户刚发完、AI 还在思考时，末尾是用户消息，此时不该
  // 给更早的那条 AI 回复挂操作栏——重新生成会撤掉用户刚发的那句话。
  // 所以这里要求它之后没有任何消息。
  let lastAiIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') { lastAiIndex = i; break; }
  }
  // 它必须是列表最后一条，否则说明后面还有用户的新消息
  if (lastAiIndex !== messages.length - 1) lastAiIndex = -1;

  // 快捷回复：根据最后一条 AI 回复 + 当前人设现算。
  //
  // 用 lastLen 作为依赖的一部分，保证流式吐字期间不会每帧重算
  // （消息内容在变但长度没变时没必要算）。真人只在流结束后才看到
  // 建议，所以这里也不随逐字输出抖动。
  // 注意：lastLen 必须先声明。放进 useMemo 的依赖数组时，
  // 它仍是 TDZ（暂时性死区）状态，会抛
  // ReferenceError: Cannot access 'lastLen' before initialization。
  // 压缩后变量名变成单字母，报错信息完全看不出是哪一行。
  const lastLen = messages.length
    ? (messages[messages.length - 1].content || '').length
    : 0;

  const quickReplies = useMemo(
    () => deriveQuickReplies(messages, contact),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages.length, lastLen, contact?.id],
  );

  // 阈值分开：贴底判定（120px）比浮标判定（240px）更宽松。
  // 用同一个阈值的话，稍微往回滚一点浮标就冒出来，
  // 手指还在屏幕上没停稳，很吵。
  const STICK_PX = 120;
  const AWAY_PX = 240;

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = dist < STICK_PX;
    setAwayFromBottom((prev) => {
      // 带回差：进入和退出的阈值不同，避免在边界抖动时反复闪烁
      if (dist > AWAY_PX) return true;
      if (dist < STICK_PX) return false;
      return prev;
    });
  };

  /** 用末尾锚点滚到底 */
  const scrollToEnd = () => {
    endRef.current?.scrollIntoView({ block: 'end' });
  };

  /** 点浮标：回到底部，并恢复自动跟随 */
  const jumpToBottom = useCallback(() => {
    stickToBottomRef.current = true;
    setAwayFromBottom(false);
    // 平滑滚动在部分安卓 WebView 上会被流式布局打断，直接跳更可靠
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    scrollToEnd();
  }, []);

  // 流式追加：每次内容变化都跟随。
  // 依赖必须带 lastLen —— 流式追加不改变数组长度。
  useLayoutEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollToEnd();
  }, [messages.length, lastLen, chat.pendingLabel, chat.error]);

  // 发送瞬间强制贴底（即使之前在翻历史）
  const wasSendingRef = useRef(false);
  useLayoutEffect(() => {
    if (chat.sending && !wasSendingRef.current) {
      stickToBottomRef.current = true;
      scrollToEnd();
    }
    wasSendingRef.current = chat.sending;
  }, [chat.sending]);

  // 历史加载完成：无条件贴底
  useLayoutEffect(() => {
    if (chat.loadingHistory) return;
    stickToBottomRef.current = true;
    scrollToEnd();
  }, [chat.loadingHistory]);

  return (
    // chatEnter：切会话时 App 用 key 重建子树，这里挂一个整体淡入上浮，
    // 避免新内容一帧之内硬替换旧内容（视觉上的「闪现」）。
    <div className={`${styles.chatShell} ${styles.chatEnter}`}>
      <header className={styles.topbar}>
        <button className={styles.navBtn} onClick={onOpenSidebar} aria-label="打开历史对话">
          <IconMenu />
        </button>

        <div className={styles.titleWrap}>
          <span className={styles.title}>{title}</span>
          <span className={styles.titleSub}>
            {!chat.sending && <span className={styles.onlineDot} />}
            {subtitle}
          </span>
        </div>

        <button
          className={styles.navBtn}
          onClick={() => openSettings('api')}
          aria-label="填 API 密钥"
          title="填 API 密钥，换成真实模型回答"
        >
          <IconKey />
        </button>
        <button
          className={styles.navBtn}
          onClick={() => openSettings('avatar')}
          aria-label="设置"
        >
          <IconSettings />
        </button>
        <button className={styles.navBtn} onClick={onNewChat} aria-label="新对话">
          <IconNewChat />
        </button>
      </header>

      {/* 消息区与浮标共用一个定位容器：浮标要相对「可见的消息区」定位，
          挂在 main 里面会随内容一起滚走，挂在 main 外面又找不到参照。 */}
      <div className={styles.listWrap}>
        <main className={styles.list} ref={scrollRef} onScroll={onScroll}>
          {chat.loadingHistory ? (
            <HistorySkeleton />
          ) : messages.length === 0 ? (
            <Welcome onPick={(t) => chat.send(t)} />
          ) : (
            messages.map((m, i) => (
              <Fragment key={m.id}>
                {shouldShowTimestamp(messages[i - 1], m) && (
                  <div className={styles.timeSep}>
                    <span>{formatClock(m.createdAt)}</span>
                  </div>
                )}
                <MessageBubble
                  message={m}
                  avatar={avatarEmoji || contact?.avatar}
                  avatarImage={avatarImage}
                  avatarSeed={contact?.id}
                  contactName={displayName}
                  useLogo={!contact || contact.id === 'default'}
                  pendingLabel={chat.pendingLabel}
                  showActions={i === lastAiIndex && !chat.sending}
                  onRegenerate={chat.regenerate}
                />
              </Fragment>
            ))
          )}
          {/* 滚动锚点：始终挂在列表末尾，scrollIntoView 才有目标 */}
          <div ref={endRef} className={styles.anchor} />
        </main>

        {awayFromBottom && (
          <button className={styles.jumpBtn} onClick={jumpToBottom}>
            <span>有新消息</span>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M2.5 4.5 L6 8 L9.5 4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        </div>

        {chat.statusHint && <div className={styles.banner}>{chat.statusHint}</div>}

        {/* 密钥状态条：没填就明确告诉用户现在看的是演示数据，
            填了就显示已连接。否则用户会以为「AI 就只会说这几句」。 */}
        {IS_DEMO && (
          <div className={apiKey ? styles.keyBarOn : styles.keyBarOff}>
            <span className={styles.keyBarText}>
              {apiKey ? '已填入 API 密钥，将调用真实模型' : '当前为演示数据 · 填入 API 密钥可换成真实回答'}
            </span>
            <button className={styles.keyBarBtn} onClick={() => openSettings('api')}>
              {apiKey ? '更换' : '去填写'}
            </button>
          </div>
        )}

        {chat.error && (
          <div className={`${styles.banner} ${styles.bannerError}`}>
            <span className={styles.bannerText}>{chat.error}</span>
            <button className={styles.dismiss} onClick={chat.clearError} aria-label="关闭">
              ×
            </button>
          </div>
        )}

        <QuickReplies
          replies={quickReplies}
          onPick={(t) => chat.send(t)}
          visible={!chat.sending && !chat.loadingHistory && !chat.error}
        />

        <ChatInput
          onSend={chat.send}
          onStop={chat.stop}
          sending={chat.sending}
          deepThink={deepThink}
          onToggleDeepThink={onToggleDeepThink}
          webSearch={webSearch}
          onToggleWebSearch={onToggleWebSearch}
        />

      <SettingsPanel
        open={settingsOpen}
        initialTab={settingsTab}
        onClose={() => {
          setSettingsOpen(false);
          refreshApiKey();   // 关闭时同步密钥状态
        }}
        onSaved={refreshApiKey}
        contacts={contacts}
        activeContactId={contact?.id}
      />
    </div>
    );
  }

  const SUGGESTIONS = [
    '帮我写一段自我介绍',
    '解释一下什么是流式输出',
    '这段代码有什么问题',
  ];

  function Welcome({ onPick }) {
    return (
      <div className={styles.welcome}>
        <div className={styles.welcomeLogo}>
          <DeepSeekLogo size={46} />
        </div>
        <h1 className={styles.welcomeTitle}>我是 DeepSeek，很高兴见到你！</h1>
        <p className={styles.welcomeSub}>我可以帮你写代码、读文件、查资料，随时提问</p>

        <div className={styles.suggestions}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className={styles.suggestion} onClick={() => onPick(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }