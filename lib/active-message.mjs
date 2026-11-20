/**
 * 主动消息（Active Message）。
 *
 * 让 dsh 进程在没有用户请求的情况下，按人设主动说一句话。
 * 触发源是定时器，不是 HTTP —— 所以这条路径上没有 SSE、没有客户端连接，
 * 内容只能靠落库 + 未读计数送达用户。
 *
 * 关键约束：
 *   - 必须拿会话的轮次锁。dsh 进程是常驻的，人和定时器同时往里写 prompt，
 *     两边回复会串在一起，聊天记录直接乱掉。
 *   - 冷启动要回灌历史。进程被回收后（空闲超时），主动消息若直接发 prompt，
 *     模型看不到之前的对话，问候会像失忆一样自顾自说话。
 *   - 落库时标记未读。用户此刻通常不在看，红点是他唯一的提示。
 */
import { acquireTurn, extractText } from './chat-route.mjs';
import { formatTranscript, buildPrimedPrompt } from './history-store.mjs';

/** 一次主动消息默认最多等多久。比普通轮次短：没人等它，卡住就该放弃。 */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * 驱动一轮「无用户触发的」对话。
 *
 * @param {object} opts
 * @param {string} opts.conversationId
 * @param {string} opts.prompt         内部 prompt（不是用户说的话）
 * @param {object} opts.history        HistoryStore
 * @param {object} [opts.contacts]     ContactsStore
 * @param {Function} opts.getProcess   acquireProcess 或同形状实现
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.historyLimit] 冷启动回灌多少条
 * @returns {Promise<{conversationId, text, thinking, thinkingMs, messageId, primed, durationMs}>}
 */
export async function runActiveTurn({
  conversationId,
  prompt,
  history,
  contacts,
  getProcess,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  historyLimit = 20,
  cwd,
}) {
  if (!conversationId) throw new Error('缺少 conversationId');
  if (!prompt?.trim()) throw new Error('缺少 prompt');
  if (!history) throw new Error('缺少 history');
  if (typeof getProcess !== 'function') throw new Error('缺少 getProcess');

  const startedAt = Date.now();

  // 会话必须已经存在：主动消息是「延续」一段对话，不是发起一段。
  // 对不存在的会话硬发，会创造出一个联系人信息、历史全空、
  // 用户从没见过的新会话 —— 界面上凭空冒出一条消息。
  const session = history.getConversation(conversationId);
  if (!session) {
    throw Object.assign(
      new Error(`会话不存在，跳过主动消息：${conversationId}`),
      { code: 'NO_CONVERSATION' },
    );
  }

  const releaseTurn = await acquireTurn(conversationId);
  let unsub = () => {};
  let timer;
  try {
    // ── 人设：与 /chat 一致，只来自联系人表 ──────────────────────────
    const contact = contacts?.get(session.contactId) ?? null;
    const resolvedPersona = contact
      ? { prefix: contact.systemPrompt?.trim() || null, suffix: null }
      : null;

    // 拿锁之后再读历史，才读得全（别的轮次可能刚写回）
    const prior = history.tail({ conversationId, limit: historyLimit });

    const acquired = await getProcess(conversationId, {
      userId: session.userId,
      cwd,
      persona: resolvedPersona,
      contact,
    });
    const agent = acquired.agent ?? acquired;
    const isNew = acquired.isNew ?? agent.fresh === true;

    // 冷启动回灌：老进程内部已经存着这些轮次，不能再喂一遍
    const primed = isNew && prior.length > 0;
    let promptText = prompt;
    if (primed) {
      const { transcript } = formatTranscript(prior);
      promptText = buildPrimedPrompt({ transcript, message: prompt });
    }

    const reply = [];
    let thinkStartAt = 0;
    let thinkEndAt = 0;

    // 写库一次性完成：和 /chat 一样不逐片写。
    // 这里没有流式消费者，攒在内存里攒完再写。
    const done = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        reject(Object.assign(
          new Error(`主动消息超时（${timeoutMs}ms）`),
          { code: 'TIMEOUT' },
        ));
      }, timeoutMs);
      timer.unref?.();

      unsub = agent.subscribe((method, params) => {
        if (method !== 'session.event') return;
        const ev = params.event;

        for (const t of extractText(ev)) {
          if (thinkStartAt && !thinkEndAt) thinkEndAt = Date.now();
          reply.push(t);
        }
        // 思考内容对主动消息无意义，但要记录思考开始时间，
        // 否则 thinkingMs 恒为 0，和普通消息的数据形状不一致。
        if (ev?.type === 'assistant/thinking') {
          if (!thinkStartAt) thinkStartAt = Date.now();
        }

        if (ev?.type === 'turn/end') {
          const reason = ev?.data?.reason;
          if (reason?.kind === 'error') {
            reject(Object.assign(
              new Error(reason.error?.message ?? '轮次失败'),
              { code: reason.error?.code ?? 'TURN_ERROR' },
            ));
          } else {
            resolve();
          }
        }
      });
    });

    await agent.prompt(promptText);
    await done;

    const text = reply.join('');
    if (!text.trim()) {
      // 空回复不落库，否则界面上出现一个空气泡
      throw Object.assign(new Error('主动消息得到空回复'), { code: 'EMPTY_REPLY' });
    }

    const thinkingMs = thinkStartAt
      ? Math.max(0, (thinkEndAt || Date.now()) - thinkStartAt)
      : 0;

    // ── 落库并标记未读 ───────────────────────────────────────────────
    // viewing: false 是这里的重点：用户不在看（否则也不会需要主动消息），
    // 这条必须点亮红点。finalizeMessage 内部据此 +1 未读数。
    const messageId = history.appendMessage({
      conversationId,
      role: 'assistant',
      content: text,
      status: 'completed',
      thinkingMs,
      viewing: false,
    });

    return {
      conversationId,
      contactId: session.contactId,
      text,
      thinkingMs,
      messageId,
      primed,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
    unsub();
    releaseTurn();
  }
}