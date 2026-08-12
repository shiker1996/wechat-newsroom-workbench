# 工具调用链与依赖治理重构方案

## 1. 背景与目标

当前系统已经把工具实现抽象为 `capability -> plugin`，但“谁需要能力、从哪里触发、不可用时如何处理”仍散落在技能清单、技能运行配置和业务代码中。启用/停用工具只改变注册表候选集，没有在操作前完整计算对技能、功能和在途任务的影响。

本次重构目标不是继续按“信息工具/采集工具”拆页面，而是建立统一关系：

`功能或技能 -> 能力需求 -> 候选工具链 -> 配置/依赖健康 -> 实际执行记录`

最终需要做到：

1. 一个能力可由多个工具实现，按首选和优先级自动兜底。
2. 技能、业务功能、定时流程和代码调用都必须进入同一依赖图。
3. 禁用、卸载或修改配置前，能看到会影响哪些能力、技能和功能。
4. 禁用最后一个必需实现时必须阻止；存在可用兜底时允许切换并说明影响。
5. 页面能展示声明链、当前解析链和最近实际调用链。

## 2. 现状调用流

### 2.1 工具注册与解析

- `lib/tools/index.mjs` 加载内置、本地安装和远程工具，生成全局 `ToolRegistry`。
- `lib/tools/registry.mjs` 根据 `enabled + priority + preferred plugin` 选择单个实现。
- `data/tool-plugin-settings.json` 保存工具启停与优先级。
- `data/information-capability-slots.json` 保存部分信息能力的首选实现。
- 当前 `execute()` 只执行解析出的一个实现；该实现配置缺失、健康异常或执行失败后，不会继续尝试下一候选。

### 2.2 技能/LLM 触发

当前并不是 LLM 直接任意发现工具，而是：

1. 技能由 `SKILL.md` 提供模型行为说明。
2. `prepareSkillRun()` 根据技能活动配置中的 `allowedTools` 生成工具快照。
3. 快照保存能力、插件和版本，用于历史任务复现。
4. 业务编排代码读取技能输出，并在需要时调用工具注册表。

风险：

- `skill.json` 的 `requiredCapabilities/optionalCapabilities` 与活动配置 `allowedTools` 是两套声明。
- 空 `allowedTools` 当前表示“不限制”，不是“不使用工具”，容易扩大技能可见范围。
- 技能文本提到某工具不等于系统存在可计算依赖，Markdown 描述无法参与禁用影响分析。
- 历史快照绑定具体插件版本；工具停用或卸载后，历史任务可能直接报“历史工具版本不可用”。

### 2.3 编码触发

已确认的主要直接调用包括：

| 调用方 | 能力 | 行为 |
| --- | --- | --- |
| 信息检索集成 | `content.url.fetch`、`content.web.search`、`content.news.search`、`content.document.search`、`content.repository.inspect`、`filesystem.project.read` | 通过信息能力槽位调用，支持首选实现 |
| 文章段落检索接口 | `content.passage.retrieve` | 通过能力首选调用 |
| 排版流程 | `diagram.mermaid.render`、`diagram.echarts.render` | 代码直接调用；失败会中断排版 |
| 图片工作流 | `image.cdn.upload` | 代码直接调用；失败会中断上传/交付 |
| 图表预览接口 | `diagram.*.render` | 代码直接调用；失败返回预览错误 |
| 采集任务 | `sourceType -> collector plugin` | 使用独立采集注册表，按来源执行 |

风险：代码调用点没有独立的“功能依赖清单”，只能靠全文搜索发现；页面无法知道停用图表工具会影响排版和预览两个功能。

### 2.4 采集触发

采集器目前是独立注册表：

`批次采集 -> collection source -> sourceType -> collector candidates -> collector adapter`

已经支持启停、优先级和绑定实现不可用时选择兼容候选，但依赖关系仍未进入通用能力图；采集器运行失败后的逐候选重试策略也没有与普通工具统一。

### 2.5 当前三套状态

| 层级 | 当前状态 | 问题 |
| --- | --- | --- |
| 能力授权 | 技能 `allowedTools` | 与 Manifest 必需/可选声明重复 |
| 实现路由 | 首选插件、启停、优先级 | 只解析一次，执行失败不兜底 |
| 可运行性 | 配置状态、手动健康检查 | 健康结果不参与统一解析和禁用门禁 |

## 3. 核心问题判定

### P0：依赖关系没有单一真源

技能 Manifest、活动配置和代码调用点互不完整，系统无法回答“停用此工具会影响什么”。

### P0：停用操作缺少影响门禁

当前停用是直接写设置并重载注册表。即使某能力只剩最后一个实现、某技能必需能力会断链，也不会阻止。

### P0：能力可用与工具启用被混为一谈

“已启用”不代表配置完整、依赖健康或策略允许；页面当前展示工具状态，但没有计算端到端能力状态。

### P1：普通工具缺少执行级兜底

有多个实现时，当前仅在首选实现未启用/不存在时选后续工具；首选配置失败、健康失败、超时或可重试错误不会自动尝试下一实现。

### P1：技能快照冻结粒度不合理

快照同时承担授权和具体实现复现。若绑定插件不可用，历史任务无法在“严格复现”和“允许兼容兜底”之间选择。

### P1：执行日志无法完整还原调用链

已有工具执行记录，但缺少统一的 `callerType/callerId/featureId/attempt/fallbackFrom/resolutionId`，无法从一次任务反查为何选择该工具。

## 4. 目标领域模型

### 4.1 统一节点

- **Consumer（消费者）**：技能、业务功能、流程阶段、API、定时任务。
- **Capability（能力）**：稳定的语义契约，例如 `content.web.search`。
- **Implementation（实现）**：工具或采集插件。
- **Dependency（依赖边）**：消费者需要某能力，标明必需/可选、触发条件和失败策略。
- **Route（路由）**：能力的首选实现和有序兜底候选。
- **Health（就绪状态）**：启用、配置、依赖检查、策略授权和版本兼容的合成结果。
- **Invocation（调用）**：一次解析和每次候选尝试的审计记录。

### 4.2 统一依赖声明

技能 `skill.json`：

```json
{
  "capabilityDependencies": [
    {"capability":"content.web.search","requirement":"optional","when":"research_enabled","failurePolicy":"continue-with-warning"},
    {"capability":"diagram.mermaid.render","requirement":"required","when":"contains_mermaid","failurePolicy":"block"}
  ]
}
```

代码功能使用独立清单，而不是运行时自动扫描源码：

```json
{
  "id":"feature.wechat.typeset",
  "name":"公众号排版",
  "capabilityDependencies":[
    {"capability":"diagram.mermaid.render","requirement":"conditional","when":"contains_mermaid","failurePolicy":"block"},
    {"capability":"image.cdn.upload","requirement":"conditional","when":"auto_upload","failurePolicy":"block"}
  ]
}
```

原则：源码扫描只作为 CI 审计，Manifest 才是运行时真源。任何新增 `registry.execute(capability)` 调用若未在功能清单声明，测试必须失败。

### 4.3 能力状态

能力状态由候选实现合成：

- `ready`：至少一个候选已启用、配置完整、健康且策略允许。
- `degraded`：可运行，但首选不可用或只剩一个候选。
- `blocked`：存在必需消费者，但没有可运行候选。
- `unused`：没有已启用消费者依赖。
- `unknown`：健康检查未执行或已过期。

工具状态不能再只显示“启用/停用”，必须同时显示它影响的能力和消费者数量。

## 5. 统一解析与执行流程

```mermaid
flowchart LR
  A[技能或业务功能] --> B[声明能力需求]
  B --> C[能力策略与任务快照]
  C --> D[候选路由解析]
  D --> E[启用检查]
  E --> F[配置与依赖健康]
  F --> G[策略与输入校验]
  G --> H[执行首选实现]
  H -->|可重试失败| I[尝试下一候选]
  H -->|成功| J[记录完整调用链]
  I --> J
  I -->|候选耗尽| K[按依赖失败策略阻断或降级]
```

解析结果应返回而非只返回单个插件：

```js
{
  capability,
  consumer,
  candidates: [
    {pluginId, priority, preferred, readiness, excludedReasons: []}
  ],
  selectedPluginId,
  status,
  resolutionId
}
```

兜底只适用于声明为可替代、输入输出契约兼容的实现。权限拒绝、非法输入和显式取消不可自动换实现；配置缺失、依赖缺失、超时、网络错误可依据能力策略尝试下一候选。

## 6. 禁用与卸载门禁

所有状态变更改为两阶段：

1. `impact preview`：计算受影响能力、消费者、在途任务和剩余候选。
2. `apply`：携带预览版本执行，防止预览后依赖图发生变化。

规则：

- 停用后必需能力无候选：阻止操作。
- 停用后首选切换到兜底：允许，但必须明确展示路由变化。
- 只影响可选能力：允许，显示会降级的技能/功能。
- 存在在途快照绑定：默认阻止卸载；停用可选择“仅禁止新任务”，让在途任务继续使用冻结版本。
- 强制停用只供管理员使用，必须填写原因并写审计日志。

## 7. 页面信息架构

仍保留一个“技能与工具”页面，不按信息/采集拆页。

### 7.1 能力配置

每张能力卡展示：

- 能力状态：就绪、降级、阻断、未知。
- 消费者：哪些技能、功能、阶段依赖它；标识必需、可选、条件触发。
- 路由链：首选工具、后续候选、各候选不可用原因。
- 最近实际调用：任务、调用方、最终实现、是否发生兜底。
- 操作：调整首选和优先级、检查整条链、查看依赖图。

### 7.2 工具运行

信息工具和采集工具作为筛选分类，使用相同卡片与操作：

- 启用工具
- 优先级
- 检查依赖
- 配置
- 执行历史
- 影响范围（新增）

点击停用时不直接切换，而是弹出影响预览：

```text
停用 tavily-search 后：
✓ content.news.search 将切换到 backup-search
△ content.web.search 只剩 1 个可用实现
✕ custom-card-storyboard 的必需能力将不可用
```

### 7.3 调用链视图

支持三个观察方向：

- 按技能/功能：消费者 -> 能力 -> 候选工具。
- 按能力：所有消费者 <- 能力 -> 所有实现。
- 按工具：工具 -> 实现能力 -> 受影响消费者。

声明链使用实线，条件/可选依赖使用虚线，最近实际执行高亮；默认只展开一层，避免大图失控。

## 8. 数据与 API 建议

新增持久化：

- `capability_consumers`：消费者元数据。
- `capability_dependencies`：消费者到能力的依赖边。
- `capability_routes`：能力首选和路由策略。
- `capability_health_snapshots`：配置与依赖健康快照。
- `tool_invocation_attempts`：一次解析下的各候选尝试。

建议 API：

- `GET /api/system/capability-graph`
- `GET /api/system/capabilities/:id/impact`
- `GET /api/system/tools/:id/status-impact`
- `PATCH /api/system/tools/:id/status`
- `POST /api/system/capabilities/:id/check`
- `GET /api/system/invocations/:resolutionId`

现有信息槽位设置迁移为 `capability_routes.preferredPluginId`；工具和采集器设置可保留原文件，先由图服务聚合，稳定后再统一存储。

## 9. 实施顺序

### 阶段 0：建立基线与防回退测试

- 固化现有工具、采集器、能力、技能和代码功能清单。
- 增加“代码直接调用能力必须有功能 Manifest”的静态测试。
- 修复当前无法正常解析的 `skill.json`，否则依赖清单不可信。

实施状态：已完成。功能消费者登记在 `config/capability-consumers.json`，基线由 `npm run capability:baseline` 生成到 `docs/tool-call-chain-baseline.json`；静态测试会双向检查生产调用点、调用标记与功能依赖声明。经 Node UTF-8 解析复核，当前 35 份内置 `skill.json` 均可正常解析；此前 PowerShell 输出的乱码和解析报错属于终端编码问题，不是文件 JSON 损坏。

### 阶段 1：统一依赖图（只读）

- 引入 Consumer/Dependency/Route 聚合服务。
- 合并 `skill.json`、活动配置、功能 Manifest、工具 Manifest 和采集 Manifest。
- 提供能力图与影响分析 API，不改变运行行为。

实施状态：已完成。`CapabilityGraph` 聚合技能 Manifest、技能活动授权、编码功能 Manifest、工具实现、采集实现和启用采集源；提供 `GET /api/system/capability-graph`、`GET /api/system/tools/:id/status-impact` 与 `GET /api/system/collectors/:id/status-impact`。影响分析仅模拟停用后的阻断、降级和剩余候选，不修改现有设置或执行路由。

### 阶段 2：页面可视化

- 能力配置改为消费者、能力、候选链三层视图。
- 工具运行增加影响范围和停用预览。
- 增加调用链查看器和端到端就绪状态。

实施状态：已完成。现有“能力配置”统一展示普通工具能力与采集能力，支持按状态、能力、消费者和实现筛选，并显示消费者依赖与候选工具链；“工具运行”的普通工具和采集工具均增加只读“影响范围”，展示模拟停用后的阻断、降级和剩余实现。本阶段没有修改启停行为。

### 阶段 3：状态变更门禁

- 所有工具/采集器停用与卸载走 impact preview。
- 阻止断开最后一个必需实现。
- 区分“禁止新任务”和“终止所有使用”。

实施状态：已完成。内置工具、本地工具、远程工具、采集工具和采集插件的停用/卸载均先计算统一影响；必需能力失去最后实现时返回冲突并阻止操作，存在切换或降级时要求携带最新 `impactVersion` 确认。影响版本在执行前重新计算，避免按过期预览修改状态。当前停用语义为“禁止新任务使用”，历史执行记录、采集源和快照继续保留；在途快照占用的精确门禁留待阶段 5 完成。

### 阶段 4：统一运行时解析

- 业务代码统一通过 `CapabilityRuntime.execute({consumerId, capability})`。
- 普通工具与采集器共享候选解析、健康判断、兜底规则和审计结构。
- 移除业务代码对 `ToolRegistry` 的直接访问。

实施状态：已完成。普通工具和采集器共享候选排序与失败分类策略，并支持执行级逐候选兜底；配置/依赖缺失、网络、超时及显式可重试错误可进入下一实现，非法输入、权限拒绝、输出契约错误、选择器不匹配和主动取消不会兜底。普通工具审计新增 `resolutionId / attempt / fallbackFrom / consumerId`，采集结果新增 `attempts / fallbackUsed`。排版、图片上传和图表预览等编码触发已收敛到要求显式 `consumerId` 的 `CapabilityRuntime`；系统管理与健康检查仍直接读取注册表，但不属于业务执行入口。

### 阶段 5：快照与执行审计

- 快照分别冻结能力授权、路由策略和解析结果。
- 增加严格复现/兼容兜底策略。
- 执行日志记录 consumer、resolution、attempt 和 fallback 链。

实施状态：已完成。新生成快照升级为 schema v2，在保留旧 `tools` 字段兼容读取的同时，分别保存 `capabilityAuthorization`、`capabilityRoutes`、`resolutionPolicy` 和 `resolvedImplementations`。旧 schema v1 快照继续采用严格插件版本复现；v2 默认允许同能力兼容兜底。`tool_executions` 已迁移增加 `resolution_id / attempt / fallback_from / consumer_id`，并提供 `GET /api/system/tool-invocations/:resolutionId` 查询一次能力调用的完整候选尝试链。

### 阶段 6：清理旧模型

- 将 `allowedTools` 改为能力授权覆盖层，不再承担依赖声明。
- 迁移并下线 `information-capability-slots.json`。
- 删除旧的分散健康判断和直接状态修改接口。

实施状态：已完成兼容迁移与停止前端读写。`allowedTools` 仅作为旧字段兼容输入，运行配置会同步规范化为 `capabilityAuthorization`；新任务快照只把它作为授权覆盖层，不再作为技能依赖真源。信息槽位首选实现通过 `npm run capability:migrate-routes` 幂等迁移到 `data/capability-routes.json`，旧槽位 API 暂时代理统一存储，技能与工具页面已经停止加载和写入旧 API。旧文件保留只读兼容，后续版本可在迁移覆盖确认后物理删除。

## 10. 本轮建议边界

下一步先实施阶段 0 和阶段 1。此时只增加清单、图服务、审计测试与只读 API，不立即修改工具执行和停用行为。依赖图经过页面核对后，再启用强制门禁，可避免因为当前声明缺失而错误阻止生产流程。
