# 四层选题筛选改造方案（现状与待实施清单）

状态：实施中（阶段 1–7 已完成，持续运营校准）  
日期：2026-08-23  
关联设计：[事件归并与事件热榜设计](./event-resolution-and-hotlist-design.md)

## 1. 这份方案解决什么问题

当前系统已经同时存在事件热榜、T、账号契合、读者利益和 F，但它们是在不同阶段逐步加入的，导致使用者不容易判断：

- 哪些是已经完成的能力；
- 哪些只是兼容字段；
- 哪些是下一阶段才会实施的目标；
- 为什么 T 高的事件，最终 F 可能完全不受 T 影响。

本方案只做一件事：把选题筛选收敛为一条由宽到窄的单向链路，并明确现状与目标的差异。

```text
稳定事件全量
  → L1 事件价值 T / 事件热榜
  → L2 账号契合
  → L3 读者利益
  → L4 文章化质量与最终成稿价值 F
  → 文章选题池
```

后层只收窄候选，不反向改写前层结论：F 低不能降低事件热榜 T，读者利益不足也不能让一个事件从事实层面变成“低热度事件”。

## 2. 现状盘点

### 2.1 已完成

| 能力 | 当前实现 | 主要位置 |
|---|---|---|
| 稳定事件归并 | 事件影子归并、稳定事件投影、报道归属和历史重复基础 | `server/domain/event-resolution-shadow.mjs`、`server/domain/event-resolution-cluster-projection.mjs` |
| 事件热榜 | 按稳定事件生成热度、增量、来源扩散、动量、新鲜度和历史衰减排名 | `server/domain/event-heat-ranking.mjs` |
| 热榜 UI | 热点全景拆分为事件热榜与事件全景两个 Tab，默认展示有限数量 | `public/index.html`、`public/src/views/hotspots.js` |
| 事件标题 | 优先使用主体、动作、对象和事件描述生成语义标题，不直接使用报道标题 | `server/domain/event-heat-ranking.mjs`、事件卡相关逻辑 |
| 文章池事件优先 | 常规文章池以单事件为主，维度组转到早报/行业盘点候选 | `server/features/research/application/research-pipeline.mjs` 的 `selectArticlePool()` / `selectBriefPool()` |
| T 预选分 | 已有 `topicValue`，用于从事件热榜候选宇宙中预选核心 8 条和黑马 2 条 | `server/features/research/application/research-pipeline.mjs`、`topic_value` 字段 |
| 读者利益展示 | 已生成 `readerStake` 文案，并展示结构化受众分；通知池仍用具体性硬门槛判断 | `scoreCards()`、`distribution-strategy.mjs`、选题页面 |
| F 成稿门槛 | 已有 H/B/P/S/D/F 计算和 `F < 55` 默认不进文章池 | `scoreCards()`、`candidate-selection-service.mjs` |
| 候选清理与重跑 | 重新研判前清理上一轮自动文章候选，保留人工锁定和成稿中候选 | `CandidateSelectionService` |

### 2.2 已完成但仍是旧口径

| 能力 | 当前口径 | 问题 |
|---|---|---|
| 事件热榜与 T | 热榜提供 `eventValue/t`，文章候选优先消费同一事件值；`topicValue` 保留旧字段 | 旧批次仍可能只有兼容 `topicValue`，待回放清理 |
| 账号契合 | 统一为 `accountFitByCategory`，文章池不再叠加到 T | 读者画像、作者资产和栏目承接理由仍待进一步细化 |
| P | 最终 P 直接读取候选 `accountFit` 或统一类别映射 | 历史字段 `pBase` 仍保留只读兼容 |
| 读者利益 | 已结构化为 `readerStakeScore`、目标读者、动作、后果和证据；通知池仍使用文字门槛 | 旧批次仍兼容读取 `audienceRelevance`，尚未完成所有历史字段迁移 |
| F | 已拆出 `A`，并按 `F = A×70% + T×30% − S − D` 计算；每批次生成新旧公式双跑审计 | 连续批次运营校准仍待完成 |

### 2.3 尚未实施

- 历史批次字段的命名迁移和回放清理；
- 连续 2–3 个批次的新旧公式运营校准，确认后再关闭双跑审计。

## 3. 目标模型

### L1：事件价值 T

T 是事件热榜排名，也是文章候选的事件价值底座。它只使用事件级事实和历史轨迹：热度、传播动量、事实增量、独立来源、证据完整度、影响范围、时效和重复衰减。

T 不读取账号定位，不判断标题是否吸引人，也不判断通知池资格。

目标字段：

```json
{
  "eventValue": 82,
  "t": 82,
  "eventHeatRank": 3,
  "eventHeatState": "new_update",
  "eventValueReason": ["出现正式回应", "新增两个独立来源"]
}
```

迁移期保留 `heatScore` 作为兼容别名。

### L2：账号契合

账号契合判断事件是否值得本账号承接，读取：

- `readerProfile`；
- `contentPillars`；
- 账号定位；
- 作者资产；
- 长期栏目方向。

输出：

```json
{
  "accountFit": 78,
  "fitLevel": "strong|explore|weak",
  "matchedPillars": ["开源与工程实践"],
  "reason": "与开发者工具和工程效率直接相关",
  "explorationReason": ""
}
```

账号契合不再通过“预选 +6”和最终 P 两次加分。预选阶段只做轻量优先级或探索项标记，最终阶段由同一结果映射到 P。

### L3：读者利益

读者利益判断具体读者会因此改变什么判断、决策或行动，必须包含：

- 目标读者；
- 变化对象；
- 需要采取的动作或改变的决策；
- 对工作、收入、岗位、效率、成本或选择的具体后果；
- 事实依据和不确定性。

输出：

```json
{
  "readerStakeScore": 4,
  "readerStake": "使用旧接口的开发者需要在8月前迁移，否则发布流程会中断并增加维护成本",
  "readerTarget": "使用旧接口的开发者",
  "readerAction": "在8月前完成迁移",
  "readerConsequence": "避免发布流程中断并增加维护成本",
  "readerStakeEvidence": "官方迁移公告",
  "notificationEligible": true
}
```

`readerStakeScore` 只作为 B 的受众相关性输入一次；文字版用于解释和通知池门槛，不额外增加 F。

### L4：文章化质量和 F

先计算不含 T 的文章化质量 A：

```text
A = H × 60% + B × 25% + P × 15%
F = A × 70% + T × 30% − S − D
```

- `H`：历史传播与题材基线；
- `B`：角度、情绪、标题、读者利益和事实支撑；
- `P`：L2 账号契合映射；
- `S`：同题饱和；
- `D`：同一事件、同一论点和跨日重复。

T 只进入 F 一次，默认权重 30%，可在 25%–40% 之间回放校准。热榜外事件不能通过 F 被“救回”。

## 4. 目标筛选流程

### 4.1 常规批次

1. 事件归并完成，生成稳定事件；
2. 生成全量事件热榜 T；
3. 取热榜前 50 个稳定事件作为文章候选宇宙；
4. 计算账号契合，标记强匹配、探索项和弱匹配；
5. 生成具体读者利益，缺少具体后果的候选降为观察/实验，不进入通知池；
6. 对通过前三层的候选进行脑暴和综合研判；
7. 计算 A、F，按 F 排序；
8. `F < 55` 默认不进入文章选题池；
9. 维度组仅进入早报/行业盘点候选，不绕过上述链路占用文章席位。

### 4.2 典型结果

| 情况 | 处理 |
|---|---|
| T 高、账号契合高、读者利益具体、F 高 | 进入文章选题池并优先编辑会 |
| T 高、账号契合高、F 低 | 留在事件热榜，可做快讯或观察，不进文章池 |
| T 中等、账号契合高、文章角度强 | 只要位于前 50 候选宇宙，仍可通过 F 排到前面 |
| T 高、读者利益泛化 | 留在热榜，降为实验/观察，不进通知池 |
| T 热榜外、文章包装很强 | 不进入常规文章池，可人工补选并单独标记 |

## 5. 分阶段实施计划

### 阶段 1：统一字段和只读审计

状态：已完成（2026-08-23）。

- `event-heat-ranking.json` 增加 `eventValue`、`t`，保留 `heatScore` 别名；
- 稳定事件投影、预选排名和候选对象均带入 `eventValue/T` 审计字段；
- `topicValue` 和 F 公式暂不改变，文章池结果保持旧口径；
- 增加热榜别名一致性测试；相关事件热榜、事件投影和研究流水线测试全部通过；
- 阶段 1 的剩余收口：完成历史批次两套 T 的回放对照。

### 阶段 2：T 成为唯一事件初筛分

状态：已完成（2026-08-23）。

- `topicValueParts()` 在有事件热榜数据时直接读取事件值作为 T；无热榜数据时保留旧回退值；
- 删除 T 中开发者直接利益的额外 `+4`；直接利益仍保留为保护位信号；
- `selectArticlePool()` 按 T 构造前 50 候选宇宙，账号契合只作为结构化标记和轻量同分优先级，不再叠加到事件分；
- 开发者直接利益和工具席位保护继续保留，但作为组合约束，不写入 T；
- 新增阶段 2 的账号契合不叠加测试；事件热榜、事件投影和研究流水线相关测试全部通过；
- 阶段 2 的剩余收口：在双跑报告中展示 T/旧 `topicValue` 差异。

### 阶段 3：账号契合与 P 合并

状态：已完成（2026-08-23）。

- 建立统一 `accountFitByCategory` 结果：强匹配 80、探索 45、弱匹配 25，支持账号配置覆盖；
- 文章池不再把 `accountFit` 叠加到 T，P 直接读取候选的 `accountFit` 或统一类别映射；
- `pBase` 和可信独家旧口径不再参与最终 P，旧字段仅保留兼容；
- 页面和评分说明已迁移为“账号契合 P”；
- 新增 P 读取 accountFit 的回归测试；相关测试全部通过；
- 阶段 3 的剩余收口：把 `accountFit` 从“类别映射”扩展为读者画像、作者资产和栏目承接理由的结构化结果。

### 阶段 4：读者利益结构化

状态：已完成（2026-08-23）。

- 保留现有 `readerStake` 文字和通知池门槛；
- 新增 `readerStakeScore`、`readerTarget`、`readerAction`、`readerConsequence` 和 `readerStakeEvidence` 字段；
- B 的受众项优先读取 `readerStakeScore`，旧批次的 `audienceRelevance` 仅作兼容回退，同一利益不重复叠加；
- 新结构化候选的文字利益若仍未通过具体性校验，受众分确定性封顶为 2/5，避免模型自报高分；
- 保留 `readerStake` 文字和通知池硬门槛，结构化分不绕过通知资格校验；
- 评分结果和候选表持久化 `reader_stake_score`，供页面和后续回放审计；
- 已增加阶段 4 回归测试：结构化分覆盖旧受众分且只计入 B 一次，通知门槛测试继续通过。

### 阶段 5：F 接入 T

状态：已完成（2026-08-23）。

- `scoreCards()` 先计算文章化质量 A，再按 `F = A×70% + T×30% − S − D` 计算最终分；
- 新增 `eventValueWeight`，默认 0.30，并限制在 0.25–0.40；
- 持久化 `event_value`（T）、`article_value`（A）和原有 `f_score`（F），保留 `topic_value` 兼容；
- 报告和选题卡展示 `T/A/H/B/P/S/D/F`；
- 已增加回归测试：同等 A 下 T 更高者 F 更高；旧数据无 T 时按 T=0 兼容计算；
- T 很高但 A 很低时仍可能因 F 不达标而不进文章池，成稿线保持不变。

### 阶段 6：双跑、回放和切换

状态：已完成（2026-08-23；进入运营校准）。

- 每个研判批次生成 `score-dual-run.json` 和 `score-dual-run.md`，并行记录旧公式 `F_legacy = A - S - D` 与新公式 `F = A×(1-T权重) + T×T权重 - S - D`；双跑只做审计，不改变当前新公式排序；
- 固定回放高 T/低 A、低 T/高 A、重复事件高 D、读者利益缺失四类样本，统计达成稿线数量、入池变化、排名变化和平均分差；
- 将新旧分差、样本标签、旧/新达线结果写入批次 artifacts，供连续 2–3 个批次运营校准；
- 当前批次继续使用新 F，`topic_value` 等旧字段保留读取兼容，历史批次不重新解释；完成校准后再删除双跑审计属于后续运维动作，不在本阶段自动执行。

### 阶段 7：跨批次运营校准

状态：已完成（2026-08-23；仅输出建议，不自动改权重）。

- 新增 `GET /api/topic-score-metrics?days=7`，聚合窗口内所有已生成双跑审计的批次；
- 汇总成稿线变化率、排名变化率、平均分差，以及四类定向回放样本比例；
- 当样本不足 2 个批次时返回 `insufficient_sample`；达到样本数但出现入池突变、平均分差过大、重复事件过多或读者利益缺失过多时返回 `review`，明确“先处理异常样本，不自动调整权重”；
- 指标只用于运营校准，T 权重仍由 `scoring.eventValueWeight` 控制，保持 0.25–0.40 的安全范围。

## 6. 代码改造清单

| 文件/模块 | 改造内容 | 阶段 |
|---|---|---|
| `server/domain/event-heat-ranking.mjs` | 增加 `eventValue/T` 兼容字段，明确事件价值唯一来源 | 1 |
| `server/features/research/application/research-pipeline.mjs` | 统一 T、拆出 A、接入 T 权重、合并 accountFit/P、接入 readerStakeScore | 2–5 |
| `server/platform/persistence/migrations.mjs` | 增加 `event_value`、`article_value` 评分字段并升级 Schema v15 | 5 |
| `server/platform/persistence/repositories/candidate-repository.mjs` | 持久化 T/A/F、账号契合和读者利益审计信息 | 3–5 |
| `server/application/candidate-selection-service.mjs` | 保存新评分字段，保持重跑清理和人工候选保护 | 4–5 |
| `public/index.html` | 更新评分说明和公式 | 3–5 |
| `public/src/views/topics.js` | 展示 T、A、F 及分层状态 | 5 |
| `sources/score-dual-run.json`、`score-dual-run.md` | 每批次留存新旧公式分差、四类回放样本与入池/排名变化 | 6 |
| `server/domain/topic-score-operations.mjs` | 聚合多个批次双跑结果并输出校准状态 | 7 |
| `GET /api/topic-score-metrics` | 向选题池和运营校准页提供只读指标 | 7 |
| `test/research-pipeline.test.mjs` | 增加四类回放和新旧公式对照测试 | 1–6 |

## 7. 最终验收标准

1. 事件热榜只由事件价值 T 排序，不受账号定位影响；
2. 文章候选只能来自 T 通过的候选宇宙；
3. 账号契合不会与 P 重复加分；
4. 读者利益只进入 B 一次，并能决定通知池资格；
5. F 明确包含 T，但不会重复计算热度和新鲜度；
6. 能解释候选在哪一层被保留、降级或淘汰；
7. 高 T 低 A 的事件可以留在热榜但不进文章池；
8. 低 T 但 A 高的候选只有在热榜候选宇宙内才可竞争；
9. 同一事件、同一角度不会因多个报道或维度组重复占位；
10. 历史批次、人工锁定候选和非文章轨道不被新评分迁移破坏。
