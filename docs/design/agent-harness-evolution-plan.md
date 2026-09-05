# Agent Harness 演进方案

> 状态：分阶段实施中；Phase 3 的统一运行准备与门禁已接入，Phase 4 已接入 SQLite 持久化、checkpoint、租约续跑、业务状态重建和幂等工具结果复用，Phase 5 已完成主要业务 Pipeline 与批次 Job 的 Harness 迁移，Phase 6 已完成基础 Trace/Replay/Eval 能力。完整业务副作用重放和长期日志治理仍可扩展。详见 [实施记录](./agent-harness-implementation-status.md)。  
> 适用范围：`server/platform/agent`、`server/platform/llm`、`server/platform/tools`、`server/platform/skills` 以及 articles / social-cards / batches 的 Agent 与 Pipeline 消费者  
> 原则：保持现有页面和业务流程可用，在现有本地模块化单体内逐步建立可复用的 Agent Harness 内核，不立即引入外部 Agent 框架或拆分微服务。

> 后续方案：[可观测性与 Run Trace 演进方案](./agent-harness-observability-and-run-trace-plan.md)

> 控制台后续方案：[控制台与能力治理方案](./agent-harness-console-and-capability-governance-plan.md)

## 1. 背景与判断

当前项目已经具备 Agent Harness 的重要组成：

- `runConversationAgent` 提供模型循环、工具调用、并行限制、重复调用限制、超时、上下文压缩、事件流和运行审计；
- `tool-catalog`、`tool-executor` 和 `ToolRegistry` 提供能力目录、输入输出校验、权限策略、插件解析、fallback 和执行日志；
- `skill-runtime`、`entry-routing` 和 generation snapshot 提供技能加载、入口契约、工具白名单以及 Prompt、工具和模型版本冻结；
- Agent Run、Tool Call、AI Run 和模型调用已写入 SQLite，页面通过 NDJSON 事件消费运行过程。

当前的主要问题不是缺少模型调用能力，而是运行时概念尚未完全收敛：

1. Skill 主要仍是 Prompt / references 包，和可执行的 Agent Run 之间没有统一入口；
2. Agent、Pipeline Stage、Skill 和 Tool 的生命周期与契约分散在不同模块；
3. 工具执行已经较统一，checkpoint、resume 和幂等基础已接入，但 Trace/Replay 评测闭环仍待建设；
4. 部分业务 adapter 仍承担运行时组装工作；
5. 页面、路由和 Agent runtime 之间的事件契约尚未被定义为稳定的版本化协议。

因此，目标不是把所有 Skill 变成 Tool，也不是把所有 Pipeline 改造成 Agent，而是建立四种对象的清晰分工：

```text
Skill      = 指令、方法、输入输出契约和运行策略
Agent      = 在 Harness 中执行 Skill 的多轮运行实例
Tool       = 具有 Schema、权限和副作用边界的执行能力
Workflow   = 由业务代码控制的确定性阶段编排
```

## 2. 目标架构

```text
前端与现有页面
      ↓
HTTP / NDJSON 兼容接口
      ↓
Feature Application
  ├─ 确定性 Workflow / Pipeline
  └─ Agent Adapter
      ↓
Agent Harness
  ├─ Run Lifecycle / State Machine
  ├─ Skill Resolver
  ├─ Model Event Adapter
  ├─ Context / Budget Manager
  ├─ Tool Broker
  ├─ Policy / Permission
  ├─ Checkpoint / Resume
  ├─ Trace / Audit
  └─ Replay / Eval
      ↓
LLM Gateway / Capability Registry / SQLite
```

### 2.1 Harness 的边界

Harness 负责：

- 创建、运行、取消、恢复和完成 Agent Run；
- 加载并冻结 Skill、模型、工具和配置版本；
- 统一模型文本、思考、工具调用和完成事件；
- 管理上下文压缩、模型步骤、工具次数和时间预算；
- 构造每次 Run 的工具授权 Scope；
- 通过 Tool Broker 执行工具并记录 provenance；
- 保存步骤、事件、checkpoint 和错误；
- 支持固定输入、工具结果和模型响应的 replay / eval。

Harness 不负责：

- 文章、选题、图文的领域判断；
- 业务表单状态的解释；
- 事实是否足以支持某个具体内容结论；
- 业务 Pipeline 的阶段顺序；
- 页面布局和业务交互文案。

### 2.2 Skill 的目标模型

Skill Manifest 逐步统一为：

```json
{
  "id": "editorial-room-chat",
  "kind": "agent-skill",
  "entryPoints": ["editorial"],
  "inputContract": "candidate_context",
  "outputContract": "editorial_decision",
  "requiredCapabilities": ["cap_content_web_search"],
  "optionalCapabilities": [],
  "budget": {
    "maxModelSteps": 3,
    "maxToolCalls": 5
  },
  "gates": ["editorial-readiness"]
}
```

技能类型：

```text
prompt-skill   只提供指令和 Prompt
stage-skill    作为确定性 Pipeline 的一个阶段
agent-skill    允许多轮模型推理和工具调用
```

第一阶段仍由入口或 Pipeline 选择 Skill。只有出现真实的子任务委托需求时，才增加受限的 `invokeSkill` / 子 Run，不把动态技能调用作为默认路径。

### 2.3 Tool 的目标模型

```js
{
  capability: 'cap_content_web_search',
  inputSchema: {},
  outputSchema: {},
  riskLevel: 'network-read',
  sideEffect: 'none',
  timeoutMs: 30000,
  idempotent: true,
  requiresConfirmation: false,
  implementation: {
    plugin: 'tavily-search',
    version: '1.0.0'
  }
}
```

Tool Broker 统一负责：

```text
tool_call
  → Scope 校验
  → 输入 Schema 校验
  → 资源、路径和权限校验
  → external-write / confirmation 检查
  → 实现解析与执行
  → 输出 Schema 校验
  → provenance、耗时和结果摘要记录
  → 结果回填模型上下文
```

## 3. 现状到目标的映射

| 当前实现 | 目标职责 | 处理方式 |
|---|---|---|
| `conversation-agent.mjs` | Agent Run Engine | 保留核心逻辑，增加统一契约和状态管理 |
| `skill-runtime.mjs` | Skill Resolver / Prompt Provider | 保留文件加载，补齐 Skill 类型和运行契约 |
| `entry-routing.mjs` | Skill 与入口契约解析 | 继续负责入口兼容和技能选择 |
| `tool-catalog.mjs` | Tool Scope / Grant Builder | 统一每次 Run 的能力授权 |
| `tool-executor.mjs` | Tool Broker | 收敛工具生命周期、幂等、确认和审计 |
| `platform/tools/registry.mjs` | Capability Implementation Registry | 继续负责插件解析、fallback 和实际执行 |
| `agent-run-repository.mjs` | Run Store / Checkpoint Store | 增加步骤、事件、checkpoint 和恢复信息 |
| Feature Agent adapter | 领域适配层 | 只保留业务上下文、状态更新和结果解释 |
| Article / Social / Batch Pipeline | Workflow 消费者 | 保留确定性阶段，不强制 Agent 化 |

第一阶段不做大范围目录迁移。先通过 Facade 形成逻辑边界，稳定后再决定是否将 `platform/agent` 重命名为 `platform/harness`。

## 4. 分阶段实施

### Phase 0：基线冻结与兼容契约

**目标**：固定现有行为，确保后续改造是内部替换。

**工作内容**：

- 盘点编辑会、自主写作、自定义图文、AI 视觉文档及其他 Agent 入口；
- 固定现有路由、请求体、`done.data` 和错误语义；
- 将 NDJSON 事件定义为版本化协议：

  ```text
  tool.requested
  tool.running
  tool.completed
  tool.failed
  tool.needs_confirmation
  assistant.delta
  assistant.thinking
  agent.limit
  done
  error
  ```

- 为每个 Agent 入口建立最小 replay fixture；
- 增加页面交互兼容测试和事件顺序测试；
- 记录 generation snapshot、工具白名单和 Skill 选择的现状语义。

**验收标准**：

- 现有页面无需修改；
- 现有路由 URL 和请求格式不变；
- `reply`、`formUpdates`、`ready`、`missing`、`agentRunId`、`toolCalls` 等字段不删除；
- 全量测试和定向 Agent 测试通过。

### Phase 1：建立 Harness Facade

**目标**：为不同类型的 Skill 提供统一运行入口，不改变现有行为。

新增统一接口：

```js
runSkill({
  skillId,
  entryPoint,
  input,
  context,
  policy,
  budget,
  snapshotId
})
```

内部按类型分流：

```text
prompt-skill → Prompt + Gateway
stage-skill  → Pipeline Stage
agent-skill  → runConversationAgent
```

增加或固化以下契约：

```text
AgentRunRequest
AgentRunResult
AgentEvent
SkillDefinition
ToolDefinition
RunPolicy
RunBudget
```

**实施方式**：

- 保留 `runConversationAgent`；
- 新增 Facade 包装现有实现；
- 让现有 Feature adapter 先通过 Facade 调用；
- 路由继续调用原有 adapter，不改页面入口。

**验收标准**：

- 所有 Agent 都能通过统一 Facade 启动；
- 事件、结果字段和页面行为不变；
- 不出现第二套工具执行逻辑。

### Phase 2：统一 Tool Broker

**目标**：将工具目录、权限、执行、结果校验和审计收敛为 Harness 的统一 Tool Broker。

**工作内容**：

- 为每次 Run 创建带 Scope 的工具目录；
- 为工具补齐 risk、sideEffect、timeout、idempotent 和 confirmation 元数据；
- 统一 native tool call、旧 JSON envelope 和 Responses function call 的转换；
- 统一工具生命周期事件和错误码；
- 所有 Agent 工具调用必须经过 Broker，禁止 adapter 绕过授权直接执行；
- 保留 `ToolRegistry` 的插件解析、fallback 和能力实现职责。

内部事件统一为：

```text
model.text
model.thinking
tool.requested
tool.running
tool.completed
tool.failed
run.completed
run.failed
```

**验收标准**：

- 所有 Agent 工具调用都经过同一 Broker；
- native 和 legacy 协议可以转换到同一事件模型；
- 权限拒绝、超时、依赖缺失和输出非法具有统一错误码；
- 工具执行 provenance 与调用摘要可查询。

### Phase 3：统一 Skill Runtime

**目标**：让 Skill 从“Prompt 文件”升级为带契约的可运行定义。

**工作内容**：

- 统一 Skill Manifest 的 `kind`、入口、输入输出契约和能力声明；
- Skill Resolver 负责版本、配置、Prompt、工具 Scope 和门禁；
- 将 Prompt、模型、工具、配置和门禁一起写入 generation snapshot；
- 文章标题、审稿、humanizer、SEO 等技能以 `stage-skill` 接入；
- 编辑会、自主写作和视觉文档以 `agent-skill` 接入；
- 删除 Feature 中重复的 Skill 选择和运行时策略组装。

第一阶段不默认支持模型动态调用其他 Skill。若后续需要，使用受限的子 Run：

```text
parent Skill
  → invoke child Skill
  → child 使用更窄的输入、工具和预算
  → child 返回结构化结果
  → parent 继续运行
```

**验收标准**：

- 每个 Skill 都有明确输入和输出契约；
- Skill 的 Prompt、模型、工具和配置可以一起冻结；
- Feature 代码不再重复维护 Skill 运行规则；
- Skill 缺少能力时在运行前明确失败。

### Phase 4：持久化 Run、Checkpoint 与恢复

**目标**：从“可审计”升级为“可恢复”。

当前已有 Agent Run、Tool Call、AI Run、generation snapshot 和执行日志；本阶段增加：

```text
Agent Step
Checkpoint
Run Event
Resume Token
Idempotency Key
```

建议的运行状态：

```text
created
  → running
  → waiting_tool
  → waiting_confirmation
  → checkpointed
  → completed
  → failed
  → cancelled
  → resumable
```

Checkpoint 时机：

- 模型步骤完成后；
- 一组工具执行完成后；
- Pipeline 阶段完成后；
- 等待人工确认前；
- 外部写入前。

第一版只做本地 SQLite 恢复，不引入分布式队列。

**验收标准**：

- 进程重启后可恢复可恢复 Run；
- 已完成工具不会被无条件重复调用；
- 不可重复副作用具有幂等保护；
- 取消、重试和恢复不会破坏现有产物。

### Phase 5：迁移业务消费者

**目标**：让 Feature 保留领域逻辑，Harness 接管运行时逻辑。

建议顺序：

1. 编辑会；
2. 自主写作；
3. 自定义图文；
4. AI 视觉文档；
5. 文章 Pipeline 的阶段技能；
6. 社交卡 Pipeline；
7. 批次 AI Job。

迁移后，Feature Adapter 只负责：

```text
业务上下文
领域状态更新
表单更新
业务结果解释
业务门禁
```

Harness 负责：

```text
模型调用
上下文压缩
工具授权
工具执行
预算
事件
审计
恢复
```

确定性 Pipeline 仍由业务 Workflow 控制，例如：

```text
brief → fact-base → planning → drafting → review → seo → final-gate
```

只有确实需要多轮推理和工具调用的阶段才使用 `agent-skill`。

**验收标准**：

- `platform/agent` 不包含文章、图文等领域判断；
- Feature adapter 明显变薄；
- 路由只负责请求解析、流式输出和响应映射；
- 全部消费者使用统一 Run 和 Tool 事件。

### Phase 6：Replay、Eval 与可选 SDK

**目标**：让 Harness 能够持续演进并支持质量比较。

增加：

- Agent contract tests；
- 工具调用 replay；
- 固定模型响应 fixture；
- 工具超时、权限越界和预算耗尽测试；
- 事实门禁和输出契约测试；
- 不同模型或 Skill 版本的回放比较；
- 运行耗时、工具成功率、重试率和门禁失败率指标。

只有在出现第二个产品、第三方 Agent 或独立版本管理需求时，才将 Harness 抽成独立 package 或 SDK。

## 5. 页面与 API 兼容策略

Phase 0 至 Phase 5 默认遵守以下兼容边界：

- 路由 URL 不变；
- 请求体结构不变；
- 现有 NDJSON 事件名称不变；
- `done.data` 的现有字段不删除；
- 新事件只允许追加，旧页面可以忽略未知事件；
- 表单更新、`ready` 和 `missing` 语义不变；
- Agent 限额和错误仍映射为现有 `agent.limit` / `error` 事件。

因此，第一阶段 Harness 改造应表现为内部运行时替换，而不是页面交互重做。

Phase 4 之后可以增量增加：

- 继续执行；
- 从上一步重试；
- 查看本次运行；
- 取消运行；
- 工具写入确认。

这些是新增能力，不是 Harness 改造的前置条件。

## 6. 优先级与完成定义

```text
P0：Phase 0 + Phase 1
    固定契约，建立统一运行入口，不改变行为

P1：Phase 2 + Phase 3
    统一工具执行和技能运行模型

P2：Phase 4
    增加 checkpoint、恢复、取消和幂等

P3：Phase 5 + Phase 6
    迁移全部消费者，建立评测体系，按需要抽 SDK
```

Harness 改造完成的判断标准不是“是否使用了某个 Agent 框架”，而是：

1. 每次 Agent 运行都有统一的 Run；
2. 每个 Skill 都有明确的输入、输出和能力契约；
3. 每个 Tool 都经过统一授权、校验和执行；
4. 每次运行都可以审计、恢复和复现；
5. Feature 不再重复实现模型循环、工具策略和运行时状态管理；
6. 现有页面无需为了内部 Harness 重构而重写。

最终目标：

> 保留现有内容生产业务架构，把 Agent 的运行生命周期、技能调用、工具执行、权限、恢复和评测收敛为一个稳定的内部 Harness。
