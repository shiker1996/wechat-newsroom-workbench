# agent

## 职责

Agent 运行时、工具调用和会话协调基础设施。

## Harness 入口

生产 Agent 统一调用 `harness.mjs` 的 `runSkill`，内部仍使用
`runConversationAgent` 和 `tool-broker`（tool-executor 保留兼容导出）。迁移期间保留引擎顶层参数；
新调用可把引擎依赖放在 `context` 中：

```js
await runSkill({
  skillId: 'editorial-room-chat',
  entryPoint: 'editorial',
  context: { gateway, modelStep, messages, registry, catalog, store, toolContext, onEvent },
  budget: { maxModelSteps: 3, maxToolCalls: 5 },
});
```

`definition.kind` 支持 `agent-skill`、`prompt-skill` 和 `stage-skill`。
尚未提供 definition 的生产会话调用从 workspaceRoot 加载技能，由统一 Resolver
生成 agent-skill 定义；没有 workspaceRoot 的注入式调用保留原兼容行为。
Manifest 的领域 kind（writer、reviewer 等）与 runtimeKind、agentEntryPoints 分离。
prompt-skill 使用已解析 messages 和
`context.gateway.complete`；stage-skill 调用业务 Workflow 提供的
`context.executeStage`，将 input 原样传入，保留阶段结果。

`policy.allowedCapabilities` 只能收窄目录。显式空数组禁止全部工具，
definition.requiredCapabilities 不满足时在模型执行前失败。
事件描述见 `events.mjs` 的 `AGENT_EVENT_PROTOCOL`；NDJSON 对象不新增强制字段。

提供 Gateway 的 Agent 由 Harness 统一准备 generation snapshot，保存本次实际消息、
技能配置、目录、预算、模型/阶段模型和门禁绑定。modelStep 从参数中的 gateway 调用模型；
该 Gateway 自动绑定快照 ID、运行信号和收窄后的原生工具定义。现有生产 adapter 已接入。

指定 snapshotId 默认从 Store 读取并验证任务、候选、技能及入口归属；
仍支持 context.resolveSnapshot 注入已解析快照。复用快照会创建新的 Run，
历史模型、工具或门禁版本不可用时拒绝替换。checkpoint 是另一条恢复路径：
会话 Agent 从工具组完成后的步骤继续，Workflow 的 stage-skill 从失败或中断的阶段重新执行。

## Tool Broker 与 Skill 定义

Broker 统一执行目录授权、模型参数 Schema 校验、资源解析、路径策略、确认门禁、
输出 Schema 校验与超时/取消。Registry 保留插件解析、fallback 和每次尝试的日志；
Broker 补充业务 handler、缓存和执行前失败的日志。模型参数先按模型可见的 Schema
校验，再将资源 ID 解析为实际路径；插件仍按实现 Schema 校验解析后的参数。

工具目录包含 riskLevel、sideEffect、timeoutMs、idempotent、requiresConfirmation、
outputSchema 和 pathInputs。默认外部写入拒绝执行并发送 tool.needs_confirmation；
恢复时只有显式 confirmedCapabilities 中的工具可以继续。已完成且声明为幂等的工具
按幂等键跨 Run 复用结果，不自动重放未确认的外部写入。超时向执行器传递 AbortSignal；
不支持协作取消的 handler 可能继续其已开始的工作，因此不会自动重试写入。

`onInternalEvent` 可接收版本化 model.text/model.thinking/run.completed/run.failed
等内部事件；`onEvent` 继续输出旧页面协议。model-events 统一原生、Chat Completions
和 Responses function call 参数，非法 JSON 在工具执行前失败。

generation snapshot 的 skills[].definition 保存运行类型、输入输出契约、能力、预算
和门禁名称；历史快照优先恢复该定义。prepareSkillRun 在保存快照前检查必需能力。
通过 gateHandlers 注册 {version, phase, check} 门禁；phase 为 input 或 output。
缺失注册在模型执行前失败，输出门禁在 completed/done 之前执行。
Agent 使用 Manifest.agentGates，与阶段技能的 gates 分开。
内置 assistant-reply 检查有效回复；视觉 adapter 注册 visual-document-finished。
领域 readiness、ready/missing 等规则继续由业务代码维护。

## 持久化

SQLite v43 增加 Agent Run → generation snapshot 外键、运行关联字段、agent_steps、agent_run_events、
agent_checkpoints、agent_resume_claims 和 agent_tool_idempotency。Store 提供
listAgentSteps、listAgentRunEvents（支持 afterSequence）、getLatestAgentCheckpoint、
resume 租约和幂等结果读写。事件按 Run 单调编号，步骤按模型/工具/完成阶段排序。
系统只读接口 `/api/system/conversation-agent-runs/:runId/trace` 聚合这些记录、模型审计和 Tool Audit；每条记录可通过 `rootRunId/workflowRunId/stageId` 回到同一条运行链路。
活动 Run 可通过系统接口 `POST /api/system/conversation-agent-runs/:runId/cancel` 取消；取消沿同一个 AbortSignal 传递到模型网关与工具 Broker，并持久化为 `aborted`。
模型调用，支持按事件序号增量查询；Gateway 会把 Agent Run/Step 关联写入 `model_calls`，
现有运行概览和 `/api/logs` 平铺视图保持兼容。

有持久化快照的 Facade 运行默认保存完整 checkpoint；可通过 checkpointing:false 关闭。
checkpoint 包含本次消息、待处理模型响应、预算计数和调用指纹，属于本地运行上下文，
普通工具审计仍只保存摘要。直接使用旧引擎默认不保存完整 checkpoint。
工具组完成后的 checkpoint 标记为 resumable:true，可通过 `runSkill({ resumeFrom })`
从下一模型步骤继续；恢复会使用 SQLite 租约原子占用，同一 checkpoint 的并发恢复会被拒绝。
模型步骤中断或已完成的 checkpoint 不可恢复。恢复前可通过 restoreState 回调重建
业务状态；回调失败会释放租约并阻断运行。跨进程幂等只适用于工具 Manifest 明确标记
为 idempotent 的已完成结果。

## Pipeline 与批次 Job

`server/platform/skills/pipeline-runtime.mjs` 提供 `runPipelineStage` 和
`bindPipelineHarnessGateway`。文章、日报、自主写作、社交卡以及批次级模型阶段通过
`stage-skill` Facade 执行，Workflow 仍控制阶段顺序和领域门禁。每次阶段模型调用会创建
独立 Agent Run，并携带 `rootRunId/workflowRunId/stageId/generationSnapshotId` 写入模型审计。
`AiJobManager` 同时为每个批次 Job 建立 `batch-job:<type>` Run，页面继续读取兼容的 `ai_runs`。
stage-skill 在开始、成功和失败/中断时保存阶段 checkpoint；调用方可将失败阶段 Run ID
作为 `resumeFrom` 传回 `runPipelineStage`，恢复会继承原 Run 的快照和关联，并以新的子 Run
执行阶段，避免覆盖原始失败记录。

模型审计写入前经过 `audit-governance.mjs` 的敏感字段脱敏和长度截断；实时事件仍走 NDJSON，
数据库只保留可排查的文本摘要，避免把凭据、超长 reasoning 或完整工具 payload 扩散到日志查询。

## Replay 与 Eval

`replay.mjs` 提供 `buildRunMetrics`、`buildReplayFixture` 和 `compareRunTraces`，将持久化的
Workflow/Agent Run Trace 转为质量指标、脱敏回放 fixture 和两次运行的离线比较结果。系统接口
`GET /api/runs/:rootRunId[/trace|/metrics|/replay]` 及 `POST /api/runs/compare`（均有
`/api/system` 兼容别名）复用同一份聚合 Trace。回放只复用无外部副作用且声明
`replayPolicy: reuse-result` 的工具结果摘要；完整业务副作用回放仍由业务层另行实现。

## 依赖边界

提供会话、协议、工具目录、工具执行和资源适配基础设施，不包含具体业务 Agent。文章与图文 Agent adapter 位于对应 feature 的 application/agent 目录。

## AI 视觉文档 Agent

`ai-visual-document-agent.mjs` 提供基于 `cap_filesystem_project_read` 与
`cap_filesystem_project_document_write` 的单 Agent 文档生成协议：读取输入、begin、append
分块、finish，再返回 final。它只负责协议编排和画布/输出路径等运行参数，不绑定具体业务
主题或页面尺寸；社交卡和文章封面应通过 feature 层 adapter 注入各自的 skill、输入文件、
画布和输出文件名。
