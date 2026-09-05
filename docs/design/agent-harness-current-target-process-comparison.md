# Agent Harness 现有流程与目标流程对比

> 状态：设计对照文档  
> 关联方案：[Agent Harness 演进方案](./agent-harness-evolution-plan.md)  
> 关联图：[Agent Harness 对象关系图](./agent-harness-relationship-diagram.md)

## 1. 阅读方式

本文不把当前实现描述成“错误实现”。当前项目已经形成了稳定的业务 Pipeline、Skill 包、Tool Registry、Agent Runtime 和审计机制；目标 Harness 的主要工作是把分散的运行时语义统一起来。

比较时区分三种执行模式：

```text
确定性 Workflow     由业务代码控制阶段顺序，适合排版、转图、门禁
单轮 Stage Skill    Workflow 选择 Skill，模型或脚本完成一个阶段
多轮 Agent Skill    Harness 管理模型循环、工具调用和动态决策
```

目标不是把所有流程改成多轮 Agent，而是让三种模式都通过清晰的运行契约接入同一个 Harness。

## 2. 总体流程对比

### 2.1 当前总体流程

```text
用户请求 / 批次任务
        ↓
HTTP 路由或 AI Job Handler
        ↓
业务 Feature Pipeline / Agent Adapter
        ├─ loadSkillBundle()
        ├─ prepareSkillRun()（部分流程）
        ├─ gateway.complete() / streamComplete()
        ├─ executeCapability() / ToolRegistry
        ├─ 业务脚本和门禁
        └─ 写入产物、AI Run 或 Agent Run
        ↓
HTTP JSON / NDJSON / 产物文件
```

### 2.2 目标总体流程

```text
用户请求 / 批次任务
        ↓
Feature Application
        ↓
Workflow 选择执行模式
        ├─ runStage(stageSkill)
        ├─ runSkill(promptSkill)
        └─ runAgent(agentSkill)
        ↓
Harness Facade
        ├─ Skill Resolver
        ├─ Run 创建与 Snapshot
        ├─ Model Event Adapter
        ├─ Context / Budget / Policy
        ├─ Tool Broker
        ├─ Checkpoint / Resume
        └─ Trace / Replay
        ↓
结构化结果 + 业务门禁 + 产物
```

最重要的变化是：

```text
当前：业务代码自行组合“技能 + 模型 + 工具 + 记录”
目标：业务代码声明“要运行什么”，Harness 负责“如何运行”
```

## 3. 各环节逐项对比

### 3.1 请求进入

| 环节 | 当前流程 | 目标流程 |
|---|---|---|
| 入口 | 路由或 AI Job 直接调用业务函数 | 路由 / Job 只构造 `RunRequest`，交给 Feature Application |
| 业务判断 | 路由、Job、Pipeline 共同决定部分运行参数 | Feature Application 统一决定业务上下文和执行模式 |
| 运行模式 | 由调用方隐式决定是 Pipeline、单轮模型还是 Agent | 显式声明 `workflow`、`stage-skill` 或 `agent-skill` |
| 用户可见变化 | 当前页面和按钮已经稳定 | 第一阶段保持不变 |

目标请求可以抽象为：

```js
{
  purpose: 'typeset',
  entryPoint: 'wechat-typeset',
  skillId: 'magazine-design-advisor',
  mode: 'stage',
  input: { renderedMarkdownPath: '...' },
  context: { batchId, candidateId },
  requestedProvider: 'default'
}
```

### 3.2 Skill 解析与选择

| 环节 | 当前流程 | 目标流程 |
|---|---|---|
| 技能发现 | `loadSkillBundle()` 从目录读取 `SKILL.md` | `SkillResolver` 读取 Manifest、版本、配置和入口契约 |
| 技能内容 | Prompt、references、配置覆盖层拼接 | Prompt、执行器、输入输出契约和运行策略统一描述 |
| 技能选择 | `entry-routing` 或 Pipeline 代码选择 | Feature 声明入口，Resolver 返回可运行 Skill Definition |
| 工具需求 | 通过 `requiredCapabilities` / `allowedTools` 间接检查 | Skill 显式声明能力需求，由 Harness 创建 Scope |
| 版本冻结 | generation snapshot 已冻结 Prompt、模型和工具 | 扩展为完整 Skill Run Snapshot，包含执行器、策略和门禁 |

当前将 Skill 作为 Prompt 传给模型本身并不错误。目标只是把它从：

```text
skill.prompt → 拼接 system message
```

提升为：

```text
SkillDefinition
  ├─ prompt provider
  ├─ kind: prompt / stage / agent
  ├─ inputContract
  ├─ outputContract
  ├─ capabilities
  ├─ budget
  └─ gates
```

### 3.3 Run 创建与上下文冻结

| 环节 | 当前流程 | 目标流程 |
|---|---|---|
| Run ID | Agent 有 `agentRunId`，普通 Pipeline 主要以 AI Run 和阶段记录表示 | 所有 Skill、Stage 和 Agent 都有统一 `runId` |
| Snapshot | 部分 Pipeline 使用 `prepareSkillRun()` | 所有运行在开始时冻结 Skill、模型、工具、策略和输入摘要 |
| 上下文 | 各 Pipeline / Adapter 自己组装 messages | Harness 统一管理 protected message、历史、资源引用和预算 |
| 资源 | Adapter 自己组装项目路径、事实和允许根目录 | Run Context 统一表达资源 Scope，不把未授权本地路径暴露给模型 |
| 取消 | Agent 支持 signal；Pipeline 依赖调用方 | Run 生命周期统一支持 cancel、timeout 和终止原因 |

目标运行创建结果：

```text
Run created
  → Skill snapshot frozen
  → Tool scope frozen
  → Model provider resolved
  → Input/context recorded
  → Budget initialized
```

### 3.4 Workflow / Pipeline 调度

| 环节 | 当前流程 | 目标流程 |
|---|---|---|
| 阶段顺序 | 由 `article-pipeline`、`typeset-pipeline`、`social-card-pipeline` 各自控制 | 仍由业务 Workflow 控制，不交给通用 Agent 自由决定 |
| 阶段调用 | 有的直接 `gateway.complete()`，有的执行脚本，有的 `executeCapability()` | 统一使用 `runStage()`、`runSkill()` 或 `callTool()` Facade |
| 业务门禁 | 分散在 Pipeline 函数中 | 业务门禁仍归 Feature；Harness 负责通用契约和运行门禁 |
| 失败处理 | 各 Pipeline 自己决定重试、返工或停止 | Workflow 声明 failure policy，Harness 提供标准重试和状态 |
| 产物关系 | 各 Pipeline 写自己的阶段文件和 manifest | Run 输出引用统一的 Artifact / Stage Result |

目标 Workflow 仍然是显式的：

```text
typeset Workflow
  → runStage(rendered)
  → runStage(design)
  → callTool(images)
  → runStage(draft)
  → runStage(normalized)
  → runStage(gate)
```

### 3.5 模型调用

| 环节 | 当前流程 | 目标流程 |
|---|---|---|
| 调用入口 | Pipeline 和 Agent Adapter 都可能直接调用 Gateway | Harness 统一调用 Model Adapter |
| 协议 | `complete`、`streamComplete`，兼容 native tool call 和旧 envelope | 内部统一为模型事件流，协议差异留在 Adapter |
| 输入 | 各业务自行拼接 system / user message | Harness 根据 Skill、Context 和 Run Policy 组装 |
| 输出 | 有的返回文本，有的 JSON，有的 tool call | 统一为 `model.text`、`model.thinking`、`tool.call`、`model.done` |
| 预算 | 部分通过 output budget，Agent 有独立预算 | Run 统一管理 token、步骤、工具、时间和结果字符预算 |

目标内部事件示例：

```text
model.started
model.thinking
model.text
model.tool_call
model.completed
model.failed
```

### 3.6 Tool 调用与执行

| 环节 | 当前流程 | 目标流程 |
|---|---|---|
| 工具发现 | Agent 根据 entry capabilities 构建 catalog | Harness 根据 Skill Scope 和 Run Policy 构建 Tool Scope |
| 模型调用 | native function tool 或旧 JSON envelope | 统一转换为内部 `ToolCallRequest` |
| 参数处理 | Adapter 可注入 `resolveArguments` | Harness 统一做资源解析、参数校验和授权 |
| 执行 | `executeConversationTool()` 或 `executeCapability()` | 全部经过 Tool Broker |
| 插件解析 | `ToolRegistry` 解析候选、配置和 fallback | Registry 保留实现解析，Broker 负责运行生命周期 |
| 输出处理 | Adapter 可注入结果清洗 | 统一输出 Schema、摘要、provenance 和回填策略 |
| 外部写入 | 已有 `authorizedExternalWrite` 语义，但调用路径仍需收敛 | 写入能力必须有 Scope、确认、幂等键和审计 |

目标 Tool Broker 流程：

```text
ToolCallRequest
  → capability visible?
  → input schema valid?
  → resource / path allowed?
  → side effect allowed?
  → confirmation required?
  → idempotency check
  → resolve implementation
  → execute
  → output schema validate
  → persist trace
  → return ToolResult
```

### 3.7 Agent 多轮循环

| 环节 | 当前流程 | 目标流程 |
|---|---|---|
| 循环实现 | `runConversationAgent()` 已支持多轮循环 | 保留并升级为统一 Run Engine |
| 结束方式 | final JSON 或 `cap_agent_conversation_finish` | 统一 `RunResult`，结束工具作为一种完成信号 |
| 历史 | `compactAgentHistory()` 压缩消息 | Context Manager 统一管理摘要、保护消息和资源引用 |
| 重复调用 | 有重复工具指纹限制 | 结合幂等键、步骤状态和 Tool Broker 统一控制 |
| 子任务 | 尚无通用 Skill 子 Run | 后续可增加受限 child Skill Run，不作为默认行为 |
| 失败 | 超时、预算和工具失败已有错误码 | 统一 Run 状态、可恢复性和失败策略 |

目标 Agent Run：

```text
Run started
  → load Skill
  → model step 1
  → tool call(s)
  → tool result(s)
  → model step 2
  → optional confirmation / checkpoint
  → final structured result
```

### 3.8 输出契约与业务门禁

| 环节 | 当前流程 | 目标流程 |
|---|---|---|
| 输出格式 | 各阶段自己解析 JSON、HTML、Markdown 或表单结果 | Skill / Stage Manifest 声明 output contract |
| 结构校验 | Pipeline 内部函数和脚本完成 | Harness 做通用 Schema / envelope 校验，Feature 做领域校验 |
| 事实门禁 | 文章和图文 Pipeline 各自执行 | 事实门禁仍由领域 Feature 负责，结果挂到 Run 上 |
| 失败返工 | 文章 Pipeline 有特定修订和长度返工 | Harness 提供 retry / repair 原语，具体返工 Prompt 仍由 Feature 决定 |
| 最终交付 | 写入文章、HTML、图片和数据库记录 | Run 产出结构化 Result，Feature 完成 Artifact registration |

目标采用两层门禁：

```text
Harness Gate
  ├─ 协议完整
  ├─ Schema 正确
  ├─ 工具和资源授权满足
  └─ 运行预算未超限

Feature Gate
  ├─ 事实支持
  ├─ 业务状态完整
  ├─ 文章 / 图文结构满足要求
  └─ 可发布性满足要求
```

### 3.9 重试、修复与失败策略

| 环节 | 当前流程 | 目标流程 |
|---|---|---|
| 模型失败 | Gateway 或业务函数按场景重试 | Model Adapter 统一标记 retryable / terminal |
| 工具失败 | Tool Registry 有 fallback 和部分 retryable | Tool Broker 统一 retry policy、fallback 和预算扣减 |
| 输出不合格 | 不同 Pipeline 各自 repair | `RunPolicy` 声明可重试阶段，Feature 提供 repair handler |
| 业务不通过 | 业务 Pipeline 自己停止或返工 | Feature Gate 返回结构化 failure decision |
| 失败记录 | AI Run、阶段 JSON、Agent Run 分散记录 | 统一 Run Event + Stage Result + Failure Decision |

目标失败策略示例：

```text
tool timeout
  → retry once if idempotent
  → otherwise fail stage

output schema invalid
  → repair with same Skill snapshot
  → still invalid → terminal failure

fact gate failed
  → Feature decides whether to repair or stop
```

### 3.10 持久化、Checkpoint 与恢复

| 环节 | 当前流程 | 目标流程 |
|---|---|---|
| 运行记录 | Agent Run、Tool Call、AI Run 和模型审计已存在 | 统一 Run / Step / Event / Artifact 关联 |
| 中间状态 | 部分 Pipeline 写阶段文件和阶段 JSON | 每个可恢复边界写 checkpoint |
| 进程重启 | 当前任务视为结束，不自动断点续跑 | 可恢复 Run 从最近 checkpoint 继续 |
| 重复执行 | Agent 有重复工具保护，Pipeline 依赖业务逻辑 | 所有副作用通过 idempotency key 控制 |
| 历史复跑 | generation snapshot 可冻结 Prompt、模型和工具 | 增加完整输入、事件和工具结果 replay |

建议的持久化对象：

```text
Run
RunStep
RunEvent
ToolCall
Checkpoint
SkillSnapshot
ArtifactRef
FailureDecision
```

### 3.11 页面流式反馈

| 环节 | 当前流程 | 目标流程 |
|---|---|---|
| 传输 | Agent 对话使用 NDJSON；普通 Pipeline 使用进度回调或 Job 状态 | 保留 NDJSON，并统一事件来源 |
| 思考过程 | `assistant.thinking` | 保留原事件，内部映射到 `model.thinking` |
| 工具状态 | `tool.requested/running/completed/failed` | 保留原事件，增加可选 run / step 元数据 |
| 完成结果 | 各路由拼装 `done.data` | Harness 返回统一 Result，路由做兼容映射 |
| 恢复 | 当前主要重新提交 | 后续可增加 resume / retry 操作，不改变原发送流程 |

兼容原则：

```text
内部事件可以升级
        ↓
路由层继续输出现有事件和字段
        ↓
旧页面无需修改
```

### 3.12 产物与审计

| 环节 | 当前流程 | 目标流程 |
|---|---|---|
| 产物 | 文章、排版、图片和图文有各自目录和 manifest | ArtifactRef 统一关联 Run、Stage 和来源 |
| 技能记录 | 排版和文章保存 skill hash / manifest | 所有 Skill Run 保存版本、Prompt hash、配置和能力 Scope |
| 工具记录 | Tool execution 和 Agent tool call 已有审计 | 统一到 Run Trace，保留插件版本和 resolution 信息 |
| 可追溯性 | 能查到很多记录，但需要跨表和文件拼接 | 一个 Run 可以查看完整输入、步骤、工具、门禁和产物链 |
| 质量分析 | 以测试和业务门禁为主 | 增加 replay、eval、耗时、工具成功率和返工率 |

## 4. 三类实际流程对比

## 4.1 文章生成链

### 当前

```text
文章入口
  → loadArticleSkillBundle()
  → prepareSkillRun()
  → fact-base
  → planning
  → drafting：Skill Prompt + gateway.complete()
  → draft quality gate
  → title / humanize / review / seo
  → length repair / publication repair
  → final gate
  → image planning / artifact
```

特点：

- 阶段顺序清晰，业务门禁完整；
- Skill 已进入 generation snapshot；
- 但各阶段的运行状态和模型调用仍主要由 `article-pipeline` 直接控制；
- 大多数阶段是单轮 Stage，不是对话 Agent。

### 目标

```text
Article Workflow
  → create Run / article snapshot
  → runStage(fact-base)
  → runStage(planning)
  → runStage(drafting)
  → runGate(draft-quality)
  → runStage(title)
  → runStage(humanize)
  → runStage(review)
  → runStage(seo)
  → runGate(publication)
  → runStage(image-planning)
  → register artifacts
```

目标变化：

- 文章 Workflow 仍然决定顺序；
- 每个阶段都有统一 Stage Result；
- 阶段 Skill 通过 `runStage()` 执行；
- 需要多轮资料检索的阶段才升级为 `agent-skill`；
- 失败返工复用相同 Skill Snapshot；
- 页面不需要从“文章 Pipeline”改成“文章 Agent”。

## 4.2 排版链

### 当前

`runTypesetPipeline()` 已经是一个相对成熟的确定性 Workflow：

```text
rendered
  → wechat-md-render 脚本
design
  → wechat-article-typeset Prompt
  → magazine-design-advisor Prompt
  → gateway.complete(JSON)
images
  → Mermaid / ECharts capability
  → 统计卡 / 时间线生成
draft
  → 默认 markdownToHtml 确定性转换
  → llm 模式才调用模型
normalized
  → 脚本或兼容路径
gate
  → wechat-html-check-no-div 脚本
```

这里的 `magazine-design-advisor` 作为 Prompt 传给 design 阶段是合理的，因为它是 `stage-skill`，不是需要自由规划的 Agent。

### 目标

```text
Typeset Workflow
  → runStage(wechat-md-render)
  → runStage(magazine-design-advisor)
  → callTool(cap_diagram_mermaid_render)
  → callTool(cap_diagram_echarts_render)
  → callTool(cap_image_cdn_upload)
  → runStage(wechat-md-to-draft)
  → runStage(wechat-html-normalizer)
  → runStage(wechat-html-check-no-div)
```

目标变化：

- 不启动一个“大排版 Agent”替代 Pipeline；
- design 阶段仍可由 Skill Prompt 驱动一次模型调用；
- 脚本阶段保持确定性，不伪装成 Agent；
- 图片渲染和上传统一走 Tool Broker；
- 每个阶段都有统一的输入、输出、耗时、日志和失败状态；
- 排版页面和产物结构保持兼容。

## 4.3 编辑会 / 自主写作 / 自定义图文

### 当前

```text
页面发送消息
  → 路由调用业务 Agent Adapter
  → Adapter 组装 Skill Prompt、资源和 Tool Catalog
  → runConversationAgent()
  → native tool call
  → executeConversationTool()
  → 模型继续推理
  → finish tool / final
  → Adapter 更新表单和业务状态
  → NDJSON done
```

特点：

- 已经最接近 Agent Harness 目标；
- `runConversationAgent`、工具目录、事件和审计基本成形；
- 主要缺口是统一 Facade、可恢复 Run、完整 replay 和更声明式的 Skill 接入。

### 目标

```text
页面发送消息
  → Feature Application 创建 RunRequest
  → Harness resolve agent-skill
  → 冻结 Skill / Tool Scope / Budget
  → Agent Run Engine
      → model step
      → Tool Broker
      → checkpoint
      → next model step
  → structured AgentResult
  → Feature Adapter 更新业务状态
  → 兼容 NDJSON done
```

目标变化主要在后端运行时，页面只在需要时增加：

- 继续执行；
- 从上一步重试；
- 取消运行；
- 工具写入确认；
- 查看运行详情。

这些都是可选增量能力，不是第一阶段的必需变更。

## 5. 理想 Harness 下的职责边界

| 对象 | 负责什么 | 不负责什么 |
|---|---|---|
| Workflow / Pipeline | 顺序、分支、业务状态、业务门禁、产物流程 | 不负责模型消息循环和工具底层授权 |
| Agent | 多轮推理、决策和运行生命周期 | 不直接决定整个业务 Pipeline 顺序 |
| Skill | Prompt、方法、契约、能力需求和预算 | 不绕过 Broker 直接执行外部动作 |
| Tool Broker | Scope、Schema、权限、确认、幂等、执行事件 | 不负责业务结论和文章观点 |
| Tool / Plugin | 搜索、读取、写入、上传、渲染等动作 | 不负责选择下一个业务阶段 |
| Feature Adapter | 业务上下文、表单更新、结果解释、领域门禁 | 不重复实现通用 Agent 循环 |
| Run Store | Run、Step、Event、Checkpoint、Trace、Artifact 关联 | 不决定业务规则 |

## 6. 迁移前后最明显的变化

### 当前：运行时逻辑分散

```text
Feature Pipeline
  ├─ 自己加载 Skill
  ├─ 自己拼 Prompt
  ├─ 自己调用 Gateway
  ├─ 自己决定是否重试
  ├─ 自己写阶段记录
  └─ 自己解释结果
```

### 目标：业务声明，Harness 执行

```text
Feature Workflow
  ├─ 声明阶段和顺序
  ├─ 提供业务输入
  ├─ 提供领域门禁
  └─ 接收结构化结果

Harness
  ├─ 解析 Skill
  ├─ 创建 Run
  ├─ 组装模型上下文
  ├─ 授权和执行工具
  ├─ 管理预算和重试
  ├─ 保存 checkpoint 和 trace
  └─ 返回统一结果
```

## 7. 改造完成的判断标准

不以“是否引入某个 Agent 框架”为判断标准，而以以下结果为准：

1. 每次 Skill、Stage 或 Agent 执行都有统一 Run；
2. Skill 有明确的类型、输入、输出、能力和预算契约；
3. Tool 调用全部经过统一 Broker；
4. Workflow 仍然掌握业务顺序和领域门禁；
5. 模型协议差异不会泄漏到业务 Feature；
6. Agent 运行可以取消、审计、恢复和 replay；
7. 现有页面和 NDJSON 接口保持兼容；
8. 排版等确定性流程不被强行改造成自由 Agent；
9. Feature adapter 不再重复实现运行时基础设施；
10. 新增一个 Agent 或 Stage Skill 时，主要维护 Manifest 和业务 adapter，而不是复制一套循环、工具和日志代码。

## 8. 推荐实施顺序

```text
Phase 0
  冻结 API、事件、结果和页面兼容契约

Phase 1
  增加 Harness Facade，包装现有 Pipeline、Stage 和 Agent

Phase 2
  统一 Tool Broker、模型事件和工具生命周期

Phase 3
  统一 Skill Manifest、Skill Resolver 和 Stage / Agent 类型

Phase 4
  增加 checkpoint、resume、cancel、retry 和幂等

Phase 5
  迁移文章、排版、图文、视觉文档和批次消费者

Phase 6
  增加 replay、eval、质量指标，视复用需求决定是否抽 SDK
```

## 9. 结论

现有流程已经具备清晰的业务 Workflow，也已经有接近 Harness 的 Agent 和 Tool 基础设施。理想目标不是改变所有页面或把所有 Skill 交给一个大 Agent，而是：

> 让 Workflow 继续负责“业务怎么走”，让 Agent 负责“需要推理时怎么想”，让 Skill 负责“采用什么方法和约束”，让 Tool 负责“实际执行什么动作”，最后由 Harness 统一管理它们的运行、权限、预算、状态、审计和恢复。

