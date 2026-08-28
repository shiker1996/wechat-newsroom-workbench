# Social 图文统一内容与视觉生成流程改造方案

> 状态：改造设计方案
>
> 更新时间：2026-08-26
>
> 范围：仓库工具图文、事件图文、小红书图文和公众号工具贴图的共同生成链路
>
> 相关当前基线：[Social 图文生成现状与运行链路](./social-card-generation-current-flow.md)

> 当前生效口径（2026-08-28）：不新增、不恢复独立的“叙事提炼”节点。故事板 Agent 在读取事实基座后，直接完成事实取舍、读者问题提炼、页面职责编排和视觉意图标注。本文前半部分保留的“叙事提炼”内容属于历史讨论稿，不是当前实施依据；当前 AI 视觉改造以第 18 节以后为准。

> AI 视觉专项的精简实施方案已单独整理为：[Social 图文 AI 视觉生成 Pipeline + Agent 改造方案](./social-card-ai-visual-pipeline-agent-design.md)。AV-0 至 AV-7 只改造 `social-card-beautify`，不修改故事板生成和 `card-plan.json`。

## 1. 背景

当前 Social 图文已经具备事实基座、语义故事板、页面组件、模板容量预检、确定性渲染和浏览器布局审计，但内容链路仍存在两个断点：

1. 仓库和事件的来源读取方式不同，没有统一的“来源准备”阶段；
2. 故事板需要同时完成事实取舍和面向读者的表达提炼，否则容易把事实原样排成文本和列表；
3. 渲染器已经支持 `stats`、`compare`、`timeline`、`steps`、`scenes`、`highlight` 等内容块，但故事板经常只输出 `text`、`list`、`note`，丰富组件没有命中；
4. 当前没有通用的数据结构表达事件矛盾、读者问题、数字关系、箭头关系、语义图标和徽章。

以 C004 为例，事实中同时存在：

- M6 Mac mini 起售价 6999 元；
- 相比 M4 上涨 2500 元；
- 苹果宣称 AI 性能最高提升 4 倍；
- Mac mini 可能从入门电脑转向本地 AI 入口。

如果这些事实只输出为普通列表，页面可以“正确”，但无法形成清晰的阅读主线和视觉冲击。

## 2. 设计结论

工具图文和事件图文统一采用以下四阶段主流程：

```text
来源准备
  ↓
事实基座
  ↓
故事板
  ↓
视觉渲染
```

其中最后的“视觉渲染”内部仍包含现有的组件装箱、模板容量预检、浏览器布局审计和截图交付，但对外统一为一个阶段。

两类内容共享阶段边界和数据契约，但不共享事实语义：

```text
仓库来源准备 ──→ repository-inspector ──┐
                                       ├─→ 仓库故事板（事实取舍与表达提炼） ─┐
事件来源准备 ──→ event-research-analyzer ─┘                         ├─→ 视觉渲染
                                                                     ┘
```

核心分工：

| 阶段 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| 来源准备 | 确定来源范围、读取正文/文档、记录状态和 provenance | 不做最终观点判断 |
| 事实基座 | 提取确认事实、主张、机制、数据、影响和未知项 | 不决定页面顺序和视觉形式 |
| 故事板 | 在事实基座内选择核心钩子、读者问题、矛盾、主张和视觉重点，并分配到页面和语义内容块 | 不增加事实、不替代来源分析、不输出 HTML/CSS |
| 视觉渲染 | 将语义内容块渲染为图标、数字卡、对比卡、箭头、HTML 和 PNG | 不凭视觉猜事实、不补文案事实 |

## 3. 设计目标

### 3.1 目标

- 工具图文和事件图文使用同一条主流程，减少入口和阶段语义差异。
- 由故事板在消费事实基座时完成事实取舍和读者表达提炼，不增加独立中间产物。
- 让故事板明确选择 `text/list/stats/compare/timeline/scenes/highlight` 等内容结构。
- 让“数字、对比、前后变化和因果/关系”可以被视觉化，而不是退化为列表。
- 让封面能够使用有来源支撑的事件矛盾或工具痛点吸引读者。
- 让视觉图标、徽章和箭头成为受控语义组件，而不是模型随意输出的装饰。
- 保留现有事实 ID、`source_refs`、布局审计、容量重排和交付门禁。
- 支持证据不足时安全降级，不为了视觉效果制造冲突或性能结论。

### 3.2 非目标

- 不把仓库工具图文改造成事件新闻稿。
- 不把事件图文改造成营销种草文。
- 不让模型输出任意 HTML、CSS、SVG 或坐标。
- 不删除现有 `clean-v1`、`neon-v1`、`brutalist-v1` 等模板。
- 不要求每个故事板强行使用所有视觉组件。
- 不用故事板的事实取舍替代 `repository-inspector` 或 `event-research-analyzer` 的事实分析。

## 4. 阶段一：来源准备

来源准备是统一链路新增的第一个节点。它把不同内容类型的原始资料整理成同一格式的来源包，供后续事实分析使用。

### 4.1 统一来源包

```json
{
  "schemaVersion": 1,
  "contentType": "repository|event",
  "subjectId": "",
  "sources": [
    {
      "source_id": "",
      "kind": "readme|repository_api|report|social_post|issue|other",
      "title": "",
      "url": "",
      "source": "",
      "published_at": "",
      "status": "ok|partial|failed|missing",
      "content": "",
      "content_hash": "",
      "error": ""
    }
  ],
  "sourceAudit": {
    "sourceCount": 0,
    "usableSourceCount": 0,
    "independentSourceCount": 0,
    "issues": []
  }
}
```

`content` 可以是完整正文，也可以是经过确定性截取的正文材料；不得把只包含标题和链接的记录误标为正文已读取。

### 4.2 仓库来源准备

仓库图文的来源准备由仓库适配器负责，至少根据可用权限读取：

- 仓库名称、描述、语言、协议和基础元数据；
- README 和使用文档；
- 目录结构、配置文件和入口文件；
- 安装、运行、输出和限制相关资料；
- 必要时的 releases、issues 或示例目录。

来源准备只负责将资料交给 `repository-inspector`，不在这一阶段生成“好用”“封神”等传播判断。

### 4.3 事件来源准备

事件图文的来源准备由事件适配器负责，至少根据事件卡关联关系读取：

- 关联报道正文；
- 报道标题、来源、URL 和发布时间；
- 事件卡中的社交平台补充材料；
- 事件卡标记的缺失来源和读取失败原因。

事件链路保持自动执行：

```text
事件卡
  ↓
关联报道正文准备
  ↓
event-research-analyzer
```

不得要求用户额外点击“分析事件”才能生成正常故事板；深度分析属于自动前置阶段。

## 5. 阶段二：事实基座

事实基座由内容类型专属分析器生成，但使用统一的公共外壳。

### 5.1 公共事实基座

```json
{
  "schemaVersion": 2,
  "contentType": "repository|event",
  "subjectId": "",
  "topic": "",
  "confirmedFacts": [],
  "claims": [],
  "mechanisms": [],
  "benchmarks": [],
  "comparisons": [],
  "timeline": [],
  "actors": [],
  "impacts": [],
  "limitations": [],
  "unknowns": [],
  "sources": [],
  "sourceAudit": {},
  "factIndex": []
}
```

数组成员应尽量使用对象，而不是无法追溯来源的裸字符串：

```json
{
  "claim": "M6版Mac mini起售价6999元",
  "claim_type": "confirmed_fact|official_claim|media_test|inference|rumor",
  "fact_id": "fact:price:m6-mini",
  "source_refs": ["hotspot:20881"]
}
```

### 5.2 两类分析器职责

| 内容 | 分析器 | 输出重点 |
| --- | --- | --- |
| 仓库工具 | `repository-inspector` | 原始仓库结构、能力、运行方式、依赖、限制、证据和资料缺口 |
| 事件图文 | `event-research-analyzer` | 多篇报道合并后的确认事实、主张、机制、基准、变化、影响、风险和开放问题 |

事实分析器不负责决定“封面怎么写”。这由下一阶段完成。

## 6. 已取消：独立叙事提炼（历史讨论稿，不实施）

本节早期曾讨论过将“钩子、读者问题、矛盾和视觉重点”做成独立产物，但该方案已取消。相关内容由故事板直接从事实基座中选择和表达，禁止创建 `social-card-narrative-focus`、`social-card-narrative-planner` 或独立叙事阶段。

## 7. 阶段三：故事板（事实取舍与表达提炼）

故事板直接接收事实基座，不再依赖独立叙事产物。它在同一个生成阶段完成事实取舍、读者问题提炼、矛盾/变化识别、页面顺序编排和语义视觉标注。

### 7.1 故事板新增输入

```json
{
  "facts": "social_card_fact_base",
  "templateCapabilities": {},
  "channelMode": "xiaohongshu|wechat"
}
```

### 7.2 故事板职责扩展

故事板需要同时决定：

- 页面顺序和页数；
- 页面角色；
- 每页核心事实；
- 每个内容块的语义类型；
- 内容块的 `source_refs` 和 `fact_ids`；
- 是否使用数字卡、对比卡、时间线、场景卡或高亮卡；
- 是否使用图标、徽章、箭头关系等视觉意图；
- 官方宣称、媒体测试、推断和未知项的展示口径。

故事板不决定具体 CSS、坐标或模板 DOM。

### 7.3 故事板内部的事实提炼与页面转换

故事板不是把事实全集原样复制到页面，而是从事实基座中直接提炼 `hook`、`reader_question`、`tension`、`key_points` 和 `visual_motifs`，再将它们转换为页面职责和内容块类型。这些字段是故事板内部结果，不是独立阶段或独立文件。

统一转换关系：

| 故事板提炼字段 | 故事板职责 | 优先内容块 |
| --- | --- | --- |
| `hook` | 封面主张和副标题 | `text` / `highlight` |
| `reader_question` | 第二页或概念页的阅读问题 | `text` / `highlight` |
| `tension.left/right` | 两端事实的并置 | `compare` / `stats` |
| `tension.relation` | 两端之间的变化或关系 | `compare.variant=flow` / `timeline` |
| `key_points` | 机制、能力、数据和影响的页面分配 | `text` / `list` / `stats` / `scenes` |
| `visual_motifs` | 页面视觉结构提示 | 对应结构化内容块和受控图标徽章 |
| `uncertainties` | 风险、证据边界和后续观察 | `note` / `highlight` / `list` |

故事板需要完成以下转换，而不是原样复制事实基座：

```text
核心事实/问题   → 封面标题
读者问题       → 页面问题或概念标题
核心矛盾两端   → 对比/数字内容块
变化关系       → 箭头关系或时间线
关键事实       → 机制、证据、场景和影响页面
不确定性       → 风险和待验证页面
```

每一页必须只有一个主叙事职责，但可以组合相互支持的内容块。例如 C004 的价格和性能可以同时构成封面矛盾，但不应在每一页重复；价格页使用 `compare.variant=flow`，性能页使用 `stats`，结论页使用 `highlight`。

故事板输出应增加可选的页面级叙事元数据：

```json
{
  "story_role": "hook|question|mechanism|evidence|comparison|scene|risk|takeaway",
  "story_refs": ["facts.price.old", "facts.price.new"],
  "visual_intent": {
    "kind": "metric|compare|flow|timeline|scene|highlight|badge",
    "icon_key": "price",
    "badge": "PRICE"
  }
}
```

这些字段只表达页面职责和视觉意图，不替代 `fact_ids`、`source_refs`，也不能绕过来源门禁；它们随 `card-plan.json` 保存，不单独输出。

### 7.4 内容块选择规则

```text
单个或多个关键数字          → stats
前后版本/价格/指标对比       → compare
连续变化或事件节点           → timeline
步骤或工作路径               → steps
人群、场景、影响对象         → scenes
一句话结论、核心判断         → highlight
事实边界、风险、来源口径     → note
普通解释和背景               → text
```

故事板必须优先使用能表达事实关系的结构，而不是默认使用 `list`。

### 7.5 目标故事板示例：C004

```text
P1 事件钩子：涨价2500元，M6要做AI入口？
P2 数字变化：6999元 / +2500元 / 2nm / 4×
P3 技术机制：CPU、GPU、神经网络引擎、统一内存
P4 价格链路：4499元 → +2500元 → 6999元
P5 性能口径：苹果官方宣称 vs 媒体测试
P6 使用场景：本地模型玩家、Agent开发者、普通用户
P7 风险结论：真实性能、市场需求和芯片路线仍待验证
```

不是每个 C004 都必须有 7 页。如果事实不支持某个页面，就删除该页面或降级为普通解释块。

## 8. 阶段四：视觉渲染

视觉渲染继续由程序完成。新增目标是让语义故事板能够稳定命中相应视觉组件。

### 8.1 现有能力盘点

当前注册表和 `storyboard-html-content.mjs` 已支持：

```text
text、list、code、note、stats、compare、steps、timeline、scenes、highlight
```

当前缺口：

- C004 故事板实际只使用了 `text/list/note`；
- `stats` 虽然有渲染分支，但没有被事件故事板稳定调用；
- `compare` 目前主要渲染为普通 HTML 表格；
- 没有专门的关系流/箭头组件；
- 没有受控的语义图标和徽章字段；
- `source_refs` 主要用于数据校验，页面上没有逐项体现来源口径。

### 8.2 数字卡

复用现有 `stats` 内容块，补充事实类型和视觉语义：

```json
{
  "type": "stats",
  "title": "这次变化有多大",
  "icon_key": "metric",
  "items": [
    { "num": "6999元", "label": "M6起售价", "claim_type": "confirmed_fact", "source_refs": ["hotspot:20881"] },
    { "num": "+2500", "label": "相比M4涨价", "claim_type": "confirmed_fact", "source_refs": ["hotspot:20881"] },
    { "num": "4×", "label": "官方AI性能口径", "claim_type": "official_claim", "source_refs": ["hotspot:20881"] }
  ],
  "source_refs": ["hotspot:20881"]
}
```

数字卡必须能够标注“官方口径”“媒体测试”或“已确认事实”，不能只显示大数字而隐藏证据性质。

### 8.3 对比卡和箭头关系

默认优先在已有 `compare` 上增加受控的 flow 变体；当没有可用对比页但叙事明确要求关系表达时，允许使用独立 `flow` 兜底块：

```json
{
  "type": "compare",
  "variant": "flow",
  "title": "价格变化",
  "headers": ["上一代", "变化", "新款"],
  "rows": [["M4 · 4499元", "+2500元 ↑", "M6 · 6999元"]],
  "source_refs": ["hotspot:20881"]
}
```

程序渲染为视觉链路：

```text
M4 · 4499元  →  +2500元 ↑  →  M6 · 6999元
```

`variant=flow` 只允许表达：

- 前后版本变化；
- 价格或数值升降；
- 时间节点推进；
- 已有来源支持的状态迁移。

禁止用它表达未经事实支持的因果关系。

### 8.4 图标和徽章

增加受控字段，不允许模型输出任意 SVG、图片 URL 或 CSS：

```json
{
  "icon_key": "price|chip|ai|benchmark|risk|timeline|source|audience|repository",
  "badge": "PRICE|AI|OFFICIAL|MEDIA TEST|RISK|SOURCE",
  "tone": "accent|warning|neutral|success"
}
```

系统内置语义映射：

| `icon_key` | 默认含义 | 默认视觉 |
| --- | --- | --- |
| `price` | 价格变化 | 橙色上涨/下降符号 |
| `chip` | 芯片或架构 | 芯片图标 |
| `ai` | AI能力 | 星光/神经网络图标 |
| `benchmark` | 性能测试 | 数据徽章 |
| `risk` | 风险或边界 | 警示徽章 |
| `timeline` | 时间节点 | 时间线节点 |
| `source` | 来源口径 | 来源徽章 |
| `audience` | 使用对象 | 人群图标 |
| `repository` | 仓库工具 | 代码仓库图标 |

图标是装饰和语义提示，不构成事实；徽章文本如果表达事实口径，仍必须绑定来源。

### 8.5 渲染降级

当当前模板或渠道不支持某个视觉变体时：

```text
stats/compare/flow/scenes 不支持
  ↓
降级为同来源的 text/list/note
```

降级不得丢失事实、来源和不确定性。视觉降级要写入生成记录，便于判断是故事板未命中还是模板能力不足。

## 9. 渠道和模板能力

内容语义统一，渠道能力可以不同。

### 9.1 小红书

小红书优先启用：

```text
stats、compare、compare.variant=flow、timeline、scenes、highlight、icon/badge
```

页面允许更强的数字、钩子、场景和视觉关系表达，但仍必须保留事实边界。

### 9.2 公众号工具贴图

公众号可以先复用安全版：

```text
text、list、note、stats、compare、timeline、highlight
```

`flow`、图标和徽章根据模板实际容量逐步开放。渠道能力不能改变故事板事实，只决定视觉表达是否降级。

## 10. 产物和可追溯性

四阶段分别写入独立产物，方便调试和复现：

| 阶段 | 产物建议 | 作用 |
| --- | --- | --- |
| 来源准备 | `source-preparation.json` | 来源清单、读取状态、正文哈希、失败原因 |
| 事实基座 | `social-card-fact-base.json` / 现有事实索引 | 结构化事实、来源和事实候选 |
| 故事板 | `card-plan-original.json` | 页面职责、内容块、证据引用和视觉意图 |
| 视觉渲染 | `card-plan.json`、`my-design.html`、`output/page-*.png` | 有效计划、HTML、PNG 和最终布局 |

现有产物继续保留：

- `social-card-content-atoms.json`；
- `social-card-content-components.json`；
- `social-card-content-plan-adjustments.json`；
- `social-card-plan-baseline.json`；
- `layout-report.json`；
- `delivery-report.json`。

每个核心事实、数字卡条目、对比项和视觉徽章都应能通过 `fact_ids/source_refs` 回溯到来源。若某个装饰元素没有事实含义，可以不绑定来源，但必须来自系统受控映射。

## 11. 故事板职责感知的合并与修复

故事板增加页面职责和结构化视觉块后，现有的容量重排、续页合并和内容计划调整不能继续只按照“页数、块数和文字长度”处理。否则可能出现以下问题：

- 将封面的事件矛盾合并成普通摘要，失去钩子；
- 将 `stats` 数字卡拆成列表，失去数字层级；
- 将 `compare.variant=flow` 合并进普通文本，失去前后关系；
- 将“官方宣称”和“媒体测试”合并到同一条事实中，丢失证据口径；
- 将“适用场景”和“风险边界”合并，导致读者误以为风险是使用建议；
- 为了填充页面新增没有叙事职责的辅助组件，破坏故事线。

### 11.1 页面职责原子

每个页面和内容块在进入重排前都应带有页面职责元数据：

```json
{
  "story_role": "hook|question|mechanism|evidence|comparison|scene|risk|takeaway",
  "story_group": "price-vs-ai-positioning",
  "story_refs": ["facts.price.old", "facts.price.new", "facts.price.delta"],
  "preservation": "required|preferred|optional"
}
```

这些字段应随内容原子、核心组件和补充组件一起保存。重排时不仅守恒事实原子和来源，也要守恒核心页面职责。

### 11.2 合并兼容矩阵

默认只允许合并页面职责相邻、证据口径一致且不破坏视觉关系的页面：

| 来源页面 | 目标页面 | 默认策略 |
| --- | --- | --- |
| `hook` | `question` | 可合并，保留封面钩子和读者问题 |
| `question` | `mechanism` | 可合并，问题作为标题，机制作为内容块 |
| `mechanism` | `evidence` | 可合并，机制和证据必须分块显示 |
| `evidence` | `comparison` | 有明确同一指标和同一口径时可合并 |
| `comparison` | `scene` | 默认禁止，除非场景解释直接依赖该对比 |
| `scene` | `risk` | 默认禁止，用户场景和风险边界需要区分 |
| `risk` | `takeaway` | 可合并，风险必须保留为独立提示块 |
| `hook` | `risk` | 禁止直接合并 |
| `comparison` | `takeaway` | 只允许作为结论页的对比内容块保留，不能降级为普通段落 |

以下内容块默认视为不可拆核心组件：

```text
封面钩子
stats 数字卡
compare.variant=flow 箭头关系
来源口径徽章
带多个端点的时间线
核心 highlight 结论卡
```

### 11.3 重排优先级

当发生溢出或页数超出推荐值时，按以下顺序处理：

1. 先在同一页面内缩短解释文本，不动叙事核心和结构化条目；
2. 再合并叙事职责相邻的页面，保留核心组件和叙事元数据；
3. 再移动普通 `text/list/note` 块到相邻兼容页面；
4. 再拆分可拆的普通列表和解释段落；
5. 最后才考虑删除可选视觉装饰，不删除事实型数字、对比和来源口径。

如果 `stats`、`compare.variant=flow` 或 `timeline` 放不下，应优先拆页或降低同页说明文字，而不是将结构化块降级为列表。只有当前渠道或模板明确不支持该结构时，才执行有记录的安全降级。

### 11.4 页面合并的硬约束

合并操作必须同时通过：

- 事实原子守恒；
- `source_refs` 和 `fact_ids` 守恒；
- `story_role` 兼容；
- `story_group` 不被拆散；
- `claim_type` 和证据口径不混淆；
- 结构化块类型不被无理由改变；
- 合并后模板容量和浏览器布局审计通过。

合并后的页面可以包含多个内容块，但只能有一个主叙事职责。若两个页面都有 `preservation=required` 的核心职责，默认不合并，改为拆分普通解释内容或保留续页。

### 11.5 内容计划调整器约束

`social-card-content-planner` 的操作仍限制为 `split_page`、`move_block`、`merge_pages`、`add_component`，但需要额外校验：

- `merge_pages` 必须提供或由程序推导兼容的叙事角色；
- `move_block` 不得把 `comparison`、`hook` 或 `risk` 核心块移到语义不兼容页面；
- `add_component` 只能补充 `preservation=optional` 或 `preferred` 内容；
- 不得通过 `add_component` 替代缺失的核心矛盾或核心结论；
- 不能将 `flow`、`stats` 或来源徽章转换成没有视觉意图的 `list`；
- 任何降级都要写入调整记录，并保留原始计划和原因。

### 11.6 以 C004 为例

C004 的核心叙事组为：

```text
价格上涨 4499 → 6999
        ↓
AI性能最高提升4倍
        ↓
Mac mini可能转向本地AI入口
```

该叙事组中的价格数字卡、价格箭头关系和 AI 性能数据不能被分别合并到普通摘要中。允许的修复方式是：

- 缩短解释文字；
- 将价格说明和价格流放在同一页的两个内容块中；
- 将性能数据拆到下一页；
- 将风险说明和结论页合并，但保留独立风险提示卡。

不允许的修复方式是：

```text
stats → list
flow compare → text
官方宣称 + 媒体测试 → 单条“性能提升”
```

## 12. 门禁和安全规则

### 11.1 来源门禁

- 来源状态不是 `ok` 时不得当作已核验正文；
- 事件至少有一个可用的核心报道来源；
- 技术数字和性能数据必须绑定来源；
- 仓库“实际运行效果”不能由 README 自动升级而来。

### 11.2 故事板事实与表达门禁

- 故事板中的核心事实、读者问题、对比关系和视觉重点必须有 `fact_ids` 或 `source_refs`；
- 矛盾两端不能来自纯推断；
- 不能把官方宣称改写成独立验证结果；
- 不能用箭头表达未被事实支持的因果关系；
- 证据不足时不得强行制造冲突，应在故事板中降级为事实说明或待验证提示。

### 11.3 故事板门禁

- 每个内容块必须有 `source_refs`；
- 结构化块必须使用对应字段，不能把数字、对比和时间线塞进长文本；
- `stats` 的每个条目应有 `claim_type` 和来源；
- `compare.variant=flow` 至少有两个端点和一个有来源关系；
- `icon_key`、`badge`、`tone` 必须来自白名单；
- 页面职责不能重复，不能为了命中组件而机械增加页面。

### 11.4 渲染门禁

- 不支持的视觉组件必须安全降级；
- 真实浏览器仍是溢出、裁切、文字过小和垂直失衡的最终裁决；
- 视觉组件不能通过缩小正文字号来解决容量问题；
- 组件装箱和结构重排不能丢失事实原子或来源引用。

## 13. 交互和失败恢复

正常生成不增加新的用户必点按钮，自动执行：

```text
点击生成图文
  ↓
准备来源
  ↓
生成/读取事实基座
  ↓
故事板
  ↓
视觉渲染和审计
```

进度文案按阶段展示：

- `图文 1/4：准备关联来源`；
- `图文 2/4：整理事实基座`；
- `图文 3/4：生成故事板并完成事实取舍`；
- `图文 4/4：渲染和检查图片卡`。

失败恢复：

| 阶段 | 失败处理 |
| --- | --- |
| 来源准备 | 保留失败来源和原因；来源不足则阻断并提示补充来源 |
| 事实基座 | 读取有效缓存；来源签名变化时重新分析 |
| 故事板 | 使用安全结构重新生成或人工调整故事板 |
| 视觉渲染 | 组件降级、装箱、拆页和浏览器审计 |

故事板内部的事实取舍不暴露为独立的“叙事提炼”或“分析事件”按钮；如需调试，可在编辑器中查看页面职责、视觉意图和来源引用，但不增加普通用户的必经流程。

## 14. 对现有实现的改造映射

### 13.1 新增模块

建议新增：

```text
server/features/research/application/source-preparation.mjs
server/features/social-cards/application/storyboard-contracts.mjs
```

职责：

- `source-preparation.mjs`：统一仓库和事件来源包格式，维护读取状态和 source signature；
- `storyboard-contracts.mjs`：由故事板生成阶段在事实基座内完成页面事实取舍；不产生独立叙事文件。

### 13.2 修改现有模块

| 模块 | 改造内容 |
| --- | --- |
| `server/features/social-cards/application/social-card-pipeline.mjs` | 将来源准备、事实基座和故事板生成纳入统一阶段，保存阶段产物和快照 |
| `server/features/social-cards/application/storyboard-contracts.mjs` | 要求故事板在事实基座内完成事实取舍，并补充视觉意图字段 |
| `server/features/social-cards/prompts/runtime-contract.md` | 要求事实关系使用结构化块，钩子和矛盾必须有来源 |
| `skills/repository-card-storyboard/SKILL.md` | 增加痛点—机制—结果的事实取舍与页面编排规则 |
| `skills/event-card-storyboard/SKILL.md` | 增加事件变化—矛盾—影响—不确定性的事实取舍与页面编排规则 |
| `skills/open-source-technology-storyboard/SKILL.md` | 增加机制—证据—读者问题—视觉结构规则 |
| `skills/open-source-trend-storyboard/SKILL.md` | 增加趋势信号—主体变化—对比—待观察信号规则 |
| `server/shared/rendering/storyboard-html-content.mjs` | 支持 `compare.variant=flow`、受控图标和徽章元数据 |
| `server/shared/rendering/templates/social/*.mjs` | 增加关系流、徽章和语义图标的模板 CSS |
| `server/shared/rendering/social-card-template-registry.mjs` | 声明视觉变体和渠道能力 |
| `server/shared/rendering/social-card-repair-policy.mjs` | 校验新增变体字段，保证降级和原子守恒 |
| `server/features/social-cards/application/social-card-content-planner.mjs` | 将视觉组件纳入页面专属候选和安全装箱 |
| `server/shared/rendering/social-card-fact-index.mjs` | 为数字、对比、时间线和场景事实提供稳定候选标签 |
| `docs/design/social-card-generation-current-flow.md` | 更新为四阶段主流程 |

## 15. 实施阶段

### Phase 0：现状基线

- 记录各内容类型和渠道实际命中的内容块；
- 统计 `text/list/note` 与 `stats/compare/timeline/scenes/highlight` 的命中率；
- 用 C004、一个仓库项目和一个趋势事件建立固定回归样稿；
- 不改变现有生成结果。

### Phase 1：故事板事实取舍契约（已完成）

- 故事板直接读取统一事实基座，并在自身 Prompt 中完成页面事实取舍；
- 统一要求核心事实、读者问题、页面职责和视觉意图回指事实或来源；
- 不创建 `social-card-narrative-focus` schema、叙事规划器或独立叙事产物；
- 对未知事实 ID、未知来源和无引用视觉意图执行门禁，失败时安全降级为事实基座中的保守页面。

验收：故事板可以从同一事实基座得到明确的核心事实、读者问题和页面主线，且每个页面字段可追溯；没有额外的叙事文件或阶段记录。

### Phase 2：故事板结构命中（首版完成）

- 已新增事实提炼到结构化故事板的固定运行契约；
- 已在故事板生成后增加确定性桥接，按事实关系和页面职责补充 `stats`、`compare`、`scenes`、`highlight`；
- 已按渠道限制桥接能力，小红书开放结构化块，公众号保持安全降级；
- 保留原有 `text/list/note` 作为降级形式，并保留 `fact_ids`、`source_refs` 和叙事元数据。

首版实现已完成。剩余工作是用真实 C004 和仓库样本重新生成，观察结构化块命中率和布局容量，再进入 Phase 3 的箭头关系、图标与徽章渲染。

验收：C004 至少稳定命中数字卡、对比卡或高亮卡；仓库项目可以稳定命中场景卡、步骤卡或能力卡；证据不足时不强行补块。

### Phase 3：视觉关系组件（基础版完成）

- 已实现 `compare` 的方向箭头和关系标签；无可用对比页时支持独立 `flow` 兜底块；
- 已实现受控 `icon_key/badge` 白名单和模板无关的安全映射；
- 已在共享视觉层和现有模板中提供徽章、箭头和关系流样式；
- 来源口径徽章已接入事实 `claim_type`，并通过受控映射进入渲染层。

基础验收：故事板可以生成“4499 元 → +2500 元 → 6999 元”的视觉关系，并且不丢失来源和不确定性；真实 C004 样本回归和浏览器审计纳入 Phase 4。

### Phase 4：装箱、审计和渠道降级（基础版完成）

- `flow` 已纳入故事板契约、内容规划 schema、组件类型注册和页面装箱拆页白名单；
- 关系流沿用结构化条目容量模型，拆页时保留端点、关系方向、图标、徽章、事实 ID 和来源引用；
- 布局修复门禁保护 `variant/direction/relation/icon_key/badge/claim_type` 等视觉元数据，禁止 AI 修复时静默抹除；
- 事实候选的 `claim_type` 已映射为“官方口径/媒体测试/测试数据/推断/待核实”等受控来源徽章；
- 视觉桥接兼容历史故事板的 `kind` 别名，显式 `role` 优先，旧页面也能找到正确的数字、对比和场景承载页；
- 小红书优先开放完整视觉组件，公众号仍按渠道白名单安全降级；
- 已增加 Phase 4 回归测试，覆盖来源徽章、`flow` schema、可拆分能力和修复元数据守恒。

剩余工作是用真实 C004 和仓库样本重新生成并进行浏览器截图审计，补齐视觉组件命中率、降级率和实际溢出数据。

验收：视觉增强不会引入溢出、裁切、文字过小、事实丢失或来源丢失。

### Phase 5：清理和推广

- 将四阶段流程写入当前实现文档；
- 清理旧的独立叙事阶段、产物和按钮表述；
- 删除生成阶段依赖标题猜测视觉结构的逻辑；
- 按内容类型和渠道统计命中率、降级率和人工修改率。

## 16. 测试计划

必须覆盖：

1. 仓库和事件来源包可以被统一读取和缓存；
2. 来源签名变化会使事实基座和故事板缓存失效；
3. 故事板核心事实、读者问题和视觉关系必须绑定事实或来源；
4. 没有足够证据时不会生成虚假的矛盾；
5. 工具使用 `pain_vs_solution`，事件使用 `change_or_contrast` 或 `claim_vs_evidence`；
6. 数字事实可以被转换为 `stats`；
7. 前后版本事实可以被转换为 `compare`；
8. `compare.variant=flow` 缺少端点或来源时会被拒绝或降级；
9. 图标、徽章和 tone 不在白名单时会被拒绝；
10. 官方宣称、媒体测试、推断和未知项的口径不会被渲染器混淆；
11. 小红书支持完整组件，公众号按模板能力安全降级；
12. 组件装箱、拆页和 AI 文字修复不丢失事实原子和来源；
13. C004 回归样稿稳定出现钩子、数字关系、至少一种视觉增强；
14. 仓库回归样稿稳定出现痛点、能力、场景或步骤结构；
15. 旧 `card-plan.json` 和历史产物仍可打开；
16. 全部输出经过真实浏览器布局审计和交付门禁。

## 17. 目标效果

最终用户看到的是同一个“生成图文”入口，但内部会根据内容类型产生不同的叙事主线：

```text
仓库：痛点 → 机制 → 结果 → 场景 → 限制
事件：变化 → 矛盾 → 证据 → 影响 → 不确定性
```

最终页面不再只是把事实写成列表，而是可以根据事实关系选择视觉结构：

```text
数字       → 数字卡
前后变化   → 对比卡
数值迁移   → 箭头关系
事件节点   → 时间线
适用对象   → 场景卡
核心判断   → 高亮卡
来源口径   → 图标/徽章
```

C004 的目标不是简单显示“苹果发布 M6”，而是让读者快速理解：

> Mac mini 价格上涨 2500 元，同时强化本地 AI 能力；这可能意味着产品从入门电脑转向 AI 入口，但真实性能和市场接受度仍待验证。

这就是统一流程最终要实现的效果：

> 事实基座保证内容可靠，故事板完成事实取舍并把内容讲得清，视觉渲染保证关系看得见。

## 18. AI 视觉生成 Pipeline + Agent 规范化重构

前面的四阶段定义的是内容生产主流程：

```text
来源准备 → 事实基座 → 故事板（内部完成事实取舍） → 视觉渲染
```

其中“视觉渲染”存在两条完全独立的执行链路：

```text
故事板
  ├─→ 程序化视觉渲染：确定性组件 → 模板 HTML → 布局审计 → PNG
  └─→ AI 视觉渲染：生成 Agent → 生成门禁 → 单页审计/修复 Agent → 最终审计 → PNG
```

两条链路共享事实、故事板、主题和渠道信息，但不共享 HTML 构图、不互相回退，也不把程序化页面壳作为 AI 视觉生成的输入限制。

### 18.1 当前 AI 视觉链路的问题

当前 `social-card-beautify` 已能做到从文件读取资料、写入完整 HTML 和调用浏览器能力，但仍有以下架构问题：

1. 全量页面生成和审计修复由同一个长生命周期 Agent 控制；
2. 页面生成状态、审计状态和修复状态混在 `modelStep` 中；
3. Agent 仍然可见确定性审计工具，容易自行决定审计顺序并产生重复调用；
4. 审计结果以工具消息持续累积，导致上下文增长和 JSON 截断；
5. `browser_inspect` 和 `browser_audit` 的观察职责、判定职责没有在 Pipeline 层彻底分离；
6. AI 视觉流程没有完整复用文章和排版流程的技能快照、阶段契约和产物记录；
7. 单页修复失败会被提升为整组生成失败，但缺少可恢复的逐页状态和诊断产物；
8. Agent 生成成功、页面结构通过和最终交付通过没有清晰的阶段边界。

### 18.2 目标架构

AI 视觉生成改为由 Pipeline 控制生命周期，由 Agent 执行有限创作任务：

```text
AI 视觉 Pipeline
  │
  ├─ 1. inputs：准备并冻结输入文件
  ├─ 2. generation：启动全量生成 Agent
  ├─ 3. generation-gate：程序检查 HTML 结构和页面数量
  ├─ 4. audit-repair：程序逐页审计，逐页启动修复 Agent
  ├─ 5. final-audit：程序执行最终整组审计
  ├─ 6. screenshots：生成 PNG 和图片清单
  └─ 7. delivery-gate：交付门禁、报告和状态更新
```

Pipeline 负责：

- 阶段顺序和状态机；
- 输入和技能快照；
- 页面数量、页面差异和文件安全校验；
- 审计调用、修复目标页和重试次数；
- 失败恢复、阶段产物和最终交付判断。

Agent 负责：

- 根据事实、故事板和主题规范进行视觉创作；
- 写入全局 CSS 和页面 HTML；
- 根据明确的单页修复指令修改目标页面；
- 在任务结束时返回简短、合法的结构化确认。

Agent 不负责：

- 决定页面数量；
- 决定整组是否通过；
- 调用最终交付门禁；
- 修改非目标页面；
- 通过删除内容、缩小文字或滚动容器规避布局问题。

### 18.3 AI 视觉阶段契约

新增独立的 AI 视觉阶段契约，建议命名为 `SOCIAL_CARD_AI_VISUAL_STAGE_CONTRACT`：

```js
[
  { id: 'inputs',          skill: 'fixed-program' },
  { id: 'generation',      skill: 'social-card-ai-visual-generator' },
  { id: 'generation-gate', skill: 'fixed-program' },
  { id: 'audit-repair',    skill: 'social-card-ai-visual-generator' },
  { id: 'final-audit',     skill: 'fixed-program' },
  { id: 'screenshots',     skill: 'html-pages-to-images' },
  { id: 'delivery-gate',   skill: 'fixed-program' }
]
```

其中 `audit-repair` 是一个由 Pipeline 管理的循环阶段，不是 Agent 自由循环。每次循环包含一条可追溯记录：

```json
{
  "page": 2,
  "attempt": 1,
  "auditBefore": { "valid": false, "issues": ["text_too_small"] },
  "agentRunId": "agent-...",
  "changed": true,
  "auditAfter": { "valid": true, "issues": [] },
  "status": "passed"
}
```

顶层阶段记录必须校验阶段顺序、技能名称、技能 hash、输入产物和输出产物，模式与文章 Pipeline、排版 Pipeline 保持一致。

### 18.4 输入和技能运行时

AI 视觉 Pipeline 使用 `prepareSkillRun` 建立生成快照，并使用 `bindGenerationSnapshot` 绑定后续模型调用。快照至少冻结：

- `social-card-ai-visual-generator` 技能 Prompt 和 hash；
- `layout-guide.md` 版本和 hash；
- 当前主题 SPEC 版本和 hash；
- Provider、模型和模型配置；
- Agent 可用能力及其插件版本；
- 当前 Pipeline 的输入、选择和任务用途。

生成 Agent 的用户消息只传运行参数，不重复塞入长文本：

```json
{
  "render_request": {
    "workspace": {
      "resourceId": "project:current",
      "files": [
        "fact-sheet.md",
        "card-plan.json",
        "social-theme-design-spec.md",
        "layout-guide.md"
      ]
    },
    "channelMode": "xiaohongshu",
    "requiredPageCount": 6,
    "outputHtml": "ai-beautified.html"
  }
}
```

四份文件是 Agent 的主要上下文：

- `fact-sheet.md`：事实、证据和事实边界；
- `card-plan.json`：页面顺序、页面职责、内容块和视觉意图；
- `social-theme-design-spec.md`：当前主题的色彩、字体、组件和视觉方向；
- `layout-guide.md`：通用页面结构、字号、间距、安全区和密度规则。

禁止将完整 HTML、整组页面内容或重复的设计规范复制进模型消息。文件读取结果也不应在后续修复会话中重复携带。

### 18.5 全量生成 Agent

全量生成 Agent 是一次性、短生命周期的创作阶段。它只拥有：

```text
filesystem.project.read
filesystem.project.write
```

执行顺序：

1. 一次性读取四份输入文件；
2. 使用 `set_head` 写入全局 CSS 和必要的 meta；
3. 使用 `append_body` 逐页追加完整 `.page`；
4. 页面数量达到 `requiredPageCount` 后返回简短完成确认。

生成阶段禁止调用：

- `content.social_card.browser_audit`；
- `replace_page` 或 `replace_pages`；
- 修改已生成页面；
- 输出完整 HTML JSON；
- 使用程序化页面壳、`ai-page-slot` 或程序化构图。

生成 Agent 的工具返回只保留必要的写入结果，例如当前页数、文件路径和字符数，不把 HTML 正文重新放入对话历史。

### 18.6 生成结果门禁

全量生成 Agent 结束后，Pipeline 先执行结构门禁，再启动审计修复。结构门禁包括：

- 存在完整的 `html/head/body` 根节点；
- 全局 CSS 存在且没有危险外链；
- 页面数量严格等于故事板页数；
- 页面编号连续且唯一；
- 每页存在 `.page` 和内容区域；
- 不存在 `ai-page-slot`；
- 不存在空页面、未闭合标签或截断 HTML；
- 不存在脚本、事件属性、远程字体、远程图片和非法 URL；
- 页面内容没有渲染内部来源 ID、候选 ID、批次 ID 或内部路径；
- 页面结构没有被生成 Agent 之外的流程改写。

结构门禁未通过时，允许重新启动一次全量生成 Agent，并将结构错误作为明确的生成指令反馈。不能直接进入逐页布局修复，因为缺页、根节点缺失和 HTML 截断不是单页布局问题。

### 18.7 浏览器观察、确定性审计与修复 Agent

三者分离：

| 能力 | 调用方 | 职责 | 是否判断通过 |
| --- | --- | --- | --- |
| `browser_inspect` | 修复 Agent | 返回指定页真实 DOM 边界、计算样式和滚动尺寸 | 否 |
| `browser_audit` | Pipeline | 执行确定性规则，返回问题、利用率和修复指令 | 是 |
| 修复 Agent | Pipeline 启动 | 根据当前页问题调整 HTML | 否 |

`browser_audit` 不应继续作为普通生成 Agent 的可见工具。Pipeline 直接调用审计脚本或能力实现，并将结构化结果传给修复 Agent。

单页修复流程：

```text
Pipeline 审计 Pn
  ↓
得到 issue + repairInstructions
  ↓
启动一个新的单页修复 Agent
  ↓
Agent 可选 inspect Pn
  ↓
Agent replace_page(Pn)
  ↓
Pipeline 校验只有 Pn 发生变化
  ↓
Pipeline 重新审计 Pn
```

修复 Agent 的上下文只包含：

- 目标页编号；
- 当前页 HTML 或页面读取结果；
- 当前主题和 Layout Guide 的必要摘要；
- 本轮审计问题；
- 程序生成的明确修复指令；
- 允许使用的写入模式和目标路径。

修复 Agent 不接收整组历史审计消息，也不接收其他页面的完整 HTML。

### 18.8 修复指令契约

审计结果必须从“问题标签”升级为可执行的修复指令：

```json
{
  "page": 3,
  "valid": false,
  "issues": [
    {
      "code": "text_too_small",
      "selector": ".page-body .source-note",
      "severity": "warning",
      "observed": { "fontSize": "9px" },
      "instruction": "将该来源说明提升到至少 10px，并保持与相邻内容有 8px 以上间距。"
    },
    {
      "code": "vertical_imbalance",
      "selector": ".page-body",
      "severity": "warning",
      "instruction": "减少顶部空白，将主体卡片整体向上扩展；不得删除事实、不得增加滚动容器。"
    }
  ]
}
```

修复指令生成规则：

- `text_too_small`：明确目标字号和选择器；
- `text_invisible`：明确前景色、背景色和对比度方向；
- `overflow/clipped`：明确需要压缩的间距、内容层级或卡片数量；
- `underfilled/vertical_imbalance`：明确可扩展区域和目标利用率；
- `horizontal_overflow`：明确禁止横向滚动并要求收缩内容宽度；
- `overfilled`：明确只可压缩重复说明，不得删除独立事实。

### 18.9 单页修复硬约束

每次修复必须通过以下程序校验：

- 只能修改审计指定的页面；
- 页面总数不能变化；
- 其他页面 HTML hash 不能变化；
- 目标页必须实际发生变化；
- 不得重新生成 `html/head/body` 页面壳；
- 不得删除 `fact_ids`、`source_refs` 对应的可见事实；
- 不得删除数字、价格、型号、人名、公司名和限制条件；
- 不得通过 `overflow:auto`、`overflow:hidden`、裁切或透明文字绕过问题；
- 修复后必须重新审计同一页面；
- 相同页面和相同问题签名无变化时停止重试。

默认重试策略：

```text
单页最多 3 次修复 Agent
每次修复后必须重新审计
连续两次审计签名不变 → 当前页 blocked
任一页 blocked → 整组不进入交付门禁
```

页级失败应保留 HTML 草稿和完整报告供编辑室查看，但不得生成或登记为可交付 PNG。

### 18.10 上下文、预算与截断处理

生成和修复不得共用一个无限增长的 Agent 历史。预算按层拆分：

| 层级 | 作用 | 上限控制 |
| --- | --- | --- |
| Pipeline | 控制整组总耗时和最大修复页数 | 总超时、总页数、每页重试次数 |
| 生成 Agent | 完成 CSS 和全部页面 | 模型步骤、工具调用、工具结果字符数 |
| 修复 Agent | 完成单页一次修复 | 低模型步骤、低工具调用、短历史 |
| JSON 修复 | 处理结构化响应异常 | 最多一次紧凑重试 |

模型输出只允许返回短协议：

```json
{
  "type": "final",
  "assistantReply": "已写入 P3 修复结果",
  "htmlPath": "ai-beautified.html",
  "page": 3
}
```

HTML 和 CSS 永远通过文件工具写入。若 JSON 截断：

1. 程序识别 `MODEL_JSON_TRUNCATED`；
2. 使用短消息要求 Agent 只返回一个完整工具请求或完成确认；
3. 若再次失败，当前 Agent 阶段标记失败并保留诊断产物；
4. 不把截断响应继续拼进长期上下文，也不触发整组重复修复循环。

### 18.11 产物和阶段记录

AI 视觉目录新增或规范化以下产物：

```text
social-card-ai-visual-skill-manifest.json
social-card-ai-visual-stage-executions.json
source-preparation.json
fact-sheet.md
card-plan.json
social-theme-design-spec.md
layout-guide.md
ai-beautified.html
ai-beautified-generation-gate.json
ai-beautified-page-repair-report.json
ai-beautified-layout-report.json
ai-beautify-report.json
ai-beautified-output/page-*.png
```

阶段记录至少包含：

```json
{
  "stage": "audit-repair",
  "skill": "social-card-ai-visual-generator",
  "skillHash": "sha256:...",
  "inputArtifacts": ["ai-beautified.html", "ai-beautified-generation-gate.json"],
  "outputArtifact": "ai-beautified-page-repair-report.json",
  "gate": "passed|blocked|failed",
  "attempts": [],
  "completedAt": "2026-08-28T00:00:00.000Z"
}
```

报告必须区分：

- Agent 是否成功返回；
- 文件是否成功写入；
- 结构门禁是否通过；
- 单页审计是否通过；
- 最终整组审计是否通过；
- PNG 是否生成；
- 是否允许交付。

### 18.12 失败状态和恢复

| 失败位置 | 状态 | 恢复方式 |
| --- | --- | --- |
| 输入准备 | `inputs-blocked` | 修复输入文件或来源，不启动 Agent |
| Agent 生成 | `generation-failed` | 保留模型调用和文件诊断，重新生成整组 |
| 结构门禁 | `generation-gate-blocked` | 反馈结构错误，最多重新生成一次 |
| 单页修复 | `page-repair-blocked` | 保留目标页和审计报告，允许编辑器手动修改 |
| 最终审计 | `final-audit-blocked` | 保留完整 HTML，不生成交付 PNG |
| 截图 | `screenshots-failed` | 只重试截图，不重新调用 Agent |
| 交付门禁 | `delivery-blocked` | 修复产物登记或安全问题，不重做内容 |

AI 视觉失败不得自动切换为程序化结果。程序化生成仍可以由用户单独执行，两条链路的状态和产物必须分开登记。

### 18.13 代码模块调整

AI 视觉入口可以继续兼容 `social-card-beautify` 任务名，但内部建议拆为：

```text
server/features/social-cards/application/
├─ social-card-ai-visual-pipeline.mjs
├─ social-card-ai-visual-agent.mjs
├─ social-card-ai-visual-tools.mjs
├─ social-card-ai-visual-gates.mjs
├─ social-card-ai-visual-artifacts.mjs
└─ social-card-beautify.mjs          # 兼容入口和任务适配
```

职责：

- `social-card-ai-visual-pipeline.mjs`：阶段状态机、阶段契约和总预算；
- `social-card-ai-visual-agent.mjs`：全量生成 Agent、单页修复 Agent 和提示词组装；
- `social-card-ai-visual-tools.mjs`：文件读写、页面读取和 `browser_inspect` 工具；
- `social-card-ai-visual-gates.mjs`：结构门禁、页面差异门禁和交付门禁；
- `social-card-ai-visual-artifacts.mjs`：快照、报告、阶段执行记录和 Artifact 登记；
- `social-card-beautify.mjs`：保留现有调用方兼容，不再承载全部实现。

共享平台层需要补充：

- 通用阶段记录器，供 Social、文章和排版 Pipeline 使用；
- 可冻结临时 Agent 能力的技能运行时扩展；
- 统一的 Agent 会话预算和结构化错误记录；
- 单页 HTML 读取和单页替换的标准能力协议。

### 18.14 前端进度状态

前端将“AI 美化”统一改称“AI 视觉生成”，并按 Pipeline 阶段显示：

```text
准备视觉输入
AI 生成整组页面
检查页面结构
审计 P1
AI 修复 P1
复核 P1
审计 P2
最终整组审计
生成图片
交付完成
```

失败信息应显示具体阶段和页面，例如：

```text
AI 视觉生成未完成
阶段：P3 单页修复
原因：连续两次修复后仍存在 text_too_small
已保留：HTML、审计报告和 Agent 执行记录
```

## 19. AI 视觉专项实施阶段

本专项不改变来源准备、事实基座、故事板和程序化图文逻辑，先重构 AI 视觉渲染链路。每一阶段都必须有代码、测试和产物验收，不以“模型成功返回”作为唯一完成条件。

### AV-0：基线冻结和观测补齐

目标：冻结当前行为，建立可比较的故障基线。

工作内容：

- 固定 C004、C005、C011 和一个仓库图文作为回归样本；
- 记录当前输入文件、主题 SPEC、模型、Agent 工具调用和失败阶段；
- 保存当前 `ai-beautified.html`、布局报告和模型调用记录；
- 统一错误分类：截断、预算、结构、页面数量、布局和截图失败；
- 确认程序化图文链路与 AI 视觉链路的产物目录和状态完全分离。

验收：同一候选重复执行时，可以定位失败发生在生成、结构门禁、某页修复、最终审计还是截图阶段。

### AV-1：Pipeline Runtime 和阶段契约（已完成）

目标：让 AI 视觉流程具备和文章、排版流程相同的阶段运行能力。

工作内容：

- 已新增 `SOCIAL_CARD_AI_VISUAL_STAGE_CONTRACT`；
- 已接入 `prepareSkillRun`、`bindGenerationSnapshot`；
- 已写入 `social-card-ai-visual-skill-manifest.json`；
- 已写入 `social-card-ai-visual-stage-executions.json`；
- 已增加 AI 视觉专用阶段记录器和阶段失败记录；
- 已将 Provider、模型、技能 hash 和工具版本纳入快照。

验收：已通过一次运行的阶段记录还原输入、技能、模型、工具、产物和失败位置；阶段顺序错误会被程序拒绝。AV-1 当时保留的共用 Agent 仅是过渡状态，现已由 AV-2 拆出全量生成 Agent，兼容审计修复阶段仍单独保留。

### AV-2：全量生成 Agent 独立化（已完成）

目标：将生成阶段从审计修复循环中彻底拆出。

工作内容：

- 已新增独立全量生成 Agent 运行器；
- 生成 Agent 只开放文件读取和文件写入，工具目录不暴露审计能力；
- 四份输入资料由生成 Agent 通过一次读取获得；
- `set_head` 写入 CSS，`append_body` 逐页写入完整页面；
- 已从生成阶段移除 `browser_audit`、`replace_pages` 和页面修复逻辑；
- 生成 Agent 输出只保留短 JSON 确认，并通过运行时强制补齐缺失页面；
- 原有审计修复 Agent 暂作为兼容阶段保留，后续由 AV-4 替换为 Pipeline 控制的单页修复 Agent。

验收：已通过生成与社交卡回归测试；Agent 完成全部页面后才结束；生成阶段不会调用审计；HTML 不出现在模型 JSON 中；上下文不会随着页面正文重复增长。

### AV-3：结构门禁和生成恢复（已完成）

目标：在布局审计前阻断不完整 HTML 和页面数量错误。

工作内容：

- 已实现 HTML 根节点、页面数量、页面编号和安全内容校验；
- 已实现空页面、截断 HTML、内部字段外露和危险资源校验；
- 生成门禁失败时执行一次全量生成恢复；
- 恢复仍失败时保留草稿和诊断，不进入布局修复。

验收：已通过结构失败恢复回归；页面数量从 6 变成 1、根节点缺失或 HTML 截断时，不会启动 P1–P6 布局修复循环。

### AV-4：Pipeline 控制审计和单页修复 Agent（已完成）

目标：建立“程序审计 → 单页 Agent 修复 → 程序复核”的闭环。

工作内容：

- 已从修复 Agent 工具目录移除 `browser_audit`；
- Pipeline 已直接调用确定性浏览器审计；
- 已将审计问题转换为可执行 `repairInstructions`；
- 每个问题页已启动独立修复 Agent；
- 修复 Agent 可选调用 `browser_inspect`；
- 已增加页面内容指纹、页面数量和目标页校验；
- 已增加单页重试上限和相同审计签名停止规则。

验收：已通过单页修复回归；审计 P3 时只能修改 P3；P1–P6 不会被一次 `replace_pages` 重写；修复上下文不会包含上一页和整组历史；同一问题无变化时会停止而不是消耗工具预算。

### AV-5：最终审计、截图和交付门禁（已完成）

目标：让 Agent 成功不等于图文交付成功。

工作内容：

- 增加最终整组确定性审计；
- 将文字可见性、字号、溢出、裁切、利用率、对比度纳入同一报告；
- 只有最终审计通过才生成 PNG；
- 截图失败只重试截图，不重新调用 Agent；
- 交付门禁统一登记 HTML、PNG、报告和状态；
- AI 视觉失败不自动生成程序化回退页面。

实现结果：最终整组审计未通过时跳过 PNG 和正式登记；截图阶段最多只重试截图，不重新调用 Agent；截图数量、两位数页文件名和空文件均纳入门禁；新增 `ai-beautified-delivery-gate.json` 记录 HTML、布局审计、截图和登记状态。

验收：任何页面审计未通过时都不会被标记为可交付；已通过页面的 PNG 不会因另一页失败而被误登记为整组完成；报告可以区分 Agent、审计、截图和交付失败。

### AV-6：技能和工具规范化（已完成）

目标：让技能说明与运行时工具协议一致，减少模型误解。

工作内容：

- 重写 `skills/social-card-ai-visual-generator/SKILL.md` 的阶段说明；
- 将生成阶段和修复阶段写成两个明确协议；
- 补充输入文件、工具权限、文件写入、页面替换和返回 JSON 示例；
- 将 `browser_inspect` 明确为观察能力；
- 将 `browser_audit` 明确为 Pipeline 能力，不作为生成 Agent 工具；
- 补充 Layout Guide、主题 SPEC、字号和对比度的优先级关系；
- 补充截断和 JSON 结构错误的短响应约束。

实现结果：`social-card-ai-visual-generator` 已明确区分全量生成 Agent、单页修复 Agent 与 Pipeline 审计；删除了让 Agent 自行调用 `browser_audit` 和把 Agent `final` 当作交付通过的歧义，补充了 `replace_pages` 单页写入示例。

验收：技能文档中的每个工具、字段和返回示例都能被实际运行时接受；模型不会因使用旧 `blocks`、完整 HTML JSON 或整组 `replace_pages` 而触发协议错误。

### AV-7：前端、回归和切换（已完成）

目标：完成用户可见状态、全量回归和正式切换。

工作内容：

- 前端显示“AI 视觉生成”及其阶段进度；
- 展示当前修复页、问题类型和剩余尝试次数；
- 编辑器保留失败 HTML、审计报告和阶段执行记录；
- 覆盖事件、仓库、开源技术、开源趋势和自定义故事板；
- 覆盖小红书和公众号渠道能力差异；
- 覆盖正常生成、结构失败、JSON 截断、工具预算、单页不收敛、截图失败和最终门禁失败；
- 对旧任务记录和旧 `ai-beautified.html` 保持只读兼容；
- 通过回归后再将新 Pipeline 作为默认实现。

实现结果：编辑室现在能展示 AI 视觉阶段、当前修复页、失败原因、保留的 AI HTML 与运行报告；AI 视觉失败后会自动刷新诊断区。已完成 103 个离线相关测试和静态检查，未启动服务。

验收：五类故事板均能完成独立 AI 视觉生成；程序化生成不受影响；AI 视觉失败原因可定位、产物可保留、修复范围可验证；无服务启动要求，测试使用固定工作目录和离线样本完成。

### 19.1 阶段依赖和交付顺序

```text
AV-0 基线
  ↓
AV-1 运行时与契约
  ↓
AV-2 全量生成 Agent
  ↓
AV-3 结构门禁
  ↓
AV-4 单页审计修复
  ↓
AV-5 最终交付门禁
  ↓
AV-6 技能与工具规范化
  ↓
AV-7 前端与全量回归
```

AV-2 完成前不应继续扩大布局修复规则；AV-3 完成前不应把页面数量错误交给布局审计；AV-4 完成前不应把 `browser_audit` 继续暴露给生成 Agent；AV-5 完成前不应把 AI HTML 登记为正式可交付结果。

## 20. 完成定义

本方案全部完成的标准是：

1. 内容侧遵循“来源准备 → 事实基座 → 故事板（内部完成事实取舍） → 视觉渲染”；
2. 程序化视觉和 AI 视觉是两条独立链路；
3. AI 视觉有正式阶段契约、技能快照和阶段执行记录；
4. 全量页面生成和单页审计修复由不同 Agent 阶段负责；
5. 确定性审计由 Pipeline 调用，Agent 只消费修复指令；
6. `browser_inspect` 只提供真实布局观察，不判断交付是否通过；
7. 页面数量、结构、安全、事实和单页差异由程序门禁保护；
8. 任何截断、重复修复或预算耗尽都能定位到具体阶段和页面；
9. 最终 PNG 只在整组审计和交付门禁通过后生成；
10. 失败时保留可诊断产物，不自动伪造程序化成功结果。
