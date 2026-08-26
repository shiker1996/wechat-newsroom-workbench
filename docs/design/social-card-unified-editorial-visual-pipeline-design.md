# Social 图文统一内容与视觉生成流程改造方案

> 状态：改造设计方案
>
> 更新时间：2026-08-26
>
> 范围：仓库工具图文、事件图文、小红书图文和公众号工具贴图的共同生成链路
>
> 相关当前基线：[Social 图文生成现状与运行链路](./social-card-generation-current-flow.md)

## 1. 背景

当前 Social 图文已经具备事实基座、语义故事板、页面组件、模板容量预检、确定性渲染和浏览器布局审计，但内容链路仍存在两个断点：

1. 仓库和事件的来源读取方式不同，没有统一的“来源准备”阶段；
2. 事实基座直接进入故事板，缺少一次面向读者的“叙事提炼”，导致故事板容易把事实原样排成文本和列表；
3. 渲染器已经支持 `stats`、`compare`、`timeline`、`steps`、`scenes`、`highlight` 等内容块，但故事板经常只输出 `text`、`list`、`note`，丰富组件没有命中；
4. 当前没有通用的数据结构表达事件矛盾、读者问题、数字关系、箭头关系、语义图标和徽章。

以 C004 为例，事实中同时存在：

- M6 Mac mini 起售价 6999 元；
- 相比 M4 上涨 2500 元；
- 苹果宣称 AI 性能最高提升 4 倍；
- Mac mini 可能从入门电脑转向本地 AI 入口。

如果这些事实只输出为普通列表，页面可以“正确”，但无法形成清晰的阅读主线和视觉冲击。

## 2. 设计结论

工具图文和事件图文统一采用以下五阶段主流程：

```text
来源准备
  ↓
事实基座
  ↓
叙事提炼
  ↓
故事板
  ↓
视觉渲染
```

其中最后的“视觉渲染”内部仍包含现有的组件装箱、模板容量预检、浏览器布局审计和截图交付，但对外统一为一个阶段。

两类内容共享阶段边界和数据契约，但不共享事实语义：

```text
仓库来源准备 ──→ repository-inspector ──┐
                                       ├─→ 统一叙事提炼 ─→ 仓库故事板 ─┐
事件来源准备 ──→ event-research-analyzer ─┘                         ├─→ 视觉渲染
                                                                     ┘
```

核心分工：

| 阶段 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| 来源准备 | 确定来源范围、读取正文/文档、记录状态和 provenance | 不做最终观点判断 |
| 事实基座 | 提取确认事实、主张、机制、数据、影响和未知项 | 不决定页面顺序和视觉形式 |
| 叙事提炼 | 选择核心钩子、读者问题、矛盾、主张和视觉重点 | 不增加事实、不替代来源分析 |
| 故事板 | 将叙事主线分配到页面和语义内容块 | 不输出 HTML/CSS、不决定像素坐标 |
| 视觉渲染 | 将语义内容块渲染为图标、数字卡、对比卡、箭头、HTML 和 PNG | 不凭视觉猜事实、不补文案事实 |

## 3. 设计目标

### 3.1 目标

- 工具图文和事件图文使用同一条主流程，减少入口和阶段语义差异。
- 在事实基座和故事板之间增加统一的叙事提炼节点。
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
- 不用叙事提炼替代 `repository-inspector` 或 `event-research-analyzer`。

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

## 6. 阶段三：叙事提炼

叙事提炼是本次改造新增的统一节点，负责把“事实全集”压缩为“读者最应该先看到的主线”。

### 6.1 统一输出契约

Phase 1 已将以下契约冻结为独立文件：

```text
server/shared/domain/schemas/social-card-narrative-focus.schema.json
```

运行时契约名为 `social_card_narrative_focus`。它是故事板的新增输入，不会替代 `social_card_fact_base`；旧故事板在没有该字段时仍可按事实基座兼容运行。

```json
{
  "schemaVersion": 1,
  "contentType": "repository|event",
  "hook": {
    "title": "",
    "subtitle": "",
    "fact_ids": [],
    "source_refs": []
  },
  "reader_question": "",
  "core_statement": "",
  "tension": {
    "type": "pain_vs_solution|change_or_contrast|claim_vs_evidence|before_after|none",
    "left": {
      "label": "",
      "value": "",
      "fact_ids": [],
      "source_refs": []
    },
    "right": {
      "label": "",
      "value": "",
      "fact_ids": [],
      "source_refs": []
    },
    "relation": {
      "label": "",
      "direction": "up|down|from_to|contrast|none",
      "fact_ids": [],
      "source_refs": []
    }
  },
  "key_points": [],
  "visual_motifs": [
    {
      "kind": "metric|compare|flow|timeline|scene|highlight|badge",
      "fact_ids": [],
      "source_refs": []
    }
  ],
  "uncertainties": [],
  "forbidden_claims": []
}
```

所有钩子、问题和矛盾都必须可以回指事实或来源。叙事提炼可以改变表达和优先级，但不能增加数字、效果、动机、因果或引语。

### 6.2 仓库的叙事提炼

仓库采用：

```text
开发者痛点 → 仓库机制 → 使用结果 → 适用人群 → 限制
```

示例：

```json
{
  "hook": { "title": "README太长？这个仓库帮你看懂项目结构" },
  "reader_question": "它能不能减少我理解复杂仓库的时间？",
  "tension": {
    "type": "pain_vs_solution",
    "left": { "label": "痛点", "value": "目录、依赖和入口分散" },
    "right": { "label": "解决方式", "value": "按结构和能力整理仓库" },
    "relation": { "label": "从难读到可执行", "direction": "from_to" }
  }
}
```

“封神”“效率翻十倍”等夸张表达只有在事实基座有明确测量依据时才允许使用；否则应使用具体、可验证的表达。

### 6.3 事件的叙事提炼

事件采用：

```text
事件变化 → 核心矛盾 → 为什么重要 → 影响对象 → 不确定性
```

C004 的提炼结果示例：

```json
{
  "hook": {
    "title": "Mac mini涨2500元，M6要做AI入口？",
    "fact_ids": ["fact:price:m6-mini", "fact:positioning:local-ai"],
    "source_refs": ["hotspot:20881", "hotspot:20848"]
  },
  "reader_question": "涨价后的Mac mini还算入门款吗？",
  "core_statement": "M6的AI性能卖点已经明确，但Mac mini的新定位和涨价后的市场接受度仍待验证。",
  "tension": {
    "type": "change_or_contrast",
    "left": { "label": "价格", "value": "4499元 → 6999元", "source_refs": ["hotspot:20881"] },
    "right": { "label": "AI性能", "value": "官方宣称最高提升4倍", "source_refs": ["hotspot:20881"] },
    "relation": { "label": "+2500元", "direction": "up", "source_refs": ["hotspot:20881"] }
  },
  "visual_motifs": [
    { "kind": "metric", "source_refs": ["hotspot:20881", "hotspot:20848"] },
    { "kind": "flow", "source_refs": ["hotspot:20881"] },
    { "kind": "compare", "source_refs": ["hotspot:20848"] },
    { "kind": "highlight", "source_refs": ["hotspot:20881", "hotspot:20848"] }
  ]
}
```

注意：箭头只表达已有的前后变化，不表达未经证实的因果关系。C004 可以表达“4499 元到 6999 元”，但不能用箭头暗示“涨价导致 AI 性能提升”。

## 7. 阶段四：故事板

故事板接收“事实基座 + 叙事提炼”，不再只接收事实全集。

### 7.1 故事板新增输入

```json
{
  "facts": "social_card_fact_base",
  "narrative": "social_card_narrative_focus",
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

### 7.3 叙事提炼到故事板的转换

叙事提炼不是只供封面使用的文案建议，而是故事板的结构输入。故事板必须消费 `hook`、`reader_question`、`tension`、`key_points` 和 `visual_motifs`，将它们转换为页面职责和内容块类型。

统一转换关系：

| 叙事提炼字段 | 故事板职责 | 优先内容块 |
| --- | --- | --- |
| `hook` | 封面主张和副标题 | `text` / `highlight` |
| `reader_question` | 第二页或概念页的阅读问题 | `text` / `highlight` |
| `tension.left/right` | 两端事实的并置 | `compare` / `stats` |
| `tension.relation` | 两端之间的变化或关系 | `compare.variant=flow` / `timeline` |
| `key_points` | 机制、能力、数据和影响的页面分配 | `text` / `list` / `stats` / `scenes` |
| `visual_motifs` | 页面视觉结构提示 | 对应结构化内容块和受控图标徽章 |
| `uncertainties` | 风险、证据边界和后续观察 | `note` / `highlight` / `list` |

故事板需要完成以下转换，而不是原样复制叙事提炼：

```text
叙事钩子       → 封面标题
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
  "narrative_role": "hook|question|mechanism|evidence|comparison|scene|risk|takeaway",
  "narrative_refs": ["tension", "key_points[0]"],
  "visual_intent": {
    "kind": "metric|compare|flow|timeline|scene|highlight|badge",
    "icon_key": "price",
    "badge": "PRICE"
  }
}
```

这些字段只表达页面职责和视觉意图，不替代 `fact_ids`、`source_refs`，也不能绕过来源门禁。

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

## 8. 阶段五：视觉渲染

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

五阶段分别写入独立产物，方便调试和复现：

| 阶段 | 产物建议 | 作用 |
| --- | --- | --- |
| 来源准备 | `source-preparation.json` | 来源清单、读取状态、正文哈希、失败原因 |
| 事实基座 | `social-card-fact-base.json` / 现有事实索引 | 结构化事实、来源和事实候选 |
| 叙事提炼 | `social-card-narrative-focus.json` | 钩子、问题、矛盾、视觉重点和禁止主张 |
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

## 11. 叙事感知的合并与修复

故事板增加叙事提炼和结构化视觉块后，现有的容量重排、续页合并和内容计划调整不能继续只按照“页数、块数和文字长度”处理。否则可能出现以下问题：

- 将封面的事件矛盾合并成普通摘要，失去钩子；
- 将 `stats` 数字卡拆成列表，失去数字层级；
- 将 `compare.variant=flow` 合并进普通文本，失去前后关系；
- 将“官方宣称”和“媒体测试”合并到同一条事实中，丢失证据口径；
- 将“适用场景”和“风险边界”合并，导致读者误以为风险是使用建议；
- 为了填充页面新增没有叙事职责的辅助组件，破坏故事线。

### 11.1 叙事原子

每个页面和内容块在进入重排前都应带有叙事元数据：

```json
{
  "narrative_role": "hook|question|mechanism|evidence|comparison|scene|risk|takeaway",
  "narrative_group": "price-vs-ai-positioning",
  "narrative_refs": ["tension.left", "tension.right", "tension.relation"],
  "preservation": "required|preferred|optional"
}
```

这些字段应随内容原子、核心组件和补充组件一起保存。重排时不仅守恒事实原子和来源，也要守恒核心叙事角色。

### 11.2 合并兼容矩阵

默认只允许合并叙事职责相邻、证据口径一致且不破坏视觉关系的页面：

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
- `narrative_role` 兼容；
- `narrative_group` 不被拆散；
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

### 11.2 叙事门禁

- `hook`、`reader_question`、`tension` 至少有一个事实或来源引用；
- 矛盾两端不能来自纯推断；
- 不能把官方宣称改写成独立验证结果；
- 不能用箭头表达未被事实支持的因果关系；
- 证据不足时允许 `tension.type=none`，不得强行制造冲突。

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
叙事提炼
  ↓
故事板
  ↓
视觉渲染和审计
```

进度文案按阶段展示：

- `图文 1/5：准备关联来源`；
- `图文 2/5：整理事实基座`；
- `图文 3/5：提炼叙事主线`；
- `图文 4/5：生成故事板`；
- `图文 5/5：渲染和检查图片卡`。

失败恢复：

| 阶段 | 失败处理 |
| --- | --- |
| 来源准备 | 保留失败来源和原因；来源不足则阻断并提示补充来源 |
| 事实基座 | 读取有效缓存；来源签名变化时重新分析 |
| 叙事提炼 | 若无足够矛盾，输出无矛盾的事实主线，不强行生成钩子 |
| 故事板 | 使用安全结构重新生成或人工调整故事板 |
| 视觉渲染 | 组件降级、装箱、拆页和浏览器审计 |

叙事提炼不应暴露为独立的“分析事件”按钮。它是生成图文的自动阶段；如需调试，可在编辑器中查看叙事主线和来源引用，但不增加普通用户的必经流程。

## 14. 对现有实现的改造映射

### 13.1 新增模块

建议新增：

```text
server/features/research/application/source-preparation.mjs
server/features/social-cards/application/social-card-narrative-planner.mjs
server/shared/domain/schemas/social-card-narrative-focus.schema.json
```

职责：

- `source-preparation.mjs`：统一仓库和事件来源包格式，维护读取状态和 source signature；
- `social-card-narrative-planner.mjs`：消费事实基座，输出叙事提炼契约，执行来源和事实校验；Phase 1 已实现并接入 `card-editorial` 入口；
- `social-card-narrative-focus.schema.json`：冻结钩子、读者问题、矛盾和视觉重点字段。

### 13.2 修改现有模块

| 模块 | 改造内容 |
| --- | --- |
| `server/features/social-cards/application/social-card-pipeline.mjs` | 将来源准备和叙事提炼纳入生成阶段，保存阶段产物和快照 |
| `server/features/social-cards/application/storyboard-contracts.mjs` | 将叙事提炼注入故事板 Prompt，补充视觉意图字段 |
| `server/features/social-cards/prompts/runtime-contract.md` | 要求事实关系使用结构化块，钩子和矛盾必须有来源 |
| `skills/repository-card-storyboard/SKILL.md` | 增加痛点—机制—结果的叙事提炼消费规则 |
| `skills/event-card-storyboard/SKILL.md` | 增加事件变化—矛盾—影响—不确定性的叙事提炼消费规则 |
| `skills/open-source-technology-storyboard/SKILL.md` | 增加机制—证据—读者问题—视觉结构规则 |
| `skills/open-source-trend-storyboard/SKILL.md` | 增加趋势信号—主体变化—对比—待观察信号规则 |
| `server/shared/rendering/storyboard-html-content.mjs` | 支持 `compare.variant=flow`、受控图标和徽章元数据 |
| `server/shared/rendering/templates/social/*.mjs` | 增加关系流、徽章和语义图标的模板 CSS |
| `server/shared/rendering/social-card-template-registry.mjs` | 声明视觉变体和渠道能力 |
| `server/shared/rendering/social-card-repair-policy.mjs` | 校验新增变体字段，保证降级和原子守恒 |
| `server/features/social-cards/application/social-card-content-planner.mjs` | 将视觉组件纳入页面专属候选和安全装箱 |
| `server/shared/rendering/social-card-fact-index.mjs` | 为数字、对比、时间线和场景事实提供稳定候选标签 |
| `docs/design/social-card-generation-current-flow.md` | 在实现完成后更新为五阶段主流程 |

## 15. 实施阶段

### Phase 0：现状基线

- 记录各内容类型和渠道实际命中的内容块；
- 统计 `text/list/note` 与 `stats/compare/timeline/scenes/highlight` 的命中率；
- 用 C004、一个仓库项目和一个趋势事件建立固定回归样稿；
- 不改变现有生成结果。

### Phase 1：叙事提炼契约（已完成）

- 新增 `social-card-narrative-focus` schema；
- 实现仓库、事件和自定义内容的叙事提炼适配器；
- 将叙事提炼注入故事板 Prompt；
- 保证没有矛盾时可以安全输出 `none`；
- 保存 `social-card-narrative-focus.json`，并在渲染流水线登记为图文产物；
- 对未知事实 ID、未知来源和无引用矛盾执行门禁，失败时安全降级为无矛盾主线。

验收：已通过仓库叙事提炼契约测试、引用门禁测试和事件/事实基座回归测试；同一事实基座可以得到明确的钩子、读者问题或无矛盾的安全主线，且每个字段可追溯。

### Phase 2：故事板结构命中（首版完成）

- 已新增叙事到结构化故事板的固定运行契约；
- 已在故事板生成后增加确定性桥接，按叙事矛盾和关键点补充 `stats`、`compare`、`scenes`、`highlight`；
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

- 将五阶段流程写入当前实现文档；
- 旧故事板无叙事提炼时兼容读取，但新生成必须经过叙事提炼；
- 删除生成阶段依赖标题猜测视觉结构的逻辑；
- 按内容类型和渠道统计命中率、降级率和人工修改率。

## 16. 测试计划

必须覆盖：

1. 仓库和事件来源包可以被统一读取和缓存；
2. 来源签名变化会使事实基座和叙事提炼缓存失效；
3. 叙事钩子、读者问题和矛盾必须绑定事实或来源；
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

> 事实基座保证内容可靠，叙事提炼保证内容值得读，故事板保证内容讲得清，视觉渲染保证关系看得见。
