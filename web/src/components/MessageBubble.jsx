import { useState, useEffect, useRef } from 'react';
import { MarkdownText, StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import { DeepSeekLogo, IconRefresh, IconCopy, IconCheck } from './deepseek/icons.jsx';
import ThinkingPanel from './thinking/ThinkingPanel.jsx';
import { MARKDOWN_LABELS } from './markdown/labels.js';
import styles from './MessageBubble.module.css';

/**
 * 单条消息气泡。对方在左（白色），自己在右（绿色）。
 *
 * 头像完全本地生成（自定义图片 / emoji / 渐变字首），不依赖任何远程服务。
 *
 * @param {object} p
 * @param {{id:string,role:'user'|'assistant',content:string,status:string}} p.message
 * @param {string} [p.avatar]       对方 emoji 头像
 * @param {string} [p.avatarSeed]   生成占位图的种子（通常是 contactId）
 * @param {string} [p.userAvatarSeed] 用户自己的占位图种子
 * @param {string} [p.contactName]  错误文案里用的名字
 * @param {boolean} [p.useLogo]     AI 侧改用 DeepSeek Logo 而不是生成头像
 * @param {string} [p.pendingLabel] 流式占位时的文案（排队中 / 思考中），空内容时显示
 * @param {boolean} [p.showActions] 是否显示操作栏（重新生成 / 复制）。
 *   只有「最后一条 AI 回复、且不在流式中」为 true —— 见 ChatArea 的判断。
 * @param {() => void} [p.onRegenerate]
 */
export default function MessageBubble({
  message,
  avatar,
  avatarSeed,
  avatarImage,
  userAvatarSeed = 'me',
  contactName,
  useLogo = false,
  pendingLabel,
  showActions = false,
  onRegenerate,
  onReact,
  onQuote,
  onRecall,
}) {
  const isUser = message.role === 'user';
  // 两种写法都认：数据库里是 status 字段，前端占位气泡用 isStreaming 更直观
  const streaming = message.isStreaming === true || message.status === 'streaming';
  const empty = !message.content;

  // 深度思考：只在 AI 侧、且确实有思考内容时渲染面板
  const thinking = isUser ? '' : (message.thinking ?? '');
  const hasThinking = thinking.length > 0;
  // 思考仍在进行 = 流还没结束、且还没开始出正文
  const thinkingLive = message.thinkingStreaming === true || (hasThinking && empty);
  const failed = message.status === 'failed' || message.status === 'interrupted';

  return (
    <div className={`${styles.row} ${isUser ? styles.rowUser : ''}`}>
      {!isUser && useLogo ? (
        <div className={styles.avatar} title={contactName || 'lume'}>
          <DeepSeekLogo size={38} />
        </div>
      ) : (
        <Avatar
          seed={isUser ? userAvatarSeed : avatarSeed || 'ai'}
          emoji={isUser ? '🙂' : avatar || ''}
          name={isUser ? '我' : contactName || 'AI'}
          image={isUser ? undefined : avatarImage}
        />
      )}

      <div className={`${styles.col} ${isUser ? styles.colUser : ''}`}>
        {message.quoted && <QuoteBlock quoted={message.quoted} isUser={isUser} />}
        <div
          className={`${styles.bubble} ${
            isUser ? `${styles.bubbleUser} ${styles.bubbleRight}` : `${styles.bubbleLeft}`
          }`}
          onDoubleClick={() => onReact?.(message.id)}
          onContextMenu={(e) => {
            // 长按 / 右键 = 引用这条消息
            if (!onQuote) return;
            e.preventDefault();
            onQuote(message);
          }}
        >
          {/* 思考面板在正文上方，气泡内部（不跨出白底） */}
          {hasThinking && (
            <ThinkingPanel
              text={thinking}
              streaming={thinkingLive}
              durationMs={message.thinkingMs}
            />
          )}

          {empty && streaming && !hasThinking ? (
            <span className={styles.pending}>
              {/* 三点交错跳动，模仿微信「对方正在输入」。
                  只用 CSS 关键帧，不占 JS 主线程——
                  打字机本来就在跑 16ms 定时器，再加 JS 动画会抢帧。 */}
              <span className={styles.typing} aria-hidden="true">
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
              </span>
              <span className={styles.pendingText}>{pendingLabel || '正在输入...'}</span>
            </span>
          ) : hasThinking && empty ? (
            // 只有思考、正文还没来：气泡里只显示面板，不显示省略号占位
            null
          ) : (
            <>
              {/* 用户的输入不按 Markdown 渲染：他打什么就显示什么 */}
              {isUser ? (
                message.content
              ) : (
                <div className={styles.markdown}>
                  <MarkdownText
                    text={message.content}
                    streaming={streaming}
                    labels={MARKDOWN_LABELS}
                    variant="body"
                  />
                </div>
              )}
              {streaming && <span className={styles.caret} />}
            </>
          )}
        </div>

        {failed && (
          <div className={`${styles.meta} ${styles.metaError}`}>
            {message.status === 'interrupted' ? '未完成' : '发送失败'}
          </div>
        )}

        {/* 表情回应：贴在气泡外侧下沿，微信的形态。
            用 key 触发一次弹入动画——同一位置换表情时也能再弹一下。 */}
        {message.reaction && (
          <span key={message.reaction} className={styles.reaction} title="双击可更换">
            {message.reaction}
          </span>
        )}

        {/* 用户消息：已送达 / 撤回，微信的位置（气泡左下方小字） */}
        {isUser && message.status === 'completed' && onRecall && !streaming && (
          <div className={styles.receipt}>
            <button className={styles.recallBtn} onClick={() => onRecall(message)}>
              撤回
            </button>
          </div>
        )}

        {showActions && !isUser && !streaming && (
          <MessageActions content={message.content} onRegenerate={onRegenerate} />
        )}
      </div>
    </div>
  );
}

/**
 * 气泡下方的一排小图标：重新生成 / 复制。
 *
 * 复制用 navigator.clipboard。它需要安全上下文（https 或 localhost），
 * 在局域网 http 下不可用——所以要有兜底，否则按钮点了毫无反应。
 */
function MessageActions({ content, onRegenerate }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const copy = async () => {
    const ok = await copyText(content);
    if (!ok) return;
    setCopied(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={styles.actions}>
      {onRegenerate && (
        <button
          type="button"
          className={styles.action}
          onClick={onRegenerate}
          title="重新生成"
          aria-label="重新生成"
        >
          <IconRefresh size={14} />
        </button>
      )}
      <button
        type="button"
        className={`${styles.action} ${copied ? styles.actionDone : ''}`}
        onClick={copy}
        title={copied ? '已复制' : '复制'}
        aria-label={copied ? '已复制' : '复制'}
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </button>
    </div>
  );
}

/**
 * 复制文本，返回是否成功。
 *
 * clipboard API 在非安全上下文（http + 非 localhost）下是 undefined，
 * 局域网访问时必然走到兜底分支。用 textarea + execCommand 兜底，
 * 已废弃但仍是唯一在 http 下可用的方案。
 */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒 / 非安全上下文 → 走兜底
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // 移出视口，避免复制时页面跳动
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 圆形头像。
 *
 * 优先级：自定义图片 > 自定义 emoji > 本地生成的渐变字首。
 *
 * 早期版本用 api.dicebear.com 拉远程头像，问题有两个：
 *   1. 演示版是离线单文件，远程图必然加载失败，头像位置一片空白
 *   2. 每次渲染都发外部请求，慢且不可控
 * 现在完全本地生成，不联网也能看到统一的头像。
 */
function Avatar({ seed, emoji, name, image }) {
  // 自定义图片（data URL）
  if (image) {
    return (
      <div className={styles.avatar} title={name}>
        <img className={styles.avatarImg} src={image} alt={name} />
      </div>
    );
  }

  // 自定义 emoji：直接渲染字符，不走图片
  if (emoji) {
    return (
      <div className={styles.avatar} title={name}>
        <span className={styles.avatarEmoji} aria-hidden="true">
          {emoji}
        </span>
      </div>
    );
  }

  // 兜底：由 seed 生成稳定的渐变 + 首字
  const palette = avatarPalette(seed);
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <div className={styles.avatar} title={name}>
      <span
        className={styles.avatarGenerated}
        style={{ background: palette }}
        aria-hidden="true"
      >
        {initial}
      </span>
    </div>
  );
}

/**
 * 引用块：显示在气泡内部上方，微信「引用回复」的形态。
 * 只取原文前 40 字，避免长消息把气泡撑高。
 */
function QuoteBlock({ quoted, isUser }) {
  const text = (quoted.content || '').replace(/\s+/g, ' ').slice(0, 40);
  return (
    <div className={`${styles.quote} ${isUser ? styles.quoteUser : ''}`}>
      <span className={styles.quoteName}>{quoted.role === 'user' ? '我' : '对方'}</span>
      <span className={styles.quoteText}>{text || '（空消息）'}</span>
    </div>
  );
}

/** seed → 稳定的双色渐变。同一个 seed 永远同一套颜色。 */
function avatarPalette(seed) {
  const s = String(seed || 'ai');
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < s.length; i++) {
    h1 = (h1 * 31 + s.charCodeAt(i)) % 360;
    h2 = (h2 * 17 + s.charCodeAt(i) * 7) % 360;
  }
  return `linear-gradient(135deg, hsl(${h1} 62% 70%), hsl(${h2} 58% 58%))`;
}
