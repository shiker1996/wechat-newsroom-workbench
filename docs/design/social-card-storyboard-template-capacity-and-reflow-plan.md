# Social 图文：模板感知故事板与结构重排实施方案

> 当前实现说明：本文记录模板容量、重排和修复策略的阶段方案。完整运行顺序请以 [Social 图文生成现状与运行链路](./social-card-generation-current-flow.md) 为准；当前组件补充已经收敛为页面专属 `pageCandidates` + `add_component`，文字缩写/扩写仅是最后兜底。

> 状态：阶段 5 已完成
> 
> 范围：仅 Social 图文生成、故事板、Social 主题与 Social 模板渲染
> 
> 日期：2026-08-21
> 
> 关联方案：
> 
> - [Social 图文语义故事板与主题化模板渲染](./social-card-semantic-storyboard-theme-template-design.md)
> - [Social 图文模板提案与 AI 辅助创建](./social-card-template-authoring-ai-assist-plan.md)
> - [Social 图文模板严格渲染与新主题模板匹配](./social-card-template-strict-and-theme-matching-plan.md)

## 1. 结论

当前 Social 图文链路已经具备故事板、主题模板、模板能力声明和浏览器布局审计，但故事板与模板之间仍然是“单向适配”：

```text
素材 / 事实基座
  ↓
故事板
  ↓
模板渲染
  ↓
浏览器门禁才发现真实溢出
```

模板目前声明的主要是 `maxBlocks` 和 `maxItems`。这只能约束结构数量，不能表达标题行数、列表项高度、字体、padding、边框、阴影和间距叠加后的真实可用空间。

因此会出现：故事板在数量上符合模板能力，但使用完整故事板渲染时仍然 `overflow` 或 `clipped`。候选 820 的 Brutalist P3 就属于这一类：页面经过列表裁剪后仍保留 9 条，符合 `maxItems: 9`，但真实视觉高度超过页面可用空间。

本方案不放松“禁止裁切、禁止隐藏溢出、正文不得小于 11px”等硬门禁，而是把链路改成：

```text
素材 / 事实基座
  ↓
主题与模板绑定
  ↓
模板感知语义故事板
  ↓
模板容量预检与结构编排
  ↓
模板渲染
  ↓
浏览器布局审计
  ↓
结构重排 / 拆页
  ↓
轻量文字缩写或扩写
  ↓
最终门禁
```

核心原则：

1. 故事板决定“页面讲什么”。
2. 主题决定颜色、字体和视觉身份。
3. 模板决定内容如何承载，以及何时允许拆页。
4. 程序负责容量预检、事实保护、结构校验和最终门禁。
5. AI 负责语义组织、拆分建议和局部文字调整，但不能绕过程序门禁。
6. `AI 缩写/扩写`保留为轻量修复能力，不再作为解决结构溢出的主要手段。

文章主题、封面主题、文章生成和封面生成流程不在本方案范围内。

## 2. 当前实现与问题定位

### 2.1 当前已有能力

- Social 故事板包含 `cover`、`concept`、`feature`、`steps`、`data`、`compare`、`evidence`、`timeline`、`risk`、`ending` 等角色。
- 模板注册表为每个角色声明 `supportedBlocks`、`maxBlocks` 和 `maxItems`。
- 生成前会把模板能力摘要注入故事板提示词。
- `budgetCardPlan` 会执行内容块和列表条目预算裁剪。
- 模板渲染后会运行真实浏览器布局审计。
- 现有布局循环已经支持安全构图、舒展密度和 AI 文字修复。
- 单页接口已经支持 `expand` 和 `compress`，并会保留页面角色和事实边界。

### 2.2 当前缺口

#### 缺口 A：模板容量只有结构预算

当前模板注册表可以表达“最多几个内容块、几个条目”，但不能表达：

- 每个内容块最多几行；
- 列表项平均允许几行；
- 页面正文区的可用高度；
- 模板 padding、border、shadow、gap 的占用；
- 主题 Token 改变后字体和间距对容量的影响；
- 哪些内容块或列表可以拆分。

#### 缺口 B：预算裁剪没有语义重排

当前全局预算会从列表尾部截断超出条目，但不会：

- 将列表拆成两页；
- 生成续页并保持角色关系；
- 移动完整原子内容块；
- 重新分配后续页面；
- 记录被移动内容的来源和页面关系。

#### 缺口 C：布局修复提示词过于受限

当前布局修复只允许修改现有文字，禁止拆页、移动内容块、增删列表成员和改变页面结构。对于真实的 `overflow` / `clipped`，这会导致多轮修复没有可行路径。

#### 缺口 D：门禁反馈太晚

只有 HTML 生成后浏览器审计才会发现真实容量问题。故事板和模板之间没有“预检—重排—再渲染”的中间闭环。

## 3. 目标架构

### 3.1 职责边界

| 对象 | 负责内容 | 不负责内容 |
|---|---|---|
| 事实基座 | 已核验事实、限制、来源和时间 | 页面排版 |
| 语义故事板 | 页面目标、页面顺序、事实点、内容块和拆分边界 | CSS、像素坐标 |
| 主题 | 颜色、字体、视觉 token、装饰强度 | 决定页面事实 |
| 模板包 | 页面角色结构、内容块组合、容量 profile、拆页策略 | 编造内容 |
| AI | 语义编排、拆页建议、局部改写 | 绕过事实和布局门禁 |
| 程序编排器 | 容量预检、结构校验、事实保留、页面编号 | 语义判断的最终替代 |
| 浏览器门禁 | 真实尺寸、溢出、裁切、字号和可见性 | 生成内容 |

### 3.2 双向联动，而非模板硬套

故事板生成前接收模板能力，渲染后又接收浏览器审计结果：

```text
模板 / 主题能力
      ↓
故事板生成
      ↓
容量预检与结构编排
      ↓
HTML 渲染
      ↓
浏览器审计
      ├─ 轻微密度问题 → 缩写 / 扩写
      └─ 真实溢出问题 → 调整内容计划 / 拆页
```

### 3.3 主题与模板的关系

主题和模板仍然是两个概念，但容量必须在二者合并后解析：

```text
theme tokens + template pack + role + channel
                         ↓
              resolved capacity profile
```

原因是同一个模板在不同主题下可能使用不同的字体、字号、边框、内边距和阴影，实际容量并不完全相同。

## 4. 模板容量契约

### 4.1 结构预算与视觉预算分离

模板角色能力从当前结构预算扩展为两层：

```json
{
  "role": "feature",
  "template": "feature-grid",
  "supportedBlocks": ["text", "list", "note", "code"],
  "structural": {
    "maxBlocks": 3,
    "maxItems": 7
  },
  "visual": {
    "bodyHeightPx": 460,
    "minBodyUtilization": 0.50,
    "maxBodyUtilization": 0.94,
    "minBodyFontPx": 11,
    "maxTitleLines": 3,
    "maxListItemLines": 2
  },
  "split": {
    "allowed": true,
    "blockTypes": ["list", "steps", "timeline", "compare"],
    "preserveTitle": true,
    "continuationRole": "feature"
  }
}
```

`visual` 是预检预算，不是最终通过标准；最终仍以浏览器实测为准。

### 4.2 容量 profile 的来源

容量 profile 不由 AI 自由填写，来源按优先级处理：

1. 模板注册表中的结构上限和拆分规则；
2. 主题 Token 编译后的字号、行高、padding、border、gap；
3. 固定样稿在 375×667 浏览器中的校准结果；
4. 真实生成指标对 profile 的回测调整。

AI 只能读取 profile，不能覆盖 profile。

### 4.3 模板能力版本化

容量变化必须导致模板能力版本变化，或者至少更新能力 hash：

```json
{
  "templatePack": "brutalist-v1",
  "templateVersion": 1,
  "capacityProfileVersion": 2,
  "capacityHash": "sha256:..."
}
```

故事板快照必须记录该信息。模板容量变化后，旧故事板不能静默按新容量渲染；应进入重新编排或兼容检查流程。

## 5. 故事板合同扩展

### 5.1 保持旧故事板兼容

不要求历史故事板迁移。读取旧页面时，程序按以下规则补齐默认值：

- 没有 `atomic_blocks`：将现有内容块视为不可跨块拆分；
- 没有 `split_policy`：列表、步骤、时间线默认允许按完整成员拆分；代码块和说明块按完整语义单元拆分，指标卡和 CTA 默认不可拆分；
- 没有 `density_hint`：根据模板 profile 推导；
- 没有 `page_group_id`：使用当前页编号生成稳定组 ID。

### 5.2 新增受控字段

```json
{
  "page": 3,
  "kind": "capability",
  "role": "feature",
  "page_group_id": "feature-core",
  "continuation_index": 1,
  "density_hint": "dense",
  "must_keep": [
    "编辑与排版能力",
    "评论与反馈能力"
  ],
  "split_policy": {
    "allowed": true,
    "unit": "list-item",
    "preserveBlockTitle": true,
    "maxContinuationPages": 2
  },
  "content_blocks": []
}
```

字段限制：

- `page_group_id` 只能由程序生成或校验；
- `continuation_index` 由程序重新编号；
- `must_keep` 必须能映射到事实或故事板证据；
- `split_policy` 只能使用枚举值；
- AI 不得通过这些字段改变事实边界、模板 ID 或页面尺寸。

## 6. 新的生成与修复流程

### 阶段 1：解析主题与模板

1. 用户选择 Social 主题。
2. 程序解析主题绑定的模板包、版本和角色能力。
3. 生成 `storyboard_theme_snapshot`。
4. 如果当前故事板模板快照不兼容，阻断直接渲染，提示重新编排故事板。

### 阶段 2：生成模板感知故事板

故事板提示词继续由 AI 生成，但新增：

- 当前模板角色能力；
- 结构预算和视觉预算；
- 可拆分内容块类型；
- 必须保留的事实和页面目标；
- 页面密度提示。

AI 仍然只输出语义故事板，不输出 HTML、CSS、像素坐标或任意样式。

### 阶段 3：确定性容量预检

新增 `compileTemplateAwareCardPlan()`，执行：

1. 校验页面角色和内容块；
2. 解析模板容量 profile；
3. 估算标题行数、正文行数、列表项行数和块间距；
4. 标记 `underfilled`、`near_capacity`、`over_capacity`；
5. 对明确可拆分的内容执行确定性拆页；
6. 对语义分组不明确的页面生成结构修复任务；
7. 重新编号页面和 continuation 页面；
8. 保证封面、结尾和页面职责完整。

确定性拆页的优先级：

1. 长列表按完整条目拆分；
2. 步骤组按完整步骤拆分；
3. 时间线按完整节点拆分；
4. 对比表按完整行拆分；
5. 普通文本块只有在存在明确段落或句子边界时才拆分；
6. 代码块和说明块按完整命令组、段落或句子拆分；指标卡、CTA 和事实边界卡仍默认不拆分。

### 阶段 4：模板渲染与浏览器审计

使用现有 renderer 生成 HTML，然后运行真实浏览器布局审计。

门禁问题分成两类：

#### 轻量密度问题

- `underfilled`；
- 没有裁切的轻微 `overfilled`；
- 垂直留白不均但没有实际溢出。

处理方式：

- AI 扩写已有事实支持的内容；
- AI 缩写重复表达；
- 调整密度档位；
- 合并相邻同主题页面。

#### 结构性问题

- `overflow`；
- `clipped`；
- `horizontal_overflow`；
- 正文过小；
- 页面主体结构异常。

处理方式：

- 先执行确定性拆页或结构重排；
- 必要时调用 AI 生成结构修复建议；
- 程序验证后重新生成 HTML；
- 最后才允许一次文字缩写微调。

### 阶段 5：最终门禁

以下条件继续硬失败：

- 页面实际溢出；
- 页面裁切；
- 横向溢出；
- 正文字号小于 11px；
- 页面缺少有效内容主体；
- 非法 HTML/CSS 或不受支持的内容块。

本方案不通过缩放、隐藏溢出、空白卡、`space-between` 或继续压缩字号来绕过门禁。

## 7. 结构修复协议

### 7.1 新增 `restructure` 操作

现有 `expand` 和 `compress` 保留，新增结构修复模式：

```json
{
  "mode": "restructure",
  "operations": [
    {
      "op": "split_page",
      "page": 3,
      "groups": [
        { "block": 0, "items": [0, 1, 2, 3] },
        { "block": 1, "items": [0, 1, 2, 3, 4] }
      ],
      "reason": "当前模板正文区无法承载两个列表的完整内容"
    }
  ]
}
```

AI 不直接返回最终 HTML，也不能自由改写整份故事板。它只能返回受控操作，程序再执行和校验。

### 7.2 程序校验规则

结构修复必须通过：

- 事实来源未丢失；
- `must_keep` 内容仍然存在；
- 页面角色合法；
- 内容块类型受模板支持；
- 每页不超过模板容量 profile；
- 不可拆分原子块未被拆开；
- 页面数量不超过配置上限；
- 结尾页仍然位于最后；
- 页面组和续页索引连续；
- 页面标题、证据和 disclosure 保持事实边界。

### 7.3 无效修复停止规则

满足任一条件时停止重复调用：

- 新旧故事板 hash 相同；
- 同一页面连续两轮问题集合不变；
- 利用率改善小于校准阈值；
- AI 返回的结构操作连续两次被程序拒绝；
- 达到一次结构修复 + 一次文字微调的上限。

失败结果应返回具体页面、问题类型和建议动作，不再重复等待五轮无效文字修复。

## 8. API 与交互改造

### 8.1 单页 AI 接口

现有：

```text
POST /api/candidates/:id/card-pages/:page/ai
mode: expand | compress
```

扩展为：

```text
mode: expand | compress | restructure
```

`restructure` 需要额外携带：

- 当前模板能力 profile；
- 当前页面布局报告；
- 当前页面组信息；
- 可拆分内容块和原子块；
- 完整事实边界。

成功后只更新故事板，不直接覆盖既有 HTML/PNG。用户确认后再执行整组图文渲染。

### 8.2 编辑器按钮

根据布局问题显示不同操作：

- 内容不足：`AI 扩写本页`；
- 轻微过满：`AI 缩写本页`；
- 溢出或裁切：`调整故事板 / 拆分本页`；
- 没有布局问题：不显示 AI 改写按钮，避免无意义操作。

结构修复完成后，页面显示新增续页及其来源关系，用户可以逐页确认。

### 8.3 生成过程提示

生成进度增加：

- `模板容量预检`；
- `正在重排 P3`；
- `已生成 P3 续页`；
- `浏览器审计`；
- `AI 文字微调`。

这样用户可以区分“正在模型生成”与“程序布局校验”。

## 9. 代码改造清单

### 9.1 新增模块

```text
lib/rendering/social-card-capacity.mjs
lib/rendering/social-card-reflow.mjs
lib/rendering/social-card-repair-policy.mjs
lib/rendering/social-card-plan-contract.mjs
```

职责：

- `social-card-capacity`：解析主题 + 模板后的容量 profile；
- `social-card-reflow`：确定性拆页、重排、续页编号和页面组管理；
- `social-card-repair-policy`：根据审计问题选择扩写、缩写或结构修复；
- `social-card-plan-contract`：新旧故事板字段补齐、结构操作校验和事实保留检查。

### 9.2 修改模块

```text
lib/rendering/social-card-template-registry.mjs
lib/rendering/social-card-template-resolver.mjs
lib/rendering/social-card-plan.mjs
lib/llm/social-card-pipeline.mjs
lib/http/routes/social-card-routes.mjs
public/src/views/social-editor.js
public/styles.css
```

### 9.3 不修改模块

```text
文章主题 schema、编辑器、渲染器和发布门禁
封面主题 schema、编辑器、渲染器和发布门禁
历史已发布 Social 图文产物
```

## 10. 分阶段实施

### 阶段 0：基线和失败样本

目标：固定当前行为，避免改造过程中无法比较。

工作项：

- 固化 Brutalist P3 9 条列表溢出样本；
- 固化列表型仓库、步骤型仓库、代码型仓库、内容不足页样本；
- 保存每个主题的固定样稿、布局报告和模板指标；
- 记录当前 `maxBlocks`、`maxItems` 与真实通过率的差异；
- 增加结构修复失败和无效重试的测试夹具。

验收：样本可重复触发原问题，文章/封面回归测试保持通过。

### 阶段 1：模板容量 profile

目标：让模板声明从“数量预算”扩展为“结构 + 视觉 + 拆分能力”。

工作项：

- 为五个现有模板包补齐 role-level capacity profile；
- 读取主题 Token 后计算 resolved profile；
- 编写固定样稿校准脚本；
- 把容量 profile 写入模板快照和 `card-plan.json`；
- 只新增校验和记录，不改变生成行为。

验收：容量 profile 可被后续预检阶段读取；旧故事板仍可读取。本阶段不提前改变渲染结果。

#### 阶段 1 实施结果（2026-08-21）

- 五个现有模板包的十个页面角色均增加阶段 1 容量基线，包含结构预算、估算正文高度、标题行数、正文字符量、列表项行数、密度区间和可拆分内容块类型；
- 新增 `lib/rendering/social-card-capacity.mjs`，将模板包与当前主题 Token 合并为 resolved capacity profile；主题的字号、行高、外层留白、边框和阴影会影响记录中的估算容量；
- `getSocialCardTemplateCapabilities()` 返回 `capacityProfileVersion`、`capacityProfile` 以及逐角色容量信息；现有渲染、预算裁剪和布局修复行为保持不变；
- 故事板主题快照升级为 `schemaVersion: 2`，记录 `capacityProfileVersion`、`capacityHash` 和完整 resolved profile；旧快照仍按历史兼容逻辑读取；
- Social 图文产物的 `social-theme-snapshot.json` 和 `card-plan.json` 记录模板容量 profile，便于后续阶段执行预检和重排；
- 新增阶段 1 专项测试 4 项，覆盖五套模板角色覆盖、主题 Token 合并、野兽派与清爽模板容量差异及快照 hash；专项、相关模板回归和全量测试共 1175 项通过；
- 阶段 1 只完成“声明与记录”，尚未启用自动拆页、结构重排或新的 `restructure` API；这些能力留到阶段 2/3。

### 阶段 2：确定性容量预检与拆页

目标：在 HTML 渲染前解决明显结构超限。

工作项：

- 新增 `compileTemplateAwareCardPlan()`；
- 支持列表、步骤、时间线和对比表的原子拆分；
- 生成续页、页面组和连续编号；
- 封面、结尾和 disclosure 保持稳定；
- 生产图文链路改为调用模板感知编排器，不再在渲染前用旧预算器从列表尾部静默截断事实；原有 `budgetCardPlan` 继续保留为历史兼容 API。

验收：Brutalist P3 自动拆成两个功能页，完整事实保留，最终页面不裁切。

#### 阶段 2 实施结果（2026-08-21）

- 新增 `lib/rendering/social-card-reflow.mjs`，实现 `compileTemplateAwareCardPlan()` 和确定性页面体量预检；预检合并模板角色容量与主题 Token 结果，估算标题、内容块、列表/结构化条目的占用高度。
- Social 生产链路在模板渲染前执行预检：列表、步骤、时间线、场景和对比表按完整成员拆分；普通文本、说明块和代码块按明确段落、句子或命令组拆分；指标卡和 CTA 等不可拆原子块不会被静默切掉。
- 续页会保留原页面角色、事实、内容块标题和模板上下文，写入 `page_group_id`、`continuation_of`、`continuation_index`，并为续页标题追加“（续）”标记；封面和结尾页顺序保持稳定。
- 生成目录新增 `card-plan-original.json`（原始故事板）和 `card-plan-reflow.json`（预检、操作、警告与未解决项），最终 `card-plan.json` 同时记录模板容量和重排摘要，便于审计与回滚。
- 预检超过页面上限时只记录警告，不删除事实，交由阶段 3 的结构修复/人工确认处理；当前阶段不引入 AI `restructure` 调用，也不改变最终浏览器硬门禁。
- 新增阶段 2 专项测试 4 项，覆盖长列表拆页、步骤/时间线/对比表结构保留、无超限原样通过和页数上限警告；连同预算、模板与 Social 回归测试共 60 项通过。

### 阶段 3：结构修复闭环

目标：让浏览器审计可以反向驱动内容计划。

工作项：

- 将布局问题分为轻量密度问题和结构性问题；
- 为 `social-card-pipeline` 增加结构修复阶段；
- 为 AI 增加 `restructure` 受控协议；
- 加入事实、原子块、模板能力和页面组校验；
- 增加无效修复停止规则；
- 保留最终硬门禁，不增加模板级静默回退。

验收：同一份 P3 样本不再执行五轮无效文字修复；结构修复失败能够明确返回原因。

#### 阶段 3 实施结果（2026-08-21）

- 新增 `lib/rendering/social-card-repair-policy.mjs`，统一识别结构性问题（溢出、裁切、横向溢出、字号过小和页面骨架异常）与轻量密度问题。
- 浏览器审计发现结构性问题后，先以更保守的容量 profile 执行一次确定性重排；仍未解决时才调用一次受控 AI `split_page` 协议，禁止模型返回完整故事板、HTML 或 CSS。
- 程序会校验拆页操作的页面角色、可拆内容块、条目索引完整性、重复/漏项、页面上限以及封面/结尾页稳定性；失败或无变化时立即停止，不再继续无效文字修复。
- 生成管线记录结构重排次数和 `reflow.history`，并把结构修复操作写入 `card-plan.json`；结构性问题不会再进入原有的纯扩写/缩写循环。
- 单页故事板接口新增 `mode: restructure`，前端在 `overflow`、`clipped`、`horizontal_overflow` 等问题上显示“调整故事板 / 拆分本页”，正常或轻量密度问题继续使用扩写/缩写。
- 模板指标允许记录 `editMode: restructure`，便于区分结构修复和文字微调。
- 新增阶段 3 专项测试，覆盖问题分类、受控拆页、事实完整性、不可拆块拒绝和无效操作停止；阶段 2/3 相关回归共 81 项通过。

### 阶段 4：单页接口与编辑器

目标：让用户可以在失败页上选择正确的修复动作。

工作项：

- 扩展单页 AI 接口的 `restructure` 模式；
- 根据布局报告显示拆页或缩写按钮；
- 展示续页关系和变更预览；
- 统一处理请求中状态、超时和错误提示；
- 单页故事板确认后才允许重新生成整组 HTML/PNG。

验收：用户能在 P3 上看到“调整故事板 / 拆分本页”，而不是只能看到“缩写本页”。

#### 阶段 4 实施结果（2026-08-21）

- 单页 `restructure` 接口返回结构变更预览、受影响页面和 `renderState`，明确标记 HTML/PNG 尚未更新；扩写/缩写接口也统一返回待整组重渲染状态。
- 编辑器展示页面组与续页关系（如“P3 续页 2/2”），拆页后清空旧布局报告，避免把原页面的审计结果错配到新页面。
- 编辑器增加“原页数 → 当前页数”、新增续页标题和拆页操作摘要；预览只包含结构元数据，不泄露或重复展示事实正文。
- 单页 AI 请求统一使用 180 秒超时、进行中状态和失败恢复提示；超时或错误不会覆盖当前故事板。
- 故事板更新后，生成按钮变为“重新生成整组图文”，并明确提示需确认故事板后才会更新 HTML/PNG；单页接口本身不直接写入交付物。
- 新增阶段 4 预览单测 2 项；阶段 4 相关专项测试与既有全量回归均通过。

### 阶段 5：容量校准和批次推广

目标：将 profile 从经验值调整为真实数据驱动。

工作项：

- 按模板、主题、页面角色统计通过率和溢出率；
- 统计结构修复成功率、文字修复成功率、平均新增页数；
- 优先校准 Brutalist、Editorial 等高装饰主题；
- 再推广到 Clean、Neon 和用户自定义模板提案；
- 仅在反复出现新的结构原语缺口时，进入 renderer 扩展评估。

#### 阶段 5 实施结果（2026-08-21）

- `social_template_metrics` 增加主题、页面角色、结构重排、文字修复、续页数量和硬门禁字段；旧数据库通过幂等迁移补齐，历史记录仍可读取。
- 新增 `aggregateSocialTemplateMetricsByDimension()` 与 `buildSocialTemplateCalibrationReport()`，按“模板包 × 主题 × 页面角色”输出通过率、过空率、溢出率、结构修复成功率、续页数量和容量调整建议。
- 新增只读接口 `GET /api/social/template-metrics`，支持按模板包、主题和页面角色筛选；容量问题只建议调整 profile，不会自动改 renderer。
- 当前工作区已有 18 次 Social 生成样本：总体 108 个页面，布局通过率 66.7%，溢出率 13.0%，结构重排成功率 100%。其中 Brutalist 历史样本溢出率约 19.7%，建议优先收紧 feature 角色容量； Neon 样本未发现溢出；Editorial 暂无足够真实样本，标记为继续采样。
- 校准报告默认不会建议 renderer 扩展；只有出现“程序已验证、现有结构原语仍无法承载”的证据时才进入 renderer 评估。
- 新增阶段 5 专项测试 2 项，覆盖维度聚合、容量方向建议、旧库迁移字段和主题筛选。

## 11. 指标与验收标准

### 11.1 运行指标

新增或扩展以下指标：

- `preflight_over_capacity_rate`：预检发现超容量的页面比例；
- `structural_reflow_rate`：触发结构重排的页面比例；
- `structural_reflow_success_rate`：重排后通过布局门禁的比例；
- `text_repair_rate`：仅通过缩写/扩写修复的比例；
- `hard_gate_failure_rate`：最终硬门禁失败率；
- `pages_added_per_run`：每次运行新增续页数；
- `no_op_repair_rate`：无效重复修复比例；
- `facts_preserved_rate`：结构修复后的事实保留率。

### 11.2 功能验收

- 模板容量 profile 在故事板生成前可被读取；
- 超出模板容量的列表可以在渲染前拆页；
- P3 Brutalist 样本不再依赖文字压缩解决；
- 结构修复不会丢失 `must_keep` 事实；
- 结构修复不会产生非法页面角色或模板不支持的内容块；
- 最终仍禁止裁切、隐藏溢出、缩放和小字号规避；
- 内容不足页仍可通过 AI 扩写或页面合并处理；
- 无问题页面不再出现无意义的 AI 改写按钮；
- 历史故事板可以继续渲染；
- 文章主题和封面主题行为不变。

### 11.3 质量目标

在连续三批真实 Social 图文中：

- 结构性溢出在 HTML 渲染前被识别的比例不低于 80%；
- 已识别的结构性溢出经一次结构重排后的通过率不低于 80%；
- 因“只能文字修复”导致的重复失败降至 0；
- 事实丢失率为 0；
- 正文小于 11px 的情况为 0；
- 模板级静默回退为 0。

## 12. 风险与回滚

### 风险

- 拆页可能使总页数增加，影响用户预期；
- AI 结构修复可能提出无法验证的分组；
- 容量预估可能与真实字体渲染存在偏差；
- 旧故事板缺少拆分元数据；
- 结构修复会增加模型调用和生成时间。

### 控制措施

- 页面数量设置上限，超过上限转人工确认；
- 所有 AI 结构操作必须经过程序验证；
- 浏览器审计仍是最终标准；
- 旧故事板使用确定性默认拆分策略；
- 结构修复最多一次，文字微调最多一次；
- 每次重排写入 `reflow_history`，便于审计和回滚；
- 单页接口不直接覆盖 HTML/PNG。

### 回滚策略

- 保留原始 `card-plan.json` 和重排后的 `card-plan.reflowed.json`；
- 预检和重排通过 feature flag 控制；
- 关闭 feature flag 后恢复原有故事板到模板渲染路径；
- 不删除历史产物和旧模板版本；
- 文章、封面和已发布 Social 产物不受回滚影响。

## 13. 最小可行版本

如果需要控制改造规模，建议先实施以下 MVP：

1. 为 Brutalist feature 页增加真实容量 profile；
2. 在渲染前识别列表超限；
3. 对列表执行确定性拆页；
4. 修改布局修复循环：`overflow/clipped` 不再进入纯文字修复；
5. 保留 `expand/compress` 处理轻微密度问题；
6. 增加 P3 回归测试和结构重排指标。

MVP 不需要马上改完整故事板合同，也不需要让 AI 生成 HTML。先验证“模板容量预检 + 程序拆页 + 浏览器门禁”能否解决当前失败，再逐步加入 AI 结构修复和编辑器交互。
