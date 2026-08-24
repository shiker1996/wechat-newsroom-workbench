# Social 图文生成现状与运行链路

> 状态：当前实现基线
>
> 更新时间：2026-08-22
>
> 范围：仅 Social 图文（小红书图文 / 公众号工具贴图）的故事板、内容计划、模板渲染和交付
>
> 不包含：文章主题、文章生成、封面主题和历史已发布图文迁移

本文是 Social 图文生成链路的当前唯一流程说明。其他设计文档中的“方案”“阶段执行记录”和“历史基线”用于记录演进过程；如果与本文冲突，以当前代码和本文为准。

## 1. 一句话结论

Social 图文不是“故事板生成后直接套 HTML”，也不是“AI 直接生成 HTML”。当前链路是：

```text
事实基座
  ↓
AI 语义故事板（决定每页讲什么）
  ↓
内容原子与页面专属组件候选（决定可用组件）
  ↓
模板/主题容量预检（决定页面能承载多少）
  ↓
内容计划调整与组件装箱（决定内容如何分配）
  ↓
确定性模板 HTML 渲染（程序生成）
  ↓
真实浏览器 375×667 布局审计
  ↓
结构重排 → 组件装箱 → 密度调整 → 文字微调
  ↓
PNG 截图、文案、交付门禁和产物登记
```

核心分工：

| 层 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| 事实基座 | 提供可引用事实和来源 | 不由模型补造事实 |
| 故事板 | 决定页面数量、角色、标题、核心内容和故事顺序 | 不负责精确像素排版 |
| 页面组件 | 将核心块和事实补充整理成可装箱组件 | 不直接输出 HTML/CSS |
| 主题/模板 | 决定视觉语言、页面骨架、内容块能力和容量 | 不改变事实语义 |
| 内容计划调整器 | 在页面之间拆分、移动、合并或补充安全组件 | 不修改模板、不输出任意代码 |
| 程序渲染器 | 生成 HTML、计算容量、执行校验和截图 | 不凭视觉猜测事实 |
| AI 文字修复 | 在最后阶段缩写或扩写已有文字 | 不拆页、不增删块、不改变事实结构 |

## 2. 入口和前置条件

### 2.1 生成整组图文

整组生成需要：

- 候选及其内容类型（repository / event / custom）；
- 已核验的事实基座和来源；
- 有效故事板；
- 当前 Social 主题；
- 主题对应的模板包和模板容量档案。

如果故事板来自旧链路、缺少当前组件契约或无法通过结构校验，入口应提示先重新生成故事板，而不是把旧结构强行送入新装箱链路。

### 2.2 主题与模板

主题选择只影响 Social 主题和模板解析，不改变文章主题或封面主题。

- 专用主题使用绑定的模板包，例如 `neon-v1`、`brutalist-v1`、`editorial-v1`、`clean-v1`；
- `standard-v1` 是标准兼容模板，可用于显式选择、缺少模板绑定的旧主题或兼容渲染；
- 专用模板布局审计失败时，不自动整组切换到 `standard-v1`；会在当前模板内继续修复，最终失败时明确报错；
- 模板选择、模板版本、容量档案和是否发生兼容解析会写入主题快照和模板指标。

## 3. 阶段一：事实基座

### 页数预算门禁

推荐页数只是软预算；仓库型图文推荐 7 页、绝对上限 12 页，事件和自定义图文推荐 10 页、绝对上限 16 页。绝对上限检查不仅发生在初始故事板预检，也会在 AI 内容计划调整、确定性拆页和续页重新装箱后的每次重编译执行。超过推荐值会保留事实并继续续页，超过绝对值则阻断本轮计划写回，避免调整操作把页数再次推过安全上限。

程序先读取仓库事实、来源和核验状态，生成 `social-card-fact-index.json`。事实候选至少包含：

- 稳定 `id`；
- 事实文本和自然展示标签；
- 语义标签，如 `capability`、`install`、`run`、`output`、`limitation`；
- `source_refs` 和来源状态；
- `component_eligible`，用于排除仓库统计、字段名、状态元数据和 README 标题等不适合直接上卡的内容。

事实索引保留原始路径供审计，但页面标题和 AI 候选提示使用自然语义标签，不直接展示 `coreCapabilities`、`sections`、`value` 等字段名。

## 4. 阶段二：语义故事板

故事板技能只输出结构化 `card_plan`，由 AI 决定：

- 页面数量和页面顺序；
- 页面角色：`cover`、`concept`、`feature`、`steps`、`data`、`compare`、`evidence`、`timeline`、`risk`、`ending`；
- 每页简短标题、目标和证据；
- 核心 `content_blocks`、块类型和来源引用；
- 可选的语义构图意图，不能输出 CSS、坐标或 HTML。

程序随后执行：

1. 故事板 JSON Schema 校验；
2. 来源绑定和事实候选校验；
3. 页面角色、内容块、条目和标题预算清理；
4. 模板感知预检，必要时拆分列表/步骤/时间线等可拆结构；
5. 记录原始计划和重排后的有效计划。

故事板的职责是“讲什么”，不是提前为每个模板写死视觉布局。

## 5. 阶段三：内容原子与页面专属组件

### 5.1 内容原子

核心故事板块会被展开为内容原子，保留页码、块索引、条目索引、来源和拆分策略。原子用于：

- 守恒校验；
- 拆页和移动后的回放；
- 判断是否丢失事实或来源；
- 记录生成前后的计划变化。

### 5.2 核心组件与补充组件

每页组件分为两类：

```text
页面盒子
├── 核心组件：来自故事板，决定本页核心内容
└── 补充组件：来自事实基座，用于安全填充剩余空间
```

补充组件会绑定：

- 目标页 `page`；
- 页面角色 `role`；
- 程序解析出的 `slotId`；
- 语义标签和候选渲染形式 `renderCandidates`；
- 来源、事实 ID 和预计高度；
- 当前模板容量下的 `capacityEstimate`。

### 5.3 页面专属候选池

内容计划调整器只接收目标页 `pageCandidates`，不接收全局事实组件池。这样可以避免：

- 把只适用于 `evidence` 页的来源组件放进 `feature` 页；
- AI 选择一个没有合法页面槽位的全局组件；
- 组件找不到 `slot_id` 后才在末端失败。

如果目标页没有安全候选，程序返回“无可应用操作”，不会制造事实，也不会强行补入不匹配组件。

## 6. 阶段四：模板容量预检

模板包为每个页面角色声明：

- 支持的内容块类型；
- 最大内容块数和条目数；
- 角色级补充语义；
- 字体、边框、内边距、阴影和间距对应的容量档案；
- 普通页、续页、封面和结尾页的密度目标。

容量预检不是最终门禁。块数、条目数、允许的内容块类型等结构约束仍可直接拦截；静态高度只用于生成候选、风险标记和排序，不再据此提前拒绝合并、移动或补充组件。候选应用后的溢出、裁切和实际利用率统一由真实浏览器审计裁决。

固定页面尺寸为 `375×667`。模板的标题、页眉、页脚、边框、内边距和卡片间距属于固定骨架，不随内容临时缩放。

## 7. 阶段五：内容计划调整与组件装箱

内容计划调整器是 AI 参与页面编排的受控层。它只允许返回：

```json
{
  "operations": [
    { "op": "split_page", "page": 4, "groups": [] },
    { "op": "move_block", "from_page": 4, "to_page": 5, "block": 1 },
    { "op": "merge_pages", "pages": [4, 5] },
    {
      "op": "add_component",
      "page": 4,
      "component_id": "component-fact-id@p4-run-note",
      "render_type": "note",
      "fact_ids": ["fact-id"],
      "source_refs": ["README:Usage"],
      "block": { "type": "note", "title": "使用方式", "content": "生成后的简洁展示文案" }
    }
  ]
}
```

重要契约：

- AI 不填写 `slot_id`；
- `component_id` 必须来自目标页 `pageCandidates`；
- `block` 必须由 AI 返回展示文案；`source_text` 只能作为证据，不能原样写入；
- AI 不得返回 `add_fact_block`、完整 `card_plan`、HTML、CSS 或任意新事实；
- 程序根据组件的页面绑定和统一语义表解析 `slot_id`；
- 程序继续校验角色、故事线、来源、事实 ID、内容块类型、容量和原子守恒；
- 任一操作不合法时可以按页面部分提交，但不能静默应用非法操作。

内部为复用既有结构校验器，`add_component` 会转换成内部 `add_fact_block` 结构；这个内部字段不是 AI 契约，也不应出现在模型提示词或新操作日志的对外描述中。

### 7.1 当前执行顺序

```text
浏览器审计发现问题
  ↓
结构性问题：确定性安全构图 / 模板感知重排
  ↓
已拆出的续页：重新从页面专属组件候选池装箱
  ↓
无结构问题但密度不足：程序装箱 + AI 内容计划调整
  ↓
重新编译和渲染
  ↓
再次浏览器审计
```

内容计划调整最多执行 rollout 档案规定的轮次和操作数。没有安全组件时保留当前硬门禁通过结果并记录原因，不为了填满页面而强行扩写。

## 8. 阶段六：确定性渲染和布局审计

程序根据有效 `card_plan`、主题快照、模板包和构图决策生成 HTML。模型不生成 HTML/CSS。

真实浏览器逐页审计以下问题：

- `overflow`、`clipped`、`horizontal_overflow`；
- 网格结构或内容栈错误；
- `underfilled`、`underfilled_target`；
- `text_too_small`、`vertical_imbalance`。

修复优先级：

1. 结构性问题：安全构图、模板感知拆页、合并或移动完整内容块；
2. 续页内容不足：在绝对安全页数上限和容量安全范围内重新装箱；推荐页数只作为软预算提示；
3. 普通页视觉密度不足：组件装箱或受控舒展排版；
4. 最后才进行 AI 文字缩写/扩写，只允许改已有文字，不得新增/删除块、条目或拆页。

第一层内部固定为：失败页智能构图退化为稳定构图并立即浏览器复审；仍失败时才执行模板感知重排、合并或移动完整内容块，最后拆页。第二至第四层顺序不变。

第三层内部固定为：先处理续页合并或移动，再尝试页面专属组件装箱，然后使用有界舒展或自适应内容容器；只有这些方案都已穷尽，才接受纯 `underfilled` 的软密度结果并结束修复。

每轮修复仍记录“当前计划指纹 + 逐页审计问题 + 已启用的安全构图/密度变体”用于诊断，但重复状态不再提前中断。流程继续执行后续构图、装箱、容器和文字兜底，由固定最大轮数控制成本，最终以浏览器布局门禁决定交付或失败。

页数也分为两层：仓库图文推荐 7 页、绝对安全上限 12 页；事件/自定义图文推荐 10 页、绝对安全上限 16 页。超过推荐页数只记录告警并继续保留续页，超过绝对安全上限才阻断，绝不静默截断故事板。

## 9. 阶段七：截图、交付与产物

布局审计通过后，程序：

1. 使用 `html-pages-to-images` 按 `.page` 截取 375×667 PNG；
2. 生成配套文案和标签；
3. 执行 HTML、事实、来源、布局和交付门禁；
4. 写入候选产物和生成记录。

典型产物包括：

| 文件 | 用途 |
| --- | --- |
| `social-card-fact-index.json` | 事实候选、标签和来源快照 |
| `social-card-content-components.json` | 核心组件、补充组件和页面专属候选 |
| `card-plan-original.json` | 故事板进入管线时的原始计划 |
| `card-plan.json` | 当前有效计划 |
| `social-card-content-atoms.json` | 内容原子和守恒依据 |
| `social-card-content-plan-adjustments.json` | 内容计划调整轮次、操作、拒绝原因和来源 |
| `social-card-plan-baseline.json` | 生成前后计划基线 |
| `social-template-metrics.json` | 模板、利用率、修复轮次和门禁指标 |
| `layout-report.json` | 最终逐页浏览器布局报告 |
| `delivery-report.json` | 最终交付门禁报告 |
| `my-design.html` / `output/page-*.png` | 最终预览和图片 |

## 10. 常见问题定位

### 10.1 “缺少 slot_id”

新链路中 AI 本来就不需要返回 `slot_id`。当前程序会先解析 `component_id`，再由页面候选的语义标签计算槽位。若组件解析失败，会直接报告组件不属于目标页或无法解析槽位，不再把它伪装成空 `slot_id` 的旧错误。常见原因是：

- AI 选中了不属于目标页的全局事实候选；
- 页面专属候选快照缺失或与当前故事板不匹配。

处理方式是重新生成故事板或重新生成整组图文，不是让 AI 手写一个槽位值。合法的 `add_component` 仍会在内部适配到结构校验器，但非法组件会在适配前被拦截。

### 10.2 fenced code 被当作普通文本

事实索引对普通文本折叠空白，但完整的 Markdown fenced code 会保留换行；组件归一化会识别 fenced code 并强制使用 `code` 渲染，即使模型错误返回 `render_type: list`。Social HTML 渲染器也会对完整 fenced code 做最后兜底，将正文输出到 `<pre><code>`，不会显示 ` ```bash ` 围栏。

### 10.3 “补充组件预计超过模板安全容量”

这不是事实错误，而是程序拒绝了可能导致溢出的补充。最终页面仍可在没有补充的情况下通过审计；如果页面确实过空，应调整故事板或提供更短、同角色的组件候选。

### 10.4 “结构性布局问题未解决”

说明问题属于溢出、裁切或横向结构，而不是普通文字长短。文字缩写不会改变列结构；`text/note/code` 现在只允许按明确的段落、句子或完整命令组拆分，指标卡和 CTA 等不可拆块仍应由结构修复或人工重排处理。

### 10.5 重新生成后仍是旧效果

检查是否重新生成了故事板。旧故事板可能没有页面专属组件字段；重新生成图文只会继续使用当前故事板，不会自动把旧故事板转换成新组件结构。

### 10.6 编辑器只显示旧页面的布局问题

故事板重新生成、切换 Social 主题或切换渠道后，上一版 HTML 的 `layout-report.json` 和 `card-plan-reflow.json` 已不再对应当前故事板。路由会将这两个产物标记为 `invalidated` 并清空页面列表，避免编辑器把旧的 P4/P7 问题错误挂到新计划上；用户需要重新生成整组图文后才会得到新的逐页审计结果。

### 10.7 “布局修复 JSON 无法解析”

布局修复返回可以包含代码块，而代码块正文可能有内部 Markdown 围栏（例如 ` ```bash `）。解析器只剥离最外层围栏，并对尾逗号、字符串内真实控制字符和正文中的未转义引号做受控格式修复，再交给严格 `JSON.parse` 和故事板结构门禁校验；不会把任意文本当作合法计划。

## 11. 代码与文档映射

| 责任 | 主要实现 |
| --- | --- |
| 图文主流程 | `server/features/social-cards/application/social-card-pipeline.mjs` |
| 事实索引 | `server/shared/rendering/social-card-fact-index.mjs` |
| 内容原子 | `server/shared/rendering/social-card-content-atoms.mjs` |
| 页面组件和装箱 | `server/shared/rendering/social-card-content-components.mjs` |
| 内容计划调整 | `server/features/social-cards/application/social-card-content-planner.mjs` |
| 槽位目录 | `server/shared/rendering/social-card-supplement-slots.mjs` |
| 槽位语义唯一来源 | `server/shared/rendering/social-card-page-component-contract.mjs` |
| 模板容量和重排 | `server/shared/rendering/social-card-reflow.mjs` |
| 结构修复门禁 | `server/shared/rendering/social-card-repair-policy.mjs` |
| 主题/模板解析 | `server/shared/rendering/social-card-template-resolver.mjs` |
| HTML 模板渲染 | `server/shared/rendering/templates/social/` |
| 运行时契约 | `server/domain/social-card-prompts/runtime-contract.md` |

## 12. 相关设计文档的阅读顺序

1. 本文：当前实现和运行顺序；
2. [Social 图文页面专属组件生成层方案](./social-card-page-component-generation-plan.md)：页面组件模型和阶段执行记录；
3. [Social 图文组件装箱与语义内容计划方案](./social-card-component-packing-plan.md)：组件装箱、续页装箱和容量校准；
4. [Social 图文内容计划调整器实施方案](./social-card-content-plan-adjuster-design.md)：受控操作和审计记录的演进过程；
5. [模板感知故事板与结构重排实施方案](./social-card-storyboard-template-capacity-and-reflow-plan.md)：模板容量和结构重排的历史方案；
6. [语义故事板与主题化模板渲染技术方案](./social-card-semantic-storyboard-theme-template-design.md)：主题、模板和故事板分层的设计背景。
