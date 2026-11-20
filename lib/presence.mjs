/**
 * 「用户此刻在看哪个会话」的存在感（presence）。
 *
 * 为什么不能只靠请求体里的 viewingConversationId：
 * 那个值在**请求发出那一刻**就固定了。用户发完消息立刻切到 B 会话，
 * A 的请求体里写的仍然是 A —— 服务端据此判断"他在看 A"，于是不计未读。
 * 可实际上他早就不看了。这正是未读计数唯一有意义的那种场景。
 *
 * 所以需要一个独立的、随时间推进的状态：前端在切换会话时上报，
 * 服务端在写库那一刻查询"此刻他在哪"。
 *
 * 存内存不落库：
 *   - 这是瞬时状态，进程重启后前端会重新上报；
 *   - 落库反而要处理清理、崩溃残留、多端覆盖等一堆问题。
 * 带 TTL：浏览器直接关掉不会发"离开了"的通知，超时即视为不在任何会话。
 */

/** 默认 5 分钟无心跳即视为离开。 */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * @param {object} [opts]
 * @param {number} [opts.ttlMs]
 * @param {() => number} [opts.now] 注入时钟，测试用
 */
export function createPresence({ ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  /** userId -> { conversationId, at } */
  const map = new Map();
  // 显式「离开」的用户。必须和「从未上报」区分开：
  //   从未上报 → 不知道该不该计未读，退化成按请求体判断（保守地算作在看）
  //   明确离开 → 用户说他不看了，回复就该计未读
  // 早期版本用 map.delete 表示离开，结果两种状态混在一起，
  // 「离开」被当成「没上报」，未读永远不 +1。
  const away = new Set();

  function read(userId) {
    const entry = map.get(userId);
    if (!entry) return null;
    if (now() - entry.at > ttlMs) {
      map.delete(userId);
      return null;
    }
    return entry;
  }

  return {
    /** 上报：用户现在在看 conversationId。null 表示离开了所有会话。 */
    report(userId, conversationId) {
      if (!userId) return;
      if (conversationId === null || conversationId === undefined) {
        map.delete(userId);
        away.add(userId);
        return;
      }
      away.delete(userId);
      map.set(userId, { conversationId: String(conversationId), at: now() });
    },

    /**
     * 用户是否**明确**说过自己不在任何会话。
     * 调用方用它区分「明确离开」和「从未上报」。
     */
    isAway(userId) {
      return away.has(userId);
    },

    /** 用户此刻是否正看着 conversationId。没上报过 → 视为不在。 */
    isViewing(userId, conversationId) {
      const entry = read(userId);
      return entry !== null && entry.conversationId === String(conversationId);
    },

    /** 用户此刻在看的会话（可能为 null）。 */
    current(userId) {
      return read(userId)?.conversationId ?? null;
    },

    /** 清理过期项。定时调用，避免长期运行后 Map 无限增长。 */
    sweep() {
      const before = map.size;
      for (const [userId] of map) read(userId);
      return before - map.size;
    },

    /** 测试用：当前记录数。 */
    size() {
      return map.size;
    },

    clear() {
      map.clear();
      away.clear();
    },
  };
}
