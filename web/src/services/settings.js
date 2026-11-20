/**
 * 本地设置：头像 + API 密钥。
 *
 * 都存在 localStorage，不经过任何服务端。
 * 演示版没有后端，所以这是唯一可行的存档方式；
 * 接真后端时可以在 settings 面板里改成写回 /contacts。
 */

const K_AVATAR = 'dsh.avatar.';
const K_NAME = 'dsh.name.';
const K_API = 'dsh.apiKey';

// localStorage 在部分浏览器的 file:// 下会抛异常（Safari 尤甚），
// 拿不到就退回内存，保证功能可用（只是刷新后丢失）。
const mem = new Map();
const safe = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return mem.get(k) ?? null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      mem.set(k, v);
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {
      mem.delete(k);
    }
  },
};

// ── 头像 ──────────────────────────────────────

/**
 * 存自定义头像。
 *
 * 支持两种：
 *   1. emoji / 短文本（如 "🐱"）—— 直接当字符渲染
 *   2. 图片 data URL（用户在设置里选本地图片，压缩后转 base64）
 *
 * 不存远程 URL：file:// 下跨域图片加载不稳定，且离线打不开。
 */
export function setAvatar(contactId, value) {
  if (!value) safe.del(K_AVATAR + contactId);
  else safe.set(K_AVATAR + contactId, value);
}

export function getAvatar(contactId) {
  return safe.get(K_AVATAR + contactId) || '';
}

/** 昵称也可以改，社交感更强 */
export function setName(contactId, value) {
  if (!value) safe.del(K_NAME + contactId);
  else safe.set(K_NAME + contactId, value);
}

export function getName(contactId) {
  return safe.get(K_NAME + contactId) || '';
}

/** 判断这个值是图片还是 emoji */
export function isImageAvatar(v) {
  return typeof v === 'string' && v.startsWith('data:image/');
}

// ── API 密钥 ───────────────────────────────────

/**
 * 保存的密钥。
 *
 * 注意：这是「用户自己填、自己用」的配置项，明文存在本机 localStorage。
 * 演示版是纯前端，没有服务端可以代持密钥，这是唯一方式。
 * 所以界面上必须明确提示「只存在这台设备上」。
 */
export function getApiKey() {
  return safe.get(K_API) || '';
}

export function setApiKey(v) {
  if (!v) safe.del(K_API);
  else safe.set(K_API, v.trim());
}

/** 打码显示：sk-1234...abcd */
export function maskKey(k) {
  if (!k) return '';
  if (k.length <= 12) return '••••••';
  return `${k.slice(0, 6)}••••${k.slice(-4)}`;
}

// ── 图片压缩 ───────────────────────────────────

/**
 * 把用户选的图片文件压成小尺寸 data URL。
 *
 * 直接存原图会让 localStorage（通常 5MB 配额）很快爆掉，
 * 所以统一缩到 256px 内再转 jpeg。
 */
export function fileToAvatarDataUrl(file, maxSize = 256) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('请选择图片文件'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片格式不支持'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('当前浏览器不支持图片处理'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        // jpeg 质量 0.86：256px 下约 10–20KB，落 localStorage 很轻松
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** 常用 emoji 候选，设置面板里直接点选 */
export const AVATAR_EMOJIS = [
  '🐱', '🐶', '🦊', '🐼', '🐰', '🐻',
  '🤖', '🧑‍💻', '🧙', '🦉', '🌸', '⭐',
  '🎧', '📚', '🌙', '🍀', '💠', '🔮',
];