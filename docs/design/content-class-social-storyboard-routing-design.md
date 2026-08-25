# 按内容分类分流 Social 图文故事板技术方案

## 1. 目标与结论

本文解决一个具体问题：自动图文预选目前只保存“进入图文池”，生成阶段再把候选统一当作工具图文或事件图文，导致 `news_event`、`open_source_technology`、`open_source_trend` 和 `github_project` 的故事结构混用。

目标是让内容分类从自动预选开始贯穿到图文交付：

```text
稳定事件分类
  → 统一 G_social 图文创作分
  → 分类专属 output_mode
  → 分类专属事实基座
  → 分类专属故事板技能
  → 共享模板渲染与布局门禁
```

最终分流：

| `content_class` | Social 内容类型 | 故事板 | 默认图文方向 |
|---|---|---|---|
| `news_event` | `event` | `event-card-storyboard` | 发生了什么 → 关键变化 → 争议/影响 → 后续观察 |
| `open_source_technology` | `event`（事件子类） | `open-source-technology-storyboard` | 问题 → 机制/架构 → 证据 → 边界/影响 |
| `open_source_trend` | `event`（事件子类） | `open-source-trend-storyboard` | 趋势判断 → 主体与信号 → 时间变化 → 生态对比/不确定性 |
| `github_project` | `repository` | `repository-card-storyboard` | 痛点 → 能力 → 上手 → 场景与限制 |

`news_event`、`open_source_technology`、`open_source_trend` 可以同时拥有文章和图文资格，但两条路线分别评分、分别落池；`github_project` 仍默认只进入工具图文路线。

## 2. 当前问题

### 2.1 自动预选把所有内容都落成工具图文

当前研究管线调用 `selectSocialCandidates()` 生成自动图文预选，随后 `saveSocialPreselection()` 固定写入：

```text
pool_role = AI 图文预选
output_mode = wechat-tool-cards
```

因此，即使候选的事件卡已经判断为普通事件、开源技术或开源趋势，后续仍会进入仓库/工具图文入口。

### 2.2 单一事件故事板不能覆盖三种语义

`news_event` 使用 `event-card-storyboard`；开源技术和开源趋势仍属于事件图文入口，但分别使用专属故事板。

- 对 `news_event` 合适。
- 对 `open_source_technology` 只能做“某次发布/变化”的事件快照，无法稳定承载机制、架构、基准和技术边界。
- 对 `open_source_trend` 缺少多主体、跨来源、跨时间和生态对比的专门结构。
- 对 `github_project` 则会丢失工具介绍所需的痛点、能力、上手和限制结构。

### 2.3 日常事件图文事实合成存在信息损失

日常候选通过事件卡合成图文事实基座时，目前主要保留确认事实、未核实主张和来源状态；`timeline`、`source_increment`、分类证据以及技术/趋势专属证据没有形成稳定的类型化事实结构。

如果只切换故事板名称而不补齐事实基座，模型仍然没有足够输入，最终只能生成泛化文案。

## 3. 总体设计

### 3.1 分类是唯一分流依据

所有 Social 路由只读取稳定事件分类快照，不再根据标题、`format`、`materialType` 或 URL 在生成阶段猜测类型。

分类优先级：

1. 候选锁定时保存的 `content_class` 快照；
2. 候选关联事件卡中的分类；
3. 稳定事件记录中的分类；
4. 无法确定时阻断自动图文预选，并提示先完成事件卡分类。

已经锁定、正在生成或已经产出图文的候选不因后续重新分类而静默改路由。

### 3.2 用逻辑内容类型隔离故事板，渲染层继续共享

顶层逻辑内容类型保持为三个：

```text
repository  ← github_project
event       ← news_event
event       ← news_event / open_source_technology / open_source_trend
custom      ← 自定义图文
```

顶层内容类型负责选择事实基座、入口和公共门禁；事件子类负责选择事件故事板、类型证据门禁和文案参考。模板、页面角色、组件装箱、确定性重排、浏览器布局审计和截图交付继续复用现有 Social 基础设施。

这样不会为四类内容复制四套 HTML 渲染器，也不会让模板承担内容语义判断。

## 4. 阶段一：自动图文预选按分类设置输出模式

### 4.1 统一映射函数

新增纯函数，例如：

```js
socialRouteForContentClass(contentClass, channel = 'wechat')
```

返回统一路由对象：

```json
{
  "contentClass": "open_source_technology",
  "contentType": "event",
  "storyboardClass": "technology",
  "outputMode": "wechat-event-cards",
  "storyboardSkill": "open-source-technology-storyboard",
  "poolRole": "AI 开源技术图文预选"
}
```

建议的 `output_mode`：

| 内容类型 | 公众号 | 小红书 |
|---|---|---|
| `repository` | `wechat-tool-cards` | `xiaohongshu-tool-cards` |
| `event` | `wechat-event-cards` | `xiaohongshu-event-cards` |
| `event`（含技术/趋势子类） | `wechat-event-cards` | `xiaohongshu-event-cards` |

历史 `technology-cards` / `trend-cards` 仅作为读取兼容，不再生成新的独立输出模式。

自动预选当前默认渠道仍为公众号，但映射函数不能把渠道和内容类型写死在调用方。

### 4.2 统一 G_social 图文创作分

图文候选不再使用只偏向工具项目的单一 Social Fit 评分，而是像文章池的 `F` 一样，生成一个统一的 `G_social`（0–100）。统一的是量纲、资格线和入池规则；四类内容在分项证据上使用不同配置。

```text
G_social = 事实支撑 × 25%
          + 图文表现力 × 20%
          + 读者价值 × 20%
          + 内容清晰度 × 20%
          + 生产就绪度 × 15%
          - 风险/缺口扣分
```

所有分项先归一化到 0–100，最终分数限制在 0–100。服务端保存完整的 `socialScoreDetails`，不能只保存最终分。

四类内容的分项判定：

| 类型 | 事实支撑 | 图文表现力 | 读者价值/清晰度 | 生产就绪度 |
|---|---|---|---|---|
| `repository` | 仓库、文档、能力和限制有来源 | 可演示、步骤清晰、页面可视化 | 使用场景和目标用户明确 | README、上手入口、资料完整 |
| `event` | 独立来源、确认事实和事实边界 | 时间变化、冲突、回应和后续节点 | 事件对读者的具体影响清楚 | 事实卡、来源审计和故事结构完整 |
| `event` · 技术子类 | 机制、架构、基准或论文证据 | 架构图、机制拆解、对比和数据承载 | 技术决策价值和适用边界清楚 | 技术事实字段和引用已绑定 |
| `event` · 趋势子类 | 多主体、多来源、跨时间信号 | 时间线、主体关系、生态对比和数据承载 | 趋势对行业/开发者的意义清楚 | 趋势证据、观察窗口和不确定性完整 |

不得把文章事件价值 `T` 直接塞进 `G_social`。新闻的时效可以作为 `event` 的一个证据项，不能作为技术和趋势的通用核心指标。

### 4.3 图文资格门禁与榜单选择

分数之外先执行类型资格门禁：

| 类型 | 自动图文最低证据 |
|---|---|
| `repository` | 能力、场景、上手入口和限制至少有可核验资料 |
| `event` | 确认事实、来源审计和事实边界齐备 |
| `technology` | 至少一条机制/架构证据；没有基准时不得生成性能对比页 |
| `trend` | 至少两个主体或独立来源，并有跨时间/生态变化信号 |

建议门槛：

- `G_social < 55`：不进入自动图文池，可保留为候补并展示缺口；
- `55 ≤ G_social < 70`：进入图文候选池，但不自动开始生成；
- `G_social ≥ 70` 且通过类型门禁：进入自动图文池；
- 未通过类型门禁：不得因为分数高而入池，必须补齐事实或降级分类。

自动选择不再简单地“全局排序取前 10 个工具”。改为：

1. 全量候选按统一 `G_social` 计算总榜；
2. 同时生成四类分类子榜，便于编辑切换；
3. 自动池从通过门禁且 `G_social ≥ 70` 的候选中取前 10；
4. 对单一分类设置可配置上限，默认不允许 `github_project` 占满全部席位；
5. 没有合格候选的分类不强行凑数；
6. 自动池和人工加入都保留 `content_class`、`G_social`、评分明细和资格原因。

这样既有类似文章池的统一总分，又不会用一套工具指标把技术、趋势和普通事件全部挤掉。

### 4.4 预选落库

`saveSocialPreselection()` 不再固定写入 `wechat-tool-cards`，而是消费预选记录中的路由字段：

```js
store.addCandidateTracks(candidate.id, ['social_cards'], {
  status: 'pooled',
  score: item.gSocial,
  pool_role: item.poolRole,
  output_mode: item.outputMode,
});
```

候选还要保存以下快照，保证后续生成不受事件重新分类影响：

```text
content_class
content_type
classification_status
classification_confidence
classification_reason
g_social
social_score_details
social_qualification_status
social_qualification_reason
social_score_profile
social_route_version
```

### 4.5 自动预选与手动加入的区别

- 自动预选：按统一 `G_social` 和类型门禁进入对应图文候选，保留 `AI ... 图文预选` 角色。
- 事件热榜手动加入：直接使用当前事件分类映射；如果分类为 `news_event`，输出 `wechat-event-cards`；如果为技术或趋势，分别输出对应模式。
- `github_project` 手动加入仍输出 `wechat-tool-cards`。
- 用户明确选择另一条路线时，必须记录人工路由覆盖，不得覆盖分类原值。

## 5. 阶段二：按分类选择故事板技能

### 5.1 故事板技能拆分

新增两个内置技能：

```text
skills/open-source-technology-storyboard/SKILL.md
skills/open-source-trend-storyboard/SKILL.md
```

保留：

```text
skills/event-card-storyboard/
skills/repository-card-storyboard/
```

四类技能共享 `social_card_storyboard` 输出契约、来源引用规则、页数限制和模板能力注入，但各自拥有不同的事实分配和页面职责。

### 5.2 开源技术故事板

默认故事顺序：

```text
封面 → 它解决什么问题 → 机制/架构 → 证据或基准 → 适用边界 → 后续观察
```

允许使用的页面角色：`cover`、`concept`、`feature`、`data`、`compare`、`evidence`、`risk`、`ending`。

硬规则：

- 机制、架构和性能数字必须绑定来源引用。
- 没有基准或实测数据时，不生成“性能对比”页，改为“已知能力与限制”。
- README 的功能宣称不能写成实际效果或作者亲测。
- 单一 GitHub 仓库、单一 README 和安装命令不足以通过技术故事板；这类内容回退为 `repository`。
- 技术图文可以介绍开源技术，但不伪装成深度技术文章。

### 5.3 开源趋势故事板

默认故事顺序：

```text
封面 → 趋势判断 → 谁在推动 → 时间/信号变化 → 生态对比 → 哪些仍待观察
```

允许使用的页面角色：`cover`、`concept`、`timeline`、`compare`、`data`、`evidence`、`risk`、`ending`。

硬规则：

- 至少需要两个独立主体或两个独立来源，且存在跨时间、跨生态或采用变化信号。
- 单项目介绍不得升级为趋势图文。
- 没有可比较数字时，使用主体/事件对比，不编造趋势曲线。
- “趋势正在形成”“生态正在转向”等结论必须绑定具体信号和观察窗口。
- 结尾必须列出会改变当前判断的后续信号。

### 5.4 技能选择

Social 生成入口根据候选的 `content_type` 选择：

```js
const storyboardSkill = {
  github_project: 'repository-card-storyboard',
  news_event: 'event-card-storyboard',
  open_source_technology: 'open-source-technology-storyboard',
  open_source_trend: 'open-source-trend-storyboard',
}[contentClass];
```

技能选择结果写入 generation snapshot 和 `social-card-stage-executions.json`，用于复现和审计。

## 6. 阶段三：扩展分类事实基座

### 6.1 统一事实信封

在现有 `social_card_fact_base` 上增加 `contentType` 和分类专属字段，公共字段保持一致：

```json
{
  "schemaVersion": 2,
  "contentType": "event",
  "storyboardClass": "technology",
  "contentClass": "open_source_technology",
  "topic": "",
  "confirmedFacts": [],
  "claims": [],
  "sources": [],
  "sourceAudit": {},
  "classificationEvidence": [],
  "unknowns": []
}
```

### 6.2 技术事实字段

```json
{
  "mechanisms": [{"claim":"", "sourceRefs":[]}],
  "architecture": [{"claim":"", "sourceRefs":[]}],
  "benchmarks": [{"claim":"", "value":"", "context":"", "sourceRefs":[]}],
  "implementationConstraints": [{"claim":"", "sourceRefs":[]}],
  "limitations": [{"claim":"", "sourceRefs":[]}]
}
```

所有字段允许为空。证据不足时必须降级到可核验的事实卡，而不是补齐字段。

### 6.3 趋势事实字段

```json
{
  "actors": [{"name":"", "role":"", "sourceRefs":[]}],
  "signals": [{"claim":"", "signalType":"", "time":"", "sourceRefs":[]}],
  "timeline": [{"time":"", "event":"", "sourceRefs":[]}],
  "comparisons": [{"left":"", "right":"", "basis":"", "sourceRefs":[]}],
  "adoptionEvidence": [{"claim":"", "sourceRefs":[]}],
  "unknowns": [{"claim":"", "sourceRefs":[]}]
}
```

### 6.4 日常事件卡到事实基座的补齐

事件卡生成阶段继续作为分类和事实卡的共同入口，但输出应增加类型化证据字段，或由确定性转换器从事件卡和来源快照构建上述字段。

禁止在 Social 生成阶段临时调用模型“补技术事实”或“补趋势事实”。事实不足时应该让门禁失败并提示重新生成事件卡/补充来源。

## 7. 阶段四：分类专属门禁

当前 `evaluateEventCardGate()` 需要拆成统一公共门禁加类型门禁：

### 公共门禁

- 事实基座存在；
- 至少一个可用来源；
- 每个核心内容块有 `source_refs`；
- 未核实主张与确认事实分离；
- 禁止表达和披露边界已填写；
- 故事板页数在对应预算内。

### 类型门禁

| 类型 | 最低条件 |
|---|---|
| `event` | 事件摘要、确认事实、来源审计、事实边界 |
| `event` · 技术子类 | 至少一条机制/架构证据；若生成数据页则必须有基准证据 |
| `event` · 趋势子类 | 至少两个主体或独立来源；至少一条时间/生态变化信号 |
| `repository` | 仓库事实、能力、上手入口、限制和资料来源 |

类型门禁不通过时，不自动回退到另一个故事板。只有在分类阶段确定为 `github_project` 或证据不足时，才由分类规则显式降级。

## 8. 阶段五：前端和候选池展示

### 8.1 候选池

图文候选卡显示：

- 内容分类：事件 / 开源技术 / 开源趋势 / 项目图文；
- 图文入口：事件图文（事件、技术、趋势三种故事板）或工具图文；
- `G_social` 最终分、评分模型名称和五项分项；
- 图文资格状态：通过、候补、缺证据或风险拦截；
- 分类证据状态和缺失证据。

`topics.js` 和 `social-editor.js` 通过顶层 `contentType` 路由：`repository` 进入工具图文，`event` 进入事件图文；事件编辑器内按 `content_class` 显示并默认选择三种事件故事板之一。

### 8.2 生成提示

生成按钮文案按类型变化：

- `生成事件故事板`
- `生成对应事件故事板`
- `生成工具故事板`

如果旧候选没有类型快照或故事板技能版本不匹配，显示“请重新生成故事板”，不能静默使用旧事件故事板。

## 9. 数据兼容与迁移

### 9.1 已锁定候选

已锁定、已生成或正在生成的候选保留原有 `output_mode`、故事板技能快照和产物，不因本次改造重路由。

### 9.2 未开始的自动图文预选

下一次事件研判时按新规则清理并重建 `AI ... 图文预选`。旧的自动预选可以被确定性删除；人工加入、已锁定和已有产物的候选不删除。

### 9.3 历史事件候选

历史候选只有 `wechat-tool-cards` 或 `wechat-event-cards` 时，继续按旧模式打开。若用户切换分类或故事板，必须先重新生成事实基座和故事板。

### 9.4 不兼容数据

技术或趋势分类缺少专属事实字段时，候选可以保留在图文池，但生成按钮置为不可用，并明确提示：需要重新生成事件卡或补充独立来源。

## 10. 实施阶段

### Phase 1：统一 G_social 评分与资格门禁

- 新增统一 `G_social` 评分契约和五项公共分项；
- 为四类内容实现类型化分项适配器，不再复用工具项目加分逻辑；
- 实现 `55/70` 候补线和自动入池线，以及类型证据门禁；
- 生成总榜、四类子榜、分项明细和未入池原因；
- 增加分类上限配置，防止单一项目类占满自动池。

验收：同一量纲下可以比较四类候选；分数低或证据不足的候选不会自动进入图文池；没有合格候选的分类不会被强行凑数。

### Phase 2：路由和持久化

- 新增 `socialRouteForContentClass()`；
- 修改 `selectSocialCandidates()` 输出 `gSocial`、评分明细、资格状态和分类专属路由；
- 修改 `saveSocialPreselection()` 消费 `gSocial`、`outputMode`、`poolRole` 和资格原因；
- 增加候选分类/路由快照；
- 修正候选池标签和编辑器模式识别。

验收：四类自动预选不会再全部写成 `wechat-tool-cards`，候选池显示统一 `G_social`，且人工锁定候选路由不变。

### Phase 3：技能和事实基座

- 新增技术故事板和趋势故事板技能；
- 扩展事实信封与事件事实合成；
- 按类型选择故事板 Prompt；
- 保存类型化事实基座和技能快照。

验收：四类分类候选均能得到与自身语义匹配的 `card_plan`；其中三类事件子类共用事件事实基座，每个核心块可追溯到事实来源。

### Phase 4：门禁和渲染回归

- 拆分公共门禁和类型门禁；
- 为技术/趋势增加证据不足、主体不足、来源不足测试；
- 用现有模板包跑四类固定样稿；
- 验证布局重排不改变类型专属页面职责。

验收：技术故事板不会生成无依据性能对比，趋势故事板不会把单项目写成行业趋势，工具项目不会进入事件图文入口。

### Phase 5：灰度与清理

- 先对自动图文预选启用分类路由，保留旧候选兼容；
- 记录各类型故事板生成成功率、门禁失败原因和人工改路由次数；
- 稳定后删除生成阶段按标题/旧字段猜类型的兼容逻辑；
- 更新当前 Social 图文链路文档和 API/技能清单。

## 11. 测试计划

必须增加以下测试：

1. `G_social` 五项分项、权重和扣分可复算，最终分稳定落在 0–100；
2. 四类内容使用正确的分项适配器，不能把 GitHub 工具加分带入事件/技术/趋势；
3. `G_social < 55`、`55–69`、`≥70` 的资格状态和入池结果正确；
4. 类型证据门禁优先于分数，单仓库不能伪装成趋势，缺机制证据不能进入技术自动池；
5. 自动池按统一总榜取候选，同时遵守分类上限，不被项目类占满；
6. 内容分类到 `contentType/outputMode/storyboardSkill` 的确定性映射；
7. 自动预选四类分别写入正确 `output_mode`、`pool_role`、`G_social` 和评分明细；
8. 已锁定候选不被重新分类覆盖；
9. `news_event` 进入事件图文并选择事件故事板；
10. `open_source_technology` 进入事件图文并选择技术故事板，要求机制/架构证据；
11. `open_source_trend` 进入事件图文并选择趋势故事板，要求多主体/跨来源/时间信号；
12. `github_project` 进入工具图文，先完成仓库分析再选择仓库故事板；
13. 技术无基准时不生成性能对比页；
14. 趋势只有单一仓库时不通过趋势门禁；
15. 四类固定故事板都能经过现有模板渲染、布局审计和交付门禁；
16. 历史 `wechat-tool-cards`、`wechat-event-cards` 候选保持兼容；
17. 事件热榜手动加入和自动预选的路由结果一致。

## 12. 不在本次方案内

- 不把 `open_source_technology` 自动升级为深度文章；
- 不把 `open_source_trend` 的趋势判断交给 Social 故事板临时补写事实；
- 不为四类内容复制 HTML 模板和截图流水线；
- 不修改文章 F 评分公式；
- 不迁移已经发布的历史图文；
- 不允许模型在故事板阶段补写事实、数字、性能或采用规模。

## 13. 最终判断

先落地统一 `G_social` 和类型资格门禁，再做分类路由与故事板技能拆分，随后补齐技术/趋势事实字段，最后开放自动图文预选的全量分类分流。

技术和趋势分类仍需通过对应证据门禁；通过后进入事件图文池，并由分类选择技术或趋势故事板。`github_project` 不得绕过仓库分析进入事件图文或直接生成工具卡。
