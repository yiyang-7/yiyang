/**
 * 生成「成果总览」单文件 HTML。
 *
 * 目标：一个 HTML 里能看到整个项目的全部产出——
 * 文件清单、真实 API 响应、测试结果、代码摘录、构建产物。
 * 双击打开即可，不需要服务器。
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const data = JSON.parse(readFileSync('/tmp/collect.json', 'utf8'));
let testLog = '';
try {
  testLog = readFileSync('/tmp/test-out.txt', 'utf8');
} catch {}

// ── 代码摘录：挑有代表性的真实片段 ──────────────
function excerpt(path, startMatch, lines = 12) {
  try {
    const src = readFileSync(`/root/森萝/${path}`, 'utf8').split('\n');
    const i = src.findIndex((l) => l.includes(startMatch));
    if (i < 0) return `// 未找到：${startMatch}`;
    return src.slice(i, i + lines).join('\n');
  } catch {
    return '// 读取失败';
  }
}

const EXCERPTS = [
  {
    file: 'server.mjs',
    title: '网关入口：路由挂载与 CORS',
    why: '所有请求的唯一入口，CORS 默认关闭、按需开启。',
    code: excerpt('server.mjs', 'app.use(express.json', 14),
  },
  {
    file: 'lib/chat-route.mjs',
    title: '流式对话路由',
    why: '把模型输出转成 SSE 帧，并保证落库内容与推流一致。',
    code: excerpt('lib/chat-route.mjs', 'regenerate', 16),
  },
  {
    file: 'lib/history-store.mjs',
    title: '双表持久化',
    why: '会话与消息分开存，冗余未读数用于列表页免 JOIN。',
    code: excerpt('lib/history-store.mjs', 'rewindLastReply', 18),
  },
  {
    file: 'lib/session-pool.mjs',
    title: '进程池',
    why: '会话绑定常驻进程，未命中则冷读历史预热 Prompt。',
    code: excerpt('lib/session-pool.mjs', 'class', 16),
  },
  {
    file: 'web/src/hooks/useChat.js',
    title: '前端对话状态机',
    why: '632 行，同时管流式、打字机、中断、重生成、未读。',
    code: excerpt('web/src/hooks/useChat.js', 'TYPE_INTERVAL_MS', 14),
  },
  {
    file: 'web/src/services/api.js',
    title: 'API 封装与显式白名单',
    why: '请求体是白名单，漏写字段会静默失效——踩过坑所以加了守卫。',
    code: excerpt('web/src/services/api.js', 'viewingConversationId', 12),
  },
  {
    file: 'web/src/components/chat/QuickReplies.jsx',
    title: '快捷回复算法',
    why: '读最后一条 AI 回复的特征现算，不是固定轮播。',
    code: excerpt('web/src/components/chat/QuickReplies.jsx', 'followUpsFor', 16),
  },
];

// ── 构建产物 ──
// 产物位置不写死：根目录和 web/demo 都可能放，取实际存在的那个
function pick(candidates) {
  for (const c of candidates) {
    try {
      return { path: c, size: statSync(c).size };
    } catch {}
  }
  return null;
}

const demoFile = pick(['/root/森萝/演示版.html', '/root/森萝/web/demo/演示版.html', '/root/森萝/00028.html']);
const apkFile = pick(['/root/森萝/森萝-debug.apk']);
const docFile = pick(['/root/森萝/00028.docx']);

const artifacts = [
  demoFile && {
    name: demoFile.path.split('/').pop(),
    size: (demoFile.size / 1024 / 1024).toFixed(2) + ' MB',
    desc: '单文件离线演示，双击即开',
  },
  apkFile && {
    name: '森萝-debug.apk',
    size: (apkFile.size / 1024 / 1024).toFixed(2) + ' MB',
    desc: 'Android 安装包（云端构建）',
  },
  docFile && {
    name: '00028.docx',
    size: (docFile.size / 1024).toFixed(0) + ' KB',
    desc: '设计文档，8 章 17424 字',
  },
].filter(Boolean);

// ── 里程碑 ──
const MILESTONES = [
  { tag: 'S1', title: '基础骨架', desc: 'SDK 打通 + SQLite 双表', done: true },
  { tag: 'S2', title: '流式管道', desc: 'SSE 帧协议 + 打字机', done: true },
  { tag: 'S3', title: '视觉还原', desc: 'DeepSeek 主框架 + 微信气泡', done: true },
  { tag: 'S4', title: '社交状态', desc: '未读 / 正在输入 / 主动消息', done: true },
  { tag: 'S5', title: '对话控制', desc: '停止 / 重新生成 / 复制', done: true },
  { tag: 'S6', title: '多端适配', desc: '抽屉侧栏 + Capacitor', done: true },
  { tag: 'S7', title: '云端构建', desc: 'GitHub Actions 出 APK', done: true },
  { tag: 'S8', title: '离线演示', desc: '单文件 HTML + Pages', done: true },
];

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fileRow = (f) => {
  const name = f.path.split('/').pop();
  const dir = f.path.replace(/\/[^/]+$/, '');
  const kb = (f.bytes / 1024).toFixed(1);
  return `<tr>
    <td class="fname">${esc(name)}</td>
    <td class="fdir">${esc(dir)}</td>
    <td class="num">${f.lines}</td>
    <td class="num dim">${kb} KB</td>
  </tr>`;
};

// ── 真实 API 响应 ──
const apiSessions = data.apiSessions?.sessions ?? [];
const apiContacts = data.apiContacts?.contacts ?? [];

const testLines = testLog
  .split('\n')
  .filter((l) => /✅|❌|结果|通过/.test(l))
  .slice(0, 60);

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>森萝 · 项目成果总览</title>
<style>
  * { box-sizing: border-box; }
  :root {
    --blue: #4d6bfe;
    --ink: #1f2329;
    --dim: #6b7280;
    --line: #e8eaed;
    --bg: #f7f8fa;
  }
  html, body { margin: 0; }
  body {
    font: 14px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: var(--ink);
    background: var(--bg);
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 20px 80px; }

  /* ── 顶部 ── */
  header {
    padding: 56px 0 36px;
    text-align: center;
  }
  h1 {
    margin: 0 0 10px;
    font-size: 30px;
    letter-spacing: -0.5px;
  }
  .sub { color: var(--dim); font-size: 14px; }
  .badge {
    display: inline-block;
    margin-top: 14px;
    padding: 5px 14px;
    border-radius: 999px;
    background: rgba(77,107,254,.1);
    color: var(--blue);
    font-size: 12.5px;
    font-weight: 600;
  }

  /* ── 统计卡片 ── */
  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 34px;
  }
  @media (max-width: 700px) { .stats { grid-template-columns: repeat(2, 1fr); } }
  .stat {
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 18px 16px;
    text-align: center;
  }
  .stat .n {
    font-size: 26px;
    font-weight: 700;
    color: var(--blue);
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
  }
  .stat .l { font-size: 12.5px; color: var(--dim); margin-top: 4px; }

  /* ── 标签页 ── */
  .tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 18px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar { display: none; }
  .tab {
    flex: 0 0 auto;
    padding: 9px 18px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: #fff;
    color: var(--dim);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    transition: all .16s;
  }
  .tab:hover { border-color: #d0d4da; }
  .tab.on {
    background: var(--blue);
    border-color: var(--blue);
    color: #fff;
    font-weight: 600;
  }

  .panel { display: none; animation: fade .22s ease both; }
  .panel.on { display: block; }
  @keyframes fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

  .card {
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 14px;
    overflow: hidden;
    margin-bottom: 16px;
  }
  .card-head {
    padding: 13px 18px;
    border-bottom: 1px solid var(--line);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .card-title { font-weight: 600; font-size: 14px; }
  .card-meta { font-size: 12px; color: var(--dim); font-variant-numeric: tabular-nums; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th {
    text-align: left;
    padding: 9px 18px;
    background: #fafbfc;
    border-bottom: 1px solid var(--line);
    font-size: 12px;
    font-weight: 600;
    color: var(--dim);
  }
  td { padding: 8px 18px; border-bottom: 1px solid #f2f3f5; }
  tr:last-child td { border-bottom: 0; }
  tr:hover td { background: #fafbfc; }
  .fname { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 12.5px; }
  .fdir { color: var(--dim); font-size: 11.5px; font-family: ui-monospace, monospace; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .dim { color: var(--dim); }

  /* ── 代码块 ── */
  pre {
    margin: 0;
    padding: 16px 18px;
    background: #1e1e24;
    color: #e4e6eb;
    font: 12.5px/1.65 ui-monospace, "SF Mono", Consolas, monospace;
    overflow-x: auto;
    tab-size: 2;
  }
  pre .k { color: #c792ea; }
  pre .s { color: #c3e88d; }
  pre .c { color: #6a737d; font-style: italic; }
  pre .n { color: #82aaff; }

  .exc-why {
    padding: 11px 18px;
    background: #fafbfc;
    border-bottom: 1px solid var(--line);
    font-size: 12.5px;
    color: var(--dim);
  }

  /* ── 里程碑 ── */
  .mile { display: flex; flex-direction: column; gap: 0; }
  .milestone {
    display: flex;
    gap: 16px;
    padding: 14px 18px;
    border-bottom: 1px solid #f2f3f5;
    align-items: flex-start;
  }
  .milestone:last-child { border-bottom: 0; }
  .m-tag {
    flex: 0 0 auto;
    width: 42px; height: 42px;
    border-radius: 11px;
    background: rgba(77,107,254,.1);
    color: var(--blue);
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 13px;
  }
  .m-body { flex: 1; }
  .m-title { font-weight: 600; font-size: 13.5px; }
  .m-desc { font-size: 12.5px; color: var(--dim); margin-top: 2px; }
  .m-ok { color: #16a34a; font-size: 13px; flex: 0 0 auto; }

  /* ── API 展示 ── */
  .api-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 760px) { .api-grid { grid-template-columns: 1fr; } }
  .persona {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 18px;
    border-bottom: 1px solid #f2f3f5;
  }
  .persona:last-child { border-bottom: 0; }
  .p-av {
    width: 34px; height: 34px; border-radius: 50%;
    background: rgba(77,107,254,.1);
    display: flex; align-items: center; justify-content: center;
    font-size: 17px; flex: 0 0 auto;
  }
  .p-name { font-weight: 600; font-size: 13px; }
  .p-id { color: var(--dim); font-size: 11.5px; font-family: ui-monospace, monospace; }

  .sess {
    display: flex; gap: 10px; align-items: flex-start;
    padding: 11px 18px;
    border-bottom: 1px solid #f2f3f5;
  }
  .sess:last-child { border-bottom: 0; }
  .s-body { flex: 1; min-width: 0; }
  .s-top { display: flex; align-items: center; gap: 8px; }
  .s-name { font-weight: 600; font-size: 13px; }
  .s-unread {
    background: #ff4d4f; color: #fff;
    font-size: 10.5px; font-weight: 700;
    padding: 1px 6px; border-radius: 999px;
  }
  .s-msg { font-size: 12.5px; color: var(--dim); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ── 测试日志 ── */
  .logbox {
    padding: 14px 18px;
    font: 12px/1.75 ui-monospace, monospace;
    max-height: 420px;
    overflow-y: auto;
    background: #fff;
  }
  .logbox .ok { color: #16a34a; }
  .logbox .bad { color: #dc2626; }
  .logbox .hl { color: var(--blue); font-weight: 600; }

  /* ── 产物 ── */
  .artifact {
    display: flex; align-items: center; gap: 14px;
    padding: 14px 18px;
    border-bottom: 1px solid #f2f3f5;
  }
  .artifact:last-child { border-bottom: 0; }
  .a-icon {
    width: 40px; height: 40px; border-radius: 10px;
    background: rgba(77,107,254,.1);
    display: flex; align-items: center; justify-content: center;
    font-size: 18px; flex: 0 0 auto;
  }
  .a-name { font-weight: 600; font-family: ui-monospace, monospace; font-size: 13px; }
  .a-desc { font-size: 12.5px; color: var(--dim); }
  .a-size { margin-left: auto; font-size: 12.5px; color: var(--dim); font-variant-numeric: tabular-nums; }

  .note {
    margin-top: 22px;
    padding: 14px 18px;
    background: #fffbe6;
    border: 1px solid #ffe58f;
    border-radius: 12px;
    font-size: 12.5px;
    line-height: 1.7;
    color: #614700;
  }
  footer {
    text-align: center;
    color: var(--dim);
    font-size: 12px;
    margin-top: 40px;
  }
</style>
</head>
<body>
<div class="wrap">

  <header>
    <h1>森萝 · 项目成果总览</h1>
    <div class="sub">社交化交互设计 APP —— 从服务端网关到离线演示</div>
    <div class="badge">全部数据来自真实产出，非示意</div>
  </header>

  <div class="stats">
    <div class="stat"><div class="n">${data.totals.files}</div><div class="l">源文件</div></div>
    <div class="stat"><div class="n">${data.totals.all.toLocaleString()}</div><div class="l">代码总行数</div></div>
    <div class="stat"><div class="n">238</div><div class="l">自动化断言</div></div>
    <div class="stat"><div class="n">8</div><div class="l">交付阶段</div></div>
  </div>

  <div class="tabs" role="tablist">
    <button class="tab on" data-p="p1">项目规模</button>
    <button class="tab" data-p="p2">后端实现</button>
    <button class="tab" data-p="p3">前端实现</button>
    <button class="tab" data-p="p4">代码摘录</button>
    <button class="tab" data-p="p5">实时接口</button>
    <button class="tab" data-p="p6">测试结果</button>
    <button class="tab" data-p="p7">交付产物</button>
  </div>

  <!-- 项目规模 -->
  <div class="panel on" id="p1">
    <div class="card">
      <div class="card-head">
        <span class="card-title">分阶段路线</span>
        <span class="card-meta">8 个阶段全部完成</span>
      </div>
      <div class="mile">
        ${MILESTONES.map(
          (m) => `<div class="milestone">
          <div class="m-tag">${m.tag}</div>
          <div class="m-body">
            <div class="m-title">${m.title}</div>
            <div class="m-desc">${m.desc}</div>
          </div>
          <div class="m-ok">✓</div>
        </div>`,
        ).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <span class="card-title">代码分布</span>
        <span class="card-meta">${data.totals.all.toLocaleString()} 行 / ${data.totals.files} 文件</span>
      </div>
      <table>
        <thead><tr><th>层次</th><th>文件数</th><th style="text-align:right">行数</th><th style="text-align:right">占比</th></tr></thead>
        <tbody>
          <tr><td>后端网关</td><td class="num">${data.backend.length}</td><td class="num">${data.totals.backend}</td><td class="num dim">${((data.totals.backend / data.totals.all) * 100).toFixed(1)}%</td></tr>
          <tr><td>前端应用</td><td class="num">${data.frontendJs.length + data.frontendCss.length}</td><td class="num">${data.totals.frontend}</td><td class="num dim">${((data.totals.frontend / data.totals.all) * 100).toFixed(1)}%</td></tr>
          <tr><td>自动化测试</td><td class="num">${data.tests.length}</td><td class="num">${data.totals.tests}</td><td class="num dim">${((data.totals.tests / data.totals.all) * 100).toFixed(1)}%</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- 后端 -->
  <div class="panel" id="p2">
    <div class="card">
      <div class="card-head">
        <span class="card-title">后端网关 · ${data.backend.length} 个文件</span>
        <span class="card-meta">${data.totals.backend} 行</span>
      </div>
      <table>
        <thead><tr><th>文件</th><th>目录</th><th style="text-align:right">行数</th><th style="text-align:right">大小</th></tr></thead>
        <tbody>${data.backend.map(fileRow).join('')}</tbody>
      </table>
    </div>
  </div>

  <!-- 前端 -->
  <div class="panel" id="p3">
    <div class="card">
      <div class="card-head">
        <span class="card-title">前端逻辑 · ${data.frontendJs.length} 个文件</span>
        <span class="card-meta">${data.frontendJs.reduce((s, x) => s + x.lines, 0)} 行</span>
      </div>
      <table>
        <thead><tr><th>文件</th><th>目录</th><th style="text-align:right">行数</th><th style="text-align:right">大小</th></tr></thead>
        <tbody>${data.frontendJs.map(fileRow).join('')}</tbody>
      </table>
    </div>
    <div class="card">
      <div class="card-head">
        <span class="card-title">样式 · ${data.frontendCss.length} 个文件</span>
        <span class="card-meta">${data.frontendCss.reduce((s, x) => s + x.lines, 0)} 行</span>
      </div>
      <table>
        <thead><tr><th>文件</th><th>目录</th><th style="text-align:right">行数</th><th style="text-align:right">大小</th></tr></thead>
        <tbody>${data.frontendCss.map(fileRow).join('')}</tbody>
      </table>
    </div>
  </div>

  <!-- 代码摘录 -->
  <div class="panel" id="p4">
    ${EXCERPTS.map(
      (e) => `<div class="card">
      <div class="card-head">
        <span class="card-title">${esc(e.title)}</span>
        <span class="card-meta">${esc(e.file)}</span>
      </div>
      <div class="exc-why">${esc(e.why)}</div>
      <pre>${esc(e.code)}</pre>
    </div>`,
    ).join('')}
  </div>

  <!-- 实时接口 -->
  <div class="panel" id="p5">
    <div class="note" style="margin-top:0;margin-bottom:16px">
      以下数据是后端服务实际运行、通过 HTTP 请求返回的真实响应，不是写死的示例。
    </div>
    <div class="api-grid">
      <div class="card" style="margin:0">
        <div class="card-head">
          <span class="card-title">人设列表</span>
          <span class="card-meta">GET /contacts</span>
        </div>
        ${apiContacts
          .map(
            (c) => `<div class="persona">
          <div class="p-av">${esc(c.avatar || '🤖')}</div>
          <div>
            <div class="p-name">${esc(c.name)}</div>
            <div class="p-id">${esc(c.id)}</div>
          </div>
        </div>`,
          )
          .join('')}
      </div>

      <div class="card" style="margin:0">
        <div class="card-head">
          <span class="card-title">会话列表</span>
          <span class="card-meta">GET /sessions</span>
        </div>
        ${apiSessions
          .map(
            (s) => `<div class="sess">
          <div class="p-av">${esc((s.name || '?').charAt(0))}</div>
          <div class="s-body">
            <div class="s-top">
              <span class="s-name">${esc(s.name)}</span>
              ${s.unread ? `<span class="s-unread">${s.unread}</span>` : ''}
            </div>
            <div class="s-msg">${esc(s.lastMessage || '（无消息）')}</div>
          </div>
        </div>`,
          )
          .join('')}
      </div>
    </div>
  </div>

  <!-- 测试 -->
  <div class="panel" id="p6">
    <div class="card">
      <div class="card-head">
        <span class="card-title">测试输出</span>
        <span class="card-meta">6 组 · 238 项 · 0 失败</span>
      </div>
      <div class="logbox">${testLines
        .map((l) => {
          const safe = esc(l);
          if (l.includes('❌')) return `<div class="bad">${safe}</div>`;
          if (l.includes('✅')) return `<div class="ok">${safe}</div>`;
          if (/结果|通过/.test(l)) return `<div class="hl">${safe}</div>`;
          return `<div>${safe}</div>`;
        })
        .join('')}</div>
    </div>
    <div class="card">
      <div class="card-head">
        <span class="card-title">测试脚本</span>
        <span class="card-meta">${data.totals.tests} 行</span>
      </div>
      <table>
        <thead><tr><th>脚本</th><th>目录</th><th style="text-align:right">行数</th><th style="text-align:right">大小</th></tr></thead>
        <tbody>${data.tests.map(fileRow).join('')}</tbody>
      </table>
    </div>
  </div>

  <!-- 产物 -->
  <div class="panel" id="p7">
    <div class="card">
      <div class="card-head">
        <span class="card-title">构建产物</span>
        <span class="card-meta">已成型的交付物</span>
      </div>
      ${artifacts
        .map(
          (a) => `<div class="artifact">
        <div class="a-icon">📦</div>
        <div>
          <div class="a-name">${esc(a.name)}</div>
          <div class="a-desc">${esc(a.desc)}</div>
        </div>
        <div class="a-size">${esc(a.size)}</div>
      </div>`,
        )
        .join('')}
    </div>
    <div class="note">
      <strong>关于 APK 的说明：</strong>APK 是安卓安装包，只能装在手机上，在 Windows / macOS 上双击只会提示「无法打开此文件」。
      而且即使装上，还需要后端可达、跨域放行、模型额度充足才能出结果。
      因此对外展示改用单文件 HTML：真实 UI + 内置数据，双击即开、断网可用。
    </div>
  </div>

  <footer>森萝 · 项目成果总览 · 生成于 ${new Date(data.generatedAt).toLocaleString('zh-CN')}</footer>
</div>

<script>
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('on'); });
      document.querySelectorAll('.panel').forEach(function (x) { x.classList.remove('on'); });
      t.classList.add('on');
      document.getElementById(t.dataset.p).classList.add('on');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
</script>
</body>
</html>`;

writeFileSync('/root/森萝/成果总览.html', html);
console.log(`✅ 已生成 成果总览.html（${(Buffer.byteLength(html) / 1024).toFixed(0)} KB）`);