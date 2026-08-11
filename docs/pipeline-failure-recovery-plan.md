# 流水线失败记录、重试与跳过方案

> 状态：Phase 1–4 已实施（2026-08-11）

## 1. 背景

当前采集、语义打标、事件卡、事件研判已经具备部分重试和降级能力，但各阶段保存失败信息的方式不一致：

- 采集失败按来源写入 `source_runs` 或 `subscription_runs`。
- 打标任务只在 `ai_runs.result_json` 保存 `failedIds`，详细错误位于未关联热点 ID 的 `model_calls`。
- 事件卡失败写入 `event-cards.json` 的 `failed` 数组。
- 研判多数错误只保存为批次级 `ai_runs.error`。
- 前端只能看到最近任务的汇总错误，不能查看失败对象，也不能对单个对象执行重试或跳过。

本方案建立统一的失败对象索引，并在批次流水线中提供“查看、重试、跳过”操作。失败事实仍由各阶段现有审计表或产物保留，统一表负责把失败原因与可操作对象稳定关联起来。

## 2. 核心原则

### 2.1 不同阶段使用不同失败对象

| 阶段 | 失败对象 | 对象键 | 跳过含义 |
|---|---|---|---|
| 采集 | 当前批次的一次采集源执行 | `subscription_run.id`，顶层来源用 `source_run.id` | 本批次不再重试该来源，允许使用其他来源结果继续 |
| 打标 | 热点记录 | `hotspots.id` | 本批次不再让该热点进入事件聚类和研判 |
| 事件卡 | 聚类事件 | 稳定的 `event_id` | 该事件无事件卡继续，或明确不进入后续研判，取决于跳过策略 |
| 研判 | 可定位的事件或候选；否则是整个阶段 | `event_id`、候选 ID 或阶段键 | 只允许跳过可独立排除的对象；批次级门禁错误只能重试 |

采集阶段不创建“失败热点”。来源请求失败时通常没有形成热点记录，因此必须以当前批次的采集源执行为操作单位。

### 2.2 “失败”与“跳过”是两种状态

- `open`：仍待处理，可重试或跳过。
- `retrying`：正在重试。
- `resolved`：重试成功，系统自动关闭。
- `skipped`：用户明确接受本批次缺失，系统记录决策并继续。
- `superseded`：对象或聚类键发生变化，旧失败记录被新执行替代。

跳过不是删除失败日志，也不是伪装成成功。原错误、尝试次数和用户决策必须保留。

### 2.3 只有可安全隔离的失败才能跳过

以下错误不显示“跳过并继续”：

- 数据库写入失败。
- 批次不存在或配置不可用。
- 事件聚类报道数不守恒。
- 模型整体不可用、鉴权错误或配额错误，且没有产生任何可用结果。
- 研判 JSON 整体损坏、全部候选为空等批次级门禁错误。

这些错误只提供“重试”与“查看日志”。

## 3. 数据模型

新增 `pipeline_failures` 表：

```sql
CREATE TABLE pipeline_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  run_id TEXT,
  stage TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_key TEXT NOT NULL,
  source_run_id INTEGER,
  subscription_run_id INTEGER,
  hotspot_id INTEGER,
  candidate_row_id INTEGER,
  title TEXT NOT NULL DEFAULT '',
  url TEXT,
  error_code TEXT,
  error_message TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',
  retry_count INTEGER NOT NULL DEFAULT 0,
  first_failed_at TEXT NOT NULL,
  last_failed_at TEXT NOT NULL,
  resolved_at TEXT,
  skipped_at TEXT,
  skip_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE,
  FOREIGN KEY(source_run_id) REFERENCES source_runs(id) ON DELETE SET NULL,
  FOREIGN KEY(subscription_run_id) REFERENCES subscription_runs(id) ON DELETE SET NULL,
  FOREIGN KEY(hotspot_id) REFERENCES hotspots(id) ON DELETE SET NULL,
  FOREIGN KEY(candidate_row_id) REFERENCES candidates(id) ON DELETE SET NULL,
  UNIQUE(batch_id, stage, object_type, object_key)
);
```

建议索引：

```sql
CREATE INDEX idx_pipeline_failures_batch_status
  ON pipeline_failures(batch_id, status, stage);
CREATE INDEX idx_pipeline_failures_run
  ON pipeline_failures(run_id);
```

### 3.1 为什么不替换现有日志表

- `source_runs/subscription_runs` 仍是采集执行事实。
- `model_calls` 仍是模型调用审计和 token 统计。
- `ai_runs` 仍是任务级状态。
- `event-cards.json` 仍是事件卡产物和可移植快照。
- `pipeline_failures` 只提供跨阶段统一查询、对象关联和操作状态。

### 3.2 `object_key` 约定

- 采集订阅源：`subscription:<subscription_run_id>`。
- 顶层采集源：`source:<source_run_id>`。
- 打标热点：`hotspot:<hotspot_id>`。
- 事件卡：`event:<event_id>`。
- 研判候选：`candidate:<candidate_row_id>`。
- 不可定位的阶段错误：`stage:<stage_name>`，并设置 `skippable=false` 到 `detail_json`。

## 4. 各阶段行为

## 4.1 采集

### 失败写入

每次 `onSourceResult` 返回 `status=failed` 后：

1. 先照常写入 `subscription_runs`。
2. 使用返回的 `subscription_run.id` 创建或更新 `pipeline_failures`。
3. 保存来源组、来源类型、来源键、来源名称、请求地址或路由、HTTP 状态和错误信息。

顶层 Reddit、RSSHub、GitHub 任务整体失败时，关联 `source_runs.id`。如果已有具体订阅源失败记录，顶层错误仅作为不可跳过的汇总错误，避免重复展示为多个可操作来源。

### 重试

“重试来源”只执行原失败来源，不重新采集整个来源组：

- RSS/RSSHub/Twitter：按原 `source_key` 重跑单个 target。
- Reddit：按原 subreddit 重跑。
- GitHub Trending/Search/AI Search：按具体通道和查询重跑。

成功后：

- 新建一条 `subscription_runs` 执行记录，不覆盖旧失败记录。
- 正常去重入库热点。
- 将对应 `pipeline_failures` 标为 `resolved`。

### 跳过

“跳过本批次”只把对应失败标为 `skipped`，不禁用全局数据源配置，也不删除历史执行记录。后续自动流程将该来源视为“已决策”，但批次详情仍显示“采集失败，已人工跳过”。

当至少一个来源成功，且其余失败来源均为 `resolved/skipped` 时，采集阶段可以完成。如果所有来源都失败，即使全部点击跳过，也应显示“无有效采集结果”，不能进入打标。

## 4.2 语义打标

### 失败写入

`tagBatch` 在单条热点达到重试上限时，为每个 `failedId` 写入失败记录，并保存：

- 热点标题、URL、来源。
- 最后一次模型调用 ID。
- 错误类型：网络、超时、空响应、JSON 截断、JSON 无效、缺字段、漏回 ID。
- 尝试过的 thinking 状态和次数。

不再只保存 `failedIds`。任务结果仍保留 `failedIds` 以兼容现有 API。

### 重试

单条重试调用现有 `tagBatch(limit/指定 ID)` 的扩展入口，只提交目标热点。成功后标记失败记录为 `resolved`。

### 跳过

将热点的 `research_eligible` 置为 `0`，同时在失败表记录 `skipped` 和原因。建议在 `raw_json` 或新字段中额外保存排除来源为 `manual_failure_skip`，避免与规则过滤、手动录入排除混淆。

跳过后重新计算 `ai_status.total`，研判门禁不再把该热点计入“缺少完整语义标注”。

## 4.3 事件卡

### 失败写入

复用 `generateEventCards` 已产生的 `{event_id, error}`，补充：

- 代表标题。
- 聚类内热点 ID、标题和来源。
- 最后一次模型调用 ID。
- 错误类型和重试次数。

`event-cards.json.failed` 继续保留，数据库记录用于 UI 和操作。

### 重试

按 `event_id` 重新构造当前聚类并只生成该事件卡。成功后合并写回 `event-cards.json`，将失败标为 `resolved`。

如果重新打标导致 `event_id` 改变，旧记录标记为 `superseded`，不能继续对旧事件重试。

### 跳过策略

第一版建议采用保守策略：事件卡失败后跳过该事件参与研判，而不是生成“空事件卡”继续评分。原因是事件卡承担事实边界，缺少它时继续脑暴容易产生无来源结论。

UI 文案应为“跳过该事件，不进入本批次研判”，并展示会排除多少条热点。

后续如果需要“无事件卡降级研判”，应单独设计 `degraded` 状态和确定性降分规则，不与普通 `skipped` 混用。

## 4.4 事件研判

研判包含全局竞争、维度筛选、探索脑暴、综合评分等批次级操作，并非所有失败都能对应一条数据。

第一版规则：

- 可定位到某个事件或候选，且其他对象已有有效结果时，可创建对象级失败并允许跳过。
- 模型调用、JSON 门禁、聚类守恒、全部候选为空等全局错误，创建 `object_type=stage` 的失败，只允许重试。
- 跳过候选不能改变原始模型结果；仅从本次后续评分或候选池写入中排除，并保留审计记录。

第一期可以只展示研判阶段失败及“重试”，暂不实现对象级跳过，避免错误扩大到评分一致性。

## 5. API 设计

### 查询失败记录

```http
GET /api/batches/:id/pipeline-failures?status=open,retrying&stage=collect,tag,event-card,research
```

返回失败对象、来源信息、错误、尝试次数、是否可跳过及允许的操作。

### 单条重试

```http
POST /api/batches/:id/pipeline-failures/:failureId/retry
```

服务端根据 `stage/object_type` 路由到具体重试处理器。重复点击应返回当前运行中的同一任务，避免并发重试。

### 跳过

```http
POST /api/batches/:id/pipeline-failures/:failureId/skip
Content-Type: application/json

{ "reason": "与账号方向无关，本批次不再处理" }
```

服务端必须重新读取失败记录并校验：仍为 `open`、对象仍存在、`skippable=true`、当前没有同对象重试任务。

### 恢复已跳过对象

```http
POST /api/batches/:id/pipeline-failures/:failureId/reopen
```

采集源可直接恢复为 `open`。打标/事件卡恢复时要同步撤销对应的本批次排除标记，然后允许重试。

## 6. 前端方案

在批次抽屉流水线下方新增“待处理失败”区域：

- 按采集、打标、事件卡、研判分组。
- 流水线步骤显示失败数量，例如“语义打标 281/282 · 1 条待处理”。
- 默认只显示 `open/retrying`，可展开查看已解决和已跳过记录。

采集失败项示例：

```text
采集源：/readhub/daily
RSSHub · HTTP 503 · 10:10 失败
[重试来源] [跳过本批次] [查看日志]
```

打标失败项示例：

```text
热点 #10441：Is the “average” of this function non-zero and finite?
模型返回 0/1 条有效标注 · 已尝试 3 次
[单条重试] [跳过该热点] [查看原始记录]
```

危险操作确认文案必须描述影响范围，例如：“跳过后，该事件及其 4 条报道不会进入本批次研判；可在失败记录中恢复。”

## 7. 流水线完成条件

每个阶段不再只判断“成功数量是否等于总数”，而是判断所有应处理对象是否已决策：

```text
decided = succeeded + resolved + skipped
pending = total - decided
```

- `pending > 0`：阶段显示“待处理失败”，自动流程暂停在该阶段。
- `pending = 0` 且存在 skipped：阶段显示“已完成，有跳过项”。
- `pending = 0` 且无 skipped：阶段显示“已完成”。

采集阶段额外要求至少有一个成功来源且产生有效热点；打标和事件卡阶段额外要求剩余可研判对象非空。

## 8. 实施顺序

### Phase 1：失败索引与只读展示

- 新增迁移、repository、query service。
- 接入采集、打标、事件卡失败写入。
- 批次抽屉展示失败对象和详细错误。
- 暂不改变现有流程门禁。

### Phase 2：重试

- 采集源单独重试。
- 热点单条打标重试。
- 单个事件卡重试。
- 自动将成功记录标为 `resolved`。

### Phase 3：跳过与恢复

- 采集源“跳过本批次”。
- 打标热点排除/恢复。
- 事件排除/恢复。
- 调整流水线完成条件和状态文案。

### Phase 4：研判细化

- 识别可定位的事件/候选级错误。
- 对安全对象开放单条重试和跳过。
- 批次级错误保持只重试。

## 9. 预计改动范围

| 模块 | 预计改动 |
|---|---:|
| 数据库迁移与 repository | 180–280 行 |
| 采集源定向重试适配 | 220–350 行 |
| 打标、事件卡失败接入 | 220–350 行 |
| API 与权限/并发校验 | 180–280 行 |
| 批次抽屉 UI | 220–320 行 |
| 测试 | 300–500 行 |
| 合计 | 1,320–2,080 行 |

采集“按单个来源重试”需要把当前 collector 的批量 target 执行入口拆出可复用的单 target 入口，因此比只记录来源失败的改动大。若 Phase 1 只展示并允许“重试整个来源组”，可显著缩小首期范围，但不符合本方案最终的来源级精确操作目标。

## 10. 验收标准

- 当前批次每个失败采集源均能独立展示，且关联准确的 `subscription_run/source_run`。
- 重试一个采集源不会重新请求其他成功来源。
- 跳过采集源只影响当前批次，不修改全局订阅配置。
- 打标失败能显示热点标题、URL、失败原因和尝试次数。
- 事件卡失败能显示事件标题及包含的热点数量。
- 单条重试成功后原失败记录自动变为 `resolved`，历史错误仍可查看。
- 跳过后流水线可以继续，并明确显示跳过数量和影响范围。
- 不可安全隔离的批次级错误不出现跳过按钮。
- 工作台重启后失败清单、重试次数和跳过决策仍然存在。
- 所有跳过操作可恢复，且不会删除原始热点、来源执行或模型调用记录。

## 11. 待评审决策

1. 事件卡失败时采用“排除整个事件”还是允许“无事件卡降级研判”。本方案推荐第一期排除整个事件。
2. 跳过原因是否必填。本方案建议采集源可选，热点和事件必填或至少选择预设原因。
3. 已跳过对象是否默认出现在批次详情。本方案建议折叠展示，并长期保留。
4. Phase 1 是否接受先“重试整个来源组”。若不接受，需要第一期即拆分各 collector 的单来源执行入口。
