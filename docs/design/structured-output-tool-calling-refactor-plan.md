# 结构化决策输出工具化改造方案

> 状态：待评审（2026-09-04）
> 范围：质量门禁、标题规划、主题路由、封面语义、来源候选排序、视觉 Agent 协议收口
> 原则：正文生成继续使用文本输出；小型、机器消费、阻塞式的决策结果优先使用原生 function tool；大输出和代码密集型结构继续使用 JSON 文本；所有 provider 保留 JSON 回退。

## 1. 结论先行

本次改造不追求把所有 JSON 都改成工具调用。真正有价值的是把以下两类问题分开：

1. **正文输出**：文章、早报、教程正文，以及文章修订、自然化、SEO 优化，继续由模型输出 Markdown 文本，服务端写入文件。
2. **机器决策输出**：质量门禁、标题规划等小型结果，改为单轮原生 function tool，由服务端消费结构化参数。

优先级调整如下：

| 优先级 | 改造内容 | 结论 |
| --- | --- | --- |
| P0 | 统一单轮决策调用适配层、协议转换、参数校验、审计和回退 | 必做 |
| P1 | 文章/早报/教程质量门禁 | 高价值，首批落地 |
| P1 | 文章/早报/教程标题规划 | 高价值，第二批落地 |
| P2 | 主题路由、封面语义、来源候选排序 | 有条件再做，不因“统一”而强行改 |
| P3 | 来源字段补齐 | 低收益，暂缓 |
| P2 | 视觉 Agent 原生工具路径收口 | 不是重新工具化，而是补齐协议和测试 |
| P3 | 复盘/反馈调整 patch | 可选 |
| 保持 JSON | 事件卡、脑暴、研判、深度分析、图表规划、仓库发现 | 不改 |

## 2. 当前实现基线

当前 gateway 已经同时支持 Chat Completions 和 Responses 两种协议的工具调用，并统一返回 `result.toolCalls`。Chat Completions 的工具定义会在 Responses 路径转换为 Responses 格式，见：

- `server/platform/llm/gateway.mjs`
- `server/platform/llm/responses-api.mjs`
- `server/platform/llm/stream-events.mjs`

当前 `jsonMode` 仅在没有工具时发送 `response_format` 或 Responses `text.format`。这条互斥规则是合理的，不需要改成“tools 与 jsonMode 混用”。决策工具调用时明确使用：

```js
{
  jsonMode: false,
  tools: [decisionToolDefinition],
  toolChoice: normalizedToolChoice,
}
```

视觉 Agent 已经存在原生工具路径：

- provider 支持原生工具时，读取 `result.toolCalls`；
- provider 不支持时，继续使用旧 JSON 信封；
- `filesystem.project.document_write` 已经支持 begin/append/finish 会话。

因此视觉 Agent 的工作不是“从零改成工具调用”，而是补齐协议适配、严格工具选择和测试，并确保原生路径不会进入旧 JSON 修复循环。

另外，模型 provider 配置已经迁移到数据库。新增的决策工具总开关和按工具开关不能再设计为 `config.local.json` 字段，建议放入数据库的系统扩展设置或 feature flag 设置中。provider 能力字段也以数据库配置为准。

## 3. 转换决策矩阵

| 环节 | 输出特点 | 阻塞性 | 当前问题 | 建议 |
| --- | --- | --- | --- | --- |
| 文章/早报/教程质量门禁 | 小对象，`pass + issues[]` | 高 | JSON 文本解析和格式重试 | **P1 转工具** |
| 研判贴合度检查 | 中小对象，包含逐点证据 | 高 | JSON 定位和字段归一化 | **P1/P2 转工具**，先与质量门禁适配层共用基础设施 |
| 发布安全门禁 | 小对象，但叠加确定性扫描 | 高 | AI 门禁和程序扫描结果需要合并 | **P1 转工具**，保留程序扫描和修订重试 |
| 标题规划 | 中小对象，候选标题和关键词 | 中 | 三条链格式不完全一致 | **P1 转工具**，先统一内部结构 |
| 主题路由 | 枚举/排序对象 | 中低 | 非法 themeId 已有归一化和标签回退 | **P2 条件转工具** |
| 封面语义 | 枚举和短文本 | 低 | 失败可规则回退 | **P2 条件转工具** |
| 来源候选排序 | 全排列约束 | 低 | 失败可确定性排序 | **P2 条件转工具** |
| 来源字段补齐 | selector 选择 | 低 | 已有白名单、复验和优雅降级 | **P3 暂缓** |
| 视觉 Agent | HTML/CSS 分块写入 | 中 | 原生路径与旧 JSON 信封并存 | **协议收口，不重新设计** |
| 事件卡/脑暴/讨论研判 | 大对象、正文密集 | 低 | 拆批重试已稳定 | **保持 JSON** |
| 深度分析/突发分析 | 正文密集 | 低 | 归一化和文本修订更重要 | **保持 JSON** |
| 图表/配图规划 | 代码密集，需语义和事实校验 | 低 | 服务端已有复杂度、数字和插入位置校验 | **保持 JSON** |
| 仓库发现 | 松散结果 | 低 | 已有回退 | **保持 JSON** |

判断标准不是“能否写 schema”，而是：结果是否主要供程序消费、是否阻塞主链、是否能明显减少格式失败、是否已有稳定回退。

## 4. 目标架构：单轮决策调用

### 4.1 不引入通用工具执行器

这些工具大多数不是要执行外部动作，而是让模型返回一个机器决策对象。因此不设计“定义 + validate + execute”的插件式注册中心，也不进入 conversation-agent 的工具目录。

建议新增一个轻量模块：

```text
server/platform/llm/decision-tools.mjs
```

它提供：

```js
await callDecisionTool({
  gateway,
  provider,
  purpose,
  batchId,
  candidateId,
  definition,
  schema,
  messages,
  fallback,
})
```

调用器统一负责：

1. 判断当前 provider 是否支持决策工具；
2. 按协议生成正确的工具定义和 `tool_choice`；
3. 要求恰好返回指定工具的一次调用；
4. 校验参数类型、必填字段、枚举、长度、范围和数组约束；
5. 处理只有文本、没有工具、多工具、错误工具名、非法参数等情况；
6. 对 provider 不支持或工具调用失败走原有 JSON 路径；
7. 对工具参数校验失败写入等价的 `invalid_output` 审计；
8. 返回业务层继续使用的内部对象。

业务层仍然负责语义校验和确定性规则，例如：

- `themeId` 是否存在于当前主题目录；
- `order` 是否覆盖全部候选；
- `afterHeading` 是否存在于正文；
- 标题是否通过发布风险扫描；
- 门禁 `pass` 是否受到程序扫描结果影响。

### 4.2 协议适配要求

不能把 Chat Completions 的 `tool_choice` 直接透传给 Responses。适配层应统一接受内部形式：

```js
{ type: 'function', name: 'decision.quality_gate' }
```

再按协议转换：

```js
// Chat Completions
{ type: 'function', function: { name: 'decision.quality_gate' } }

// Responses
{ type: 'function', name: 'decision.quality_gate' }
```

同时区分以下能力，不把 `supportsNativeTools` 当成全部能力的代名词：

- 支持 function tools；
- 支持强制指定工具；
- 支持 strict schema；
- 支持流式工具参数。

首批可以只依赖“支持 function tools + 支持指定工具”的能力。strict schema 作为可选增强，不能替代服务端校验；能力未知时默认走 JSON 回退。

### 4.3 工具调用结果处理

决策工具是单轮调用，不执行工具，也不回喂 `tool` result 消息：

```text
模型请求（工具定义 + tool_choice）
        ↓
result.toolCalls[0].input
        ↓
服务端参数校验和业务语义校验
        ↓
业务流水线继续执行
```

但必须明确以下异常策略：

- 无工具调用：走 JSON 回退或确定性回退；
- 返回多个工具调用：视为无效，不猜测使用哪个；
- 工具名不匹配：视为无效；
- 参数不是合法 JSON：记录 `invalid_output`，随后回退；
- 工具调用同时带正文：允许记录但不把正文当作决策结果；是否回退由调用器配置，默认忽略正文；
- provider 返回工具调用但 finish reason 异常：由调用器按结果完整性判断，不只看是否存在 `toolCalls`。

## 5. 首批工具契约

### 5.1 `decision.quality_gate`

适用于文章、早报、教程的 draft/final 门禁，以及发布安全门禁。

```json
{
  "pass": true,
  "issues": [
    {
      "type": "fact_support",
      "message": "……",
      "stage": "final",
      "severity": "error"
    }
  ]
}
```

建议 `type`、`stage`、`severity` 使用有限枚举，`message` 保持短文本。`pass` 仍是模型判断，但最终结果必须经过程序合并：

- 确定性发布风险问题可以强制将 `pass` 置为 false；
- 字数、标题、结构问题继续由程序判断；
- `issues` 仍需经过现有业务归一化，不能因为 schema 存在就删除语义过滤。

研判贴合度可以先复用同一调用器，但使用独立 schema，因为它的 `items`、`omitted_points`、`repair_suggestions` 与普通质量门禁不同。

### 5.2 `decision.title_plan`

三条链统一在内部转换为：

```json
{
  "selectedTitle": "最终标题",
  "titleCandidates": [
    {
      "title": "候选标题",
      "reason": "候选理由",
      "score": 8
    }
  ],
  "coreKeywords": ["关键词"]
}
```

约束建议：

- `selectedTitle` 必须是候选之一，或由业务层明确允许；
- 标题长度、事实边界、敏感表述由程序复验；
- `score` 是可选排序参考，不是发布资格；
- 不加入模型自行判定的 `riskBlocked` 字段；风险以 `scanPublicationRisk` 和 `publicationComplianceIssue` 为准；
- 文章链已有 `{title, reason}` 结构，早报/教程的字符串候选在适配层补成对象。

### 5.3 延后工具契约

以下契约不进入首批：

- `decision.theme_route`：已有 `normalizeThemeCandidates`、主题目录检查和标签回退；
- `decision.cover_semantics`：失败不阻塞，规则回退足够；
- `decision.rank_sources`：全排列校验已经很小，只有观察到格式失败或维护成本后再转；
- `decision.enrich_fields`：已有候选白名单和复验，收益最低。

如果后续启用，仍使用同一个 `callDecisionTool`，不为每个工具单独实现一套 provider 逻辑。

## 6. 可精简与不可精简的内容

### 6.1 可以逐步收缩

在对应流水线确认工具路径稳定后，可以收缩：

1. 质量门禁的“返回正文而不是 JSON”格式重试；
2. 标题规划的围栏剥离和 JSON 定位；
3. 转工具调用方的格式层 `array/clean/clamp`；
4. 只为 JSON 语法错误存在的局部重试分支。

### 6.2 必须保留

1. `model-json.mjs`，因为事件卡、研判、图表规划等仍然使用 JSON 文本；
2. 业务语义归一化和白名单校验；
3. 文章正文输出的 Markdown 文本链路；
4. 发布风险扫描、来源回绑、标题长度和文章结构门禁；
5. provider 不支持工具时的 JSON 回退；
6. 文章修订、复核和合规重试；
7. HTML/CSS 文件写入的 `document_write` 会话协议。

### 6.3 不需要修改 gateway 的互斥逻辑

tools 与 JSON mode 仍保持互斥发送：

- 决策工具请求：发送 tools，不发送 `response_format`；
- JSON 回退请求：发送 `response_format`，不发送 tools；
- 正文请求：不发送 tools，也不强制 JSON。

这能减少 provider 对“工具调用 + JSON mode”组合支持不一致的问题。

## 7. 分批实施计划

### 批 0：决策调用基础设施

内容：

- 新增 `decision-tools.mjs`；
- 增加内部工具定义和协议级 `tool_choice` 转换；
- 增加 `supportsDecisionTools`，未知能力默认 false；
- 增加工具名、单调用、参数对象和错误结果校验；
- 对 malformed tool arguments 补齐 `invalid_output` 审计；
- 将 feature flag 放入数据库系统设置，不新增 `config.local.json` 模型字段；
- 通过 mock provider 覆盖 Chat Completions、Responses、JSON 回退三条路径。

验收：

- Chat Completions 能收到正确的 `tool_choice`；
- Responses 能收到正确的 `tool_choice`；
- 工具参数错误不会被误记成普通成功；
- 无工具、多工具、错误工具名都能确定性回退；
- 原有 JSON 流程测试不受影响。

### 批 1：质量门禁

改造：

- 文章 draft/final/publication-safety 门禁；
- 早报质量门禁；
- 教程质量门禁；
- 视风险和 schema 复杂度，再接入 research coverage。

保留：

- `scanPublicationRisk`；
- `publicationComplianceIssue`；
- 字数、结构和来源确定性检查；
- 失败后的文章修订和复核。

验收：

- provider 支持工具时，流水线消费 `toolCalls[0].input`；
- provider 不支持时，现有 JSON 路径结果契约不变；
- `*-quality-gate.json`、`10-publication-compliance.json` 等产物格式不变；
- 门禁失败 → 修订 → 复核路径完整回归。

### 批 2：标题规划

改造：

- 文章、早报、教程标题生成统一调用 `decision.title_plan`；
- 适配层输出统一内部候选对象；
- 继续生成原有 `03-titles.md` 或对应标题产物；
- 风险扫描完全由程序执行。

验收：

- 三条链选中的标题和候选标题产物结构不变；
- 候选为空、selectedTitle 不在候选中、标题过长等情况有确定性处理；
- 标题工具失败时可回退到旧 JSON 或已有默认标题。

### 批 3：低阻塞决策环节（可选）

只有在运行审计显示 JSON 格式失败、重试成本或维护成本确实存在时，才选择其中一项推进：

- 主题路由；
- 封面语义；
- 来源候选排序。

不建议为了减少几行 `parseJsonText` 就同时改造全部三个环节。

### 批 4：视觉 Agent 协议收口

这不是重新做原生工具化，而是：

- 为现有 native path 增加 Chat/Responses 协议回归；
- 统一工具选择和能力判断；
- native path 下不进入 JSON 信封修复循环；
- 工具执行失败时仍保留会话级恢复；
- provider 不支持 native tools 时继续使用 JSON 信封。

HTML/CSS 仍然使用 `filesystem.project.document_write` 分块写入；文章 Markdown 正文仍使用普通文本生成。

### 批 5：反馈调整（可选）

仅当 planning + patch 的格式失败成为真实问题时，才评估 `decision.adjustment_plan`。现有白名单、`old_text` 唯一性和 hash 防御优先保留。

## 8. 兼容、灰度和回退

### 8.1 能力判断

建议将决策工具能力拆成运行时判断：

```text
decisionToolsEnabled
  AND provider.supportsNativeTools
  AND provider supports forced function choice
  → 使用工具
否则 → 使用旧 JSON 路径
```

能力未知时默认回退 JSON，不根据模型名称猜测能力。

### 8.2 开关位置

不在 `config.local.json` 新增模型或决策工具配置。建议使用数据库系统设置，例如：

```json
{
  "decisionToolsEnabled": false,
  "decisionToolOverrides": {
    "decision.quality_gate": false,
    "decision.title_plan": false
  }
}
```

实际 key 和 UI 暴露方式在批 0 实施时确定，但必须与当前数据库配置架构一致。

### 8.3 产物和审计

- 现有产物路径和字段不变；
- 模型调用审计记录 provider、purpose、toolCalls、token 和状态；
- 参数校验失败记录 `invalid_output`；
- 工具调用失败、provider HTTP 失败和 JSON 回退分别保留可区分状态；
- 工具路径与 JSON 路径使用同一个业务语义归一化结果，避免双路行为漂移。

## 9. 风险和验收重点

### provider 差异

“支持原生工具”不代表支持 strict schema、强制工具选择和流式参数。每种协议至少需要请求体测试；真实远程 provider 需要小流量演练。

### schema 不是业务正确性

工具 schema 只能约束结构，不能保证：

- 标题没有新增事实；
- source_id 能正确回绑；
- themeId 真正存在；
- 门禁判断真实可靠；
- 图表数字来自事实基座。

这些规则继续由服务端业务层执行。

### 成本和延迟

工具调用不会自动减少模型 token，也可能因 schema 和工具描述增加少量输入 token。是否有收益应看：

- 格式失败率；
- 格式重试次数；
- 单次流水线平均调用数；
- 门禁失败后的修订次数；
- JSON 解析相关代码和故障数量。

### 文章写入边界

Markdown 正文不改为写入工具。模型负责生成正文文本，服务端负责落盘。只有模型需要直接、分块、可恢复地生成 HTML/CSS 文件时，才使用 `document_write`。

## 10. 待评审问题

以下问题本版先给出默认答案，评审时如果不同意再调整：

1. 决策工具是否允许带正文？默认允许 provider 带少量正文，但只消费工具参数，不把正文作为回退输入。
2. 能力未知时如何路由？默认走 JSON，不根据模型名称推断。
3. feature flag 放哪里？放数据库系统设置，不放 `config.local.json`。
4. 是否删除 `model-json.mjs`？不删除，只在单个流水线完成稳定迁移后收缩对应调用方。
5. 是否首批改来源字段补齐？不改，除非审计证明其格式失败已经造成实际成本。
6. 是否把视觉 Agent 作为全新批次重做？不做，当前已有 native path，本批只做协议收口和回归。

## 11. 最小可行落地范围

如果希望控制改造风险，首轮只做：

1. `callDecisionTool` 基础设施；
2. 文章质量门禁；
3. 早报和教程质量门禁；
4. 完整 JSON 回退和审计；
5. Chat Completions/Responses/mock provider 测试。

标题规划放到下一批，主题路由、封面语义、来源处理和反馈 patch 不进入首轮。
