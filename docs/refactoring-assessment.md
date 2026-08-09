# 代码重构评估

> 评估日期：2026-08-09
>
> 范围：从大文件、文件位置、功能模块耦合和后续演进成本几个角度审查当前代码。本文是重构建议，不代表已经实施的代码变更。

## 结论

项目当前没有明显的功能性失控迹象，阶段 5 完成后的测试基线为：`npm.cmd test` 共 749 项测试全部通过。

## 最终状态（2026-08-09）

| 阶段 | 状态 | 最终结果 |
|---|---|---|
| 阶段 0 | 完成 | 冻结测试、构建与文件规模基线 |
| 阶段 1 | 完成 | HTTP 路由按业务域拆分 |
| 阶段 2 | 完成 | AI 任务处理器与自动流水线拆分 |
| 阶段 3 | 完成 | 领域 Repository、数据库连接和迁移入口建立 |
| 阶段 4 | 完成 | 渲染器、生成管线和前端文档模型分层 |
| 阶段 5 | 完成 | Store 收口为兼容 facade，直接 SQL 清零 |

最终验收：`store.mjs` 约从 2030 行降至 510 行；构建通过；全量测试 749/749；`lib/data/` 遗留空目录已删除。下文保留各轮执行记录，其中“下一轮”和“后续事项”描述均为当时的历史计划，不代表当前仍有未完成任务。

需要优先处理的是职责边界，而不是为了降低行数机械拆文件。当前最重要的三个重构对象是：

1. `lib/core/store.mjs`：数据访问、迁移和多个业务领域全部集中在一个 `Store` 类中。
2. `server.mjs`：已经抽出部分路由，但仍同时承担应用组装、HTTP 适配、业务编排和大量内联路由。
3. `lib/llm/ai-job-manager.mjs`：阶段 2 已将流水线分发移出，当前保留任务队列、并发控制、日志持久化和统一执行收口。

这三个位置会放大后续需求的修改范围和回归风险，建议优先重构。

## 阶段 0 执行结果

阶段 0 已完成，当前只建立重构保护线，没有改动业务实现：

- 新增 [`test/refactoring-contracts.test.mjs`](../test/refactoring-contracts.test.mjs)，集中记录路由 handler 的委托返回约定、批次到产物的核心数据链、AI 任务类型和任务持久化语义。
- 保留现有的路由清单、迁移兼容、备份校验、AI 并发、批次生命周期和文档版本测试，作为后续拆分时的回归基线。
- 数据库关键语义包括：批次 → 热点 → 候选 → 轨道 → 文档/产物关系保持可读；AI 任务类型仍接受当前 12 类；未知任务类型必须明确拒绝。
- HTTP handler 仍返回 `true` 表示已处理、`false` 表示交给后续路由；响应状态和主要数据结构保持不变。

阶段 0 的验收命令：

```powershell
npm run build
npm.cmd test
```

完成阶段 1 之前，不应删除这些基线测试；如果路由、任务类型或数据库状态语义发生有意变化，应先更新本文和对应契约测试。

## 现状规模

| 文件 | 规模 | 主要问题 |
| --- | ---: | --- |
| `server.mjs` | 325 行左右 | 启动、静态资源、备份、路由装配和顶层入口 |
| `lib/core/store.mjs` | 2031 行 | 覆盖批次、热点、候选、文章、产物、AI、工具、主题等多个领域 |
| `lib/llm/social-card-pipeline.mjs` | 873 行 | 构图、版式、密度、HTML 渲染和流水线编排混合 |
| `lib/llm/typeset-pipeline.mjs` | 684 行 | Markdown 渲染、主题、图片、技能执行和排版编排混合 |
| `lib/llm/research-pipeline.mjs` | 730 行 | 聚类、维度池、评分、事件卡和研究流水线混合 |
| `lib/http/routes/system-routes.mjs` | 623 行 | 设置、插件、技能、订阅、备份恢复和运行时控制混合 |
| `public/src/views/editor.js` | 927 行 | 编辑器状态、预览、自动保存、质量检查、配图和 AI 操作混合 |
| `public/src/views/social-editor.js` | 620 行 | 仓库、事件、自定义图文、聊天、故事板和任务轮询混合 |

行数本身不是问题。真正需要关注的是：一个文件是否同时包含多个变化原因，是否跨越 HTTP、应用服务、领域逻辑和基础设施多个层次。

## P0：优先处理的结构问题

### 1. `Store` 已成为全局数据上帝对象

文件：[`lib/core/store.mjs`](../lib/core/store.mjs)

`Store` 从构造和迁移开始，连续承载批次、热点、候选、编辑会话、文档、产物、模型调用、生成快照、AI 运行、工具审计、技能版本和主题版本等操作。方法大致分布如下：

- `52-635`：数据库初始化和迁移
- `636-910`：批次、采集运行、热点和突发素材
- `947-1260`：候选、候选轨道、来源、编辑决策
- `1261-1540`：文档、产物、模型调用、生成快照和技能版本
- `1446-1694`：AI 运行、自定义创作、图文事实基座和卡片编辑
- `1694-2030`：文章统计、日志、视觉决策和用户主题

这种设计的主要风险：

- 任意业务领域修改都可能触碰同一个大类。
- 路由和流水线直接依赖大量 `store.*` 方法，难以限制调用边界。
- 数据库迁移、查询映射、领域状态转换和备份恢复的关注点混在一起。
- 未来替换 SQLite 或增加事务边界时，影响面会非常大。

建议采用“兼容外观 + 内部仓储拆分”的渐进方式：

```text
lib/data/
  db.mjs
  migrations.mjs
  repositories/
    batch-repository.mjs
    candidate-repository.mjs
    document-repository.mjs
    ai-run-repository.mjs
    artifact-repository.mjs
    theme-repository.mjs
    tool-repository.mjs
```

第一阶段不必一次删除 `Store`。可以让现有 `Store` 委托给这些仓储，逐步迁移调用方，保持当前测试和数据库兼容性。

### 2. `server.mjs` 仍然是半个应用层

文件：[`server.mjs`](../server.mjs)

当前 `server.mjs:286-300` 先调用已经抽出的路由模块，再继续处理 `server.mjs:302-960` 的内联路由，包含批次、候选、编辑会、教程、自定义创作、AI 任务和轨道操作。

同时，`server.mjs:296-300` 向不同路由传入大量单独依赖，例如 `fs`、`path`、`models`、`aiJobs`、图文工作目录函数、主题配置、事实基座函数和多个领域函数。这是应用上下文过重的信号。

建议继续按资源和用例拆分：

```text
lib/http/routes/
  batch-routes.mjs
  candidate-routes.mjs
  ai-job-routes.mjs
  editorial-routes.mjs
  creation-routes.mjs
```

路由只负责解析请求、校验 HTTP 输入和输出响应；批次创建、候选分流、写作启动、图文创建等流程交给应用服务。

可以建立分组后的应用上下文，减少几十个散落参数：

```js
{
  http: { json, body, binaryBody },
  services: { batchService, articleService, socialCardService },
  infrastructure: { store, jobs, aiJobs, models },
  filesystem: { root, artifactRoots, workspacePaths }
}
```

注意避免把它变成无边界的 service locator。每个路由模块仍应只接收自己需要的分组。

项目已有的 [`docs/architecture.md`](./architecture.md) 曾将这部分描述为“路由模块抽出进行中的过渡形态”；该演进方向现已在阶段 1 完成。

### 3. `AiJobManager` 同时负责调度和所有任务知识

文件：[`lib/llm/ai-job-manager.mjs`](../lib/llm/ai-job-manager.mjs)

该文件同时处理：

- 队列和最大并发数
- 批次级与候选级互斥
- 任务状态和进度日志
- `ai_runs` 持久化
- 供应商解析
- `tag`、`research`、`article`、`typeset`、`social-card` 等任务的参数组装
- `auto` 复合流程

阶段 2 前任务类型通过大型分支选择执行器，现已改为：

```text
lib/jobs/
  ai-job-manager.mjs       # 队列、并发和互斥
  ai-job-handlers.mjs      # 任务类型注册表
  ai-job-context.mjs       # 统一运行上下文
  auto-pipeline.mjs        # auto 专用编排
```

核心调度器现在通过注册表取得 handler 并执行统一上下文；新增任务类型不再需要修改调度器核心分支。

## P1：流水线和路由模块拆分

### 4. 图文流水线内部职责过多

文件：[`lib/llm/social-card-pipeline.mjs`](../lib/llm/social-card-pipeline.mjs)

该文件同时提供页面角色推断、构图 DSL 规范化、页面密度预算、版式选择、故事板 HTML 渲染、布局修复和完整 AI 生产流程。

建议拆成：

```text
lib/pipelines/social-card-pipeline.mjs
lib/rendering/social-card-renderer.mjs
lib/rendering/social-card-composition.mjs
lib/rendering/social-card-layout-audit.mjs
```

其中构图和渲染应保持纯函数优先，AI 调用、文件写入和任务状态更新只留在 pipeline 层。

### 5. 排版流水线混合纯渲染和运行时编排

文件：[`lib/llm/typeset-pipeline.mjs`](../lib/llm/typeset-pipeline.mjs)

`markdownToHtml`、主题 token 消费、图片处理、技能运行、文档落盘和完成状态更新目前集中在同一模块。

建议形成：

```text
lib/rendering/markdown-to-html.mjs
lib/rendering/typeset-renderer.mjs
lib/pipelines/typeset-pipeline.mjs
```

这里有一个值得优先修正的依赖方向：[`lib/themes/theme-preview.mjs`](../lib/themes/theme-preview.mjs) 直接依赖 `llm/typeset-pipeline.mjs` 和 `llm/social-card-pipeline.mjs`。主题预览不应该加载完整的 LLM 流水线，建议让主题模块和正式流水线共同依赖 `lib/rendering/` 下的纯渲染模块。

### 6. `research-pipeline.mjs` 是多个阶段的聚合点

文件：[`lib/llm/research-pipeline.mjs`](../lib/llm/research-pipeline.mjs)

该模块同时负责事件聚类、时效判断、维度池、候选预选、评分、事件卡生成和批次研究编排。建议按判断责任拆出：

```text
lib/domain/event-clustering.mjs
lib/domain/topic-scoring.mjs
lib/domain/dimension-selection.mjs
lib/pipelines/event-card-pipeline.mjs
lib/pipelines/research-pipeline.mjs
```

纯规则函数可以先迁移，模型调用和文件产物暂时保留在 pipeline 层。

### 7. `system-routes.mjs` 横跨多个管理领域

文件：[`lib/http/routes/system-routes.mjs`](../lib/http/routes/system-routes.mjs)

当前约 623 行，包含系统设置、技能包、工具插件、远程插件、能力槽位、订阅源、备份导出、备份校验、备份恢复和 RSSHub/Reddit 控制。

建议至少拆成：

```text
system-settings-routes.mjs
skill-admin-routes.mjs
plugin-admin-routes.mjs
backup-routes.mjs
subscription-routes.mjs
```

备份恢复中的 staging、swap、rollback 逻辑也应移动到 `lib/artifacts/backup-service.mjs`，路由只负责确认头和响应码。

## P1：前端视图模块拆分

### 8. `editor.js` 混合编辑器的多个子系统

文件：[`public/src/views/editor.js`](../public/src/views/editor.js)

927 行代码同时维护：

- undo/redo 和编辑状态
- 自动保存和保存代次
- Markdown 渲染与双向滚动
- 查找替换和文档历史
- 写作统计、大纲和质量检查
- AI 初稿、配图规划和排版任务

建议拆出：

```text
public/src/core/editor-state.js
public/src/core/document-api.js
public/src/core/markdown-preview.js
public/src/core/document-history.js
public/src/core/editor-preflight.js
public/src/core/visual-plan-panel.js
public/src/views/editor.js
```

### 9. `social-editor.js` 混合三种图文入口

文件：[`public/src/views/social-editor.js`](../public/src/views/social-editor.js)

仓库图文、事件图文、自定义图文、聊天补全、候选创建、故事板编辑和任务轮询都在同一视图文件中。建议按内容类型拆分，公共的任务轮询、门禁展示和故事板操作放入 `public/src/core/`。

## 文件位置判断

以下目录不建议仅为了目录整齐而移动：

- `collectors/`：项目定义的采集器适配层。
- `plugins/`：内置工具插件源目录。
- `skills/`：内置技能源目录。

这些位置属于产品扩展边界，当前分离是有意设计。真正需要调整的是 `lib/` 内部的职责命名：

```text
lib/llm/         # gateway、上下文、模型调用、prompt 运行时
lib/pipelines/   # article、research、typeset、social-card 等流程
lib/rendering/   # Markdown、故事板、主题和确定性 HTML 渲染
lib/data/        # 数据库连接、迁移和仓储
lib/application/ # 面向 HTTP/任务入口的用例编排
```

这类移动应在完成导入边界后进行，不建议先改目录再处理依赖。

## 推荐实施顺序

### 阶段 0：建立重构保护线

1. 保留并持续运行现有测试。
2. 为 HTTP 路由、AI 任务类型、Store 关键方法补充少量契约测试。
3. 记录现有数据库迁移、备份恢复和任务状态语义。

### 阶段 1：抽取 HTTP 路由

1. 把 `server.mjs:302-960` 的内联路由迁入 `lib/http/routes/`。
2. 保持 URL、响应结构、状态码和确认头不变。
3. 将大段文件操作和备份恢复逻辑移动到应用服务/基础设施模块。

### 阶段 2：拆 AI 任务分发

1. 保留 `AiJobManager` 的队列和互斥行为。
2. 把任务类型分发改成 handler 注册表。
3. 将 `auto` 复合流程独立出来。

### 阶段 3：拆数据访问

1. 抽取数据库连接和迁移。
2. 按领域建立仓储。
3. 让 `Store` 暂时作为兼容 facade，逐步迁移调用方。

### 阶段 4：拆纯渲染和前端视图

1. 抽出 Markdown、故事板和主题预览的纯渲染模块。
2. 拆分 `social-card-pipeline.mjs`、`typeset-pipeline.mjs`。
3. 最后拆分 `editor.js` 和 `social-editor.js`，降低前端改动范围。

### 阶段 5：Store 收口

1. 把完整建表和兼容迁移从 `Store` 移入 `lib/persistence/migrations.mjs`，由数据库启动层统一执行和校验。
2. 将 `Store` 中剩余的领域 CRUD 下沉到对应 Repository，把跨领域统计与日历、相似内容等只读聚合迁入 Query Service。
3. 保留 `Store` 作为兼容 facade，最终只承担连接生命周期、事务边界、Repository 暴露和短转发；暂不引入 ORM，避免在职责尚未收口时叠加查询层迁移风险。

阶段 5 验收目标：现有数据库可幂等升级、备份恢复与外键检查保持不变，API 与 `Store` 公共方法保持兼容，`Store` 主文件显著下降且全量测试持续通过。

## 阶段 1 执行结果

阶段 1 已完成第一轮 HTTP 路由拆分，活动实现已接入 `server.mjs`：

- `lib/http/routes/batch-routes.mjs`：批次 CRUD、删除影响评估、采集、排名、社交排名和热点全景。
- `lib/http/routes/candidate-routes.mjs`：候选列表/创建/综合候选、相似候选、突发素材、候选 CRUD、候选轨道、自定义图文与自主写作入口。
- `lib/http/routes/task-routes.mjs`：打标、研究、自动化、事件卡、日报和任务查询。
- `lib/http/route-helpers.mjs`：统一 HTTP 响应、批次装饰、事件卡关联、事件事实查询和文件写入辅助逻辑。

本阶段保持原 URL、请求方法、响应状态码、`x-admin-confirm` 校验和 AI 任务类型不变。旧内联代码已删除；后续仍应继续收紧路由上下文，减少 `server.mjs` 的依赖注入数量。

阶段 1 验收：`npm.cmd run build` 通过，`npm.cmd test` 通过（728 tests）。

## 阶段 2 执行结果

阶段 2 已完成 AI 任务分发拆分：

- `lib/llm/ai-job-manager.mjs` 只保留队列、并发、互斥、thinking 日志、任务状态持久化和统一成功/失败收口。
- `lib/jobs/ai-job-handlers.mjs` 建立 12 类任务的显式 handler 注册表，并集中维护批次级互斥类型。
- `lib/jobs/auto-pipeline.mjs` 独立承载普通批次“打标 → 事件卡 → 研判”和突发批次分析流程。
- 未知任务类型由注册表校验明确拒绝；`social-card` 由显式 handler 执行，不再依赖默认分支兜底。
- 阶段 0 的任务类型、持久化、并发和参数透传契约继续保留，并新增“每个合法任务必须存在显式 handler”的阶段 2 契约。

本阶段未改变 12 类任务名称、批次/候选互斥规则、队列去重、最大并发、provider 选择、任务结果持久化和 `auto` 阶段顺序。

阶段 2 验收：`npm.cmd run build` 通过，`npm.cmd test` 通过（730 tests）。

## 阶段 3 执行结果

阶段 3 已开始把数据访问从 `Store` 单体中拆出，同时保留全部旧调用方式：

- `lib/persistence/database.mjs` 统一负责数据库目录创建、SQLite 连接、WAL 和外键配置。
- `lib/persistence/repositories/ai-run-repository.mjs` 承担 AI 任务创建、更新、查询和最近执行记录。
- `lib/persistence/repositories/theme-repository.mjs` 承担用户主题、不可变版本、使用统计和归档影响查询。
- `lib/persistence/repositories/visual-decision-repository.mjs` 承担可视化决策记录与聚合。
- `Store` 通过 `repositories` 持有仓储，并以原方法作为兼容 facade；现有路由、流水线和测试无需修改调用协议。

本轮保持 `store.db`、所有公开方法名、返回结构、事务边界和数据库兼容行为不变。建表与补列定义先保留在 `Store`，后续由独立迁移入口统一执行和校验；仓储拆分优先覆盖批次/热点、候选/轨道、文档/产物三个高耦合域。

阶段 3 第一轮验收：`npm.cmd run build` 通过，`npm.cmd test` 通过（731 tests）。

### 阶段 3 第二轮

- `batch-repository.mjs` 接管批次创建、列表、活动批次查询、更新、删除影响统计和删除。
- `content-repository.mjs` 接管文档保存与版本记录，以及产物写入、关联查询。
- `Store` 继续负责需要跨多个领域聚合的 `getBatch()` 与突发批次编排，避免仓储之间互相调用。
- 批次级文档使用 `candidate_row_id IS NULL` 的兼容查询、文档版本上限、外键级联/脱钩策略均保持不变。

阶段 3 第二轮验收：`npm.cmd run build` 通过，批次/文档专项测试 45 项通过，`npm.cmd test` 通过（731 tests）。`Store` 从第一轮后的 2006 行进一步降至 1941 行。

### 阶段 3 第三轮

- `runtime-audit-repository.mjs` 接管模型调用、生成快照、工具执行审计和技能配置版本。
- 模型调用自动关联最近生成快照、快照 JSON 解析、工具授权布尔值恢复和技能发布事务保持原语义。
- `Store` 继续暴露全部旧方法，网关、技能运行时和工具注册中心无需感知仓储迁移。

阶段 3 第三轮验收：运行审计专项测试 58 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（731 tests）。`Store` 进一步降至 1879 行。

### 阶段 3 第四轮

- `source-run-repository.mjs` 接管来源运行、订阅健康历史和重启中断恢复。
- `hotspot-repository.mjs` 接管热点写入与去重、手动热点、素材抓取结果、突发分析、热点查询和 AI 标签更新。
- 批次热点全景与补充突发素材仍留在 `Store`，因为它们需要跨批次、热点和素材关系编排。

阶段 3 第四轮验收：热点/来源专项测试 52 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（731 tests）。`Store` 降至 1781 行。

### 阶段 3 第五轮

- `candidate-repository.mjs` 接管候选轨道增删改、文章轨道状态同步、候选/热点补充来源和综合候选成员关系。
- `Store` 保留候选列表和候选详情的跨域展示聚合，以及候选创建/综合候选创建编排。
- 双轨状态、评分同步、轨道锁定时间、来源 UPSERT 和综合候选成员去重语义保持不变。

阶段 3 第五轮验收：候选/来源专项测试 41 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（731 tests）。`Store` 降至 1708 行。

### 阶段 3 最终收口

- 候选创建和综合候选创建迁入 `CandidateRepository`，候选编号、初始评分、成员集合去重和轨道创建保持原语义。
- `lib/persistence/migrations.mjs` 成为数据库迁移执行入口，统一执行 schema 定义并在完成后运行 `PRAGMA foreign_key_check`。
- `Store.migrateSchema()` 只保留当前 schema 的幂等建表和补列定义；连接、执行入口和业务仓储均已从单体中分离。
- 候选列表、候选详情、批次详情和工作台概览继续留在 facade，定位为跨仓储只读聚合，而不是单领域数据访问。

阶段 3 最终验收：迁移与 Store 专项测试 40 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（732 tests）。`Store` 从阶段开始前约 2030 行降至 1652 行。阶段 3 完成。

## 阶段 4 执行结果

### 阶段 4 第一轮

- 新增 `lib/rendering/typeset-output.mjs`，承载 Markdown/HTML 结构保真检查、模型 HTML 清洗、公众号流式布局保护和自动主题选择。
- `typeset-pipeline.mjs` 只消费这些纯函数，并从旧路径 re-export，保持现有路由和测试导入兼容。
- 新模块不依赖文件系统、数据库、模型网关或工作区路径，可单独测试和复用。

阶段 4 第一轮验收：排版与主题专项测试 37 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（733 tests）。`typeset-pipeline.mjs` 降至 628 行。

### 阶段 4 第二轮

- 新增 `lib/rendering/social-card-plan.mjs`，承载页面密度、故事板内容预算、欠填页识别、密度舒展等级、封面标题分行校验和审计失败摘要。
- `social-card-pipeline.mjs` 继续负责构图选择、HTML 组装、模型调用、文件写入和浏览器审计，并从旧路径兼容导出规划函数。
- 首轮专项测试暴露 `listBlockValues` 同时被预算、构图体量和渲染消费；该共享纯函数已纳入新模块并通过回归。

阶段 4 第二轮验收：故事板规划与阶段契约测试 13 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（734 tests）。`social-card-pipeline.mjs` 降至 753 行。

### 阶段 4 第三轮

- 新增 `lib/rendering/social-card-layout.mjs`，承载允许版式、内容语义推荐、逐页/整组优先级和不匹配安全降级。
- 智能构图和模板构图统一消费纯版式决策，旧的 `social-card-pipeline.mjs` 导出保持兼容。
- 当时仍在流水线内的页面角色、智能构图变体和确定性 HTML 渲染，已在阶段 4 后续轮次完成拆分。

阶段 4 第三轮验收：图文布局与构图专项测试 58 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（735 tests）。`social-card-pipeline.mjs` 降至 714 行。

### 阶段 4 第四轮

- 新增 `lib/rendering/social-card-role.mjs`，集中声明页面角色、构图模式、稳定构图种子和页面角色推断。
- 智能构图变体选择继续消费这些纯函数，旧路径保持兼容导出。
- 角色识别不再与模型、文件系统、主题编译和 HTML 组装处于同一模块。

阶段 4 第四轮验收：图文角色与构图专项测试 54 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（736 tests）。`social-card-pipeline.mjs` 降至 692 行。

### 阶段 4 第五轮

- 新增 `lib/rendering/social-card-columns.mjs`，承载内容块体量估算、同级块均衡判断、主辅块识别和语义列宽选择。
- 高密度内容、体量悬殊内容和三个内容块确定性回退单列；二个或四个以上均衡同级块可选择等宽分栏。
- 智能构图变体只消费最终列宽结果，不再内嵌内容体量规则。

阶段 4 第五轮验收：语义列宽与图文专项测试 52 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（737 tests）。`social-card-pipeline.mjs` 降至 633 行。

### 阶段 4 第六轮

- 新增 `lib/rendering/social-card-composition.mjs`，承载十类页面的智能构图变体注册表、安全变体、故事板构图规范化、稳定选择和整组同角色去重。
- 构图模块组合角色推断、语义列宽和模板版式纯函数，不依赖模型、文件系统、主题或浏览器。
- `social-card-pipeline.mjs` 只消费最终构图决策；HTML 渲染侧仅保留本组已用变体的状态收集。

阶段 4 第六轮验收：智能构图专项测试 48 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（738 tests）。`social-card-pipeline.mjs` 降至 529 行。

### 阶段 4 第七轮

- 新增 `lib/rendering/storyboard-content.mjs`，承载故事板展示文字净化、角色与构图字段补齐，以及 AI 布局修复后的结构不变量检查。
- `social-card-pipeline.mjs` 不再直接维护指令前缀规则和页面、内容块、列表、表格、代码等修复边界，只负责调用纯函数并处理越界结果。
- 新增直接契约测试，锁定中文指令清理、构图补齐和内容块数量保护行为。

阶段 4 第七轮验收：图文专项测试 52 项、重构契约测试 14 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（739 tests）。`social-card-pipeline.mjs` 降至 445 行。

### 阶段 4 第八轮

- 新增 `lib/rendering/storyboard-html-content.mjs`，承载 HTML 转义、编号步骤识别，以及 text、list、code、note、stats、compare、steps、timeline、scenes、highlight 十类内容块的确定性 HTML 分派。
- 缺少结构化 `items` 的步骤与时间线继续确定性降级为列表；清单项目符号净化、对象型清单拼接和全部动态文字转义保持原行为。
- `social-card-pipeline.mjs` 的页面循环只向内容块渲染器传递最终版式与页面角色，不再维护内容块级 HTML 分支。

阶段 4 第八轮验收：图文专项测试 68 项、重构契约测试 15 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（740 tests）。`social-card-pipeline.mjs` 降至 416 行。

### 阶段 4 第九轮

- 新增 `lib/rendering/storyboard-page-renderer.mjs`，承载逐页角色与构图决策、同角色构图去重、密度调整、封面标题与承载信息、品牌和页脚文案，以及页面 HTML 骨架组装。
- 页面渲染器组合既有规划、布局、角色、构图和内容块纯模块，不依赖模型、文件系统、主题注册中心或任务状态。
- `social-card-pipeline.mjs` 不再维护逐页 HTML 循环，只负责解析主题、调用页面渲染器并组装文档壳层。

阶段 4 第九轮验收：相关专项与契约测试 32 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（741 tests）。`social-card-pipeline.mjs` 降至 354 行。

### 阶段 4 第十轮

- 新增 `lib/rendering/storyboard-document-renderer.mjs`，承载完整 HTML 文档壳层、固定画布基础 CSS、主题 CSS 注入和主题版本元数据。
- `renderStoryboardHtml` 现仅负责解析并编译主题，组合页面渲染器与文档渲染器；确定性故事板渲染已完整脱离 AI 管线实现。
- 迁移保持基础 CSS 原文与注入顺序不变，并增加文档标题转义、主题元数据和文档闭合结构的直接契约测试。

阶段 4 第十轮验收：主题与浏览器布局专项测试 71 项、重构契约测试 17 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（742 tests）。`social-card-pipeline.mjs` 降至 324 行。

### 阶段 4 第十一轮

- 新增 `lib/rendering/markdown-renderer.mjs`，承载设计 token 归一化、文章主题样式推导、内联 Markdown、标题、列表、引文、分隔线、脚注、代码围栏和 GFM 表格渲染。
- `typeset-pipeline.mjs` 只组合排版技能、主题和文件产物，通过纯渲染模块生成确定性公众号 HTML；原 `markdownToHtml` 导出保持兼容。
- 执行清单写入与主题兼容视图继续留在管线层，避免把文件系统和运行期目录职责带入渲染模块。

阶段 4 第十一轮验收：排版专项测试 23 项、重构契约测试 18 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（743 tests）。`typeset-pipeline.mjs` 从阶段 4 开始时的 690 行降至 234 行。

### 阶段 4 第十二轮

- 新增 `public/src/views/editor-document-model.js`，承载可见字符计数、Markdown 标题解析、质量问题识别、写作统计和逐行差异等无 DOM 文档规则。
- `editor.js` 保留轻量兼容包装、编辑状态、DOM 渲染、事件绑定和网络请求；源码型测试改为直接校验规则所属模块，避免把实现强制锁回视图文件。
- 新增纯模块契约测试，覆盖代码围栏内标题排除、空章节识别、章节统计和逐行差异。

阶段 4 第十二轮验收：编辑器专项测试 25 项、重构契约测试 19 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（744 tests）。`editor.js` 从 927 行降至 796 行。

### 阶段 4 第十三轮

- 新增 `public/src/views/social-editor-model.js`，承载卡片内容块表单、输出模式判定、仓库/事件/自定义事实展示和图文评分展示模型。
- `social-editor.js` 保留候选选择、任务轮询、故事板状态、DOM 事件和网络请求；事实与评分渲染只负责把当前上下文交给展示模型。
- 新增纯模块契约测试，覆盖三类输出模式、表单转义、错误信息转义和自定义图文评分占位。

阶段 4 第十三轮验收：图文专项测试 66 项、重构契约测试 20 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（745 tests）。`social-editor.js` 从 620 行降至 557 行。

阶段 4 已完成：Markdown、故事板、主题输出、两条生成管线及两个大型前端视图均已按纯规则、编排和界面状态分层；现阶段不再继续为了压缩行数拆分小型转发模块。

## 阶段 5 执行结果

### 阶段 5 第一轮

- `lib/persistence/migrations.mjs` 新增 `applyWorkbenchSchema(db)`，完整承接建表、索引、历史列补齐、主题表重建、候选轨道回填和遗留来源规范化。
- `runDatabaseMigrations(db)` 默认执行工作台 Schema，再统一运行 `PRAGMA foreign_key_check`；原注入迁移回调仍保留，便于测试和兼容调用。
- `Store` 构造函数只负责打开数据库并触发迁移，不再拥有 `migrateSchema()`；新增契约防止 Schema 定义回流到 facade。

阶段 5 第一轮验收：数据库、旧版本升级、删除与重构专项测试 59 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（746 tests）。`store.mjs` 从 1535 行降至 960 行。

阶段 5 第一轮当时的后续事项是继续迁移领域 CRUD 和跨领域只读查询；这些事项已在第二至第八轮全部完成。

### 阶段 5 第二轮

- 新增 `lib/persistence/queries/workbench-query-service.mjs`，建立跨领域只读查询的独立承载层。
- 终稿列表、内容日历、文章统计和运行日志已迁入 Query Service；`Store` 保留同名兼容转发，调用方与返回结构不变。
- 相似文章、相似图文和工作台概览已迁入 Query Service；效率基线、异常待办和来源健康等统计口径保持不变。
- 新增 Store/Query Service 委托契约，防止已迁出的 SQL 回流到 facade。

阶段 5 第二轮验收：Store 专项测试 29 项、工作台契约测试 5 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（747 tests）。`store.mjs` 从 960 行进一步降至 838 行，Query Service 为 293 行。

阶段 5 第二轮完成；当时计划继续收敛 `Store` 的领域 CRUD 与编排边界，该计划已在后续轮次完成。

### 阶段 5 第三轮

- 新增 `EditorialRepository`，统一承载文章编辑会话、编辑消息和图文编辑决策的读取与保存。
- 新增 `SocialCandidateRepository`，统一承载仓库事实卡与图文评分；评分保存仍同步更新 `candidate_tracks`，原事务边界和返回结构保持不变。
- `Store` 对上述 10 个 CRUD 仅保留兼容转发，并新增仓储暴露与默认返回值契约测试。

阶段 5 第三轮验收：Store 专项测试 30 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（748 tests）。`store.mjs` 从 838 行降至 801 行；剩余直接数据库操作 38 处，主要集中在批次详情/候选展示聚合、自动预选编排、自主写作请求和数据库恢复。

阶段 5 第三轮完成。下一轮优先迁移自主写作请求与文稿修订查询，数据库恢复和跨领域编排继续保留在 facade 或独立服务中。

### 阶段 5 第四轮

- 新增 `CustomArticleRepository`，承载自主写作请求的幂等查找、创建、候选/任务关联和项目恢复列表。
- 扩展 `ContentRepository`，下沉按 ID 获取文稿、修订版本列表和单个修订版本查询。
- `Store` 的 8 个对应方法改为兼容转发；自主写作请求指纹、请求 ID、最终文稿优先级和修订历史返回结构保持不变。

阶段 5 第四轮验收：Store 专项测试 30 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（748 tests）。`store.mjs` 从 801 行降至 771 行，直接数据库操作从 38 处降至 27 处。

阶段 5 第四轮完成。剩余 SQL 主要属于批次/候选展示聚合、突发素材与自动预选编排、淘汰原因批量写入和数据库恢复；下一轮将先区分可下沉查询与应独立成 Service 的事务编排。

### 阶段 5 第五轮

- 新增 `BatchQueryService`，承载批次详情、热点素材、产物、AI 运行状态和批次热点全景等只读聚合。
- `getBatch()` 与 `getBatchOverview()` 保留在 `Store` 作为兼容转发；最新研判任务仍独立查询，不受截断的运行列表影响。
- 将依赖实现位置的自动流水线结构契约更新为检查 Query Service，同时保留真实 Store 行为测试。

阶段 5 第五轮验收：批次、Store、演示数据与删除专项测试 39 项通过，自动流水线契约测试 6 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（748 tests）。`store.mjs` 从 771 行降至 708 行，直接数据库操作从 27 处降至 20 处。

阶段 5 第五轮完成。下一轮迁移候选列表与候选详情展示聚合；剩余写操作按自动预选、突发素材、批量淘汰原因和数据库恢复分别进入应用服务或现有仓储。

### 阶段 5 第六轮

- 新增 `CandidateQueryService`，承载候选列表、候选详情和按热点查找候选等展示查询。
- 综合候选标题、双轨信息、文章/图文编辑决策、仓库事实卡、图文评分、素材来源和可读入选理由均在查询服务中完成组装。
- `Store` 顶部的候选展示格式化辅助函数随职责迁移，不再保留第二套候选展示逻辑。

阶段 5 第六轮验收：Store 专项测试 30 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（748 tests）。`store.mjs` 从 708 行降至 611 行，直接数据库操作从 20 处降至 17 处。

阶段 5 第六轮完成。剩余直接 SQL 已基本不属于普通展示查询，下一轮将把突发素材、自动预选和批量淘汰原因从 facade 移入应用服务，并单独处理数据库恢复边界。

### 阶段 5 第七轮

- 新增 `CandidateSelectionService`，承载文章分析结果落池、综合候选创建、编辑问题初始化和图文自动预选。
- 历史已生成仓库排除、图文轨道同步和预选结果清理均保留在同一应用服务中，不下沉为孤立 CRUD。
- 突发素材追加与淘汰原因写入归入 `HotspotRepository`；淘汰原因更新增加批次约束，避免跨批次误写热点。
- `Store` 删除仓库识别辅助函数及上述编排实现，只保留服务/仓储转发。

阶段 5 第七轮验收：Store 专项测试 30 项、突发分析专项测试 6 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（748 tests）。`store.mjs` 从 611 行降至 534 行，直接数据库操作从 17 处降至 8 处。

阶段 5 第七轮完成。当前 `Store` 中仅数据库恢复仍直接执行 SQL；下一轮将迁入独立 `DatabaseRestoreService`，完成 facade 的直接数据库访问清零。

### 阶段 5 第八轮

- 新增 `DatabaseRestoreService`，承载备份数据库结构比对、外键完整性检查、表数据快照和事务恢复。
- `Store.restoreFromDatabase()` 保留兼容入口，但不再直接打开备份数据库或执行 SQL。
- 新增真实双数据库恢复测试，验证目标库数据被备份数据替换，并保留恢复后的批次数量返回契约。

阶段 5 第八轮验收：Store 专项测试 31 项通过，`npm.cmd run build` 通过，`npm.cmd test` 通过（749 tests）。`store.mjs` 从 534 行降至 510 行，直接数据库操作从 8 处降至 0。

阶段 5 完成：`Store` 现为数据库连接生命周期、Repository/Query Service/Application Service 组装和旧公共 API 兼容 facade；Schema、迁移、领域 CRUD、跨域查询、业务编排和数据库恢复均已有独立承载模块。当前不需要引入 ORM。

## 重构约束

- 不改变现有 API 路径、响应结构、任务类型和数据库兼容行为。
- 不把 `skills/`、`plugins/` 等产品扩展目录误拆为普通业务模块。
- 不为了降低单文件行数制造大量只有几十行的转发文件。
- 领域规则优先保持纯函数，文件写入、模型调用和数据库更新留在应用/流水线层。
- 每完成一个阶段都运行 `npm run build` 和 `npm.cmd test`。
- 涉及路由、目录或架构约定的变更，同步更新 `API.md`、`docs/architecture.md` 和相关测试。
