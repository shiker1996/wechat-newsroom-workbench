# 主题视觉增强逐主题审查

日期：2026-08-02
关联：[主题视觉 UX 审查](./theme-ux.md)（审查对象），截图与数据见 [review/](./theme-ux/review/)（由 `scripts/render-theme-review.mjs` 生成，含逐页 PNG、正式样稿 HTML、密度审计 JSON 与配方分配表）。

## 审查方法

- 对 14 个内置图文主题逐一编译正式固定样稿（封面 + 3 内容页 + 结尾页），真实 Chromium `375×667` 逐页截图；
- 对 6 个内置文章主题渲染正式样稿长图；
- 用 `layout-audit.mjs` 收集每页利用率与溢出指标；
- 对照工作区当前实现（`coverTitle`、`skeleton`、`coverSupport`、`rhythm`、组件属性）逐主题核对。

## 结论速览

封面层的视觉差异确实建立了：四种 `coverTitle` 配方加 `coverSupport` 承载物让封面有了可感知的分组辨识度。但内容页仍是"换肤"——`skeleton` 只在封面生效，14 套主题的内容页结构完全一致，密度审计数据可以直接证明这一点。另发现 2 个文章主题的对比度缺陷和 2 个图文主题的封面欠填充回归。

## 有效的部分

- **封面辨识度分组成立**：霓虹终端/复古终端/东京之夜（highlight-block 色带标题 + 底部指标锚点）、野兽派/赤焰硬核/落日橙界（poster 海报大字 + 底部结论卡）、月白清灰/摩卡原木/纸艺暖调（editorial 杂志刊头）、冰川冷调等（classic 左侧强调线）四组在缩略尺寸下即可区分。证据：`social-neon-p1-cover.png`、`social-brutalist-p1-cover.png`、`social-bone-white-p1-cover.png`。
- **封面下半屏空白显著改善**：stacked/impact-band/terminal-rail 骨架的封面承载物（导语、结论卡、指标）均锚定到底部，利用率约 79.7%，不再出现 theme-ux.md 中"封面下半部大面积空白"的普遍现象。
- **文章节奏档可感知**：暖纸杂志（airy）与黑白快讯（dense）的段落间距、章节间距差异明显，不再只是颜色和标题差异。证据：`article-magazine-warm.png` vs `article-news-digest.png`。
- **无溢出回归**：14×5 页密度审计全部无 `overflow`/`clipped`/`horizontal_overflow`。

## 发现的问题

### P0：`skeleton` 只作用于封面，内容页构图差异没有发生

证据：`lib/llm/social-card-pipeline.mjs:483` 仅在 `pageKind==='cover'` 时输出 `skeleton-*` 类名；密度审计中 12/14 个主题的 p2–p5 利用率完全相同（76.1% / 44.7% / 35.4% / 10.4%），逐页截图确认内容页都是同一个单栏 `page-content-stack`。

影响：theme-ux.md 的 P1 建议"页面骨架配方让主题差异从换肤升级为构图差异"只完成了一半；用户在内容页（图集的主体）看到的仍然是同一模板换色。

建议：二选一——
a. 把 `skeleton-*` 类名应用到所有页型，并为 editorial-split/terminal-rail/impact-band 补齐内容页构图规则（双栏、信息轨道、强色块分区），受密度预算约束；
b. 或把配方明确定义为"封面构图"，另设内容页构图配方。方案 a 更贴近原审计意图。

### P1：editorial-split 封面欠填充回归

证据：`social-bone-white-p1-cover.png`、`social-solarized-p1-cover.png`；利用率 35.3% / 34.4%（其余主题封面约 79.7%）。editorial-split 的跨栏 grid 用在封面上没有收益（封面只有眉题/标题/导语三个纵向元素），反而把内容全部压到上半屏，下半屏空。

建议：editorial-split 封面改用底部锚定的承载物，或封面回退 stacked 构图、仅在内容页使用双栏（与 P0 的修复一起做）。

### P1：同骨架组内辨识度仍只靠颜色

证据：neon / retro-terminal / tokyo-night 三张封面（`social-*-p1-cover.png`）构图完全一致（highlight-block 色带 + `01` 指标锚点），仅配色不同；retro-terminal 与 neon 在缩略尺寸下几乎无法区分。classic 组（ice-blue / lavender / peach / mocha）同样构图完全一致。

影响：主题数量感仍在，但"每套主题是独立设计"的记忆点不足——这正是当初审计担心的"换肤"问题的组内残留。

建议：同骨架组内至少用 `coverSupport` 类型（lead/statement/metric）和眉题配方做出第二层差异；或给 terminal 组的内容页配方（`code: terminal-panel` 已有）再拉开列表/提示卡差异。

### P1：两个文章主题存在对比度缺陷

证据：`article-research-report.png` 代码块为浅灰字浅灰底，正文 inline code 呈空白框不可读；`article-tech-wire.png` 表头深底深字、正文 inline code 深底深字，均接近不可读（见 review 目录原图局部）。

影响：这两个内置主题是已发布状态，说明发布门禁的组件实际表面对比度检查没有覆盖文章 inline code 与这两个配方组合。

建议：修复 `code`/`table` 配方在这两个主题下的前景色取值；把文章 inline code 与 `dark-header` 表头组合纳入发布门禁的对比度用例，内置主题回归时强制通过。

### P2：骨架/节奏分配硬编码在编译器里，主题 JSON 没有显式字段

证据：`lib/themes/social-theme-compiler.mjs:29` 的 `derivedSkeleton` 按主题 id 匹配，`lib/themes/article-theme-compiler.mjs:17` 的 `derivedRhythm` 同理；14 个图文 JSON 只新增了 `coverTitle`，均未显式声明 `skeleton`/`coverSupport`。

影响：分配思路只存在于代码注释外的映射表里；AI 创建的新主题、用户复制主题、主题改名后都会静默落回默认值。

建议：把当前映射落成各主题 JSON 里的显式 `skeleton`/`coverSupport`/`rhythm` 字段（编译器默认值保留给历史用户主题），并让 AI 创建提示按视觉语言选择骨架而不是碰默认值。

### P2：固定样稿 p3–p5 普遍欠填充

证据：全部主题步骤页约 45%、对比页约 36%、结尾页约 10–12% 利用率（结尾页阈值下限 20%，11% 左右仍触发 `underfilled`）。

影响：这主要反映样稿内容单薄而非主题缺陷，但削弱了"正式样稿证明主题表现力"的作用——结尾页尤其无法展示配方差异。

建议：为步骤页/对比页样稿补充 1–2 个内容块；结尾页样稿增加品牌区或行动提示文案，让各主题的 `ending` 配方有承载物可展示。

## 配方分配表现状

机器可读版本见 [review/assignments.json](./theme-ux/review/assignments.json)。

### 图文（编译器解析后实际生效值）

| 主题 | skeleton | coverSupport | coverTitle |
|---|---|---|---|
| 月白清灰 bone-white | editorial-split | lead | editorial |
| 野兽派 brutalist | impact-band | statement | poster |
| 极简炭黑 charcoal | impact-band | statement | classic |
| 赤焰硬核 crimson | impact-band | statement | poster |
| 冰川冷调 ice-blue | stacked（默认） | lead（默认） | classic |
| 芋泥暮色 lavender | stacked（默认） | lead（默认） | classic |
| 摩卡原木 mocha | stacked（默认） | lead（默认） | editorial |
| 霓虹终端 neon | terminal-rail | metric | highlight-block |
| 落日橙界 orange | impact-band | statement | poster |
| 纸艺暖调 paper-craft | paper-offset | lead | editorial |
| 雾桃白桃 peach | stacked（默认） | lead（默认） | classic |
| 复古终端 retro-terminal | terminal-rail | metric | highlight-block |
| 暖阳阅读 solarized | editorial-split | lead | editorial |
| 东京之夜 tokyo-night | terminal-rail | metric | highlight-block |

### 文章

| 主题 | rhythm |
|---|---|
| 暖纸杂志 magazine-warm | airy |
| 职场随笔 career-essay | airy |
| 研究报告 research-report | standard（默认） |
| 黑白快讯 news-digest | dense |
| 科技电讯 tech-wire | dense |
| 吃瓜卡片 gossip-card | dense |

## 建议下一步（按优先级）

1. P0：skeleton 应用到全部页型 + 内容页构图规则，同时修复 editorial-split 封面欠填充。
2. P1：修复 research-report / tech-wire 对比度，并把这两类组合纳入发布门禁用例。
3. P1：同骨架组内做第二层差异（coverSupport 类型、眉题、列表配方）。
4. P2：分配字段显式落入主题 JSON；样稿 p3–p5 补充内容。

## 修复结果（2026-08-02，同日实施）

修复后证据见 [review-fixed/](./theme-ux/review-fixed/)（逐页 PNG 与密度审计）。

### P0 已修复：skeleton 全页型生效

- `lib/llm/social-card-pipeline.mjs`：骨架类名不再只输出到封面，而是作用于封面、内容页和结尾页；默认 `stacked` 不输出类名，保持旧主题渲染字节不变。
- `lib/themes/social-theme-compiler.mjs`：editorial-split 双栏构图限定为非封面页（`:not(.page-cover)`），封面回到 layout-poster 的顶部标题 + 底部承载物锚定；数据卡、对比表、代码块在双栏中跨全栏（`.content-block.stats-block` 等，避免窄列挤压换行）。
- 效果：bone-white / solarized 封面利用率从 34–35% 回到 79.7%；editorial-split 内容页呈现真实双栏构图（`social-bone-white-p2-content.png`），p2 利用率 53.1% → 81.4%。
- 已知边界：terminal-rail / impact-band / paper-offset 在内容页仍是轨道边线、硬阴影、微倾斜等轻量构图（受密度门禁约束，暂不做更激进的内容页结构）；对比页、结尾页样稿欠填充是固定样稿内容单薄的既有问题，见上文 P2。

### P1 已修复：文章代码与深色表头对比度

- `lib/llm/typeset-pipeline.mjs`：`codeBackground` 与 `inverseText` 不再盲目配对；代码、代码块、dark-block 引用和 dark-header 表头的文字色在 `inverseText` 与正文色之间确定性选择对比度更高者（复用 `colorContrast`）。
- 效果：research-report 代码块由浅灰字浅灰底修复为深色文字；tech-wire 表头与 inline code 由深底深字修复为 `#E6EDF3`（见 `article-research-report.png`、`article-tech-wire.png`）。
- 对比度正常的主题（如 gossip-card 白字深色面板）渲染不变；发布门禁原有的 `inverseText × codeBackground` 检查保持不变。

### 回归

- 新增 `test/theme-skeleton-contrast.test.mjs`（5 项）：骨架类名全页型、editorial-split 封面排除、浅色/深色代码面板文字色回退、正常主题不受影响。
- 全量 632 项测试通过。

### P1 已修复：同骨架组内第二层差异（2026-08-02 第二轮）

修复后证据见 [review-layer2/](./theme-ux/review-layer2/)（逐页 PNG 与配方分配表）。

- terminal-rail 组：retro-terminal 眉题改 `underline`、列表改 `hard-card`（显式 `components.list.textColorRole=inverseText`，黑字亮绿底保证可读）；tokyo-night 封面承载改 `statement`、眉题改 `stamp`；neon 保持 metric + outlined 作为组内原型。三者封面在缩略尺寸下即可区分（`social-neon-p1-cover.png` / `social-retro-terminal-p1-cover.png` / `social-tokyo-night-p1-cover.png`）。
- impact-band 组：orange 眉题改 `stamp`，与 crimson（`accent` + hard-card）拉开；brutalist、charcoal 原有差异保持。
- editorial-split 组：solarized 封面承载改 `statement`，与 bone-white 的 `lead` 导语形成承载物差异。
- stacked 组：lavender 眉题改 `plain`、peach 眉题改 `underline`，两者此前除配色外完全一致。
- 前置改动：`skeleton`/`coverSupport`/`rhythm` 已从编译器硬编码映射迁移为 14+6 个主题 JSON 的显式字段（编译器仅保留默认值兜底），本轮组内差异直接落在这些显式字段上。
- 回归：全量 638 项测试通过。

### P2 已修复：固定样稿 p3–p5 补充内容（2026-08-02 第二轮）

- `lib/themes/theme-preview.mjs` 的 `SOCIAL_THEME_SPECIMEN`：步骤页补"检查清单"列表与提示块（3 块），对比页补"适用场景"列表与备注块（3 块），结尾页补"行动提示"列表与品牌区（2 块）。
- 效果（layout-audit 实测）：步骤页 45% → 69–81%，对比页 36% → 67–72%，结尾页 10–12% → 34–47%，全部高于 20% 欠填充阈值且无溢出；结尾页配方（accent-fill/hard-fill/dark-fill）终于有了承载物可展示（`social-brutalist-p5-ending.png`）。

### 生产事故核查：2026-08-02-r2xerv 布局审计失败

同一份失败故事板（`social-cards/2026-08-02-r2xerv-c007/card-plan.json`）分别用当前代码与 HEAD 代码渲染审计：

- P3（4 个列表块的内容页）利用率 131.9%，**两个版本完全一致**——故事板密度超出固定画布，属于既有问题，与主题改动无关；
- 封面（3 个内容块 + 31 字标题）HEAD 已溢出（93.8%，目标上限 90%），主题改动把它推高到 112.5%：`coverSupport` 给封面追加导语是主因，`coverTitle` 装饰padding 是次因。

已实施的加固（`lib/llm/social-card-pipeline.mjs`）：封面已有内容块时不再叠加封面承载物；承载文本超过 60 字确定性截断。加固后封面回落到 100.9%（仍溢出，剩余为故事板自身密度问题，HEAD 同样失败）。

结论：主题改动不是这次失败的根因，但确实放大了封面溢出；已加固。真正的根因是故事板/文案密度预算与布局修复循环无法消化超高密度页面（修复循环 5 轮后失败，且禁止改页数），需要单独立项处理。
