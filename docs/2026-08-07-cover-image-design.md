# 公众号封面图：设计方案与实施方案

日期：2026-08-07
状态：已实施（2026-08-07）
关联：`docs/2026-08-07-cover-image-and-ai-repo-discovery-plan.md`（P1 事项）

## 需求

以公众号文章标题为主体，生成 900×383（2.35:1）的封面图；风格与账号调性一致；生成结果可预览、可重新生成。一期只出图片，上传公众号素材（`thumb_media_id`）留二期。

## 核心决策（已与用户确认）

1. **AI 非视觉生成**：AI 不画图，只产出"设计参数"（结构化 JSON 规格）；图片由确定性 HTML/CSS + `skills/html-pages-to-images`（puppeteer）渲染。质量可控、可复现、无文生图成本。
2. **组件自由组合**：不给 AI 固定版式三选一，而是提供一套**组件目录**（色块、标签、标题、副标题、信息行、装饰），AI 按文章调性自由组合布局。效果图三个版式（`skills/html-pages-to-images/output/cover-mockup/`）降级为"预置组合示例"，也是校验回退时的兜底构图。
3. **封面主题进主题中心**：封面主题 = 配色 token 组合，注册为 `target: 'cover'`，主题中心可预览（900×383 缩略图）、选择、绑定账号默认。一期只做内置主题；二期开放 AI 生成封面主题（复用 `ai-theme-generator` 的 target 参数化机制，边际成本低，详见"二期"节）。
4. **信息行、副标题保留**（副标题可选）；标签形态后续支持 AI 拓展（枚举可扩）。

## 设计方案

### 元素模型（组件目录）

封面由以下组件构成，视觉权重从高到低：

| 组件 | 说明 | 参数 | 约束 |
|---|---|---|---|
| `canvas` | 背景底色，唯一 | `colorRole: page \| ink`（浅底或深底） | 必选，恰好一个 |
| `color-block` | 几何色块，版式骨架 | `position: left-third \| right-panel \| top-band \| full`，`shape: rect \| arrow`，`colorRole: accent \| ink` | 0~1 个；`full` 时底色即色块 |
| `title` | 主标题，绝对主角 | `lines: string[]`（断行）、`highlights: string[]`（高亮词，换强调色） | 必选；≤2 行、每行 ≤14 字；高亮 ≤2 处；不得压色块边界 |
| `eyebrow` | 标签：栏目名/期号/编号 | `form: text \| badge \| numbering`，`text` | 0~1 个；≤12 字；形态枚举后续可扩 |
| `subtitle` | 一句话副标题 | `text`、`withBar: bool`（左侧强调色竖条） | 可选；≤30 字 |
| `meta` | 信息行：公众号名、日期 | `author`、`date` | 可选；最弱字号，固定底部 |
| `decoration` | 纯几何装饰 | `kind: bar \| dots \| ring`，`position: 九宫格位置` | 0~2 个；不抢标题 |

### 配色纪律

一张封面三种颜色：底色、主文字色、一个强调色（强调色可同时承担色块、标题高亮、badge、装饰）。映射主题 token：

- `tokens.colors.background/page` → 底色
- `tokens.colors.text` → 标题主色
- `tokens.colors.accent` → 色块 / 高亮 / badge / 装饰
- `tokens.colors.accentSecondary` → 次强调（可选）
- `tokens.colors.muted` → 副标题、信息行
- `tokens.colors.inverseText` → 深色块上的文字

字族用主题 `tokens.typography.family/headingFamily`；渲染前过对比度校验（标题 vs 所在区域底色 ≥ 4.5，不足时按 `ai-theme-generator.mjs` 的 `bestContrast` 思路自动修正）。

### AI 分工

- **确定性（主题+渲染层）**：配色、字族、组件样式、组件位置边界、对比度修正；
- **AI（规格 JSON）**：选哪些组件、组件参数（色块位置/形状、标签形态与文案）、标题断行与高亮词、副标题文案——即"排版决策是 AI 的，骨架与皮肤是主题的"。

### 规格 JSON（渲染契约草案）

```json
{
  "themeId": "cover-navy-gold",
  "components": [
    { "type": "canvas", "colorRole": "ink" },
    { "type": "eyebrow", "form": "badge", "text": "深度观察" },
    { "type": "title", "lines": ["字节游戏再收缩：", "朝夕光年与沐瞳的沉没成本"], "highlights": ["朝夕光年", "沐瞳"] },
    { "type": "subtitle", "text": "从自研到收缩，一场 300 亿级别的战略试错复盘", "withBar": true },
    { "type": "decoration", "kind": "dots", "position": "bottom-right" }
  ]
}
```

校验规则：组件类型/枚举合法、`canvas` 与 `title` 必有、各组件数量上限、字数上限、高亮词必须是标题原文子串、对比度达标。**任一不合规 → 回退默认规格**（默认封面主题 + 标题两行均分 + 无高亮 + 无装饰），保证永远出图。

## 实施方案（一期）

### 新增/改动文件

1. `lib/themes/cover-components.mjs`（新）：组件目录定义——每个组件一个渲染函数（HTML 片段 + CSS），位置/形态变体、字号标定、边界保护（标题不压色块）；
2. `lib/themes/cover-theme-compiler.mjs`（新）：封面主题编译——token → CSS 变量 + 组件 CSS，产出完整 900×383 页面 HTML；对比度校验与修正；
3. `lib/themes/theme-registry.mjs`：注册 `target: 'cover'` 的内置封面主题（一期 4~6 套：藏青金、米白砖红、墨绿米白、深灰荧光绿等，纯 token 组合）；
4. `lib/themes/theme-validator.mjs` / `theme-numeric-limits.mjs`：cover target 的 schema 与数值范围声明；
5. `lib/llm/cover-image-generator.mjs`（新）：主流程——取文章标题/摘要/账号上下文 → LLM 出规格 JSON（prompt 附组件目录与约束）→ 校验/回退 → 编译渲染 → `html-pages-to-images` 截图（900×383，deviceScaleFactor 2）→ 落 artifacts（`kind='cover-image'`）；标题断行优先复用 social-card 已验证的语义断行思路（`social-card-pipeline.mjs:705-723`）；
6. `lib/themes/theme-preview.mjs`：封面主题 900×383 预览样张（用示例标题渲染）；
7. API：`POST /api/candidates/:id/cover/generate`（挂 `media-routes.mjs`），产物走现有 artifacts 内容路由；`API.md` 同步；
8. 前端：成稿工作台加「生成封面图」按钮（参照 `generate-social-card` 的 job/watcher 模式，注意按候选追踪进度——沿用 `socialJobs` Map 的教训）；主题中心加「封面」分类页签；
9. job 注册进 `AiJobManager`；`CHANGELOG.md`、`docs/` 同步。

### 内置封面主题（一期）

| id | 配色 | 说明 |
|---|---|---|
| `cover-navy-gold` | 藏青底 + 金强调 | 对应效果图 v2 |
| `cover-split-navy` | 米白底 + 藏青色块 | 对应效果图 v1 |
| `cover-editorial-red` | 米白底 + 砖红 | 对应效果图 v3 |
| `cover-forest-cream` | 墨绿 + 米白 | 新增 |
| `cover-graphite-neon` | 深灰 + 荧光绿 | 新增，偏科技 |

（预置组合 ≠ 固定版式；主题只锁配色，版式仍由 AI 组合组件决定。）

### 实施顺序

1. 组件目录 + 编译器 + 内置主题注册（纯渲染层，可先用固定规格出样张）；
2. 全主题样张渲染，人工验收视觉效果、修边界问题；
3. LLM 规格生成 + 校验回退；
4. API + job + 前端按钮 + 主题中心页签；
5. 测试与文档。

### 验证

- 新增 `test/cover-image-generate.test.mjs`：规格校验（非法组件/超限/高亮词非子串 → 回退）、模板转义、比例与产物、路由接线；
- 每个内置主题 × 真实文章标题各渲染若干张样张人工验收；
- `npm run test:fast` 全绿。

## 实施记录（2026-08-07）

已按上述方案完成一期，与原方案的实际差异：

- **动态值全部 inline**：静态结构走 CSS 类，颜色/几何/字号等动态值全部内联（`style="…"`），同页多封面共存不互相覆盖；字族值引号统一单引号，避免截断 style 属性。
- **颜色决策 `pick()`**：每个文本角色从候选色中选与所在底色对比度最高且达标的，全不达标时向黑/白混合修正；badge 底色会避开与整版 accent 色块同色。
- **信息行定位**：`.cover-meta` 绝对定位，左缘对齐内容区（`main.left + 48`），避免压到左侧色块。
- **主题中心页签未做**：封面主题选择在封面页内的主题下拉完成（`GET /api/themes?target=cover` 已可用）；AI 生成封面主题、上传公众号素材、规格微调 UI 均留二期。
- **验证结果**：20 张内置主题样张人工验收通过（`scripts/render-cover-samples.mjs` → `output/cover-samples/`）；`test/cover-image-generate.test.mjs` 7 项；`npm run test:fast` 691 项全绿。

## 二期（暂不实施）

- **AI 生成封面主题**：`ai-theme-contract.mjs` 的 `TARGETS` 加 `'cover'`，补 `DEFAULTS.cover` / recipe 目录 / 数值范围声明（生成器修复流水线是 target 参数化的，逻辑基本复用）；质量门禁加 900×383 样张检查；
- **上传公众号素材**：接微信 API 拿 `thumb_media_id` 挂草稿；
- **规格手动微调 UI**：不满意时改文案/换主题再渲染，而非只能重 roll；
- **标签形态扩展**：eyebrow `form` 枚举开放更多形态。
