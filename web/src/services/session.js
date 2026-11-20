/**
 * 本地会话状态：userId 和「每个联系人对应哪个会话」。
 *
 * 用 localStorage。注意会话 id 必须持久化——每次进页面都新生成的话，
 * 服务端会当成全新会话，历史永远是空的。
 */

const K_USER = 'dsh.userId';
const K_CONV = 'dsh.conv.';

/**
 * localStorage 的安全包装。
 *
 * 演示版是从 file:// 直接打开的，而部分浏览器（Safari 在 file:// 下、
 * 以及隐私模式）会直接抛异常而不是返回 null。裸调用 localStorage
 * 会让整个应用在挂载阶段就崩掉——表现为白屏，且不报任何有用信息。
 *
 * 拿不到就退回内存：这次会话内功能完全正常，只是刷新后「重置」。
 */
const memoryStore = new Map();

const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return memoryStore.get(key) ?? null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      memoryStore.set(key, value);
    }
  },
};

/**
 * 这个浏览器代表的用户 id。
 *
 * 固定为 u-web-demo，而不是随机生成 —— 否则每次清缓存都变成新用户，
 * 服务端按 userId 过滤会话时首页会「突然空了」，演示数据也无法预置。
 *
 * 历史遗留：早期版本会随机生成 `u-<时间戳36进制>` 并写进 localStorage。
 * 那些浏览器升级后如果继续沿用旧 id，首页就查不到演示数据（表现为「看不到对话」）。
 * 所以这里把旧格式识别出来并迁移掉。
 */
export const DEFAULT_USER_ID = 'u-web-demo';

/** 旧版随机 id 形如 u-mg7x2k（没有下划线、不是 DEMO 前缀） */
function isLegacyRandomId(id) {
  return /^u-[a-z0-9]{6,10}$/.test(id) && id !== DEFAULT_USER_ID;
}

export function getUserId() {
  const existing = store.get(K_USER);
  if (existing && !isLegacyRandomId(existing)) return existing;
  store.set(K_USER, DEFAULT_USER_ID);
  return DEFAULT_USER_ID;
}

/** 供设置页/调试用：换一个用户身份 */
export function setUserId(id) {
  store.set(K_USER, id);
  return id;
}

export function getConversationId(contactId) {
  const key = K_CONV + contactId;
  const existing = store.get(key);
  if (existing) return existing;
  const generated = `${contactId}-${Date.now().toString(36)}`;
  store.set(key, generated);
  return generated;
}

/** 开一个全新会话（旧对话仍留在服务端，只是不再出现在这里） */
export function resetConversationId(contactId) {
  const generated = `${contactId}-${Date.now().toString(36)}`;
  store.set(K_CONV + contactId, generated);
  return generated;
}