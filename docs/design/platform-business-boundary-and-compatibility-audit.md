# Platform 业务边界与兼容逻辑审计记录

> 审计日期：2026-08-24
> 状态：已完成盘点，待下一轮实施
> 目的：记录当前垂直架构调整后的残留边界问题，避免夜间继续进行高风险迁移。

## 一、当前结论

`platform/llm` 中的旧业务转发层已经删除，目前只保留通用 LLM 基础设施：

- `context-manager.mjs`
- `context-safety.mjs`
- `gateway.mjs`
- `model-json.mjs`
- `output-budget.mjs`
- `selection-prompts.mjs`
- `skill-runtime.mjs`
- `web-search.mjs`

但整个 `platform` 尚未完全收敛为纯基础设施层。`platform/jobs`、`platform/agent`、`platform/application` 和部分 `platform/integrations` 仍包含业务编排或业务适配代码。

## 二、兼容与新旧并行逻辑

### 2.1 有意保留的兼容逻辑

以下代码目前仍有明确用途，不应在没有迁移窗口和数据验证前直接删除：

- 旧配置迁移与旧配置 fallback：
  - `server/platform/extensions/legacy-configuration-migrator.mjs`
  - `server/platform/extensions/legacy-tool-configuration.mjs`
  - `server/platform/extensions/legacy-collector-configuration.mjs`
  - `server/platform/extensions/model-provider-configuration.mjs`
- 旧凭据环境变量读取：`server/platform/tools/remote-credentials.mjs`
- 旧主题结构兼容视图与默认回退：`server/shared/themes/article-theme-compiler.mjs`、`server/shared/themes/theme-validator.mjs`
- 新事件解析向旧事件聚类结构投影：`server/features/research/domain/event-resolution-cluster-projection.mjs`

### 2.2 需要后续收口的新旧并行逻辑

1. 选题评分双跑

   `server/features/research/application/research-pipeline.mjs` 同时计算当前 `F` 和旧 `legacyF`，并通过 `buildScoreDualRun()` 生成审计结果。当前旧公式只用于回放和运营校准，但仍保留完整实现。

2. 事件解析双流程

   研究管线同时执行旧 `clusterItems()` 和新 `resolveEventShadow()`，再通过 `projectStableEvents()` 兼容旧结构；新流程异常时还会回退到旧聚类结果。

3. Agent 配置双来源

   `editorial-adapter.mjs`、`tutorial-adapter.mjs`、`custom-social-adapter.mjs` 以 config 为主，同时保留 `FALLBACK_ADAPTATION` 内联声明。该机制用于嵌入式或测试工作区，但存在配置与代码重复维护风险。

## 三、platform 中仍存在的业务代码

### 3.1 业务 Job 编排

以下文件不只是队列基础设施，而是直接编排具体业务流程：

- `server/platform/jobs/ai-job-handlers.mjs`
- `server/platform/jobs/auto-pipeline.mjs`
- `server/platform/jobs/job-manager.mjs`
- `server/platform/jobs/pipeline-failure-retry.mjs`
- `server/platform/jobs/research-failure.mjs`

具体表现包括：枚举文章/研究/图文任务类型、执行打标和事件卡、运行研究管线、执行 GitHub 仓库发现、采集质量过滤以及业务阶段重试。

### 3.2 业务 Agent 适配器

以下文件是具体业务 Agent，不是通用 Agent runtime：

- `server/platform/agent/editorial-adapter.mjs`
- `server/platform/agent/tutorial-adapter.mjs`
- `server/platform/agent/custom-social-adapter.mjs`

### 3.3 其他业务特性文件

- `server/platform/application/candidate-selection-service.mjs`：候选池与选题业务。
- `server/platform/integrations/subscriptions.mjs`：订阅源管理，属于 collection 业务边界。
- `server/platform/llm/selection-prompts.mjs`：虽然实现是技能加载器，但目前只服务研究/选题流程，边界上更适合放入 research application。

HTTP 路由文件可以继续留在 platform 作为传输适配层，但 `candidate-routes.mjs`、`batch-routes.mjs`、`social-card-routes.mjs` 等存在偏胖问题，后续应逐步只保留参数解析、鉴权和响应映射。

## 四、目录文档不一致

当前 README 与实际代码存在以下不一致：

- `server/platform/jobs/README.md` 声称只负责作业基础设施，但目录内有大量业务编排。
- `server/platform/agent/README.md` 声称不包含业务规则，但目录内有三类业务 Agent 适配器。
- `server/platform/integrations/README.md` 声称不依赖业务 feature，但 `subscriptions.mjs` 已依赖 `features/collection`。

## 五、明日实施顺序

1. 先迁移 `platform/jobs` 中的业务 handler：保留通用队列、并发、锁和任务状态能力，业务执行器移入对应 feature 的 `application/jobs`。
2. 将三个业务 Agent adapter 分别迁入 articles 和 social-cards 垂直目录，`platform/agent` 只保留会话、协议、工具执行和资源适配基础设施。
3. 将 `CandidateSelectionService` 迁入 research/batches 相关 application；将 `subscriptions.mjs` 迁入 collection application。
4. 评估 `selection-prompts.mjs` 是否与 research application 合并。
5. 为事件解析双流程和选题评分双跑设定下线条件；完成数据回放后再删除旧算法，而不是现在直接删除。
6. 收口后更新 README、架构扫描规则和相关测试。

## 六、验证记录

本轮为只读审计，未修改业务逻辑。此前完成的架构迁移验证结果：

```text
全量测试：1336 passed / 0 failed
定向架构测试：142 passed / 0 failed
```

## 七、明日新旧逻辑收敛方案

### 7.1 总体原则

明天不做“一次性删除所有 legacy 代码”，而是按以下顺序收敛：

1. 先确认新逻辑已经成为唯一生产决策来源。
2. 将旧逻辑降级为只读迁移工具或历史数据读取器。
3. 连续验证通过后，删除运行时 fallback、双跑计算和旧结果投影。
4. 最后删除只剩迁移用途的代码、测试和文档，并更新架构守卫。

兼容代码必须满足以下任一条件才可保留：

- 仍需读取已有用户数据或旧数据库结构；
- 仍需执行一次性迁移；
- 仍需支持明确声明的外部扩展版本。

仅仅因为“以后可能需要回退”而保留的运行时双轨逻辑，原则上删除。

### 7.2 选题评分双跑收敛

涉及文件：`server/features/research/application/research-pipeline.mjs`、`topic-score-operations.mjs`。

实施步骤：

1. 确认生产排序、入池和成稿线只读取当前 `F`、`scoreCards()` 和当前 `topicValue`。
2. 将 `legacyF`、`legacyRank`、`legacyDraftable` 和 `buildScoreDualRun()` 限制到显式的离线回放脚本，不再由日常研究管线自动生成。
3. 保留一份固定历史批次快照，离线执行新旧公式对比，记录排名变化和入池变化。
4. 对比结果满足“无未解释的生产回归”后，从生产管线删除双跑调用和旧字段输出。
5. 后续仅保留迁移报告中必要的历史统计字段，不再在候选对象中携带 `legacyF` 等运行时字段。

完成标准：

- `research-pipeline.mjs` 不再输出 `legacyF`、`legacyRank`、`legacyDraftable`；
- 生产 API 和产物中不再生成新旧公式双跑报告；
- 选题排序相关测试只验证当前公式；
- 离线回放脚本仍可在需要时读取历史快照，但不参与生产启动路径。

### 7.3 事件解析 Shadow 流程收敛

涉及文件：`event-resolution-shadow.mjs`、`event-resolution-cluster-projection.mjs`、`hotspot-clustering.mjs`、`research-pipeline.mjs`。

实施步骤：

1. 先让新 `resolveEventShadow()` 结果直接成为研究和事件卡生产的唯一输入。
2. 保留旧 `clusterItems()` 仅用于一次性历史数据回放和迁移脚本，不在每次生产批次中重复执行。
3. 将旧结构投影 `projectStableEvents()` 改为一次性产物迁移工具；新业务调用直接消费稳定事件结构。
4. 删除“新流程异常时回退旧聚类”的运行时分支，改为明确失败并记录阶段错误，避免新逻辑故障时悄悄切换算法。
5. 完成历史批次回放和事件卡重建验证后，删除 `legacyClusters`、`legacy_event_ids` 等仅用于兼容的运行时字段。

完成标准：

- 生产研究流程每批只执行一次事件解析；
- 不再同时生成 legacy cluster 和 stable event 两套结果；
- 新事件解析失败时进入标准失败重试，不再回退旧算法；
- HTTP API 和前端仍需要的字段由稳定事件模型直接提供，而不是运行时投影。

### 7.4 统一配置与旧配置 fallback 收口

涉及文件：`server/platform/extensions/*legacy*`、`configuration-service.mjs`、`remote-credentials.mjs`、迁移脚本。

实施步骤：

1. 统计所有资源的 `legacy_fallback` 状态和旧环境变量命中情况。
2. 对仍在使用旧配置的资源执行一次显式迁移，并把迁移结果写入统一配置仓库。
3. 增加启动门禁：迁移完成后禁止新运行继续读取旧配置，只允许迁移命令读取。
4. 保留 `scripts/migration/migrate-legacy-configuration.mjs` 作为一次性运维脚本，但从正常运行入口移除 `legacyToolConfiguration()`、`legacyCollectorConfiguration()` 等 fallback 调用。
5. 对旧凭据变量只做一次迁移读取；迁移完成后删除运行时对旧变量名的读取分支。

完成标准：

- 所有内置资源 `source` 均为 `unified` 或 `defaults`；
- 运行时不再返回 `legacy_fallback`；
- 旧配置迁移脚本仍可重复执行且幂等，但不再被业务请求调用；
- 旧环境变量仅在迁移脚本中出现。

### 7.5 Agent 内联 fallback 收口

涉及文件：`editorial-adapter.mjs`、`tutorial-adapter.mjs`、`custom-social-adapter.mjs`。

实施步骤：

1. 确认三个内置 Agent 的 adaptation 配置已经完整登记在 `config/capability-consumers.json`。
2. 测试工作区不再使用缺失配置作为正常运行场景；缺失配置直接返回配置错误。
3. 删除三个 adapter 内的 `FALLBACK_ADAPTATION`，避免 config 与代码各维护一份业务声明。
4. 保留配置 Schema 校验和清晰的错误提示，不再静默回退到内联声明。

完成标准：

- Agent adaptation 只有一个事实来源：配置文件；
- 删除所有 `FALLBACK_ADAPTATION`；
- 配置缺失测试改为断言明确失败，而不是断言内联回退成功。

### 7.6 主题和历史数据兼容逻辑处理

主题旧结构、旧数据库列和历史产物兼容逻辑暂不直接删除，因为它们仍承担数据读取和升级职责。明天只做边界收敛：

- 将历史结构转换集中到 import/migration 层；
- 生产渲染器只接受当前主题 Schema；
- 旧主题只允许“复制后升级”，不再在生产渲染路径中保留多套解释器；
- 为每类兼容字段增加移除版本和迁移完成指标。

### 7.7 最终删除清单

满足上述完成标准后再删除：

- 生产评分双跑字段和报告生成逻辑；
- 事件 Shadow 运行时的 legacy cluster 输入与 fallback 分支；
- 配置服务的 `legacy_fallback` 运行时分支；
- Agent adapter 内联 adaptation fallback；
- 仅服务旧路径的投影函数和兼容 DTO；
- 对应的过期测试、架构白名单和历史说明。

### 7.8 明天的执行顺序与风险控制

建议顺序：

1. 先收口 Agent 配置 fallback，改动面最小。
2. 再收口评分双跑，使用历史快照验证排序不变。
3. 再收口事件解析 Shadow，先切换读路径，再删除旧投影。
4. 最后处理统一配置和旧环境变量，因为涉及用户现有配置和升级数据。
5. 每一步单独运行定向测试，再运行全量测试；任一步失败都保留上一阶段的迁移工具，不回退已确认的新业务入口。

最终目标：生产路径每个业务决策只有一套实现，兼容代码只存在于明确的一次性迁移边界内。

## 八、明日两项大工作的总顺序

明天的工作分为两项，但按先后顺序执行，不建议同时大范围修改：

### 第一项：业务特性聚合与 platform 边界收口

先处理代码归属：

1. 将 `platform/jobs` 中的业务 handler 和 pipeline 编排迁入对应 feature application。
2. 将文章、教程、自定义图文三个 Agent adapter 迁入对应业务垂直。
3. 将候选选择服务归入 research/batches，将订阅管理归入 collection。
4. 将只服务研究选题的 `selection-prompts.mjs` 移出 `platform/llm`。
5. 保留 platform 中的通用队列、Agent runtime、HTTP 传输适配和外部系统适配能力。
6. 更新 README、导入路径和架构守卫，确保每个业务实现先有唯一归属。

这一步必须先做，因为新旧逻辑收敛需要明确“哪一个 feature 是唯一负责人”。如果归属尚未稳定就删除旧逻辑，容易出现重复实现、错误 fallback 或无法判断调用方的问题。

### 第二项：新旧逻辑收敛与废弃代码删除

在第一项完成并通过定向测试后，再按以下顺序收敛：

1. 删除 Agent adapter 的内联 adaptation fallback。
2. 删除选题评分生产路径中的 `legacyF` 和双跑报告，只保留离线回放工具。
3. 将事件解析切换为稳定事件唯一生产路径，删除旧聚类的运行时 fallback 和投影依赖。
4. 最后处理统一配置、旧环境变量和历史主题/数据库兼容逻辑；这些需要先完成迁移统计和数据验证。
5. 清理对应测试、架构白名单和过期文档，运行全量回归。

### 明天的验收节点

- 节点 A：业务特性都有唯一 feature 归属，platform 不再承载对应业务实现。
- 节点 B：生产路径不再有新旧业务决策并行，旧逻辑仅保留在明确的一次性迁移或离线回放边界。
- 节点 C：架构测试、定向测试和全量测试全部通过。

## 九、第一项实施记录：业务特性聚合与 platform 边界收口

2026-08-24 已完成第一项，第二项新旧逻辑收敛仍未开始。

已完成的归属调整：

- `features/batches/application/` 接管 AI job handler、auto pipeline、失败重试与失败决策。
- `features/collection/application/` 接管采集 Job 与订阅管理。
- `features/research/application/` 接管候选选择与研究失败分类；`features/research/llm/` 接管选题 prompt loader。
- `features/articles/application/agent/` 接管编辑室、自主写作 Agent；`features/social-cards/application/agent/` 接管自定义图文 Agent。
- `platform/jobs/ai-job-manager.mjs` 收敛为通用队列、并发、互斥和状态运行时，通过构造参数注入业务 handler。
- `platform/core/store.mjs` 通过 `platform/application/store-services.mjs` 做应用装配，不直接导入业务 feature。

已同步路由、server 装配、能力基线、README 与架构守卫；platform/llm 已移除选题 prompt loader，platform/jobs、platform/agent、platform/integrations 不再保留上述业务实现。

验收结果：定向边界与迁移测试通过；第一项完成时全量回归为 `1336 passed / 0 failed`。第二项实施记录见下一节。

## 十、第二项实施记录：新旧逻辑收敛与废弃代码删除

2026-08-24 已完成第二项，生产业务决策已收敛到当前实现；兼容逻辑仅保留在明确的迁移、历史读取或离线回放边界。

- Agent adaptation 统一从 `config/capability-consumers.json` 读取。三个业务 adapter 删除 `FALLBACK_ADAPTATION`，配置缺失时直接失败，不再静默使用代码内声明。
- 选题评分生产路径删除 `legacyF`、差异字段和双跑报告生成；历史快照回放集中到 `scripts/migration/replay-topic-score.mjs`，供离线审计使用。
- 研究生产路径以稳定事件解析结果为唯一输入，不再向 Shadow 解析器注入 legacy cluster，也不在解析失败时回退旧聚类；旧投影保留为显式兼容包装和迁移边界。
- 运行时配置删除旧环境变量、远程凭据和 `legacy_fallback` 分支；旧配置迁移脚本与历史数据读取职责继续保留。
- 主题、历史数据读取和升级逻辑未在本项中删除，仍按 7.6 的迁移边界处理。

验收结果：Agent、评分、事件解析和统一配置定向测试通过；全量回归 `1336 passed / 0 failed`。
