# 采集与研判阶段 Token 优化方案

状态：待 Review（仅设计，未改实现）  
日期：2026-09-04  
适用范围：常规热点批次的采集后打标、事件卡、讨论研判、候选生成、脑暴与综合复排

## 1. 背景与目标

当前采集与研判阶段的模型消耗明显高于后续成稿阶段。问题的主要来源不是单个模型输出过长，而是同一批资料在不同阶段反复展开，并且低价值事件也进入了高成本处理路径。

本方案的目标是：

1. 保持现有的全量采集、可审计、证据边界和人工编辑会门禁；
2. 让每次模型调用只接收完成当前任务所需的最小上下文；
3. 将“全量筛选”和“深度研判”分层，避免对所有事件生成完整研究资料；
4. 保留原始数据和完整研究报告在本地产物中，减少模型输入不等于删除审计资料；
5. 支持按阶段恢复，避免下游失败后重复执行已经完成的模型调用。

非目标：本方案不改变 T/J/A/C/F 的业务含义，不改变 Top-K、核心 8 条+黑马 2 条和编辑会的决策门禁，不通过删除来源来降低 token。

## 2. 现状证据

以批次 `2026-09-04-8d8654e5ea` 的 `model_calls` 审计为例：

| 阶段 | 调用次数 | Prompt token | Completion + reasoning token |
|---|---:|---:|---:|
| 讨论研判 | 23 | 949,169 | 108,546 |
| 事件卡 | 112 | 386,899 | 185,414 |
| 语义打标 | 72 | 171,221 | 152,563 |
| 探索脑暴 | 4 | 248,554 | 9,794 |
| 综合复排 | 1 | 3,880 | 5,096 |
| 合计 | 212 | 1,759,723 | 461,413 |

当前批次共有 586 条热点和 336 个稳定事件。讨论研判阶段出现过单次约 320,636 prompt token 的请求，之前还有两次约 255,557 prompt token 的失败请求。

阶段 3 当前输入的主要组成如下：

| 输入部分 | 字符数 | 问题 |
|---|---:|---|
| `internal_research` | 198,697 | 与研判素材重复 |
| `inter_event_research` | 73,188 | 关系细节过多，部分与素材重复 |
| `verified_research_materials` | 385,651 | 包含信号、关系、来源片段和报告衍生内容 |
| `research_reports` | 63,507 | 与上述结构化素材再次表达相同结论 |
| 合计 | 约 72 万 | 远大于候选生成所需的最小信息量 |

## 3. 核心设计原则

### 3.1 原始资料与模型上下文分离

完整来源、原始事件卡、完整 Markdown 研判报告和结构化研判素材继续写入本地文件，用于审计、编辑查看和成稿回溯；模型输入使用专门的 compact view。

```text
完整数据层：原始热点 / 事件卡 / 研判报告 / 证据片段
                         ↓ 确定性裁剪
模型上下文层：当前任务所需的事件摘要 / 研判摘要 / 引用 ID
```

### 3.2 一个事实只在当前模型上下文中表达一次

阶段 3 不同时传入完整报告、完整信号、完整关系和完整研判素材。应选择一个 canonical research digest 作为主要输入，其余内容只保留 ID 和回溯指针。

### 3.3 先便宜筛选，再昂贵研判

全量热点需要保留，但不代表全量热点都需要完整事件卡、联网研判和脑暴。

### 3.4 不用截断替代语义裁剪

不得直接对整个 JSON 做字符截断。所有裁剪都必须按字段和对象边界执行，并保留 `truncated_fields` 或 `omitted_count`，便于审计。

### 3.5 失败重试只扩大必要范围

输出格式失败时，优先减少字段和输入范围，再重试；不得把同一份超大输入原样重复发送。

## 4. 目标流程

```text
全量热点
  ↓
轻量语义打标（全量）
  ↓
确定性事件归并 + 事件价值 T
  ↓
轻量路由卡（全量稳定事件）
  ↓
候选宇宙 / Top-K
  ↓
完整事件卡（只对候选宇宙或 Top-K）
  ↓
单事件研判（只对 Top-K，搜索按需开启）
  ↓
规范化研判摘要
  ↓
候选选题生成（紧凑输入）
  ↓
研究依据裁剪后的探索脑暴
  ↓
综合复排
```

### 4.1 目标输入规模

以下是设计目标，不是硬编码上限：

| 阶段 | 当前 | 目标 |
|---|---|---|
| 语义打标 | 全量热点，每批约 8 条 | 全量保留；每批 12～16 条，按输出预算动态拆分 |
| 事件卡 | 全量稳定事件 | 轻量路由卡全量；完整事件卡只处理候选宇宙或 Top-K |
| 单事件研判 | Top-K，每个事件带批次索引并可联网 | Top-K；比较索引进一步压缩；低价值事件跳过联网 |
| 候选生成 | 完整报告+完整信号+完整关系+完整素材 | 每事件一份 canonical research digest |
| 探索脑暴 | 候选可能携带整批研判依据 | 每候选只携带关联事件和引用 ID 对应的少量素材 |
| 综合复排 | 已较紧凑 | 保持现状，仅限制输出字段长度 |

## 5. 研判上下文契约

新增内部 compact view，不替换现有完整产物。

### 5.1 事件级研究摘要

```json
{
  "event_id": "S_EVENT_001",
  "title": "事件语义标题",
  "event_value": 82,
  "category": "🏢 大厂战略",
  "research_status": "model_reported|needs_review|failed",
  "core_findings": [
    {
      "signal_id": "S_EVENT_001:model:1",
      "kind": "anomaly|interest_conflict|divergence",
      "statement": "一句话结论",
      "difference": "预期与观察的差异",
      "reader_impact": "对具体读者的影响",
      "status": "supported|needs_review",
      "evidence_source_ids": ["source:1"]
    }
  ],
  "relation_findings": [
    {
      "relation_id": "MR-001",
      "kind": "sequence|response|comparison|trend|counterexample",
      "event_ids": ["S_EVENT_001", "S_EVENT_002"],
      "statement": "一句话关系判断",
      "difference": "具体差异",
      "thesis_seed": "观点种子",
      "status": "model_reported|needs_review",
      "evidence_source_ids": ["source:1", "source:2"]
    }
  ],
  "evidence_boundary": "可确定表达与必须保留的限定语",
  "omitted": {
    "signals": 4,
    "relations": 8,
    "source_clips": 12
  }
}
```

### 5.2 候选级研究依据

脑暴输入只允许携带候选真正使用的依据：

```json
{
  "candidate_id": "MR-T-001",
  "event_ids": ["S_EVENT_001"],
  "research_basis": {
    "material_refs": ["RM-001"],
    "signal_refs": ["S_EVENT_001:model:1"],
    "relation_refs": [],
    "evidence_source_ids": ["source:1"],
    "findings": [
      {
        "kind": "anomaly",
        "statement": "短结论",
        "difference": "短差异",
        "status": "needs_review",
        "evidence_source_ids": ["source:1"]
      }
    ],
    "boundary": "待核验项"
  }
}
```

规则：

- 候选已有引用 ID 时，按引用 ID 精确筛选；
- 候选没有引用 ID 时，按 `event_ids` 绑定该事件的前 3 条最高价值素材；
- 不能因为引用 ID 为空而注入全部事件、全部关系和全部素材；
- 每个候选最多 3 条信号、3 条关系、8 个来源 ID；
- 详细来源摘要不进入脑暴默认输入，编辑室查看或成稿核验时按 ID读取。

## 6. 分阶段改造

### Phase A：修复重复上下文（P0）

目标：不改变业务流程，只改变模型输入。

#### A1. 候选生成使用 canonical digest

改造 `buildTopicResearchModelInput()`：

- 移除完整 `internal_research`、`inter_event_research` 和 `verified_research_materials` 的直接注入；
- 由程序生成 `research_digest`；
- `research_reports` 只保留每个事件的短摘要或报告 ID，不传完整 Markdown；
- `evidence_clips` 只保留 source ID，完整片段留在本地文件；
- 限制每个事件和关系的输入条数，并记录省略数量。

建议保留完整资料的位置：

- `sources/discussion-research.json`
- `sources/internal-signals.json`
- `sources/event-relations.json`
- `sources/verified-research-materials.json`
- `discussion-research-report.md`

#### A2. 修复脑暴全量回退

改造 `researchBasisForCandidate()`：

- 将“无引用 ID”从“选择全部素材”改为“按候选事件定向选择”；
- 关系型候选优先选择其 `relation_ids` 对应关系及关系两端事件的少量信号；
- 单事件候选只读取对应事件的信号；
- 对筛选后的结果执行数量和字符串长度上限；
- 在输出中保存 `basis_selection_reason`，说明是按引用 ID还是事件关联回退。

重点位置：

- `server/features/research/application/research/discussion-research-stage.mjs`
- `server/features/research/application/research/editorial-exploration.mjs`

#### A3. 压缩账号上下文

脑暴不需要每次携带完整账号档案和作者资产。新增一次确定性摘要：

- 账号定位：最多 500 字；
- 内容支柱：只保留名称和一句描述；
- 读者画像：最多 5 条结构化要点；
- 作者资产：只保留与当前候选类别相关的条目，未确认资产保留状态；
- 禁写项和披露边界：完整保留。

完整快照继续写入 `account-context-snapshot.md`。

### Phase B：全量轻量路由，延迟完整事件卡（P1）

当前 336 个稳定事件全部生成完整事件卡。将事件卡拆成两个模型契约：

#### B1. route card

面向全量事件，只返回：

- `event_id`
- `content_class`
- `article_eligible`
- `social_eligible`
- `default_route`
- `confidence`
- `missing_evidence`

输出必须是短 JSON，不生成背景、时间线、争议和角度。

#### B2. full event card

只对以下集合生成：

- 文章候选宇宙（默认前 50 个事件）；或
- 最终 Top-K 事件；或
- 用户手工补选的事件。

完整事件卡仍保留当前字段和产物格式，避免影响编辑页面和后续成稿。

如果现有 T 计算依赖事件卡分类，则先执行 route card，再计算 T，再执行 full event card。full event card 补齐后不得反向修改 T 的定义，只能更新可展示事实和证据字段。

### Phase C：联网和 Top-K 门控（P1）

单事件研判仍保持“一事件一次交互”的设计，但增加确定性搜索门控：

- `T` 较低且本地已有至少 2 个独立来源：默认关闭联网；
- Top 3～5 事件或本地证据不足：允许原生联网；
- 事件卡已存在明确反常/冲突证据：只在需要外部基线时联网；
- 事件间关系只对实际存在候选关系的事件开放搜索；
- 搜索后的报告只保留短来源摘要和来源 ID，不能把工具返回的全部中间内容继续传给下游。

`discussionResearchTopK` 继续支持 `5 / 8 / 10`，默认建议使用 8；Top-K 是成本旋钮，不改变全量热点和事件热榜产物。

### Phase D：批处理与输出预算优化（P2）

这是低风险的工程优化，放在上下文裁剪之后：

- `taggingChunkSize` 默认从 8 调整到 12，按 provider 最大输出预算动态确定；
- `eventCardChunkSize` 默认从 3 调整到 6；
- `topic_generation` 关闭 thinking，只做已有材料的候选整理；
- 失败重试优先使用 compact input 和更短 schema；
- 输出数组长度和字符串长度由代码做确定性上限；
- 只有在输出长度确实成为瓶颈时才提高输出预算，不以 `maxOutputTokens` 作为默认兜底。

### Phase E：缓存与断点复用（P2）

#### E1. 跨批次内容哈希缓存

对以下输入生成稳定 hash：

- 规范化标题、摘要、URL、发布时间；
- 事件成员 hotspot ID；
- 对应 skill 版本；
- 模型和 prompt 版本。

在 hash 未变化时，可以复用：

- 事件卡；
- 单事件研判报告；
- compact research digest。

缓存命中必须记录 `cache_hit`、来源批次和版本，不得把旧报告伪装成当前批次新生成。

#### E2. 阶段失败恢复

阶段 1/2 已完成而阶段 3 失败时，只重试阶段 3。阶段 3 或脑暴失败时，不重新调用单事件研判。

需要重点确认：手动“重新执行事件研判”和失败对象重试是否都优先读取 `discussion-research-stage3-input.json`，避免同一批次重复产生单事件模型调用。

## 7. 数据与产物兼容

不删除现有字段，新增 compact 产物或内部字段：

| 产物 | 处理方式 |
|---|---|
| `discussion-research.json` | 保留完整研究结果，新增 `research_digest` 可选字段 |
| `discussion-research-input.json` | 同时记录完整审计输入和 compact 输入版本 |
| `discussion-research-stage3-input.json` | 保留断点，增加 `input_profile`、`input_chars`、`estimated_tokens` |
| `verified-research-materials.json` | 保留完整素材，不改证据状态语义 |
| `event-cards.json` | 兼容完整卡；route card 可单独写入内部缓存或新产物 |
| `topics-ranked.md` | 展示逻辑不变，可增加“研判依据数/省略数”审计信息 |

建议新增：

```text
sources/research-digest.json
sources/event-route-cards.json
sources/token-budget-report.json
```

`token-budget-report.json` 至少记录每阶段：

```json
{
  "stage": "topic_generation",
  "input_profile": "compact-v1",
  "candidate_count": 8,
  "input_chars": 42000,
  "estimated_input_tokens": 18000,
  "omitted": {
    "signals": 12,
    "relations": 31,
    "source_clips": 86
  },
  "quality_gate": "passed"
}
```

## 8. 质量与安全门禁

优化后必须继续满足：

1. 全量热点和来源仍写入原始产物；
2. compact view 中的每条结论可回溯到 `material_id`、`signal_id` 或 `relation_id`；
3. `needs_review`、`model_reported` 和 `verified` 状态不被裁剪或错误升级；
4. 省略来源只影响模型上下文，不影响编辑查看和成稿核验；
5. 候选没有引用 ID 时，不得把整批研判资料作为默认回退；
6. 同一事件的相同关系经过确定性去重后，不得重复占用关系数量；
7. T/J/A/C/F 的评分字段和排名不因 token 优化而改变定义；
8. route card 失败时只能降级到现有完整事件卡流程，不能静默把事件排除；
9. 缓存命中必须标记版本和来源批次；
10. 任意 compact 输入都必须能通过 JSON/schema/长度门禁。

## 9. 验收指标

### 9.1 成本指标

以同一批次或可比批次进行 A/B：

- 总 prompt token 降低至少 35%；
- 阶段 3 单次 prompt token 不超过 50,000，目标 20,000～30,000；
- 脑暴单次 prompt token 不超过 25,000；
- 不出现 200,000 token 以上的阶段 3请求；
- 因输出截断产生的重试次数不增加。

### 9.2 质量指标

- Top-K 事件集合与优化前一致；
- 候选数量、候选事件 ID 和研究状态不低于优化前；
- 每条 PASS 候选仍能回溯到至少一个研判素材和一个来源 ID；
- 关系型候选的关系类型、端点和证据边界保持一致；
- 编辑会页面仍能查看完整研究报告和来源；
- T/J/A/C/F 排名在同输入下保持一致，或任何差异都有明确版本原因。

### 9.3 稳定性指标

- compact 输入无 JSON 截断；
- route card、完整事件卡和脑暴的失败对象可单独重试；
- 阶段 3 失败恢复不重新调用阶段 1/2；
- 缓存命中和缓存失效原因可审计。

## 10. 实施顺序与建议

建议按以下顺序实施：

1. **P0-A：canonical research digest**；
2. **P0-B：修复 `researchBasisForCandidate()` 的全量回退**；
3. **P0-C：增加 token budget report 和 compact 输入测试**；
4. **P1：事件卡 route/full 两级拆分**；
5. **P1：联网搜索门控**；
6. **P2：批大小、thinking 和重试预算优化**；
7. **P2：跨批次 hash 缓存和断点恢复增强**。

P0 完成后先跑 2～3 个真实批次，确认候选质量和 T/J/A/C/F 稳定，再实施事件卡延迟生成。这样可以把“输入裁剪收益”和“流程分层收益”分开验证。

## 11. 待 Review 问题

1. 完整事件卡是否必须对全部 336 个稳定事件可立即查看，还是允许只对候选宇宙生成？
2. `discussionResearchTopK` 默认值是否从 10 固定为 8？
3. 原生联网搜索是否接受“Top 3～5 默认开启，其余按证据门控”的策略？
4. compact view 是否作为内部模型输入，不在编辑页面单独展示？
5. 是否接受新增 `research-digest.json`、`event-route-cards.json` 和 `token-budget-report.json` 三个产物？

## 12. 关联实现位置

- `server/features/research/application/research/discussion-research-stage.mjs`
  - `buildTopicResearchModelInput()`：阶段 3 输入重复的主要位置；
  - `buildSingleEventResearchModelInput()`：单事件研判输入；
  - `completeSingleEventResearchReport()`：联网和输出预算；
- `server/features/research/application/research/editorial-exploration.mjs`
  - `researchBasisForCandidate()`：候选研究依据筛选；
  - `brainstorm()`：账号上下文和候选依据重复注入；
- `server/features/research/application/research/event-card-stage.mjs`
  - `generateEventCards()`：全量完整事件卡；
  - `ensureBatchEventCards()`：事件卡缓存和增量逻辑；
- `server/features/research/llm/tasks.mjs`
  - `tagBatch()`：全量打标批大小和重试；
- `server/features/research/application/research-pipeline.mjs`
  - `discussionResearchTopK`：深度研判范围；
  - 阶段 3 checkpoint 和研究产物持久化。

