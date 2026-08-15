> 状态：现状（随代码改动同步更新）

# 配置项参考

## 配置中心结构

> 配置页面已迁入统一声明式配置中心。项目根 `.env` 已停止读取；RSSHub 扩展变量由配置中心托管，部署参数仍可使用 `config.local.json`。

“运行与配置中心”分为工作台配置和统一配置资源两层。模型、技能、工具和采集器自动读取 Manifest 的 `configuration` Schema；RSSHub KV 由 Collector 的 `key-value-secret` 受控编辑器管理。安装新扩展后，只要声明 Schema，就会自动出现在配置中心，不需要修改前端代码。

扩展的普通配置保存到 `extension_settings`，秘密字段保存到隔离凭据 Profile，页面只显示“已配置”状态。采集插件的全局配置会在测试和正式采集前合并进来源配置；来源自身的地址、选择器等仍保存在 `collection_sources.config_json`。

## 声明式静态网页采集源

在“采集源 → 更多采集器”选择“静态网页采集”，填写公开页面 URL 和条目选择器。标题、链接、摘要、作者、时间和下一页选择器均为声明式字段。选择器仅支持标签、类、ID、属性和后代关系，不支持伪类、兄弟关系或用户 JavaScript。

静态网页采集只允许 HTTP/HTTPS 公网地址，禁止本机、内网、保留地址和带内嵌凭据的 URL。系统会逐跳检查重定向，最多读取 2 MB HTML、最多跟随 3 次重定向、最多采集 5 页。复杂交互、登录态或依赖客户端渲染的页面应使用后续受控浏览器插件或专业爬虫。

## 第三方采集插件

“技能与工具 → 采集器”统一管理采集能力，可校验并安装插件目录。插件必须声明 `kind: collector`、`type: local-collector|remote-collector`、来源 Schema、工作台兼容范围和权限摘要。第一期采集插件不允许本地路径权限或外部写入；远程端点必须使用权限白名单中的 HTTPS 域名，并在首次执行前人工确认。

“采集源”页面只维护来源实例，包括新增、测试、启停、删除和运行状态。这样插件生命周期与具体订阅配置相互独立：一个采集器可以服务多个来源，停用采集器也不会删除来源。

停用或卸载插件不会删除关联来源。来源会显示“插件不可用”，恢复同 ID 插件并启用后可继续使用原配置。示例见 `docs/examples/collector-plugin/local` 和 `docs/examples/collector-plugin/remote`。

## 浏览器网页采集

“更多采集器 → 浏览器网页采集”用于需要客户端渲染或简单点击/输入才能出现内容的页面。配置只允许声明页面地址、等待元素、一次点击、一次输入、固定等待和内容选择器，不支持用户 JavaScript。每个来源使用 `profileId` 对应的独立浏览器 Profile，登录 Cookie 不与其他来源混用。

浏览器运行在独立 Node 子进程中，环境变量仅保留系统路径、临时目录和 Puppeteer 缓存位置；父进程实施 5～120 秒硬超时并强制终止失控进程。导航及子资源请求均拒绝本机、内网和保留地址。可配置 `loginSelector` 识别登录页，命中后返回 `AUTH_REQUIRED`，提示重新建立该 Profile 的登录状态。

工作台备份包含采集插件清单、安装目录、事件日志和数据库中的来源实例，但不会包含 `data/browser-profiles`。Profile 可能保存登录 Cookie 和网站会话，出于安全原因恢复后需重新建立登录状态。

## 扩展动态配置

技能的 `skill.json` 与工具插件的 `manifest.json` 可以声明 `configuration` 对象 Schema。工作台会在“技能与工具”页面自动生成表单，无需为每个扩展修改固定页面。

- 支持 `object`、`string`、`number`、`integer`、`boolean` 和标量数组。
- 支持必填、默认值、枚举、数值范围、字符串长度、正则和 HTTP/HTTPS URL 校验。
- 使用 `secret: true` 或 `format: "password"` 声明秘密字段；秘密只保存到隔离凭据 Profile，页面和数据库不会回读原文。
- 普通配置保存在 `extension_settings`，配置不完整的扩展状态为 `needs_configuration`，不能执行。
- 工具执行审计只记录配置状态快照，不记录秘密值或完整配置正文。

配置接口为：

- `GET|PUT /api/system/skills/:id/configuration`
- `POST /api/system/skills/:id/configuration/test`
- `GET|PUT /api/system/tool-plugins/:id/configuration`
- `POST /api/system/tool-plugins/:id/configuration/test`

本文汇总工作台全部用户可配置项：改什么、写在哪、什么时候生效。技能包与工具插件的**编写和安装**不在本文范围，见 [extending.md](./extending.md)。

配置优先级（高到低）：统一配置与隔离凭据 → Manifest 默认值。`config.local.json` 仅保留部署与兼容运行参数，不再承载业务密钥。

## 1. 统一配置与隔离凭据

模型、工具、技能和采集器根据 Manifest Schema 自动出现在配置中心。普通字段保存到统一配置表，秘密字段写入隔离凭据 Profile；页面与 API 只返回配置状态。项目根 .env、系统业务密钥环境变量和 .env.example 均不再作为配置入口。

## 2. `config.local.json`：运行参数

复制 `config.example.json` 为 `config.local.json` 后修改，未写的键用默认值。结构（括注默认值）：

- `port`（4317）、`workspaceRoot`、`contentRoots`：服务端口与内容扫描根目录。
- `reddit`：Reddit 采集。`cdpUrl`、`subreddits`、`limitPerSubreddit`（15）、`navigationTimeoutMs`。
- `rsshub`：RSSHub 采集。`baseUrl`、`routes`（默认 12 条路由）、`disabledRoutes`、`directFeeds`、`maxAgeHours`（168，旧闻窗口）、`concurrency`（5）、`keepAlive`、`startupTimeoutMs`。
- `githubDiscovery`：GitHub 新项目发现。`enabled`、`createdWithinDays`（30）、`minStars`（1000）、`limit`、`cacheTtlMs`。
  - `aiQueries`：AI 兴趣仓库发现。`enabled`、`refreshDays`（7，查询组缓存天数，缓存文件 `data/repo-discovery-queries.json`，可手工编辑）、`maxQueries`（6）、`perQueryLimit`（15）、`relevanceFilter`、`minInterestScore`（6，兴趣分阈值）。LLM 按 `account-context.json` 内容支柱生成 Search 查询组并做相关性打分过滤；任一环节失败自动退化为纯规则发现（Trending + 增长搜索 + 热点提及）。
- `llm`：模型网关。
  - `defaultProvider`、`requestTimeoutMs`、`safetyReserveTokens`、`recentMessageCount`。
  - `providers.<name>`：`label`、`baseUrl`、`model`、`apiKeyEnv`、`contextWindow`、`maxOutputTokens`、`maxTokensField`。
  - 吞吐参数：`taggingChunkSize`（默认 ≤8，按 `maxOutputTokens` 收紧）、`taggingConcurrency`（默认 6）、`eventCardChunkSize`（默认 3）、`eventCardConcurrency`（默认 4）。
- `aiJobs`：AI 后台任务并发。`maxConcurrent`（2）为全局并发上限，超过上限的任务进入 FIFO 队列等待；候选级任务（文章 / 图文 / 排版 / 自主写作）按候选并行，批次级任务（打标 / 研判 / 事件卡 / 自动流程 / 早报）同批次互斥。
- `articleLength`：文章字数门禁（可见字符，统一五处判定：文章 / 早报 / 教程三条 pipeline 的长度返工区间、技能默认门禁、编辑器前端计数与 preflight 检查）。`minVisibleChars`（1300）/ `maxVisibleChars`（2000）为全局默认区间；`pipelines.article` / `pipelines.daily` / `pipelines.tutorial` 可按链路写同名字段做差异覆盖。生效优先级：技能覆盖层 `gates.length` > `articleLength.pipelines[链路]` > `articleLength` 全局 > 内置默认 1300–2000。编辑器前端经 `GET /api/system/settings` 读取全局区间，无需另配。字数门禁为**建议性**：pipeline 会先按区间尽力自动修复，修复后仍超限只记警告、任务照常完成；编辑器保存终稿不再拦截，仅 toast 提示，超限内容可在编辑器手动删减。

超时、重试、并发与 token 预算的安全默认值及适用范围见 [safety-defaults.md](./safety-defaults.md)。

## 3. `account-context.json`：账号画像与选题评分

复制 `account-context.example.json` 后按自己的账号修改。被编辑会、选题契合加分和成稿技能读取。字段含义：

- 画像：`name`、`description`、`readerProfile`、`contentPillars`（前缀映射打标五类，决定账号契合加分命中）、`voiceGuardrails`、`packagingModes`、`followReason`、`conversionBridge`、`differentiators`、`articleFramework`、`contentRatio`。格式化逻辑见 `lib/domain/account-context.mjs`。
- 双分发策略（可选）：`distributionStrategy.recommendation|notification|experiment`。每个池可配置 `purpose`、`preferredTopics` 和 `titleRule`，由选题、编辑会、标题和成稿技能读取；这些字段只描述内容规划，不授予自动群发或发布权限。
- 通知资格（可选）：`notificationPolicy.minimumMatchedCriteria`、`minimumNotificationFit`（默认 4/5）、`minimumFactSupport`（默认 4/5）、`maxPerBatch`（默认 2，允许 0）、`blockedRiskLevels`、`readerStakes`、`criteria`。通知池必须有具体读者、明确动作或决策和具体后果；传闻、待核事实及禁入风险会确定性降到实验池，缺失配置时使用内置严格规则。
- `scoring`（选题评分参数，可整段省略）：只写想改的键，其余回退代码默认值（`lib/llm/research-pipeline.mjs` 的 `DEFAULT_SCORING`）；非法数值安全回退。
  - `weights`：`{ "h": 0.6, "b": 0.25, "p": 0.15 }`——总分公式 `F = H×h + B×b + P×p - S`。
  - `accountFitBonus`（6）：命中 `contentPillars` 对应类目的维度组加分。
  - `toolEngineeringBonus`（10）：维度组命中 GitHub、开源、开发工具、工程实践、框架、插件、代码模型或 Agent Skills 等强工具信号时加分；可在私有账号配置中单独提高，不会奖励泛 AI 新闻。
  - `minimumToolCandidates`（2）：常规核心候选中至少保留的强工具/工程候选数；没有足够合格工具时按实际数量保留，不会用泛 AI 事件补位。私有账号可按内容配比提高。
  - `categoryPreference`：预排序分类偏好分（大厂 6 / AI 4 / 行业 3 / 综合 1 / 职场 0）。调低或调负可让泛热点沉底。
  - `pBase`：P 分类基分（大厂 50 / AI 40 / 行业 30 / 综合 20 / 职场 10）。
  - `hBase`：H 爆款画像基分（worker_social 48、bigtech 33 等，完整键见示例文件）。
  - 选题报告 `topics-ranked.md` 底部的公式文案跟随实际权重显示。

## 4. 技能配置覆盖层：`writing-skills/<技能id>/active.json`

在「技能与插件」页面维护，不写 Git 管理的技能本体；每次生成会冻结实际生效的 prompt、模型与工具快照，可回滚历史版本。字段（`lib/skills/configuration.mjs`）：

- `prompt`：覆盖层，追加在内置技能 prompt 之后（`CONFIGURED OVERLAY`），与不可变安全门禁冲突时以门禁为准。
- `defaultModel`：该技能默认模型路由。
- `allowedTools`：工具白名单（信息工具槽位能力 ID）。
- `gates`：质量门禁——`length.minVisibleChars` / `maxVisibleChars`（默认跟随 `config.local.json` 的 `articleLength`，内置兜底 1300–2000；覆盖层配置后优先级最高；字数违规只记 warning，不阻断流程）、`facts`（未核验事实/缺来源/模型建议冒充体验，默认 error）、`voice`（第一人称与亲测声明策略）、`repair`（自动返工开关与上限，默认 1 轮）。

选题阶段 5 个技能（`hotspot-tagging`、`event-card-generator`、`hotspot-brainstorm`、`hotspot-synthesis`、`editorial-room-chat`）同样走覆盖层机制；它们在代码里留有内联 fallback，技能目录缺失时行为不变。

## 5. 技能与工具的编写、校验、安装

三类扩展（第三方技能包、本地工具插件、远程 API/MCP 插件）的形态、权限声明、失败语义、版本兼容与上手路径，统一见 [extending.md](./extending.md)；最小示例在 [examples/](./examples/)。内置技能清单与约定见 [skills/README.md](../skills/README.md)。扩展点契约以 `lib/skills/skill-manifest.schema.json` 与 `lib/tools/manifest-loader.mjs` 为准。

## 6. 运行数据与备份

- 运行期目录（均被 `.gitignore` 排除）：`data/`（数据库、缓存、技能包版本档案、工具执行审计、技能覆盖层）、`articles/`、`topics/`、`social-cards/`、`logs/`。
- 备份/恢复/清缓存/批次删除在「设置与数据 → 备份与恢复」；备份含数据库快照、运行配置状态、技能包与插件目录，逐文件记录 SHA-256。LLM 与插件凭据不写入数据库和备份。
