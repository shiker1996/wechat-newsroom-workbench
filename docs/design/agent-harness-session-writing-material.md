# Agent Harness 演进讨论：会话总结与写作素材

> 用途：用于内部分享、技术方案说明、架构演进文章或项目复盘。
> 主题：在不重写现有业务和页面的前提下，把项目逐步演进为内部 Agent Harness。

## 一句话结论

我们现在已经具备 Agent Harness 的若干核心能力，但还不是一个概念完全统一的 Harness。下一步不应先引入 React、外部 Agent 框架或拆分微服务，而应围绕 Workflow 建立统一的运行时边界：由 Workflow 决定业务流程，由 Harness 负责 Skill、Agent、Tool 的运行生命周期。

## 1. 这次讨论回答了什么问题

这次会话主要围绕五个问题展开：

1. 项目当前是否已经是 Harness；
2. 继续保持现有架构，还是转向 Agent Harness；
3. Agent、Workflow、Skill、Tool 之间应该如何分工；
4. Harness 改造会不会改变现有页面、技能页面、工具页面和日志页面；
5. 如何把方案拆成可以逐阶段实施的工程计划。

最终形成的判断是：项目已经有 Agent Runtime、Tool Registry、Skill Runtime、Pipeline 和审计能力，属于“具备 Harness 雏形的模块化单体”，但还缺少统一的运行契约、统一的 Skill 执行入口、统一的 Run 关联和可恢复能力。

## 2. 对现状的判断

当前项目并不是从零开始建设 Agent Harness。已有能力包括：

- `runConversationAgent`：提供模型循环、工具调用、预算限制、上下文压缩、事件流和运行审计；
- `ToolRegistry`、`tool-catalog`、`tool-executor`：提供能力发现、工具目录、Schema 校验、权限策略、插件解析、fallback 和执行日志；
- `skill-runtime`、`entry-routing`、generation snapshot：提供 Skill 加载、入口选择、工具白名单以及 Prompt、模型、工具和配置冻结；
- Agent Run、Tool Call、Model Call、AI Run 和工具执行日志：已经形成基础审计链路；
- 文章、社交卡、排版和视觉文档等业务 Pipeline：已经具备确定性的阶段编排能力。

真正的问题不是“没有 Agent 能力”，而是这些能力还分散在不同的模块和业务适配器中。相同的运行规则在 Agent、Pipeline 和 Feature adapter 中存在重复，Skill 仍常常被理解为一段 Prompt，普通 Pipeline 也还没有统一的 Run 语义。

## 3. 为什么不是先引入 React 或外部 Agent 框架

本次讨论明确去掉 React 方向。原因不是 React 不好，而是它解决的是前端组织和渲染问题，不能直接解决当前最核心的运行时问题：

- Skill 如何定义输入、输出、能力和预算；
- Agent 如何统一创建、执行、取消、恢复和审计；
- Tool 如何经过统一授权、校验和执行；
- Workflow、Stage、Skill、Model 和 Tool 如何被同一次运行串联；
- 页面和 API 如何在内部替换运行时的同时保持兼容。

同样，当前也不建议立刻引入外部 Agent SDK。项目已有稳定的本地 Agent Runtime、Tool Registry 和 Pipeline，直接换框架会增加迁移成本，并可能破坏现有事件、日志和页面交互。更稳妥的路径是先在现有模块化单体内部形成 Harness Facade，等出现多个独立产品或第三方扩展需求后，再评估抽成独立 package 或 SDK。

## 4. 目标架构的核心分工

目标架构不是把所有东西都变成 Agent，而是把四类对象的边界说清楚：

```text
Workflow = 决定业务流程和阶段顺序
Skill    = 描述方法、指令、输入输出契约和运行策略
Agent    = 在 Harness 中执行 Agent Skill 的多轮运行实例
Tool     = 具有 Schema、权限和副作用边界的执行能力
```

三种 Skill 执行模式：

```text
prompt-skill  只提供指令和 Prompt
stage-skill   作为确定性 Workflow 的一个阶段
agent-skill   允许多轮模型推理和工具调用
```

因此，Workflow 不应该把 Skill 简单塞进 Agent 的 Prompt。Workflow 应该选择一个有明确契约的 Skill，并声明以哪种模式运行；Harness 再根据模式决定是调用一次模型、执行一个确定性阶段，还是启动一个多轮 Agent Run。

## 5. 当前流程与目标流程的差异

### 当前流程

```text
用户请求
  → 路由或 Job
  → Feature Agent / Pipeline
  → 各自加载 Skill、组装 Prompt、调用模型或工具
  → 各自记录部分日志和产物
  → 返回 JSON、NDJSON 或文件产物
```

### 目标流程

```text
用户请求
  → Feature Application
  → Workflow 声明执行模式和业务上下文
  → Harness Facade
      → Skill Resolver
      → Run / Snapshot
      → Context / Budget / Policy
      → Tool Broker
      → Checkpoint / Trace / Replay
  → 返回结构化结果、业务门禁和产物
```

最重要的变化可以概括为：

> 当前是业务代码自行组合“技能 + 模型 + 工具 + 记录”；目标是业务代码声明“要运行什么”，Harness 负责“如何运行”。

## 6. Skill 和 Tool 的关系

Skill 不是 Tool，Tool 也不是 Skill 的另一种写法。

- Skill 负责告诉模型或阶段“应该如何完成任务”；
- Tool 负责提供一个可验证、可授权、可审计的执行能力；
- Agent 可以在运行 Skill 的过程中请求 Tool；
- Workflow 可以把一个 Stage Skill 当作阶段执行，但不需要因此启动多轮 Agent；
- Skill 只能声明需要哪些能力，不能绕过 Harness 直接执行外部写入。

理想的调用链是：

```text
Skill 声明 requiredCapabilities
  → Harness 解析并生成 Run Scope
  → Agent 或 Stage 请求 Tool
  → Tool Broker 校验权限、Schema、资源和副作用
  → Tool 执行并记录 provenance
  → 结果回填 Skill 的运行上下文
```

这也是技能页面从“技能包管理”升级为“可运行技能管理”的基础：页面需要展示的不只是文件是否安装，而是 Skill 是否具备契约、能力、预算、门禁和可运行状态。

## 7. 页面交互是否会改变

Harness 改造的第一原则是内部运行时替换，页面兼容优先。

Phase 0 到 Phase 5 默认保持不变：

- 路由 URL 不变；
- 请求体结构不变；
- 现有 NDJSON 事件名称不变；
- `done.data` 中已有字段不删除；
- 表单更新、`ready`、`missing`、`agent.limit` 和 `error` 语义不变；
- 原有安装、配置、启停、授权、日志入口继续可用。

后续页面可以增量增加“查看运行详情”“测试运行”“继续执行”“从阶段重试”“工具写入确认”等能力，但这些是 Harness 建成后的新增控制能力，不是改造的前置条件。

## 8. 技能页和工具页的后续方向

技能页的定位从“技能包管理”变为“可运行技能管理”，重点展示：

- Skill 类型：Prompt、Stage 或 Agent；
- 输入输出契约；
- 所需和可选能力；
- 预算、门禁、版本和 Snapshot；
- 当前入口是否可用，以及具体阻断原因；
- 消费者数量和最近运行摘要；
- 受控测试运行和 Run Trace。

工具页则从“插件列表”转向“Capability-first”：

- 能力是什么；
- 风险和副作用是什么；
- 输入输出 Schema 是什么；
- 哪个 Plugin 实现了它；
- 哪些 Workflow、Stage、Skill 或 Agent 正在使用它；
- 停用或降级后会影响哪些消费者。

可以用一句话概括控制台方向：

> 技能页面展示“如何运行”，工具页面展示“能执行什么”，关系视图展示“谁在什么流程里使用了谁”。

## 9. 任务日志和模型日志怎么演进

任务日志和模型日志不需要合并成一张大表，也不需要推倒重做。更合理的方式是保留不同层级的事实，并通过统一 Run ID 串联：

```text
Workflow Log  → 普通用户看任务进度和业务结果
Run Trace     → 高级用户看 Workflow、Stage、Skill、Agent Step 和 Tool 链路
Model Audit   → 工程人员看 provider、model、token、耗时和模型错误
Tool Audit    → 工程和安全人员看 capability、plugin、权限和副作用
```

现有 `ai_runs`、`agent_runs`、`model_calls`、`agent_tool_calls`、`tool_executions` 继续保留。先补齐 `rootRunId`、`workflowRunId`、`stageId`、`stepId`、`skillId` 和 `generationSnapshotId`，再增加只读 Run Trace，最后才接入 checkpoint、resume 和 replay。

普通用户仍看到任务进度；只有进入运行详情时，才逐层展开到模型和工具细节。实时 token 继续走 NDJSON，不建议全部写入 SQLite；数据库只保存阶段里程碑、模型调用、工具调用、门禁、checkpoint 和最终结果。

## 10. 分阶段实施路线

### Phase 0：基线冻结与兼容契约

盘点入口、固定路由和事件语义，建立 replay fixture，确保页面和接口行为不变。

### Phase 1：建立 Harness Facade

新增统一 `runSkill` 入口，内部将 `prompt-skill`、`stage-skill` 和 `agent-skill` 分流；保留 `runConversationAgent` 作为现有实现，先做兼容包装。

### Phase 2：统一 Tool Broker

统一工具 Scope、Schema、权限、确认、超时、幂等、错误码和执行审计，禁止业务适配器绕过授权直接执行工具。

### Phase 3：统一 Skill Runtime

让每个 Skill 都有明确的类型、入口、输入输出契约、能力声明、预算和门禁，并将这些信息一并冻结到 generation snapshot。

### Phase 4：Checkpoint、Resume 与幂等

增加 Agent Step、Checkpoint、Run Event、Resume Token 和 Idempotency Key，先支持本地 SQLite 的恢复，不急于引入分布式队列。

### Phase 5：迁移业务消费者

按编辑会、自主写作、自定义图文、视觉文档、文章 Pipeline、社交卡 Pipeline、批次 Job 的顺序迁移。Feature 只保留业务上下文、领域状态、门禁和产物解释。

### Phase 6：Replay、Eval 与可选 SDK

增加契约测试、工具回放、固定模型响应、版本比较和质量指标。只有当产品数量和扩展需求真正增长时，再考虑抽离独立 SDK。

## 11. 适合文章使用的主线

### 标题方向

- 我们的项目已经是 Agent Harness 了吗？一次从“能调用模型”到“能治理运行”的架构复盘
- Agent Harness 不是把所有东西都改成 Agent
- 从技能包到可运行技能：一个内容生产系统的 Harness 演进路线
- 不重写页面，如何把现有 Agent 系统演进成 Harness

### 文章结构

1. 先回答：我们已经有 Harness 雏形，但还没有统一 Harness；
2. 解释为什么问题不在模型调用，而在运行时概念分散；
3. 讲清 Workflow、Skill、Agent、Tool 的职责边界；
4. 对比当前流程和目标流程；
5. 说明为什么不先引入 React 或外部 Agent 框架；
6. 解释页面、技能页、工具页和日志页如何保持兼容并逐步升级；
7. 给出六阶段落地路线；
8. 用“统一 Run、统一 Skill 契约、统一 Tool Broker、可审计可恢复”作为完成定义。

## 12. 可直接使用的摘要段落

我们的项目并不是从零开始建设 Agent Harness。它已经拥有模型循环、工具注册、能力授权、Skill 加载、Pipeline 编排和多层日志，因此更准确的判断是：项目已经具备 Harness 雏形，但运行时概念还没有完全统一。Skill 仍有一部分只是 Prompt 包，Agent 和 Pipeline 使用不同的运行语义，工具执行虽然相对集中，但还缺少统一的 Scope、checkpoint、resume 和 replay。

这次演进不以引入某个外部框架为目标，也不要求把所有流程都 Agent 化。更合理的方向是围绕 Workflow 建立一个内部 Harness：Workflow 负责业务顺序，Skill 负责方法和契约，Agent 负责多轮运行，Tool 负责受控执行。业务代码只声明要运行什么，Harness 统一负责如何加载、授权、调用、记录、恢复和评估。

最重要的是，这个改造不应该让用户重新学习页面。前期保持路由、请求体、事件名称、表单更新和日志入口兼容；后续再增量增加测试运行、运行详情、阶段重试和继续执行。技能页面从“技能包管理”升级为“可运行技能管理”，工具页面从“插件列表”升级为“能力治理”，任务日志和模型日志则通过统一 Run ID 串联为可下钻的 Run Trace。

最终，Harness 改造完成的标志不是项目用了哪个 Agent 框架，而是每次运行都有统一 Run，每个 Skill 都有输入输出和能力契约，每个 Tool 都经过授权和审计，运行可以恢复和复现，而 Feature 不再重复实现模型循环、工具策略和运行状态管理。

## 13. 关键词与表达素材

```text
Harness 雏形
统一运行时边界
Workflow 决定顺序，Harness 负责执行
Skill 不是 Prompt 字符串
Tool 不是能力黑盒
可运行技能
Capability-first
内部运行时替换
兼容优先
Run Trace
Checkpoint / Resume / Replay
从业务代码组合运行时，到业务代码声明运行意图
```

