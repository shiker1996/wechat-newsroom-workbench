# 对话 Agent 表单化统一设计

> 状态：已实施（2026-09-03；三个对话 Agent 的表单更新与结束动作均已工具化）
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

### 协议层：所有业务动作通过原生工具完成

三个 Agent 均要求模型使用 API 原生 function tools，不再要求模型在普通输出中返回 JSON 信封，也不再从模型最终文本解析业务字段。

- **表单写入**：本轮有变化的字段调用共享业务工具 `cap_agent_form_update`，参数为 `operations:[{field,op,value/values}]`。工具按字段白名单执行，并返回当前 `formState`。
  - 多值字段使用 `append` 追加并去重，使用 `remove` 删除指定条目，使用 `clear` 清空；不能用一份较短数组隐式覆盖或删除旧内容。
  - 单值字段使用 `replace` / `set` 明确替换，使用 `clear` 明确清空；非法字段、非法操作和不符合字段规则的值拒绝执行。
  - 编辑室的 `adopted_research_points` 仍由专用 `cap_editorial_research_select` 工具写入，不允许通用表单工具绕过研判点 ID 校验。
- **结束本轮**：调用统一的 `cap_agent_conversation_finish`，只提交 `assistantReply`。工具执行成功后，Agent runtime 直接结束本轮并把回复交给路由；模型不再返回 `final` JSON。
- **模型能力前置条件**：三个对话 Agent 要求当前模型启用原生 function tools。未启用时立即报错，不退回模型 JSON 协议，避免出现两套行为。
- **`formUpdates`**：仍作为 HTTP/SSE 返回给前端的当前表单快照，不是模型输出格式；它用于刷新页面，不参与模型协议解析。
- **`ready`**：由代码根据当前表单计算，模型不再提交或影响该字段。
  - 编辑室：工具可更新 `angle`、`thesis`、`confirmed_facts`、`research_basis`、`author_opinions`、`confirmed_experiences`、`rejected_angles`、`forbidden_claims`；`adopted_research_points` 仍走专用研判点工具。
  - 自主写作：工具字段对应 `articleMode`、`topic`、`audience`、`environment`、`thesis`、`points`、`steps`、`prerequisites`、`expected_results`、`common_errors`、`limitations`、`materialUrls`。
  - 自定义图文：工具字段对应内容类型、渠道、主题、受众、场景、命题、要点、步骤/清单、素材 URL、限制和页数。
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

## 已实施改动

| 位置 | 改动 |
|---|---|
| `server/features/articles/domain/editorial-readiness.mjs` | `evaluateEditorialReadiness` |
| `server/features/articles/llm/editorial-room.mjs` | 编辑室上下文和问题生成；最终回复由结束工具提交，不再解析模型 JSON |
| `server/features/articles/domain/editorial-patch.mjs` | 提供编辑室底稿增量补丁的追加去重、明确删除/清空和单值替换逻辑 |
| `server/features/articles/application/agent/editorial-adapter.mjs` | 暴露研判选择、表单更新和结束工具；要求原生 function tools |
| `server/features/articles/llm/tutorial-chat.mjs` / `server/features/social-cards/llm/custom-social-chat.mjs` | 仅提供对话上下文，结构化写入和结束动作由原生工具完成 |
| `server/features/articles/application/agent/tutorial-adapter.mjs` / `server/features/social-cards/application/agent/custom-social-adapter.mjs` | 暴露 `cap_agent_form_update` 和 `cap_agent_conversation_finish`，维护本轮表单状态；不解析模型最终 JSON |
| `server/platform/agent/form-update-tool.mjs` | 提供共享字段白名单、追加去重、明确删除/清空、单值替换、工具 Schema 与执行结果 |
| `server/platform/http/routes/article-routes.mjs` | 锁简报门禁换 readiness |
| `server/features/articles/application/article-pipeline.mjs` | 成稿门禁换 readiness |
| `server/application/candidate-selection-service.mjs` | 预置首问改开场注入 |
| `public/src/views/editorial.js` | 成稿门六项检查换 missing[] 驱动；问题展示区改派生 |
| `skills/editorial-room-chat/SKILL.md` | prompt 同步，要求先确认采用的研判主线 |
| DB | `editorial_sessions.research_basis` 新增字段，schema v34；旧数据默认空值并需重新确认 |
| 测试 | 编辑室约一半用例改写；tutorial/custom-social 相关断言更新 |

## 兼容边界

- 历史 `editorial_sessions` 行保留旧列数据；新逻辑不读 `next_action`/`editor_question`/`open_questions` 作为判定依据（仅展示回退）
- `runConversationAgent` 的通用运行器仍保留旧信封能力，供其他尚未迁移的 Agent 使用；三个对话 Agent 在入口处强制 `nativeTools: true`，因此不会走旧信封解析分支。
- `cap_agent_form_update` 是三个对话 Agent 的唯一结构化表单写入口；工具写入后的当前状态会回传给模型，并作为 HTTP/SSE 的 `formUpdates` 快照返回前端。
- `cap_agent_conversation_finish` 是三个对话 Agent 的唯一正常结束入口。模型只提交 `assistantReply`，运行器收到成功工具结果后结束本轮。
- `briefUpdates` 不再是这三个 Agent 的可用协议字段；模型普通文本中的同名内容不会被程序读取。
- 不支持原生 function tools 的模型直接失败并提示更换模型，不退回 JSON 协议。

## 验收标准

1. 相关功能测试绿（含三个 Agent 的工具调用、结束工具、表单补丁落库/回传、就绪代码推导、缺项驱动提问、体验门禁、字段冻结补写）
2. S001 场景回归：多轮作答后不再重复提问；字段齐备即自动可成稿，无需模型声明
3. 锁简报与成稿流水线门禁行为与旧版一致（有缺项 409）
