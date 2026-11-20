/**
 * 本地会话状态：userId 和「每个联系人对应哪个会话」。
 *
 * 用 localStorage。注意会话 id 必须持久化——每次进页面都新生成的话，
 * 服务端会当成全新会话，历史永远是空的。
 */

const K_USER = 'dsh.userId';
const K_CONV = 'dsh.conv.';

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
  const existing = localStorage.getItem(K_USER);
  if (existing && !isLegacyRandomId(existing)) return existing;
  localStorage.setItem(K_USER, DEFAULT_USER_ID);
  return DEFAULT_USER_ID;
}

/** 供设置页/调试用：换一个用户身份 */
export function setUserId(id) {
  localStorage.setItem(K_USER, id);
  return id;
}

export function getConversationId(contactId) {
  const key = K_CONV + contactId;
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const generated = `${contactId}-${Date.now().toString(36)}`;
  localStorage.setItem(key, generated);
  return generated;
}

/** 开一个全新会话（旧对话仍留在服务端，只是不再出现在这里） */
export function resetConversationId(contactId) {
  const generated = `${contactId}-${Date.now().toString(36)}`;
  localStorage.setItem(K_CONV + contactId, generated);
  return generated;
}