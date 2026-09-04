# 结构化输出工具化改造方案（JSON 解析 → 原生工具调用）

> 状态：待评审（2026-09-03）
> 范围：成稿链 / 早报 / 教程门禁、标题生成与风险扫描、主题路由、封面语义、素材采集排序与字段补齐、视觉 Agent
> 目标：把"模型输出 JSON 文本 + 服务端解析修复"的交互，逐步改为"API 原生 function calling（单轮决策工具）"，在获得 schema 强校验的同时精简掉现有解析、修复与重试链路；按 provider 能力分批切换，保留 JSON 回退。

---

## 1. 背景与现状

当前所有"程序判断依赖模型输出"的环节都走同一条链路：

`gateway.complete({ jsonMode:true })` → `response_format=json_object`（`gateway.mjs:214/269`，且与 tools 互斥）→ 模型把结构化结果写成**普通文本** → `parseModelJson`/`parseJsonText`（`model-json.mjs`）做围栏剥离、JSON 定位、截断修复 → 各业务 `normalize*` 手工清洗 → 失败则各自兜底重试。

现状痛点（按上一轮盘点）：
1. **格式问题几乎全部由调用方承担**：围栏、前缀散文、截断、缺闭合括号等，各流水线长出了不同的重试分支（拆批重试、极简结构重试、format-retry、`parseModelJsonWithRepair` 的反馈修复）。
2. **schema 约束靠 prompt 而非协议**：`motifKind`、`themeId`、`order` 全排列、`pass:boolean` 这类强约束值，模型返回非法值时只能靠事后 `normalize*` 过滤或整次回退。
3. **jsonMode 与 tools 互斥**（`gateway.mjs:207`），无法在需要 schema 约束的同时复用工具通道。
4. **审计错位**：`parseModelJson` 失败会写 `invalid_output` 到模型调用审计，但那是"文本被写出来后"的失败；工具调用的 `arguments` 由 provider 直接给结构化对象，解析层天然消失，需要等价审计路径。

判定准则（见本方案第 2 节）：**"小 schema、纯机器决策、低正文占比、高阻塞" 的环节转工具";大输出、正文密集、已有健壮归一化的环节保留 JSON**。

---

## 2. 转换决策矩阵

| 环节 | 位置 | schema 大小 | 阻塞性 | 现失败模式 | 结论 |
|---|---|---|---|---|---|
| 文章 QA 门禁（draft/final/research-coverage/publication-safety） | `article-pipeline.mjs:71` | 小 | 高 | 正文混入 JSON、截断 | **转工具** |
| 早报门禁 | `daily-pipeline.mjs:33` | 小 | 高 | 同上 | **转工具** |
| 教程门禁 | `tutorial-pipeline.mjs:16,59,85` | 小 | 高 | 专门防"返回正文" | **转工具** |
| 标题生成 + 风险扫描（article/daily/tutorial） | 三处 `title-generation` | 小 | 中 | `try/catch` 兜底到正则 | **转工具** |
| 主题路由 | `auto-theme-router.mjs:122` | 小(枚举) | 中 | 幻觉新 themeId | **转工具** |
| 封面语义 | `cover-semantics.mjs:45` | 小(枚举) | 低 | 字段清洗 | **转工具** |
| 来源候选排序 | `source-candidate-ranker.mjs:14` | 小 | 低 | 全排列校验失败退回 | **转工具** |
| 来源字段补齐 | `source-field-enricher.mjs:3` | 中 | 低 | 优雅降级 | **转工具（优先级低）** |
| 视觉 Agent 信封 | `ai-visual-document-agent.mjs:149` | 中 | 中 | 自研修复循环 | **转工具** |
| 复盘/反馈调整 planning+patch | `feedback-adjustment.mjs` | 中 | 低(人工确认) | 多层防御已足够 | 可选（批 4） |
| 事件卡 / 脑暴 / 讨论研判 1A·2A·1B·2B·3 | `event-card-stage.mjs` / `editorial-exploration.mjs` / `discussion-research-stage.mjs` | 大、正文密集 | 低 | 拆批重试已稳 | **留 JSON** |
| 事件深度分析 / 突发分析 | `event-research-analysis.mjs:87` / `breaking-analysis-pipeline.mjs:47` | 大、正文密集 | 低 | 归一化稳 | **留 JSON** |
| 图表规划 / 配图规划 | `visual-planner.mjs:16` / `image-workflow.mjs:120` | 大、含代码 | 低 | 事后对账已稳 | **留 JSON** |
| 仓库发现 | `repo-discovery.mjs:14` | 松散 | 低 | 有回退 | **留 JSON** |

---

## 3. 目标架构：单轮决策工具（Single-shot Decision Tool）

### 3.1 概念

与对话 Agent 的多轮工具不同，本方案引入**单轮决策工具**：一次 `complete` 请求携带工具定义 + `tool_choice` 固定指定某工具，模型返回 `toolCalls` 后，调用方**直接消费 `arguments` 结构化对象**，不回喂 tool result 消息。

```
gateway.complete({
  tools: [decisionTools.qualityGate.tool],        // JSON Schema parameters
  toolChoice: { type:'function', function:{ name:'decision.quality_gate' } },
  jsonMode: false,                                 // tools 与 jsonMode 不再互斥混用
})
→ result.toolCalls[0].input   // provider 直接给出结构化对象
→ validateToolArgs(schema, input)  // 服务端轻量校验（类型/枚举/范围）
→ execute 决策逻辑（原本 normalize 之后的部分）
```

### 3.2 统一执行器封装

新增 `server/platform/llm/decision-tools.mjs`：

```js
// 每个工具 = 定义 + 校验 + 执行 + 审计
{
  name: 'decision.quality_gate',
  description: '评估文章质量门禁，返回 pass 与 issues',
  parameters: { type:'object', properties:{ pass:{type:'boolean'}, issues:{type:'array', items:{...}} }, required:['pass'] },
  validate: (args) => normalizeQualityGate(args),  // 仅做结构收窄，不做语义兜底
  purpose: 'article-quality-gate',
  maxOutputTokens: 3500,
}
```

- `validate` 取代现有 `normalize*` 中的**格式层**清洗（类型、枚举、范围、数组化）；**语义层**校验（如 `old_text` 唯一性、source_id 回绑、风险降级）保留在业务层，不合并。
- 不放插件注册表，不进入 `conversation-agent` 的工具目录（它们不是 Agent 能力，是流水线内部决策）；仅由流水线自我引用，避免污染对话工具暴露面。
- 审计等价物：`validate` 失败时调用 `store.updateModelCall(callId, { status:'invalid_output', ... })`，与 `parseModelJson` 现有行为对齐（`model-json.mjs:13`）。

### 3.3 工具命名空间

统一前缀 `decision.`，避免与现有 `cap_*` 冲突（`tool-catalog.mjs:29`）：

| 工具名 | 对应环节 | 关键 schema 约束 |
|---|---|---|
| `decision.quality_gate` | 文章/早报/教程门禁 | `pass:boolean`；`issues[]:{type,message,stage?}` |
| `decision.title_plan` | 标题生成 + 风险扫描 | `selectedTitle:string(≤28字)`、`titleCandidates[]`、`coreKeywords[]`、`riskBlocked:boolean` |
| `decision.theme_route` | 主题路由 | `candidates[]:{themeId ∈ catalog, score:0-100}` |
| `decision.cover_semantics` | 封面语义 | `motifKind ∈ 枚举`、`highlightTerms[]` |
| `decision.rank_sources` | 来源候选排序 | `order[]` 必须恰好全排列 |
| `decision.enrich_fields` | 来源字段补齐 | `summarySelector/authorSelector/dateSelector ∈ 候选 options` |
| `decision.visual_write` | 视觉 Agent（替代自研信封） | 复用现有 `filesystem.project.document_write` 语义 |

---

## 4. 现有流程可精简的点

改造后明确可删除/收缩的位置（以批落地后逐条清理）：

1. **`model-json.mjs` 的文本修复链**：`locateJsonValue`/`repairJsonSyntaxOnly`/`stripJsonFence` 在转工具环节不再需要（保留给仍走 JSON 的环节：事件卡/研判/图表等）。
2. **门禁的"防正文"重试分支**：`tutorial-pipeline.mjs:82` 的 format-retry、`ai-quality-gate` 对返回 BODY 二次调用的兜底。
3. **拆批/极简重试中对"JSON 截断/闭合"的动机**：`event-card-stage.mjs:99-110`、`editorial-exploration.mjs:134-168` 保留给仍走 JSON 的环节，不为此扩展。
4. **`normalize*` 的格式层清洗收窄**：`clamp`/`array`/`clean` 对已由 schema 约束的字段可删除；语义清洗保留。
5. **`gateway.mjs` 的互斥分支**：tools 与 jsonMode 的分流逻辑不再被转工具环节依赖（保留给 JSON 环节）。
6. **`ai-visual-document-agent.mjs` 的修复循环**：`parseAndValidateVisualEnvelope`/`jsonRecoveryInstruction`/`protocolRecoveryInstruction` 在改原生工具后整段删除（`:140-189`），工具结果回喂走统一 tool 消息协议（`wireMessages:28` 已支持）。
7. **各 `try/catch` 兜底**：`daily-pipeline.mjs:142`、`tutorial-pipeline.mjs:59` 的标题解析容错，改为 schema 校验失败走确定性回退，逻辑语义不变，分支更少。

**不会精简**：正文生成阶段（draft/humanize/review/SEO/终稿）保持纯文本直出；事件卡/研判/图表规划等大输出环节保持 JSON + 拆分重试现状。

---

## 5. 分批实施计划

> 原则：**基础设施先行、低风险独立环节先行、阻塞主链的环节最后上、provider 能力门禁逐批生效、每次一个批可整体回退到 JSON**。
> 运行期路由：新增 `supportsDecisionTools(gateway, provider)`（复用 `providerSupportsNativeTools`，`tool-catalog.mjs:55`），为 `false` 时该批全部走原 JSON 路径，两套行为并存但不混跑。

### 批 0：基础设施（先行）

- 新增 `server/platform/llm/decision-tools.mjs`（3.2 的执行器 + 轻量校验工具，不引入 zod/ajv，首批先用小型手写 validator；如后续工具参数增多再评估引入依赖）。
- `gateway` 补充：`toolChoice` 已支持（`gateway.mjs:212-213`）；需要为决策工具统一悬挂 `invalid_output` 审计。
- 新增 `supportsDecisionTools` 与运行期路由 helper；为 `config.local.json`/provider 配置增加 `supportsNativeTools` 标记（已有字段，确认默认值）。
- 验收：单测覆盖 validator；用 `decision.title_plan` 做过一次端到端可回退演练。

### 批 1：低风险独立环节（不阻塞主链，均有确定性回退）

- `decision.rank_sources`：替换 `source-candidate-ranker.mjs` 的文本解析；失败仍回退确定性排序。
- `decision.enrich_fields`：替换 `source-field-enricher.mjs`；`validate()` 复验逻辑不动。
- `decision.cover_semantics`：替换 `cover-semantics.mjs:45`；规则回退不动。
- `decision.theme_route`：替换 `auto-theme-router.mjs:122`；标签回退与 `chooseCandidate` 惩罚逻辑不动。
- 验收：对应 `test/` 用例从"注入假 JSON 文本"改为"注入工具 arguments"；回退路径断言不变。

### 批 2：成稿链门禁 + 标题（收益最大、需要谨慎）

- `decision.quality_gate`：统一替换 `article-pipeline.mjs` 的 draft-quality-gate / final-quality-gate / research-coverage / publication-safety-gate，以及 `daily-pipeline.mjs`、`tutorial-pipeline.mjs` 的门禁。
  - `publication-safety-gate` 的确定性补检（`scanPublicationRisk` + `publicationComplianceIssue`）与合规修订重试**不在本批删除**，只在门禁输入侧换协议。
- `decision.title_plan`：替换 article/daily/tutorial 三处标题生成；`03-title-risk.json` 的确定性风险扫描仍由程序执行，工具只提供标题候选与 `riskBlocked` 提示。
- 验收：三链各跑一次端到端；`00-stage-executions.json` 与产物结构不变；门禁失败→修订→复核路径用真实用例回归。

### 批 3：视觉 Agent 信封原生工具化

- 将 `ai-visual-document-agent.mjs` 的 JSON 信封改为真实 `filesystem.project.document_write` function tool（沿用现有工具协议，`wireMessages`/`streamEvents` 的 tool-call 事件已支持）；保留 result 回喂与分块校验，删除 `<:140-189>` 信封修复循环。
- 验收：视觉生成走 `chatCompletionsEvents` 的 tool-call 流式事件；恢复逻辑只在工具**执行失败**时触发，不再为"JSON 语法错误"触发。

### 批 4（可选）：复盘/反馈调整

- 评估 `feedback-adjustment.mjs` planning + patch 转 `decision.adjustment_plan` / `decision.adjustment_patch`；因现有白名单/`old_text` 唯一性/hash 防御已足够，仅当批 1-3 稳定后按需推进，不设硬截止。

---

## 6. 兼容与回退策略

1. **provider 能力门禁**：每批统一封装 `if(!supportsDecisionTools(...)) return legacyJsonPath(...)`；两路共用同一 `validate`/`normalize` 语义实现，保证行为收敛。
2. **切换开关**：`config.local.json` 增加 `llm.decisionTools.enabled: true|false`（默认 true）与 `llm.decisionTools.toolsOverrides` 按工具粒度开关，支持线上按批灰度与单工具快速回退。
3. **审计对齐**：工具 `validate` 失败写 `invalid_output`；`gateway.complete` 已在 `recordModelCall` 记录 `toolCalls`（`gateway.mjs:468`），无需额外改动。
4. **产物契约不变**：`00-stage-executions.json`、`*-gate.json`、`03-titles.md`、`03-title-risk.json`、`10-publication-compliance.json` 等既有产出的文件格式与字段保持稳定，仅在内部协议层变化。

---

## 7. 风险与注意

- **provider 差异**：不同模型对 function calling、`strict` schema、流式 tool-call 支持不一致；resonses 协议与 chat_completions 的 tool 归一化已由 `normalizeResponsesToolCalls`/`normalizeChatToolCalls` 处理，决策工具只消费 `result.toolCalls[0].input`，与协议无关。
- **大输出不适合工具**：`quality_gate` 的 issues 可能较多，需保证 `maxOutputTokens` 预算；门禁语义层仍保留"issue 消息清洗"，避免 schema 膨胀。
- **不回喂 tool result**：单轮决策工具不需要第二次调用；严禁把决策工具误用成多轮（避免混淆 `wireMessages` 的 tool 消息路径）。
- **`thinking` 与工具**：机械结构化用途默认 `thinking:false`（`gateway.mjs:49-59` 的 `THINKING_DISABLED_PATTERNS` 已覆盖多数门禁/标题用途），转工具后需在该白名单同步维护。
- **测试夹具更新**：`test/` 大量用"假 JSON 文本"驱动 `parseModelJson`；批 1-3 需同步改写为"工具 arguments 对象"，避免回归。

---

## 8. 待评审问题

1. 决策工具是否允许模型在 `arguments` 之外返回正文（加深回退语义），还是严格禁止（`tool_choice` 单工具下 provider 仍可能带 content 前缀）？
2. `enrich_fields` 这类"低价值但已有优雅降级"的环节，是否值得占用批 1 排期，还是直接推迟到批 3 后统一清理？
3. provider `supportsNativeTools` 目前在哪些远程配置已开启？需要的默认路由策略是"默认 tools、缺标记走 JSON"还是相反？