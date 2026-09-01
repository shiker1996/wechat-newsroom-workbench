# 对话 Agent 表单化统一设计

> 状态：待实施（2026-08-15 定稿）
> 涉及：编辑室（agent.editorial）、自主写作（agent.tutorial）、自定义图文（agent.custom-social）

## 背景与问题

三个对话 Agent 本质上是同一件事：**多轮对话收集一张表单，表单齐备后解锁下游动作**。但编辑室在历史演进中长出了另外两套机制，与表单模型叠加后产生了一系列问题：

1. **问题持久化**：`nextQuestion` 单列字段并落库为 `editor_question`，`open_questions` 由模型维护并回喂——模型既当裁判又当运动员，形成"重复提问"的自我强化锚点（2026-08-15 S001 事故）。
2. **`next_action` 状态机**（DISCUSS/WRITE_NOW/TEST_FIRST/RESEARCH_FIRST/DROP）：模型自觉维护，但代码没有任何确定性保障，出现了提前成稿、WRITE_NOW 被降级、就绪后无人翻牌等问题。
3. **双补丁对象**：`candidateUpdates`（选题字段）+ `editorial`（底稿字段）分离，模型负担重，信封嵌套时期字段不沉淀。

对比之下，自主写作/自定义图文的"表单 + 代码复核就绪"模式（`evaluateTutorialChatReadiness`）从未出现这类问题：模型的 `ready` 声明代码不认就驳回，该问什么由表单缺失项决定。

## 状态机现状审计（简化依据）

代码中真正有行为语义的状态只有三个：

- **DISCUSS**：默认值，无实际分支逻辑
- **WRITE_NOW**：锁简报门禁（`article-routes.mjs`）与成稿流水线门禁（`article-pipeline.mjs`）的唯一判据
- **LOCKED**：锁定后禁止覆盖决策（`applyEditorialResult` / `runEditorialAgentTurn`）

`TEST_FIRST` / `RESEARCH_FIRST` / `DROP` **只有展示标签**（`public/src/views/editorial.js`、`topics.js` 的状态文案映射），无任何行为消费点。补资料诉求已被 Agent 的工具调用能力取代，DROP 本质是用户在列表页的"移出本池"操作。

结论：状态机收敛为 **讨论中 → 可成稿 → 已锁定**，其中"可成稿"由代码从表单推导，不再由模型声明。

## 目标结构

### 协议层（已完成，不变）

final 信封已打平（2026-08-15）：业务字段平铺顶层，协议只强制 `type` + `assistantReply`。

### 业务 payload 统一为两字段

三个 Agent 的 final 统一为：

```json
{"type": "final", "assistantReply": "回复（含追问，不落库）", "briefUpdates": { "…本领域表单增量补丁…" }}
```

- **assistantReply**：给用户的回复，追问直接写在文本里（同 tutorial/custom-social 现状），问题不再持久化。
- **briefUpdates**：本轮有变化的表单字段增量补丁。
  - 编辑室：`{angle, thesis, distribution_lane, reader_stake, confirmed_facts, research_basis, author_opinions, confirmed_experiences, rejected_angles, forbidden_claims, experience_required}`（合并现 candidateUpdates + editorial，去掉 nextQuestion/open_questions/next_action；`research_basis` 为作者确认采用的事件内或事件间研判主线）
  - 多值字段（`confirmed_facts`、`author_opinions`、`confirmed_experiences`、`rejected_angles`、`forbidden_claims`）默认使用 `{append: [...]}` 追加并按条目去重；删除使用 `{remove: [...]}`，清空使用 `{clear: true}`。单值字段（`angle`、`thesis`、`research_basis`）使用 `{replace: "..."}` 或 `{set: "..."}` 明确替换，不能隐式覆盖。
  - 自主写作：现 `formUpdates` 改名为 `briefUpdates`，字段不变
  - 自定义图文：同
- **删除模型的 `ready` 字段**（tutorial/custom-social）：就绪本就由代码复核，模型声明无意义。

### 就绪判定：代码确定性计算

新增 `evaluateEditorialReadiness({candidate, editorial})`（domain 层，仿 `evaluateTutorialChatReadiness`），返回 `{ready, missing[]}`：

- `angle` / `thesis` 为实质内容（非占位符，复用 `substantiveDecision`）
- `distribution_lane` 已确定且 `reader_stake` 具体（谁、什么场景、什么动作、什么后果）
- `confirmed_facts` 非空（事实基座）
- `research_basis` 非空且为实质内容（必须明确采用反常、利益冲突、发散方向，或前后/回应/对比/趋势关系）
- `author_opinions` 非空（作者立场）
- 体验门禁：`experience_required` 为真时 `confirmed_experiences` 必须有实质内容
- `forbidden_claims` 非空（命题边界设界）

`missing[]` 同时服务于：前端成稿门展示、锁简报/成稿流水线门禁、下一轮对话上下文的"该问什么"提示（替代 open_questions 回喂）。

### 问题的生命周期（不再持久化）

- 模型在 `assistantReply` 里追问；代码把 `missing[]` 注入下一轮上下文，模型围绕缺失项提问
- `editor_question` / `open_questions` 列保留（兼容历史数据），但不再由模型输出驱动；页面展示改为 `missing[]` 派生
- 编排选题的预置首问（`candidate-selection-service.mjs`）改为作为开场提示注入首轮回上下文，不落库
- 决策补写器（字段冻结兜底）与体验门禁 reconcile 保留——它们是字段级保障，与表单化正交

### 状态收敛

- `brief_status`：`DISCUSS`（讨论中）→ `WRITE_NOW`（代码推导的就绪，粘滞由 readiness 自然保证）→ `LOCKED`（用户确认锁定）
- 模型 payload 不再有 `next_action`；`applyEditorialResult` 不再消费它
- 可删除的兜底代码：WRITE_NOW 前置校验/粘滞、DISCUSS 死锁提领、open_questions 外科清除中的提领逻辑（门禁本身的体验问题拦截保留）

## 迁移点清单

| 位置 | 改动 |
|---|---|
| `server/domain/` 新增 | `evaluateEditorialReadiness` |
| `server/features/articles/llm/editorial-room.mjs` | SYSTEM prompt 改 briefUpdates；reconcile 删 open_questions 管理；applyEditorialResult 删状态机并按字段类型执行追加、去重、明确删除/替换；buildEditorialMessages 回喂 missing[] |
| `server/features/articles/domain/editorial-patch.mjs` | 提供编辑室底稿增量补丁的追加去重、明确删除/清空和单值替换逻辑 |
| `server/platform/agent/editorial-adapter.mjs` | 信封指令、json-repair 模板、决策补写器 prompt 与合并逻辑 |
| `server/features/articles/llm/tutorial-chat.mjs` / `server/features/social-cards/llm/custom-social-chat.mjs` | prompt 改 briefUpdates、删 ready |
| `server/platform/agent/tutorial-adapter.mjs` / `custom-social-adapter.mjs` | 读 briefUpdates；删模型 ready 消费（代码复核保留） |
| `server/platform/http/routes/article-routes.mjs` | 锁简报门禁换 readiness |
| `server/features/articles/application/article-pipeline.mjs` | 成稿门禁换 readiness |
| `server/application/candidate-selection-service.mjs` | 预置首问改开场注入 |
| `public/src/views/editorial.js` | 成稿门六项检查换 missing[] 驱动；问题展示区改派生 |
| `skills/editorial-room-chat/SKILL.md` | prompt 同步，要求先确认采用的研判主线 |
| DB | `editorial_sessions.research_basis` 新增字段，schema v34；旧数据默认空值并需重新确认 |
| 测试 | 编辑室约一半用例改写；tutorial/custom-social 相关断言更新 |

## 兼容策略

- 历史 `editorial_sessions` 行保留旧列数据；新逻辑不读 `next_action`/`editor_question`/`open_questions` 作为判定依据（仅展示回退）
- final 信封的旧嵌套格式继续兼容（tool-protocol 已支持）
- `briefUpdates` 同时接受旧名 `formUpdates`（tutorial/custom-social 过渡期内双读，prompt 只教新名）

## 验收标准

1. 全量测试绿（含改写的编辑室用例：表单补丁落库、就绪代码推导、缺项驱动提问、体验门禁、字段冻结补写）
2. S001 场景回归：多轮作答后不再重复提问；字段齐备即自动可成稿，无需模型声明
3. 锁简报与成稿流水线门禁行为与旧版一致（有缺项 409）
