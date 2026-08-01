# 文章排版与图文视觉主题 JSON 化方案

> 状态：阶段 0–6 已完成  
> 日期：2026-08-01  
> 范围：公众号文章排版主题、公众号/小红书图文视觉主题  
> 目标：将主题定义从业务 JavaScript 中抽离为独立、可校验、可版本化的 JSON，同时为后续用户自定义主题提供安全基础

## 1. 背景

目前两套主题系统都属于“样式规则写在 JavaScript 中”：

- 文章排版主题在 `lib/llm/typeset-pipeline.mjs` 的 `TYPESET_THEMES` 和 `buildInlineStyles()` 中维护。主题配置、主题判断和 HTML 内联样式生成耦合在同一模块。
- 图文视觉主题在 `lib/llm/social-card-pipeline.mjs` 中维护。主题白名单及大段 `.theme-*` CSS 都嵌入 HTML 模板字符串。
- 前端选择器在 `public/index.html` 再维护一份固定选项，容易与后端支持范围不一致。
- 新增主题需要同时修改前端、渲染器、白名单和测试，普通用户无法复制或调整现有主题。

本方案将“主题数据”和“渲染代码”分开，但不把任意 CSS、HTML 或 JavaScript 开放给用户。

## 2. 设计目标

1. 每个内置主题使用一个独立 JSON 文件，可单独审查、测试和发布。
2. 文章主题与图文主题使用相同的基础元数据和设计 token 命名。
3. 两类主题保留各自需要的表现能力，不强行使用完全相同的字段。
4. 前端主题列表由后端注册中心返回，不再写死 `<option>`。
5. 为用户主题预留复制、编辑、预览、发布、回滚、导入和导出能力。
6. 历史任务记录主题 ID、版本和内容哈希，保证结果可追溯。
7. 文章输出继续满足公众号内联样式约束；图文输出继续支持确定性 HTML/PNG 渲染。
8. 用户主题不允许携带原始 CSS、HTML、脚本、外链字体或远程资源。

## 3. 非目标

第一轮不包括：

- 在线 CSS 编辑器。
- 用户上传字体文件或引用远程字体。
- 用户自定义选择器、伪元素内容、任意渐变表达式或动画代码。
- 用主题配置改变文章事实、文案、故事板内容或图片来源。
- 把页面版式、智能构图和视觉主题重新合并为一个概念。
- 自动把一套文章主题无损转换为一套图文主题。

## 4. 核心原则

### 4.1 JSON 描述设计决策，渲染器实现样式

JSON 保存颜色、字体角色、尺寸、圆角、阴影以及受控的视觉配方名称。渲染器根据这些字段生成 CSS，不执行 JSON 中的代码。

例如，JSON 可以声明：

```json
{
  "heading": "terminal",
  "quote": "terminal-panel",
  "divider": "mono-comment"
}
```

但不能声明：

```json
{
  "css": ".page { position: fixed; ... }",
  "script": "fetch('https://example.com')"
}
```

### 4.2 共享外壳，分域配置

两类主题共享 `id`、`label`、`version`、`tokens` 等字段；文章主题使用 `article` 配方，图文主题使用 `social` 配方。

```text
Theme Definition
├── metadata       通用身份、版本、来源和状态
├── tokens         通用颜色、字体、形状和空间尺度
├── article        文章排版专用语义配方（可选）
└── social         图文卡片专用语义配方（可选）
```

一个主题文件可以只服务文章或图文，也可以同时提供两个域的配置。第一阶段迁移时建议继续“一种主题、一个使用场景”，避免为了复用而损失现有视觉差异。

### 4.3 布局与主题解耦

图文系统继续保持三层职责：

- 故事板：决定讲什么和页面顺序。
- 页面版式/智能构图：决定内容块怎样排列。
- 视觉主题：决定颜色、字体、边框、圆角、阴影和装饰语气。

视觉主题 JSON 不得覆盖页面版式的网格结构，以免主题切换导致内容溢出或叙事顺序变化。

## 5. 建议目录结构

```text
themes/
  schema/
    theme.schema.json
  article/
    magazine-warm.json
    gossip-card.json
    tech-wire.json
    research-report.json
    career-essay.json
    news-digest.json
  social/
    neon.json
    tokyo-night.json
    brutalist.json
    solarized.json
    retro-terminal.json
    paper-craft.json
    charcoal.json
    peach.json
    orange.json
    ice-blue.json
    mocha.json
    lavender.json
    crimson.json
    bone-white.json
```

运行时代码建议新增：

```text
lib/themes/
  theme-loader.mjs
  theme-registry.mjs
  theme-validator.mjs
  theme-snapshot.mjs
  article-theme-compiler.mjs
  social-theme-compiler.mjs
  recipe-catalog.mjs
```

职责划分：

| 模块 | 职责 |
| --- | --- |
| `theme-loader` | 从允许目录读取 JSON，不扫描任意用户路径 |
| `theme-validator` | JSON Schema、语义约束、颜色对比度和数值范围校验 |
| `theme-registry` | 合并内置与用户主题，处理 ID、版本、启停和来源优先级 |
| `recipe-catalog` | 维护可用配方枚举及其确定性 CSS 实现 |
| `article-theme-compiler` | 把文章 token 和配方编译成元素级内联样式 |
| `social-theme-compiler` | 把图文 token 和配方编译成 CSS 变量及受控主题类 |
| `theme-snapshot` | 生成规范化 JSON、SHA-256 和任务快照 |

## 6. 统一主题数据模型

### 6.1 通用外壳

```json
{
  "schemaVersion": 1,
  "id": "magazine-warm",
  "label": "暖纸杂志风",
  "version": "1.0.0",
  "description": "米白纸张与棕褐刊物语气，适合观点和深度内容。",
  "targets": ["article"],
  "status": "published",
  "source": "builtin",
  "basedOn": null,
  "tags": ["warm", "editorial", "serif"],
  "tokens": {},
  "article": {},
  "social": {}
}
```

字段约束：

| 字段 | 规则 |
| --- | --- |
| `schemaVersion` | 整数；未知主版本拒绝加载 |
| `id` | 小写字母、数字和连字符；创建后不可修改 |
| `label` | 1–30 个可见字符 |
| `version` | SemVer；已发布版本不可原地覆盖 |
| `targets` | `article`、`social` 至少一个 |
| `status` | `draft`、`published`、`disabled`、`archived` |
| `source` | `builtin` 或 `user`；由服务端写入，不接受导入值冒充 |
| `basedOn` | 被复制主题的 ID 和版本，可空 |
| `tags` | 仅用于检索和展示，不参与渲染 |

### 6.2 通用 tokens

```json
{
  "tokens": {
    "colors": {
      "background": "#F5EFE3",
      "surface": "#FFF9EF",
      "text": "#30261F",
      "muted": "#786F66",
      "accent": "#76533B",
      "accentSecondary": "#C99A6B",
      "line": "#D8CDBF",
      "inverseText": "#FFFFFF",
      "codeBackground": "#241D18"
    },
    "typography": {
      "family": "serif",
      "headingFamily": "serif",
      "bodyPx": 16,
      "h1Px": 30,
      "h2Px": 22,
      "captionPx": 13,
      "lineHeight": 1.8,
      "letterSpacingEm": 0.025
    },
    "spacing": {
      "articlePaddingPx": 18,
      "sectionPx": 30,
      "paragraphPx": 16,
      "cardGapPx": 12
    },
    "shape": {
      "radiusPx": 10,
      "borderWidthPx": 1,
      "shadow": "soft"
    }
  }
}
```

建议约束：

- 颜色第一阶段只接受六位十六进制，不接受 `url()`、`var()` 或用户字符串表达式。
- 字体只能选择 `sans`、`serif`、`mono` 三个字体栈别名。
- 阴影只能选择 `none`、`soft`、`hard`、`glow` 四个配方。
- 数值设置上下限，例如正文 15–18px、圆角 0–32px、行高 1.5–2.1。
- 前景/背景关键组合需通过最低对比度检查；不通过时禁止发布，但可保存草稿。

## 7. 文章主题 JSON

### 7.1 示例

```json
{
  "schemaVersion": 1,
  "id": "tech-wire",
  "label": "暗色终端",
  "version": "1.0.0",
  "description": "面向技术动态的终端式深色排版。",
  "targets": ["article"],
  "status": "published",
  "source": "builtin",
  "basedOn": null,
  "tags": ["tech", "dark", "mono"],
  "tokens": {
    "colors": {
      "background": "#0D1117",
      "surface": "#161B22",
      "text": "#E6EDF3",
      "muted": "#8B949E",
      "accent": "#39D353",
      "accentSecondary": "#58A6FF",
      "line": "#30363D",
      "inverseText": "#0D1117",
      "codeBackground": "#161B22"
    },
    "typography": {
      "family": "sans",
      "headingFamily": "sans",
      "bodyPx": 16,
      "h1Px": 30,
      "h2Px": 22,
      "captionPx": 13,
      "lineHeight": 1.8,
      "letterSpacingEm": 0.01
    },
    "spacing": {
      "articlePaddingPx": 18,
      "sectionPx": 30,
      "paragraphPx": 16,
      "cardGapPx": 12
    },
    "shape": {
      "radiusPx": 6,
      "borderWidthPx": 1,
      "shadow": "none"
    }
  },
  "article": {
    "recipes": {
      "frame": "terminal-frame",
      "kicker": "mono-line",
      "h1": "terminal-title",
      "h2": "terminal",
      "lead": "rule-bottom",
      "quote": "terminal-panel",
      "divider": "mono-comment",
      "list": "chevron",
      "table": "dark-header",
      "image": "plain"
    },
    "behavior": {
      "justify": false,
      "highlightStrong": "accent",
      "numberSections": false
    }
  }
}
```

### 7.2 编译方式

`article-theme-compiler` 接收规范化主题和设计顾问产生的可变 tokens：

```text
内置/用户主题 tokens
        ↓
本次设计 token 覆盖（仅允许字段）
        ↓
配方目录生成元素样式
        ↓
Markdown 确定性转换
        ↓
公众号元素级 style="..."
```

优先级建议保持现有语义：

```text
系统默认值 < 主题 JSON < 本次合法 design tokens
```

配方名称必须来自 `recipe-catalog`。文章主题 JSON 不直接保存选择器或 CSS 属性字符串。

## 8. 图文主题 JSON

### 8.1 示例

```json
{
  "schemaVersion": 1,
  "id": "paper-craft",
  "label": "纸艺暖调",
  "version": "1.0.0",
  "description": "纸张、印刷边线和轻微错位感。",
  "targets": ["social"],
  "status": "published",
  "source": "builtin",
  "basedOn": null,
  "tags": ["paper", "warm", "editorial"],
  "tokens": {
    "colors": {
      "background": "#D8CBB3",
      "surface": "#FFFAF0",
      "text": "#3A2820",
      "muted": "#80685A",
      "accent": "#C0392B",
      "accentSecondary": "#D9A441",
      "line": "#B79B7E",
      "inverseText": "#FFFFFF",
      "codeBackground": "#362721"
    },
    "typography": {
      "family": "sans",
      "headingFamily": "serif",
      "bodyPx": 11,
      "h1Px": 32,
      "h2Px": 13,
      "captionPx": 9,
      "lineHeight": 1.45,
      "letterSpacingEm": 0
    },
    "spacing": {
      "articlePaddingPx": 18,
      "sectionPx": 24,
      "paragraphPx": 12,
      "cardGapPx": 12
    },
    "shape": {
      "radiusPx": 2,
      "borderWidthPx": 1,
      "shadow": "hard"
    }
  },
  "social": {
    "recipes": {
      "surface": "palette",
      "frame": "paper-frame",
      "decoration": "paper-offset",
      "eyebrow": "stamp",
      "ending": "accent-fill",
      "list": "tinted-card",
      "code": "dark-panel"
    },
    "effects": {
      "texture": "paper-grain",
      "decorationOpacity": 0.22,
      "contentTiltDeg": -0.35
    }
  }
}
```

### 8.2 编译方式

图文编译器输出两部分：

1. 经过转义和白名单映射的 CSS 变量。
2. 由受控配方生成的固定 CSS 类。

示意输出：

```html
<body class="theme-palette recipe-paper-frame recipe-paper-offset"
      data-theme-id="paper-craft"
      data-theme-version="1.0.0"
      style="--bg:#D8CBB3;--surface:#FFFAF0;--ink:#3A2820;--accent:#C0392B;--radius:2px">
```

页面版式和智能构图类仍由现有布局系统生成，主题编译器不能写入 `grid-template-columns`、页面内容顺序或绝对定位内容块。

## 9. 注册、存储与版本

### 9.1 内置主题

- 随代码仓库发布，来源为 `builtin`。
- 启动时加载并校验，任何内置主题无效应让构建或启动检查失败。
- 内置主题不可被用户覆盖、删除或原地修改。
- 可以复制为用户主题。

### 9.2 用户主题

建议保存在数据库，而不是写入项目源码目录：

```text
theme_definitions
  id
  owner_scope
  target
  label
  source
  active_version_id
  status
  created_at
  updated_at

theme_versions
  id
  theme_id
  version
  schema_version
  definition_json
  content_hash
  status
  created_at
  published_at
```

第一版如果暂不做多用户体系，`owner_scope` 可固定为 `workspace`，但字段应保留。

保存行为：

- “保存草稿”创建或更新未发布草稿。
- “发布”执行完整校验，并生成不可变版本。
- 修改已发布主题时创建下一版本，不覆盖原 JSON。
- 删除默认采用归档；被历史任务引用的版本不得物理删除。

### 9.3 生成快照

文章排版和图文生成任务都记录：

```json
{
  "theme": {
    "id": "paper-craft",
    "version": "1.0.0",
    "source": "builtin",
    "hash": "sha256:..."
  }
}
```

历史任务重新下载沿用原产物；显式重跑默认沿用原主题版本，并提供“升级到最新版后重跑”的独立动作。

## 10. API 设计

建议增加：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/themes?target=article` | 获取可用主题列表 |
| `GET` | `/api/themes/:id` | 获取当前版本及可编辑字段 |
| `POST` | `/api/themes` | 从零创建用户主题草稿 |
| `POST` | `/api/themes/:id/clone` | 复制内置或用户主题 |
| `PUT` | `/api/themes/:id/draft` | 保存草稿 JSON |
| `POST` | `/api/themes/:id/validate` | 返回 Schema、语义、对比度和渲染检查 |
| `POST` | `/api/themes/:id/preview` | 使用固定样稿生成预览 |
| `POST` | `/api/themes/:id/publish` | 发布不可变版本 |
| `POST` | `/api/themes/:id/archive` | 归档用户主题 |
| `GET` | `/api/themes/:id/versions` | 查看版本历史 |
| `POST` | `/api/themes/:id/versions/:version/restore` | 从历史版本创建新草稿 |
| `GET` | `/api/themes/:id/export` | 导出规范化 JSON |
| `POST` | `/api/themes/import` | 导入并校验为用户草稿 |

创建与修改接口只接受结构化字段；服务端忽略或拒绝 `source`、系统状态、哈希等受保护字段。

现有生成接口由 `theme` 字符串逐步升级为：

```json
{
  "themeRef": {
    "id": "paper-craft",
    "version": "1.0.0"
  }
}
```

兼容期继续接受旧 `theme: "paper-craft"`，由注册中心解析为当前已发布版本。

## 11. 前端主题管理体验

### 11.1 主题选择器

- 页面启动后调用主题列表 API 动态填充。
- 内置主题与“我的主题”分组展示。
- 每项显示缩略图、名称、适用目标和版本，而不是只有文字下拉项。
- 当前不可用主题显示原因；历史任务引用的停用主题仍可只读查看。
- 保留文章“自动匹配”，但自动匹配结果必须展示实际主题名称和版本。

### 11.2 主题编辑器

建议采用表单式编辑，而非暴露 JSON 或 CSS：

- 基础：名称、描述、标签。
- 色彩：背景、表面、正文、弱化、主强调、次强调、边线。
- 字体：正文/标题角色、字号、行高、字距。
- 形状：圆角、边框粗细、阴影配方。
- 文章专用：标题、章节、引述、分隔线、列表、表格配方。
- 图文专用：框架、装饰、眉题、结尾页、纹理和轻量效果配方。
- 实时预览：固定样稿 + 手机宽度，支持浅色/深色背景检查。

关键操作层级：

```text
保存草稿 → 校验 → 预览 → 发布
```

内置主题详情页只提供“复制并编辑”，不提供直接修改。

## 12. 校验与安全边界

必须包含以下门禁：

1. JSON 最大体积，例如 64KB。
2. 拒绝未知字段，防止未来字段被静默误解。
3. 所有枚举值必须来自配方目录。
4. 所有数字必须是有限数值且落在边界内。
5. 颜色只接受安全格式；禁止 CSS 函数和 URL。
6. 文本字段输出前 HTML 转义。
7. 不读取主题 JSON 中的本地路径或网络地址。
8. 文章预览必须通过现有无脚本、无非法 `<style>`、无 `div` 等门禁。
9. 图文预览必须通过布局溢出审计和 PNG 截图验证。
10. 主题发布前检查关键文本组合的颜色对比度。
11. 导入文件只能创建用户草稿，不能覆盖内置主题或直接发布。
12. 主题错误不得静默回退后继续生产；正式生成应返回明确错误。仅旧数据兼容解析可以记录警告后使用既定回退主题。

## 13. 缓存与性能

- 注册中心按 `id@version` 缓存已经校验和规范化的主题。
- 编译结果按主题哈希缓存；同一主题重复渲染不重复解析 Schema。
- 内置主题在启动时预加载；用户主题在列表或生成时按需加载。
- 发布、恢复或归档后精确失效对应主题缓存。
- 生成任务启动时冻结主题快照，任务执行期间不受主题发布影响。

## 14. 实施阶段

### 阶段 0：基线与契约冻结（1–2 人日）

实施状态：已完成（2026-08-01）。基线位于 `test/fixtures/theme-baseline.json`，自动化契约位于 `test/theme-baseline.test.mjs`。

1. 为现有 6 个文章主题和 14 个图文主题建立结构快照测试。
2. 准备覆盖标题、段落、列表、引述、表格、代码、图片、封面和结尾页的固定样稿。
3. 固化当前主题 ID、前端标签、默认映射和回退行为。
4. 明确文章与图文允许的配方枚举。

验收：迁移前所有主题都能生成可比较的 HTML，图文主题能够输出预览截图。

### 阶段 1：Schema、加载器与注册中心（2–3 人日）

实施状态：已完成（2026-08-01）。已建立 `themes/schema/theme.schema.json`、20 个只读内置主题 JSON、`lib/themes/` 加载与校验模块、稳定哈希及构建门禁；生产渲染器尚未切换到注册中心。

1. 新增统一 `theme.schema.json`。
2. 实现 loader、validator、registry 和规范化哈希。
3. 先只加载内置 JSON，不改变现有渲染输出。
4. 增加重复 ID、未知版本、非法字段、越界数值和对比度测试。

验收：注册中心可列出全部 20 个内置主题，并对非法主题给出稳定错误码。

### 阶段 2：迁移文章主题（2–4 人日）

实施状态：已完成（2026-08-01）。文章确定性渲染、主题校验和 Mermaid/ECharts 配色均已改从 JSON 注册中心及受控配方派生；旧 `TYPESET_THEMES` 仅保留为只读兼容视图。每次排版会生成 `article-theme-snapshot.json`，记录主题 ID、版本和 SHA-256。

1. 把 `TYPESET_THEMES` 拆成 6 个文章 JSON。
2. 把 `buildInlineStyles()` 中的主题名分支收敛为配方目录。
3. `defaultTypesetTheme()` 继续只返回主题 ID，实际定义由 registry 获取。
4. 图表主题从同一个主题快照读取颜色，而不是再次维护主题映射。
5. 保持最终输出为内联样式，并运行公众号 HTML 门禁。

验收：文章专项测试全部通过；6 个主题的标题、章节、引述、列表、表格和图表语义与基线一致或有明确批准的视觉差异。

### 阶段 3：迁移图文主题（3–5 人日）

实施状态：已完成（2026-08-01）。14 个图文主题已统一由 JSON 注册中心加载，并经 `social-theme-compiler.mjs` 编译为当前主题专属的 CSS 变量与受控配方；渲染器中的主题白名单和 `.theme-*` 主题样式已删除。生成任务会写入 `social-theme-snapshot.json`，记录主题 ID、版本和 SHA-256，未知主题会明确报错。为还原图文画布与内容面板的双层背景，公共颜色 token 增加了可选的 `colors.page`，未提供时回退到 `surface`。

1. 把 14 个主题颜色和配方拆成独立 JSON。
2. 将 `.theme-*` 大段 CSS 拆为公共组件 CSS、配方 CSS 和编译出的变量。
3. 删除渲染函数中的主题数组白名单，改由 registry 校验。
4. 保持版式、智能构图和视觉主题三个系统独立。
5. 对 14 个主题分别运行 HTML、布局审计和截图测试。

验收：全部主题可确定性生成；未知主题正式生成时返回错误，不再静默回退；截图不存在明显溢出或对比度退化。

### 阶段 4：前端动态读取与预览（2–3 人日）

实施状态：已完成（2026-08-01）。新增 `GET /api/themes?target=article|social` 和 `GET /api/themes/:id` 只读接口，返回主题标签、来源、版本、哈希及预览色；文章与图文选择器已移除内置主题硬编码并在启动时动态加载。界面同步显示主题来源、版本和由真实 token 生成的固定样稿缩略预览；文章“自动”选项继续显示当前内容对应的自动匹配结果。目录请求失败时仅保留安全默认主题，不影响本地工作台启动。

1. 增加只读主题列表和单主题详情 API。
2. 移除 `public/index.html` 中写死的主题选项。
3. 文章和图文选择器按目标动态加载。
4. 增加主题卡片缩略图和固定样稿预览。
5. 显示主题来源、版本及自动匹配结果。

验收：新增内置 JSON 后无需再修改前端；前后端主题列表不会漂移。

### 阶段 5：用户主题 MVP（4–6 人日）

实施状态：已完成（2026-08-01）。数据库新增 `theme_definitions` 与 `theme_versions`，支持工作区用户主题的草稿和不可变发布版本；管理界面支持从内置主题复制、表单编辑名称/描述/安全颜色、保存、校验、固定样稿预览、发布、归档和历史版本恢复。文章与图文生产路径会解析已发布用户主题，并继续在任务目录冻结版本与哈希快照；用户主题随 SQLite 工作台备份进入校验包。内置主题不可覆盖，主题 JSON 限制为 64KB，未知字段、非法配方、越界数值、CSS 函数颜色和低对比度都会被服务端拒绝。

1. 增加主题定义和版本数据表。
2. 支持复制内置主题、表单编辑、保存草稿、校验、预览和发布。
3. 生成任务记录不可变主题快照。
4. 支持归档和历史版本恢复。
5. 将主题纳入工作台备份、恢复和审计范围。

验收：非技术用户可从现有主题复制出新主题并用于生产；修改新版不会改变历史任务。

### 阶段 6：导入导出与治理（2–3 人日，可选）

实施状态：已完成（2026-08-01）。主题管理器支持规范 JSON 导入导出；导入始终创建用户草稿，禁止覆盖内置主题或同 ID 用户主题，缺失 `schemaVersion` 的兼容 v1 结构会明确补全并返回升级提示，未知 Schema 则拒绝。文章排版和图文生成会写入版本级 `theme_usage` 记录，管理界面展示使用次数、涉及批次和最近使用时间，并在归档前显示历史版本与任务引用影响。当前产品仍是本机单用户工作台，`owner_scope=workspace` 已为未来团队共享保留边界，但本阶段不引入无实际身份体系支撑的权限或审批 UI。

1. 支持 JSON 导入导出。
2. 增加兼容版本升级器和废弃字段提示。
3. 增加主题使用次数、最近使用时间和删除影响检查。
4. 增加团队共享、权限或审批能力（如未来需要多用户）。

验收：导入非法主题不会影响注册中心；旧 Schema 可被明确升级或拒绝，不静默解释。

预计总工作量：14–26 人日。只完成“内置主题 JSON 化 + 前端动态列表”的可用版本约为 8–14 人日；开放用户主题 MVP 需要完成阶段 5。

## 15. 迁移与兼容策略

采用双读、单写、再切换：

1. 注册中心先并行读取 JSON，旧常量仍作为生产来源。
2. 测试中比较 JSON 规范化结果与旧定义。
3. 文章渲染切换到 JSON，保留旧主题 ID 和自动映射。
4. 图文渲染切换到 JSON，保留数据库现有 `visual_style` 字符串。
5. 前端改为动态列表后，删除写死的 `<option>`。
6. 稳定一个版本后删除旧主题常量和嵌入式主题 CSS。

已有数据不需要立即迁移：

- `visual_style = "ice-blue"` 可继续作为主题 ID 解析。
- 文章任务中的旧 `theme` 字符串可解析为该内置主题的首个 JSON 版本。
- 无法解析的历史 ID保留原记录并显示“主题已缺失”，不得自动改写数据库。

## 16. 测试策略

### 单元测试

- Schema 合法/非法样例。
- token 边界和默认值。
- 配方枚举。
- 注册中心优先级与重复 ID。
- 规范化 JSON 的稳定哈希。
- 文章内联样式编译。
- 图文 CSS 变量编译和转义。

### 契约测试

- API 列表、详情、保存、校验、发布和归档。
- 旧 `theme` 字符串兼容解析。
- 生成快照包含主题 ID、版本、来源和哈希。
- 备份恢复保留用户主题及历史版本。
- 导入主题始终先进入草稿；只有通过 Schema、对比度、编译覆盖、固定样稿 HTML 和布局结构五项门禁后才能发布。旧结构主题打开时只生成兼容报告，不原地迁移；可导出 JSON 后在副本中人工升级。工作台 SQLite 备份完整包含 `theme_definitions` 与 `theme_versions`，恢复时继续执行数据库结构、哈希清单和外键完整性校验。

### 视觉与门禁测试

- 文章 6 主题固定样稿 HTML 结构断言。
- 文章公众号规范化与最终门禁。
- 图文 14 主题 × 关键版式的截图抽样。
- 微信与小红书尺寸下的文字溢出检查。
- 深浅背景、正文、弱化文字和按钮/标签的对比度检查。

不建议对完整 HTML 或 PNG 做脆弱的全量快照；应组合使用关键结构断言、布局审计和少量基准图差异阈值。

## 17. 风险与控制

| 风险 | 控制 |
| --- | --- |
| JSON 为了覆盖特殊主题不断加入 CSS 字符串 | 使用有限配方目录；新能力通过代码审查增加配方 |
| 文章主题切换后公众号样式丢失 | 编译为元素级内联样式并复用现有门禁 |
| 图文主题干扰智能构图 | Schema 禁止布局字段，编译器限制主题选择器作用域 |
| 前后端主题列表不一致 | 前端只消费 registry API |
| 用户颜色导致不可读 | 发布前对比度检查和固定样稿预览 |
| 修改主题改变历史产物 | 不可变版本 + 生成快照 + 哈希 |
| 导入主题注入 CSS/HTML | 拒绝未知字段和原始样式字符串，所有值白名单化 |
| JSON Schema 升级破坏旧主题 | `schemaVersion`、升级器和明确拒绝策略 |
| 内置主题文件损坏导致启动失败 | 构建时全量校验，生产只发布通过验证的主题包 |

## 18. 完成标准

完成阶段 1–4 后：

- 20 个内置主题全部来自独立 JSON 文件。
- 业务渲染模块不再维护主题白名单、主题标签或主题色常量。
- 前端不再写死主题选项。
- 文章继续输出公众号兼容的内联样式。
- 图文继续输出可截图的确定性 HTML，且布局与主题相互独立。
- 每次生成都能记录主题 ID、版本和哈希。
- 新增一个内置主题只需增加合法 JSON、预览资产和测试，不需要修改业务路由或页面。

完成阶段 5 后：

- 用户可以复制内置主题并以表单方式修改安全字段。
- 用户主题具备草稿、校验、预览、发布、版本和归档生命周期。
- 历史任务不受后续主题修改影响。
- 用户不需要也不能编写任意 CSS 或脚本。

## 19. 推荐实施顺序

优先完成阶段 0–4，把主题系统从代码中真正解耦；确认两类渲染器和视觉回归稳定后，再开放用户编辑。不要在仍存在两套硬编码白名单时直接添加“自定义主题”表单，否则会形成第三套主题来源，并增加历史版本、校验和前后端一致性问题。
