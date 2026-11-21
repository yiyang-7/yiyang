/**
 * 内联 SVG 图标集（全部手写）。
 *
 * 为什么不用 @deepseek-ai/dsh-client-ui-primitives 的官方图标：
 * 该包把全部组件打进单个 lib/index.js，且模块级 import 了 shiki / katex，
 * 实测主包会从 244KB 涨到 1.28MB（gzip 77KB → 361KB）。
 * 为一个十来个图标的页面付这个代价不划算。
 *
 * 全部图标用 currentColor 上色，size 通过 props 控制。
 */

const base = (size) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': 'true',
});

/** DeepSeek 品牌鲸鱼标识（简化几何版本） */
export function LumeLogo({ size = 24, color = '#4D6BFE' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="lume"
    >
      <circle cx="12" cy="12" r="11" fill={color} />
      {/* 一颗居中的光点，外面一圈更淡的光晕 —— "lume" 取微光之意 */}
      <circle cx="12" cy="12" r="3.1" fill="#fff" />
      <circle cx="12" cy="12" r="5.6" stroke="#fff" strokeOpacity=".55" strokeWidth="1.1" />
      <circle cx="12" cy="12" r="8.3" stroke="#fff" strokeOpacity=".26" strokeWidth="1" />
      <circle cx="17.4" cy="6.4" r="1.05" fill="#fff" fillOpacity=".9" />
    </svg>
  );
}

/** 兼容旧名，避免一次性改太多调用点 */
export const DeepSeekLogo = LumeLogo;


/** 汉堡菜单 */
export function IconMenu({ size = 22 }) {
  return (
    <svg {...base(size)} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

/** 新对话 */
export function IconNewChat({ size = 20 }) {
  return (
    <svg {...base(size)} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12.5V18a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18V6.5A2.5 2.5 0 0 1 6.5 4H12" />
      <path d="M17 3v6M14 6h6" />
    </svg>
  );
}

/** 深度思考 */
export function IconThink({ size = 20 }) {
  return (
    <svg {...base(size)} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4.5a3 3 0 0 0-3 3v.2A3 3 0 0 0 7 13a3 3 0 0 0 1.6 5.1A2.8 2.8 0 0 0 12 20V4.5Z" />
      <path d="M12 4.5a3 3 0 0 1 3 3v.2A3 3 0 0 1 17 13a3 3 0 0 1-1.6 5.1A2.8 2.8 0 0 1 12 20" />
    </svg>
  );
}

/** 联网搜索 */
export function IconGlobe({ size = 20 }) {
  return (
    <svg {...base(size)} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16" />
      <path d="M12 4c2.2 2.2 3.3 5 3.3 8s-1.1 5.8-3.3 8c-2.2-2.2-3.3-5-3.3-8S9.8 6.2 12 4Z" />
    </svg>
  );
}

/** 附件/回形针 */
export function IconPaperclip({ size = 20 }) {
  return (
    <svg {...base(size)} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 11.5 12.3 19a4.6 4.6 0 0 1-6.5-6.5l7.4-7.4a3.1 3.1 0 0 1 4.4 4.4l-7.4 7.4a1.6 1.6 0 0 1-2.2-2.2l6.7-6.7" />
    </svg>
  );
}

/** 麦克风 */
export function IconMic({ size = 20 }) {
  return (
    <svg {...base(size)} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

/** 发送：上箭头 */
export function IconSend({ size = 20 }) {
  return (
    <svg {...base(size)} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" />
      <path d="m5.5 11.5 6.5-6.5 6.5 6.5" />
    </svg>
  );
}

/** 停止：方块 */
export function IconStop({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  );
}

/** 关闭 */
export function IconClose({ size = 20 }) {
  return (
    <svg {...base(size)} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** 重新生成：环形箭头 */
export function IconRefresh({ size = 16 }) {
  return (
    <svg {...base(size)} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4.5V11h-6.5" />
    </svg>
  );
}

/** 复制：两层重叠的方框 */
export function IconCopy({ size = 16 }) {
  return (
    <svg {...base(size)} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}

/** 已复制：对勾 */
export function IconCheck({ size = 16 }) {
  return (
    <svg {...base(size)} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

/** 删除 */
export function IconTrash({ size = 18 }) {
  return (
    <svg {...base(size)} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M6.5 7l.8 12.1A2 2 0 0 0 9.3 21h5.4a2 2 0 0 0 2-1.9L17.5 7" />
    </svg>
  );
}

/** 消息气泡 */
export function IconChat({ size = 18 }) {
  return (
    <svg {...base(size)} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12.5c0 3.6-3.6 6.5-8 6.5-1 0-2-.1-2.9-.4L4.5 20l1.1-3.3A6.2 6.2 0 0 1 4 12.5C4 8.9 7.6 6 12 6s8 2.9 8 6.5Z" />
    </svg>
  );
}
/** 设置：齿轮 */
export function IconSettings({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** 钥匙：API 密钥入口 */
export function IconKey({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.7 12.3 21 2m-4 4 3 3m-6-6 3 3" />
    </svg>
  );
}
