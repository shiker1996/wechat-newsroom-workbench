# Agent Harness 可观测性与 Run Trace 演进方案

> 状态：分阶段实施中；Agent Run 已支持持久化事件、步骤、checkpoint 聚合的只读 Trace 查询、运行关联、活动取消和三个对话入口的 `resumeFrom`；Phase 6 已增加跨业务 Workflow Trace、指标、Replay fixture、运行对比查询，以及模型审计文本脱敏和截断治理；日志页面和技能运行历史已接入 Run Trace 详情入口。P1 已增加 Trace 子资源、Artifact 聚合、Replay/Compare 页面入口和可配置日志留存清理。长期归档和完整业务重放仍可继续演进。  
> 范围：任务日志、Agent Run、Skill Stage、模型调用、工具执行、Checkpoint、Replay 和日志控制台  
> 原则：保留现有日志能力和页面入口，通过统一运行关联和层级 Trace 增强可追溯性，不把所有日志强行合并成一张表。

> 控制台后续方案：[控制台与能力治理方案](./agent-harness-console-and-capability-governance-plan.md)

## 1. 背景与现状

当前项目已经形成了多层日志和审计基座：

```text
ai_runs              任务级日志
agent_runs           Agent 运行级日志
model_calls          模型调用级日志
agent_tool_calls     Agent 工具调用级日志
tool_executions      插件实际执行日志
source_runs          采集任务级日志
```

当前 `/api/logs` 主要将 `ai_runs`、`source_runs` 和 `model_calls` 合并为平铺列表；模型调用支持展开查看模型、token、耗时、输出、reasoning 和原生工具调用。Agent Run 和 Tool Call 已可单独查询，但尚未在日志页面形成完整的 Workflow → Stage → Skill → Model / Tool 链路。

现有日志不应被视为需要推倒重做的旧系统。它们已经满足基础审计和故障排查，Harness 改造需要解决的是：

1. 一次业务任务的不同日志缺少统一的父子关联；
2. 普通任务进度和底层模型 / 工具细节混在同一个平面；
3. Skill Stage、Agent Step 和 Model Call 没有统一的运行层级；
4. 进程重启后已有审计，但没有与 checkpoint / resume 形成完整闭环；
5. 大段 Prompt、输出和 reasoning 的留存、脱敏和保留周期尚未按运行类型统一治理。

## 2. 目标日志模型

目标不是“只有一张日志表”，而是保留不同层级的事实，并通过统一 Run ID 串联：

```text
Workflow Run：文章排版任务
  ├─ Stage：design
  │   ├─ Skill：magazine-design-advisor
  │   │   └─ Model Call
  │   └─ Gate：design-output
  ├─ Stage：images
  │   ├─ Tool：mermaid-render
  │   └─ Tool：cdn-upload
  ├─ Stage：draft
  │   └─ Deterministic Stage
  └─ Stage：gate
      └─ Gate Result
```

对话 Agent：

```text
Workflow Run：editorial
  └─ Agent Run：editorial-room-chat
      ├─ Model Step 1
      │   └─ Tool Call：web-search
      ├─ Model Step 2
      │   └─ Tool Call：form-update
      └─ Final Result
```

### 2.1 四层可观测性

| 层级 | 面向对象 | 主要内容 |
|---|---|---|
| Workflow Log | 普通用户 | 任务进度、阶段状态、业务错误和最终结果 |
| Run Trace | 编辑 / 高级用户 | Workflow、Stage、Skill、Agent Step 和 Tool 的完整链路 |
| Model Audit | 工程和调试 | provider、model、输入输出摘要、token、耗时、reasoning 和模型错误 |
| Tool Audit | 工程和安全 | capability、plugin、版本、权限、参数摘要、执行结果和副作用 |

### 2.2 对象职责

```text
Workflow Log
  说明“业务任务现在进行到哪里”

Run Trace
  说明“一次运行由哪些阶段、技能、模型和工具组成”

Model Audit
  说明“模型具体调用了什么，返回了什么”

Tool Audit
  说明“哪个能力通过哪个实现被执行，是否被授权”
```

四层保留独立查询和保留策略，但必须可以通过 `rootRunId` 或 `workflowRunId` 互相跳转。

## 3. 现有日志与目标日志映射

| 当前对象 | 当前作用 | 目标作用 | 处理方式 |
|---|---|---|---|
| `ai_runs` | 批次级 AI 任务和进度 | Workflow Log | 保留，增加根 Run 关联和阶段摘要 |
| `agent_runs` | Agent 生命周期、步数和工具次数 | Agent Run | 保留，增加父 Run、Stage 和 Snapshot 关联 |
| `model_calls` | 每次模型调用审计 | Model Audit | 保留，增加 Run / Step / Skill 关联 |
| `agent_tool_calls` | Agent 请求的工具调用 | Tool Call Trace | 保留，增加 Workflow / Stage / Attempt 关联 |
| `tool_executions` | 插件解析和实际执行 | Tool Audit | 保留，增加 Agent Tool Call 关联 |
| `source_runs` | 采集源执行 | Workflow / Source Log | 保留，通过 Workflow Run 关联 |
| 内存 `job.logs` | 实时进度和 thinking 文案 | 临时进度缓存 | 保留实时用途，关键里程碑持久化 |
| 阶段 JSON / manifest | Pipeline 阶段和 Skill hash | Stage Result / Snapshot | 保留，统一引用 Run 和 Artifact |

## 4. 统一关联字段

目标是让底层记录能追溯到一次完整运行。字段可以分阶段增加，不要求一次性重建历史数据。

### 4.1 核心关联字段

```text
root_run_id              根 Workflow Run
workflow_run_id          当前 Workflow Run
run_id                   当前 Skill / Agent Run
parent_run_id            父 Run，用于子 Skill 或子 Agent
stage_id                 Workflow 阶段
skill_id                 使用的 Skill
step_id                  Agent Model Step 或 Stage Step
model_call_id            关联模型调用
tool_call_id             关联 Tool Call
generation_snapshot_id   Skill、工具和模型快照
attempt                  当前阶段或工具尝试次数
sequence                 同一 Run 内的事件顺序
```

### 4.2 建议的关系

```text
workflow_runs.root_run_id
  ├─ ai_runs.workflow_run_id
  ├─ agent_runs.workflow_run_id
  ├─ stages.workflow_run_id
  ├─ model_calls.workflow_run_id
  ├─ agent_tool_calls.workflow_run_id
  └─ tool_executions.workflow_run_id
```

Agent 内部：

```text
agent_runs.id
  ├─ agent_steps.agent_run_id
  ├─ model_calls.agent_run_id / step_id
  └─ agent_tool_calls.agent_run_id / step_id
        └─ tool_executions.agent_tool_call_id
```

如果第一阶段不新增 `workflow_runs` 表，也可以先使用 `ai_runs` 或新建轻量 `run_roots` 作为兼容根记录；最终语义必须统一为根 Run + 子 Run。

## 5. 目标 Run 生命周期

```text
created
  → queued
  → running
  → waiting_tool
  → waiting_confirmation
  → checkpointed
  → completed
  → failed
  → cancelled
  → resumable
```

每次状态变更产生一个轻量 `RunEvent`：

```js
{
  rootRunId,
  runId,
  sequence,
  type: 'stage.completed',
  stageId: 'design',
  skillId: 'magazine-design-advisor',
  status: 'completed',
  message: '设计方案已生成',
  createdAt
}
```

不建议把每个流式 token 都写入 SQLite。实时 delta 仍通过 NDJSON 传输；数据库只保存：

- 阶段开始和完成；
- 模型调用开始和完成；
- Tool requested / completed / failed；
- checkpoint；
- 门禁结果；
- 最终结果和错误。

## 6. 任务日志与模型日志的保留策略

### 6.1 任务日志

继续保留：

- queued / running / completed / failed；
- 任务当前进度；
- 用户可理解的业务错误；
- 批次、候选和产物关联；
- 失败后是否可重试或恢复。

任务日志不应直接充满完整 Prompt、原始 HTML 或长篇 reasoning。它只展示摘要，并链接到 Run Trace 或 Model Audit。

### 6.2 模型日志

继续保留：

- provider / model / purpose；
- prompt、completion、reasoning 和估算 token；
- latency、finish reason 和压缩状态；
- 输出文本和原生 tool call；
- generation snapshot；
- 错误和重试信息。

增加治理：

- 大文本优先转文件或压缩，数据库保存摘要和 hash；
- Prompt 中的凭据、路径和敏感内容脱敏；
- retention policy 可按日志类型配置；
- reasoning 在 UI 中标注为 provider reasoning / thinking，不视为事实来源；
- replay 需要保留足够的输入摘要、工具结果和 Skill Snapshot。

### 6.3 工具日志

Tool Audit 至少包含：

```text
capability
plugin / version
consumerId
workflowRunId / agentRunId
stageId / stepId
sideEffect / replayPolicy
input summary
authorization result
external write authorization
duration
output summary
error code
resolution id
```

参数默认保存摘要，不默认保存凭据、完整本地文件内容或不必要的敏感结果。

## 7. API 与页面演进

### 7.1 兼容现有接口

现有接口继续作为平铺兼容视图：

```text
GET /api/logs
GET /api/jobs/:id
```

它们继续返回任务、采集和模型日志，现有日志页面无需立即重写。

### 7.2 新增 Trace 查询

目标增加：

```text
GET /api/runs/:rootRunId
GET /api/runs/:rootRunId/events
GET /api/runs/:rootRunId/stages
GET /api/runs/:rootRunId/model-calls
GET /api/runs/:rootRunId/tool-calls
GET /api/runs/:rootRunId/artifacts
POST /api/runs/:rootRunId/retry
POST /api/runs/:rootRunId/resume
POST /api/runs/:rootRunId/cancel
```

第一阶段可以只增加只读接口，不引入恢复操作。

### 7.3 日志页面目标

现有日志页面继续显示平铺列表；新增运行详情入口：

```text
任务日志
  → 打开 Run Trace
      → Workflow
          → Stage
              → Skill / Agent Step
                  → Model Call / Tool Call
                      → Gate / Artifact
```

建议筛选维度：

- 日志类型：task / run / model / tool / source；
- Workflow / Stage / Skill；
- provider / model；
- capability / plugin；
- batch / candidate；
- status；
- time range；
- resumable / failed。

## 8. 分阶段实施

### Phase 0：保持现状并冻结兼容

**目标**：不改变现有任务日志和模型日志的页面行为。

工作内容：

- 保留 `ai_runs`、`agent_runs`、`model_calls`、`agent_tool_calls`、`tool_executions`；
- 固定 `/api/logs` 返回字段；
- 为主要入口建立日志关联测试；
- 记录现有日志保留和截断规则；
- 定义 `rootRunId` / `workflowRunId` 的兼容映射方案。

验收：

- 现有日志页面无需修改；
- 现有模型详情仍可展开；
- 任务进度、错误和模型审计不丢失。

### Phase 1：补齐关联 ID

**目标**：不改变日志内容，先让不同日志可以串联。

工作内容：

- 增加 `workflowRunId`、`rootRunId`、`stageId`、`stepId`、`attempt`；
- 在 Gateway、Agent Runtime、Tool Broker 和 Pipeline 之间透传关联上下文；
- 给 `model_calls` 增加 Agent / Stage 关联；
- 给 `tool_executions` 增加 Agent Tool Call 关联；
- 历史数据保持可读，不强制补造不存在的关系。

验收：

- 给定一个任务 ID，可以定位关联的模型和工具记录；
- 给定一个模型调用，可以反查 Skill、Stage 和 Workflow；
- 新增关联不影响现有查询。

### Phase 2：Run Trace 只读查询

**目标**：增加统一的运行详情接口和页面展开视图。

工作内容：

- 增加根 Run 和子 Run 查询；
- 增加 Stage、Model Call、Tool Call、Artifact 聚合查询；
- 日志页面增加“打开运行详情”；
- 支持按 Workflow / Stage / Skill / Tool 筛选；
- 继续保留 `/api/logs` 平铺兼容视图。

验收：

- 一个排版任务可展示完整阶段链；
- 一个编辑会可展示完整 Agent Step 和工具链；
- 模型原始详情仍可从 Trace 下钻查看。

### Phase 3：事件与 Checkpoint

**目标**：让日志从“事后记录”升级为“运行状态来源”。

工作内容：

- 增加 `run_events` / `agent_steps` / `checkpoints`；
- 阶段、模型、工具和门禁产生统一里程碑事件；
- 进程重启后通过 checkpoint 判断是否可恢复；
- 增加 retryable、resumable、cancelled 状态；
- 实时 NDJSON 事件和持久化事件使用同一事件类型映射。

验收：

- Run Trace 能显示每个阶段的状态变化；
- 重启后可识别可恢复 Run；
- 未完成工具不会被无条件重复执行。

### Phase 4：日志治理与 Replay

**目标**：支持长期运行、问题复现和质量评估。

工作内容：

- 日志 retention、脱敏、压缩和归档策略；
- Prompt / output / reasoning 的摘要与 hash；
- 固定 Skill Snapshot、模型响应和 Tool Result 的 replay；
- 运行成本、延迟、工具成功率和门禁失败率统计；
- 失败运行的 replay / retry 对比。

验收：

- 在不暴露敏感数据的前提下复现关键失败；
- 可以比较不同 Skill、模型和工具版本的运行结果；
- 旧日志仍可通过兼容页面查询。

## 9. 与 Agent Harness 演进主方案的关系

本文是主方案的可观测性和控制台后续，不改变主方案的核心职责边界：

```text
Workflow
  决定业务流程和阶段顺序

Harness
  负责 Run、Skill、Model、Tool 的统一执行和状态

Run Trace
  负责把一次执行过程完整串联和解释

Feature
  负责领域门禁、业务结果和产物
```

日志改造不应导致：

- 将任务日志和模型日志合成一张不可区分的表；
- 把全部 Prompt 和 reasoning 默认展示给普通用户；
- 把实时 token 全量持久化；
- 让日志页面承担业务流程决策；
- 为了 Trace 而改变现有页面发送、轮询和流式交互。

## 10. 完成定义

满足以下条件即可认为日志侧 Harness 改造完成：

1. 任务、Run、模型和工具日志仍可独立查询；
2. 所有新运行都能通过根 Run 串联完整链路；
3. `/api/logs` 和现有日志页面保持兼容；
4. Run Trace 能从 Workflow 展开到 Stage、Skill、Model、Tool 和 Artifact；
5. Model Audit 和 Tool Audit 保留原始排查价值，同时有脱敏和保留策略；
6. Checkpoint、Resume 和 Replay 能复用同一套运行关联；
7. 普通用户看到的是任务进度，高级用户才需要进入底层 Trace；
8. 日志记录不会反过来取代 Workflow 或 Feature 的业务职责。
