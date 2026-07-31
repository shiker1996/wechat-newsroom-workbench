# 后续工作事项

> 状态速览（2026-07-31）：已知问题 3 项全部闭环；开源前置工作全部完成，仓库待翻 Public；项目日志已完善（缘起、目标、思路转折历程已写入 `project-development-record.md`）。技能插件扩展点：网络 / 新闻搜索已实现并接入自主写作与自定义图文（`tavily-search` 内置插件 + 创作表单显式开关）。剩余待办——文档检索槽位（P2）、技能调用链可视化。

## 已知问题

1. ~~智能构图问题~~（已修复 2026-07-31）：P-03 页面 text-block 中长 URL 未折行，溢出所在列被相邻列 list-block 遮盖。根因是生成 CSS 中 `.content-block p/h2` 缺少 `overflow-wrap:anywhere` 且网格项缺 `min-width:0`（`lib/llm/social-card-pipeline.mjs`）；grid-column 分配本身无误。同时给 `skills/xiaohongshu-article-generator/scripts/layout-audit.mjs` 增加 `horizontal_overflow` 横向溢出检测，堵住审计盲区。
2. ~~稳定构图生成失败~~（已修复 2026-07-31）：首次生成时技能未配置白名单，快照却写入 `allowedTools:[]`；重新生成走快照复用路径时空数组被当作已配置白名单，与冻结工具数不一致而报错（`lib/skills/pipeline-runtime.mjs`）。已统一"空白名单=未配置"语义并补回归测试。
3. ~~代码下线：lib/domain/social-card-prompts~~（已评估 2026-07-31，不予下线）：该目录为在用代码，每次故事板规划经 `buildSocialCardStoryboardSystemPrompt()` 读取（`lib/domain/social-card-storyboard-contracts.mjs:76`，调用点 `lib/http/routes/social-card-routes.mjs:158`）。4 个文件是输出 Schema、渠道边界、构图 DSL 白名单三类固定契约，对内置和第三方故事板技能统一注入，属于不可替换的运行契约（见 social-card-storyboard-skill-extension-plan.md:469 的刻意设计），技能化会破坏第三方技能约束闭环。可选整理仅为目录改名（如 `lib/domain/social-card-contracts/`），开源整理时顺手做即可。

## 开源前置工作

见：[open-source-readiness.md](open-source-readiness.md)

**已全部闭环（2026-07-31）**：P0（密钥与隐私清理）✅、P1（许可证、安全文档、数据流向）✅、P2 已评审（Dependabot 配置与 Windows-only 显著标注完成，遥测明确不做，其余 4 条标注暂缓理由）。CI 已上线并在 master 全绿，README 已完成美化（徽章、快读段、功能总览表格、目录，`6e8da05`），测试 446 全过。仓库当前为私有，待手动翻 Public。

## 项目日志更新

**已完成（2026-07-31）**：以下素材已整理写入 [project-development-record.md](project-development-record.md) 第 1 节（项目缘起、目标与定位、思路转折历程），此处保留原始记录备查。

项目日志应该从openclaw的编排技能出发，工具协作平台执行编排技能总会中断不能完全自主执行、热点抓取总结耗费大量token所以才导致了本项目的落地
本项目的目标是什么，就是做一个写作Agents平台，聚焦写作能力其他agents平台的通用模式一概不用，不追求大而全要做到专而精

本人的思路转折历程：

边实践边思考：比如我们最初的技能采集流程中，只是通过rss、浏览器抓取一些技能规定的数据源然后对拉取的热点进行排名评分，从排名最高的十个热点中进行脑暴产生选题
而且小红书图文和热点采集写公众号文章的链路完全无关，只能根据github仓库生成相应的介绍图文

我们在实施的过程中也是先按照上述思路做的第一版 [2026-07-20-project-init.md](2026-07-20-project-init.md)

后续考虑功能拓展时，我们参考现有的AI工作流平台优先做了技能执行器和编排器，将提示词从编排器中拆分出来到单独的技能中，见[typeset-pipeline-optimization-plan.md](typeset-pipeline-optimization-plan.md)

然后在此基础上优化热点到选题流程，从单热点评分改进到热点-事件-维度聚合，即一个维度多个事件，一个事件多个热点来源

维度从5W1H产生，即Who(谁)、What(什么)、Where(哪里)、When(什么时候)、Why(为什么)、How(如何)。而对于事件的关注维度，聚合时更关注who\where\what，即主体、地点和动作，这样可以更全局地看清热点背后的事件。
这里的事项见：[optional-feature-implementation-roadmap.md](optional-feature-implementation-roadmap.md)、[event-deep-fetch-and-fact-base-plan.md](event-deep-fetch-and-fact-base-plan.md)

热点选题优化后，我们又开始做小红书/小绿树贴图，这里方案见[dual-content-pools-and-social-card-pipeline.md](dual-content-pools-and-social-card-pipeline.md)

并对其进行拓展[optional-feature-todos.md](optional-feature-todos.md)、[custom-content-and-xiaohongshu-design.md](custom-content-and-xiaohongshu-design.md)

然后整体功能完善后才是，我们的功能技能化和插件化改造，见[social-card-storyboard-skill-extension-plan.md](social-card-storyboard-skill-extension-plan.md)、[skill-and-tool-extension-plan.md](skill-and-tool-extension-plan.md)

现在开发记录比较笼统，需要完善：[project-development-record.md](project-development-record.md)

## 技能插件扩展点

> 记录日期：2026-07-29
> 当前仅进入规划池，不属于 P0–P4 已完成范围。

### 补齐三个信息工具能力

当前信息能力槽位已经建立稳定契约。网络搜索与新闻搜索已由内置插件 `tavily-search` 实现（2026-07-31，复用 `TAVILY_API_KEY`，新闻走 `topic: "news"`），文档检索槽位仍无可用实现：

| 信息能力 | capability | 主要使用场景 | 状态 |
| --- | --- | --- | --- |
| 网络搜索 | `content.web.search` | 自主写作资料发现、事实补充、关键词外部检索 | ✅ 已实现（tavily-search） |
| 新闻搜索 | `content.news.search` | 热点事件追踪、时效性核验、补充独立新闻来源 | ✅ 已实现（tavily-search） |
| 文档检索 | `content.document.search` | 从已授权知识库、云盘或文档服务检索内部材料 | 待实施（P2） |

实施原则：

1. 继续通过信息能力槽位调用，创作流程不得绑定具体工具或服务商。
2. 首期优先接入受控的远程 API / MCP 实现，不开放任意本地代码执行。
3. 搜索结果统一返回标题、URL、摘要、来源、发布时间和 provenance；文档结果额外返回文档 ID、片段位置和授权范围。
4. 网络搜索与新闻搜索必须区分：新闻搜索需要可靠的发布时间和媒体来源，不能用普通网页搜索结果静默替代。
5. 文档检索只访问用户明确连接并授权的知识源，执行日志不得记录文档正文或凭据。
6. 缺少实现、凭据失效、额度耗尽或权限不足时应明确显示原因，不回退为模型常识。
7. 任务快照记录实际选中的工具、插件版本、查询摘要和结果 provenance，支持历史追溯。

建议实施步骤：

1. ✅ 固化 capability 的输入输出 Schema 和错误码（网络 / 新闻搜索见 `plugins/tavily-search/manifest.json`）。
2. ✅ 提供最小可运行实现与连接预检（`tavily-search` 内置插件，健康检查明确报告凭据缺失与配置指引）。
3. ✅ 槽位可用状态在「技能与工具」页展示并可切换实现（原有机制，实现注册后自动生效）。
4. ✅ 网络搜索与新闻搜索已接入创作流程（2026-07-31）：自主写作（心得经验 / 使用教程）与自定义图文创建表单提供「联网搜索补充资料」「新闻时效检索」显式开关，结果作为带来源的外部素材持久化进事实基座（`web_search` / `news_search` 字段），重新生成复用不重复计费；检索失败记录为事实基座备注，不阻止创建。热点事实补充的接入仍待评估（编辑室链路已有 Tavily 注入先例，暂不重复建设）。
5. ⬜ 将文档检索接入用户主动选择的知识库场景，不默认扫描全部文档。
6. ✅ 搜索插件回归测试（缺凭据、结果归一化、新闻发布时间告警、健康检查、创作链接线与技能声明）；⬜ 超时、限流、空结果的端到端回归随使用观察再补。

验收标准：

- 三个槽位均可选择、测试和切换兼容实现。
- 创作链只依赖 capability，不依赖具体插件 ID。
- 搜索或检索结果能够进入事实基座，并保留可点击来源和 provenance。
- 能力不可用时任务在启动前阻断或按明确声明的可选能力策略降级。
- 历史任务能够还原当时使用的工具实现及版本。

### 技能调用链可视化

目标是在不开放通用工作流编辑器的前提下，让用户看清一次创作实际调用了哪些技能、工具和质量门禁，以及每一步为何被选择。

首期展示范围：

- 入口与任务：热点事件、自主写作、批次早报、工具图文、事件图文、自定义图文。
- 技能节点：主写作、故事板、标题、审阅、自然化、SEO、配图规划、排版和阶段技能。
- 工具节点：技能实际调用的 capability、解析到的工具实现和版本。
- 状态节点：等待、运行、成功、降级、返工、失败和人工中止。
- 关键关系：输入输出契约、默认/手动/兜底选择来源、返工回路和最终产物。

数据来源：

1. 以 generation snapshot 和阶段执行记录为事实来源，不根据当前配置反推历史调用链。
2. 每个节点使用稳定的 `runId`、`stageId`、`skillId`、`promptHash`、`pluginId` 和 `pluginVersion`。
3. 节点只展示输入输出摘要、耗时、状态和错误码；正文、密钥及完整远程响应默认不进入可视化数据。

交互建议：

1. 技能详情页提供“查看被哪些流程调用”，展示静态入口关系。
2. 任务详情页提供“本次调用链”，按时间和依赖关系展示实际执行情况。
3. 默认使用可折叠的纵向阶段时间线；存在分支、并行或返工时再切换为有向图。
4. 点击节点打开侧栏，显示选择来源、契约、耗时、工具依赖、返工原因和产物摘要。
5. 支持按“只看异常”“只看工具调用”“只看技能阶段”筛选，并可复制脱敏诊断摘要。

建议实施步骤：

1. 统一文章与图文流水线的阶段事件模型，补齐开始、完成、返工、降级和失败事件。
2. 建立只读调用链聚合 API，优先支持单次任务回放。
3. 实现纵向时间线和节点详情侧栏。
4. 增加返工回路、工具调用和选择来源展示。
5. 再评估跨任务对比、性能分析和图形化 DAG；首期不提供拖拽编排或修改执行链。

验收标准：

- 用户能确认一次任务实际使用的每个技能及其版本。
- 用户能识别技能是手动选择、入口默认还是系统兜底。
- 用户能看到工具 capability 解析到的具体实现及失败原因。
- 自动返工、降级和质量门禁在调用链中有清晰闭环。
- 历史任务调用链不受当前技能或工具配置变化影响。
- 可视化不泄露正文、凭据和未经授权的远程响应。
