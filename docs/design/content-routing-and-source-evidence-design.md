# 内容类型、来源证据与文章/图文分流改造方案

状态：设计评审中，尚未实施  
日期：2026-08-25  
关联设计：[四层选题筛选改造方案](./four-layer-topic-selection-refactor-plan.md)、[事件归并与事件热榜设计](./event-resolution-and-hotlist-design.md)

## 1. 背景与目标

当前系统已经能够把热点归并为稳定事件，并分别生成文章候选和图文候选，但内容类型判断仍主要发生在脑暴之后：通过 `format`、`historicalType`、`materialType` 和标题关键词猜测一个候选是否属于项目类内容。

这会产生三个问题：

1. GitHub 项目可能先进入文章研判，再在后面被排除；
2. “介绍一个开源项目”和“分析开源技术趋势”容易被混成同一种内容；
3. 文章写作链目前只要求编辑底稿完整，不要求候选具备适合文章的事实结构，因此纯项目被人工锁定后理论上仍可以生成文章。

本方案的目标是：

- 四类内容统一进入事件热榜和热点全景，作为事实发现层；
- 在事件层确定内容类型和证据边界；
- `github_project` 默认只进入图文路线；
- `open_source_technology`、`open_source_trend`、`news_event` 同时具备文章和图文资格；
- 文章和图文使用各自评分，不把 Social Fit 与文章 F 混排；
- 纯项目只有在人工重新归类并补齐文章事实后，才允许进入文章流水线。

## 2. 核心概念：内容类型不等于生产池

四类是事件的 `content_class`，不是四个完全独立的生产池。

| 内容类型 | 文章资格 | 图文资格 | 默认路线 | 典型事实 |
|---|---:|---:|---|---|
| `github_project` | 否 | 是 | 图文 | 仓库、README、Release、安装方式、功能和限制 |
| `open_source_technology` | 是 | 是 | 由包装决定 | 原理、架构、技术路线、性能、成本、工程边界 |
| `open_source_trend` | 是 | 是 | 由包装决定 | 多项目、多主体、采用、竞争、政策、时间线和生态变化 |
| `news_event` | 是 | 是 | 由包装决定 | 公司、产品、行业、职场或开发者利益相关事件事实 |

资格字段与类型字段分开保存：

```json
{
  "contentClass": "github_project",
  "articleEligible": false,
  "socialEligible": true,
  "defaultRoute": "social_cards",
  "classificationConfidence": 0.96
}
```

其他三类通常为：

```json
{
  "articleEligible": true,
  "socialEligible": true,
  "defaultRoute": "editorial_review"
}
```

“双资格”不代表系统自动生产两份内容。编辑或包装决策选择最终路线；必要时可以让同一事件分别进入文章和事件图文，但必须是显式的双轨选择。

## 3. 事件层与来源层的关系

来源先产生来源级事实，稳定事件再产生事件级分类。不能简单地把“来源是 GitHub”直接等同于“事件是纯项目”。

例如：

```text
GitHub 仓库 + README
→ 来源级项目资料
→ github_project

GitHub 仓库 + 架构文档 + 基准测试/论文
→ 来源级技术资料
→ open_source_technology

多个仓库 + 多家组织采用 + 媒体/公告/政策材料
→ 事件级生态变化
→ open_source_trend
```

因此建议保存两个层次的字段：

```text
source_class：单条来源是什么
content_class：稳定事件最终属于什么内容类型
```

来源级 `source_class` 示例：

- `github_repository`
- `official_docs`
- `release_note`
- `technical_paper`
- `benchmark`
- `company_announcement`
- `media_report`
- `community_discussion`
- `policy_or_standard`

事件级 `content_class` 应该在现有的“稳定事件 → 事件卡”生成流程中确定一次，后续文章池和图文池都消费这个结果。这里不是在事件卡生成完之后再启动一条独立的全量分类链路。

## 4. 分类判断规则

### 4.1 第一步：识别纯项目

以下条件同时构成强项目信号，但单独出现时只作为候选信号，不直接把事件升级为文章类型：

- 来源为 GitHub 仓库或仓库元数据；
- 标题或事件对象是某个具体项目；
- 主要资料是 README、安装命令、功能清单、Release 或 Star 数据；
- 只有一个项目主体，没有外部采用、竞争、政策或行业影响；
- 事实主要回答“它是什么、怎么装、怎么用”，不能回答“为什么重要、改变了什么”。

满足这些特征且没有更高层证据时，归为 `github_project`。

单个项目的 Star 数、Trending 排名或“爆火”表述不能单独把它升级为趋势。

### 4.2 第二步：识别开源技术

`open_source_technology` 需要存在技术机制证据。建议至少满足以下条件：

- 至少一份官方项目资料；
- 至少一份技术机制资料，来源可以是官方文档、架构说明、论文、基准测试或可信第三方技术分析；
- 事件事实能够支撑以下至少两项：原理、架构、性能、成本、兼容性、工程边界、适用场景。

输出的证据角色应类似：

```json
[
  {"sourceId":"repo-1","role":"official_project"},
  {"sourceId":"docs-1","role":"technical_mechanism"},
  {"sourceId":"bench-1","role":"performance_evidence"}
]
```

只有 README 中的功能介绍，不足以归类为 `open_source_technology`。

### 4.3 第三步：识别开源趋势

`open_source_trend` 必须证明它是生态或行业变化，而不是单个项目介绍。建议至少具备以下两类证据中的一类：

- 两个及以上独立来源，且不是同一稿件的转载；
- 两个及以上项目、公司、组织或社区主体；
- 明确的采用、迁移、兼容、竞争、治理、标准或政策变化；
- 跨时间的连续变化或事件时间线；
- 能解释受影响的开发者、团队、厂商或生态参与者。

趋势证据应保存来源角色，例如：

```json
[
  {"sourceId":"repo-a","role":"project_signal"},
  {"sourceId":"repo-b","role":"project_signal"},
  {"sourceId":"company-1","role":"adoption_signal"},
  {"sourceId":"media-1","role":"ecosystem_analysis"}
]
```

### 4.4 兜底分类

无法确认技术机制或趋势证据时，不让模型自由升级类型，回退为：

- 具体单项目：`github_project`；
- 非项目型新闻：`news_event`；
- 证据不足但编辑认为值得继续观察：保留 `classification_status: "needs_review"`，不自动进入文章池。

## 5. 分类执行方式

分类采用“确定性特征 + 模型归纳 + 证据回填 + 人工覆盖”四步法。

### 5.0 接入现有事件卡生成流程

分类结果挂在现有事件卡生成流程上，推荐的主链路如下：

```text
热点来源
  ↓
稳定事件归并
  ↓
提取来源级分类特征和证据摘要
  ↓
现有事件卡生成调用
  ├─ 生成事件事实卡
  └─ 同时生成 content_class 分类结果
  ↓
服务端规范化、证据校验和必要降级
  ↓
保存事件卡、事件热榜/全景和候选路线快照
```

具体改造点：

1. 稳定事件归并完成后，在进入事件卡生成前提取分类提示，不另起一套来源抓取。提示至少包括：
   - `hasGithubRepository`、`repositoryCount`、`projectCount`；
   - `independentSourceCount`、`subjectCount`、`hasTimeline`；
   - `hasTechnicalDocs`、`hasPaper`、`hasBenchmark`、`hasRelease`；
   - `hasAdoptionSignal`、`hasMigrationSignal`、`hasCompatibilitySignal`、`hasPolicyOrStandardSignal`；
   - 来源的 `sourceId`、`source_class`、状态和可引用事实摘要。
2. 扩展现有事件卡的结构化输出，让同一次模型调用同时返回事实卡和分类结果。分类只允许引用本次输入中的 `sourceId`，不能凭标题或常识补造证据。
3. 事件卡写入前由服务端做确定性校验：趋势证据不足时降为 `needs_review`，技术机制证据不足时降为 `github_project` 或 `needs_review`，项目类不得自动获得文章资格。
4. 校验后的分类结果和事件事实卡一起持久化，再由文章池、图文池和热点全景分别消费。候选生成时保存路线快照，避免事件后续重新分类影响已经锁定的候选。

当前代码对应的实施位置是：

- 稳定事件卡生成：`server/features/research/application/research/event-card-stage.mjs`；
- 分类规则与服务端校验：`server/features/research/domain/content-routing.mjs`；
- 候选池消费和路线快照：`server/features/research/application/research-pipeline.mjs`。

对明确的纯项目事件，可以由确定性特征直接得到高置信度的 `github_project`，避免额外分类调用；但它仍应生成项目事实卡并进入事件热榜/热点全景。对技术与趋势这类需要组合语义的事件，使用同一次事件卡调用完成归纳，避免事件卡生成后再次重复阅读来源。

历史事件卡不强制全部重生成。回填顺序为：先用确定性特征补齐明确项目类；只有分类不明确的事件才调用一次分类补全；已有人工分类保留并写入审计记录。

### 5.1 确定性特征提取

从热点和来源中提取：

- 来源类型、URL 域名和来源数量；
- 独立来源数量；
- 项目、公司、组织和技术名数量；
- 是否存在技术文档、论文、Release、基准测试；
- 是否存在采用、迁移、兼容、政策、标准、竞争等关系；
- 是否存在跨时间报道。

### 5.2 模型只负责语义归纳

模型输出必须包含：

```json
{
  "contentClass": "github_project|open_source_technology|open_source_trend|news_event|needs_review",
  "confidence": 0.0,
  "reason": "一句话说明分类依据",
  "evidence": [
    {"sourceId":"...","role":"...","claim":"..."}
  ],
  "articleEligibilityReason": "...",
  "missingEvidence": ["..."],
  "counterInterpretation": "..."
}
```

模型不得只返回“这是一个开源趋势”，必须引用输入中存在的 `sourceId` 和事实片段。

### 5.3 确定性校验

服务端校验模型结论：

- `open_source_trend` 没有足够独立来源或主体时降级为 `needs_review`；
- `open_source_technology` 没有技术机制证据时降级为 `github_project` 或 `needs_review`；
- `github_project` 不得自动获得 `articleEligible: true`；
- 证据来源不存在、来源状态不是 `ok` 或 claim 为空时，拒绝写入分类证据。

### 5.4 人工覆盖

编辑可以把项目转换为技术或趋势事件，但必须填写：

- 转换后的类型；
- 文章角度；
- 至少一项新增文章证据；
- 为什么不再只是项目介绍。

人工覆盖写入审计记录，不直接修改原始来源分类。

## 6. 事件热榜与热点全景

四类内容都可以进入事件热榜和热点全景，但必须显示内容类型和默认路线。

建议在事件节点和事件卡上显示：

```text
[项目图文] github_project
[技术文章/图文] open_source_technology
[趋势文章/图文] open_source_trend
[事件文章/图文] news_event
```

事件热榜可以统一展示四类，但排序时不直接把 GitHub 的 Star、Trending 分数和新闻事件 T 当作同一个原始量纲。建议保存：

- `eventValue`：文章事件使用的事件价值 T；
- `projectDiscoveryScore`：GitHub 项目的发现分；
- `socialFitScore`：图文路线评分；
- `contentClass`：展示和分流依据。

全景默认可以统一浏览，也可以提供“全部 / 文章资格 / 项目图文 / 技术 / 趋势”筛选。

## 7. 文章与图文路线

### 7.1 文章路线

文章候选必须满足：

```text
articleEligible === true
且 editorialReadiness 通过
且 factBase 中有足够 verified 事实
且命题不是纯项目介绍
```

文章事实基座至少区分：

- `verified`：来源可核验事实；
- `inference`：基于多项事实的推断；
- `opinion`：作者判断；
- `unverified`：待补证据内容。

纯项目只有在人工转换为 `open_source_technology` 或 `open_source_trend` 后，才进入文章事实基座和 H/B/P/T/F 评分。

### 7.2 图文路线

图文路线继续使用 Social Fit 或事件图文评分：

- 项目清晰度；
- 场景价值；
- 可演示性；
- 视觉拆页潜力；
- 收藏/搜索价值；
- 来源完整度；
- 事实缺口和权限风险。

`github_project` 默认走该路线，不需要生成文章事实基座，也不应被文章 F 低分拦截。

### 7.3 双资格事件

`open_source_technology`、`open_source_trend`、`news_event` 可以同时拥有文章和图文资格，但两个评分独立：

```text
文章路线：H/B/P/T/F
图文路线：Social Fit 或事件图文评分
```

不把两个分数合并成一个总分，也不因为 Social Fit 高就自动生成文章。

## 8. 评分体系变化

文章评分公式不变：

```text
A = H×h + B×b + P×p
F = A×70% + T×30% - S - D
```

变化在于评分前增加内容资格门禁：

| 类型 | 是否计算文章 F | 是否计算 Social Fit |
|---|---:|---:|
| `github_project` | 否 | 是 |
| `open_source_technology` | 是 | 是 |
| `open_source_trend` | 是 | 是 |
| `news_event` | 是 | 是 |

以下旧逻辑在来源分流完成后应删除或降为兼容：

- 文章池中的 `minimumToolCandidates`；
- 文章评分中的 `toolEngineeringBonus`；
- 用 `hBase.github_tool` 给纯项目补 H 分；
- 用 `format === "贴图"` 作为主路由；
- 用标题关键词临时猜测 GitHub 项目；
- 从全量文章事件中再次扫描 GitHub URL 的图文分流逻辑。

`format` 可以保留为包装建议，`materialType` 和 `historicalType` 可以保留为模型分析审计字段，但它们不再是内容路线的唯一事实来源。

## 9. 数据与接口改造

### 9.1 稳定事件字段

在稳定事件或事件卡上增加：

```text
content_class
content_class_confidence
content_class_reason
classification_evidence_json
article_eligible
social_eligible
default_route
classification_status
```

### 9.2 候选字段

候选继续保存最终路线快照，防止后续分类变化影响已锁定文章：

```text
content_route
article_eligible
social_eligible
score_status
score_warning
```

### 9.3 API

建议新增或扩展：

- `GET /api/batches/:id/hotspot-atlas?contentClass=...`：全景按类型筛选；
- `GET /api/batches/:id/project-candidates`：项目图文候选；
- `POST /api/events/:id/promote-to-article`：人工将项目升级为技术或趋势事件；
- `POST /api/events/:id/classification-review`：保存分类人工校正和证据。

## 10. 分阶段实施

### Phase 1：只读分类与双轨展示

- 在现有稳定事件卡生成流程中生成四类分类结果，不新增独立的全量分类阶段；
- 为事件卡补充来源级分类特征、分类证据和 `classification_status`；
- 不改变现有生产池，只在热点全景展示标签；
- 输出分类证据和缺失证据报告；
- 统计 GitHub 项目误入文章池的数量。

### Phase 2：文章资格前置

- `github_project` 不再进入文章脑暴和文章预选；
- 项目继续进入独立图文预选；
- 其他三类保留文章和图文双资格；
- 旧的文章池纯项目排除逻辑保留为兜底。

### Phase 3：文章事实门禁

- 文章候选要求至少若干条 `verified` 事实；
- 技术文章要求存在技术机制证据；
- 趋势文章要求存在多主体/多来源或时间线证据；
- 纯项目文章路线必须人工晋级。

### Phase 4：删除冗余与历史迁移

- 删除工具席位和工具工程加分；
- 删除 GitHub URL 的二次猜测分流；
- 将旧候选的 `format/materialType/historicalType` 转为审计字段；
- 对已锁定候选保留历史路线快照，不强制重分类。

## 11. 验收标准

1. 只有 README 和仓库元数据的项目分类为 `github_project`，不进入文章池。
2. 单项目有架构文档、技术原理和基准测试时，可以分类为 `open_source_technology`。
3. 多项目、多主体并存在采用或生态变化证据时，可以分类为 `open_source_trend`。
4. 四类都能在热点全景中查看，并显示内容类型和默认路线。
5. 其他三类可以分别进入文章池或图文池，不因一个路线的分数影响另一条路线。
6. `github_project` 手动尝试成稿时，服务端明确提示需要先人工晋级，而不是静默生成低质量文章。
7. 文章事实基座至少存在可追溯的 `verified` 事实，不能只靠编辑底稿里的空泛描述通过。
8. 文章评分仍使用 H/B/P/T/F，图文评分仍使用 Social Fit/事件图文评分，两者不混排。

## 12. 评审结论待确认项

- 趋势分类的最低独立来源数是否固定为 2，还是允许一个官方数据源加一个权威分析源；
- 技术分类是否要求基准测试，还是架构/机制文档即可；
- `github_project` 是否允许编辑直接申请文章路线，还是必须先转换为技术/趋势类型；
- 双资格事件是否默认只选一条路线，还是允许文章和图文同时进入候选池；
- 文章事实基座最低 `verified` 事实数量和独立来源数量。
