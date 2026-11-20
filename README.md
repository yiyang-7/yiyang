# DSH Chat Gateway

把 DSH Harness 从客户端搬到服务端。客户端只讲 **HTTP/SSE**，完全不知道 Harness 的存在。

```
浏览器/客户端 ──HTTP POST /chat──> 服务端 ──stdio JSON-RPC──> dsh --profile sdk
                    <──SSE──────        (Express)      <──session.event──
```

## 快速开始

```bash
npm install
npm start                                    # 服务端，默认 127.0.0.1:8787
node client.mjs --user u1 --conv c1 "你好"    # 客户端
```

## 三个要求分别落在哪

| 要求 | 实现位置 |
|---|---|
| 客户端删掉直连 SDK 子进程，改 HTTP/SSE | [client.mjs](client.mjs) —— 全文只有 `fetch`，无 `child_process` |
| 服务端 spawn/管理 Harness，传入 userId + conversationId + message | [lib/harness-pool.mjs](lib/harness-pool.mjs) + [server.mjs](server.mjs) |
| profile patch 由服务端从配置生成并注入 | [lib/patch-builder.mjs](lib/patch-builder.mjs) |

## 架构

### 进程模型

- **每个 `(userId, conversationId)` 一个常驻子进程**，复用上下文、SSE 重连不丢。
- 空闲 `idleTimeoutMs`（默认 10 分钟）后自动回收。
- 同时存活进程数上限 `maxProcesses`（默认 8），超出时淘汰最久未用的空闲进程。
- 每会话独立的会话根：`.dsh-sessions/<userId>/<conversationId>/`，租户之间不串。

### patch 生成

服务端不预置 patch 文件，而是**每次 spawn 前从配置对象生成**：

```js
const patch = buildProfilePatch({ config, sessionsRoot, cwd, persona });
const patchPath = materializePatch({ dir, name, patch });
// → dsh --profile sdk --patch <patchPath>
```

生成的内容（实测）：

```yaml
# 由服务端根据配置生成，勿手工编辑

- id: session-persistence-jsonl
  config:
    root: "/root/森萝/.dsh-sessions/u1/c1"

- id: system-prompt
  config:
    personaPrefix: "You are a helpful assistant served through the DSH chat gateway."
    personaSuffix: "The caller's user id is passed in the request metadata; never invent it."
```

**踩过的坑**：两个 profile 的会话持久化行 id 不同——`dsh-base` 里叫 `session-persistence-jsonl`，
`sdk-minimal` 自带树里叫 `sessions`。写错 id **不会报错**，patch 静默失效。
`patch-builder.mjs` 里的 `PERSISTENCE_ROW_ID` 负责这个映射。

已用 `dsh --profile sdk --patch … --dump-config` 验证 patch 确实进入最终组合且排在 `dsh-base` 之后。

### 人设 prompt

三层优先级（高 → 低）：

1. 单次请求体里的 `persona: {prefix, suffix}`
2. 服务端配置文件 `server.config.json` 的 `persona`
3. 环境变量 `DSH_CHAT_PERSONA_PREFIX` / `DSH_CHAT_PERSONA_SUFFIX`
4. profile 默认值（`null` 表示不覆盖，**不会**把默认人设抹成空）

## HTTP 接口

### `POST /chat` — 流式对话（SSE）

请求：

```json
{
  "userId": "u1",
  "conversationId": "c1",
  "message": "你好",
  "cwd": "/optional/workdir",
  "persona": { "prefix": "...", "suffix": "..." },
  "llm": { "provider": "deepseek-official", "model": "deepseek-chat" },
  "images": [{ "data": "<base64>", "mimeType": "image/png" }]
}
```

SSE 事件序列：

| 事件 | 载荷 | 说明 |
|---|---|---|
| `ready` | `{conversationId, sessionsRoot, patchPath}` | Harness 已启动并握手完成 |
| `accepted` | `{messageId}` | 消息已持久入队（**不是**回复） |
| `status` | `{sessionId, status}` | `running` / `idle` |
| `delta` | `{text}` | 文本增量 |
| `harness_event` | `{type, event}` | 原始会话事件，自行深入解析 |
| `subagent` | `{method, ...}` | 子 agent 生命周期 |
| `done` | `{text, eventCounts}` | 轮次结束 + 完整文本 |
| `error` | `{message, code, stage}` | 失败 |

每 15 秒一条 `: ping` 心跳防代理断连。

### `POST /chat/sync` — 一次性返回

同样的请求体，返回 `{text, eventCounts}`。

### `GET /healthz` — 健康检查 + 环境自检

返回硬链接能力探测结果、会话根、活跃进程数、当前人设。

### `DELETE /conversations/:conversationId?userId=u1`

主动结束会话并回收子进程。

## 启动自检：硬链接

dsh 唯一的会话持久化后端 `dsh-session-persistence-jsonl` 用 `fs.link()` 做原子发布
（`publishCurrentExclusive`），**只对 `EEXIST` 有处理，其他错误原样抛出**，Linux 上没有替代路径。

服务端启动时探测 `sessionsBaseDir` 是否支持硬链接，失败会打印原因并让 `/healthz` 返回 `ok: false`，
而不是等到对话中途才炸。

**当前这台机器所有可写目录都是 f2fs/bind，不支持硬链接**，所以：
- 握手、发消息、事件流、SSE 全部正常（已实测）
- 轮次在**落盘阶段**失败，`turn/end` 携带 `EACCES`

换到 ext4/xfs/btrfs/overlayfs，或指定：

```bash
DSH_CHAT_SESSIONS=/path/on/ext4 npm start
```

## 配置

`server.config.json` 或环境变量：

| 字段 | 环境变量 | 默认 |
|---|---|---|
| `profile` | `DSH_CHAT_PROFILE` | `sdk` |
| `sessionsBaseDir` | `DSH_CHAT_SESSIONS` | `<cwd>/.dsh-sessions` |
| `port` / `host` | `DSH_CHAT_PORT` / `DSH_CHAT_HOST` | 8787 / 127.0.0.1 |
| `persona.prefix/suffix` | `DSH_CHAT_PERSONA_PREFIX/SUFFIX` | `null`（沿用 profile） |
| `llm.provider/model` | — | `deepseek-official` / `deepseek-chat` |
| `idleTimeoutMs` | — | 600000 |
| `maxProcesses` | — | 8 |
| `turnTimeoutMs` | — | 300000 |

## 文件结构

```
server.mjs               完整版服务端：装配、配置、健康检查
server.min.mjs           最小版，对照参考代码的最小骨架
client.mjs               纯 HTTP/SSE 客户端
lib/session-pool.mjs     进程池：getOrCreateProcess、回收、握手、按行切帧
lib/chat-route.mjs       /chat 路由：SSE 事件流与结束判定
lib/patch-builder.mjs    从配置生成 profile patch
server.config.json       服务端配置
```

## 进程池对照参考代码的 7 处改动

参考代码的 `sessionPool` / `getOrCreateProcess` / `setInterval` 三段结构保留了，
但直接套用会坏在这几处：

| # | 参考代码的写法 | 实际后果 | 改法 |
|---|---|---|---|
| 1 | `spawn('dsh', ['headless'])` | 本机 `which dsh` 为空，直接 ENOENT | 用 `process.execPath` 跑绝对路径 `bin.js` |
| 2 | 池子没有上限 | 会话一多把机器打满 | `MAX_POOL_SIZE`（默认 8）+ LRU 淘汰 |
| 3 | 用 `headless` 做常驻 | headless 是「答完即退出」，无法多轮；任务还得在启动参数里传 | 改用 `--profile sdk` 的 JSON-RPC 服务 |
| 4 | spawn 完直接写 stdin | 没握手就发消息，`session/prompt` 被拒 | 先 `initialize` 解析模型路由 |
| 5 | `stdout.on('data')` 当文本 | SDK 是「每行一条 JSON-RPC」，一个 chunk 会混着响应和通知 | 按 `\n` 切帧再分发 |
| 6 | 不校验入参 | `conversationId` 缺失会共用 `"undefined"` 进程 | 400 提前拦截 |
| 7 | `[DONE]` 挂在进程 `close` | 常驻进程永不 close，请求挂到超时 | 以 `turn/end` 事件为轮次结束信号 |

另有三个实测踩到的坑：

- **监听器泄漏**：原写法每请求 `on('data')`，只在 `close` 时移除。常驻进程下同一会话第 N 轮会有 N 个监听器同时写，客户端收到重复与串话。改用 `subscribe()` 返回的 unsubscribe。
- **`req.on('close')` 误判**：Express 5 里请求体读完后 `req` 就触发 `close`，SSE 会被判定为「客户端已断开」而静默掐断。必须挂 `res`。
- **环境变量污染**：本进程环境里带着 `DSH_PROFILE=web`，服务端若复用它当 profile 名，patch 生成器不认识 `web`，会产出空 patch 导致子进程秒退。改用 `DSH_CHAT_PROFILE` 前缀。

## 验证结果

实测通过：

```
✓ 进程池复用   同一 conversationId 两轮 pid 相同；不同 id 各自独立
✓ LRU 淘汰     上限 2 时建第 3 个，最久未用的被 kill 并从池中移除
✓ 握手         initialize → {serverInfo:{name:'deepseek-harness-sdk-runtime'}}
✓ SSE 链路     ready → status → accepted → error/done，结束帧正常返回
✓ patch 注入   生成的 patch 含会话根与人设，经 --patch 进入最终配置
```

受宿主机 f2fs 不支持硬链接限制，轮次在**落盘阶段**返回 `EACCES`，因此 `done` 分支
（带 `text` 的完整回复）在本机无法实测；换到 ext4 即可。
---

## 端到端测试结果（本轮实测）

测试环境说明：宿主机所有可写目录都是 f2fs/bind，**不支持硬链接**，而 dsh 唯一的
会话持久化后端靠 `fs.link()` 原子发布日志。为把测试跑到模型层，使用了一个
**仅测试用的** `NODE_OPTIONS=--require` 预载，把 `fs.promises.link` 降级为
`copyFile`（不动 `/opt` 下的运行时源码）：

```bash
# /tmp/preload.cjs —— 仅用于本机验证，生产不要用
const fs = require('node:fs'); const fsp = fs.promises;
const orig = fsp.link.bind(fsp);
fsp.link = async (s, d) => { try { return await orig(s, d); }
  catch (e) { if (e.code === 'EEXIST') throw e;
    await fsp.copyFile(s, d, fs.constants.COPYFILE_EXCL); } };
```

**必须通过 `NODE_OPTIONS` 传递**：Harness 是独立子进程，父进程里 monkey-patch
`fs` 不会被子进程继承。

### 1. 并发隔离 —— 通过

```
A pid=31131  用户消息: ["我叫小明","我叫啥？"]
B pid=31132  用户消息: ["我叫小红","我叫啥？"]
进程独立: true
A 混入 B 的内容: false  |  B 混入 A 的内容: false
```

HTTP 层同样验证：`tab-A` / `tab-B` 并发请求 → 池中出现两个独立会话，
会话根分别是 `.dsh-sessions/uA/tab-A` 与 `.dsh-sessions/uB/tab-B`。

### 2. 重启 —— 通过

```
第一次 pid = 32044 → kill → 池中已移除
第二次 pid = 32062 | 新进程: true
新进程能接受消息: true
```

HTTP 层：停掉整个服务端（模拟 Ctrl+C）→ 重启 → 同一 conversationId 发消息，
自动拉起新进程，运行时 sessionId 变成新的 `rs-http~mwfz4n4j9dgf`。
上下文如预期丢失（内存态），磁盘旧日志仍在。

### 3. 空闲回收 —— 通过

`DSH_IDLE_TIMEOUT_MS=10000 DSH_REAP_INTERVAL_MS=2000`，发一条消息后等待 15 秒：

```
[启动] 为会话 reap-1 创建 dsh 进程
[回收] 会话 reap-1 超时，关闭进程
[退出] 会话 reap-1 的进程退出，code: 0 signal: null
```

池随后为空（`sessions: []`）。

## 测试中发现并修复的 4 个真实缺陷

| 缺陷 | 现象 | 修复 |
|---|---|---|
| **重启后会话死锁** | `session "<id>" already exists`，重启后该会话永远发不出消息 | 运行时 sessionId 改为每进程唯一（`conversationId~nonce`），与磁盘旧日志解耦 |
| **delta 回流用户输入** | 发"我叫啥"，客户端收到 `delta: {"text":"我叫啥"}` 和 runtime context 全文 | `extractText` 只认 `assistant/*` 事件 |
| **回收间隔写死 60s** | 超时设 10 秒也要最多等 60 秒才回收 | 抽出 `DSH_REAP_INTERVAL_MS` |
| **`/healthz` 被屏蔽** | 完整版注册的 healthz 不生效，只返回简版 | `mountChat(app, { healthz })` 回调注入 |

## 未能验证的部分（环境限制）

- **对话内容的正确性**：模型调用稳定返回 `Insufficient Balance (402, code=QUOTA)`，
  账号余额不足。事件流走到 `request/header`、`request/context`、`assistant/attempt`，
  说明请求已真实发出，只是被上游拒绝。
- 因此"A 问'我叫啥'能否答出'小明'"这一层**语义正确性未验证**；
  已验证的是**进程与会话粒度的隔离**，以及上下文确实各自独立送入模型请求。

---

## 职责划分（当前架构）

```
┌─ 客户端 client.mjs ────────────────────────────┐
│ 只做三件事：发消息 / 收流式响应 / 展示气泡        │
│ 不 spawn 进程、不碰数据库、不知道 Harness 存在    │
└───────────────────────┬────────────────────────┘
                        │ HTTP + SSE
┌───────────────────────▼────────────────────────┐
│ 服务端                                         │
│  · 进程池 lib/session-pool.mjs（spawn/回收/淘汰）│
│  · 历史库 lib/history-store.mjs（SQLite）        │
│  · 拼历史进 prompt（冷启动时）                    │
│  · 生成 profile patch 注入 Harness               │
└────────────────────────────────────────────────┘
```

### 为什么历史只能「拼进 prompt」，不能「注入 patch」

已核实 `dsh-base` 及各插件的 patch 配置项，**没有任何字段承载对话历史**。
patch 只在启动时配置插件（会话根、人设、模型路由），历史属于运行时的消息内容。
SDK 也没有 resume/load 接口，进程重启后接不上旧会话日志。

所以：历史只能作为消息内容进入 prompt。服务端数据库因此成为跨重启的唯一真相源。

### 数据库

Node 24 内置 `node:sqlite`，零依赖。路径由 `DSH_CHAT_DB` 或 `server.config.json`
的 `dbPath` 指定，默认 `history.db`（WAL 模式，开启外键约束）。

```sql
CREATE TABLE conversations (
  conversation_id TEXT    PRIMARY KEY,
  user_id         TEXT    NOT NULL,   -- 归属用户
  contact_id      TEXT    NOT NULL DEFAULT 'default',   -- AI 联系人
  created_at      INTEGER NOT NULL
);

CREATE TABLE messages (
  id              TEXT    NOT NULL PRIMARY KEY,   -- UUID
  conversation_id TEXT    NOT NULL
                  REFERENCES conversations (conversation_id) ON DELETE CASCADE,
  role            TEXT    NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'completed'
                  CHECK (status IN ('streaming','completed','failed','interrupted')),
  created_at      INTEGER NOT NULL
);
```

`status` 的四种取值都有明确含义，不是装饰：

| status | 含义 | 是否参与冷启动回灌 |
|---|---|---|
| `streaming` | 正在生成，正文尚未写入 | 否 |
| `completed` | 正常完成 | **是** |
| `failed` | 轮次失败，但已产生部分文本 | 否 |
| `interrupted` | 服务端在生成中途退出/被杀 | 否 |

只有 `completed` 会进 `tail()`。半截内容喂给新进程，会让它以为助手上次就说了半句话。

`interrupted` 由启动时自动标记：上次进程被强杀，库里必然留下 `streaming` 孤儿行，
服务端 `new HistoryStore()` 之后立刻 `markInterrupted()` 收编它们。


**为什么 `conversations` 多了 `user_id`**：需求给的三字段是「会话 ID / AI 联系人 ID /
创建时间」。但改成两表后，用户归属没地方放了——原来它挂在每条消息上。而如果只靠
`conversationId` 定位会话，意味着**猜到别人的 ID 就能读别人的历史**。
所以归属放 `conversations`，并在写入和读取时都做所有权校验。

写入时机严格按要求：

| 时机 | 动作 |
|---|---|
| `/chat` 收到消息 | `ensureConversation()` + 立刻写入 `role='user'`，**不等模型回复** |
| 回复完毕（`turn/end` 非 error） | 写入 `role='assistant'` |
| 轮次失败 | 只留用户消息，不写空的 assistant 回复 |

`message_id` 是 UUID，通过 SSE 回传给客户端：`ready` 帧带 `userMessageId`，
`done` 帧带 `userMessageId` + `assistantMessageId`，便于前端对账。

`contact_id` 一旦绑定**不覆盖**：中途换 AI 联系人会让历史对话语义错乱。

### 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/chat` | 流式对话（SSE） |
| GET | `/conversations/:id/messages?userId=` | 只读拉取历史（刷新页面恢复气泡） |
| DELETE | `/conversations/:id` | 结束会话进程 |
| GET | `/healthz` | 健康检查 + 环境自检 |

归属不符一律 **403**，且校验发生在写 SSE 响应头之前——否则状态码已经被
`flushHeaders()` 发出去，403 只能退化成 error 事件。

### 每轮请求的处理流程

```
POST /chat { conversationId, userId, message, contactId? }
  │
  ├─ ① 先落库
  │    ensureConversation()  → 会话不存在则建（绑定 contact_id）
  │    tail(limit=10)        → 读「本轮之前」的历史，供 ③ 用
  │    appendMessage(user)   → 用户这句话立刻入库，不等模型
  │
  ├─ ② 找进程
  │    acquireProcess(conversationId) → { agent, isNew }
  │
  ├─ ③ 判断是否新进程
  │    isNew === true  → 把最近 10 条历史打包成上下文，拼在消息前面喂给它
  │    isNew === false → Harness 内部已累积这些轮次，直接发，不重复喂
  │
  └─ ④ 收回复并落库
       turn/end（非 error）→ appendMessage(assistant, 完整文本)
       然后 done 事件推给客户端
```

### 为什么读历史在写本轮消息之前

反过来的话，本轮消息会既出现在 transcript 里、又出现在「用户现在说」后面，
模型看到同一句话两次。测试 `四步顺序：先落库，再找进程，回复后落库` 守住这个顺序。

### 为什么 isNew 不能挂在 agent 上

`agent` 是长期存活对象。把「本轮是否新建」写上去，并发请求会互相覆盖：
A 拿到新进程还没发消息，B 复用同一进程把它改成 false，A 就漏了回灌。
改为 `acquireProcess()` 返回调用时刻的快照 `{ agent, isNew }`。

### 多端并发：会话级轮次锁

一个 dsh 进程同时只能处理一个轮次，而它的 `session.event` 会**广播给所有订阅者**。
手机和电脑同时对同一 `conversationId` 发消息时，两个请求都订阅同一进程，
于是各自都会收到对方轮次的 delta。

实测（加锁前）：

```
手机收到: [手机-0][电脑-0][手机-1][电脑-1][手机-2][电脑-2]
电脑收到: [电脑-0][手机-1][电脑-1][手机-2][电脑-2]
```

两条流互相穿插，双方看到的都是拼接后的垃圾。

修复：`acquireTurn(conversationId)` 会话级互斥，同一会话的轮次串行执行，
只有当前轮次的请求处于订阅状态。排队中的请求先收到一个 `status` 帧：

```
event: status
data: {"state":"queued","message":"该会话正在处理上一轮，已排队"}
```

这也顺带解决了「记忆断层」：既然轮次串行，电脑那轮开始前手机那轮已经完整
写进进程内存和数据库，dsh 自己就能看到，不存在需要额外同步的中间态。

**锁的释放**必须在所有出口，否则该会话永久卡死：正常结束、轮次报错、
客户端断开、轮次超时，四处都调 `releaseTurn()`（幂等）。

轮次超时（默认 300s，`DSH_TURN_TIMEOUT_MS`）会杀掉进程并返回 `TIMEOUT`：
卡死的进程留在池里只会继续吃锁，杀掉后下次请求冷启动、从库里回灌。


### 流里能不能动态喂上下文（调研结论）

**不能，而且不需要。**

SDK 只暴露 3 个 RPC 方法：

```
initialize / session/prompt / shutdown
```

`session.event` 是**单向通知**（服务端 → 客户端），不是可写通道。流里没有任何
「上下文更新触发点」，`agent/inbox/spliced` 只是把**我们自己**刚 prompt 进去的
消息回声出来，不是钩子。

但这件事本身已经在做了：往活着的进程喂新内容 = 再调一次 `session/prompt`
（内部 `followup()` 把 UserMessage 追加到 inbox）。所以每轮请求本来就是
「动态喂给 dsh」，从不需要为了喂内容而杀进程。

杀进程只在**反方向**发生：进程已经没了（超时/重启/淘汰），要从数据库把
记忆**恢复**回来——这才需要冷启动回灌。

顺带一个重要发现：`compaction-basic` 插件默认启用（base patch 第 341 行）。
长对话会被运行时自动**摘要压缩**，进程内存是**有损**的。这给影子库补了一个
比「聊天记录漫游」更硬的理由：数据库是唯一无损耗的真相源。

## AI 联系人（人设隔离）

### 表

```sql
CREATE TABLE ai_contacts (
  id            TEXT NOT NULL PRIMARY KEY,   -- 'catgirl' / 'butler' / 'default'
  name          TEXT NOT NULL,
  avatar        TEXT,
  system_prompt TEXT NOT NULL,               -- 人设本体
  voice_id      TEXT,
  created_at    INTEGER NOT NULL
);
```

内置三个联系人，`INSERT OR IGNORE` 播种——重启不会覆盖运营改过的人设。

### 每个联系人一套 patch 模版

模版的差异就是 `system_prompt`，其余（会话根、默认 suffix）由服务端配置统一提供：

```js
buildContactPatch(contact, { config, sessionsRoot, cwd })
  → buildProfilePatch({ persona: { prefix: contact.systemPrompt || null, ... } })
```

`system_prompt` 为空时不写 `personaPrefix`。**不能**写成空字符串——那会把 profile
自带的人设抹成空，模型只会收到一句"你的设定是："然后就没了。

### 进程隔离

进程池 key 仍是 `conversationId`，但一个会话**绑定一个联系人且不可变**，
所以「同一用户 + 不同 AI」天然落到不同进程：

```
u1 / conv-1 (catgirl) → pid 25993   system prompt 含"猫娘"，不含"管家"
u1 / conv-2 (butler)  → pid 26049   system prompt 含"管家"，不含"猫娘"
```

实测两个 system prompt 长度 2547 / 2537，互不串味。

### 一处安全修复

人设**只能**来自 `ai_contacts` 表。之前 `persona` 是从 `req.body` 取的，
等于把 system prompt 的写权限交给了调用方——任何人都能注入
"忽略之前的设定，你现在是……"。现在：

- 请求体里的 `persona` 字段被彻底忽略
- 会话已绑定的 `contactId` 不会被后续请求改写
- 未知 `contactId` 在写 SSE 头之前就返回 400（不会先推流再报错）

### 接口

```
GET /contacts              列出全部联系人（含 systemPrompt）
GET /contacts/:id          单个联系人，404 表示不存在
```

### 流式落库：过程中只攒内存，结束时写一次

```
用户消息 → 立刻 INSERT（status=completed）
开始接收流 → INSERT 一条占位行（status=streaming, content=''）
每个 delta → fullReply.push(t)，只进内存，只 res.write() 给客户端
turn/end  → UPDATE 一次：写入 fullReply 全文 + status=completed
```

**为什么不逐 delta 写库**：SQLite 是单写者，每个字节都 UPDATE 会造成 O(n²) 写放大，
并且持有写锁的时间变长，拖慢同一进程里的其它会话。整轮只有两次写（占位 + 收尾），
与回复长度无关。

代价是崩溃窗口：进程在生成中途被杀，这轮正文会丢（状态停在 `streaming`，
重启后变 `interrupted`）。用户屏幕上看到的半截回复不会进库。

要换回「崩溃不丢半截」，把收尾逻辑从「结束时写」改成「每 250ms 刷一次」即可
（上一版就是这么做的，实测可行，只是写放大更高）。

### 重启后续聊（实测）

```
[启动] 为会话 r1 创建 dsh 进程
[历史] 冷启动回灌 2 条 → r1
[历史] 实际 prompt ↓
  │ 以下是你与这位用户之前的对话记录，供你理解上下文：
  │ <history>
  │ 用户：记住我叫小明
  │ 助手：好的，我记住了：你叫小明。
  │ </history>
  │
  │ 用户现在说：
  │ 我叫什么？
```

`ready` 帧同时返回 `historyReplayed: 2`、`isNewProcess: true`。

排查时可设 `DSH_DEBUG_PROMPT=1` 打印真正发给 dsh 的文本。

### 关于「一个用户同一时间只能在一个设备上活跃」

不需要这条限制。上下文隔离的正确单位是 **conversationId**，不是 userId：

- 两设备用**同一个** conversationId → 串行处理，共享进程内存，无断层
- 两设备用**不同** conversationId → 本来就应该各有各的上下文

真正需要串行化的只有「同一 conversationId 的并发轮次」，锁已经覆盖。

### 为什么历史只能「拼进 prompt」，不能「注入 patch」

已核实 `dsh-base` 及各插件的 patch 配置项，**没有任何字段承载对话历史**。
patch 只在启动时配置插件（会话根、人设、模型路由），历史属于运行时的消息内容。
SDK 也没有 resume/load 接口，进程重启后接不上旧会话日志。

所以：历史只能作为消息内容进入 prompt。服务端数据库因此成为跨重启的唯一真相源。

### 数据库

Node 24 内置 `node:sqlite`，零依赖。路径由 `DSH_CHAT_DB` 或 `server.config.json`
的 `dbPath` 指定，默认 `history.db`（WAL 模式，开启外键约束）。

```sql
CREATE TABLE conversations (
  conversation_id TEXT    PRIMARY KEY,
  user_id         TEXT    NOT NULL,   -- 归属用户，见下方说明
  contact_id      TEXT    NOT NULL DEFAULT 'default',   -- AI 联系人
  created_at      INTEGER NOT NULL
);

CREATE TABLE messages (
  message_id      TEXT    PRIMARY KEY,          -- UUID
  conversation_id TEXT    NOT NULL
                  REFERENCES conversations (conversation_id) ON DELETE CASCADE,
  role            TEXT    NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT    NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_messages_conv      ON messages (conversation_id, created_at);
CREATE INDEX idx_conversations_user ON conversations (user_id, created_at);
```

**为什么 `conversations` 多了 `user_id`**：需求给的三字段是「会话 ID / AI 联系人 ID /
创建时间」。但改成两表后，用户归属没地方放了——原来它挂在每条消息上。而如果只靠
`conversationId` 定位会话，意味着**猜到别人的 ID 就能读别人的历史**。
所以归属放 `conversations`，并在写入和读取时都做所有权校验。

写入时机严格按要求：

| 时机 | 动作 |
|---|---|
| `/chat` 收到消息 | `ensureConversation()` + 立刻写入 `role='user'`，**不等模型回复** |
| 回复完毕（`turn/end` 非 error） | 写入 `role='assistant'` |
| 轮次失败 | 只留用户消息，不写空的 assistant 回复 |

`message_id` 是 UUID，通过 SSE 回传给客户端：`ready` 帧带 `userMessageId`，
`done` 帧带 `userMessageId` + `assistantMessageId`，便于前端对账。

`contact_id` 一旦绑定**不覆盖**：中途换 AI 联系人会让历史对话语义错乱。

### 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/chat` | 流式对话（SSE） |
| GET | `/conversations/:id/messages?userId=` | 只读拉取历史（刷新页面恢复气泡） |
| DELETE | `/conversations/:id` | 结束会话进程 |
| GET | `/healthz` | 健康检查 + 环境自检 |

归属不符一律 **403**，且校验发生在写 SSE 响应头之前——否则状态码已经被
`flushHeaders()` 发出去，403 只能退化成 error 事件。

### 回灌策略（避免重复）

只在**进程新建**时拼接历史：

- 进程存活 → Harness 自己累积上下文，不再拼（拼了会让同一句话出现多次）
- 进程新建/重启 → 从库里取最近 40 条，按字符预算（默认 8000）从最早处截断，
  拼成 `<history>…</history>` + 「用户现在说：…」

顺序上有个坑：必须**先读历史、再写本轮用户消息**。反过来的话，本轮消息会既
出现在 transcript 里、又出现在「用户现在说」后，模型看到同一句话两次。

SSE 的 `ready` 帧会返回 `historyReplayed`，客户端可据此提示用户。

## 测试

```bash
npm test                        # 7 项集成测试
npm start                       # 服务端
npm run client -- --user u1 --conv c1 "你好"   # 单轮
npm run client                  # 交互模式，/new 换会话 /exit 退出
```

集成测试用假 agent 驱动，因为真实模型调用受账号余额限制（402 QUOTA）

```
✔ 收到消息即入库，返回完毕后入库助手回复
✔ 用户消息在模型回复前就已落库
✔ 轮次失败时用户消息保留，但不写助手回复
✔ 冷启动把历史拼进 prompt；复用时不重复拼
✔ 不同用户/会话的历史互不可见
✔ transcript 超预算时从最早处截断
✔ buildPrimedPrompt 无历史时原样返回
```

### 真实服务端验证

```
[配置] 历史库=/root/森萝/history.db
[启动] 为会话 g1 创建 dsh 进程
[历史] 冷启动回灌 2 条 → g1        ← 服务端重启后仍能读出上一轮历史
ready: {"historyReplayed":2}
```

库内容确认：

```
g1 user | 我叫小明
g1 user | 我叫啥
```

（只有 user 行，因为没有一次成功的模型回复 —— 余额不足，助手回复不会写入。）
