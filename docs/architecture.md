# 架构总览

> 类别：现状。描述当前代码真实结构，随代码改动同步更新。扩展开发见 [extending.md](./extending.md)，安全边界见 [threat-model.md](./threat-model.md)，接口清单见 [API.md](../API.md)。

「见字」是本地优先的 Windows 单用户工作台：Node.js 24 原生 HTTP（无 Web 框架）+ `node:sqlite`（无原生编译依赖）+ 浏览器端原生 ES Modules（`public/src/`，构建仅做打包）。只监听 `127.0.0.1:4317`。

当前采用“业务能力垂直入口 + 平台基础设施”的垂直架构：`server/` 顶层严格收敛为 `features/`、`platform/`、`shared/` 三个目录。业务调用方从 `server/features/*` 进入，当前已建立 `research`、`social-cards`、`articles`、`collection`、`batches` 五个业务入口；研究、图文、文章主流水线与排版流水线已物理归入各自垂直的 `application/`。HTTP、LLM、持久化、任务、工具和外部集成统一位于 `server/platform/`；跨业务纯规则、Schema、渲染和主题位于 `server/shared/`。兼容导出只允许留在对应的 platform/shared 边界内，不再新增旧顶层目录。

## 总览图

```text
浏览器（public/src 视图）
   │  /api/*（JSON 与 NDJSON 流）
   ▼
server.mjs ──► server/platform/http/routes/*（按批次、候选创作、任务及既有领域模块拆分）
   │        └─► server.mjs（只保留装配、静态资源和少量顶层入口）
   ▼
┌────────────────┬─────────────────┬──────────────────┐
│ Store（数据层） │ AiJobManager /   │ ModelGateway      │
│ server/platform/core/store │ JobManager       │ server/platform/llm/gateway   │
│                │ （后台任务）      │ （LLM 网关）       │
└────────────────┴─────────────────┴──────────────────┘
   ▼                                   ▼
SQLite（data/workbench.db）      技能运行时 server/skills + skills/
                                        工具注册中心 server/platform/tools + plugins/
```

## 启动流程（server.mjs，约 960 行）

1. `loadEnv`（`server/platform/core/env.mjs`）→ `loadConfig`（`server/platform/core/config.mjs`，全部默认值内置，`config.local.json` 覆盖）。
2. 组装单例：`Store`（`data/workbench.db`）、`JobManager`（采集任务）、`ModelGateway`、`AiJobManager`，构造函数传参，无 DI 框架。
3. 路由注册是**顺序链式**：`/api/` 请求先依次经过 `server/platform/http/routes/` 的模型、主题、内容、系统、媒体、文章、社交卡、批次、候选创作和任务 handler（返回 falsy 则继续），最后由顶层入口决定 404。路由模块只负责 HTTP 适配，批次/候选/任务的业务编排通过显式上下文注入。
4. 静态资源只服务 `public/`，路径越界检查 + `no-store`，无 SPA fallback。
5. 引导时异步自启 RSSHub（失败只记日志不阻塞）；端口被占用时探测既有实例 `/api/overview`，已运行则提示退出。除 RSSHub 外无常驻守护，后台任务均为请求触发。

## HTTP 层（server/platform/http/routes/）

| 模块 | 职责 |
|---|---|
| `model-routes.mjs` | 模型服务商列表、增删、连通性测试 |
| `content-routes.mjs` | 热点、文章、日历、日志、产物柜（含 reindex / preview） |
| `system-routes.mjs` | 最大模块：设置、技能包与插件的安装 / 状态 / 回滚 / 删除、能力槽位、执行日志、RSSHub / Reddit 控制、订阅 CRUD、备份导出 / 校验 / 恢复 |
| `media-routes.mjs` | 配图工作区、排版 `/ai/typeset`、文章封面（标准 / AI 视觉）、文档列表、可视化规划与决策 |
| `article-routes.mjs` | 编辑会（同步与流式）、writer / stage 技能选择、文档修订、来源抓取、`/ai/draft`、`/ai/article` |
| `social-card-routes.mjs` | 卡片编辑会、卡片页 CRUD / layout、social-cards 文件与 ZIP、渠道、仓库巡检、`/ai/social-card` |
| `batch-routes.mjs` | 批次 CRUD、采集、排名、社交排名、热点全景和删除影响评估 |
| `candidate-routes.mjs` | 候选池、综合候选、突发素材、自定义图文、自主写作和候选轨道 |
| `task-routes.mjs` | 打标、研究、自动化、事件卡、日报与任务查询 |
| `route-helpers.mjs` | 路由响应、批次装饰、事件卡关联、事件事实和文件写入辅助 |

两个横切约定：

- **NDJSON 流**（`application/x-ndjson`，每行一个 `{type}` 事件）：`POST /api/candidates/:id/ai/editorial/stream`、`POST /api/batches/:id/custom-social-chat/stream`、`POST /api/batches/:id/tutorial-chat/stream`。
- **确认头**：技能包与插件的变更类路由要求 `x-admin-confirm: TRUSTED-LOCAL-PLUGIN`（`system-routes.mjs` 单点校验），备份恢复要求 `x-restore-confirm: RESTORE`。两者是防误触门禁，不是鉴权。

## 数据层（server/platform/core/）

- `store.mjs` 的 `Store` 类是兼容 facade：负责打开数据库、执行启动迁移、组装 Repository/Query Service/Application Service，并暴露旧公共 API；Store 本身不再直接执行 SQL。
- 迁移是**幂等的 `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` 探测补列**（无 `user_version`），只增不破；跨版本验收见 `test/version-compat.test.mjs`。
- 整库导入与 `foreign_key_check` 由 `DatabaseRestoreService` 承担，生成快照等领域数据由对应 Repository 存取。
- 同目录：`config.mjs`（默认值，含 LLM providers 与 RSSHub 路由）、`env.mjs`、`workspace-paths.mjs`（`articles/`、`topics/`、`social-cards/` 等产物目录）。

### 核心实体关系（批次 / 热点 / 事件 / 选题）

- **批次（`batches`）→ 热点（`hotspots`）**：一批采集 N 条热点，热点 = 一条报道 = 一个原始 URL；每条热点最多一份原文快照（`hotspot_sources`，按 `hotspot_id` 单行覆盖）。
- **事件无实体表**：由 `clusterItems`（`server/features/research/application/research-pipeline.mjs`）按热点的 `eventKey` 标签在读取时实时聚类派生；`event_id = 'E' + sha1(eventKey)[:10]`，由指纹哈希决定，与输入顺序、成员增减无关，重算稳定。事件的持久化产物是事件卡文件（`topics/<批次>/sources/event-cards.json`，按 `event_id` 关联）与突发批次的 `breaking_analyses` 表。
- **选题（`candidates`）**：普通选题经 `candidates.hotspot_id` 单指一个热点；综合（composite）选题经 `candidate_hotspots` 关联多个热点（成员关系，决定选题归属哪些事件）。选题的"关联事件" = 其成员热点聚类落到的事件（`eventGroupsForCandidate`）。
- **候选级补充来源（`candidate_sources`）**：编辑会中作者粘贴的外部报道链接，抓取快照按 `(candidate_row_id, url)` 覆盖存储；不属于任何热点/事件，由 `eventGroupsForCandidate` 以"用户补充来源"合成分组注入事实基座（与 `hotspot_sources` 的热点级快照并列）。

## 后台任务

- `server/platform/jobs/job-manager.mjs`：非 AI **采集任务**，内存 Map 按批次防重，并行跑 Reddit（CDP）与 RSSHub / GitHub 采集，逐源写 `source_runs` / `subscription_runs`。
- `server/platform/jobs/ai-job-manager.mjs`：**AI 任务调度器**，只负责排队、并发上限、批次/候选互斥、thinking 日志、状态持久化与统一异常收口。
- `server/platform/jobs/ai-job-handlers.mjs`：12 类 AI 任务的显式注册表，集中声明合法任务类型、批次级互斥类型以及各流水线参数映射。
- `server/platform/jobs/auto-pipeline.mjs`：`auto` 复合流程，普通批次串联打标 → 事件卡 → 研判，突发批次转入突发事实分析。
- 持久化：内存与 `ai_runs` 表双写，`GET /api/jobs/:id` 先查内存再回退数据库。**重启后任务视为结束，不做断点续跑**；逐行内存日志不恢复，数据库审计仍在。
- `server/features/research/llm/tasks.mjs`：研究业务模型任务单元（热点打标 `tagBatch`、快速起草 `draftArticle`）。

## LLM 网关（server/platform/llm/）

- `gateway.mjs`：OpenAI 兼容客户端，统一 `complete` / `streamComplete`。多服务商在 `config.llm.providers`（含 baseUrl / model / apiKeyEnv / contextWindow / 输出上限 / jsonMode / webSearch 配置），`defaultProvider` 选择，`resolve()` 校验启用状态与 Key。降级：jsonMode 不支持自动去 `response_format` 重试；无原生 webSearch 且配置 Tavily 时注入搜索结果；`finishReason=length` 且 adaptive 时自动扩容重试一次。每次调用（含失败）写 `model_calls` 审计（含原始输出与推理文本，仅保留最近 2000 条，超出自动清理）。
- `context-manager.mjs`：CJK 加权 token 估算与上下文预算；超预算时先 LLM 摘要老消息（不新增事实），仍超则丢弃最老非保护消息，不静默截断。
- `output-budget.mjs`：按用途（typeset-html、editorial-room 等 16 组画像）定输出预算，截断时带重试提示词重试。

## 技能运行时（server/platform/skills/ + skills/）

- `skills/` 是内置技能源码（31 个，SKILL.md + 可选 skill.json + references/）；第三方技能安装在 `data/installed-skills/`，目录清单 `data/skill-packages.json`。
- `server/platform/llm/skill-runtime.mjs`：按 `CODEX_SKILLS_ROOT → skills/ → data/installed-skills/` 找技能，拼接 SKILL.md + references 为 prompt，叠加用户配置覆盖层，末尾强制追加不可覆盖的安全门禁段；产出带 sha256 的 bundle。
- `registry.mjs`：合并内置与已安装技能，读结构化 manifest（kind / entryPoints / 输入输出契约 / 能力声明）；`createGenerationSnapshot` 冻结 prompt hash、工具、模型供复跑。
- `entry-routing.mjs`：创作入口契约（hotspot-article / independent-writing / batch-daily）与阶段槽位（title / reviewer / humanizer / seo、图文三入口故事板），路由时做契约兼容 + 能力缺口 + 工具策略检查。
- `pipeline-runtime.mjs`：工具白名单 ∩ 注册中心能力、快照复跑（校验历史工具与模型版本仍可用）、给 gateway 调用注入 snapshotId。
- `package-manager.mjs`：第三方技能包校验（文件类型 / 大小 / 路径越界 / Markdown 引用 / `compatibleApp`）、staging 原子安装、启停与卸载。
- `roles.mjs`：只有 writer / typesetter 类技能拥有运行时策略（模型、工具白名单、门禁）。

## 工具注册中心（server/platform/tools/ + plugins/）

- `plugins/` 是内置本地适配器（echarts-render、mermaid-render、repository-inspector、upyun-image-upload、url-fetch、local-project-reader、tavily-search、document-folder-search）。
- `server/platform/tools/index.mjs` 启动时合并三来源为单例注册中心：内置插件、`data/installed-tool-plugins/` 中启用且**内容哈希一致**的第三方插件、`data/remote-tool-plugins.json` 中启用的远程声明式插件。
- `registry.mjs`：`resolve(capability)` 按优先级选实现；`execute` 走 输入 schema 校验 → 策略检查 → adapter.execute → 输出 schema 校验 → 执行日志（`tool_executions` 表，标注 provenance 与外部写入授权）。
- `policy.mjs`：技能能力白名单、`external-write` 需显式授权、路径输入必须落在允许根目录内（realpath 防穿越）。
- `capability-slots.mjs`：6 个信息能力槽位（web-page / web-search / news-search / repository / document / local-project），是管线调用信息工具的入口。
- 远程插件（`remote-adapter.mjs` / `remote-package-manager.mjs`）：纯声明式 Manifest，HTTPS + 超时 + 响应上限 + 内网拒绝，不允许分发可执行代码；凭据按 profile 隔离存储，不入库。

## 采集边界

- `server/platform/collectors/` 只负责 Collector 插件协议、Manifest 校验、注册发现、安装启停和运行时加载。
- `server/features/collection/application/` 负责采集源配置、统一采集 Runner、Store 事件落库和静态页面采集助手；这些属于采集业务用例。
- `server/features/collection/domain/` 负责采集结果质量规则。业务入口统一从 `server/features/collection/index.mjs` 导出。

## 两条流水线

### 文章链

```text
热点采集 → 打标 / 事件卡 → 研判（research-pipeline：聚类 → 维度分组 → 预选 → 评分）
       → 编辑会（editorial-room，对话式沉淀结构化决策，WRITE_NOW 门禁；
          回答中粘贴的链接自动抓取落 candidate_sources，逐条结果写入对话）
       → 成稿（article-pipeline，ARTICLE_STAGE_CONTRACT 固定阶段：
          brief → fact-base → planning → drafting($writer) → 质量门禁
          → title → humanize → review → seo 评分 / 优化 → 终审门禁；
          每阶段产物落候选工作目录，门禁不过自动返工一次）
       → 排版（typeset-pipeline：rendered → design → images → draft → normalized → gate；
          确定性 markdownToHtml + 主题 tokens，只输出内联样式，含 CDN 上传开关）
       → 封面图（cover-image-generator：默认由 cover.spec 确定性渲染；
          可选 AI 视觉模式由单 Agent 生成 HTML/CSS，程序注入真实文字后截图；
          AI 失败自动回退标准封面，最终统一输出 900×383 cover.png）
```

封面 AI 视觉模式位于 `server/features/articles/application/`：`ai-visual-cover-generator.mjs` 负责冻结主题与文章输入并调用通用视觉文档 Agent，`ai-visual-cover-composer.mjs` 负责构建输入和最小 HTML 起始文档，`ai-visual-cover-pipeline.mjs` 负责阶段记录、截图和图片交付检查。它只开放项目文件读取与当前封面目录内的分块写入，不调用文生图、网络搜索或文章写入能力；标准模式仍是默认路径。

### 图文链

```text
图文事实基座（repository-fact-sheet / 事件事实基座 / 自定义）
  → social-card-pipeline（SOCIAL_CARD_STAGE_CONTRACT：
     facts → planning（故事板技能选择）→ generation（card_plan + copy.txt）
     → layout-audit（不过则 layout-repair 只改 card_plan）
     → screenshots（html-pages-to-images 确定性渲染逐页 PNG）→ delivery-gate）
```

输入输出契约以字符串命名贯穿两条链（`article_fact_base` → `wechat_markdown`、`social_card_fact_base` → `social_card_storyboard` 等，定义在 `entry-routing.mjs`）。配图由 `image-workflow.mjs` 负责（占位规划、本地上传、CDN、回填）。

## 目录速查

| 目录 | 内容 |
|---|---|
| `server/features/` | 按业务能力组织的垂直入口与用例，目前包括研究、图文、文章、采集和批次 |
| `server/platform/` | HTTP、配置、环境、Store、任务、LLM、工具、集成和插件运行时 |
| `server/shared/domain/` | 跨业务复用的规则、事实模型与 Schema；保持纯业务依赖方向 |
| `server/platform/http/routes/` | 已抽出的 HTTP 路由模块 |
| `server/platform/llm/` | LLM 网关、JSON/安全/上下文等通用模型基础设施与少量兼容转发 |
| `server/features/*/llm/` | 各业务垂直专用的模型任务、Prompt 编排和结构化输出适配 |
| `server/platform/persistence/` | SQLite 连接、完整 Schema/兼容迁移、外键校验、按领域拆分的数据仓储与跨领域只读 Query Service；`Store` 作为兼容 facade 暴露旧 API |
| `server/shared/rendering/` | 无文件系统和模型副作用的 Markdown/HTML、故事板和主题输出纯函数 |
| `server/platform/application/themes/` | 主题生成、用户主题服务、预览和发布门禁等应用编排 |
| `server/shared/themes/` | 无副作用的主题值对象、默认主题、注册 / 校验 / 编译基元与主题渲染辅助 |
| `server/platform/skills/` | 技能注册、清单、路由、包管理 |
| `server/platform/tools/` | 工具注册中心、策略、插件包管理、远程适配 |
| `server/platform/jobs/` | 采集任务编排 |
| `server/platform/artifacts/` | 备份归档等产物处理 |
| `skills/`、`plugins/` | 内置技能与内置工具插件源码 |
| `public/` | 浏览器端（原生 ESM 视图）；大型编辑器视图把无 DOM 文档分析和图文展示规则分别下沉到 `editor-document-model.js`、`social-editor-model.js` |
