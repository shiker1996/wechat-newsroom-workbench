# Agent Harness 实施记录

日期：2026-09-05。对应 [Agent Harness 演进方案](./agent-harness-evolution-plan.md)。

## 本次交付：Phase 0 / Phase 1

已建立 `server/platform/agent/harness.mjs` 的 `runSkill` Facade，编辑会、自主写作、
自定义图文和共享 AI 视觉文档 Agent 均经此入口启动。视觉消费者覆盖文章封面和社交卡。
Facade 内部调用原有 `runConversationAgent`；没有复制模型循环或工具执行器。

运行类型支持 agent-skill、prompt-skill、stage-skill。确定性阶段由注入的
executeStage 执行，Gateway 调用由 prompt-skill 分支执行。现有 Manifest 的 writer、
reviewer 等领域分类没有被替换；业务 Pipeline 的批量迁移尚未进行。

统一入口增加技能和入口校验、必需能力预检、能力授权交集，以及已解析快照的注入接口。
快照不能增加当前目录的能力，也不能替换当前资源路径授权。该接口不是 SQLite
generation snapshot 的新格式；生产模型回调仍由原 adapter 组装并绑定 Gateway。

## 兼容基线

| 入口 | 现有入口语义 | 技能 |
|---|---|---|
| editorial | POST /api/candidates/:id/ai/editorial/stream | editorial-room-chat |
| independent-writing | POST /api/batches/:id/tutorial-chat/stream | wechat-mp-tutorial / wechat-mp-personal-writing |
| custom-social | POST /api/batches/:id/custom-social-chat/stream | custom-card-storyboard |
| ai-visual-document-generation | 共享视觉文档内部入口 | ai-visual-document-generator |
| article-cover-ai-visual-generation | 文章封面 Pipeline 内部入口 | article-cover-ai-visual-generator |
| social-card-ai-visual-generation | 社交卡 Pipeline 内部入口 | social-card-ai-visual-generator |

请求解析、路由 URL 和 done.data 的 reply、formUpdates、ready、missing、agentRunId、
toolCalls 仍由既有 adapter/route 映射。Facade 原样返回引擎结果。
AGENT_EVENT_PROTOCOL 显式描述版本 1；传输对象仍为原有 NDJSON 结构，
没有要求旧页面读取新增版本字段。

工具 Scope 保留原目录的入口/技能/实现交集语义：null 或缺省白名单不额外限制，
显式空数组禁止全部能力。新 policy 只能进一步收窄。generation snapshot 的创建、
模型绑定和历史配置读取继续由原 prepareSkillRun 完成。

## 验证

- `test/fixtures/harness-replay.json` 固定七种入口/技能组合的模型响应和工具结果。
- `test/agent-harness.test.mjs` 对每个组合执行 native / legacy 回放，逐项比较原引擎和 Facade 的结果、事件及工具调用。
- 新测试覆盖三种运行类型、缺失能力、非法授权、快照错配、历史快照越权和生产调用入口。
- 既有三类对话 adapter、路由及页面协议测试继续执行；AI 视觉测试验证真实共享 adapter 的文档写入和思考事件。
- 定向测试：61 项通过，0 失败。
- 最终全量 `npm test`：1633 项通过，0 失败、0 跳过，包含真实浏览器测试。
- `git diff --check` 通过。

## 第二次交付：Phase 2 与 Phase 3 基础

Phase 2 已将现有执行器收敛到 tool-broker：补齐目录元数据、业务 handler/缓存输出校验、
执行日志、协作取消和超时；插件 fallback 仍由 ToolRegistry 处理。
原生、Chat Completions、Responses function call 统一进入同一工具循环。
内部事件通过 onInternalEvent 输出，旧页面的 onEvent 结构和名称保持兼容。

Phase 3 已增加统一 Skill Definition / Resolver，并为现有生产 Agent 声明运行类型及入口。
领域角色 kind 保留，runtimeKind 表示默认执行类型，agentEntryPoints 支持同一 writer
同时服务于策划对话和确定性阶段。生产 Facade 自动加载定义并检查入口与必需能力。
generation snapshot 新增 skills[].definition，冻结类型、输入输出契约、能力、预算及
门禁名称；历史定义优先于实时 Manifest。Pipeline 保存快照前也会检查必需能力。

新增 agent-tool-broker.test.mjs 与 skill-runtime-definition.test.mjs，覆盖 handler/缓存
非法输出、权限和路径拒绝、确认门禁、超时/取消、协议转换、元数据冻结与历史恢复。
Phase 3 尚未完成所有消费者的模型/Prompt 组装收敛和门禁执行注册，不能视为整个阶段完成。

本轮全量 `npm test`：1644 项通过，0 失败、0 跳过；Skill 定向测试 26 项通过。
最终 provenance 兼容修正后再次执行 Agent/Broker 定向测试：67 项通过。

## 当前进度与后续阶段

第三次交付已完成 Phase 3 的 Agent 快照准备、Gateway 绑定与门禁执行机制：
生产对话及视觉 adapter 使用 Harness 注入的 Gateway，模型调用明确关联快照。
实际拼装后的消息、配置、预算、工具实现、阶段模型和门禁版本一起冻结；
复用快照检查归属、模型/工具/门禁版本并创建新 Run。输出门禁失败不发送 done，
也不把 Run 写成 completed。领域 Prompt 文案及 readiness 判断仍留在业务层。

Phase 4 已落实持久化与安全续跑：SQLite v43 新增 Run 快照外键、运行关联字段、Step、Run Event、
Checkpoint、恢复租约和工具幂等结果表。事件支持按序号增量查询，checkpoint 保存阶段状态及预算计数。
新测试覆盖 v37 升级保留旧 Run、反复打开数据库、跨连接读取、门禁失败状态、
模型/工具版本漂移与历史门禁配置恢复。工具组完成后的 checkpoint 支持从下一模型步骤
继续，恢复会原子占用租约并拒绝并发恢复；模型步骤中断或已完成 checkpoint 不可恢复。
恢复前可由业务层重建当前状态，回调失败会释放租约并阻断运行；等待确认的 checkpoint
可在显式确认能力后继续。三个对话入口现在可通过请求体 `resumeFrom` 复用 checkpoint 启动新 Run；
已完成且声明为幂等的工具结果按幂等键跨 Run 复用，不重复执行
工具实现；外部写入仍不会被自动重放，是否可标记为幂等由工具 Manifest 决定。

本轮开始补齐可观测性只读入口：`GET /api/system/conversation-agent-runs/:runId/trace`
聚合单次 Run 的快照、事件、步骤、模型调用、工具调用和最近 checkpoint，并支持按事件序号增量查询；
保持现有运行概览接口和 `/api/logs` 平铺视图不变。
模型 Gateway 已把 Agent Run 与模型步骤关联写入 `model_calls`，Tool Broker 也把同一组关联写入
`agent_tool_calls` 与 `tool_executions`，Trace 可以直接按 Run 下钻到对应的模型审计和 Tool Audit 记录。

本轮全量 `npm test`：1659 项通过，0 失败、0 跳过。
运行关联、取消入口与生产恢复入口新增回归后，准备流程/Broker/Harness/Trace 定向测试 46 项通过；
`git diff --check` 通过。数据库测试使用临时文件，未对用户业务数据库执行迁移。

| 阶段 | 待实施内容 |
|---|---|
| Phase 4 | 生产环境验证；活动 Run 取消、对话入口 `resumeFrom`、本地 checkpoint、租约、确认续跑、运行关联与副作用重放策略已完成 |
| Phase 5 | 已完成：文章、日报、自主写作和社交卡 Pipeline 的模型阶段统一经 Harness `stage-skill` 运行；批次 AI Job 建立 Job 级 Run 生命周期。 |
| Phase 6 | 已完成基础能力：跨业务 Trace 聚合、Replay fixture、运行指标与模型/技能运行对比；完整业务副作用重放和长期日志治理仍可扩展 |

当前 Replay 以固定模型响应、Skill Snapshot 和工具结果摘要组成离线 fixture；
完整外部副作用重放、长期日志保留/脱敏治理和 Trace 管理界面仍可继续扩展，
不会自动执行外部副作用。
SDK 按原方案保留为条件性工作。

## 第四次交付：Phase 5 业务消费者迁移

文章、日报、自主写作和社交卡 Pipeline 保留原有确定性阶段顺序、领域门禁和产物契约，
但所有 `Gateway.complete` 阶段调用现在通过 `bindPipelineHarnessGateway` 进入 Harness 的
`stage-skill` Facade。每次模型阶段会创建独立 Agent Run，记录阶段开始、完成或失败事件，
保存 Agent Step，并将 `agentRunId/rootRunId/workflowRunId/stageId/generationSnapshotId`
传给模型审计；原有模型响应形状不变。

批次 AI Job 在 Job 边界增加统一 Run 生命周期（`batch-job:<type>`），把 Job 开始、完成和失败
纳入同一套 Run/Event/Step 审计；打标、事件卡、研判、突发分析、排版和自动流程的模型调用也
通过同一阶段适配器进入 Harness。现有 `ai_runs` 仍作为页面兼容状态来源，Pipeline 继续负责
业务状态与产物写入。

Phase 5 的代码迁移已完成；按用户约定不在本轮执行生产环境验证。Phase 6 已补齐 Trace 回放、
模型/技能版本对比和质量评测指标基础能力。

本轮回归：`npm test` 1668 项通过，0 失败、0 取消；新增 Pipeline stage Harness、Phase 6、日志治理与 Run Trace 页面测试通过。

## 第五次交付：Phase 6 Replay、Eval 与 Trace 聚合

新增跨业务 Run Trace 查询：`GET /api/runs/:rootRunId`（`/api/system/runs` 兼容别名）聚合根 Run
下的 Agent Run、阶段事件、Step、模型调用、工具调用、Tool Audit 和 checkpoint；`/metrics`
返回成功率、运行/模型耗时、token、工具失败率和阶段摘要。

`/replay` 输出固定模型响应及 hash、Skill Snapshot 引用和工具结果摘要，并明确标记只有
`sideEffect=none` 且 `replayPolicy=reuse-result` 的工具可安全回放；不会自动执行外部副作用。
`POST /api/runs/compare` 对两次运行比较输出 hash、成功率、耗时、token 和模型/工具调用差异，
用于模型或技能版本的离线质量评估。模型审计写入统一经过敏感字段脱敏和长度截断，
回放 fixture 基于治理后的文本生成 hash；现有 `model_calls` 最近 2000 条保留上限继续生效。

日志页面和技能页 Agent 运行历史已增加“查看 Run Trace”入口：任务日志在存在 `root_run_id` 时可打开运行详情弹窗，
展示 Workflow/Agent Run、阶段事件、Model Call、Tool Audit 和 Checkpoint；原有 `/api/logs`
平铺列表与模型调用展开保持不变。

本轮已推进控制台 Phase 4 P0：日志页增加运行 ID/阶段/消息搜索与状态筛选；能力页提供 Capability 受控测试；
技能详情提供 JSON 测试输入和 `test run` 结果，测试 Run 只做契约/必需能力前置检查，不写入正式产物；
Run Trace 增加取消、恢复预检和失败阶段重试入口。恢复与重试在服务端会重新校验 checkpoint、能力和快照，
实际继续执行仍需由原业务入口提交原始输入上下文，避免控制台误启动不完整业务 Run。

随后推进 P1：根 Run Trace 增加 events、stages、model-calls、tool-calls、artifacts 独立查询，并按 Run 的批次/候选关联产物；
Trace 弹窗接入 Replay Fixture、两次 Run Compare 和治理操作；日志页增加模型调用条数、模型留存天数、工具审计留存天数配置及立即清理入口。
