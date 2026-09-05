# Agent Harness 控制台与能力治理方案

> 状态：Phase 4 P0 实施中（Trace 筛选、受控测试和运行治理入口已接入；恢复/重试仍需原业务入口补齐上下文）  
> 上游方案：[Agent Harness 演进方案](./agent-harness-evolution-plan.md)  
> 关联方案：[可观测性与 Run Trace 演进方案](./agent-harness-observability-and-run-trace-plan.md)  
> 范围：技能页面、工具 / Capability 页面、消费者关系、运行测试、权限治理和 Run Trace 入口  
> 原则：不做 React 整体迁移，不破坏现有页面操作；在现有原生 ESM 控制台上逐步增加 Harness 运行语义。

## 1. 背景与判断

Agent Harness 建成后，技能和工具页面不能只展示“安装了什么”，还要回答：

- 这个 Skill 以什么方式运行？
- 它接受什么输入、产生什么输出？
- 它需要哪些能力？
- 哪些 Workflow / Agent 正在使用它？
- 某个 Tool 停用会影响哪些消费者？
- 一次运行调用了哪个 Skill、模型和 Tool 版本？

当前控制台已经有较好的基础：

- `public/src/views/skills.js` 已有能力图谱、消费者状态、技能授权、实现链路和停用影响预览；
- `system-routes.mjs` 已提供能力图谱、能力消费者、能力路由、技能入口和阶段技能查询接口；
- 技能包配置和工具配置已有独立的状态、测试和凭据边界；
- 工具能力已经区分 Capability、插件实现、优先级和 fallback 链。

因此，本方案不是重做技能 / 工具页面，而是将现有“能力配置台”升级为 Harness 的“运行与治理控制台”。

## 2. 目标信息架构

```text
Harness 控制台
  ├─ 技能
  │   ├─ 可运行技能列表
  │   ├─ 技能详情
  │   ├─ 入口与阶段
  │   ├─ 工具能力需求
  │   ├─ 运行预算与门禁
  │   ├─ 最近运行与 Snapshot
  │   └─ 运行测试 / Replay
  │
  ├─ 能力与工具
  │   ├─ Capability 目录
  │   ├─ 插件实现链
  │   ├─ 风险与副作用
  │   ├─ 消费者与影响范围
  │   ├─ 路由与 fallback
  │   └─ 健康检查 / 测试执行
  │
  ├─ 消费者关系
  │   ├─ Workflow
  │   ├─ Agent
  │   ├─ Skill
  │   └─ Feature / 采集源
  │
  └─ Run Trace
      ├─ Workflow
      ├─ Stage
      ├─ Skill / Agent
      ├─ Model Call
      ├─ Tool Call
      ├─ Gate
      └─ Artifact
```

## 3. 技能页面：从技能包管理到可运行技能管理

### 3.1 当前页面语义

当前技能相关页面和接口主要关注：

```text
技能是否存在
技能是否启用
技能配置是否完成
技能是否声明某项能力
技能能否用于某个入口或阶段
```

这些能力继续保留，不改变现有启用、停用、配置和安装流程。

### 3.2 目标技能列表

技能列表应以“可运行状态”为主，而不是只显示文件包状态：

| 字段 | 说明 |
|---|---|
| 名称 / ID | 用户名称和稳定 ID |
| 类型 | `prompt-skill`、`stage-skill`、`agent-skill` |
| 执行模式 | Prompt、脚本、单轮模型、多轮 Agent |
| 入口 | editorial、typeset、article、social 等 |
| 输入契约 | 运行时接收的数据类型 |
| 输出契约 | 运行时产生的数据类型 |
| 所需能力 | required / optional Capability |
| 预算 | 模型步数、工具次数、超时、输出上限 |
| 门禁 | Schema、结构、事实或业务门禁 |
| 可运行状态 | 可用、缺少配置、缺少能力、适配降级、已停用 |
| 当前版本 | Skill 版本、Prompt hash、配置 hash |
| 消费者 | 使用该技能的 Workflow / Agent / Feature 数量 |
| 最近运行 | 最近一次 Run 状态、耗时和失败原因 |

列表中应明确区分：

```text
已安装 ≠ 已配置 ≠ 可运行
可运行 ≠ 当前入口可用
当前入口可用 ≠ 最近一次运行成功
```

### 3.3 技能详情页

技能详情建议分为以下区域：

```text
基本信息
  名称、ID、类型、版本、来源、启用状态

运行契约
  输入、输出、入口、阶段、执行模式

能力需求
  required / optional capabilities
  当前授权、实现可用性、缺失原因

运行策略
  模型、预算、超时、并行限制、门禁

消费者关系
  使用它的 Workflow、Agent、Feature 和阶段

运行历史
  最近 Run、成功率、平均耗时、失败原因

版本与 Snapshot
  Prompt hash、配置 hash、工具版本、模型版本

操作
  测试运行、查看 Trace、查看影响范围、启停、配置
```

技能详情中不直接展示一整段 Prompt 作为主要信息。Prompt 可以作为“实现详情”展开，主要视图应展示可运行契约。

### 3.4 技能测试

技能页应提供只读或受控测试入口：

```text
选择测试输入
  → 解析 Skill Manifest
  → 创建临时 Run
  → 使用测试 Scope 和预算
  → 运行 Skill
  → 展示输出契约、工具调用、门禁和错误
  → 默认不写入业务产物
```

测试运行必须明确标记：

```text
test run
不改变生产配置
不写入正式产物
不授予未声明能力
```

## 4. 工具页面：从插件列表到 Capability 目录

### 4.1 目标对象层级

工具页面以 Capability 为第一层对象，Plugin / Adapter 为第二层实现：

```text
Capability
  ├─ 风险和副作用
  ├─ 输入 / 输出 Schema
  ├─ 当前路由策略
  ├─ 消费者
  ├─ 影响范围
  └─ Implementations
      ├─ builtin plugin
      ├─ installed plugin
      └─ remote declaration
```

必须保持的概念区分：

```text
Capability = 消费者和 Skill 请求的能力
Plugin      = 提供该能力的具体实现
Tool Call   = 某次 Run 对能力的一次调用
Tool Audit  = 实际实现执行后的审计记录
```

### 4.2 Capability 列表

| 字段 | 说明 |
|---|---|
| Capability | 稳定能力 ID 和名称 |
| 类别 | web、news、repository、document、render、write 等 |
| 风险 | read-only、network-read、local-write、external-write |
| 副作用 | none、local-write、external-write |
| 配置状态 | 已配置、待配置、不可用 |
| 实现数量 | 可用、停用、缺依赖的实现统计 |
| 路由 | 自动优先级或指定首选实现 |
| 消费者 | Workflow、Agent、Skill、采集源 |
| 影响 | 停用、降级或切换后的影响范围 |
| 最近执行 | 最近调用状态、耗时和错误 |

### 4.3 Capability 详情

```text
能力定义
  ID、名称、说明、风险、副作用

输入输出
  inputSchema、outputSchema、示例

实现链
  插件 ID、版本、健康状态、优先级、fallback 顺序

消费者
  哪些 Skill / Agent / Workflow 使用该能力

授权
  哪些消费者允许调用，哪些被白名单或策略阻断

写入与确认
  是否需要 external-write 授权或人工确认

执行历史
  次数、成功率、耗时、最近错误和 provenance

操作
  健康检查、测试执行、路由调整、停用影响预览
```

### 4.4 插件实现管理

插件仍然需要管理，但不应取代 Capability 视图。插件页面主要负责：

- 安装、启用、停用和卸载；
- 配置和健康检查；
- 实现版本和依赖；
- 它提供哪些 Capability；
- 停用后的 fallback 和影响范围；
- 远程插件的声明和凭据状态。

停用操作继续采用影响预览和版本校验：

```text
计算影响
  → 是否阻断必需能力
  → 是否造成降级
  → 是否存在剩余实现
  → 用户确认最新 impactVersion
  → 执行停用
```

## 5. Skill、Tool、Workflow 的关系视图

目标增加一个可互相跳转的关系视图：

```text
Workflow
  ├─ Stage
  │   └─ Skill
  │       ├─ required Capability
  │       └─ optional Capability
  └─ direct Tool call
```

示例：

```text
Typeset Workflow
  ├─ Stage: design
  │   └─ magazine-design-advisor
  ├─ Stage: images
  │   ├─ cap_diagram_mermaid_render
  │   ├─ cap_diagram_echarts_render
  │   └─ cap_image_cdn_upload
  └─ Stage: gate
      └─ wechat-html-check-no-div
```

关系页面必须能双向跳转：

```text
Skill → 查看它需要的 Capability
Capability → 查看使用它的 Skill / Agent / Workflow
Workflow → 查看自己的阶段和运行记录
Run Trace → 返回 Skill、Tool 和 Artifact 详情
```

## 6. 页面与 Harness 权限边界

页面可以做：

- 查看 Skill 和 Capability 状态；
- 修改明确允许的配置；
- 启停消费者授权；
- 选择工具实现路由；
- 执行健康检查和受控测试；
- 查看影响范围和 Run Trace。

页面不能做：

- 绕过 Skill Manifest 直接给 Agent 注入任意 Tool；
- 绕过 Harness Policy 授予 external-write；
- 修改已冻结历史 Snapshot；
- 让测试 Run 写入正式业务产物；
- 删除仍被历史审计引用的日志；
- 将 Plugin 实现直接伪装成 Capability 契约。

授权流程统一为：

```text
Skill 声明能力
  → 消费者登记
  → 页面显示授权状态
  → Harness 生成 Run Scope
  → Tool Broker 最终校验
```

页面展示不能替代服务端最终校验。

## 7. 页面与现有交互兼容

本方案默认不改变：

- 现有技能安装、启停、配置和卸载入口；
- 现有工具插件配置和健康检查入口；
- 现有能力授权确认和停用影响确认；
- 现有创建入口的技能选择；
- 现有任务日志和模型日志页面入口；
- 原生 ESM 前端和现有 API 路径。

新内容以增量方式出现：

```text
原有列表
  → 增加类型、契约、运行状态和消费者摘要
  → 增加“查看运行详情”
  → 增加“测试运行”
  → 增加“影响范围”
```

## 8. 分阶段实施

### Phase 0：现状字段冻结

**目标**：确认现有页面和接口可以承载目标信息。

工作内容：

- 盘点技能、能力、插件、消费者和运行记录字段；
- 固定现有安装、启停、授权和影响预览语义；
- 定义 `skillStatus`、`capabilityStatus`、`consumerStatus` 和 `runStatus`；
- 标记哪些字段已有接口，哪些需要新增。

验收：

- 现有页面行为不变；
- 不新增与现有含义冲突的状态枚举；
- 每个目标卡片字段都有来源。

### Phase 1：技能可运行状态

**目标**：技能页从文件包状态升级为运行状态展示。

工作内容：

- 增加 Skill kind、执行模式、输入输出契约；
- 展示 required / optional capabilities；
- 展示预算、门禁、版本和 Snapshot；
- 展示当前入口可用性和缺失原因；
- 增加消费者数量和最近运行摘要。

验收：

- 用户能区分已安装、已配置、可运行和入口可用；
- Skill 缺能力时能看到具体阻断原因；
- 现有启停和配置操作不变。

### Phase 2：Capability-first 工具页

**目标**：工具页以 Capability 为主，Plugin 为实现详情。

工作内容：

- 能力卡展示风险、副作用、Schema、实现链和消费者；
- 插件实现折叠到 Capability 详情；
- 保留路由优先级和 fallback 配置；
- 保留健康检查和停用影响预览；
- 增加最近 Tool Execution 摘要。

验收：

- 用户能从 Capability 反查消费者；
- 用户能从消费者反查所需能力；
- 停用实现前仍能看到阻断、降级和 fallback 影响。

### Phase 3：关系视图与统一跳转

**目标**：建立 Workflow → Stage → Skill → Tool 的可读关系。

工作内容：

- 消费者卡片显示 Workflow / Agent / Skill / Feature 类型；
- Skill 和 Capability 支持双向跳转；
- 增加入口、阶段和消费者筛选；
- 对缺失、降级、未授权和无实现状态进行统一标注。

验收：

- 一个能力停用影响哪些流程可以一眼确认；
- 一个 Skill 为什么不可用可以逐层定位；
- 关系视图与服务端 capability graph 使用同一数据来源。

### Phase 4：受控测试与 Run Trace

**目标**：从静态治理升级为可验证运行治理。

工作内容：

- 技能页增加测试输入和 test run；
- 工具页增加受控测试和实现选择结果；
- 技能、能力和消费者详情增加 Run Trace 入口；
- Trace 展示 Model Call、Tool Call、Gate 和 Artifact；
- 测试 Run 默认不写正式产物。

验收：

- 用户可以验证 Skill 是否真的可运行，而不只是看状态；
- 测试运行的工具 Scope 和生产 Run 明确区分；
- Trace 与 [可观测性方案](./agent-harness-observability-and-run-trace-plan.md) 的查询模型一致。

### Phase 5：恢复与运行治理

**目标**：把 checkpoint、resume、retry 和影响预览接入控制台。

工作内容：

- 展示可恢复 Run；
- 支持从最近 checkpoint 继续；
- 支持从指定 Stage 重试；
- 显示 Skill / Tool 版本和 Snapshot 冲突；
- 恢复或重试前重新校验能力和权限。

验收：

- 恢复不会绕过新的授权策略；
- 历史 Snapshot 不被覆盖；
- 重试不会重复执行不可幂等的外部写入。

## 9. 需要新增的接口方向

现有接口继续兼容，新增接口建议按以下方向设计：

```text
GET  /api/system/skills/runtime
GET  /api/system/skills/:id/runtime
POST /api/system/skills/:id/test-run

GET  /api/system/capabilities
GET  /api/system/capabilities/:id
POST /api/system/capabilities/:id/test

GET  /api/system/consumers/:id/relations
GET  /api/system/workflows/:id/relations

GET  /api/runs/:rootRunId
GET  /api/runs/:rootRunId/trace
```

第一阶段接口只读为主；涉及测试、启停、路由和恢复的接口必须继续使用现有确认头、影响版本和服务端策略校验。

## 10. 完成定义

控制台侧 Harness 改造完成的标准：

1. 技能页展示的是“可运行技能”，而不只是“技能包”；
2. 工具页以 Capability 为主，Plugin 为实现详情；
3. Skill、Tool、Workflow、Agent 之间可以双向追踪；
4. 用户可以看到缺失能力、授权阻断、实现不健康和版本冲突的具体原因；
5. 技能和工具可以进行不写生产产物的受控测试；
6. 运行详情可以从 Workflow 展开到 Stage、Skill、Model、Tool、Gate 和 Artifact；
7. 现有安装、配置、启停、授权、日志和页面交互保持兼容；
8. 页面操作不能绕过 Harness 的 Skill Manifest、Tool Broker 和 Policy；
9. 控制台只负责理解和治理运行，不取代 Workflow 的业务编排。

## 11. 结论

技能页和工具页应当作为 Agent Harness 的控制面进行演进：

> 技能页面展示“如何运行”，工具页面展示“能执行什么”，关系视图展示“谁在什么流程里使用了谁”，Run Trace 展示“一次运行实际发生了什么”。

这是一项后续控制台治理方案，不改变 Harness 的运行面设计，也不要求整体重写现有前端。
