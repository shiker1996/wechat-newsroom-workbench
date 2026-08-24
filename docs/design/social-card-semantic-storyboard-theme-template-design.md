# Social-card 语义故事板与主题化模板渲染技术方案

> 状态：设计基线（核心阶段已实施；当前运行顺序以 [Social 图文生成现状与运行链路](./social-card-generation-current-flow.md) 为准）
> 范围：仅图文主题（`social-card`）  
> 日期：2026-08-20

## 1. 背景与结论

当前图文生成已经具备语义故事板、页面角色和智能构图能力，但主题定义主要仍是颜色、字体、间距和 recipe。渲染器为所有主题复用一套通用 HTML 结构，因此主题之间更多是“换皮肤”，页面结构和视觉节奏差异有限。

直接使用自定义 HTML/CSS 的生成结果之所以更有设计感，核心不是文案更长，而是每页都能按照内容目标选择不同的版式语法，例如指标型封面、功能卡片、步骤轨道和结尾 CTA。

本方案在故事板与最终 HTML 之间增加 social 专属的“页面意图解析 + 主题模板”层：

```text
事实与素材
  ↓
语义故事板
  ↓
页面意图解析器
  ↓
Social 模板注册表
  ↓
主题 Token + 角色模板
  ↓
模板化渲染
  ↓
布局审计、截图与降级
```

文章主题和封面主题不进入这条链路，相关 schema、编辑器、渲染器、预览和发布门禁保持不变。

## 2. 当前实现盘点

### 2.1 已有能力

- 故事板已经包含 `cover`、`concept`、`feature`、`steps`、`data`、`compare`、`evidence`、`timeline`、`risk`、`ending` 等页面角色。
- `social-card-composition` 已经存在按角色区分的构图变体，如 `hero-stack`、`feature-ledger`、`sequence-rail`、`metric-board`。
- 主题编译器已经支持颜色、字体、间距、形状、recipe 和部分组件级样式。
- 生成后已有布局审计、截图、密度调整和安全回退。
- 单页扩写/缩写可以在不改变页面结构的情况下修复文本密度。

### 2.2 主要缺口

1. 主题 recipe 主要控制 CSS 外观，不能定义完整页面结构。
2. 构图变体是通用 renderer 的固定分支，主题只是在其上叠加样式。
3. 页面 renderer 负责了过多结构和样式逻辑，模板复用边界不清晰。
4. 主题预览使用固定 social specimen，无法展示每个主题的角色化版式。
5. 布局修复主要修改文字，页面过空或结构不合理时无法切换真正的版式模板。
6. 目前没有稳定记录“本页使用了哪个模板、哪个版本、是否发生降级”。

## 3. 设计目标与非目标

### 3.1 目标

- 让主题同时定义视觉 Token 和允许使用的 social 页面模板。
- 让故事板负责内容语义，模板负责页面结构，渲染器负责安全输出。
- 在不允许模型输出任意 HTML/CSS 的前提下，获得接近定制 HTML 的视觉差异。
- 保持旧主题、旧故事板和旧生成产物可用。
- 让主题预览使用正式生产渲染器，避免预览和实际生成不一致。
- 让布局失败可以在同模板内修复，必要时安全回退到标准模板。

### 3.2 非目标

- 不改文章主题。
- 不改封面主题。
- 不把 social 主题模板开放成任意 CSS/HTML 编辑器。
- 不在第一阶段让 LLM 自由决定 DOM 结构。
- 不一次性重写全部现有 social 主题。

## 4. 核心数据模型

现有 `tokens`、`recipes` 和 `components` 保留，在 `social` 下增加可选模板配置：

```json
{
  "schemaVersion": 2,
  "id": "neon",
  "target": "social",
  "tokens": {},
  "social": {
    "recipes": {},
    "templatePack": {
      "id": "neon-v1",
      "version": 1
    },
    "roleTemplates": {
      "cover": "hero-metrics",
      "concept": "problem-stack",
      "feature": "feature-stack",
      "steps": "steps-rail",
      "data": "metric-board",
      "compare": "comparison-board",
      "evidence": "evidence-ledger",
      "timeline": "timeline-rail",
      "risk": "risk-frame",
      "ending": "closing-cta"
    },
    "fallbackTemplate": "standard-v1"
  }
}
```

设计原则：

- `themeId` 与 `templatePackId` 分离，多个主题可以复用同一模板。
- 模板只定义结构和组件组合，颜色、字体、间距继续由主题 Token 控制。
- 旧主题没有 `templatePack` 时默认使用 `standard-v1`。
- 模板配置只允许枚举值，禁止保存 HTML、CSS 或任意 class。

## 5. 故事板与页面意图

模板不能在故事板生成完成后再“硬套”内容，否则会出现功能点数量超出模板承载范围、结尾语义与模板不匹配等问题。因此，模板能力必须在故事板生成前作为约束注入，同时保留程序侧的兼容性校验。

推荐流程为：

```text
主题 / 模板包选择
  ↓
模板能力摘要注入故事板提示词
  ↓
AI 生成语义故事板
  ↓
程序校验内容块与模板能力
  ↓
程序选择具体页面模板
  ↓
模板化 HTML 渲染
```

故事板负责“这一页讲什么”，模板负责“这些内容如何排列”。模板不能重新决定事实、页面目标或内容语义。

模板注册表只声明能力和范围，而不规定固定内容，例如：

```json
{
  "id": "feature-stack",
  "supports": ["list", "code", "note"],
  "cardRange": [1, 4],
  "density": "medium"
}
```

这里的 `cardRange` 是承载范围，不是要求功能页必须有多少张卡片。卡片数量和内容块类型仍由故事板根据事实和页面目标决定。

第一阶段不修改 LLM 故事板合同。由确定性解析器根据以下输入推导页面模板：

```text
页面 role + content_blocks + 内容密度 + 主题能力
                         ↓
                    layout_intent
```

示例：

```text
feature + list/code       → feature-stack
steps + steps/list        → steps-rail
data + stats/compare      → metric-board
ending + note/list        → closing-cta
```

如果故事板生成阶段确实需要表达版式偏好，第二阶段可增加受控字段：

```json
{
  "layout_intent": "feature-stack"
}
```

该字段必须是枚举值，并且只能表达版式意图，不能影响事实、页面数量、页面尺寸或 HTML 结构。解析失败时仍回退到 `role + content_blocks` 推导逻辑。现有 `composition` 字段继续兼容，旧故事板无需迁移。

职责边界如下：

| 问题 | 负责方 |
|---|---|
| 这一页讲什么 | 故事板 |
| 页面目标和事实点数量 | 故事板 |
| 使用 CTA 还是总结语义 | 故事板 |
| 模板支持哪些内容块 | 模板能力声明 |
| 内容如何排成卡片、轨道或指标板 | 模板 |
| HTML/CSS 如何输出 | 程序渲染器 |

## 6. 渲染层改造

### 6.1 模板注册表

新增 `server/shared/rendering/social-card-template-registry.mjs`，维护：

- 模板 ID、版本和显示名称。
- 支持的页面角色。
- 支持的内容块类型。
- 最小/最大卡片数量和密度预算。
- 必需组件。
- 可用降级模板。

### 6.2 模板解析器

新增 `server/shared/rendering/social-card-template-resolver.mjs`，输入页面、主题、角色、内容块和密度，输出：

```js
{
  templateId: 'feature-stack',
  templatePack: 'neon-v1',
  fallback: false,
  reason: null
}
```

解析优先级：

```text
合法的显式 layout_intent
→ 主题 roleTemplates
→ 角色默认模板
→ standard-v1
```

### 6.3 模板化页面渲染

逐步将 `storyboard-page-renderer` 拆分为：

```text
storyboard-page-renderer
  ├─ page-role-resolver
  ├─ social-card-template-resolver
  ├─ social-template-renderer
  └─ shared-block-renderer
```

模板通过受控组件组合页面，例如：

- `HeroTitle`
- `MetricRow`
- `FeatureCard`
- `StepRail`
- `CompareTable`
- `NoteCard`
- `CodePanel`
- `CTA`

所有文本继续使用现有事实约束、HTML 转义和 disclosure 逻辑。

新模板仍需输出现有基础结构，以兼容截图和布局审计：

```html
<section class="page template-neon-v1"
  data-template-id="feature-stack"
  data-template-version="1"
  data-page-role="feature"
  data-layout-source="theme-role-template">
  <div class="page-inner">
    <header>...</header>
    <main class="page-body">...</main>
    <footer>...</footer>
  </div>
</section>
```

## 7. 主题创建与图文生成交互改造

### 7.1 主题编辑器

social 主题编辑器新增“视觉模板”配置：

1. 模板包选择：标准、霓虹、编辑杂志、粗野主义等。
2. 页面角色映射：封面、功能、步骤、数据、结尾分别选择模板。
3. 高级承载配置：内容密度档位、标题行数上限、装饰强度和模板回退策略等。

普通用户只需要选择模板包，高级映射默认折叠。

模板不应以内部名称直接暴露给普通用户。生成页面仍以“选择主题”为主，主题卡片增加模板能力说明，例如：

```text
霓虹终端
适合：开发者工具、开源项目、代码型内容
版式倾向：指标封面 / 功能卡片 / 步骤轨道
```

不建议第一阶段让用户逐页选择 `feature-stack`、`metric-board` 等内部模板。若后续需要增加控制，优先提供“版式策略”这类高层选项：

```text
稳定通用 / 视觉强化 / 内容密度优先
```

### 7.2 主题预览

现有固定 specimen 保留，但增加角色覆盖页：

```text
封面 / 功能页 / 步骤页 / 数据页 / 对比页 / 结尾页
```

预览必须调用正式生产渲染器，并显示：

```text
模板包：neon-v1
页面模板：feature-stack
是否降级：否
```

### 7.3 主题校验与发布

仅在 `target === 'social'` 时增加：

- 模板包和版本存在性检查。
- role 与模板能力匹配检查。
- 内容块类型支持检查。
- 375×667 溢出、裁切和遮挡检查。
- 实际模板选择器的对比度检查。
- 必需组件覆盖检查。
- 明确的 fallback 目标检查。

文章和封面继续使用当前校验路径。

### 7.4 故事板与主题切换

主题应在故事板生成前确定。若故事板生成后切换主题：

```text
模板能力兼容 → 直接重新渲染
模板能力不兼容 → 选择兼容模板或提示重新生成故事板
```

不能静默删除故事板中的事实点或内容块。

## 8. 历史方案流程（已收敛，非当前运行顺序）

生成流程调整为：

```text
选择主题 / 模板包
→ 注入模板能力约束
→ 生成故事板
→ 校验故事板与模板兼容性
→ 解析页面意图并选择具体模板
→ 模板化 HTML
→ 布局审计
→ 同模板内修复
→ 必要时回退 standard-v1
```

兼容性处理顺序为：

1. 内容块被模板支持：直接渲染。
2. 内容块不被当前变体支持：切换同主题的兼容变体。
3. 同主题没有兼容变体：回退 `standard-v1`。
4. 只有在明确允许的情况下，才进行内容压缩或拆页，不得静默丢失事实。

布局修复分三级：

1. **同模板内修复**：缩短标题、调整卡片间距、减少装饰、切换单列/双列。
2. **同主题内切换兼容模板**：例如 `feature-stack → feature-compact`。
3. **回退标准模板**：新模板无法通过审计时回退 `standard-v1`。

单页 AI 扩写/缩写需要携带当前页面的模板上下文：

```json
{
  "page": 3,
  "role": "feature",
  "templateId": "feature-stack",
  "operation": "expand"
}
```

单页操作只修改内容，不改变页面角色、页面顺序、模板 ID、事实边界和尺寸。扩写后若超出模板能力，按“同模板压缩 → 同主题兼容模板 → `standard-v1`”处理。

## 9. 产物追踪

在 `social-theme-snapshot.json` 和 delivery report 中增加：

```json
{
  "themeId": "neon",
  "themeVersion": "1.2.0",
  "templatePack": "neon-v1",
  "templateVersion": 1,
  "pageTemplates": [
    {
      "page": 1,
      "role": "cover",
      "template": "hero-metrics",
      "fallback": false
    }
  ]
}
```

这样可以复现历史产物，并能定位某一页使用的模板和降级原因。

## 10. 代码改造范围

### 需要改造的 social 相关文件

```text
server/shared/themes/social-theme-compiler.mjs
server/shared/themes/theme-validator.mjs
server/platform/application/themes/theme-preview.mjs
server/platform/application/themes/theme-publish-gate.mjs
server/shared/themes/theme-registry.mjs
server/platform/application/themes/user-theme-service.mjs
server/platform/http/routes/theme-routes.mjs

server/shared/rendering/storyboard-page-renderer.mjs
server/shared/rendering/storyboard-document-renderer.mjs
server/shared/rendering/social-card-composition.mjs
server/shared/rendering/social-card-layout.mjs
server/features/social-cards/application/social-card-pipeline.mjs

public/src/views/theme-manager.js
public/src/views/theme-manager-fields.js
themes/social/*.json
```

### 建议新增

```text
server/shared/rendering/social-card-template-registry.mjs
server/shared/rendering/social-card-template-resolver.mjs
server/shared/rendering/social-template-components.mjs
server/shared/rendering/templates/social/neon-v1.mjs
```

### 明确不改

```text
文章主题 schema、编辑器、渲染器、预览和发布流程
封面主题 schema、编辑器、渲染器、预览和发布流程
```

共享模块中的新逻辑必须使用 `target === 'social'` 进行隔离。

## 11. 分阶段实施

### Phase 0：基线

- 保存现有 social 主题截图和布局报告。
- 统计溢出、过空、拥挤和 fallback 数据。
- 固化文章/封面回归测试基线。
- 盘点各页面 role、content block 与现有 composition 的兼容关系。
- 定义模板能力矩阵、模板版本规则和回退规则。

### Phase 1：模板基础设施与故事板约束接入

- 新增 `social-card-template-registry` 和 `social-card-template-resolver`。
- 引入 `standard-v1`，旧主题和旧故事板默认映射到该兼容包。
- 在生成故事板前，将主题模板能力摘要注入 social 故事板提示词。
- 增加故事板与模板能力的程序侧兼容性校验。
- 保持现有故事板合同兼容，不强制新增 `layout_intent`。
- 在 HTML、主题快照和 `card-plan.json` 中记录模板包、版本和来源。
- 这一阶段尽量不增加用户可见的模板配置，确保旧生成流程平滑迁移。

### Phase 2：落地 `neon-v1` 模板渲染

- 将 v6 风格抽象成受控模板。
- 只对 neon 主题启用新模板。
- 保留 `standard-v1` 安全回退和旧 renderer 兼容路径。
- 将模板选择、HTML 输出、主题 Token 和布局审计串联起来。
- 记录每页的 template id、版本和 fallback 状态。
- 补充页面截图和布局测试。

当前实现补充：

- 这是 Phase 2 的历史基线：当时仅 `neon`/`brutalist` 绑定专用模板，其余 social 主题仍默认 `standard-v1`；后续 Phase 5/6 已按批次完成迁移。
- `server/shared/rendering/templates/social/neon-v1.mjs` 提供封面、问题、功能、步骤、数据、对比、证据、时间线、风险和结尾角色的受控页面组件与 CSS；内容块仍复用白名单渲染器，未开放任意 HTML/CSS。
- `storyboard-document-renderer` 只在 `neon-v1` 路径追加模板 CSS，并在 body、section 上写入模板元数据；文章主题和封面主题未接入该路径。
- 布局审计失败时，生成循环先记录一次模板回退并重新使用 `standard-v1` 渲染；模板包不可用时仍由 resolver 安全回退。
- 固定样稿归档于 `docs/archive/audits/social-card-phase2-2026-08-20/`，6 页真实浏览器审计通过，截图输出在 `neon-v1-png/`。

### Phase 3：生成页面交互、预览和发布门禁

- social 主题 JSON 增加模板配置。
- 主题卡片增加版式倾向和适用场景说明。
- 故事板预览增加页面版式意图标签。
- 生成结果展示模板、版本和降级状态。
- 主题编辑器支持模板包选择，高级角色映射默认折叠。
- 主题切换后执行兼容性检查，不静默删除故事板内容。
- 预览使用正式模板渲染器。
- 发布门禁增加模板能力、视觉和回退检查。

当前实现补充：

- social 主题目录和用户主题详情返回模板包、版本、渲染器、回退目标及角色映射摘要；文章/封面目录不返回 social 模板字段。
- 用户 social 主题编辑器增加模板包选择，模板版本由程序同步，不允许手工输入内部模板 ID；主题配方和 Token 编辑仍保持原有路径。
- 正式 social 预览返回模板状态，并在每个页面写入 `data-template-id`、`data-template-pack`、`data-template-version` 和 `data-template-source`。
- social 发布门禁检查固定样稿是否包含模板包与逐页模板元数据；文章和封面继续使用原有五项门禁。

### Phase 4：单页操作与运营闭环

- 单页扩写/缩写携带当前模板上下文。
- 单页操作保持页面 role、模板 ID、事实边界和尺寸不变。
- 增加模板使用率、通过率、回退率、过空率和溢出率统计。
- 根据真实数据调整模板能力矩阵和密度预算。

当前实现补充：

- 单页扩写/缩写会读取当前 social 主题模板包、渠道、页面 role、模板 ID、内容块/条目上限，并将其作为受保护上下文传给模型；回写时强制保留页面 kind、role、goal、evidence、layout_style、构图和事实边界，其他页面不变。
- 单页接口返回本页模板兼容结果和模板上下文；成功操作写入 `page-regeneration` 指标，整组生成写入 `generation` 指标。
- 新增 `social_template_metrics` 表与 `social-template-metrics.json` 产物，记录请求模板、实际渲染模板、布局通过、模板回退、过空页、溢出页和单页成功率；指标仅挂在 social 图文流程，文章/封面主题使用统计不变。
- social 图文产物接口返回当前运行指标和聚合统计，编辑器交付信息栏展示模板、通过率、过空率和溢出率。

### Phase 5：扩展其他 social 主题

建议顺序：

```text
neon → brutalist → editorial/paper → ice-blue/lavender
```

不建议第一阶段同时重构所有主题。文章主题和封面主题在全部阶段保持现状。

当前实现补充：

- 首个扩展包 `brutalist-v1` 已落地并绑定 `themes/social/brutalist.json`，按 cover、concept、feature、steps、data、compare、evidence、timeline、risk、ending 分配独立角色模板。
- `brutalist-v1` 使用受控硬边框、硬阴影、色块标题和编号页眉，继续复用白名单内容块与统一 375×667 布局审计；失败时回退 `standard-v1`。
- 真实验证基线：候选 `787` 重新生成后，`neon-v1` 请求与实际渲染一致，布局通过率 100%，回退率、过空率和溢出率均为 0；同一份 6 页故事板的 `brutalist-v1` 固定样稿布局通过，未发现溢出或过空页。
- `editorial-v1` 已落地并绑定 `themes/social/paper-craft.json`，使用纸张底色、衬线标题、印刷边线、编辑眉批和来源账页等受控角色模板；失败时回退 `standard-v1`。
- 纸艺模板经过同一份 6 页故事板的真实 375×667 审计，布局通过率 100%，未发现文字过小、溢出、裁切或过空页；辅助字号通过 `data-text-role="auxiliary"` 与正文门禁区分。
- 批次 B 已绑定 `clean-v1`：`ice-blue`、`lavender`、`bone-white`、`solarized` 共用清爽编辑模板包，主题 Token 和配方继续决定各自的色彩与字阶表现。

### Phase 6：分批迁移与主题-故事板交互联动（实施中）

本阶段只处理 social 图文主题迁移和图文编辑交互；文章主题、封面主题、文章生成和封面生成流程保持不变。

#### 6.1 迁移批次

不按主题数量一次性切换，而按视觉语言和模板能力分批推进：

```text
批次 A：neon / brutalist / paper-craft（已完成）
批次 B：ice-blue / lavender / bone-white / solarized（清爽、柔和、编辑类，已完成）
批次 C：retro-terminal / tokyo-night / charcoal / crimson / mocha / orange / peach（终端、暗色、高冲击和轻量卡片类，已完成）
```

每个批次先确定模板家族，再绑定主题，不要求每个主题拥有独立 renderer。一个模板包可以复用多个主题的 Token 和配方，但必须保留主题自己的颜色、字体和表面效果。

每批迁移的固定门禁：

1. 用至少一份真实仓库故事板和一份列表密集型故事板渲染。
2. 检查 375×667 页面无溢出、裁切、遮挡和正文过小。
3. 记录模板通过率、回退率、过空率、溢出率和单页重生成成功率。
4. 只有通过门禁且回退率可接受，才把主题从 `standard-v1` 切换到专用模板包。
5. 失败时保留主题 Token，模板包回退 `standard-v1`，不回退故事板事实内容。

#### 6.2 主题与故事板的状态关系

当前主题选择和故事板生成按钮分散，用户看不出主题变化是否影响故事板。下一阶段将把主题选择纳入故事板阶段，并明确以下状态：

| 状态 | 条件 | 主操作 |
| --- | --- | --- |
| 未生成故事板 | 没有当前 `card_plan` | `生成故事板` |
| 故事板已生成 | 主题和模板上下文未变 | `生成图文` |
| 同模板家族换主题 | 仅 Token/配方变化，模板能力不变 | `重新渲染图文` |
| 跨模板家族换主题 | role 能力、块预算或模板结构变化 | `重新生成故事板并生成图文` |
| 故事板与主题不一致 | `card_plan` 的模板快照不同于当前主题 | 阻止直接生成，先重新校验或生成故事板 |

主题选择器需要展示：

- 当前主题名称、模板包名称和模板版本；
- 当前故事板是否基于该主题模板能力生成；
- 换主题后是“可直接渲染”还是“需要重新生成故事板”；
- 当前模板的回退状态和最近一次布局指标。

#### 6.3 页面交互调整（已完成）

图文编辑页调整为：

```text
事实基座
  ↓
故事板 + 主题选择
  ↓
图文生成与布局审计
  ↓
逐页编辑、扩写/缩写和交付
```

具体调整：

- 主题选择器已放入故事板阶段，并与“重新生成故事板”操作同组展示。
- 生成故事板时保存主题 ID、模板包 ID、模板版本、渠道和能力快照。
- 主题变化后即时计算 `current`、`render-only`、`legacy` 和 `needs-storyboard` 状态，不依赖用户点击生成后才发现不匹配。
- 故事板过期时，图文生成按钮显示阻断原因并禁用，必须先重新生成故事板。
- 同模板家族换主题允许复用故事板；跨模板家族换主题先执行确定性兼容校验，必要时才重新调用故事板模型。
- 重新生成故事板前保留旧故事板，生成失败时可恢复，不覆盖事实基座和用户已编辑的其他页面。

#### 6.4 本阶段不做的事情

- 不把主题 Token、模板 ID 或 HTML/CSS 暴露给故事板模型作为可自由编程字段。
- 不让主题切换改变事实、页面数量和已确认的证据边界。
- 不改文章主题、封面主题和它们的主题选择交互。
- 不因为跨模板家族就强制删除原有内容块；承载不足时由兼容校验和受控回退处理。

#### 6.5 Phase 6 验收标准

- 迁移按批次执行；模板包不可用或尚未绑定时继续稳定使用 `standard-v1` 回退。
- 主题选择器和故事板生成按钮位于同一阶段，状态能解释是否需要重新生成故事板。
- 同模板家族换主题可直接重新渲染；跨模板家族能阻止不安全的直接生成。
- 主题快照、故事板快照和最终模板元数据一致可追溯。
- 真实样稿和列表密集型样稿均通过 375×667 布局审计。
- 文章主题和封面主题回归测试不受影响。

#### 6.6 批次 B 当前实现

- 新增 `clean-v1` 模板包，按 cover、concept、feature、steps、data、compare、evidence、timeline、risk、ending 提供清爽角色模板，失败时回退 `standard-v1`。
- 四个主题均已绑定 `clean-v1`，但保留原有主题 Token、字体和配方，不把四个主题合并为同一套颜色。
- 候选 `787` 的工具型故事板在四个主题下均通过 375×667 审计；候选 `767` 的列表型故事板在启用管线既有的舒展密度调整后，四个主题均通过审计，无溢出、裁切或正文过小。
- 批次 B 的模板注册、主题绑定、社会/文章隔离和逐页元数据已加入回归测试；主题选择与故事板按钮联动仍属于本阶段后续交互实施，不在本批次自动改动。

#### 6.7 批次 C 当前实现

- 终端类 `retro-terminal`、`tokyo-night` 复用 `neon-v1`，保留终端主题自身的黑绿/东京夜色 Token。
- 高冲击类 `charcoal`、`crimson`、`orange` 复用 `brutalist-v1`，保留各自的黑灰、猩红或橙色 Token 与主题配方。
- 轻量卡片类 `mocha`、`peach` 复用 `clean-v1`，保留暖棕或粉彩 Token。
- 七个主题均通过工具型仓库与列表型仓库的 375×667 真实布局审计；本轮 14 个主题样例均无溢出、裁切、正文过小或过空页面。
- 批次 C 只切换主题模板包；主题选择器和故事板按钮联动已在本阶段最后完成。

#### 6.8 模板映射修正（本轮完成）

对全量主题映射做回归检查后，修正了五处由分阶段迁移暴露的问题：

1. `clean-v1` 现在消费主题的 `social.recipes.skeleton`。因此 `bone-white` 与 `solarized` 的 `editorial-split` 不会再被清爽模板的默认单列骨架吞掉；双栏容器保留可测量边界，布局审计也能正确识别。
2. `neon-v1` 的网格、阴影、列表、提示和结尾页颜色全部改为主题 Token。`tokyo-night` 复用模板时不再出现霓虹绿/粉的固定色串。
3. `crimson` 的 `inverseText` 调整为深红页面色，并让 brutalist 模板的品牌行、硬强调列表和强调代码面板使用反白角色，避免浅色文字压在红色/浅色承载面上。
4. 文档渲染顺序调整为“模板 CSS → 主题 CSS”，主题自己的列表、代码、骨架和阴影配方最后生效，模板包只提供结构默认值。
5. `charcoal` 的 `shadow:none` 因主题配方后置而真正生效，不再被 brutalist 模板的硬阴影覆盖。

修正后使用候选 `787` 工具型故事板和候选 `767` 列表型故事板，对 14 个内置主题共 28 份 375×667 样例复跑布局审计，28/28 通过；文章主题、封面主题和交互联动范围不变。

## 12. 验收标准

### 功能

- 旧 social 主题无需迁移即可生成。
- 旧故事板没有 `layout_intent` 时正常工作。
- 新主题可以选择模板包和角色模板。
- 单页扩写/缩写不会破坏模板。

### 视觉

- `stop-pay-bilibili` 使用 neon 模板后，页面结构和视觉节奏接近 v6 结果。
- 封面、功能、步骤、数据和结尾页有明显构图差异。
- 不再所有页面都使用相同的标题加内容堆叠结构。

### 稳定性

- 所有页面仍为 `375×667`。
- 无溢出、裁切、遮挡。
- 新模板失败时能回退 `standard-v1`。
- 文章主题和封面主题测试不受影响。

### 运营指标

持续记录：

```text
模板使用率
模板布局审计通过率
模板回退率
页面过空率
页面溢出率
单页重生成成功率
```

## 13. 最终建议

采用“故事板稳定、模板受控、主题换肤、渲染安全”的方案：

1. 不直接让模型输出任意 HTML/CSS。
2. 保留现有故事板和标准 renderer 作为兼容路径。
3. 已先以 `neon-v1` 验证 v6 视觉结构，再按批次扩展到其余 social 主题。
4. 每批通过布局审计和真实生成数据验证后再切换，主题选择与故事板按钮联动仍作为最后的交互改造。

这样可以吸收定制 HTML 的视觉优势，同时不破坏当前图文生成、主题管理、历史产物和文章/封面主题。

## 14. 实施状态

- Phase 0：已完成，基线报告和能力矩阵见 `docs/design/social-card-phase0-baseline.md`。
- Phase 1：已完成基础设施接入；旧主题和未配置模板包的故事板继续使用 `standard-v1`。
- Phase 2：已完成核心落地；`neon` 主题启用 `neon-v1`，固定样稿通过布局审计并生成截图，模板失败可回退 `standard-v1`。
- Phase 3：已完成 social 主题配置、模板预览元数据、主题选择器倾向展示和发布门禁；图文生成结果页的运营统计与单页模板状态联动留到 Phase 4。
- Phase 4：已完成单页模板上下文约束、模板指标落库/产物留档、social 交付页统计展示和单页成功率回归测试；后续可基于真实数据调整模板能力矩阵与密度预算。
- Phase 5-A：已完成 `brutalist-v1` 模板包和野兽派主题接入，保留标准模板回退；paper/editorial、ice-blue、lavender 扩展待后续真实数据评估。
- Phase 5-B：已完成霓虹/野兽派真实样稿验证，以及 `editorial-v1` 模板包和纸艺暖调主题接入。
- Phase 6-B：已完成批次 B，`ice-blue`、`lavender`、`bone-white`、`solarized` 迁移到 `clean-v1` 并通过真实工具型/列表型故事板审计。
- Phase 6-C（主题迁移部分）：已完成批次 C，七个主题按终端、高冲击、轻量卡片三类复用 `neon-v1`、`brutalist-v1`、`clean-v1`，并通过真实工具型/列表型故事板审计。
- Phase 6-C（交互联动部分）：已完成，主题选择、故事板快照、同模板换肤和跨模板阻断均已接入。
