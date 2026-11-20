import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError, fetchHistory, markSessionRead, reportPresence, streamChat,
} from '../services/api.js';
import { getConversationId, getUserId, resetConversationId } from '../services/session.js';

/**
 * 打字机节奏控制。
 *
 * 模型的 delta 粒度不可控（一个 delta 可能是半个词，也可能是十几个字），
 * 直接渲染成「整块跳出来」，不像打字机。这里把收到的文本放进队列，
 * 用固定节拍逐个吐出字符。
 *
 * 两个关键点：
 *   1. 追赶机制 —— 队列积压很多时一次多吐几个字，否则长回复会明显落后于网络
 *   2. 流结束后必须 flush —— 否则最后几个字永远吐不出来，气泡看着像没说完
 */
const TYPE_INTERVAL_MS = 16;      // ≈60fps，一次最多吐一组
const MAX_CATCHUP_CHARS = 12;     // 积压超过这个数就加速

export function useChat(contact, activeConversationId) {
  const [messages, setMessages] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [sending, setSending] = useState(false);
  const [statusHint, setStatusHint] = useState(null);
  // 占位气泡里的等待文案：排队中 / 思考中
  const [pendingLabel, setPendingLabel] = useState(null);
  const [error, setError] = useState(null);
  // 新对话时 activeConversationId 是 null：这里不能等，发送时必须已有 id。
  // 先本地生成一个，首条消息发出去后后端会按这个 id 建会话。
  const [conversationId, setConversationId] = useState(
    () => activeConversationId ?? (contact ? getConversationId(contact.id) : null),
  );

  const userId = getUserId();

  // 主动断开流用（组件卸载时）。不断开的话服务端会继续生成，白烧额度。
  const abortRef = useRef(null);
  // 当前流式气泡的 id：用它原地更新，而不是重新 push（否则列表会重排、动画乱跳）
  const streamingIdRef = useRef(null);
  // 打字机队列（正文）
  const queueRef = useRef('');
  // 思考内容队列（reasoning_content），与正文分开吐
  const thinkQueueRef = useRef('');
  // 开始出正文的时间戳：用来算「已深度思考（用时 X 秒）」
  const thinkStartRef = useRef(0);
  const thinkEndRef = useRef(0);
  const timerRef = useRef(null);
  // 流是否已经结束（用于决定什么时候停表）
  const streamDoneRef = useRef(false);
  // 最终全文，流结束后校验用
  const finalTextRef = useRef('');
  const mountedRef = useRef(true);
  // 流式回调是长生命周期的闭包，捕获的是发送那一刻的 conversationId。
  // 新对话的首条消息会在途中拿到真实 id，所以收尾时得读最新值。
  const conversationIdRef = useRef(null);

  // 保持 ref 与 state 同步。三处会 setConversationId（进会话 / 首条消息拿到 id / 新建），
  // 用 effect 统一同步能覆盖全部路径，比在每个调用点手写更不容易漏。
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  /** 从队列取一小段：积压多就多取，追赶网络进度 */
  const takeFrom = (ref, maxCatchup) => {
    const q = ref.current;
    if (!q.length) return '';
    const take = q.length > maxCatchup ? Math.ceil(q.length / 6) : 1;
    ref.current = q.slice(take);
    return q.slice(0, take);
  };

  /**
   * 把队列里的字符吐到气泡上。
   *
   * 双流：思考内容进 thinking，正文进 content，两条队列共用一个定时器。
   * 思考队列优先消费 —— 思考是过程展示，正文是结果，
   * 让结果等着思考慢慢吐完体验很差。
   */
  const startTypewriter = useCallback(() => {
    if (timerRef.current) return;   // 已经在跑了

    timerRef.current = setInterval(() => {
      const id = streamingIdRef.current;
      if (!id) return;

      const thinkChunk = takeFrom(thinkQueueRef, MAX_CATCHUP_CHARS);
      if (thinkChunk) {
        if (!mountedRef.current) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id ? { ...m, thinking: (m.thinking ?? '') + thinkChunk } : m,
          ),
        );
        // 思考一有内容，就说明已经过了「排队中」
        setPendingLabel((cur) => (cur ? null : cur));
        return;
      }

      const chunk = takeFrom(queueRef, MAX_CATCHUP_CHARS);
      if (chunk) {
        if (!mountedRef.current) return;
        // 第一次出正文：记下思考结束时刻
        if (!thinkEndRef.current) thinkEndRef.current = Date.now();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? { ...m, content: m.content + chunk, thinkingStreaming: false }
              : m,
          ),
        );
        return;
      }

      // 两条队列都空了：流也结束就收工，否则等新数据
      if (streamDoneRef.current) stopTypewriter();
    }, TYPE_INTERVAL_MS);
  }, []);

  /**
   * 停表并把两条队列的剩余字符一次性倒出。
   *
   * 必须 flush，否则尾字丢失、气泡看着像没说完。
   * 思考队列也要倒，不然正文出完了但思考面板还缺一截。
   */
  const stopTypewriter = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const id = streamingIdRef.current;
    if (!id || !mountedRef.current) return;

    const restText = queueRef.current;
    const restThink = thinkQueueRef.current;
    queueRef.current = '';
    thinkQueueRef.current = '';
    if (!restText && !restThink) return;

    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        return {
          ...m,
          content: restText ? m.content + restText : m.content,
          thinking: restThink ? (m.thinking ?? '') + restThink : m.thinking,
        };
      }),
    );
  }, []);

  // ── 历史加载 ────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    // 新对话（没有 conversationId）没有历史可拉，直接结束加载态。
    // 早先这里写的是 if (!contact) return —— contact 未就绪时直接返回，
    // loadingHistory 永远停在 true，界面卡在「加载中…」。
    if (!activeConversationId) {
      setMessages([]);
      setLoadingHistory(false);
      return () => {
        cancelled = true;
      };
    }

    setConversationId(activeConversationId);

    // 告诉服务端「我进来了」。必须在拉历史之前发：
    // 如果这条 AI 回复恰好在这期间落库，服务端要知道用户已经在看了。
    reportPresence(userId, activeConversationId);

    (async () => {
      setLoadingHistory(true);
      setError(null);
      try {
        const history = await fetchHistory(activeConversationId, userId);
        if (!cancelled) {
          setMessages(history);
          markSessionRead(activeConversationId, userId);
        }
      } catch (e) {
        if (!cancelled) setError(e.message ?? String(e));
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();

    return () => {
      cancelled = true;
      // 离开这个会话：如果之后没有立刻进入别的会话（切到新建页 / 关闭抽屉），
      // 服务端应该认为"用户不在任何会话"，新回复才会计未读。
      // 这里守卫一下：只有当当前会话仍是自己时才清空，
      // 否则会把"切到另一个会话"误报成"离开全部"。
      if (conversationIdRef.current === activeConversationId) {
        reportPresence(userId, null);
      }
    };
  }, [activeConversationId, userId]);

  // 页面切到后台（切 App / 锁屏）也算离开：此时新回复应该计未读。
  // 用 visibilitychange 而不是 blur —— blur 在点开输入法时也会触发，太吵。
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        reportPresence(userId, conversationIdRef.current ?? null);
      } else {
        reportPresence(userId, null);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [userId]);

  // ── 发送 ────────────────────────────────────
  const send = useCallback(
    async (text, opts = {}) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      // replaceFrom：重新生成时，先把这个 id 及之后的消息从本地列表里撤掉。
      // 用 id 而不是「最后一条」来定位，避免打字机残留或并发插入时机错位。
      if (opts.replaceFrom) {
        const cutAt = opts.replaceFrom;
        setMessages((prev) => {
          const i = prev.findIndex((m) => m.id === cutAt);
          return i === -1 ? prev : prev.slice(0, i);
        });
      }

      // 兜底：新对话还没来得及分配 id，这里补一个并同步到路由，
      // 否则刷新会丢掉这一轮对话。
      let cid = conversationId;
      if (!cid) {
        cid = contact ? getConversationId(contact.id) : `conv-${Date.now()}`;
        setConversationId(cid);
        // replaceState 不触发 hashchange，手动派发一次让路由同步，
        // 否则地址栏变了但界面还认为自己在「新对话」
        window.history.replaceState(null, '', `#/chat/${encodeURIComponent(cid)}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
      const activeContact = contact ?? { id: 'default', name: 'DeepSeek' };

      const abort = new AbortController();
      abortRef.current = abort;

      setSending(true);
      setError(null);
      setStatusHint(null);
      setPendingLabel('DeepSeek 思考中...');

      const now = Date.now();
      const localUserId = `local-user-${now}`;
      const localAssistantId = `local-assistant-${now}`;

      // 重置打字机状态（两条队列都要清）
      queueRef.current = '';
      thinkQueueRef.current = '';
      streamDoneRef.current = false;
      finalTextRef.current = '';
      streamingIdRef.current = localAssistantId;
      thinkStartRef.current = now;
      thinkEndRef.current = 0;

      // 1. 立刻插入用户消息 + 2. 立刻插入空的 AI 占位气泡
      setMessages((prev) => [
        ...prev,
        {
          id: localUserId,
          role: 'user',
          content: trimmed,
          status: 'completed',
          createdAt: now,
        },
        {
          id: localAssistantId,
          role: 'assistant',
          content: '',
          thinking: '',          // 深度思考正文，空串表示没有思考
          thinkingStreaming: false,
          thinkingMs: 0,
          status: 'streaming',   // → 渲染成「排队中 / 思考中」
          isStreaming: true,     // 对外语义字段，渲染层优先看它
          createdAt: now + 1,
        },
      ]);

      startTypewriter();

      const patchAssistant = (fn) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === streamingIdRef.current ? fn(m) : m)),
        );

      try {
        await streamChat(
          {
            conversationId: cid,
            userId,
            message: trimmed,
            contactId: activeContact.id,
            // 告诉服务端「我现在看的是哪个会话」。
            // 正常情况下就是 cid 本身；用户中途切走时这个值不变
            // （发起请求那一刻的视图），服务端据此判断这条回复要不要计未读。
            viewingConversationId: conversationIdRef.current ?? cid,
            // 重新生成：让服务端撤回上一轮回复、复用已存的用户消息，
            // 不再插入一条重复的。不传的话同一句话在历史里会出现两次。
            regenerate: opts.replaceFrom !== undefined,
            signal: abort.signal,
          },
          (event, data) => {
            switch (event) {
              case 'ready': {
                // 服务端给了真实消息 id，替换本地临时 id
                const realId = data.userMessageId;
                if (realId) {
                  setMessages((prev) =>
                    prev.map((m) => (m.id === localUserId ? { ...m, id: realId } : m)),
                  );
                }
                break;
              }

              case 'status': {
                // 后端两种 status 帧：
                //   排队 → { state:'queued', message:'该会话正在处理上一轮，已排队' }
                //   会话状态 → session.status 的参数，没有 state 字段
                // 只有排队时把占位气泡的文案改成「排队中...」，
                // 否则每来一个 session.status 都会把文案冲掉。
                if (data.state === 'queued') {
                  setPendingLabel('排队中...');
                  setStatusHint(data.message ?? null);
                } else {
                  setStatusHint(data.message ?? null);
                }
                break;
              }

              case 'accepted':
                setStatusHint(null);
                setPendingLabel(null);
                break;

              case 'reasoning': {
                // 深度思考内容（reasoning_content / thinking）。
                // 和正文一样只入队，由打字机负责吐。
                const t = data.text ?? '';
                if (t) {
                  thinkQueueRef.current += t;
                  // 一旦开始思考，就不再显示「排队中」
                  setPendingLabel((cur) => (cur ? null : cur));
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === streamingIdRef.current
                        ? { ...m, thinkingStreaming: true }
                        : m,
                    ),
                  );
                }
                break;
              }

              case 'delta': {
                // 只入队，由打字机定时器负责吐字
                const t = data.text ?? '';
                if (t) {
                  queueRef.current += t;
                  // 解析到第一个文本片段后不再显示「排队中/思考中」
                  setPendingLabel((cur) => (cur ? null : cur));
                }
                break;
              }

              case 'done': {
                const full = data.text ?? '';
                const realId = data.assistantMessageId;
                streamDoneRef.current = true;
                finalTextRef.current = full;

                // 等队列吐完再收尾，否则会用到不完整的内容
                const finish = () => {
                  if (!mountedRef.current) return;
                  const id = streamingIdRef.current;
                  if (!id) return;

                  // 两条队列都可能有没吐完的字
                  const typed = queueRef.current;
                  const typedThinking = thinkQueueRef.current;
                  queueRef.current = '';
                  thinkQueueRef.current = '';
                  if (timerRef.current) {
                    clearInterval(timerRef.current);
                    timerRef.current = null;
                  }

                  // 思考时长：优先用真实出正文的时刻，没有正文就用当前时刻
                  const endAt = thinkEndRef.current || Date.now();
                  const thinkingMs = thinkStartRef.current
                    ? Math.max(0, endAt - thinkStartRef.current)
                    : 0;

                  const finalContent = full || typed;
                  if (!finalContent.trim()) {
                    // 空回复不留气泡（只有思考、没有正文也算空）
                    setMessages((prev) => prev.filter((m) => m.id !== id));
                  } else {
                    // 用服务端的全文兜底，保证与服务端落库内容一致
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === id
                          ? {
                              ...m,
                              id: realId ?? m.id,
                              content: finalContent,
                              thinking: typedThinking
                                ? (m.thinking ?? '') + typedThinking
                                : m.thinking,
                              thinkingStreaming: false,
                              thinkingMs,
                              status: 'completed',
                            }
                          : m,
                      ),
                    );
                  }
                  streamingIdRef.current = null;

                  // 自己刚聊完的会话不能算未读。
                  // 服务端落库发生在流结束，而「已读」游标是进页面时推进的，
                  // 于是这条新回复的 created_at 必然大于游标 —— 不补这一下，
                  // 用户在列表里就会看到自己刚说完的话标着"1 条未读"。
                  const convId = conversationIdRef.current;
                  if (convId) markSessionRead(convId, userId);
                };

                // 两条队列任意一条还有字就得等
                const pending = () =>
                  queueRef.current.length > 0 || thinkQueueRef.current.length > 0;

                if (pending()) {
                  // 还有没吐完的字：给它一点时间，最多等 400ms 后强制收尾
                  const deadline = Date.now() + 400;
                  const poll = setInterval(() => {
                    if (!pending() || Date.now() > deadline) {
                      clearInterval(poll);
                      finish();
                    }
                  }, 16);
                } else {
                  finish();
                }
                break;
              }

              case 'error': {
                streamDoneRef.current = true;
                const msg =
                  data.code === 'QUOTA'
                    ? `模型额度不足：${data.message ?? ''}`
                    : (data.message ?? '未知错误');
                setError(msg);

                const id = streamingIdRef.current;
                queueRef.current = '';
                thinkQueueRef.current = '';
                if (timerRef.current) {
                  clearInterval(timerRef.current);
                  timerRef.current = null;
                }
                streamingIdRef.current = null;

                setMessages((prev) => {
                  const target = prev.find((m) => m.id === id);
                  if (target && target.content.trim()) {
                    // 有部分内容就保留并标记失败
                    return prev.map((m) => (m.id === id ? { ...m, status: 'failed' } : m));
                  }
                  // 一个字都没有，连气泡都不留
                  return prev.filter((m) => m.id !== id);
                });
                break;
              }

              default:
                break;
            }
          },
        );
      } catch (e) {
        streamDoneRef.current = true;
        queueRef.current = '';
        thinkQueueRef.current = '';
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        if (e.name === 'AbortError') {
          // 主动离开，不算错误；保留已显示的部分
          const id = streamingIdRef.current;
          setMessages((prev) =>
            prev
              .map((m) => (m.id === id && m.content.trim() ? { ...m, status: 'failed' } : m))
              .filter((m) => !(m.id === id && !m.content.trim())),
          );
        } else {
          setError(
            e instanceof ApiError
              ? e.status === 400
                ? `请求被拒绝：${e.message}`
                : e.message
              : (e.message ?? String(e)),
          );
          const id = streamingIdRef.current;
          setMessages((prev) =>
            prev
              .map((m) => (m.id === id && m.content.trim() ? { ...m, status: 'failed' } : m))
              .filter((m) => !(m.id === id && !m.content.trim())),
          );
        }
        streamingIdRef.current = null;
      } finally {
        if (mountedRef.current) {
          setSending(false);
          setStatusHint(null);
          setPendingLabel(null);
        }
        abortRef.current = null;
      }
    },
    [contact, conversationId, sending, userId, startTypewriter],
  );

  /** 中断当前生成（点停止按钮） */
  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    queueRef.current = '';
    streamDoneRef.current = true;

    const id = streamingIdRef.current;
    streamingIdRef.current = null;
    if (id) {
      setMessages((prev) =>
        prev
          .map((m) => (m.id === id ? { ...m, status: 'interrupted' } : m))
          .filter((m) => !(m.id === id && !m.content.trim())),
      );
    }
  }, []);

  /**
   * 重新生成：撤销最后一条 AI 回复，基于最后一条用户消息重发。
   *
   * 几个必须处理的边界：
   *   - 正在生成时不允许重发，否则会和当前流打架（调用方也会禁用按钮）
   *   - 找不到用户消息（比如历史没加载完）就直接不动，不能瞎发
   *   - 只撤 AI 侧消息，用户自己那句话要留着——他要看到自己问了什么
   */
  const regenerate = useCallback(() => {
    if (sending) return;

    // 从后往前找最后一条用户消息，以及它之后的第一条 AI 回复
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;

    const userMsg = messages[lastUserIdx];
    // 撤掉这条用户消息之后的所有内容（通常是那条 AI 回复）。
    // 用「用户消息的下一条」作为切点：如果它之后没有 AI 回复
    // （比如上一轮失败了），就什么都不撤，直接重发。
    const after = messages[lastUserIdx + 1];
    const replaceFrom = after?.id;

    return send(userMsg.content, replaceFrom ? { replaceFrom } : {});
  }, [messages, sending, send]);

  /** 开始新对话 */
  const startNewChat = useCallback(() => {
    if (!contact) return;
    abortRef.current?.abort();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    queueRef.current = '';
    streamingIdRef.current = null;

    const fresh = resetConversationId(contact.id);
    setConversationId(fresh);
    setMessages([]);
    setError(null);
    setStatusHint(null);
    window.location.hash = `/chat/${encodeURIComponent(fresh)}`;
  }, [contact]);

  return {
    messages,
    loadingHistory,
    sending,
    statusHint,
    pendingLabel,
    error,
    conversationId,
    send,
    stop,
    regenerate,
    startNewChat,
    clearError: () => setError(null),
  };
}