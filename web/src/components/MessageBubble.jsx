import { useState, useEffect, useRef } from 'react';
import { MarkdownText, StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import { DeepSeekLogo, IconRefresh, IconCopy, IconCheck } from './deepseek/icons.jsx';
import ThinkingPanel from './thinking/ThinkingPanel.jsx';
import { MARKDOWN_LABELS } from './markdown/labels.js';
import styles from './MessageBubble.module.css';

/**
 * 单条消息气泡。对方在左（白色），自己在右（绿色）。
 *
 * 头像用占位图（dicebear），加载失败退回 emoji，避免满屏裂图。
 *
 * @param {object} p
 * @param {{id:string,role:'user'|'assistant',content:string,status:string}} p.message
 * @param {string} [p.avatar]       对方 emoji 头像
 * @param {string} [p.avatarSeed]   生成占位图的种子（通常是 contactId）
 * @param {string} [p.userAvatarSeed] 用户自己的占位图种子
 * @param {string} [p.contactName]  错误文案里用的名字
 * @param {boolean} [p.useLogo]     AI 侧改用 DeepSeek Logo 而不是 dicebear 头像
 * @param {string} [p.pendingLabel] 流式占位时的文案（排队中 / 思考中），空内容时显示
 * @param {boolean} [p.showActions] 是否显示操作栏（重新生成 / 复制）。
 *   只有「最后一条 AI 回复、且不在流式中」为 true —— 见 ChatArea 的判断。
 * @param {() => void} [p.onRegenerate]
 */
export default function MessageBubble({
  message,
  avatar,
  avatarSeed,
  userAvatarSeed = 'me',
  contactName,
  useLogo = false,
  pendingLabel,
  showActions = false,
  onRegenerate,
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
        <div className={styles.avatar} title={contactName || 'DeepSeek'}>
          <DeepSeekLogo size={38} />
        </div>
      ) : (
        <Avatar
          seed={isUser ? userAvatarSeed : avatarSeed || 'ai'}
          emoji={isUser ? '🙂' : avatar || '🤖'}
          name={isUser ? '我' : contactName || 'AI'}
        />
      )}

      <div className={`${styles.col} ${isUser ? styles.colUser : ''}`}>
        <div
          className={`${styles.bubble} ${
            isUser ? `${styles.bubbleUser} ${styles.bubbleRight}` : `${styles.bubbleLeft}`
          }`}
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
              {/* 状态点用官方 StateDot：ongoing 是 14px 旋转 loading，
                  动画挂载时间对齐文档时间零点，多处 loading 同相 */}
              <StateDot state="ongoing" />
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

/** 圆形占位头像 */
function Avatar({ seed, emoji, name }) {
  return (
    <div className={styles.avatar} title={name}>
      <img
        className={styles.avatarImg}
        src={`https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(
          seed,
        )}&backgroundColor=b6e3f4,c0aede,ffdfbf`}
        alt={name}
        loading="lazy"
        onError={(e) => {
          const img = e.currentTarget;
          const parent = img.parentElement;
          if (!parent || parent.dataset.fallback) return;
          parent.dataset.fallback = '1';
          img.style.display = 'none';
          const span = document.createElement('span');
          span.textContent = emoji;
          parent.appendChild(span);
        }}
      />
    </div>
  );
}