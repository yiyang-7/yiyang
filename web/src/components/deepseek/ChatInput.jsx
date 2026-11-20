import { useLayoutEffect, useRef, useState } from 'react';
import {
  IconGlobe,
  IconMic,
  IconPaperclip,
  IconSend,
  IconStop,
  IconThink,
} from './icons.jsx';
import styles from './ChatInput.module.css';

/**
 * DeepSeek 风格输入区。
 *
 * 布局：圆角卡片包住 textarea，卡片底行左侧是功能开关、右侧是图标按钮。
 *
 * 关于「深度思考」和「联网搜索」：
 *   后端 /chat 目前只接受 conversationId/message/userId/contactId，
 *   没有对应参数，也没有联网检索能力。这两个开关**只改 UI 状态、不会影响请求**，
 *   所以加了黄色小圆点并在 title 里写明。等后端支持了，把参数接进 send() 即可。
 */
const MAX_ROWS = 6;

export default function ChatInput({
  onSend,
  onStop,
  sending,
  deepThink,
  onToggleDeepThink,
  webSearch,
  onToggleWebSearch,
}) {
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState(null);
  const ref = useRef(null);
  const fileRef = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || 22;
    const max = lineHeight * MAX_ROWS + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const next = Math.min(el.scrollHeight, max);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [text]);

  const canSend = text.trim().length > 0 && !sending;

  const submit = () => {
    if (!canSend) return;
    // 附件暂时只是把文件名拼进消息，后端没有文件上传接口
    const payload = attachment ? `${text}\n\n[附件] ${attachment.name}` : text;
    onSend(payload);
    setText('');
    setAttachment(null);
    requestAnimationFrame(() => ref.current?.focus());
  };

  const onKeyDown = (e) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        {attachment && (
          <div className={styles.attachment}>
            <IconPaperclip size={13} />
            <span className={styles.attachmentName}>{attachment.name}</span>
            <button
              className={styles.attachmentRemove}
              onClick={() => setAttachment(null)}
              aria-label="移除附件"
            >
              ×
            </button>
          </div>
        )}

        <textarea
          ref={ref}
          className={styles.input}
          rows={1}
          value={text}
          placeholder={sending ? '正在回复…' : '给 DeepSeek 发送消息'}
          enterKeyHint="send"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />

        <div className={styles.row}>
          <div className={styles.toggles}>
            <button
              className={`${styles.toggle} ${deepThink ? styles.toggleOn : ''} ${styles.toggleUnsupported}`}
              onClick={onToggleDeepThink}
              aria-pressed={deepThink}
              title="当前后端未接入深度思考模型，此开关暂不生效"
            >
              <IconThink size={15} />
              深度思考 (R1)
            </button>

            <button
              className={`${styles.toggle} ${webSearch ? styles.toggleOn : ''} ${styles.toggleUnsupported}`}
              onClick={onToggleWebSearch}
              aria-pressed={webSearch}
              title="当前后端未接入联网检索，此开关暂不生效"
            >
              <IconGlobe size={15} />
              联网搜索
            </button>
          </div>

          <button
            className={styles.iconBtn}
            onClick={() => fileRef.current?.click()}
            title="上传附件（当前仅记录文件名，后端无文件接口）"
            aria-label="上传附件"
          >
            <IconPaperclip size={18} />
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setAttachment({ name: f.name, size: f.size });
              e.target.value = '';
            }}
          />

          <button
            className={styles.iconBtn}
            onClick={() => window.alert('语音输入需要浏览器的语音识别权限，当前环境未接入。')}
            title="语音输入（未接入）"
            aria-label="语音输入"
          >
            <IconMic size={18} />
          </button>

          {sending ? (
            <button className={`${styles.send} ${styles.stop}`} onClick={onStop} aria-label="停止生成">
              <IconStop size={16} />
            </button>
          ) : (
            <button
              className={styles.send}
              onClick={submit}
              disabled={!canSend}
              aria-label="发送"
            >
              <IconSend size={17} />
            </button>
          )}
        </div>
      </div>

      <div className={styles.hint}>内容由 AI 生成，请仔细甄别</div>
    </div>
  );
}