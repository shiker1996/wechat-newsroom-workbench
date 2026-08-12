# 配置迁移与系统配置中心重构方案

> 状态：待实施（2026-08-12）  
> 依赖：动态扩展配置、`extension_settings`、隔离凭据 Profile、统一插件管理与采集源模型已经具备。  
> 目标：消除 `#system` 对具体工具、采集器、技能和模型字段的硬编码；现有配置平滑迁移且可以回滚。

## 1. 背景与问题

当前 `#system` 同时维护四类概念：应用 `.env`、RSSHub KV、模型服务和 Manifest 动态扩展配置。新增扩展已经能通过 `configuration` Schema 自动出现，但原文抓取、图片存储、搜索、RSSHub 和模型等既有能力仍使用固定表单。

这会造成两个问题：

1. 内置能力与第三方扩展使用不同的配置机制，新增或替换内置实现仍需修改前端。
2. 旧配置散落于 `.env`、`config.local.json`、RSSHub `.env` 和模型专用存储，用户难以判断配置属于工作台、插件还是采集源。

本次重构不把页面简单改成裸 JSON 编辑器，而是建立统一的声明式配置目录。默认使用 Schema 表单，高级模式提供脱敏 JSON 查看、校验、导入和导出。

## 2. 核心概念与边界

工具插件和采集插件在产品上统一属于“插件”，但运行协议不同：

- `tool`：由技能、任务或用户操作按需调用，一次输入对应一次结果。
- `collector`：由批次调度器按采集源执行，一次运行产生多条标准内容，并具有来源级健康、重试、跳过与失败记录。
- `skill`：定义创作流程、提示、门禁和允许使用的能力。
- `model-provider`：模型接入及其凭据，作为配置中心的一等扩展类型。
- `system`：工作台自身的运行环境和全局策略，不归属某个扩展。

配置作用域必须分离：

| 作用域 | 示例 | 存储 |
|---|---|---|
| 插件全局配置 | Firecrawl 地址、Reddit CDP 地址、RSSHub 并发 | `extension_settings` |
| 插件秘密凭据 | API Key、上传密码、RSSHub Token | 隔离凭据 Profile |
| 采集源实例配置 | subreddit、RSS 路由、网页 URL、选择器 | `collection_sources.config_json` |
| 工作台内核配置 | 端口、任务并发、全局文章长度 | 系统设置存储；兼容期读取旧配置 |
| 账号内容策略 | 画像、内容支柱、分发和评分策略 | 继续由账号配置管理，不进入插件配置中心 |

## 3. 配置迁移清单

### 3.1 工具插件

| 目标扩展 | 迁移字段 |
|---|---|
| `source-fetch` | `SOURCE_FETCH_PROVIDER`、`sourceFetch.upgradeThreshold`、`rssContentMinChars`、`rssFallbackMinChars`、`githubMinChars` |
| `firecrawl-fetch` | `FIRECRAWL_MCP_URL`、`FIRECRAWL_API_KEY` |
| `tavily-search` | `TAVILY_API_KEY`、`tavily.enabled`、`tavily.maxResults` |
| `upyun-upload-image` | `UPYUN_BUCKET`、`UPYUN_OPERATOR`、`UPYUN_PASSWORD`、`UPYUN_DOMAIN`、`UPYUN_PREFIX` |
| `document-folder-search` | `documentSearch.roots` |

`WRITE_ASSISTANT_PYTHON` 不迁入原文抓取插件。它是多个本地能力可能共用的运行时依赖，保留为系统运行环境配置和健康检查项。

### 3.2 采集插件与采集源

| 目标 | 插件全局配置 | 转为采集源实例 |
|---|---|---|
| Reddit Collector | `reddit.cdpUrl`、`reddit.navigationTimeoutMs` | `reddit.subreddits`、`limitPerSubreddit` |
| RSSHub Collector | `baseUrl`、`rootDir`、启动/停止脚本、PID 文件、启动超时、`keepAlive`、`maxAgeHours`、`allowUndated`、`concurrency`、RSSHub KV | `routes`、`disabledRoutes`、`directFeeds` |
| GitHub Discovery Collector | `githubDiscovery` 的发现、缓存和 AI Query 参数 | 如后续允许多组发现策略，再拆成多个来源实例 |

RSSHub KV 的键名不固定，应由 Manifest 声明受控的 `key-value-secret` 渲染器。该渲染器只允许合法环境变量名，读取时仅返回“已配置”，不回显值。

`GITHUB_TOKEN` 是 GitHub 采集与仓库工具共享的凭据。目标实现采用可引用的 `github` 凭据 Profile，避免重复保存；审计记录只保存 Profile ID 和配置状态。

### 3.3 模型服务

新增 `model-provider` 扩展类型，迁移：

- `DEEPSEEK_API_KEY`、`MINIMAX_API_KEY`、`MOONSHOT_API_KEY`；
- `llm.providers.<name>` 的 URL、模型、上下文窗口、输出上限、Token 字段、JSON Mode、Thinking、Web Search、打标批大小与并发等；
- Provider 的启用状态。

以下是模型路由的全局策略，留在系统参数：

- `llm.defaultProvider`；
- `llm.requestTimeoutMs`；
- `llm.safetyReserveTokens`；
- `llm.recentMessageCount`。

模型配置可以使用专用渲染器，但数据契约、秘密处理、校验和保存仍走统一配置服务。

### 3.4 工作台内核

迁移后 `system` 仍保留：

- `WORKBENCH_PORT` / `port`；
- `workspaceRoot`、`contentRoots`（路径默认只读，授权目录可编辑）；
- `WRITE_ASSISTANT_PYTHON` 及运行环境检测；
- `aiJobs.maxConcurrent`；
- `articleLength` 与各 pipeline 的全局默认值；
- 日志、缓存、备份和数据目录相关策略；
- 数据库、RSSHub、浏览器进程等运行状态与操作。

账号画像、分发策略和选题评分继续由账号与内容策略管理，不迁入 `#system`。

## 4. 统一声明与存储模型

所有可配置扩展至少声明：

```json
{
  "id": "upyun-upload-image",
  "kind": "plugin",
  "capabilityType": "tool",
  "configuration": {
    "type": "object",
    "properties": {}
  }
}
```

为了支持模型和 RSSHub KV，可在白名单内声明渲染提示：

```json
{
  "ui": {
    "renderer": "standard | model-provider | key-value-secret"
  }
}
```

渲染提示不能绕过 Schema、权限或后端校验，也不能允许插件注入 HTML 或 JavaScript。

统一配置文档采用以下逻辑结构，密钥只显示引用或 `__configured__`：

```json
{
  "system": {},
  "modelProviders": {},
  "plugins": {
    "tools": {},
    "collectors": {}
  },
  "skills": {}
}
```

## 5. 读取优先级与兼容策略

迁移期采用“双读、单写”：

1. 显式系统环境变量，用于部署时的不可变覆盖；
2. 新配置存储 `extension_settings` / 凭据 Profile / 系统设置；
3. 旧 `.env`、`config.local.json`、RSSHub `.env`；
4. 内置默认值。

新页面保存后只写新存储，不再反向修改旧文件。首次迁移执行以下规则：

- 新存储没有对应值时才导入旧值，绝不覆盖用户已经保存的新配置；
- 普通字段复制到 `extension_settings`；
- 密钥复制到隔离凭据 Profile，不进入数据库明文字段或迁移日志；
- RSSHub routes、direct feeds 和 Reddit subreddits 幂等转换为 `collection_sources`；
- 保持稳定 `source_key`，继续关联历史健康与 `pipeline_failures`；
- 每项记录来源、目标、状态和时间，但秘密只记录“是否迁移”；
- 迁移前生成脱敏快照，支持按配置项回滚到旧读取路径。

兼容期至少持续一个 minor 版本。只有在迁移覆盖率、回滚演练和生产运行验收通过后，才停止读取旧业务配置；部署环境变量覆盖仍保留。

## 6. `#system` 目标页面

页面由“固定配置表单”重构为“系统与配置中心”：

### 6.1 概览

- 工作台、数据库、RSSHub 和浏览器运行状态；
- 插件总数、待配置、配置失效和运行异常数量；
- 可执行的启动、停止、重启和连接测试；
- 最近配置变更和迁移状态。

### 6.2 扩展配置

统一目录筛选：`全部 / 模型 / 工具 / 采集器 / 技能`。

- 左侧为扩展列表和配置状态；
- 右侧使用 Schema 或受控专用渲染器；
- 提供保存、测试配置、恢复默认和查看影响；
- 插件缺少必填配置时标记 `needs_configuration` 并禁止执行；
- `#skills` 的配置按钮跳到此处并自动选中目标扩展。

### 6.3 系统参数

- Web 服务端口及“重启后生效”提示；
- AI 任务并发；
- 全局文章长度默认值；
- Python 和关键运行环境；
- 路径与授权目录。

低频且高风险的路径项默认只读，修改时显示影响和二次确认。

### 6.4 数据维护

- 备份与恢复；
- 缓存清理；
- 数据与日志目录；
- 诊断包和配置迁移报告。

### 6.5 高级 JSON 模式

- 展示脱敏后的有效配置；
- 支持导出和导入非秘密字段；
- 导入前执行 Schema 校验并展示变更预览；
- 不允许通过 JSON 写入秘密原文；
- 不直接编辑插件 Manifest 或工作区任意文件。

## 7. API 调整

在现有扩展配置接口上统一资源模型：

- `GET /api/system/configuration/catalog`：配置目录和状态；
- `GET|PUT /api/system/configuration/:type/:id`：读取、保存配置；
- `POST /api/system/configuration/:type/:id/test`：测试有效配置；
- `GET /api/system/configuration/effective`：脱敏有效配置；
- `POST /api/system/configuration/import/preview`：校验和变更预览；
- `POST /api/system/configuration/import`：确认后导入；
- `GET /api/system/configuration/migration`：迁移状态；
- `POST /api/system/configuration/migration`：执行幂等迁移。

旧技能、工具、采集器和模型专用配置接口保留兼容适配层一个发布周期。

## 8. 实施阶段与验收

### 阶段 0：冻结基线与配置映射

实施状态（2026-08-12）：已完成。机器可读清单见 [`configuration-migration-inventory.json`](./configuration-migration-inventory.json)，脱敏基线可执行 `npm run config:baseline` 生成到 `data/configuration-migration-baseline.json`。契约测试会在 `.env.example` 或 `config.example.json` 新增字段却未分类、消费点漂移或秘密属性缺失时失败。本阶段未切换任何运行时配置读取路径。

- 建立所有旧字段的消费点、默认值、秘密属性和目标归属清单；
- 为当前 `.env`、`config.local.json`、RSSHub `.env` 和来源生成脱敏快照；
- 增加“旧字段必须有目标或明确保留”的契约测试。

验收：没有未分类字段；现有配置加载、模型调用、采集和上传基线测试全部通过。

### 阶段 1：统一配置资源模型

实施状态（2026-08-12）：已完成基础设施。统一目录已纳入 `system`、`model-provider`、`tool`、`collector`、`skill` 五类资源，提供统一读取、保存和 Schema 测试接口；扩展可通过 `credentialProfile` 引用共享凭据（如 GitHub）。旧专用接口和页面保持兼容。本阶段只建立资源契约，尚未把旧值写入新存储或切换运行时。

- 扩展类型增加 `model-provider` 和 `system`；
- 增加共享凭据 Profile 引用；
- 统一目录、读写、测试和脱敏有效配置 API；
- 增加受控 `model-provider`、`key-value-secret` 渲染提示校验。

验收：测试扩展新增字段无需修改系统页；秘密不进入 API、数据库快照或日志。

### 阶段 2：迁移工具配置

实施状态（2026-08-12）：已完成。当前实际原文抓取能力由 `url-fetch` 插件承载，因此原计划中的 `source-fetch` 与 `firecrawl-fetch` 配置合并到该插件，避免产生不可执行的伪插件。Tavily、又拍云和文档检索 Manifest 已声明配置 Schema；运行时使用新配置优先、旧 `.env` / `config.local.json` fallback。相关用户提示已指向系统与配置中心，技能不再要求直接读取凭据。本阶段保留旧配置文件且不反写。

- 迁移 Source Fetch、Firecrawl、Tavily、又拍云和文档搜索；
- 所有运行时改为注入解析后的配置；
- 旧环境变量仅作为 fallback。
- 同步修改相关 `SKILL.md`、Manifest 描述、引用文档、错误提示和示例，不再指导用户直接编辑 `.env`；技能只描述所需能力，配置位置由工具插件和配置中心负责。

验收：迁移前后抓取、搜索、上传和文档检索行为一致；清空新配置可安全回退旧值。

### 阶段 3：迁移采集器与来源

实施状态（2026-08-12）：已完成。Reddit、RSSHub、GitHub Discovery 内置 Collector Manifest 已声明全局配置；统一运行时、来源测试、正式采集和失败重试均使用新配置优先、旧配置 fallback。Reddit `subreddits`、RSSHub `routes` / `disabledRoutes` / `directFeeds` 继续通过既有幂等同步进入 `collection_sources`，不进入插件全局配置。GitHub Token 使用共享 `github` 凭据 Profile。RSSHub 任意 KV 仍由兼容编辑器维护，待阶段 5 以受控 `key-value-secret` 渲染器替换。

- 迁移 Reddit、RSSHub、GitHub Discovery 全局配置；
- RSSHub routes/direct feeds 和 Reddit subreddits 幂等转为来源实例；
- 引入 RSSHub KV 受控编辑器；
- 测试、正式采集和失败重试统一读取新配置。
- 同步更新 Reddit、RSSHub、GitHub 相关技能说明、采集器描述和错误操作提示，统一指向配置中心或采集源页面。

验收：来源 ID、`source_key`、健康历史和失败记录连续；同配置下采集结果语义一致。

### 阶段 4：迁移模型服务

- 将 Provider 转为 `model-provider` 配置资源；
- 实施状态（2026-08-12）：阶段 4 已完成。模型供应商的基础参数、高级推理参数、打标参数与原生联网搜索参数已纳入统一 Schema；API Key 写入隔离凭据存储，Gateway 每次调用通过统一配置解析器读取。未迁移配置继续从 `config.local.json` 与原环境变量回退，旧模型页面和调用接口保持可用。
- API Key 迁入凭据 Profile；
- Gateway 读取新配置，并保留旧 Provider 适配层；
- 默认模型和路由策略留在系统参数。
- 同步更新技能、模型错误信息和操作文档中的 API Key 配置说明。

验收：现有三个 Provider 可迁移、测试、启停和切换默认项；模型日志不泄露凭据。

### 阶段 5：重构 `#system`

实施状态（2026-08-12）：进行中。统一资源目录现已直接驱动系统参数、模型供应商、技能、工具和采集器表单；模型与扩展共用统一保存/测试路由。RSSHub Collector 声明 `key-value-secret` 受控渲染器，其任意环境变量在资源详情中编辑，秘密值不回显。旧专用接口暂保留为兼容层，待阶段 6 完成迁移覆盖率与回滚演练后移除。

- 落地概览、扩展配置、系统参数、数据维护四区；
- 删除原文抓取、图片存储、RSSHub 和模型的固定字段前端实现；
- 接入配置筛选、状态、深链和影响提示；
- 增加高级 JSON 查看、导入预览和导出。
- 所有 `needs_configuration` 提示和技能/插件配置入口深链到新的统一资源位置。

验收：安装带配置的新插件后无需前端改动即可完成配置；固定表单中不再出现任何具体插件字段。

### 阶段 6：兼容收尾与回滚演练

实施状态（2026-08-12）：已完成代码侧收尾。配置中心展示资源级迁移覆盖率、legacy fallback 命中数和停读就绪状态；新增过期配置说明扫描门禁。现阶段保留 legacy fallback 读取，因为实际工作区资源需由用户逐项保存到统一存储后覆盖率才会达到 100%；系统不会在覆盖率未达标时自动停读或删除旧配置。

- 提供迁移覆盖率和旧 fallback 命中统计；
- 完成备份恢复、旧版升级、迁移中断和回滚测试；
- 更新 `.env.example`、`config.example.json`、README、API 和配置文档；
- 达到退出条件后停止读取旧业务配置。
- 增加过期说明扫描门禁，禁止技能、前端和用户文档继续出现“请在 `.env` 配置”及直接读取业务密钥的指导；仅允许部署级环境变量和明确标注的 legacy fallback。

验收：新安装、旧版本升级、备份恢复三条路径全部通过；无秘密泄露；删除旧 UI 和适配层后全量测试通过。

## 9. 风险与控制

- **配置归属错误**：阶段 0 用消费点清单和契约测试锁定，不边迁边猜。
- **新旧值冲突**：采用明确优先级，并在页面显示值的来源。
- **秘密泄露**：迁移日志、API、JSON 导出和审计都只记录状态或 Profile 引用。
- **来源重复**：转换时按稳定 `source_key` 幂等 upsert。
- **运行中配置漂移**：任务启动时冻结脱敏配置快照，重试沿用相同配置版本或明确提示已变化。
- **页面过度通用化**：默认 Schema 表单，只有白名单渲染器可提供模型和 KV 的专用交互。
- **无法回滚**：兼容期不删除旧文件、不反写旧文件，保留旧读取适配层和迁移前脱敏快照。

## 10. 最终完成条件

- `#system` 不再硬编码工具、采集器、技能或具体模型 Provider 字段；
- 新扩展只通过 Manifest/Schema 即可进入配置目录；
- 所有秘密均由隔离凭据 Profile 管理；
- 插件全局配置和采集源实例配置边界清晰；
- 旧配置自动迁移、可审计、可回滚；
- 页面同时满足日常表单配置与高级脱敏 JSON 管理；
- 构建、全量测试、升级、备份恢复和迁移演练均通过。
