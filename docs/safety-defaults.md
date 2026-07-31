# 安全默认值：超时、重试、并发与预算

> 类别：现状。列出模型与信息工具的默认护栏及覆盖方式。默认值改动需同步本文（`test/example-config-sync.test.mjs` 会把 `config.example.json` 与 `lib/core/config.mjs` 钉死）。

## 模型调用（lib/llm/）

| 护栏 | 默认值 | 覆盖方式 |
|---|---|---|
| 单次请求超时 | `requestTimeoutMs: 120000`（2 分钟） | `config.local.json` |
| 输出预算 | 按用途 16 组画像（如 typeset-html 8000/12000、editorial-room 3500/6000，`lib/llm/output-budget.mjs`） | 代码内画像 |
| 截断重试 | `finishReason=length` 时带「压缩输出」提示自动重试一次；adaptive 画像自动扩容重试 | 不可关闭 |
| JSON Mode 降级 | 服务商返回 400/422 时自动去掉 `response_format` 重试（`lib/llm/gateway.mjs`） | `llm.providers.*.supportsJsonMode` |
| 上下文预算 | `contextWindow − 输出预算 − safetyReserve`；超出时先 LLM 摘要老消息（不新增事实），仍超才丢弃最老消息，**不静默截断**（`lib/llm/context-manager.mjs`） | `llm.providers.*.contextWindow` |
| 打标并发 | `taggingChunkSize` / `taggingConcurrency`：deepseek、kimi 8/6，minimax 2/4 | `config.local.json` 或设置页 |
| 事件卡并发 | 每批 3 个事件、并发 4（`eventCardChunkSize` / `eventCardConcurrency`） | `config.local.json` |
| 联网搜索降级 | 服务商无原生 webSearch 且 `tavily.enabled` 时注入 Tavily 结果（`maxResults: 5`） | `config.local.json` |
| 调用审计 | 每次调用（含失败与压缩）写 `model_calls` 表（provider、purpose、tokens、耗时） | 不可关闭 |

未配置任何 API Key 时界面与 AI 功能明确降级，不会静默失败或隐式试用未授权服务商。

## 信息工具（lib/tools/、plugins/、collectors/）

| 护栏 | 默认值 | 覆盖方式 |
|---|---|---|
| 远程插件超时 | `timeoutMs` 强制 1000–30000ms，超出拒绝安装（`lib/tools/remote-package-manager.mjs`） | Manifest 声明 |
| 远程插件响应上限 | `maxResponseBytes` 钳制 1 KB–2 MB，默认 1 MB | Manifest 声明 |
| 内网拒绝 | 远程插件与 url-fetch 的目标解析到本机 / 内网 / 保留地址一律拒绝（`lib/tools/remote-adapter.mjs` `privateIp`） | 不可关闭 |
| 网页抓取 | 限制 DNS、重定向、响应体大小与超时；失败标记 `partial/error` 进入 RESEARCH_FIRST，不拿模型常识补 | 代码内置 |
| Firecrawl 升级阈值 | 质量分 < 55 才调用 Firecrawl（计费）；RSS 摘要 ≥ 800 字免抓，≥ 200 字可兜底（`sourceFetch.*`） | `config.local.json` |
| Reddit 采集 | CDP `navigationTimeoutMs: 30000` | `config.local.json` |
| RSSHub | 启动等待 `startupTimeoutMs: 180000`，失败只记日志不阻塞主流程 | `config.local.json` |
| Firecrawl MCP | 单次 RPC 超时 45 秒（`lib/integrations/firecrawl-mcp.mjs`） | 代码内置 |
| GitHub API | 限流感知（剩余 / 重置时间展示在设置页），缓存降级，缓存命中计数 | 环境变量 `GITHUB_TOKEN` |
| 外部写入 | CDN 上传需显式按钮或排版开关；`external-write` 插件需 manifest 声明 + 技能授权 + 执行审计标记（`lib/tools/policy.mjs`） | 不可绕过 |

设计原则：默认值按「最慢可接受、最少外部调用、失败可观测」设定——超时都有上限、重试都有次数、并发都有封顶、计费动作都有审计或显式触发。
