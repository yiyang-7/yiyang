# DeepSeek 风格 AI 聊天前端

React + Vite + CSS Modules。**DeepSeek App 的主框架 + 微信气泡的对话流。**
后端是 DSH Harness 网关（Express + node:sqlite）。

## 访问

| 地址 | 说明 |
|---|---|
| http://127.0.0.1:5173 | 前端（Vite dev server） |
| http://172.30.227.102:5173 | 同一服务，局域网可访问 |
| http://127.0.0.1:3090 | 后端（仅回环，经 Vite 代理 `/api` 访问） |

```bash
# 后端
cd /root/森萝 && NODE_OPTIONS="--require /tmp/preload.cjs" PORT=3090 node server.mjs
# 前端
cd /root/森萝/web && npx vite --host 0.0.0.0 --port 5173 --strictPort
```

> `preload.cjs` 把 `fs.promises.link` 替换成 `copyFile`——这台机器的文件系统
> 不支持硬链接，DSH 启动自检会失败。

## 演示版（无需后端、无需联网）

**为什么需要这个**：APK 只能在安卓设备上运行，电脑上打不开；
真跑起来还要求后端可达、模型额度充足。要给不在一台机器上的人看效果，
这两条都不成立。

演示版把整个应用打成**一个 HTML 文件**，所有接口短路到内置数据：

```bash
npm run build:demo     # → web/demo/演示版.html（约 4.6MB）
```

双击就能打开。不需要 node、不需要起服务、断网也行。

### 已修复的两个 bug

**1. 点击历史会话进不去聊天界面**

根因：后端 `/sessions` 返回的字段叫 `name`，而演示数据只写了 `title`。
`App.jsx` 靠 `session.name` 去找联系人，取不到就退回默认角色，
路由虽然变了但内容对不上，看起来像「点了没反应」。

修复：演示数据补齐 `name` 字段。

**2. 对方回答一闪就消失**

根因在 `done` 帧。`useChat` 收到 `done` 时用 `data.text` 作为最终正文；
演示版这里传了空串，于是它退回去读「还没吐完的打字机队列」——
而那时队列早已被清零，`finalContent` 变成空，被判为「空回复」，
**整个气泡被删掉**。

修复：`done` 帧带上完整正文（与真后端行为一致）。

### 新增的四个功能

| 功能 | 实现 |
|---|---|
| 切会话微动画 | 220ms 淡入上浮，覆盖整块聊天区 |
| 消息入场动画 | 气泡浮起 + 轻微缩放 260ms，头像延迟 40ms 淡入 |
| 快捷回复 | 输入框上方 2–3 个胶囊，按上下文和人设现算 |
| 自定义头像 / 昵称 | 设置面板，emoji 或本地图片 |

**快捷回复不是固定轮播**。它读最后一条 AI 回复的内容特征：
有代码块 → 给「这段代码什么意思」；在安慰情绪 → 给「谢谢你」；
有建议 → 给「具体怎么做」。同一段回复在不同人设下语气也不同
（猫娘给「再多说一点喵」，管家给「请继续」）。

**头像完全本地生成，不再请求 dicebear**。原来用
`api.dicebear.com` 拉远程图，演示版是离线单文件，头像位置必然一片空白。
现在按 seed 生成稳定渐变 + 名字首字，三种渲染方式：
自定义图片 > 自定义 emoji > 生成渐变。

### API 密钥

设置面板第二个标签页可以填 DeepSeek 的 Key，存在本机 localStorage。

填了之后演示版会尝试**直连官方接口**真实对话；失败就自动退回内置回复，
并给一条非致命提示——不会白屏。之所以说「尝试」，是因为
浏览器直连 `api.deepseek.com` 属于跨域请求，官方通常不放行。
真正的生产用法是走网关，密钥由后端代持。

### 它展示的是什么

**真实的 UI，内置的数据**。渲染走的还是同一套组件、同一份 CSS，
所以气泡、思考面板、打字机、未读红点、复制/重新生成都是真代码在跑，
不是截图，也不是另做一套假界面。

内容是 4 段预置对话 + 关键词路由的假回复。输入里带「代码」会给代码块，
带「累」走安抚分支，带「为什么」走解释分支。重新生成会换一个开头，
这样能看出「确实重新问了一次」而不是重播。

右下角常驻一个角标：`演示版 · 本地数据，未连接模型`。
避免被误认为真的在调模型。

### 单文件是怎么来的

`file://` 下浏览器会用 CORS 规则拦截 `<script type="module" src="...">`，
所以产物必须自包含。`scripts/build-demo.mjs` 做了三件事：

1. JS/CSS 内联进 HTML（`vite.config.js` 里 `inlineDynamicImports` 打成单 chunk）
2. 字体转 base64（只取 woff2，woff/ttf 是兜底，内联会让体积翻倍）
3. 校验没有残留的外部 `src` —— 有就直接失败，不产出打不开的文件

`import.meta.env` 在构建期被替换成字面量，所以运行时不需要 Vite 的环境变量机制。

### 已验证 / 未验证

已验证：
- 内联 JS 语法正确（`node --check`）
- 无静态/动态 import 残留，`import.meta.env` 为 0 处
- 演示数据能渲染出代码块、表格、标题、粗体、思考面板、操作按钮（SSR 实测）
- 假流帧顺序 `ready → accepted → reasoning… → delta… → done`
- 中途 abort 抛 `AbortError`；重新生成内容与首次不同
- 模块能被 JS 引擎加载执行到挂载阶段（`npm run test:demo`）

未验证：
- 没有真实浏览器跑过——这台机器缺 `libnspr4`，无 root 装不了 Chromium。
- 因此「双击后视觉上长什么样」只能在你自己电脑上确认。

### 发布成网址（可选）

`.github/workflows/deploy-demo.yml` 会把演示版部署到 GitHub Pages，
这样发给别人一个链接就行。

**当前状态：构建通过，部署待启用。**

首次运行结果：`build` 作业全部成功（`github-pages` 产物已上传，1.0MB），
但 `deploy` 作业失败：

```
Error: Failed to create deployment (status: 404)
Ensure GitHub Pages has been enabled: .../settings/pages
```

原因是 GitHub Pages 还没在仓库里启用。这一步必须在网页上手动做一次
（涉及 OIDC 授权，无法通过 API 完成）：

**Settings → Pages → Source 选 "GitHub Actions"**

启用后在 Actions 页面重跑 `Deploy Demo` 即可，地址形如
`https://<用户名>.github.io/<仓库名>/`。之后每次 push 到 main 自动重新部署。

## 界面结构

```
┌──────────────────────────────────┐
│ ☰      新对话 / 会话名        ✚  │  顶栏
│            ● 在线                │
├──────────────────────────────────┤
│        12:34                     │  对话区  flex:1，浅灰底，可滚动
│  ⬤  ┌─────────────┐              │
│  鲸  │ 白气泡       │              │  AI：左，白气泡 + DeepSeek Logo
│      └─────────────┘              │
│           ┌─────────────┐  🙂   │
│           │ 绿气泡       │        │  用户：右，绿气泡 + 圆头像
│           └─────────────┘        │
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │ 给 DeepSeek 发送消息          │ │  输入区
│ │ ⚪深度思考(R1) ⚪联网搜索 📎 🎤 ⬆│ │  胶囊卡片 + 功能按钮
│ └──────────────────────────────┘ │
│      内容由 AI 生成，请仔细甄别     │
└──────────────────────────────────┘
```

侧边栏是**抽屉**（点 ☰ 打开），叠加不占布局宽度：
品牌 + 开启新对话 + **选择 AI**（猫娘 / 程序员 / 管家…）+ 历史对话列表。
ESC / 点遮罩关闭，打开时锁背景滚动。

点某个 AI → 回到新对话，之后的消息按那个人设回复（见「多角色人设」）。

## 后端支持边界（重要）

输入区四个功能按钮，**深度思考、联网搜索、附件、语音都没有后端支撑**：

| 按钮 | 状态 |
|---|---|
| 深度思考 (R1) | UI 开关可切换，**不影响请求**。后端无 reasoning 参数；<br>但 `reasoning` 帧的解析/落库/回显链路已就绪，换 R1 模型即可用 |
| 联网搜索 | 同上，后端无检索能力 |
| 附件 | 只把文件名拼进消息正文，无上传接口 |
| 语音输入 | 点击弹提示，未接入 Web Speech API |

前两个带黄色小圆点，悬停有说明。**没有假装能用**——让开关静默失效比明确标注更糟。
等后端支持了，把参数接进 `useChat.send()` 即可。

## 目录

```
web/
├── src/
│   ├── pages/
│   │   ├── App.jsx             外壳：数据编排（会话列表 / UI 开关 / 导航）
│   │   └── App.module.css      .app 撑满视口的 flex 容器
│   ├── components/
│   │   ├── MessageBubble.jsx   微信气泡（左白 / 右绿 / 圆头像 / 尖角）
│   │   ├── markdown/labels.js  MarkdownText 的本地化文案（须引用稳定）
│   │   ├── thinking/
│   │   │   ├── ThinkingPanel.jsx       深度思考面板（官方 DisclosureRow）
│   │   │   └── ThinkingPanel.module.css
│   │   ├── chat/
│   │   │   ├── ChatArea.jsx    主聊天区：顶栏 / 列表 / 提示条 / 输入框 / 滚动
│   │   │   ├── ChatArea.module.css
│   │   │   ├── HistorySkeleton.jsx     历史加载骨架屏（气泡占位 + 流光）
│   │   │   ├── HistorySkeleton.module.css
│   │   │   └── messageTime.js  时间分隔规则 / 时间格式化
│   │   ├── deepseek/
│   │   │   ├── icons.jsx       12 个手写内联 SVG 图标
│   │   │   ├── sprite.js       注入官方图标的 <symbol>
│   │   │   └── ChatInput.jsx   DeepSeek 胶囊输入区
│   │   └── sidebar/
│   │       ├── Sidebar.jsx     抽屉外壳（遮罩 / ESC / 锁滚动）
│   │       ├── Sidebar.module.css
│   │       ├── SidebarContent.jsx     抽屉内容（品牌 / 新建 / 选 AI / 历史列表）
│   │       └── SidebarContent.module.css
│   ├── hooks/
│   │   ├── useChat.js          历史加载 + 流式接收 + 打字机 + stop
│   │   └── useRoute.js         hash 路由
│   ├── services/
│   │   ├── api.js              fetch 封装 / SSE 解析
│   │   └── session.js          userId 管理
│   └── styles/global.css       CSS 变量、外框、dvh
└── scripts/
    ├── render-app.mjs          结构验证（SSR + 源码 + CSS 类名）
    ├── e2e-streaming.mjs       流式打字机端到端验证
    └── e2e-reasoning.mjs       深度思考双流端到端验证
```

## 路由

hash 路由，两种形态：

| hash | 含义 |
|---|---|
| `#/` | 新对话（无 conversationId，首条消息时分配） |
| `#/chat/<id>` | 某个历史会话 |

用会话 id 而不是联系人 id 寻址——一个联系人可以有多条会话。

## 社交状态感

三件事：会话列表的未读红点 + 时间、进会话清红点、生成中的「对方正在输入...」与「有新消息 ↓」。

### 未读数怎么算

会话表有个 `unread_count` 字段：**AI 回复落库时，如果用户不在这个会话就 +1**；
进入会话时按实际游标重算并清零。

`GET /api/sessions` 每条带 `unread`（该字段）和 `unreadActual`（按游标现算的真实值）。
两者正常相等，不相等说明计数漂移。

#### 为什么不用 COUNT(*) 现算

现算要求「用户此刻在看哪」这个信息**在读取时**可得，但它只在写入时可得。
计数还是个会变化的业务状态：同一个游标下，「刚产生 3 条」和「看完清零」
在数据上一模一样，无法从消息表推导。所以要一个冗余字段。

冗余字段的风险是会漂移，所以 `markRead` 不是简单置 0，而是**按真实游标重算并覆盖**，
让计数能自我校正。有一项测试专门注入漂移，验证能被纠正。

#### 怎么知道用户「不在当前会话」

前端在**进入/离开会话、页面切到后台**时上报 `POST /api/presence { userId, conversationId }`，
服务端存内存（`lib/presence.mjs`，5 分钟 TTL，不落库）。

两个实现要点：

**1. 判据必须在落库那一刻求值。** 早期写成请求开始时算一次常量，
那就退化成「他发消息时在哪」——永远是 true，未读永远不 +1。
现在是个函数 `isViewingNow()`，在 `finalizeMessage` 前调用。

**2. 「从未上报」和「明确离开」必须分开。** 早期用 `map.delete()` 表示离开，
结果两种情况混在一起：明确离开被当成没上报，走了保守分支（算作在看），
未读永远不 +1。现在用一个独立的 `away` 集合区分，有测试守着。

#### 游标要和计数一起推

用户正看着时不计未读，但**游标也必须推上去**。

只把 `unread_count` 留在 0 是不够的：按游标现算的真实值会变成 1，
两个数对不上，下次任何一次重算（`markRead` / 迁移 / 排查）都会凭空冒出一个红点。

这条不变式放在 `history-store` 里，而不是让每个调用方自己记得调 `markRead`——
漏一个地方就会出现「红点自己冒出来」。

关键实现选择：**游标用 `rowid` 而不是时间戳。**

一开始用 `last_read_at`（毫秒时间戳）做游标，判定是 `created_at > last_read_at`。
这有个稳定的漏洞——同一毫秒内落库的两条消息 `created_at` 完全相同：

```
写「旧的」→ 标记已读（游标 = T）→ 写「新的」（created_at 也是 T）
→ T > T 不成立 → 新消息被算作已读 → 红点不亮
```

这个 bug 在测试里 5 轮全部复现。用户看完消息、AI 在同一毫秒回话，那条回复就永远不会提醒。
改成 `last_read_rowid`（SQLite 插入序号，严格单调）后消失。

老库迁移时会把 `last_read_at` 换算成 `last_read_rowid`，**已读状态不倒退**——
不换算的话，所有历史会话会突然一起冒出红点。

### 正在看的会话不显示红点

两层保证：

1. 前端渲染时 `active ? 0 : s.unread`——用户正盯着这个会话，挂红点只会让人以为漏了什么
2. 流式结束时补一次 `markSessionRead`

第 2 条是必须的。已读游标是**进页面时**推进的，而 AI 回复在**流结束时**才落库，
时间顺序天然导致自己刚说完的话被算成「未读 1 条」。

### 「有新消息 ↓」

用户向上翻、离开底部超过 240px 时，消息区底部浮出胶囊按钮，点击滚到底并恢复自动跟随。

阈值带回差：贴底判定 120px、浮标判定 240px。用同一个阈值的话，手指刚往回滚一点
浮标就冒出来，停稳后又消失，很吵。

浮标挂在滚动容器 **外面**（`.listWrap` 内、`main` 外）：挂在里面会跟着内容一起滚走。

### 时间分档

| 情况 | 显示 |
|---|---|
| 今天 | `15:42` |
| 昨天 | `昨天` |
| 本周内 | `星期三` |
| 更早 | `3/15` |

不用「刚刚 / 3 分钟前」：列表会长期挂在屏幕上不刷新，相对时间很快就变成谎话。

## 多角色人设（ai_contacts）

每个 AI 就是一套人设，存在 SQLite 的 `ai_contacts` 表里：

| id | 名字 | 语气 |
|---|---|---|
| `catgirl` | 傲娇猫娘 🐱 | 带「喵」，嘴硬心软 |
| `coder` | 程序员老周 👨‍💻 | 严谨干练，只给能跑的代码 |
| `butler` | 沉稳管家 🎩 | 克制、不寒暄，称「先生/女士」 |
| `default` | 通用助手 🤖 | 人设留空 = 不覆盖 profile 默认 |

侧边栏「选择 AI」里点一个 → 回到新对话 → 发的消息就按那个人设走。

### 注入链路

```
POST /api/chat { conversationId, message, contactId }
  → 建会话时把 contactId 写进 conversations 表（绑定后不可变）
  → 冷启动拉进程时读 ai_contacts.system_prompt
  → buildContactPatch() 生成 YAML，写进 _patches/<user>/<conv>-<hash>.patch.yml
  → dsh --profile sdk --patch <file>
  → system-prompt 插件的 personaPrefix
```

人设**只在这个时刻生效**：进程已存在时复用，不会重新注入。
所以一个会话的人设一生不变，中途换 contactId 也不会改变它。

### 三条安全边界

**1. 人设不能来自请求体。** 早期版本从 `req.body.persona` 取，等于把 system prompt
的写权限交给调用方。现在只认数据库，请求体里带 `persona` 会被忽略（有测试守着）。

**2. 会话绑定后不可变。** 同一个 conversationId 第二次请求带不同 contactId，
以第一次为准——否则历史对话的语义会错乱（前面猫娘说的、后面管家接话）。

**3. 空 system_prompt 不写 personaPrefix。** 写成空字符串会把 profile 自带的人设
抹成空，模型收到「你的设定是：」之后就没了。

### patch 文件名为什么带哈希

`sanitize()` 把 `a/b` 和 `a:b` 都压成 `a_b`。如果文件名只用它，
两个不同会话会写同一个文件，**后写的覆盖先写的**——表现是「换了会话，
人设却串成了上一个的」。conversationId 来自客户端，这是可控输入触发的碰撞。

所以文件名是 `sanitize(id) + '-' + fnv1a(id)`，可读且唯一。

### 进程池隔离

池的 key 是 conversationId，不是 contactId。同一用户开两个 AI =
两个 conversationId = 两个进程 = 两份 patch，互不可见。

## 移动端适配

### 侧边栏本来就是抽屉

左侧导航从一开始就是 `position: fixed` + 遮罩层的浮层，**不参与文档流**，
所以窄屏上不会挤压主聊天区。不是"在手机上才变成抽屉"，而是任何宽度都是抽屉。

小屏上还做了一件事：宽度 `272px` 但带 `max-width: 82vw` 上限，
320px 的超窄屏上也不会把整屏盖住。

`scripts/mobile-layout.mjs` 把这条路的结构性前提固化成 20 条断言，
包括「没有为侧边栏预留 padding-left」「没有超过 360px 的 min-width」
「860px 居中约束只在 ≥900px 生效」——这些是让手机端不横向溢出的关键。

### 没能做像素级验证

这台机器跑不了无头浏览器：proot 沙箱缺 `libnspr4` / `libnss3`，
而且**没有 root 权限装不了**，chromium 一启动就 `SIGBUS`。

所以移动端验证是结构性的（CSS 规则 + 渲染结构），不是截图。
真要确认视觉，得在 F12 手机模拟器里看一眼。

## 打包成 Android App（Capacitor）

```bash
npm install                      # 已含 @capacitor/core、cli、android
npm run android:sync             # 构建 Web + 同步到 android/
npm run android:apk              # 生成 app-debug.apk
```

产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。

### 三处必须改的地方

打包后 WebView 的 origin 是 `https://localhost`，和浏览器环境有两个本质差异：

**1. 没有 Vite 代理了。** 浏览器里所有请求走 `/api/*` 由 dev server 转发，
App 里没有这一层，相对路径会打到 App 自己的资源服务器，全部 404。

所以加了 `VITE_API_BASE`，构建时指向真实后端：

```bash
VITE_API_BASE=http://192.168.1.10:3090 npm run android:apk
```

为空时保持相对路径，浏览器行为不变。

**2. 跨域了。** App 的 origin 对后端来说是外来者，后端原本**完全没有 CORS 支持**，
不处理的话所有请求都会被浏览器拦掉，表现为白屏或一直转圈。

后端加了 `DSH_CHAT_CORS`：

```bash
DSH_CHAT_CORS="https://localhost,capacitor://localhost" npm start
```

**默认关闭**——这个后端能读写所有会话，把 CORS 开给任意网页
等于把数据交给用户访问过的任何站点。

**3. 后端默认只听 `127.0.0.1`。** 手机连不上，需要：

```bash
DSH_CHAT_HOST=0.0.0.0 PORT=3090 npm start
```

注意这是把服务暴露到局域网，确认你的网络环境可信。

## 用 GitHub Actions 云端构建 APK

本地装不动 Android SDK 也没关系：推送代码后由 GitHub 构建。

`.github/workflows/build-apk.yml`，push 到 `main` 或手动 `workflow_dispatch` 触发。
跑完后在 Actions 页面下载 `app-debug` 这个 artifact，解压就是 APK。

### 有三处和"标准配置"不一样，是必须的

**1. Node 22，不是 20。** `@capacitor/cli@8.6.2` 的 `engines` 是 `>=22.0.0`，
Node 20 上 `npx cap sync android` 会因引擎不兼容直接失败。
Vite 8 要求 `^20.19.0 || >=22.12.0`，所以 22 是两个依赖的唯一交集。
要退回 Node 20，必须同时把 Capacitor 降到 7.x。

**2. Java 21，不是 17。** `android/capacitor-cordova-android-plugins/build.gradle`
里写死 `sourceCompatibility = JavaVersion.VERSION_21`，
用 JDK 17 编这个模块会报 `invalid source release: 21`。

**3. 额外装 SDK Platform 36。** `android-actions/setup-android` 只装 cmdline-tools，
不装 SDK Platform。本工程 `compileSdk = 36`，runner 镜像不一定预装，
缺了会报 `Failed to find target with hash string 'android-36'`。

### 路径注意

前端在 `web/` 子目录。工作流用
`defaults.run.working-directory: web` 统一处理 `npm` / `cap` / `gradlew`，
但 **artifact 的 `path` 是相对仓库根目录**的，所以写
`web/android/app/build/outputs/apk/debug/app-debug.apk`。
这两个路径规则不一样，常在这里写错。

### 配一下 VITE_API_BASE

仓库 Settings → Variables 里加 `VITE_API_BASE`（如 `http://192.168.1.10:3090`）。
不配也能构建成功，但 APK 装到手机上会连不上服务端——工作流会打一条 warning 提示。

后端那边还要放开跨域和监听地址：

```bash
DSH_CHAT_HOST=0.0.0.0 \
DSH_CHAT_CORS="https://localhost,capacitor://localhost" \
PORT=3090 npm start
```

### 仓库里必须有的东西

`android/` 工程要提交（含 `gradle/wrapper/gradle-wrapper.jar`），
`.gitignore` 只忽略 `web/android/**/build/`、`.gradle/`、`local.properties`。
把整个 `android/` 忽略掉的话，CI 上找不到工程，`cap sync` 会直接失败。

## 对话控制

### 停止生成

AI 流式生成时，发送按钮变成**红色**停止按钮（`#f5222d`，和品牌蓝 `#4d6bfe` 区分开）。
点击走 `AbortController.abort()`，中断 fetch。

中断后本地把消息标成 `interrupted`，内容为空的直接丢弃。
服务端在 `res.on('close')` 里把已推出去的部分落库并标 `interrupted`——
用户看到的半截回答不会丢。

### 重新生成 / 复制

挂在**最后一条 AI 回复**下方，两个小图标：

- **复制** —— `navigator.clipboard` 需要安全上下文（https 或 localhost）。
  本项目常在局域网 http 下访问，那里 `navigator.clipboard` 是 `undefined`，
  所以必须有 `execCommand` 兜底，否则按钮点了毫无反应。成功后有 1.5 秒绿色对勾。
- **重新生成** —— 撤回上一条 AI 回复，基于最后一条用户消息重发。

操作栏只在**列表最后一条、且不在流式中**时才渲染。判定用「从末尾往前找到的第一条
非用户消息」并要求它就在列表末尾：如果用户刚发完、AI 还在思考，末尾是用户消息，
此时给更早的那条回复挂操作栏，重新生成会误删用户刚说的话。

### 重新生成为什么需要服务端配合

只在改前端是不够的。`send()` 会无条件追加一条用户消息，后端 `/chat` 也会
`appendMessage({ role: 'user' })`——两边都会让同一句话在历史里出现**两次**。

所以 `regenerate: true` 时：

1. 服务端先调 `history.rewindLastReply()`：删掉最后一条用户消息**之后**的
   assistant 消息（用户那句话保留——他要重新生成的是回复，不是否认自己问过）
2. 复用被撤回的那条用户消息，**不再插入**新的
3. 用数据库里的 content 作为 prompt，**不信请求体**

第 3 点很关键：请求体里的文本可能是占位或被篡改的，以库为准才能保证
「模型看到的」和「历史里记着的」是同一句话。有测试专门塞了不同的文本验证。

### 白名单坑（踩过两次）

`streamChat` 的 body 是显式白名单，漏写一个字段不会报错，只是**功能静默失效**：

- `viewingConversationId` 漏过一次 → 未读计数的判据恒为空值
- `regenerate` 差点再漏一次

测试脚手架 `startChat` 里同样的问题。现在两处都有守卫断言盯着。

## 主动消息（Active Message）

让 AI 在没有用户请求的情况下主动说一句话，比如每天早上 9 点的问候。

### 开启方式

默认**关闭**。它会产生用户没发过的消息，自动开启是危险的默认值，必须显式配置：

```bash
DSH_ACTIVE_MESSAGES=1                  # 总开关
DSH_ACTIVE_CONVERSATIONS=demo-catgirl  # 逗号分隔，只对这些会话触发
DSH_ACTIVE_CRON='0 9 * * *'            # 默认每天 9:00
DSH_ACTIVE_TZ=Asia/Shanghai            # 不设则用系统时区
DSH_ACTIVE_PROMPT='...'                # 可选，覆盖默认问候语
DSH_ACTIVE_ALLOW_TRIGGER=1             # 可选，挂 POST /active/trigger 手动触发
```

`GET /active/jobs` 可以看任务注册状态和最近一次执行结果。

### 默认 prompt

> 现在是早晨，请以你当前的人设，向用户主动发一句早安问候。
> 要求：只说一两句话，自然口语，不要复述或解释这条指令，不要加标题。

后面那两句约束是必要的：不加的话模型容易回复「好的，我来帮你生成一句早安问候：……」，
把指令本身念出来，非常出戏。

### 三条必须守住的约束

**1. 拿会话的轮次锁。** dsh 进程是常驻的，定时器和用户请求会往同一个进程写 prompt。
不拿锁（`acquireTurn`，`/chat` 用的同一把）两边回复会串在一起，聊天记录直接乱掉。

**2. 冷启动要回灌历史。** 进程空闲 30 分钟后被回收，早上的第一次触发必然是冷启动。
不回灌的话，模型看不到昨天的对话，问候会像失忆一样自顾自说话。

**3. 必须在已有会话上触发。** 对不存在的 conversationId 硬发，会凭空创造出一个
联系人信息、历史全空、用户从没见过的新会话——界面上冒出一条无源消息。
所以 `runActiveTurn` 先查会话，不存在就报 `NO_CONVERSATION` 并跳过。

### 失败必须吞掉

node-cron 不处理异步异常。定时任务里抛出的 rejection 会变成进程级未捕获异常，
直接把整个后端带走——用户之后的所有请求都会失败。

所以每个任务独立 try/catch，失败只记日志和 `lastRun`，返回而不是抛出。
有一项测试专门验证这条。

### 不堆积

上一轮还在跑（模型慢或卡住）时，本轮直接跳过。否则会排队积压，
用户在 9:05 收到 9:00 起排队的七八条问候。

## 历史记录回显

页面加载和切换会话时各拉一次后端，没有前端假数据。

| 时机 | 请求 | 用途 |
|---|---|---|
| 页面加载 | `GET /api/sessions?userId=` | 侧边栏会话列表（名称、头像、最后一条、未读） |
| 进入某个会话 | `GET /api/messages?conversationId=&userId=` | 该会话的历史消息，按时间正序 |

`/api` 前缀由 Vite 代理去掉，后端实际是 `/sessions` 与 `/messages`。
后端另有等价路径 `/conversations/:id/messages`（早期 RESTful 形态），
两条走**同一段实现**，不会出现行为漂移。

### 历史消息怎么变回气泡

接口返回的行直接就是气泡要的形状，不需要中间映射层：

```json
{ "id": "...", "role": "assistant", "content": "正文",
  "status": "completed", "createdAt": 1700000000000,
  "thinking": "思考正文", "thinkingMs": 7400 }
```

`role` 决定左右与绿白，`thinking` / `thinkingMs` 驱动折叠面板。
老数据没有这两个字段时全部按「没思考」处理，不会崩。

**但字段名对不上时，所有单点测试都会绿而界面是空的。**
所以额外有一条端到端测试：真 SQLite 写入 → 真 HTTP 取回 → 真组件 SSR，
专门守这条接缝（`npm run test:history`）。

### 思考内容也落库

原来 `messages` 表只有正文，思考内容只活在内存里，刷新就没了。
现在加了 `thinking` / `thinking_ms` 两列，和正文一样**在流结束时一次性写**。
老库启动时自动 `ALTER TABLE` 补列（`migrateLegacySchema`），数据不丢。

### 加载骨架屏

不是转圈，而是铺 5 条交替左右的气泡占位（右侧用浅绿），
整体一道流光扫过，下面一行「加载中...」。

装饰块 `aria-hidden`，另有一个 `role="status"` 的文本节点给读屏；
`prefers-reduced-motion` 下不扫光，只留静态占位。

## 流式打字机

```
点击发送
  → ① 立刻插入用户气泡（乐观更新，不等服务端）
  → ② 立刻插入空 AI 气泡，isStreaming=true，
       文案「DeepSeek 思考中...」
  → ③ POST /api/chat，body: { conversationId, message, userId, contactId }
  → ④ TextDecoder + getReader 逐块解析 SSE
  → ⑤ delta 进队列，16ms 定时器逐字吐出 → 打字机
  → ⑥ done：等队列吐完 → isStreaming=false，用服务端全文兜底
```

**占位气泡的文案状态机：**

| 时机 | 文案 |
|---|---|
| 刚发送 | DeepSeek 思考中... |
| 收到 `status{state:'queued'}` | 排队中... |
| 收到第一个 `delta` | 清空，开始出字 |
| `done` | 气泡已停 -> 完成 |

关键细节：后端的 `status` 帧有两种形态——排队帧带 `state:'queued'`，
`session.status` 帧没有 `state` 字段。**只有排队帧才改文案**，
否则每来一个会话状态帧都会把「排队中」冲掉。

**滚动用 `endRef.current.scrollIntoView({ block: 'end' })`**，
锚点始终挂在列表末尾（加载态、欢迎页、消息列表三种分支之外），
保证任何时候都有滚动的目标。

**为什么用队列。** 模型 delta 粒度不可控（有时半个词，有时十几个字），
直接渲染是「整块跳出来」。

**两个边界：**

| 边界 | 不处理的后果 |
|---|---|
| 积压超过 12 字时加速追赶 | 长回复明显落后于网络 |
| 流结束 flush 剩余队列 | **尾字丢失**，气泡停在半句话 |

**滚动**：依赖里必须带最后一条消息的 `content.length`。流式追加不改变数组长度，
只监听 `messages.length` 的话打字过程中页面不会跟着走。

## 六个容易踩的坑（已处理）

| 坑 | 症状 | 解法 |
|---|---|---|
| `.list` 缺 `min-height: 0` | 消息多了撑破容器，**滚不动** | flex 子项默认 `min-height:auto`，必须显式归零 |
| 用 `100vh` | iOS 上底部被地址栏裁掉 | 用 `100dvh`，不支持的回落 `100%` |
| 输入框 `position: fixed` | 软键盘弹起时被遮住 | 用 `flex: 0 0 auto`，视口收缩时自然让位 |
| `interactive-widget` 缺失 | 安卓键盘覆盖页面 | viewport 加 `interactive-widget=resizes-content` |
| 官方图标 sprite 未注入 | 图标**空白**，不报错 | 从 `ICON_SYMBOLS` 取符号挂到 body，属性要搬到 `<symbol>` |
| 气泡 `pre-wrap` 遇上 Markdown | 每个换行多出一行空白 | `.markdown` 容器重置为 `white-space: normal` |

## 深度思考（reasoning_content）

### 数据通路

后端 SSE 帧里出现 `event: reasoning` 时，`useChat` 把 `data.text` 追加进
**独立的思考队列**，与正文队列分开：

```
reasoning 帧 ──→ thinkQueueRef ──┐
                                 ├──→ 同一个 16ms 打字机 ──→ message.thinking / message.content
delta 帧     ──→ queueRef     ──┘
```

- 思考队列**优先消费**：正文是结果，不该排在思考后面等。
- 第一条 `delta` 到达时 `thinkingStreaming` 置 false，面板标题从
  「思考中...」切到「已深度思考（用时 X 秒）」并自动折叠。
- `done` / `error` / `abort` 三种收尾都会 flush **两条**队列，不会丢尾字。

### 消息对象新增字段

| 字段 | 含义 |
|---|---|
| `thinking` | 思考正文，`''` 表示这条消息没有思考 |
| `thinkingStreaming` | 是否仍在思考，驱动面板标题与动画 |
| `thinkingMs` | 思考耗时（毫秒），标题里换算成秒 |

### 用假流验证 UI

后端当前是 `deepseek-chat`（V3），**不产生 reasoning_content**，
DSH 运行时里也没有 thinking/reasoning 内容块。所以思考面板用前端假流验证：

```
http://127.0.0.1:5173/?mock=reasoning
```

假流每 50ms 抛一片 `reasoning`，抛完再抛 `delta`，帧顺序与真实后端一致
（`ready → accepted → reasoning×5 → delta×8 → done`）。
去掉参数即回到真实链路，代码里无需改动。

### 接真实后端还差什么

1. `server.config.json` 的 `llm.model` 换成 R1 系列（如 `deepseek-reasoner`）。
2. `lib/chat-route.mjs` 的 `extractText()` **只认 `b.type === 'text'`**，
   思考块会被直接丢弃。需要在里面单独识别推理块，并通过
   `send('reasoning', { text })` 发出去。
3. `done` 帧带上思考全文，服务端 `messages` 表需要有列存它——
   目前 `history-store.mjs` 没有 thinking 字段，刷新后思考会丢失。

## 已验证

```bash
cd /root/森萝/web && node scripts/render-app.mjs      # 结构验证
cd /root/森萝/web && node scripts/e2e-streaming.mjs   # 流式验证
cd /root/森萝/web && node scripts/e2e-reasoning.mjs   # 深度思考验证
```

- 结构验证全部通过：输入区 4 个功能按钮、侧边栏外壳（ESC/锁滚动）与内容
  （品牌/新对话/历史/高亮）、左白右绿气泡 + DeepSeek Logo、12 个图标、
  **6 个组件的 CSS 类名完整**、布局约束
- 拆分等价性：拆分前后构建产物哈希一致（`index-CIgxvXWy.js`），
  说明是纯结构调整、行为未变
- 流式端到端通过（`scripts/e2e-streaming.mjs`）：假 SSE 发 10 个不均匀 delta，
  逐字增长 20 次、flush 后无丢字、最终内容与 done 帧一致
- 排队状态通过：`status{state:'queued'}` 早于首个 delta，文案切换与
  `session.status` 不冲掉文案的逻辑均正确
- 真实后端排队确认：并发两条消息打到同一会话，第二条收到
  `{"state":"queued","message":"该会话正在处理上一轮，已排队"}`
- 真实后端链路：`ready → status → accepted → error`（error 是 402 QUOTA）
- 代理链路：`/api/sessions` 返回 3 条会话
- 深度思考双流通过（`scripts/e2e-reasoning.mjs`）：真 SSE 发 3 片 reasoning +
  3 片 delta，思考与正文互不串味、出正文时思考已全部到位、done 时两条队列
  都 flush、消息对象字段完整
- 思考面板渲染通过：思考中显示「思考中...」+ 扫光、结束后显示
  「已深度思考（用时 3 秒）」且默认折叠、无思考内容时不渲染面板
- **官方 primitives 真实渲染**（不再是桩）：`data-disclosure-row`、
  `aria-expanded` 开合正确、`data-shimmer` 只在 running 时出现、
  `data-state="ongoing"`、Markdown 的 `<h2>`/`<table>`/`<li>` 都渲染、
  用户消息不解析 Markdown
- **历史回显端到端**（真库 → 真接口 → 真组件）：三条消息按时间正序返回、
  `thinking`/`thinkingMs` 原样透传、用户消息进右侧绿泡且不解析 Markdown、
  助手消息进左侧白泡走 Markdown、带思考的标题显示「用时 7 秒」且默认折叠、
  无思考的消息不生面板
- 老库补 `thinking` 列后数据不丢、新列可写（迁移测试）
- **人设注入**：同一用户开 `pt-catgirl` / `pt-coder` 两个会话，
  各自生成不同的 patch 文件；`dsh --dump-config` 确认两份
  `personaPrefix` 完全不同且文本完整未损坏
- 人设只来自数据库：请求体伪造 `persona` 会被忽略
- 不同会话拿到自己的人设、复用进程后人设不变
- 未知 contactId 返回 400，不建会话不写消息
- patch 文件名对 `a/b` vs `a:b` 等 8000 个易碰撞 id 不重复
- **未读数**：10 项后端测试（含同毫秒竞态、老库迁移后已读不倒退）
- 未读红点的 DOM 渲染：有未读显示数字、无未读不显示、正在看的不显示、
  切走后又出现、超 99 显示 `99+`
- 时间分档四个区间 + 非法输入
- 线上库实测：造 2 条未读 → 列表显示 `unread=2` → 调已读接口 → 归零
- **unread_count 累加**：19 项语义测试（在看时不计、离开后累加、
  失败/中断不计、用户消息不计、进入清零、漂移可校正、老库回填不丢红点）
- presence 与 /chat 联动：正看着→0、离开所有会话→1、在看别的会话→1
- 线上库迁移后 `unread` 与 `unreadActual` 四个会话全部一致
- **移动端布局**：20 项结构断言（抽屉脱离文档流、82vw 上限、无横向溢出前提、
  dvh、软键盘、reduce-motion）
- **Capacitor**：`npx cap add android` 成功，Android 工程与 Web 资源同步完成
- **CORS**：预检返回 204 并带正确头、授权来源放行、未授权来源被拒（实测）
- **对话控制**：20 项 SSR/源码断言（红色停止按钮、操作栏渲染条件、复制兜底、
  透传守卫）+ 5 项重新生成端到端（不重复写用户消息、以库为准、无历史退化、
  连点不堆积、归属校验仍生效）
- **主动消息**：21 项测试（落库+未读、会话不存在不造会话、空回复不落库、
  模型报错不落库、人设来自联系人表、冷启动回灌/复用不回灌、**与用户请求共用轮次锁**、
  超时释放锁、非法 cron/缺 conversationId/关闭时都不注册、失败不抛出、
  上一轮未完成时跳过、环境变量解析）
- 真实服务端拉起实测：任务注册成功（含时区），手动触发**确实拉起了真实 dsh 进程并发出 prompt**，
  模型返回 402 后错误被正确捕获——服务不崩溃、不写脏数据、未读不被污染
- `/messages?conversationId=` 与 `/conversations/:id/messages` 返回完全一致，
  缺参 400、他人会话 403、不存在 404
- 图标 sprite 转换正确：`viewBox`/`fill`/`stroke-width` 已搬到 `<symbol>`，
  只注入 2 个符号（共 204 个）

## 组件划分

```
App            外壳：拉会话列表、持有 UI 开关、处理导航（只管状态，不管 DOM）
├── ChatArea   主聊天区：顶栏 / 对话列表 / 提示条 / 输入框 / 滚动跟随
└── Sidebar    抽屉外壳：遮罩 / ESC / 锁背景滚动
    └── SidebarContent   抽屉内容：品牌 / 新建对话 / 历史列表 / 页脚
```

拆分的边界是「外壳」和「内容」：`Sidebar` 管交互外壳，`SidebarContent`
只管渲染，换外壳时内容不用动。滚动逻辑（`stickToBottom` / `scrollIntoView`）
全部收在 `ChatArea` 里，`App` 不再碰 DOM。

## 为什么没有用官方 AppFrame

`@deepseek-ai/dsh-client-ui-layout` 的 `AppFrame` **无法作为 npm 库引入**：

- `lib/client.js` 通篇是 `window.__ModuleLoader__.load({id, factory})`，
  **没有任何 export**，`AppFrame` 只是闭包里的局部变量。
  打包会直接报 `IMPORT_IS_UNDEFINED: Import AppFrame will always be undefined`。
- `lib/index.js` 只导出 `apply`（cordis 插件入口）。
- `AppFrame.Sidebar` / `AppFrame.Conversation` 这种 API 不存在。真正的签名是
  `AppFrame({useStore, useSessions, usePanelInfo, useFoldedLandscape, actions, renderSlot, t})`，
  七个参数全是宿主插件（cordis store hooks、slots、locale），
  内容靠 `ctx.slots.register` 注册到 `sidebar` / `main` / `rightbar` 插槽，不是 React children。

要用它就得自己实现一整套 cordis 宿主 + slots + stores，工作量大于重写界面。
所以外壳保持手写。

## 官方 primitives 接入

气泡内部现在用官方 `@deepseek-ai/dsh-client-ui-primitives@0.2.2-rc.3`：

| 位置 | 组件 | 作用 |
|---|---|---|
| AI 正文 | `MarkdownText` | GFM + 表格 + 代码高亮（Shiki）+ TeX（KaTeX） |
| 思考面板 | `DisclosureRow` | 24px 折叠行、官方箭头、`running` 时官方流光 |
| 思考中/正在输入 | `StateDot` | `ongoing` 是 14px 旋转 loading |

用户消息**不解析 Markdown**，打什么显示什么。

### 三个必须知道的坑

**1. 图标不显示，但不报错。** 官方图标产出 `<svg><use href="#dsw-icon-xxx"/></svg>`，
图形由文档里的 `<symbol>` 提供，DSH 宿主靠 `ui-theme` 插件注入。没装主题就得自己注：
`src/components/deepseek/sprite.js` 从 `ICON_SYMBOLS` 取符号、挂到 `body`。
只注入实际用到的 2 个（共 204 个符号），首屏不必为几百个图标付代价。

把 `<svg>` 的属性（`viewBox` / `fill` / `stroke-width`）搬到 `<symbol>` 上，
否则图标变成实心黑块。**新增官方组件时若图标空白，先来补符号。**

**2. `labels` 必须引用稳定。** `MarkdownText` 的 `labels` 是必填 prop，
且官方注释明确要求传引用稳定的对象——每次渲染新建会**丢弃流式渲染缓存**，
长回复明显变卡。所以提到模块顶层 `markdown/labels.js` 并 `Object.freeze`。

**3. 气泡的 `white-space: pre-wrap` 会毁掉 Markdown。** 用户手打换行要保留，
但 Markdown 渲染出的是块级元素，`pre-wrap` 会让每个换行符再多出一行空白。
所以 `.markdown` 容器必须重置回 `normal`。

### 体积代价

| 方案 | 主包 | gzip | CSS |
|---|---|---|---|
| 手写渲染 | 244 KB | 77 KB | 11 KB |
| 官方 primitives | 1287 KB | 363 KB | 80 KB |

涨了约 5 倍，主要是 `shiki`（语法高亮）和 `katex`（公式）的模块级 import。
这是官方包的结构决定的，tree-shaking 摇不掉——即使只用 `StateDot`
这个 14px 的小圆点，也会把整个 Markdown 渲染栈拖进来。

### 依赖为什么有 28 个

primitives 的 `dependencies` 是**空的**，但 `lib/index.js` import 了 29 个外部包。
npm 一个都不装，必须手动补齐，否则构建报 `failed to resolve`。
`@deepseek-ai/dsh-util-*` / `dsh-client-store` 还要**同版本 0.2.2-rc.3**，
装成旧的会因导出不存在而失败。`dsh-client-store` 另外需要 `zustand` + `immer`。

0.2.2-rc.3 的 peer 只有 `@deepseek-ai/cordis`，**不需要 `--legacy-peer-deps`**
（0.0.1-rc.1 那个版本要求 React 18，才需要）。

### 已知安全问题

`npm audit` 报 2 个 low：KaTeX 原型污染（GHSA-238p-pmpm-9mq7），
**官方尚无修复版本**，来自 `micromark-extension-math` 的传递依赖。
本应用只渲染本地模型输出、不加载第三方网页，风险可控，但升级前不会消失。

## 未验证

- **思考面板的真实数据**：后端是 V3 不产 reasoning，DSH 运行时里也没有
  thinking 内容块，`reasoning` 帧目前只有前端假流会发。真实模型的思考链路、
  真实耗时、超长思考（面板限高 240px 可滚）都只在假流下验证过。
- **思考面板的视觉效果**：扫光动画、折叠动效、浅灰小字都没有截图确认。
- **官方组件的观感**：Markdown 排版、代码高亮配色、表格样式、KaTeX 公式
  都只验证了 DOM 结构，没看过渲染效果。这些组件原本依赖 DSH 的 ui-theme
  提供 CSS 变量，我们没装主题——它们自带 CSS Module，理论上能独立工作，
  但配色是否协调需要肉眼确认。
- **图片 / 长代码块 / 超宽表格**在微信气泡（实际宽度很窄）里的表现。
- **没有在真实浏览器里看过渲染效果。** 这台机器的 browser 工具需要特定协议格式，
  没能跑通。DOM 结构已用 SSR + 源码核对，但配色、间距、图标观感未截图确认。
- **打字机效果没在真实回复上看到过**，因为模型额度一直是 402 QUOTA。
- **历史列表/骨架屏的实际观感**：DOM 结构与断言都对，但骨架屏的流光速度、
  占位块高度是否和真气泡贴合、切换会话时会不会闪一下，都要肉眼确认。
- **人设的模型侧效果**：patch 合入配置、`personaPrefix` 文本正确已用
  `dsh --dump-config` 证实，但模型**实际回话语气**受 402 额度限制没看到过。
  也就是说「配置注入成功」已验证，「猫娘真的这么说话」未验证。
- **浮标的实际手感**：「有新消息 ↓」的浮现时机、回差阈值、点击后的滚动
  只验证了 DOM 与源码，没在触屏上试过。240px 这个值是按常见手机高度估的，
  可能需要按你的手感调。
- **未读红点的视觉**：颜色取的是微信 `#fa5151`，但没截图确认过与整体配色协调。
- **GitHub Actions 没有真正跑过**。工作流只做了 YAML 语法与步骤顺序校验，
  没有在 GitHub 上实际执行（本机无法访问 Actions、也没有可推送的仓库）。
  上面针对 Node/Java/SDK 版本的三处修正来自读取依赖的 engines 和
  Gradle 配置，是静态推导，不是实测结果。第一次跑如果失败，优先看这三处。
- **APK 没有真正构建出来（本地）。**这台机器没有 JDK 和 Android SDK，也没 root 权限装。
  `npx cap add android` 和 `cap sync` 都成功了，`./gradlew assembleDebug` 因为
  `JAVA_HOME is not set` 失败。工程是完整的，但"能编译出 APK"这件事没被验证。
- **手机模拟器里的实际观感**：无头浏览器起不来（沙箱缺 libnss3/libnspr4），
  移动端只做了结构性断言，没有屏幕截图。F12 手机模拟器里的真实效果需要你自己看一眼。
- **停止按钮和操作栏的视觉**：颜色和布局没截图确认过。
- **复制的真实剪贴板**：`execCommand` 兜底在真实局域网 http 下没测过
  （需要非安全上下文 + 真实浏览器）。
- **主动消息的成功路径**：真实模型 402 额度不足，所以「模型真的回了一句早安 →
  落库 → 红点亮起」这条完整链路只在前面的假 agent 测试里验过，
  真实模型下没跑通过一次。触发、进程拉起、错误捕获这些是真的。
- **cron 到点真的会触发**：只验证了任务注册和手动触发，
  没等到真实的 9:00（测试不能等一天）。node-cron 的调度本身依赖其库的正确性，
  我没有独立验证它对 `Asia/Shanghai` 的换算是否准确。
- **生成中途切走的真实链路**：测试里用 presence 直接模拟了「切走」，
  没跑过真实浏览器「发消息 → 立刻点别的会话 → 回复到达」这一整套。
  尤其是切换速度很快时，`visibilitychange` 与路由切换的上报顺序未验证。
- **超长历史的性能**：接口默认 100 条、上限 500 条，但没测过几百条消息
  （尤其其中多条带思考面板）时首屏渲染和滚动的实际耗时。

打开 http://127.0.0.1:5173 是最终确认。视觉有偏差请具体说明。