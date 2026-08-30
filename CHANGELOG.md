# 更新日志

- 修复成稿审稿失败不可诊断的问题：自然化阶段识别工具操作说明并自动重试，异常模型调用标记为 `invalid_output`；审稿响应在门禁判定前保存到 `06-review-gate.md`，失败任务直接显示契约缺失与响应摘要。

本项目遵循[语义化版本](https://semver.org/lang/zh-CN/)，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## 兼容政策

主版本为 0 期间（0.x.y）：minor 可引入新功能与向后兼容的契约演进，patch 只含修复。以下四类接口的兼容承诺：

- **数据库 Schema**：只做幂等、只增式迁移（新增表 / 列、默认值回填），启动时自动执行（`server/platform/core/store.mjs`）。同一大版本内旧库直接启动即可；跨大版本恢复备份必须走备份包校验（清单 `schemaVersion` + 逐文件 SHA-256，恢复前自动保存快照，失败可回滚）。
- **技能契约**：第三方技能包以 `skill.json` 的 `schemaVersion`（当前 1）与 `compatibleApp` 判定兼容；`schemaVersion` 升版时旧版技能至少保留 1 个 minor 的并行支持期。
- **插件 Manifest**：本地与远程插件以 `schemaVersion`（当前 1）与 `compatibleApp` 判定；不兼容的插件在安装时明确报错，不静默加载。
- **REST API**：`API.md` 记录的路由在同一大版本内只增不破（`test/api-docs-routes.test.mjs` 双向钉死）；破坏性变更先在 CHANGELOG 标记 Deprecated，至少保留 1 个 minor 后才移除。

应用版本的唯一来源是 `package.json` 的 `version` 字段（`server/version.mjs` 统一读取，技能与插件的 `compatibleApp` 判定均以此为准）。发布流程见 `docs/release.md`。

## [Unreleased]

### Added

- **AI 视觉文章封面**：封面工作台新增可选“AI 视觉封面”模式，沿用文本模型生成 HTML/CSS 并由 Chromium 直接截图为 900×383 PNG，不调用文生图模型；当前跳过 AI HTML 结构/视觉质量门禁，不做确定性文字注入，生成失败直接失败且不自动回退标准封面。候选文章和批次早报均支持该模式，并提供 AI HTML 源文件、主题快照和阶段记录查看/审计入口。

### Fixed

- AI 视觉封面实验阶段暂时跳过 HTML 结构、插槽、溢出和视觉质量门禁，直接从模型生成 HTML/CSS 进入 Chromium 截图；生成或截图失败时任务直接失败，不自动回退标准封面。

## [0.7.1] - 2026-08-29

### Added

- 新增 AI 可视化 Social Card 生成流水线：分离 CSS 生成、页面生成、布局审计修复和截图阶段，并纳入主题设计规范与浏览器真实布局校验。
- AI 视觉生成与程序化生成共用发布文案生成模块，统一生成标题、正文摘要和话题标签，并将文案作为交付门禁产物保存。
- 为社交卡片主题补充 AI 设计规范、布局指南和视觉契约，支持主题切换时使用最新主题规格。

### Changed

- 扩展 Social Card 结构、主题、布局审计和 Agent 契约，降低 AI 输出截断、样式未生效和审计误判对交付的影响。

## [0.6.8] - 2026-08-24

### Added

- 第三方本地工具插件 Manifest 声明目录外能力时，包校验与安装接口同样返回目录条目草案（R3 草案辅助补齐本地场景），人工确认后经 `POST /api/system/capability-catalog` 入库。

### Changed

- 消费者—能力基线脚本的适配信息改为从 `config/capability-consumers.json` 登记推导，不再手工维护静态表；登记变更后重跑 `npm run capability:consumer-baseline` 即可。
- 自主写作与自定义图文 Agent 的 url.fetch 成功结果回填资源目录正文，段落检索（`content.passage.retrieve`）在这两个入口可对已抓取素材走严格资源分支。
- 资源适配层的授权拒绝文案外置到 `config/agent-adaptation-messages.json`，按"Agent + capability"二维维护（`messages.<consumerId>.<capability>`），各 Agent 措辞直接改配置；文件或条目缺失时回退档案内联兜底。

### Fixed

- 修复事件图文内容规划器因单个非法补充块操作导致整批操作丢失的问题；严格要求多项内容使用 `items`，并按操作隔离校验与落地。
- 修复事件热榜缺少直接加入事件图文池入口、操作按钮溢出和文案不一致的问题。
- 修复沉浸式编辑室与自定义图文对话在流式思考、消息高度变化或思考过程收起后无法稳定滚动到底部的问题；外层消息区与思考过程内层均会在布局完成后校正滚动位置。

## [0.6.3] - 2026-08-15

### Added

- 通用对话 ToolCall Agent：编辑室、自主写作和自定义图文共享协议、能力授权、执行预算、事件流与审计关联。
- R1–R6 工程治理：补齐本地 HTTP 安全边界、数据事务与实例锁、LLM 重试和内容门禁、主题及扩展信任链、公共实现和大文件模块边界。
- 发布治理门禁：构建扫描真实插件目录，发布前清理旧产物并校验 HEAD 版本，校验和覆盖本次全部发布物。
- 新增流水线失败对象索引第一阶段：按当前批次持久化失败采集源、打标热点和事件卡事件，并在批次抽屉只读展示对象、原因及关联信息，为后续单条重试与跳过提供稳定数据基础。
- 新增失败对象单条重试：采集源只重跑原订阅源，打标只补目标热点，事件卡只补目标事件；成功后自动归档失败记录，批次抽屉可直接触发。
- 新增失败对象跳过与恢复：采集跳过仅作用于当前批次，打标热点和事件卡事件会从后续范围安全排除；批次级研判错误禁止跳过，所有决策均保留历史并可恢复。
- 研判任务失败现在按前置条件、确定性门禁、模型输出门禁和服务商异常分类持久化，可从失败清单整体重试；成功后自动解决，阶段级错误始终不提供跳过。
- 技能与工具页新增「采集源」消费者 tab：37 个按启用采集源自动生成的采集源消费者单独成组展示，此前只计入总数不可见。

### Changed

- 内置能力现由 35 个写作技能与 15 个 Manifest 插件组成；项目已采用 MIT 许可证开放源码，第三方扩展仍需按 Manifest 权限与信任门禁审阅。
- 文档目录重组：顶层只保留使用与开发接入文档，设计方案统一收进 `docs/design/`，历史方案与审计记录归档 `docs/archive/`；回归基线 JSON 移入 `test/fixtures/`。

### Fixed

- 技能与工具页统计口径：tab 数量、顶部消费者/能力/工具实现计数均与列表过滤规则一致（技能 tab 12、能力 17 含采集能力、工具实现分子计入采集器）。
- 消费者—能力基线文件从被忽略的 `data/` 移入 `test/fixtures/` 并纳入提交，修复 CI 干净环境 ENOENT；消费者状态测试去除对本地 Tavily 凭据的隐式依赖。
- 移除一次性复现脚本 `scripts/render-card-repro.mjs`。

## [0.5.1] - 2026-08-10

### Changed

- 将账号内容策略拆分为推荐池、通知池和实验池，通知池增加具体读者利益、事实支持、风险等级和批次上限等确定性门禁，允许整批通知池为空。
- 调整热点研判与候选选择：降低分数饱和和重复小事件干扰，为真实工具 / 工程内容增加独立识别、账号匹配加分和最低候选席位。
- 选题、编辑会、标题和成稿技能贯通 `distribution_lane` 与 `reader_stake`，并在数据库候选记录、锁定简报和文章规划中持续保留。
- 文章选题卡与热点事件创作页只读展示池位和读者利益，不提供人工改池控件。

### Fixed

- 修复路由拆分后候选详情处理器漏传 `candidateEventGroups`，导致热点事件创作页加载候选时报错的问题，并补充真实路由回归测试。

## [0.5.0] - 2026-08-09

### Added

- 将持久化层拆分为数据库迁移、查询服务和按领域划分的 Repository，并保留 `Store` 兼容门面。
- 将批次、候选、任务等服务端路由，以及文章排版、图文故事板和编辑器文档模型拆分为独立模块。
- 新增采集质量门，在入库和 AI 打标前过滤标题、摘要与正文均为空的低价值记录。

### Changed

- Reddit 运行时改用独立 Chrome Profile 和专用 CDP 端口，并增强 IPv4、IPv6 与 localhost 兼容处理。
- 事件卡生成对模型合法 JSON 漏项执行极简重试，部分失败会显示明确状态，不再假完成。
- 完成项目架构与重构评估文档，明确各层职责和后续维护边界。

### Fixed

- 修复新版 Chrome 下 Reddit 启动按钮阻塞、健康检查误判和停止操作假成功。
- 修复空采集记录导致事件卡进度长期停留在最后一条的问题。
- 修复批次早报配图工作台缺少 `daily/images/:imageId/generate` 路由导致生成图片返回 404。
- 修复路由拆分后的 ESM 命名导入问题，并增加真实模块链接测试。

### Security

- 收紧排版结构检查中的嵌套 `<style>` 清理和编辑器字数统计中的嵌套 HTML 注释清理，通过 CodeQL 扫描。

## [0.4.2] - 2026-08-08

### Fixed

- **封面标题保真**：AI 封面规格的标题断行拼接后必须与文章原题一字不差（仅允许换行位置不同），改写、截断、增补一律拒绝并回退原题机械断行——此前 AI 会顺手改写标题甚至编造不存在的信息（`validateCoverSpec` 新增 `expectedTitle` 校验）
- **文档标题口径统一为正文 H1**：此前成稿链标题规划阶段选定的 `SELECTED_TITLE` 存入文档 `title` 字段，而写手实际写出的正文 H1 常与之不同，导致封面、列表等处标题与发布正文不一致。现在 article-pipeline 保存草稿/终稿、编辑器保存文档时 `title` 一律从正文 H1 提取（daily / tutorial 链路本已如此），封面标题恢复只取 `title` 字段；存量文档中 29 篇 title 与 H1 不一致的已按 H1 回填

## [0.4.1] - 2026-08-08

本补丁版为前端交互、布局与设计问题专项修复（审查报告 `docs/2026-08-07-frontend-ux-audit.md`，73 项全部处理完毕），不含 API 与 Schema 变更。

### Fixed

- **数据安全**：文稿加载失败不再被当作"无文档"填入模板（避免自动保存覆盖服务端文稿）；恢复备份成功后自动刷新页面，不再在过期内存状态上继续操作；`createBatch` 补错误处理与防重复提交；编辑器「全部替换」前确认并提示不可撤销；故事板未保存修改在重渲染前警告；生成故事板失败时保留现有内容
- **不可逆操作确认**：重新生成整组图文 / 封面、突发专题写入选题池、排行榜加入候选、早报清空已选、删除模型配置（附回退说明）均补确认对话框；原生 confirm 统一收口为自定义 `confirmAction`
- **请求与轮询健壮性**：`request()` 按状态码与 content-type 解析（204/空 body 不再抛 SyntaxError，HTML 错误页给出可读错误）；新增统一轮询模块（指数退避 + 超时上限 + 可取消），修复封面生成失败卡死、视图卸载后轮询抛错、后台标签页空转等问题
- **静默失败补反馈**：视图加载失败、模型列表加载失败、排行榜加载失败、配图读取失败等十余处静默 catch 补 toast 或界面降级提示；列表/图谱请求加加载态指示
- **功能修复**：「生成文章封面图」按钮恢复按终稿候选启用；插入图表后禁用的是「插入文章」而非「忽略」；批次抽屉轮询重复 `showModal` 抛异常修复；画廊翻页按钮改事件委托不再失效；保存失败状态可点击重试；质量检查跳转改用精确定位；字数统计不再误删正文连字符；daily 选项 key 含特殊字符不再是死按钮；标题同步不再覆盖用户差异化的正文 H1；订阅表单 / 突发专题 URLs / 批次表单补校验
- **时区与兼容性**：仪表盘近 7 天统计与日历落点改用本地时区解析（负时区用户不再偏差一天）；时间字符串加容错解析；撤销/重做改用自定义历史栈替换已废弃的 `document.execCommand`
- **可访问性**：批次卡片支持键盘打开且选中文本不再误触；假按钮（span）语义化为 button；全部筛选 tab 统一 `role="tab"` + `aria-selected`；图片放大遮罩修复 Esc 监听泄漏并补 dialog 语义与焦点管理
- **布局与样式**：补齐 6 个未定义的 CSS 变量（此前多处样式静默失效）；消灭 7–10px 不可读文字；移动端媒体查询被内联样式击穿修复；z-index 收敛为变量体系；矮屏嵌套滚动缓解；内联样式收口

### Changed

- **文案与一致性**：维度命名跨视图统一（共享词典）；toast 支持成功/失败类型与差异化时长，成功场景降噪；字数目标默认统一为 1,500 字；技能停用确认、删除连接/卸载等术语统一；「检查采集环境」按实际行为更名「采集环境设置」
- **安全收紧**：主题预览 iframe sandbox 收紧为完全沙箱（发布门禁已拒绝脚本，预览不依赖同源）
- **日志视图**：长日志可展开全文，新增手动刷新与自动刷新
- **代码健康度**：魔法数字集中到常量模块、流式对话与 escapeHtml 去重、死代码清理、行尾统一 LF（新增 `.gitattributes`）

## [0.4.0] - 2026-08-07

### Added

- **早报封面图**：封面链接入批次早报——封面页下拉与排版页同一约定把 `daily-final` 文档拼为「早报」伪候选，生成走 daily 分支（终稿取批次级 `daily-final`，产物落 `articles/<批次>/daily/images/cover.png`，artifact 按 `candidateId=null` 登记）；新增路由 `POST /api/batches/:id/daily/cover/generate`、`GET /api/batches/:id/daily/cover`、`GET /api/batches/:id/daily/cover/local`

### Fixed

- 排版页「生成文章封面图」跳转封面页时文章不匹配：早报（`daily`）没有候选工作区会静默落到第一篇文章；封面页收到无法匹配的文章 id 时不再静默回退到第一篇，改为空态并提示先产出 09-FINAL.md（早报场景随上方 daily 分支正式支持）
- 「生成 / 更新排版 HTML」按钮在配图未规划或未上传 CDN 时被 disable，点击毫无反馈（禁用按钮不触发任何事件，原因只在 hover tooltip 里）：改为保持可点击，点击时由前端预检 toast 说明具体原因（未执行配图规划 / 具体哪几张人工配图待上传 CDN），仍阻止实际发起排版任务

### Changed

- **统一文章字数门禁并降级为建议性**：五处判定（文章 / 早报 / 教程三条 pipeline 的长度返工区间、技能默认门禁 `DEFAULT_GATES.length`、编辑器前端计数与 preflight 检查）收敛为同一配置入口 `config.local.json` 的 `articleLength`（全局默认 1300–2000 可见字符，`pipelines.article|daily|tutorial` 可按链路覆盖）；技能覆盖层 `gates.length` 仍优先级最高。编辑器不再硬编码 2000 字上限，改由 `GET /api/system/settings` 下发区间，并补齐下限检查。字数超限不再阻断流程：pipeline 尽力自动修复后仍超限只记警告、任务照常完成；技能配置门禁中字数违规由 error 降为 warning；编辑器保存终稿不再拒绝，仅 toast 提示，可在编辑器手动删减

## [0.3.0] - 2026-08-07

### Added

- **AI 生成封面主题**（封面二期）：AI 主题生成器的 target 参数化扩展到 `cover`——封面主题是纯 token 主题（无组件配方），契约允许 targetConfig 省略、归一化跳过 recipes/behavior/effects/components 修复、prompt 使用封面专属设计方向（900×383 固定画布、标题为绝对主角）；`compileThemePreview` 与发布门禁支持 cover（固定封面样稿渲染、900×383 结构检查，反白文字由封面编译器 `pick()` 动态保证对比度，不做 token 级硬门禁）；视觉相似度比较兼容无配方主题；主题中心 AI 生成表单新增「封面主题」类型，封面用户主题在编辑器中走纯 token 编辑；克隆与导入同步支持 cover 目标
- **公众号文章封面图**（AI 非视觉生成）：新增「文章封面图」工作台（导航位于「公众号排版」之后，排版页「复制公众号富文本」旁有引导按钮）。AI 只做排版决策——选封面主题、组合组件（画布/几何色块/主标题断行与高亮/标签/副标题/信息行/装饰）、产出规格 JSON；规格经 `validateCoverSpec` 校验，任一不合规整体回退 `fallbackCoverSpec` 保证永远出图；最终由确定性 HTML 模板渲染并截图为 900×383 PNG（`server/shared/themes/cover-components.mjs`、`cover-theme-compiler.mjs`、`server/platform/llm/cover-image-generator.mjs`，产物落 `images/cover.png` 并登记 kind=封面图 artifact）。封面主题进主题中心体系（`targets:['cover']`，`themes/cover/` 内置 10 套），API：`POST /api/candidates/:id/cover/generate`、`GET /api/candidates/:id/cover`、`GET /api/candidates/:id/cover/local`
- **AI 兴趣仓库发现**（`githubDiscovery.aiQueries`）：LLM 按 `account-context.json` 内容支柱生成 GitHub Search 查询组（缓存 `data/repo-discovery-queries.json`，默认 7 天复用，可手工编辑），随 github 采集执行为新通道 `ai-search`（来源名「AI 兴趣发现 · {方向}」），结果再经 LLM 兴趣相关性打分过滤（≥ `minInterestScore` 6 分保留，分数/理由随热点 `raw_json` 入库）；任一环节失败自动退化为纯规则发现（Trending + 增长搜索 + 热点提及）
- **编辑会外部链接入库**：编辑会回答中粘贴的链接（去重后最多 5 条）自动逐个抓取并落新增的 `candidate_sources` 表（按候选+URL 覆盖），以「用户补充来源」分组注入事实基座；每条抓取结果（成功标题字数/失败原因）写入对话，对用户与模型可见

### Changed

- 内置封面主题从 5 套扩充到 10 套，新增：绯红快讯（快讯）、宝蓝数据（数据对比/快讯）、琥珀可可（事件图文/深度观点）、紫夜星轨（技术教程/快讯）、青瓷素纸（深度观点/数据对比）；封面场景筛选补齐「数据对比」
- 图文代码块字号独立为可选 token `codePx`（缺省回退 `captionPx`），14 个内置社交主题统一从 9px 提升到 11px；不计入密度预算（块级局部元素），AI 生成主题默认值同步
- 封面页主题选择接入与文章/图文一致的主题选择弹窗：「封面主题」触发按钮打开带视觉样稿的主题弹窗（cover 目标单行卡片布局，左侧封面样稿、右侧主题文案，含「自动匹配」置顶项）；主题中心「浏览主题库」同步新增「浏览封面主题」入口；主题 hydration 统一移交 `hydrateThemePickers`，`cover.js` 不再自管目录加载

### Fixed

- 编辑会粘贴链接只抓取第一条、composite 候选下完全不生效（override 快照落 `hotspot_id=0` 永远不会被事实基座读回）、抓取成败不可见——以上随 `candidate_sources` 通道一并解决
- **GitHub 增长搜索 / AI 兴趣发现整批被新鲜度过滤吞掉**：`publishedAt` 误用仓库创建时间（`repo.created_at`），下游 `isFreshForBatch` 按批次窗口（如 24h）过滤后全部丢弃——增长搜索自上线起从未进入热点全景与研判；改为发现时间，仓库创建时间保留在 `createdAt` 字段
- AI 兴趣相关性过滤的分数与理由未随热点入库（归并时只取了保留集合的名字，存的是未带分数的原始条目）
- 图文选题池候选描述（`candidate-description`）由仓库英文简介改为打标产出的中文相关度理由（`aiTags.relevanceReason`；能进图文池的热点必经打标，未打标场景留空不渲染）；入选理由新增 `ai-search` 通道标签（「AI 兴趣发现 · 兴趣契合 N/10」）
- 图文生成按钮（`#generate-social-card`）进度错乱：页面级单按钮被多个候选的生成任务 watcher 交替覆盖，且门禁渲染会冲掉生成中状态，导致 A 候选的进度显示在 B 候选上；改为任务状态按候选追踪（`socialJobs` Map）、按钮按当前选中候选渲染（`syncGenerateButton`），完成/失败提示只对选中候选弹出

## [0.2.2] - 2026-08-06

### Fixed

- 排版结构保真检查对含引号等 HTML 特殊字符的标题误判：标题渲染后被转义（`"`→`&quot;`），`htmlPreservesStructure` 用原始文本比对导致误报「HTML 初稿未完整保留标题、章节、链接或图片」；比对前对标题做同样转义
- AI 任务并发重构回归：`AiJobManager.run()` 不再丢失 `candidateId / documentKind / focus / focuses` 等执行参数（此前入队后以空参数执行，成稿/图文等任务 `getCandidate(undefined)` 报「Provided value cannot be bound to SQLite parameter 1」）
- DeepSeek 推理强度修复：`reasoning_effort` 按官方 OpenAI SDK 用法**顶层下发**（同时保留 `thinking` 内嵌），低强度配置不再失效；未配置强度时显式开启 thinking，避免落到默认 high 导致推理失控
- thinking 开启且推理吃光 `max_tokens`（finish=length 内容为空）时，`complete` / `streamComplete` 自动**回落无思考重试一次**，编辑室等调用不再因此报「未返回流式文本内容」
- 流式请求显式发送 `stream_options.include_usage`，保证 token 用量按 API 返回的 `usage` 统计
- `model_calls` 新增 `reasoning_tokens` 列，记录 DeepSeek `usage.completion_tokens_details.reasoning_tokens`，便于诊断推理开销
- 语义打标单批模型调用失败（超时 / 空内容 / 网络中断）不再拖垮整个批次：抛错后先翻转 thinking 重试一次，仍失败则把该批热点标记为失败跳过，批次结束后可「继续打标」补打；此前网关抛错会直接失败整个 auto 任务
- 流式空内容报错补充诊断信息（finishReason + 推理字符数），便于区分「输出预算耗尽」与「内容过滤」
- 语义打标重试不再把已开启的 thinking 关掉：JSON 截断进入拆分重试时，拆分后的子批继续沿用 thinking（此前拆分路径把 thinking 重置为关闭，导致模型退化问题复现）
- 图文主题代码块对比度：`inverseText` 与 `codeBackground` 同色的主题（crimson / orange / charcoal）代码块此前是黑字黑底几乎不可见；新增 `accent-panel`（白字强调色底）与 `ink-panel`（白字深色底）代码配方并切换这三个主题，代码文字改为 `--ink` / `--inverse` 高对比色
- crimson 列表由「白字黄底」（`hard-card`）改为「白字红底」（新增 `hard-accent` 列表配方），并提升结尾页文字对比度；crimson / orange / charcoal 主题版本升至 1.0.1
- 全量图文主题对比度审计（`scripts/quality/audit-theme-contrast.mjs`，无头浏览器实测）：brutalist 眉题由 1:1 不可见改为正文色；peach / tokyo-night / lavender / solarized 加深强调色使白字达标（步骤号 / 表头 / 结尾页），brand 对比度随之提升；bone-white / ice-blue / mocha / paper-craft / peach / solarized 眉题由 accent2 改为 muted 色提升可读性；相关主题版本升至 1.0.1

### Changed

- 批次早报可见字符门禁调整为 1300–1800 字（此前默认 1200 硬上限）：`daily-pipeline.mjs` 默认 `gates.length` 改为 `{minVisibleChars:1300,maxVisibleChars:1800}`，`wechat-mp-daily` 技能正文区间同步为 1300–1800 字
- 布局审计失败后定位到具体故事板页：解析报错中的「P\d+」页码，自动展开「02 卡片故事板」对应页的编辑器、滚动并红色高亮，标注「布局审计未通过 · 修改本页后重新生成」，不再只给一段需要用户自己找页的报错文案
- 图文故事板内容更充实：单块字数上限从 160 提升到 240，并提示模型写具体内容（能力/机制/命令/数字/边界）、代码块给出完整多行命令序列（安装→初始化→运行→验证），减少代码块/短文本导致的卡片大片留白（`repository/event/custom-card-storyboard/references/storyboard.md` 与 `runtime-contract.md`）

- AI 后台任务并发模型：候选级任务（文章 / 图文 / 排版 / 自主写作）按候选并行，批次级任务（打标 / 研判 / 事件卡 / 自动流程 / 早报）同批次互斥；超出 `aiJobs.maxConcurrent`（默认 2，可配）的任务进入 FIFO 队列以 `queued` 状态等待，不再互相阻塞或报「已有任务运行」
- 服务重启恢复：`queued` 状态的 AI 任务与 `running` 一并标记为中断，避免残留排队记录

- README 顶部示例改为演示封面图（`docs/screenshots/ui-demo-cover.png`，`scripts/media/render-demo-cover.mjs` 可重新生成），点击跳转 CDN 演示视频 `https://img.shiker.tech/project/export-1785841213192.mp4`（GitHub README 不支持 `<video>` 标签，采用封面图 + 播放链接方案）；原截图保留在 `docs/screenshots/` 作海报与渠道物料

## [0.2.0] - 2026-08-04

### Fixed

- 模型请求超时不再误报「未返回文本内容」：网关识别 AbortController 中断并给出明确超时提示，默认 `requestTimeoutMs` 提升至 5 分钟以适配推理模型长输出
- 对齐 DeepSeek 最新接口定义：`content_filter` / `insufficient_system_resource` 两种 finish_reason 报出明确错误（此前会被当作正常结果拿到半截内容）；provider 新增可选 `reasoningEffort` 透传（thinking 开启时生效）
- RSSHub 依赖安装改用 `--legacy-peer-deps` 修复其 eslint peer 冲突；克隆成功但依赖未装时可续装

### Added

- 主题体系：文章排版与图文主题 JSON 化（注册表 + 主题目录 + 基线校验）；主题编辑器、样式能力清单与覆盖率校验、发布门禁与生产级实时预览；主题中心 AI 创建主题（候选确认、受控发布）；封面标题 / 骨架 / 节奏 / 封面承载配方从编译器硬编码迁移为主题 JSON 显式字段，骨架支持全页型与同骨架组内第二层视觉差异，主题选择器按内容场景与阅读密度辅助决策
- 图文密度与封面标题：故事板密度预算（规划阶段确定性裁剪块数与列表条目）、稀疏页确定性兜底、布局修复失败信息带明细与故事板编辑指引；封面标题强调色块 AI 语义断行，公众号封面标题规则对齐小红书 TITLE_GUIDE
- 选题链 prompt 全面技能化：热点打标、事件卡、探索脑暴、综合研判、编辑会 5 个选题阶段技能（`hotspot-tagging` / `event-card-generator` / `hotspot-brainstorm` / `hotspot-synthesis` / `editorial-room`），经标准技能运行时加载并支持配置覆盖层与 prompt 哈希快照，代码保留内联 fallback；编辑会账号上下文改为 `{{ACCOUNT_CONTEXT}}` 占位符注入
- 选题评分参数可配置：`account-context.json` 新增 `scoring` 段，F=H×h+B×b+P×p-S 权重、账号契合加分、分类偏好、pBase/hBase 基分均可按键覆盖，非法值回退默认；选题报告公式文案跟随实际权重
- 成稿技能变现配合规则：增长与承接契约新增「留言引导与变现配合」（结尾具体留言引导问题、商业词汇自然覆盖、文中广告发布侧位置建议），早报 / 教程 / 自主写作链同步留言引导要求
- 配置项参考文档 `docs/configuration.md`：汇总 `.env`、`config.local.json`、`account-context.json`（含评分参数）与技能覆盖层全部配置字段

- 批次早报生成记录：页面展示最近任务状态（执行中 / 失败原因 / 完成时间），失败与中断可一键重试，刷新页面自动续接执行中的任务

- 文章配图可生成类别：IMG-DATA 结构化占位（事件线 / 数据卡，数据必须来自正文）、确定性单图渲染管线、配图工作台一键生成与放大查看
- 首次安装引导：`npm run setup` / `setup-workbench.cmd` 交互向导（依赖、配置、LLM Key），RSSHub 缺失时可自动从 GitHub 浅克隆并安装依赖，附 Linux/macOS `.sh` 对应脚本
- 编辑室两步备料：进入候选编辑室先幂等抓取全部事件来源原文再解锁对话，失败来源提示不阻断，可跳过
- 本地段落检索插件 `local-passage-retrieval`（`content.passage.retrieve`）：编辑室长正文按「头部 + BM25 相关段落」摘录注入，替代全量截断，检索不可用时自动回退
- 能力槽位体系推广到注册表全部能力：固定 6 个信息槽位之外的工具能力（段落检索、图表渲染、图床上传）自动生成槽位卡片，可在「技能与工具」页统一查看状态并切换偏好实现

- 开源前置整理：MIT 许可证与 `THIRD_PARTY_NOTICES.md`、`SECURITY.md`、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、Issue / PR 模板、CODEOWNERS
- CI（GitHub Actions）：`npm ci`、构建、全量测试、示例技能包 / 插件校验、依赖漏洞与许可证扫描、秘密扫描
- 测试分层：浏览器依赖测试打标，`npm run test:fast` 可在无 Puppeteer 缓存环境运行
- 提交前秘密扫描钩子（`.githooks/pre-commit`，`git config core.hooksPath .githooks` 启用）
- 冷启动验收脚本（`scripts/archive/cold-start-acceptance.sh`）、示例配置与 API 路由清单双向校验测试
- 全字段虚构的 `account-context.example.json`
- 版本兼容验收样例（`test/version-compat.test.mjs`）：旧版数据库幂等迁移、技能包与插件的 `schemaVersion` / `compatibleApp` 判定
- 演示模式（`--demo` / `WORKBENCH_DEMO=1` / `start-workbench.ps1 -Demo`）：无模型服务商时写入两份虚构演示批次（热点、打标、文章 / 图文选题池、排版与终稿产物），使用独立数据库 `data/demo.db`，跳过 RSSHub 自动启动，浏览型视图完整可用
- README 视觉物料：`docs/screenshots/` 工作台截图，`scripts/media/render-ui-shots.mjs` 可重新生成

### Security

- 技能包安装 / 更新 / 状态 / 删除与插件变更路由补充 `x-admin-confirm` 确认头校验，前端走确认弹窗
- url-fetch 插件拒绝本机 / 内网目标；rsshub 内网判定补全 100.64/10 等保留段；图片预览页 title 补转义
- 重写 Git 历史清除 `data/` 与 `logs/` 残留（含空数据库、缓存与审计截图），仓库迁移至新地址

## [0.1.0] - 2026-07-29

### Added

- 每日早报与自主写作任务
- 来源健康时间线
- 工具插件化：本地 adapter、远程声明式插件（Manifest + 权限声明）
- 写作技能可配置化，图文流程拆分为独立技能

## [0.0.1] - 2026-07-26

### Added

- 初始版本：热点采集、事件研判、选题、编辑室决策、文章成稿、公众号排版与社交图文批次的本地工作台

[Unreleased]: https://github.com/shiker1996/wechat-newsroom-workbench/compare/0.6.8...HEAD
[0.6.8]: https://github.com/shiker1996/wechat-newsroom-workbench/compare/0.6.7...0.6.8
[0.6.3]: https://github.com/shiker1996/wechat-newsroom-workbench/compare/0.5.1...0.6.3
[0.5.1]: https://github.com/shiker1996/wechat-newsroom-workbench/compare/0.5.0...0.5.1
[0.5.0]: https://github.com/shiker1996/wechat-newsroom-workbench/compare/v0.4.3...0.5.0
[0.4.2]: https://github.com/shiker1996/wechat-newsroom-workbench/compare/0.4.1...0.4.2
[0.4.1]: https://github.com/shiker1996/wechat-newsroom-workbench/compare/0.4.0...0.4.1
[0.4.0]: https://github.com/shiker1996/wechat-newsroom-workbench/compare/0.3.0...0.4.0
[0.3.0]: https://github.com/shiker1996/wechat-newsroom-workbench/compare/0.2.2...0.3.0
[0.2.2]: https://github.com/shiker1996/wechat-newsroom-workbench/compare/0.2.1...0.2.2
[0.2.0]: https://github.com/shiker1996/wechat-newsroom-workbench/compare/0.1.5...0.2.0
[0.1.0]: https://github.com/shiker1996/wechat-newsroom-workbench/compare/0.0.1...0.1.0
[0.0.1]: https://github.com/shiker1996/wechat-newsroom-workbench/releases/tag/0.0.1
