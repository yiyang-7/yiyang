/**
 * /chat 接口
 *
 * 参考代码的写法和这里逐条对照，见注释里的【改动 N】。
 */

import {
  acquireProcess,
  closeSession,
  poolSnapshot,
  stopReaper,
  IDLE_TIMEOUT,
} from './session-pool.mjs';
import { formatTranscript, buildPrimedPrompt } from './history-store.mjs';

/**
 * 冷启动时从数据库取多少条历史喂给新进程。
 *
 * 只取最近 10 条：更早的对话对当前轮次贡献很低，而每多一条都在消耗
 * 上下文预算、推高首轮延迟和费用。需要更长记忆时调大这个值即可。
 */
const HISTORY_LIMIT = Number(process.env.DSH_HISTORY_LIMIT ?? 10);

/**
 * 会话级轮次锁。
 *
 * 一个 dsh 进程同时只能处理一个轮次，而它的 session.event 会**广播给所有
 * 订阅者**。多端（手机 + 电脑）同时对同一 conversationId 发消息时，两个请求
 * 都订阅同一个进程，于是各自都会收到对方轮次的 delta——回复互相串台。
 *
 * 实测（未加锁）：
 *   手机收到 [手机-0][电脑-0][手机-1][电脑-1]
 *   电脑收到 [电脑-0][手机-1][电脑-1]
 *
 * 加锁后同一会话的轮次串行：只有当前轮次的请求处于订阅状态。
 * 顺带解决了「记忆断层」——串行意味着电脑那轮开始前，手机那轮已完整写进
 * 进程内存和数据库，dsh 自己就能看到。
 */
const turnChains = new Map();

/**
 * @param {string} conversationId
 * @returns {Promise<() => void>} 释放函数（幂等）
 *
 * 导出给主动消息调度器用：它和 HTTP 请求抢的是同一个 dsh 进程，
 * 不拿这把锁就会两边同时往 stdin 写 prompt，回复串话。
 */
export function acquireTurn(conversationId) {
  const prev = turnChains.get(conversationId) ?? Promise.resolve();
  let releaseCurrent;
  const gate = new Promise((resolve) => { releaseCurrent = resolve; });
  const mine = prev.then(() => gate);
  turnChains.set(conversationId, mine);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseCurrent();
    // 只有自己是链尾时才清理，否则会把排队的后继者踢出队列
    if (turnChains.get(conversationId) === mine) turnChains.delete(conversationId);
  };
  return prev.then(() => release);
}

/**
 * 从会话事件里抽**助手**文本增量。
 *
 * 不能对所有事件无脑读 data.content —— user/message 与 runtime-context
 * 也带 content，会把用户自己的输入和运行时上下文当成回复推给客户端。
 * 实测踩过：发"我叫啥"时 delta 里回流了"我叫啥"整句。
 *
 * 只认 assistant 来源的事件：assistant/message、assistant/attempt 的增量块。
 */
export function extractText(ev) {
  const type = ev?.type;
  if (typeof type !== 'string' || !type.startsWith('assistant/')) return [];

  const out = [];
  const pushBlocks = (blocks) => {
    if (!Array.isArray(blocks)) return;
    for (const b of blocks) {
      if (b && b.type === 'text' && typeof b.text === 'string') out.push(b.text);
    }
  };

  // 完整消息形态
  pushBlocks(ev?.data?.message?.content);
  pushBlocks(ev?.data?.content);

  // 流式增量形态：data.stream[] 里 type='chunk' 的 chunk
  if (Array.isArray(ev?.data?.stream)) {
    for (const item of ev.data.stream) {
      if (!item || item.type !== 'chunk') continue;
      const c = item.chunk;
      if (!c) continue;
      if (typeof c.text === 'string') out.push(c.text);
      pushBlocks(c.content);
      if (c.delta && typeof c.delta.text === 'string') out.push(c.delta.text);
    }
  }
  return out;
}

/**
 * 从会话事件里抽**深度思考**文本增量。
 *
 * 与 extractText 完全对称，只是认推理块而不是正文块。
 * DSH 里推理内容的形态不止一种，这里都兜住：
 *   - content 块 type='thinking' / 'reasoning'（与 'text' 并列）
 *   - 流式 chunk 上的 reasoningContent / reasoning_content 字段
 *
 * 当前模型（deepseek-chat / V3）不产这类内容，所以通常返回空数组；
 * 换 R1 系列模型后这里才会开始有东西，前端面板也随之出现。
 */
export function extractThinking(ev) {
  const type = ev?.type;
  if (typeof type !== 'string' || !type.startsWith('assistant/')) return [];

  const REASONING_TYPES = new Set(['thinking', 'reasoning']);
  const out = [];

  const pushBlocks = (blocks) => {
    if (!Array.isArray(blocks)) return;
    for (const b of blocks) {
      if (!b || !REASONING_TYPES.has(b.type)) continue;
      if (typeof b.text === 'string') out.push(b.text);
      else if (typeof b.thinking === 'string') out.push(b.thinking);
      else if (typeof b.reasoning === 'string') out.push(b.reasoning);
    }
  };

  const pushChunk = (c) => {
    if (!c) return;
    if (typeof c.reasoningContent === 'string') out.push(c.reasoningContent);
    if (typeof c.reasoning_content === 'string') out.push(c.reasoning_content);
    pushBlocks(c.content);
  };

  pushBlocks(ev?.data?.message?.content);
  pushBlocks(ev?.data?.content);

  if (Array.isArray(ev?.data?.stream)) {
    for (const item of ev.data.stream) {
      if (!item || item.type !== 'chunk') continue;
      pushChunk(item.chunk);
    }
  }
  return out;
}

/**
 * 安装 /chat 到 express app。
 * @param {import('express').Express} app
 */
export function mountChat(app, {
  healthz,
  history,
  contacts,
  presence = null,
  getProcess = acquireProcess,
  turnTimeoutMs = Number(process.env.DSH_TURN_TIMEOUT_MS ?? 300_000),
} = {}) {
  app.post('/chat', async (req, res) => {
    // 【改动 6】参考代码没校验入参，conversationId 缺失时会变成 "undefined"
    // 并悄悄共用一个进程；message 缺失会往 stdin 写 "undefined"。
    // 注意：不再从 body 读取 persona。
    // 人设必须来自 ai_contacts 表——否则调用方可以注入任意 system prompt。
    // viewingConversationId：前端此刻正在看的会话（不是这条消息所属的会话）。
    // 两者不同 → 用户已经切走了 → 这条回复落库时要计未读。
    // 不传则视为「正在看」，因为同步发起的请求基本都来自当前视图。
    const {
      conversationId, message, userId, contactId, cwd, images,
      viewingConversationId,
      // regenerate：重新生成。服务端要先撤回上一轮的 AI 回复，
      // 并且**不重复写**用户消息——否则同一句话在历史里出现两次，
      // 下次冷启动回灌时模型会看到用户连说了两遍同样的话。
      regenerate = false,
    } = req.body ?? {};
    if (typeof conversationId !== 'string' || !conversationId.trim()) {
      return res.status(400).json({ error: '缺少 conversationId' });
    }
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: '缺少 message' });
    }

    const convId = conversationId.trim();
    const uid = typeof userId === 'string' && userId.trim() ? userId.trim() : 'anon';

    // 联系人必须在写 SSE 头之前解析：请求了不存在的人设应该得到 400，
    // 而不是一个已经开始推流、再报错的响应。
    if (contacts && contactId && !contacts.get(contactId)) {
      return res.status(400).json({ error: `联系人不存在: ${contactId}` });
    }

    // 归属校验必须在写 SSE 头之前做。
    // 一旦 flushHeaders()，403 就只能变成一个 error 事件，状态码已经发出去了。
    if (history) {
      const existing = history.getConversation(convId);
      if (existing && existing.userId !== uid) {
        return res.status(403).json({ error: '该会话属于其他用户' });
      }
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event, data) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // 【改动 7】参考代码的 onData 每请求都 addListener，但只在 'close' 时移除。
    // SDK 进程不会自己 close（它是常驻的），监听器无限累积：
    // 同一会话第 N 轮会有 N 个监听器同时写同一个 res，客户端收到重复 + 串话。
    // 这里用 subscribe() 返回的 unsubscribe，每个请求各自干净地挂/摘。
    let unsub = () => {};
    let settled = false;
    let heartbeat;

    let releaseTurn = () => {};
    let turnTimer;
    // 提到外层：res 'close' 处理器要用它把已收到的部分落库。
    // 定义在 try 内的话，close 回调访问会撞 TDZ。
    let flushAssistant = () => {};

    const finish = (event, data) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(turnTimer);
      send(event, data);
      res.end();
      unsub();
      releaseTurn();          // 必须在所有出口释放，否则该会话永久卡住
    };

    // 心跳：防代理/网关把空闲连接掐掉
    heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, 15_000);

    // 客户端主动断开（关标签页 / AbortController）时清理监听，但不杀进程——
    // 进程属于会话，下一轮还要复用。
    // 注意：必须挂在 res 上，不能挂 req。Express 5 里请求体读完后 req 会先触发
    // 'close'，挂 req 会导致连接一建立就被判定为"客户端已断开"，
    // 后续所有 SSE 帧都被 settled 拦掉，客户端只看到半截流然后挂死。
    res.on('close', () => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(turnTimer);
      unsub();
      // 客户端断开不代表内容没价值：已经推出去的部分照样落库，
      // 但状态标 interrupted——这一轮并没有正常走完
      flushAssistant?.('interrupted');
      releaseTurn();
    });

    try {
      // ── 步骤 0：同一会话的轮次串行 ──────────────────────────────────
      // 拿锁后才能读历史：否则并发时第二个请求读到的可能是第一轮还没写回
      // 助手回复的半截状态，冷启动回灌就会缺内容。
      const queued = turnChains.has(convId);
      if (queued) {
        send('status', { state: 'queued', message: '该会话正在处理上一轮，已排队' });
      }
      releaseTurn = await acquireTurn(convId);
      if (settled) { releaseTurn(); return; }   // 排队期间连接已断

      turnTimer = setTimeout(() => {
        console.log(`[超时] 会话 ${convId} 轮次超过 ${turnTimeoutMs}ms，杀掉进程`);
        // 进程可能已经卡死，杀掉更安全：下次请求会冷启动并从库里回灌
        try { closeSession(convId); } catch {}
        finish('error', { message: `轮次超时（${turnTimeoutMs}ms）`, code: 'TIMEOUT' });
      }, turnTimeoutMs);

      // ── 步骤 1：先落库 ────────────────────────────────────────────────
      // 「每次 /chat 收到消息」先存用户这句话，不等模型回复。
      // 先读历史再写本轮，否则冷启动回灌的 transcript 里已经含本轮消息，
      // 又在「用户现在说：」后重复一遍，模型会看到同一句话两次。
      // 注意读的是「本轮之前」的历史，limit 用 HISTORY_LIMIT。
      let session = null;
      let prior = [];
      let userMessageId;
      let contact = null;
      // 真正发给模型的那句话。重新生成时它是数据库里那条用户消息，
      // 而不是请求体里的 message —— 两者可能不一致。
      let userMessageText = message;

      if (history) {
        session = history.ensureConversation({
          conversationId: convId,
          userId: uid,
          contactId: contactId ?? 'default',
        });
        // 用**会话已绑定**的 contactId，而不是本次请求里的：
        // 一个会话换人设会让历史对话语义错乱，绑定后不可变。
        contact = contacts?.get(session.contactId) ?? null;
        userMessageText = message;

        if (regenerate) {
          // 撤回上一轮回复，并复用已被撤回的那条用户消息，
          // 不再插入新的。content 以数据库里那条为准：
          // 前端传来的 message 可能是占位或已被编辑，重发要以历史为准。
          const rewound = history.rewindLastReply({ conversationId: convId });
          if (rewound.userMessage) {
            userMessageId = rewound.userMessage.id;
            userMessageText = rewound.userMessage.content;
            console.log(
              `[重新生成] ${convId} 撤回 ${rewound.removed} 条回复，复用用户消息 ${userMessageId}`,
            );
          } else {
            // 没有可撤回的（历史为空）→ 退化成普通发送
            console.log(`[重新生成] ${convId} 没有可撤回的回复，按普通消息处理`);
          }
        }

        // 先读历史再写本轮，否则冷启动回灌的 transcript 里已经含本轮消息
        prior = history.tail({ conversationId: convId, limit: HISTORY_LIMIT });

        if (!regenerate || userMessageId === undefined) {
          userMessageId = history.appendMessage({
            conversationId: convId,
            role: 'user',
            content: userMessageText,
          });
        }
      }

      // 用户是否正看着这个会话。这条请求本身就来自当前视图，
      // 所以默认 true；只有显式上报了另一个会话才认为他切走了。
      //
      // 注意判据是「上报的会话 ≠ 本条消息的会话」，而不是「没上报」：
      // 前端在流式期间切换会话会上报新的 viewingConversationId，
      // 此时旧会话的回复落库才算未读 —— 这正是未读计数存在的意义。
      // 判据优先级：
      //   1. presence —— 服务端独立维护的"此刻在哪"，能反映请求处理期间的切换
      //   2. 请求体里的 viewingConversationId —— 请求发出那一刻的视图
      //   3. 两者都没有 → 认为在看（同步请求基本都来自当前视图）
      const reportedView = typeof viewingConversationId === 'string'
        ? viewingConversationId.trim()
        : '';

      // 必须是**函数**而不是常量：落库发生在流结束那一刻，
      // 而用户完全可能在生成期间切走。请求开始时算一次的话，
      // 这个字段就退化成"他发消息时在哪"，永远为 true，未读永远不 +1。
      const isViewingNow = () => {
        // presence 有记录时，以它为准 —— 它能反映"请求处理期间用户切走了"。
        // 没记录（前端还没上报 / 客户端不是我们的前端）时，退化成按请求体判断：
        // 同步发起 /chat 的人，基本都正看着这个会话。
        // 不退化会有个严重后果：所有客户端都没上报时，每条回复都 +1，
        // 连用户正盯着的那个会话也亮红点。
        if (presence) {
          if (presence.isViewing(uid, convId)) return true;
          // 明确离开、或在看别的会话 → 不在看这个
          if (presence.isAway(uid) || presence.current(uid) !== null) return false;
        }
        return reportedView === '' || reportedView === convId;
      };

      // ── 步骤 2 + 3：找进程，并判断是不是新起的 ──────────────────────
      // getProcess 返回 { agent, isNew }。isNew 是获取时刻的快照，
      // 不是挂在 agent 上的可变态——后者在并发下会被别的请求覆盖。
      // 人设只来自联系人表。同一 conversationId 永远对应同一联系人，
      // 因此「同一用户 + 不同 AI」天然落到不同进程（池 key 是 conversationId）。
      const resolvedPersona = contact
        ? { prefix: contact.systemPrompt?.trim() || null, suffix: null }
        : null;

      const acquired = await getProcess(convId, {
        userId: uid,
        cwd,
        persona: resolvedPersona,
        contact,
      });
      const agent = acquired.agent ?? acquired;
      const isNew = acquired.isNew ?? agent.fresh === true;

      // 新进程（刚拉起 / 之前被杀 / 被回收）→ 把最近 HISTORY_LIMIT 条
      // 历史打包成一段上下文喂给它，恢复记忆。
      // 老进程 → Harness 内部已经累积了这些轮次，直接发，不要再喂一遍。
      const primed = isNew && prior.length > 0;
      let promptText = userMessageText;
      if (primed) {
        const { transcript, included, truncated } = formatTranscript(prior);
        promptText = buildPrimedPrompt({ transcript, message });
        console.log(
          `[历史] 冷启动回灌 ${included} 条${truncated ? '（已截断）' : ''} → ${convId}`,
        );
        // 排查用：DSH_DEBUG_PROMPT=1 时打印真正发给 dsh 的文本
        if (process.env.DSH_DEBUG_PROMPT === '1') {
          console.log('[历史] 实际 prompt ↓\n' + promptText.replace(/^/gm, '  │ '));
        }
      }

      send('ready', {
        conversationId: convId,
        contactId: session?.contactId ?? contactId ?? 'default',
        userMessageId,
        isNewProcess: isNew,
        sessionsRoot: agent.meta?.sessionsRoot,
        historyReplayed: primed ? prior.length : 0,
      });

      // ── 流式回复：边推边攒，结束时一次性写库 ──────────────────────
      // 不逐 delta 写库：那是 O(n²) 的写放大，而且 SQLite 单写者，
      // 高频写会把库锁住，拖慢同进程里的其它会话。
      // 只在开始时建一条 status='streaming' 的占位行（两次写：占位 + 收尾）。
      const fullReply = [];
      // 深度思考正文单独攒，收尾时和正文一起写库（同样不逐片写）
      const fullThinking = [];
      let thinkStartAt = 0;
      let thinkEndAt = 0;
      const eventCounts = {};
      let assistantMessageId;

      if (history) {
        assistantMessageId = history.createMessage({
          conversationId: convId,
          role: 'assistant',
          status: 'streaming',
        });
      }

      // 客户端断连时也要收尾，否则库里留下永远 streaming 的孤儿行
      flushAssistant = (finalStatus) => {
        if (!history || !assistantMessageId) return;
        const body = fullReply.join('');
        if (!body.trim()) {
          history.deleteMessage({ id: assistantMessageId });
        } else {
          history.finalizeMessage({
            id: assistantMessageId,
            content: body,
            status: finalStatus ?? 'interrupted',
            thinking: fullThinking.join(''),
            thinkingMs: thinkStartAt ? Math.max(0, (thinkEndAt || Date.now()) - thinkStartAt) : 0,
            conversationId: convId,
            viewing: isViewingNow(),
          });
        }
        assistantMessageId = undefined;
      };

      unsub = agent.subscribe((method, params) => {
        if (method === 'session.event') {
          const ev = params.event;
          const type = ev?.type;
          eventCounts[type] = (eventCounts[type] ?? 0) + 1;

          // 深度思考先处理：它总在该轮正文之前产出
          for (const t of extractThinking(ev)) {
            if (!thinkStartAt) thinkStartAt = Date.now();
            fullThinking.push(t);
            send('reasoning', { text: t });
          }

          for (const t of extractText(ev)) {
            // 第一片正文 = 思考结束的时刻
            if (thinkStartAt && !thinkEndAt) thinkEndAt = Date.now();
            fullReply.push(t);          // 只进内存，不写库
            send('delta', { text: t });
          }

          // 轮次结束的确定性信号。
          // 参考代码把 SSE 的 [DONE] 挂在进程 'close' 上，那是进程死亡，
          // 不是一轮结束——常驻进程下它永远不发，请求会一直挂着直到超时。
          if (type === 'turn/end') {
            const reason = ev?.data?.reason;
            if (reason?.kind === 'error') {
              // 失败时保留已经产生的部分文本，状态记为 failed；
              // 一个字都没有则连行都不留。
              flushAssistant('failed');
              finish('error', {
                message: reason.error?.message ?? '轮次失败',
                code: reason.error?.code,
              });
            } else {
              // 流结束：把 fullReply 一次性写成 assistant 记录
              const body = fullReply.join('');
              const thinkingBody = fullThinking.join('');
              const thinkingMs = thinkStartAt
                ? Math.max(0, (thinkEndAt || Date.now()) - thinkStartAt)
                : 0;
              const finishedId = assistantMessageId;
              if (history && body.trim()) {
                history.finalizeMessage({
                  id: assistantMessageId,
                  content: body,
                  status: 'completed',
                  thinking: thinkingBody,
                  thinkingMs,
                  conversationId: convId,
                  viewing: isViewingNow(),
                });
                assistantMessageId = undefined;
              } else {
                flushAssistant('failed');    // 空回复不落库
              }
              finish('done', {
                text: body,
                // 思考全文与耗时一并回传，前端用它校准打字机里攒下的内容
                thinking: thinkingBody,
                thinkingMs,
                eventCounts,
                userMessageId,
                // 用收尾前的 id：上面已把变量清空，避免断连回调重复收尾
                assistantMessageId: finishedId,
              });
            }
          }
          return;
        }
        if (method === 'session.status') {
          send('status', params);
          return;
        }
        if (method === 'subagent.started' || method === 'subagent.finished') {
          send('subagent', { method, ...params });
        }
      });

      // 【改动 5 续】参考代码 `stdin.write(message + '\n')` 是纯文本写法。
      // SDK profile 收的是 JSON-RPC 请求，裸文本会解析失败被当成畸形行丢弃，
      // 表现为"发出去没反应"。这里走 prompt() 发结构化请求。
      const receipt = await agent.prompt(promptText, images);
      send('accepted', receipt);
    } catch (err) {
      finish('error', { message: err.message, code: err.code, stage: err.stage });
    }
  });

  // 其余辅助接口
  // 健康检查：调用方可以传自己的实现，避免重复注册导致后注册的被屏蔽
  app.get('/healthz', (_req, res) => {
    if (healthz) return res.json(healthz());
    res.json({
      ok: true,
      idleTimeoutMs: IDLE_TIMEOUT,
      sessions: poolSnapshot(),
    });
  });

  /**
   * 只读拉取会话历史（客户端刷新页面后恢复气泡用）。
   * 同样做归属校验。
   */
  /**
   * 历史消息的唯一实现。
   *
   * 两条路径共用它，避免各写一遍后逻辑漂移：
   *   GET /conversations/:conversationId/messages?userId=
   *   GET /messages?conversationId=&userId=
   */
  const readMessages = (conversationId, query, res) => {
    if (!history) return res.status(501).json({ error: '未配置历史库' });
    const userId = query.userId;
    if (typeof userId !== 'string' || !userId) {
      return res.status(400).json({ error: '缺少 userId' });
    }
    const conv = history.getConversation(conversationId);
    if (!conv) return res.status(404).json({ error: '会话不存在' });
    if (conv.userId !== userId) return res.status(403).json({ error: '该会话属于其他用户' });

    const limit = Math.min(Number(query.limit ?? 100) || 100, 500);
    res.json({
      conversationId: conv.conversationId,
      contactId: conv.contactId,
      createdAt: conv.createdAt,
      messages: history.recentMessages({ conversationId, limit }),
    });
  };

  app.get('/conversations/:conversationId/messages', (req, res) => {
    readMessages(req.params.conversationId, req.query, res);
  });

  // 查询式写法：GET /api/messages?conversationId=xxx（经 Vite 代理去掉 /api）
  app.get('/messages', (req, res) => {
    const conversationId = req.query.conversationId;
    if (typeof conversationId !== 'string' || !conversationId) {
      return res.status(400).json({ error: '缺少 conversationId' });
    }
    readMessages(conversationId, req.query, res);
  });

  app.delete('/conversations/:conversationId', (req, res) => {
    const ok = closeSession(req.params.conversationId);
    res.json({ ok });
  });

  return { stopReaper };
}