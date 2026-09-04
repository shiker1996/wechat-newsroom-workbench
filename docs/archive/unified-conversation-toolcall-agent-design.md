# 通用对话 ToolCall Agent 设计与实施方案

> 类别：未来计划  
> 状态：Phase 0–5 已完成  
> 版本：v1.6  
> 日期：2026-08-14  
> 适用入口：热点编辑室、自主写作、自定义图文  
> 前置文档：[工具调用链与依赖治理重构方案](./tool-call-chain-and-dependency-refactor.md)、[技能与工具扩展能力方案](./skill-and-tool-extension-plan.md)

## 1. 决策摘要

在现有 `capability -> plugin` 工具底座之上增加统一的**对话 Agent 调度层**，让热点编辑室、自主写作和自定义图文共用同一种 ToolCall 协议、权限校验、循环执行、流式事件和审计模型，同时保留各入口独立的事实契约、表单门禁和业务状态机。

本方案不建设可执行任意代码的通用自动化平台。模型只能从服务端按入口、技能和运行快照裁剪后的能力目录中申请工具；服务端始终拥有最终执行权。首期只开放只读信息能力，不向对话 Agent 开放外部写入、Shell、任意文件写入、插件安装或配置修改。

核心执行模型：

```text
用户输入
  ↓
入口适配器构建业务上下文与允许能力集
  ↓
模型返回 final 或 tool_requests
  ↓
服务端执行 Schema、权限、资源范围、预算和业务约束校验
  ↓
能力路由选择插件并执行
  ↓
标准 ToolResult 写入审计并回送模型
  ↓
循环，直到 final、达到上限或需要用户确认
  ↓
入口适配器验证并保存表单 / 编辑决策
```

## 2. 背景与现状

### 2.1 已有基础

当前已经具备：

- 工具 Manifest、能力注册表、插件启停与优先级；
- `allowedCapabilities` 技能授权；
- 路径白名单、外部写入授权和风险等级检查；
- 能力首选实现与兼容候选；
- 工具执行日志和生成快照；
- NDJSON 对话流；
- 三个入口各自的结构化输出和确定性门禁。

因此无需重建工具系统，缺失的是位于 LLM 网关和能力注册表之间的对话级调度器。

### 2.2 三条现有链路

| 入口 | 当前触发方式 | 当前工具 | 主要缺口 |
| --- | --- | --- | --- |
| 热点编辑室 | 服务端识别 URL；模型返回 `fetchEvents[]`；provider `webSearch` | URL 抓取、事件原文、段落检索 | `fetchEvents` 是专用协议；工具结果不会在同轮再次交给模型 |
| 自主写作 | 服务端识别本地路径；创建时固定批量检索 | 本地项目、URL、网络、新闻、文档 | 模型不能按材料缺口选择工具与查询词 |
| 自定义图文 | provider `webSearch`；创建时固定批量检索 | URL、网络、新闻、文档、仓库分析 | 对话期无显式本地 ToolCall，调用不可见且难统一审计 |

三者共用了工具底座，但没有共用 Agent 调度层。

## 3. 目标与非目标

### 3.1 目标

1. 三个对话入口使用统一的 ToolCall 请求、结果和错误协议。
2. 支持同一轮内最多若干次 `模型 → 工具 → 模型` 循环。
3. 工具目录由入口、技能授权、插件状态和运行快照共同裁剪。
4. 每次调用可追溯到对话、批次、候选、技能、模型调用和生成快照。
5. 前端实时展示工具申请、执行、成功、失败与降级，不暴露敏感参数。
6. 保留现有确定性门禁；Agent 的 `final` 不等于业务就绪或允许生成。
7. 现有 `fetchEvents`、路径自动识别和创建时检索在迁移期保持兼容。

### 3.2 非目标

- 不开放 Shell、任意脚本或任意本地文件写入。
- 不允许模型安装、启停、配置或选择具体插件。
- 不允许模型绕过事实来源等级、质量门禁和人工确认。
- 不追求跨请求长期自主运行；首期仅在一次 HTTP 对话请求内有限循环。
- 不把成稿、排版、图片上传等长任务塞进对话 Agent；它们继续由后台任务管线负责。
- 不以模型提供商私有 ToolCall 格式作为领域协议的单一真源。

## 4. 设计原则

1. **模型申请，服务端裁决**：模型没有直接执行权。
2. **能力而非插件**：模型只看到 `cap_content_url_fetch` 等稳定能力，不看到插件 ID。
3. **最小权限**：可见能力取入口声明、技能授权和当前可用能力的交集。
4. **只读优先**：首期仅开放 `riskLevel=read-only`。
5. **参数收口**：优先让模型提交业务 ID，服务端解析真实 URL 和路径。
6. **结果有界**：工具结果先标准化和压缩，再进入模型上下文。
7. **业务门禁独立**：模型输出必须经过入口自己的 Schema 和程序门禁。
8. **可退化**：工具缺失或失败时允许明确降级，不制造“已读取/已搜索”假象。
9. **历史不漂移**：对话轮冻结能力目录摘要；后台生成继续使用 generation snapshot。
10. **可观察但不泄密**：UI 展示能力、原因、状态和来源，不展示密钥、绝对路径全文或原始敏感参数。

## 5. 总体架构

新增目录建议：

```text
server/platform/agent/
  conversation-agent.mjs       # 有限循环调度器
  tool-protocol.mjs            # ToolRequest / ToolResult Schema 与清洗
  tool-catalog.mjs             # 按入口和技能裁剪模型可见目录
  tool-executor.mjs            # 校验、能力路由、执行与结果标准化
  budgets.mjs                  # 轮次、调用、字符、时间预算
  context.mjs                  # ToolResult 压缩与上下文拼装
  events.mjs                   # NDJSON 事件构造
  adapters/
    editorial-agent.mjs
    tutorial-agent.mjs
    custom-social-agent.mjs
```

模块职责：

| 模块 | 职责 |
| --- | --- |
| `conversation-agent` | 调用模型、识别 final/tool_requests、执行有限循环、处理中止 |
| `tool-catalog` | 合并入口能力、技能授权、插件健康和风险策略，生成模型工具目录 |
| `tool-executor` | 参数 Schema、业务资源解析、权限检查、插件执行、错误归一化 |
| `context` | 对网页、搜索、文档和项目结果做长度控制、去重和来源保留 |
| `events` | 统一输出 `tool.requested/running/completed/failed` 事件 |
| 入口 Adapter | 构建业务上下文、声明能力与资源范围、验证并保存最终业务输出 |

## 6. 统一协议

### 6.1 模型响应信封

模型每一步只能返回以下两种状态之一：

```json
{
  "type": "tool_requests",
  "assistant_note": "需要核对项目说明和相关公开资料。",
  "requests": []
}
```

或：

```json
{
  "type": "final",
  "assistantReply": "...",
  "output": {}
}
```

禁止同一步同时返回 `tool_requests` 和业务 `final`，避免服务端猜测执行顺序。

### 6.2 ToolRequest

```json
{
  "requestId": "tr_01",
  "capability": "cap_content_url_fetch",
  "arguments": {
    "resourceId": "source:123"
  },
  "reason": "需要核对文章所依赖的具体数据和上下文"
}
```

字段规则：

- `requestId`：单轮唯一，仅用于关联事件和结果；
- `capability`：必须来自本轮可见工具目录；
- `arguments`：必须通过能力输入 Schema；
- `reason`：面向用户的简短原因，最长 160 字；
- 不接受插件 ID、凭据、超时、白名单根目录等运行参数。

### 6.3 ToolResult

```json
{
  "requestId": "tr_01",
  "capability": "cap_content_url_fetch",
  "status": "ok",
  "data": {
    "resourceId": "source:123",
    "title": "...",
    "excerpt": "...",
    "sourceUrl": "https://...",
    "truncated": true
  },
  "warnings": [],
  "provenance": {
    "provider": "web-page-fetch",
    "fetchedAt": "2026-08-14T00:00:00.000Z"
  }
}
```

错误结果：

```json
{
  "requestId": "tr_01",
  "capability": "cap_content_url_fetch",
  "status": "error",
  "error": {
    "code": "RESOURCE_NOT_ALLOWED",
    "message": "该资源不属于当前选题且未由用户提供",
    "retryable": false
  }
}
```

模型只接收清洗后的结果；完整插件原始结果按现有规则留在服务器侧，不进入对话历史。

### 6.4 能力描述

模型可见目录采用领域友好的 JSON：

```json
{
  "capability": "cap_filesystem_project_read",
  "name": "读取已授权本地项目",
  "description": "只读提取项目结构和支持的文本文件，不执行代码",
  "inputSchema": {
    "type": "object",
    "properties": {
      "resourceId": { "type": "string" },
      "query": { "type": "string", "maxLength": 200 }
    },
    "required": ["resourceId"]
  }
}
```

本地绝对路径不直接暴露为模型可自由填写的参数。用户输入路径后，入口适配器先创建只在当前请求有效的 `resourceId`，执行器再解析成真实路径。

## 7. 运行循环

伪代码：

```js
for (let step = 0; step < budget.maxModelSteps; step += 1) {
  const response = await model.complete({ messages, tools: visibleCatalog });
  const action = parseAgentEnvelope(response);
  if (action.type === 'final') return adapter.commit(action.output);
  const requests = validateAndDedupe(action.requests);
  const results = await executeAllowedRequests(requests, executionContext);
  messages.push(agentToolRequestMessage(action));
  messages.push(toolResultsMessage(results));
}
return adapter.finishWithLimitNotice();
```

首期默认预算：

| 项目 | 默认值 | 硬上限 |
| --- | ---: | ---: |
| 模型步骤 | 3 | 5 |
| 单轮工具调用总数 | 5 | 8 |
| 同一步并行调用 | 3 | 4 |
| 单次 ToolResult 注入字符 | 8,000 | 16,000 |
| 单轮全部 ToolResult 字符 | 24,000 | 48,000 |
| Agent 总耗时 | 90 秒 | 90 秒 |
| 相同能力与参数重复次数 | 1 | 1 |

互不依赖的只读请求可并行；本地项目读取与基于项目内容的检索必须顺序执行。达到预算时返回明确提示和当前已有结果，不静默继续，也不自动扩大预算。

## 8. 三入口适配

### 8.1 热点编辑室

允许能力：

- `cap_content_url_fetch`
- `cap_content_passage_retrieve`
- `cap_content_web_search`
- `cap_content_news_search`（按需，默认不主动使用）

业务资源：

- `event:<event_id>`：当前候选关联事件；
- `source:<hotspot_id>`：当前事件下来源；
- `candidate-source:<id>`：用户在编辑室补充的 URL；
- 用户本轮粘贴的新 URL，经安全校验后生成临时资源 ID。

迁移：

1. 把 `fetchEvents[]` 映射为 `cap_content_url_fetch` 的兼容 ToolRequest；
2. 保留用户 URL 前置抓取，随后改为由适配器自动生成请求；
3. 将 `editorialRetrieve()` 纳入执行器；
4. 最终移除编辑室专用 `fetchEvents` 字段；
5. `candidateUpdates` 和 `editorial` 继续使用现有门禁与锁定逻辑。

### 8.2 自主写作

允许能力：

- `cap_filesystem_project_read`
- `cap_content_url_fetch`
- `cap_content_web_search`
- `cap_content_news_search`
- `cap_content_document_search`
- `cap_content_passage_retrieve`

业务约束：

- 只有用户明确提供或通过页面选择的目录才能成为项目资源；
- 不允许模型枚举磁盘或切换到父目录；
- 项目文件是 `user_material`，不能自动证明作者亲测；
- 体验模式把素材升级为 `author_experience` 仍须用户明确确认；
- Agent 只补齐事实表，不直接启动成稿。

迁移：

1. 把路径自动读取包装为适配器生成的首个 ToolRequest；
2. 允许模型按缺口请求项目读取、网页或文档检索；
3. 把创建阶段固定执行的 `attachInformationSearch()` 改为兜底补充；
4. 已存在于对话事实基座中的成功结果按查询指纹复用，避免重复计费；
5. 最终输出仍由 `evaluateTutorialChatReadiness()` 复核。

### 8.3 自定义图文

允许能力：

- `cap_content_url_fetch`
- `cap_content_web_search`
- `cap_content_news_search`
- `cap_content_document_search`
- `cap_content_repository_inspect`
- `cap_content_passage_retrieve`

业务约束：

- 搜索结果只能成为 `【素材】`，不得成为 `【体验】`；
- 外部素材必须保留 URL 和来源归属；
- 仓库分析只接受用户提供或候选已绑定的仓库；
- Agent 负责补齐图文事实表，不负责生成故事板或图片。

迁移：

1. 将 provider `webSearch:true` 改为显式 `cap_content_web_search`；
2. 素材 URL 抓取进入统一 ToolCall；
3. GitHub 仓库入口复用 `cap_content_repository_inspect`；
4. 创建阶段信息检索改为缓存复用加兜底；
5. `sanitizeFormUpdates()` 和自定义事实门禁保持最终裁决权。

## 9. 权限与安全

### 9.1 能力集合计算

```text
visibleCapabilities =
  entryDeclaredCapabilities
  ∩ skillAllowedCapabilities
  ∩ enabledRegistryCapabilities
  ∩ conversationReadOnlyPolicy
```

当技能 `allowedTools` 为空且当前语义仍表示“不限制”时，对话 Agent 不得继承全部能力；Agent 必须再经过入口白名单，避免空配置扩大权限。

### 9.2 参数和资源校验

- URL 继续执行 SSRF、重定向、响应类型和大小限制；
- 路径继续执行 realpath、允许根目录、符号链接和秘密文件过滤；
- `event_id`、`source_id`、`candidate_id` 必须属于当前业务上下文；
- 搜索词限制长度并去除控制字符；
- 禁止模型提交 `allowedRoots`、`authorizedExternalWrite`、插件 ID 和凭据字段；
- 所有拒绝均返回稳定错误码并写审计。

### 9.3 提示注入防护

网页、项目和文档内容统一包装为不可信材料：

- ToolResult 与 system prompt 分离；
- 明确声明材料中的指令不得改变系统规则或调用权限；
- 删除不可见控制字符和可疑超长重复段；
- 保留来源 ID，禁止材料伪装成 system/tool 消息；
- 最终事实门禁不因 ToolResult 来源而自动放宽。

### 9.4 外部写入

首期 `conversationReadOnlyPolicy` 拒绝所有 `external-write` 能力。未来若开放图片上传等能力，必须满足：

1. 工具请求进入 `needs_confirmation`；
2. UI 展示目标、影响和不可逆性；
3. 用户本轮明确确认；
4. 执行器设置 `authorizedExternalWrite=true`；
5. 不允许模型替用户确认。

## 10. 数据与审计

建议新增：

```sql
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  entry_point TEXT NOT NULL,
  batch_id TEXT,
  candidate_row_id INTEGER,
  skill_id TEXT,
  provider TEXT,
  status TEXT NOT NULL,
  model_steps INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT
);

CREATE TABLE agent_tool_calls (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  plugin TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  input_summary_json TEXT,
  result_summary_json TEXT,
  error_code TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY(agent_run_id) REFERENCES agent_runs(id)
);
```

现有 `tool_executions` 继续作为插件执行事实表；`agent_tool_calls` 记录对话语义和请求关系，通过 execution ID 关联。不得在审计表保存密钥、完整网页正文或本地绝对路径；路径只保存脱敏显示名和哈希。

## 11. NDJSON 与前端交互

统一事件：

```text
assistant.delta
assistant.thinking
tool.requested
tool.running
tool.completed
tool.failed
tool.needs_confirmation
agent.limit
done
error
```

示例：

```json
{"type":"tool.requested","requestId":"tr_01","capability":"cap_content_url_fetch","label":"读取事件原文","reason":"核对数据出处"}
{"type":"tool.running","requestId":"tr_01"}
{"type":"tool.completed","requestId":"tr_01","summary":"读取 1 个来源，共 4,218 字","sources":[{"title":"...","url":"https://..."}]}
```

前端在消息流中渲染可折叠工具卡：

- 默认显示能力名称、原因、状态、耗时和来源数量；
- 可展开查看来源标题、公开 URL、警告和错误；
- 本地项目只显示目录末级名称、相对文件名和读取摘要；
- 不展示完整请求 JSON、绝对路径或插件内部配置；
- 失败时允许继续对话，不把工具失败伪装成模型回答；
- 沉浸模式和普通模式使用相同组件。

## 12. 与 LLM 网关的关系

领域协议保持 provider-neutral。首期可继续用 `jsonMode` 让模型返回统一信封；后续在网关中增加适配器：

```text
统一 Tool Catalog
  ├─ OpenAI-compatible tools/function calling
  ├─ Anthropic tool_use
  └─ 无原生工具模型：JSON 信封回退
```

无论提供商原生格式如何，上层只接收统一 `ToolRequest[]`。Provider 自带 `webSearch` 应逐步退出三个对话入口，改走 `cap_content_web_search`，从而进入统一权限、费用、来源和执行审计。成稿等非对话任务可暂时继续使用原能力。

## 13. 失败、重试与恢复

| 场景 | 行为 |
| --- | --- |
| 模型返回无效信封 | 使用更小的格式修复提示重试一次，仍失败则结束本轮 |
| 请求未知能力 | 返回 `CAPABILITY_NOT_VISIBLE`，不执行 |
| 参数不合规 | 返回 `INVALID_TOOL_ARGUMENTS`，允许模型修正一次 |
| 资源越界 | 返回 `RESOURCE_NOT_ALLOWED`，禁止重试同参数 |
| 插件不可用 | 按注册表候选兜底；全部失败返回标准错误 |
| 工具超时 | 返回 `TOOL_TIMEOUT`；是否继续由模型在剩余预算内决定 |
| Agent 达到上限 | 返回当前部分结果，并询问用户是否下一轮继续 |
| 客户端断开 | 中止尚未开始的调用；已开始的只读调用可完成审计但不再调用模型 |
| 服务重启 | 首期不恢复进行中 Agent；持久化状态标记 `interrupted` |

同一轮按 `capability + normalized arguments` 去重。成功结果建立短期缓存；创建阶段可按对话运行 ID 和查询指纹复用。

## 14. 兼容与迁移策略

采用旁路迁移，不一次重写三个入口：

1. 新增 Agent 运行时但默认关闭；
2. Adapter 在关闭时调用旧链，在开启时调用新链；
3. 旧 `fetchEvents` 转换为兼容 ToolRequest；
4. 旧路径自动读取和素材 URL 抓取作为 `system_generated=true` 的请求进入新审计；
5. 创建阶段保留 `attachInformationSearch()` 兜底，若对话已有同指纹成功结果则跳过；
6. 按入口灰度：编辑室 → 自主写作 → 自定义图文；
7. 三入口稳定后移除 provider 对话 `webSearch:true` 和入口专用 ToolCall 字段。

当前生产配置只保留安全预算；三个入口固定使用统一 Agent：

```json
{
  "conversationAgent": {
    "maxModelSteps": 3,
    "maxToolCalls": 5,
    "timeoutMs": 90000
  }
}
```

## 15. 分阶段实施方案

### Phase 0：契约与基线

目标：不改变生产行为，冻结当前三条调用链。

- [x] 增加三入口现状调用链测试和能力矩阵；
- [x] 定义 ToolRequest、ToolResult、AgentEnvelope JSON Schema；
- [x] 固定错误码、NDJSON 事件名和预算默认值；
- [x] 标记现有 `fetchEvents`、路径读取、URL 抓取和 provider 搜索调用点；
- [x] 明确现有执行日志中缺失的 batch/candidate/skill 元数据。

实施产物：`server/platform/agent/contracts.mjs`、`server/platform/agent/schemas/*.schema.json`、`docs/conversation-agent-phase0-baseline.json`、`test/conversation-agent-phase0.test.mjs`。Phase 0 仅建立契约与回归基线，`productionAgentEnabled=false`，三个生产入口尚未导入 Agent runtime。

验收：Schema 测试通过；无生产逻辑变化；文档矩阵与代码调用点一致。

### Phase 1：只读 Agent Core

目标：实现 provider-neutral 的有限循环运行时。

- [x] 新建 `server/platform/agent/` 核心模块；
- [x] 实现目录裁剪、请求校验、去重、预算和中止；
- [x] 复用 ToolRegistry、策略检查和 execution logger；
- [x] 支持 provider-neutral 的 JSON 信封运行接口；原生 Function Calling 适配留在入口迁移时补充；
- [x] 增加 `agent_runs`、`agent_tool_calls` 幂等迁移；
- [x] 完成单元测试：final、单工具、多工具并行、多步、超限、拒绝和超时。

实施产物：`server/platform/agent/conversation-agent.mjs`、`tool-protocol.mjs`、`tool-catalog.mjs`、`tool-executor.mjs`、`context.mjs`、`events.mjs`、`AgentRunRepository` 和 `test/conversation-agent-core.test.mjs`。运行时当前只由测试直接调用，尚未接入三个生产入口。

验收：模拟模型可完成两轮工具循环；越权请求零执行；每次申请均写 Agent 审计，实际插件执行继续进入 `tool_executions`。

### Phase 2：编辑室试点

目标：替换最接近 Agent 的 `fetchEvents` 专用链。

- [x] 实现 editorial adapter 和事件资源解析；
- [x] 把用户 URL、事件原文和段落检索接入统一请求；
- [x] 兼容解析旧 `fetchEvents`；
- [x] 新增工具状态 NDJSON 事件；
- [x] 前端渲染工具卡；
- [x] 保留编辑决策、锁定并发和事实边界门禁。

验收：模型可在同轮申请事件原文、读完后再给下一问题；锁定候选不能被 Agent 修改；旧客户端仍可工作。

实施产物：`server/platform/agent/editorial-adapter.mjs`、编辑室统一 Agent 路由、`public/src/core/stream-chat.js` 通用工具卡，以及 `test/conversation-agent-editorial.test.mjs`。Phase 5 收口后默认启用，旧编辑室执行器与私有工具协议已删除。

### Phase 3：自主写作迁移

目标：统一本地项目与资料补充。

- [x] 实现 tutorial adapter 和临时项目资源 ID；
- [x] 把路径自动识别包装为系统生成 ToolRequest；
- [x] 接入项目读取、网页、搜索和文档检索；
- [x] 对话成功结果写入可供创建阶段复用的事实附件；
- [x] 保留体验确认和来源等级门禁；
- [x] 创建阶段只对缺失能力执行兜底搜索。

验收：路径不进入模型自由参数；项目材料不能自动升级为亲历；相同查询不会在对话与创建阶段重复计费。

实施产物：`server/platform/agent/tutorial-adapter.mjs`、`fact-attachments.mjs`、`conversation_fact_attachments` 持久化表、自主写作统一 Agent 路由和 `test/conversation-agent-tutorial.test.mjs`。项目绝对路径只由服务端资源解析器持有，ToolResult 注入模型前移除根路径；项目摘要、URL 正文和同查询搜索结果可被创建阶段复用。

### Phase 4：自定义图文迁移

目标：移除对 provider 隐式搜索的依赖。

- [x] 实现 custom-social adapter；
- [x] 接入显式网络/新闻/文档搜索和素材 URL；
- [x] 接入仓库分析；
- [x] 搜索结果自动保持 `【素材】` 来源与 URL；
- [x] 保留图文事实表和创建门禁；
- [x] 关闭该入口 `webSearch:true`。

验收：所有外部材料均有来源；模型不能把搜索结果标成体验；仓库分析只能作用于授权仓库。

实施产物：`server/platform/agent/custom-social-adapter.mjs`、自定义图文统一 Agent 路由、事实附件复用和 `test/conversation-agent-custom-social.test.mjs`。对话明确设置 `webSearch:false`；外部工具产生的新增【体验】会被确定性降级为带公开 URL 的【素材】，仓库资源仅接受用户表单或本轮消息中提供的 GitHub URL。

### Phase 5：治理与收口

目标：删除重复协议，形成可运营能力。

- [x] 三入口统一工具卡和执行历史数据；
- [x] 工具健康、费用可用性和失败率进入运行概览；
- [x] 新 Agent 链删除 `fetchEvents` 私有协议和兼容转换；
- [x] 对话 provider 原生搜索全部通过能力适配器；
- [x] 更新设计、API、配置与安全边界文档；
- [x] 建立调用链静态门禁，新增 ToolCall 必须声明消费者和能力。

验收：三入口不再存在私有 ToolCall 协议；能力依赖图、运行日志和 UI 展示能够关联同一次 Agent run。

实施产物：统一 `agent.* / tool.* / assistant.*` NDJSON 事件协议、共享工具卡渲染器、运行历史界面及 `GET /api/system/conversation-agent-runs` 关联历史。概览按入口和能力统计成功率、失败数及平均耗时；供应商未返回可审计费用时明确输出 `estimatedCost: null`，不做伪精确估算。三个旧对话执行器、旧路由分支和私有工具协议均已删除。

## 16. 测试方案

### 16.1 单元测试

- Schema：合法/未知字段/超长原因/重复 ID；
- 目录裁剪：入口、技能、插件状态、风险等级交集；
- 参数策略：URL SSRF、路径越界、事件不属于候选；
- 循环：final、一次工具、多步工具、达到上限；
- 去重、缓存、并行与顺序依赖；
- ToolResult 压缩不丢来源；
- provider 原生格式与 JSON 回退归一化。

### 16.2 集成测试

- 编辑室申请事件原文后基于结果继续提问；
- 自主写作读取包含空格的目录并只暴露相对路径；
- 体验材料未确认时不得通过；
- 自定义图文搜索结果保留 URL 且标为素材；
- 插件首选失败后候选兜底；
- 客户端断开、工具超时和服务重启状态；
- Agent 审计与 `tool_executions` 一一关联。

### 16.3 安全测试

- 网页正文中的“忽略之前指令”不能扩大能力；
- 模型伪造 system/tool 消息无效；
- 模型请求父目录、密钥文件、内网 URL 被拒；
- 模型提交插件 ID、授权根目录或 `authorizedExternalWrite` 被拒；
- 外部写入能力不会出现在首期目录；
- 日志、事件和 UI 不泄露密钥与本机绝对路径。

### 16.4 回归测试

- 三入口关闭 Agent flag 时行为与当前一致；
- 旧失败任务仍可重试；
- NDJSON 旧 `delta/thinking/done/error` 消费方兼容；
- 技能快照、门禁和文章/图文后台任务不受影响。

## 17. 可观测指标

建议按入口统计：

- Agent 成功完成率；
- 平均模型步骤和工具调用数；
- 各能力成功率、P50/P95 耗时和兜底率；
- 无效 ToolRequest、权限拒绝和重复请求比例；
- 对话与创建阶段缓存复用率；
- provider 原生搜索迁移比例；
- 因工具结果而减少的人工补料轮次；
- Agent 达到预算上限比例。

首期不以“调用工具越多”作为成功指标。理想状态是用最少调用补齐事实缺口。

## 18. 风险与取舍

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 多步循环增加延迟和费用 | 对话变慢 | 严格预算、并行只读调用、缓存复用 |
| 小模型 ToolCall 格式不稳定 | 无效 JSON | 原生适配优先、JSON 修复一次、稳定错误退出 |
| 工具结果导致上下文膨胀 | 截断或成本升高 | 检索压缩、每工具和总字符预算 |
| 模型频繁搜索 | 噪声与费用 | 去重、查询数量限制、入口 Prompt 强调有缺口才调用 |
| 统一层侵入业务门禁 | 安全边界模糊 | Adapter 只提交候选输出，业务门禁保持独立 |
| 审计保存过多敏感材料 | 隐私风险 | 只存摘要、哈希和来源，不存完整正文与绝对路径 |
| 一次迁移三入口 | 回归面过大 | 编辑室先试点，逐入口 feature flag 灰度 |

## 19. 建议代码改动清单

新增：

- `server/platform/agent/*`
- `server/platform/persistence/repositories/agent-run-repository.mjs`
- `server/platform/persistence/migrations` 中 Agent 表迁移
- `public/src/components/tool-call-card.js`
- `test/conversation-agent*.test.mjs`
- `test/editorial-agent.test.mjs`
- `test/tutorial-agent.test.mjs`
- `test/custom-social-agent.test.mjs`

调整：

- `server/platform/llm/gateway.mjs`：原生工具格式适配和 JSON 回退；
- `server/platform/http/routes/article-routes.mjs`：编辑室 Adapter；
- `server/platform/http/routes/candidate-routes.mjs`：自主写作和自定义图文 Adapter；
- `server/platform/tools/registry.mjs`：返回 execution ID 与标准 provenance；
- `server/platform/tools/execution-log.mjs`：关联 agent run/tool call；
- `public/src/main.js` 与三个对话视图：统一工具事件；
- `server/platform/core/config.mjs`：Agent flag 和预算；
- `API.md`：NDJSON 工具事件和响应协议。

已完成废弃：

- 编辑室 `fetchEvents[]`；
- 三入口对话中的直接 `webSearch:true`；
- 路由内散落的专用工具状态文案；
- 对话与创建阶段重复执行的无缓存信息搜索。

## 20. 完成定义

只有同时满足以下条件，才认为通用对话 ToolCall Agent 完成：

1. 三个入口均通过同一个 Agent runtime 执行工具循环；
2. 不再存在入口专用的模型工具申请字段；
3. 所有工具申请都经过能力目录、参数、权限、资源和预算校验；
4. 所有工具调用均能从对话运行追溯到具体插件执行记录；
5. 前端统一展示工具状态，且不泄露敏感信息；
6. 三入口原有事实、体验、锁定和图文门禁保持有效；
7. 默认配置启用统一 Agent，生产路由中不再保留旧链分支；
8. API、架构、配置、用户、安全和插件开发文档同步完成；
9. 单元、集成、安全和全量回归测试全部通过。
