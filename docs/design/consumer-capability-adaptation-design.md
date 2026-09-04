# 消费者—能力—工具实现统一治理方案

状态：已实施完成（2026-08-14，阶段 0-6 全部落地；阶段 6 交付：治理门禁 `scripts/quality/check-consumer-capability-gates.mjs` + CI 步骤、`social-custom` 别名保留兼容并标记弃用、威胁模型 §1.8、工具调用链基线重生成）
日期：2026-08-14  
适用范围：编辑室 Agent、自主写作 Agent、自定义图文 Agent，以及后续接入统一能力体系的流水线消费者  
现状汇总：能力拓展的操作视图见 [capability-expansion-guide.md](./capability-expansion-guide.md)（2026-08-15）

## 1. 背景与现状判断

当前工具体系已经基本完成“能力到工具实现”的治理：

```text
capability
  → 已安装实现
  → 启用状态
  → 优先级
  → 健康检查
  → 候选实现与失败兜底
```

内置工具的启停、优先级和实现选择目前没有明显结构性问题。生产调用也已经以 capability 为稳定接口，消费者通常不直接依赖具体插件。

目前缺失的是前半段的统一登记和可视化：

```text
消费者
  → 是否声明某项能力
  → 是否完成资源与参数适配
  → 当前技能是否授权
  → 当前请求是否具备资源及操作授权
  → capability
```

这些信息现在分散在 Agent Adapter 常量（`server/platform/agent/editorial-adapter.mjs`、`tutorial-adapter.mjs`、`custom-social-adapter.mjs`）、技能 Manifest（`requiredCapabilities`/`optionalCapabilities`）、活动技能配置（`writing-skills/<skillId>/active.json`）、路由授权逻辑、资源映射代码及确定性 ToolCall 触发逻辑中。

需要明确指出的现状基座：

- `server/platform/tools/capability-graph.mjs` 已实现目录、消费者、实现、路由的聚合，并计算 `ready/degraded/blocked/unused` 状态及停用影响分析（`analyzeImplementationImpact`），通过 `GET /api/system/capability-graph` 对外暴露；
- `config/capability-consumers.json` 已有 4 条 feature 消费者登记（capability、requirement、failurePolicy），由 `server/platform/tools/dependency-baseline.mjs` 读取并入图谱；技能消费者目前由运行时从 SkillRegistry 动态聚合，三个 Agent Adapter 尚未纳入；
- 三个 Adapter 各自重复维护资源发现、resourceId 映射、`allowedRoots` 组装与授权检查，公共收敛点仅有 `tool-executor.mjs` 的 `CAPABILITY_NOT_VISIBLE` 校验。

因此本方案是**在上述图谱与消费者登记基座上扩展“消费者→能力”维度**，而非新建独立的第二套状态计算与登记体系。运行时虽然能够工作，但配置中心无法完整回答：

- 某个消费者能使用哪些能力；
- 为什么某项能力当前可用或不可用；
- 在技能配置中勾选某项能力后是否真的能够执行；
- 某项能力最终会路由到哪个工具实现；
- 停用某个实现会影响哪些消费者。

## 2. 核心结论

本次改造不重做工具实现启停机制，而是在现有体系上补齐“消费者到能力”这一层。

目标关系为：

```text
消费者
  ↓ 声明、适配、授权
能力 capability
  ↓ 启用、优先级、健康状态
工具实现 plugin implementation
```

基础工具可以被多个消费者复用，但“工具存在”不等于“消费者已经接入”。消费者必须具备对应的资源发现、参数转换、权限边界和结果清洗能力，才能把该 capability 标记为已适配。

## 3. 设计原则

1. capability 是消费者与工具实现之间唯一稳定接口，消费者不得绑定具体插件 ID。
2. 工具实现启停与消费者授权分层管理，避免把全局停用和单技能禁用混为一谈。
3. 配置不能制造虚假可用性。缺少资源适配器时，即使技能勾选了能力也不得显示为可用。
4. 所有可用状态必须可由登记数据和运行状态确定性计算，不能依靠页面推测。
5. 本地路径、凭据、allowedRoots 等敏感信息不进入模型工具目录和普通配置响应。
6. 现有三个 Agent 先迁移，其他流水线消费者后续按同一协议逐步纳入。
7. 改造期间保留现有调用行为，先建立只读视图，再切换配置写入和运行时消费。

## 4. 统一概念模型

### 4.1 消费者 Consumer

消费者是发起 capability 调用的稳定业务单元，不等同于插件或模型供应商。

首批消费者：

- `agent.editorial`：编辑室 Agent；
- `agent.independent-writing`：自主写作 Agent；
- `agent.custom-social`：自定义图文 Agent。

后续可纳入：

- 文章生成流水线；
- 图文生成与交付流水线；
- 热点采集、事件卡和研判流水线；
- 排版、图表和图片处理流水线。

### 4.2 能力 Capability

能力是稳定业务接口，例如：

- `cap_filesystem_project_read`；
- `cap_content_url_fetch`；
- `cap_content_document_search`；
- `cap_content_web_search`；
- `cap_content_news_search`；
- `cap_content_repository_inspect`；
- `cap_content_passage_retrieve`。

### 4.3 工具实现 Implementation

工具实现是某个 capability 的具体提供者，保留现有插件 Manifest、启停、优先级、健康检查和候选链机制。

### 4.4 消费者能力适配 Consumer Capability Adaptation

登记载体：**扩展 `config/capability-consumers.json`**，将三个 Agent 及后续流水线消费者并入该文件，schema 增加适配相关字段。不新建第二套登记格式，Agent Adapter 中的能力常量迁移后改为从登记派生或仅作校验。

权威源裁定：消费者—能力关系以 `capability-consumers.json` 为唯一权威源；技能 Manifest 的 `requiredCapabilities`/`optionalCapabilities` 是技能包对消费者能力的引用声明，加载时与登记做一致性校验（声明了未登记的能力即报错），不再作为关系定义的独立来源。

每条消费者—能力关系至少登记：

```json
{
  "consumerId": "agent.editorial",
  "capability": "cap_filesystem_project_read",
  "declaration": "optional",
  "adapterStatus": "ready",
  "resourceKinds": ["local-project"],
  "triggerPolicy": "explicit-resource",
  "authorizationAction": "local-project-read",
  "resultPolicy": "editorial-material",
  "source": "builtin"
}
```

字段含义：

- `declaration`：`required | optional`，表示入口契约要求；
- `adapterStatus`：`ready | missing | degraded`，表示资源和参数适配是否完成；
- `resourceKinds`：消费者能映射为该能力输入的资源类型；
- `triggerPolicy`：`model-request | explicit-resource | deterministic-first-step`；
- `authorizationAction`：需要的本地敏感操作确认类型；
- `resultPolicy`：工具结果进入哪个业务解释器；
- `source`：内置登记、技能扩展或第三方扩展。

## 5. 最终可用状态计算

消费者某项能力的运行可用状态应由服务端统一计算。**该计算必须实现为 `server/platform/tools/capability-graph.mjs` 现有状态聚合的扩展**（在其消费者维度上增加声明、适配、技能授权三个因子），页面与运行时读取同一份计算结果，不得另建平行状态机：

```text
available =
  consumerDeclared
  && adapterReady
  && skillAllowed
  && implementationEnabled
  && implementationHealthy
```

请求级是否可以实际调用还需要附加：

```text
callableForRequest =
  available
  && resourcePresent
  && requestAuthorized
  && policyAllowed
```

其中：

- `consumerDeclared`：消费者入口契约声明该能力；
- `adapterReady`：存在资源发现、resourceId 映射、参数解析和结果清洗；
- `skillAllowed`：当前活动技能配置没有禁用该能力；
- `implementationEnabled`：至少存在一个启用实现；
- `implementationHealthy`：实现凭据和健康检查满足运行要求；
- `resourcePresent`：本次请求确实提供了可使用的资源；
- `requestAuthorized`：本地读取、上传等敏感操作已获得本次授权；
- `policyAllowed`：风险级别、根目录和入口策略允许执行。

状态必须返回原因码，例如：

- `CONSUMER_NOT_DECLARED`；
- `ADAPTER_MISSING`；
- `SKILL_NOT_ALLOWED`；
- `NO_ENABLED_IMPLEMENTATION`；
- `IMPLEMENTATION_UNHEALTHY`；
- `RESOURCE_NOT_PRESENT`；
- `CONFIRMATION_REQUIRED`。

## 6. 配置中心信息架构

### 6.1 保留现有工具实现视图

继续展示：

- 工具实现及版本；
- 提供的 capability；
- 启用状态；
- 优先级；
- 健康状态；
- 配置和凭据状态；
- 最近运行记录；
- 候选实现及兜底顺序。

### 6.2 新增消费者能力视图

推荐在“技能与工具能力配置”中新增“消费者接入”页签，核心表格如下：

| 消费者 | 能力 | 已声明 | 已适配 | 技能授权 | 实现可用 | 最终状态 |
|---|---|---:|---:|---:|---:|---|
| 编辑室 Agent | 本地项目读取 | 是 | 是 | 是 | 是 | 可用 |
| 自主写作 Agent | 本地项目读取 | 是 | 是 | 是 | 是 | 可用 |
| 自定义图文 Agent | 本地项目读取 | 否/待定 | 否 | — | 是 | 缺少接入 |
| 自定义图文 Agent | 仓库分析 | 是 | 是 | 是 | 是 | 可用 |

展开一行后展示：

- 消费者和技能 ID；
- capability；
- 资源类型；
- 触发策略；
- 是否需要确认；
- 参数适配器；
- 结果处理策略；
- 当前候选工具实现；
- 不可用原因及修复入口。

### 6.3 配置操作边界

第一阶段页面只读，先验证登记准确性。

后续允许修改的仅是：

- 技能是否允许某项已适配能力；
- 可选能力的启用/停用；
- 工具实现全局启停与优先级。

以下内容不能通过普通勾选动态产生：

- 新的资源发现器；
- 新的参数转换器；
- 新的权限动作；
- 新的结果业务解释器。

如果能力存在但消费者未适配，页面显示“缺少适配”，不得提供误导性的启用开关。

## 7. 三个 Agent 的目标登记

### 7.1 编辑室 Agent

建议登记：

- `cap_filesystem_project_read`：明确路径时确定性首步调用；
- `cap_content_url_fetch`：用户提供 URL 或事件来源时按需调用；
- `cap_content_passage_retrieve`：长来源材料检索；
- `cap_content_web_search`：按需补充公开资料；
- `cap_content_news_search`：按需补充新闻资料。

结果策略：工具内容属于事实材料；本地项目材料只有结合用户明确亲身使用陈述时才能写入体验。

### 7.2 自主写作 Agent

建议登记：

- `cap_filesystem_project_read`；
- `cap_content_url_fetch`；
- `cap_content_document_search`；
- `cap_content_passage_retrieve`；
- `cap_content_web_search`；
- `cap_content_news_search`。

结果策略：写入事实附件和表单素材；工具结果不得自动升级为作者体验。

### 7.3 自定义图文 Agent

当前建议登记已有适配：

- `cap_content_url_fetch`；
- `cap_content_repository_inspect`；
- `cap_content_document_search`；
- `cap_content_web_search`；
- `cap_content_news_search`。

`cap_filesystem_project_read` 在未完成资源接入前显示为“工具存在、消费者未适配”，不因工具已启用而自动开放。

## 8. 服务端接口建议

沿用现有 `/api/system/` 命名空间，不新增 `/api/capabilities` 平行路径。新增只读接口：

```text
GET /api/system/capability-consumers
GET /api/system/capability-consumers/:consumerId
GET /api/system/capability-graph   # 现有接口，扩展返回消费者维度状态与原因码
```

消费者详情建议返回：

```json
{
  "consumerId": "agent.editorial",
  "name": "编辑室 Agent",
  "skillId": "editorial-room-chat",
  "capabilities": [
    {
      "capability": "cap_filesystem_project_read",
      "declared": true,
      "adapterStatus": "ready",
      "skillAllowed": true,
      "implementationStatus": "healthy",
      "available": true,
      "reasons": [],
      "implementations": [
        {"pluginId": "local-project-reader", "enabled": true, "priority": 100}
      ]
    }
  ]
}
```

配置写接口复用现有统一扩展配置服务，不另建第二套白名单：

```text
PUT /api/system/skills/:skillId/configuration   # 现有接口，见 system-routes.mjs
```

## 9. 运行时收敛方向

三个 Adapter 目前仍可保留业务结果解释，但以下通用逻辑应逐步下沉：

- 消息中的本地路径与 URL 识别；
- 资源 ID 建立；
- 本次请求授权检查；
- `allowedRoots` 生成；
- 通用 capability 参数转换；
- 通用工具结果裁剪和敏感字段清洗；
- 确定性前置 ToolRequest 生成。

可形成统一组件：

```js
discoverConversationResources(input)
buildConsumerCapabilityCatalog(context)
resolveResourceArguments(request, resources)
sanitizeCapabilityResult(result, policy)
buildInitialToolRequests(resources, adaptation)
```

Adapter 最终只保留：

- 业务 Prompt；
- 业务输出 Schema；
- 工具结果进入业务事实结构的规则；
- 入口特有门禁。

## 10. 分阶段实施计划

### 阶段 0：冻结基线

- 扫描三个 Agent 当前能力常量、技能 Manifest、活动配置和资源适配代码；
- 生成消费者—能力—实现基线；
- 为现有行为增加快照和依赖一致性测试；
- 不改变运行时行为。

验收：基线能够解释三个 Agent 当前实际可用工具及不可用原因。

### 阶段 1：消费者登记中心

- 扩展 `config/capability-consumers.json` schema，增加 `declaration`、`adapterStatus`、`resourceKinds`、`triggerPolicy`、`authorizationAction`、`resultPolicy` 字段；
- 将三个 Agent 的能力常量（`server/platform/agent/*-adapter.mjs` 中的 `*_AGENT_CAPABILITIES`）迁入登记，Adapter 改为读取登记或仅做一致性校验；
- 落实权威源裁定：技能 Manifest 的 capability 声明加载时与登记校验，声明了未登记能力即报错；
- 技能消费者保持运行时聚合，与文件登记合并入 `dependency-baseline.mjs`；
- 增加 Schema 校验和重复登记检查。

验收：消费者能力关系不再需要扫描多个 Adapter 才能得出；技能 Manifest 与登记不一致时启动即报错。

### 阶段 2：统一可用性计算

- 在 `capability-graph.mjs` 的消费者维度上扩展：聚合消费者声明、适配状态、技能配置、插件状态和健康状态；
- 输出稳定状态码和影响说明（复用现有 `ready/degraded/blocked/unused` 分级，补充消费者侧原因码）；
- 复用现有 `analyzeImplementationImpact` 实现消费者、能力、实现三个方向的反向查询，不新建平行计算。

验收：页面与运行时使用同一份服务端计算结果；`GET /api/system/capability-graph` 能直接回答任一消费者的任一能力为何可用或不可用。

### 阶段 3：配置页只读展示

- 增加“消费者接入”视图；
- 展示完整链路和不可用原因；
- 支持从消费者跳转能力、从能力跳转实现；
- 支持停用影响预览。

验收：无需阅读代码即可判断任一消费者为什么能或不能调用某项工具。

### 阶段 4：技能授权可编辑

- 对 `adapterStatus=ready` 的可选能力开放启停；
- 写入现有 `PUT /api/system/skills/:skillId/configuration` 与 `active.json` 的 `capabilityAuthorization`；
- 版本机制需先补强：现状仅有 `configHash()` 雏形和 `pipeline-runtime.mjs` 的快照冻结，缺少版本协商与冲突检测，本阶段需补齐后再开放写入；
- 变更前展示影响范围（复用 `analyzeImplementationImpact` 的消费者维度扩展）；
- 保留历史快照和历史任务复现能力。

验收：配置变更能够控制新会话工具目录，不影响历史运行快照。

### 阶段 5：通用资源适配层

- 抽取路径、URL、仓库和文档资源发现；
- 抽取 resourceId、allowedRoots、授权和结果清洗；
- 编辑室和自主写作先迁移；
- 自定义图文按产品需要决定是否接入本地项目读取。

验收：三个 Adapter 不再重复维护基础资源工具接线。

### 阶段 6：清理与治理门禁

- 删除已被统一登记替代的入口能力常量和重复解析逻辑；
- 更新 ToolCall 基线、威胁模型、API 文档和发布检查；
- 增加“配置声明但无适配”“适配存在但未登记”等反向门禁。

验收：消费者、能力和工具实现之间不存在隐式生产依赖。

## 11. 测试与验收清单

- 工具实现停用后，所有受影响消费者显示一致的不可用原因；
- 单技能禁用能力不影响其他消费者；
- 未适配能力不能通过配置勾选制造可用状态；
- 本地路径不会进入模型工具目录和审计明文参数；
- 敏感读取仍要求一次性确认；
- 历史 Agent run 保留当时的技能与能力快照；
- 工具实现优先级变化不需要修改消费者；
- 健康检查失败时展示候选实现或明确阻断原因；
- 页面展示状态与实际 ToolCall 结果一致；
- 三个 Agent 的现有回归测试在迁移各阶段持续通过。

## 12. 风险与边界

### 主要风险

- 把“工具已安装”错误解释为“消费者已适配”；
- 配置页与运行时分别计算状态，产生展示与执行不一致；
- 抽取资源层时破坏现有本地路径授权边界；
- 过早删除 Adapter 中的业务结果解释；
- 技能活动配置与历史 generation snapshot 语义漂移。

### 明确边界

- 本方案不改变插件安装与实现启停的基本机制；
- 本方案不在第一阶段开放第三方动态资源适配器；
- 本方案不允许模型直接获得本地绝对路径或 allowedRoots；
- 本方案不把工具材料自动认定为作者体验；
- 本方案不要求一次性迁移全部非 Agent 流水线消费者。

## 13. 实施记录与接续建议

阶段 0-6 已于 2026-08-14 全部实施完成。已知遗留（记录在案，不在本期实施）：

- ~~tutorial/custom-social 的资源目录不含已抓取正文（无 `content` 字段），passage.retrieve 的 resourceIds 严格分支在这两个入口会拒绝，实际走插件原生 documents 透传~~ 已实施回填（2026-08-16）：`fact-attachment` 结果处理器把 url.fetch 正文写回资源目录条目，严格分支随之可用；无 resourceIds 时的透传回退保留；
- `social-custom` 历史入口名仅保留读取兼容（`server/platform/skills/entry-routing.mjs` 别名 + API.md 弃用标注），不删除。
- `expectedVersion` 已改为强制必传（阶段 6，`saveSkillAuthorization` 服务端校验，缺失返回 400）；前端与既有调用方均已总传，无兼容面。

登记载体的开放问题已裁定：采用**扩展 `config/capability-consumers.json`** 作为唯一权威源（见 4.4），不采用独立 Manifest、不扩展技能包契约、不新建代码注册表。理由：该文件已被 `dependency-baseline.mjs` 和 `capability-graph.mjs` 消费，扩展它可以在不新增平行体系的前提下完成登记；技能 Manifest 保持引用声明角色并接受一致性校验。
