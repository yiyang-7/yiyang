# DSH SDK / 插件文档索引

运行时：`@deepseek-ai/dsh` **0.2.0-rc.2**
文档根目录：`/opt/dshapp/runtime/node_modules/@deepseek-ai/`
每份文档都有 `README.md`（英文）和 `README.zh.md`（中文）两份，下面一律指**中文版**。

---

## 一、SDK 协议与客户端

| 文档 | 作用 |
|---|---|
| [dsh-sdk-protocol/README.zh.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/dsh-sdk-protocol/README.zh.md) | **协议格式（wire format）权威说明**。换行分帧的 JSON-RPC 2.0 传输、方法名、请求/结果/通知载荷类型、错误语义。实现或调试任一端时读这份。纯库，无插件、无配置。 |
| [dsh-sdk-jsonrpc-server/README.zh.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-server/README.zh.md) | 服务端插件：通过 **stdio** 服务 SDK 协议，按 `sessionId` 开会话、排队 prompt、流式回推会话事件与 agent 状态迁移。要求 stdout 只出 JSON-RPC 帧，**不能组合 stdout logger**。 |
| [dsh-sdk-app/README.zh.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/dsh-sdk-app/README.zh.md) | `dsh --profile sdk` 组合包：base + 零选项启动提供方，接受调用后才启动 jsonrpc-server；故 `dsh --profile sdk --help` 直接退出、不占 stdio。禁用模型生成标题、禁用 HMR。 |
| [dsh-sdk-minimal/README.zh.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/dsh-sdk-minimal/README.zh.md) | `dsh --profile sdk-minimal`：**不依赖 base** 的极简独立树，默认只给一个持久 shell 工具，JSONL 会话持久化。刻意不含 Web/settings/压缩/fs 工具/skill/jobs/subagent。默认 danger-full-access，**必须配合隔离 workspace**。 |

> 客户端 SDK 本体（TypeScript 的 `dsh-sdk-client` 与 Python SDK）在源码仓库 `python/` 与 `client/` 目录下，**未随 npm 包发布**。

## 二、插件与 profile 启动机制

| 文档 | 作用 |
|---|---|
| [dsh-app-boot/README.zh.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/dsh-app-boot/README.zh.md) | 所有 profile 背后的共享**启动库**：环境层 → 组合 bundle 与 patch → 逐个挂载插件 → 返回运行中的应用或失败原因。含配置预览、实时/仅启动时 patch 策略、终端恢复。 |
| [dsh-base/README.zh.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/dsh-base/README.zh.md) | 所有基于 base 的表层共享的核心：模型连接、完整工具集、持久会话、workspace 安全默认值。**不是库**，是组合包；定制靠自己的 profile patch 或追加 bundle。 |
| [dsh-package-manifest/README.zh.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/dsh-package-manifest/README.zh.md) | 插件包的 `package.json` 清单声明（`dsh` 字段等）格式。 |
| [dsh-plugin-manager/README.zh.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/dsh-plugin-manager/README.zh.md) | **插件管理服务**：启停插件条目、选/装/删组合包、多注册表查询与回退、`inspect` 预检、版本兼容与豁免、pnpm 11 构建脚本批准、失败回滚语义。 |
| [dsh-plugin-package-inventory-deepseek/README.zh.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/dsh-plugin-package-inventory-deepseek/README.zh.md) | 可安装包的清单来源。 |
| [dsh-host-plugin-inventory/README.zh.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/dsh-host-plugin-inventory/README.zh.md) | 宿主侧当前 Loader / 预设状态清单。 |

### Cordis 插件框架（插件作者必读）

DSH 插件全部跑在 Cordis 上，这四个是框架层文档：

| 文档 | 作用 |
|---|---|
| [cordis-plugin-loader/README.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/cordis-plugin-loader/README.md) | 插件加载器（无中文版） |
| [cordis-plugin-include/README.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/cordis-plugin-include/README.md) | YAML Include 组合（无中文版） |
| [cordis-plugin-group/README.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/cordis-plugin-group/README.md) | 分组插件（无中文版） |
| [cordis-plugin-timer/README.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/cordis-plugin-timer/README.md) | 定时器服务（无中文版） |

> `docs/cordis-primer.zh.md`（Cordis 入门）在 README 里被大量引用，但**未随 npm 包发布**，需要去源码仓库拿。

## 三、插件管理界面（Web 侧）

- [dsh-client-ui-plugin-manager/README.zh.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/README.zh.md) — 侧边栏「插件」页，可读写的管理界面
- [dsh-client-ui-settings-plugins/README.zh.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/dsh-client-ui-settings-plugins/README.zh.md) — 设置页插件区
- [dsh-client-ui-settings-plugin-inventory/README.zh.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/dsh-client-ui-settings-plugin-inventory/README.zh.md) — 只读清单

## 四、写插件时常用的关联文档

- [dsh-tools/README.zh.md](file:///opt/dshapp/runtime/node_modules/@deepseek-ai/dsh-tools/README.zh.md) — 工具注册 API
- 各 `dsh-tool-*/README.zh.md` — 官方工具实现范例（bash、fs、subagent、workflow、present、todo 等）
- 各 `dsh-client-ui-*/README.zh.md` — 客户端 UI 插件的插槽与扩展点

---

## 快速上手路径

**要用 SDK 从外部驱动 agent：**
1. 读 `dsh-sdk-protocol` 掌握分帧与消息类型
2. 读 `dsh-app-boot` 理解 profile 怎么组合
3. 启动 `dsh --profile sdk`（完整）或 `dsh --profile sdk-minimal`（极简）
4. 用自己写的客户端往 stdin 发初始化请求，从 stdout 读事件帧

**要写一个 DSH 插件：**
1. 读 Cordis 四个框架 README（尤其 loader 与 include）
2. 读 `dsh-package-manifest` 确认清单字段
3. 照抄一个 `dsh-tool-*` 包的源码结构
4. 用 `dsh plugin --profile <p> add ./my-plugin` 装入，浏览器插件页或 `plugin_manager` 工具启停

---

## 注意：文档路径可能断裂

README 里大量交叉链接指向仓库目录结构（`../../sdk/server/`、`../base/`、`docs/*.zh.md`、`.agents/notes/`），
但 npm 包把 `@deepseek-ai/dsh-sdk-jsonrpc-server` 平铺到了同级目录，**这些相对链接在本机多数打不开**。
上面索引里的链接已改成本机实际可用的绝对路径。