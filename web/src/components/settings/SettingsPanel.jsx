import { useEffect, useRef, useState } from 'react';
import {
  AVATAR_EMOJIS,
  fileToAvatarDataUrl,
  getApiKey,
  getAvatar,
  isBuiltinKey,
  getName,
  maskKey,
  setApiKey,
  setAvatar,
  setName,
} from '../../services/settings.js';
import styles from './SettingsPanel.module.css';

/**
 * 设置面板：自定义头像 / 昵称 + API 密钥。
 *
 * 全部存本机 localStorage，不上传任何服务端。
 * 演示版是纯前端产物，没有后端可以代持密钥——这一点在界面上明说，
 * 避免用户误以为密钥存在云上。
 */
export default function SettingsPanel({ open, initialTab, onClose, onSaved, contacts = [], activeContactId }) {
  // 默认停在「API 密钥」页——这是实际最需要被找到的入口，
  // 角色外观属于次要设置。
  const [tab, setTab] = useState(initialTab || 'api'); // avatar | api

  // useState 的初始值只在首次挂载生效。面板是常驻挂载、靠 open 控制显隐的，
  // 所以每次重新打开都要按调用方指定的标签重置一次，
  // 否则用户上次停在「角色外观」，下次点「API 密钥」按钮却还是打开旧标签。
  useEffect(() => {
    if (open) setTab(initialTab || 'api');
  }, [open, initialTab]);
  const [targetId, setTargetId] = useState(activeContactId || contacts[0]?.id || 'default');
  const [emoji, setEmoji] = useState('');
  const [nick, setNick] = useState('');
  const [saved, setSaved] = useState('');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  // 打开时从存档里读当前值，避免显示脏数据
  useEffect(() => {
    if (!open) return;
    setErr('');
    setSaved('');
    setEmoji(getAvatar(targetId));
    setNick(getName(targetId));
    setKey(getApiKey());
  }, [open, targetId]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const flash = (msg) => {
    setSaved(msg);
    setTimeout(() => setSaved(''), 1600);
  };

  const handlePickEmoji = (e) => {
    setEmoji(e);
    setAvatar(targetId, e);
    flash('头像已更新');
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选同一个文件
    if (!file) return;
    setErr('');
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setEmoji(dataUrl);
      setAvatar(targetId, dataUrl);
      flash('头像已更新');
    } catch (ex) {
      setErr(ex.message || '图片处理失败');
    }
  };

  const handleResetAvatar = () => {
    setEmoji('');
    setAvatar(targetId, '');
    flash('已恢复默认头像');
  };

  const handleSaveNick = () => {
    setName(targetId, nick.trim());
    flash(nick.trim() ? '昵称已更新' : '已恢复默认昵称');
  };

  const handleSaveKey = () => {
    setApiKey(key);
    flash(key.trim() ? '密钥已保存到本机' : '密钥已清除');
    onSaved?.();   // 通知外层刷新密钥状态条
  };

  const isImg = emoji.startsWith('data:image/');
  const current = contacts.find((c) => c.id === targetId);

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        <header className={styles.head}>
          <h2 className={styles.title}>设置</h2>
          <button className={styles.close} onClick={onClose} aria-label="关闭设置">
            ✕
          </button>
        </header>

        <div className={styles.tabs} role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'avatar'}
            className={`${styles.tab} ${tab === 'avatar' ? styles.tabOn : ''}`}
            onClick={() => setTab('avatar')}
          >
            角色外观
          </button>
          <button
            role="tab"
            aria-selected={tab === 'api'}
            className={`${styles.tab} ${tab === 'api' ? styles.tabOn : ''}`}
            onClick={() => setTab('api')}
          >
            API 密钥
          </button>
        </div>

        <div className={styles.body}>
          {tab === 'avatar' && (
            <>
              <label className={styles.label}>选择角色</label>
              <div className={styles.roles}>
                {contacts.map((c) => (
                  <button
                    key={c.id}
                    className={`${styles.role} ${c.id === targetId ? styles.roleOn : ''}`}
                    onClick={() => setTargetId(c.id)}
                  >
                    {getName(c.id) || c.name}
                  </button>
                ))}
              </div>

              <label className={styles.label}>预览</label>
              <div className={styles.previewRow}>
                <div className={styles.preview}>
                  {isImg ? (
                    <img src={emoji} alt="头像预览" />
                  ) : (
                    <span>{emoji || (current?.name || '?').charAt(0)}</span>
                  )}
                </div>
                <div className={styles.previewHint}>
                  {isImg ? '已使用自定义图片' : emoji ? '已使用 emoji' : '默认头像（按名字生成）'}
                </div>
              </div>

              <label className={styles.label}>选一个 emoji</label>
              <div className={styles.emojiGrid}>
                {AVATAR_EMOJIS.map((e) => (
                  <button
                    key={e}
                    className={`${styles.emojiBtn} ${emoji === e ? styles.emojiOn : ''}`}
                    onClick={() => handlePickEmoji(e)}
                    aria-label={`使用 ${e} 作为头像`}
                  >
                    {e}
                  </button>
                ))}
              </div>

              <div className={styles.row}>
                <button className={styles.btn} onClick={() => fileRef.current?.click()}>
                  选本地图片…
                </button>
                <button className={styles.btnGhost} onClick={handleResetAvatar}>
                  恢复默认
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={handleFile}
                />
              </div>

              <label className={styles.label} htmlFor="nick">
                昵称
              </label>
              <div className={styles.row}>
                <input
                  id="nick"
                  className={styles.input}
                  value={nick}
                  placeholder={current?.name || '输入新昵称'}
                  maxLength={16}
                  onChange={(e) => setNick(e.target.value)}
                />
                <button className={styles.btn} onClick={handleSaveNick}>
                  保存
                </button>
              </div>
            </>
          )}

          {tab === 'api' && (
            <>
              <p className={styles.note}>
                填入模型服务的 API 密钥后，这个页面就能直接调用真实模型。
                密钥<strong>只保存在这台设备的浏览器里</strong>，不会上传到任何服务器。
              </p>

              <label className={styles.label} htmlFor="apikey">
                API Key
              </label>
              <div className={styles.row}>
                <input
                  id="apikey"
                  className={styles.input}
                  type={showKey ? 'text' : 'password'}
                  value={key}
                  placeholder="sk-..."
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setKey(e.target.value)}
                />
                <button className={styles.btnGhost} onClick={() => setShowKey((v) => !v)}>
                  {showKey ? '隐藏' : '显示'}
                </button>
              </div>

              <div className={styles.row}>
                <button className={styles.btn} onClick={handleSaveKey}>
                  保存密钥
                </button>
                <button
                  className={styles.btnGhost}
                  onClick={() => {
                    setKey('');
                    setApiKey('');
                    flash('密钥已清除');
                  }}
                >
                  清除
                </button>
              </div>

              <p className={styles.small}>
                当前：{key ? maskKey(key) : '未设置'}
                {key && isBuiltinKey(key) && '（版本内置，清除后需重新填写）'}
              </p>

              <p className={styles.small}>
                没有密钥？到 platform.deepseek.com 注册后在「API keys」里创建（本项目接的是 DeepSeek 接口）。
              </p>
              <p className={styles.note}>
                <strong>实测可用</strong>：DeepSeek 官方接口已放行浏览器跨域请求
                （返回 <code>access-control-allow-origin: null</code>，正对
                <code>file://</code> 页面），所以填好密钥后，这个单文件网页
                就能直接出真实回答，不需要另外部署转发服务。
                填了有效密钥却调不通时，页面会明确告诉你原因（密钥无效 / 余额不足 / 网络问题），
                不会假装成功。
              </p>
            </>
          )}

          {err && <p className={styles.err}>{err}</p>}
          {saved && <p className={styles.ok}>{saved}</p>}
        </div>
      </div>
    </div>
  );
}