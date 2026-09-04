# AI 视觉封面设计方案

> 状态：已实施
>
> 更新时间：2026-08-30
>
> 范围：公众号文章封面的 AI HTML/CSS 视觉生成
>
> 不包含：文生图模型接入、文章正文视觉重做、公众号素材上传、封面主题编辑器重做

## 1. 背景与问题

当前项目已经存在两种相关能力：

1. 公众号封面生成链路：AI 分析标题语义，程序根据封面主题的 `cover.spec` 确定性渲染 900×383 PNG；
2. 图文 AI 视觉链路：单个 AI 视觉 Agent 读取冻结资料，分块写入完整 HTML/CSS，再由 Chromium 截图输出 PNG。

公众号封面目前的 AI 只参与语义分析，负责选择标题高亮词和内置 SVG 语义图案，视觉结构仍由 `cover-theme-compiler.mjs` 固定决定。因此不同文章虽然可以自动匹配主题，但页面构图变化有限。

本方案将图文 AI 视觉生成能力扩展到公众号封面，生成方式仍然是文本模型生成 HTML/CSS，不调用文生图模型：

```text
文章终稿
  ↓
标题、摘要、账号信息、封面主题和 AI 语义
  ↓
单个 AI 视觉 Agent 生成 900×383 HTML/CSS
  ↓
Chromium 直接截图模型产出的 HTML/CSS
  ↓
cover.png
```

## 2. 设计结论

### 2.1 生成方式

新增“AI 视觉封面”模式，沿用现有文本模型和 HTML/CSS 截图链路，不接入文生图模型。

AI 负责：

- 单页封面的整体视觉策划；
- 背景、色块、渐变、纹理、边框和 SVG 装饰；
- 标题区、摘要区、信息区的构图关系；
- 主题视觉语言的具体落地；
- 根据标题语义决定视觉重心和装饰方向。

程序负责：

- 解析文章终稿和封面主题；
- 提供主题 Token 和主题 AI 设计规范；
- 限制 Agent 的写入范围和截图画布；
- 直接截图、登记产物和交付结果；
- AI HTML 直接截图，失败不自动回退标准封面。

### 2.2 主题输入

AI 视觉封面使用封面主题，不使用 Social 图文主题。

封面主题由两部分组成：

| 文件 | 面向对象 | 职责 |
| --- | --- | --- |
| `themes/cover/<id>.json` | 程序化渲染器和主题中心 | 颜色 Token、字体、字号、间距和标准封面构图 |
| `themes/cover/<id>/AI_DESIGN_SPEC.md` | AI 视觉封面 Agent | 主题定位、视觉语言、装饰方向、构图气质和禁用项 |

两者属于同一个主题的不同表现层：

```text
封面主题
├── cover/<id>.json
│   └── 标准封面 renderer contract
└── cover/<id>/AI_DESIGN_SPEC.md
    └── AI 视觉设计 contract
```

`cover.spec` 仍然保留并继续服务标准封面。AI 视觉封面读取它作为构图倾向和组件语义参考，但不直接调用 `cover-theme-compiler.mjs`，也不把 `cover.spec` 当成最终 HTML 模板。

### 2.3 两种模式并存

```text
标准封面
  → cover-image-generator.mjs
  → cover.spec / fallbackCoverSpec
  → cover-theme-compiler.mjs
  → cover.png

AI 视觉封面
  → ai-visual-cover-generator.mjs
  → Cover AI Design Spec
  → 单 Agent HTML/CSS
  → html-pages-to-images
  → cover.png
```

标准模式保持现状，不受新链路影响。AI 模式生成或截图失败时直接任务失败，不回退标准封面。

## 3. 目标与非目标

### 3.1 目标

- 让公众号封面使用 AI HTML/CSS 产生明显的构图和装饰差异；
- 复用现有 Social AI 视觉 Agent 的单 Agent、分块写入和截图机制；
- 让封面主题成为 AI 视觉生成的稳定风格来源；
- 让模型直接决定封面文字与视觉排版，优先观察实际视觉效果；
- 继续输出现有的 `images/cover.png`，不破坏预览和下载接口；
- 标准封面仍可由用户手动选择，但不作为 AI 模式失败回退；
- 不新增文生图模型费用和图片模型配置；
- 保留生成阶段、模型、主题和产物的可审计记录。

### 3.2 非目标

- 不接入 DALL·E、Flux、Midjourney 或其他文生图模型；
- 不让 AI 生成或改写文章标题；
- 不让 AI 把标题、数字或事实直接绘制进 SVG 路径或背景图；
- 不把公众号封面改造成 375×667 的小红书页面；
- 不把整个文章正文交给 AI 视觉 Agent 重新排版；
- 不在第一期实现多候选画廊、人工拖拽编辑或公众号 API 发布；
- 不修改现有 `cover.spec` 的标准渲染契约。

## 4. 封面 AI Design Spec

### 4.1 作用

现有封面 JSON 主要告诉程序“怎么稳定渲染”。它不足以描述自由 HTML/CSS 生成所需要的：

- 主题的视觉气质；
- 哪些装饰元素能代表主题；
- 哪些构图适合封面；
- 标题应该如何成为视觉重心；
- 哪些效果会导致主题退化。

因此需要为封面主题增加 AI-facing SPEC。它是静态主题资料，不按文章重复生成，不产生额外模型调用。

### 4.2 文件位置

内置主题采用：

```text
themes/cover/cover-navy-gold.json
themes/cover/cover-navy-gold/AI_DESIGN_SPEC.md
```

当前 10 个内置封面主题都应补齐 SPEC。用户主题采用以下优先级：

1. 用户主题存储中已有 `aiVisualSpec` 时使用它；
2. 用户主题目录存在 `AI_DESIGN_SPEC.md` 时使用文件；
3. 根据主题 JSON 的 Token 和 `cover.spec` 确定性生成基础 SPEC；
4. 无法加载基础 SPEC 时，AI 视觉模式任务失败，不回退标准封面。

第一期不额外调用模型为用户主题生成 SPEC，避免一次主题创建产生不可控的额外成本。

### 4.3 内容契约

封面 SPEC 只描述视觉语言，不承载文章事实，不定义最终页面正文，不输出 HTML/CSS 代码。建议包含以下章节：

```markdown
# <主题名称> · Cover AI Design Spec

## 主题定位
一句话说明主题给人的视觉感受和适用文章类型。

## 配色关系
说明 page、text、muted、accent、accentSecondary、inverseText 的使用关系。

## 字体与标题气质
说明标题适合的字族、字重倾向、对齐方式和强调方式；不重复定义固定字号。

## 背景与图形语言
说明适合的色块、渐变、纹理、网格、轨道、线条、几何图形或内联 SVG。

## 推荐构图
描述 2–3 种适合 900×383 画布的构图方向；可以参考 cover.spec 的 layout，但不要求复刻固定模板。

## 标题区与留白
说明标题安全区、主视觉重心、标题与装饰的关系以及摘要和信息行的弱化原则。

## 可见装饰
说明装饰在 900×383 原尺寸下应如何保持可感知，避免只有放大后才看见。

## 应避免的退化
例如普通白底卡片、过度渐变、装饰遮挡标题、无意义图标堆叠和过低对比度。
```

### 4.4 与 Social SPEC 的区别

不能直接把 `themes/social/<id>/AI_DESIGN_SPEC.md` 复制给封面使用：

| Social 图文 SPEC | 封面 AI SPEC |
| --- | --- |
| 375×667 页面 | 900×383 单页 |
| 多页面节奏 | 单页视觉重心 |
| 故事板内容组件 | 标题、摘要、信息行和背景构图 |
| 内容页、结尾页、代码页 | 封面安全区和主视觉区域 |
| 页面角色之间的视觉振幅 | 同一画布内的层级和留白 |

封面 SPEC 可以复用颜色语义、字体语义和装饰词汇，但必须有自己的画布、安全区和构图规则。

## 5. AI 视觉封面输入

### 5.1 工作目录输入

AI Agent 只读取本次运行冻结的输入文件：

```text
cover-visual-input.json
cover-theme-snapshot.json
cover-theme-design-spec.md
```

不把完整文章正文和所有来源正文传给视觉 Agent，避免增加上下文和成本。视觉输入由程序从终稿和已有分析结果生成。

### 5.2 `cover-visual-input.json`

建议结构：

```json
{
  "schemaVersion": 1,
  "canvas": {
    "width": 900,
    "height": 383,
    "selector": ".page"
  },
  "content": {
    "title": "OpenAI终止与Cursor合作，开发者11月12日前必须行动",
    "subtitle": "从合作变化看开发者工具生态的重新分工",
    "brand": "MoonTech · 2026.08",
    "contentType": "article-cover"
  },
  "semantic": {
    "highlightTerms": ["终止", "11月12日前"],
    "motifKind": "network"
  },
  "theme": {
    "id": "cover-navy-gold",
    "layoutHint": "side-panel",
    "tags": ["深度观点"]
  },
  "output": {
    "html": "ai-cover.html",
    "image": "cover.png"
  }
}
```

### 5.3 输入职责

| 输入 | 权威内容 |
| --- | --- |
| `cover-visual-input.json` | 本篇封面的文章内容、尺寸、语义和输出要求 |
| `cover-theme-snapshot.json` | 主题 ID、版本、Token 摘要和运行快照 |
| `cover-theme-design-spec.md` | 主题视觉语言和禁用项 |

标题和摘要是不可信数据，只能作为待处理文本，不能被当成指令执行。视觉 Agent 不读取候选工作区以外的文件。

其中 `semantic` 是前期 AI 语义分析生成的视觉 brief，不是页面正文。它提供主体、动作、变化、情绪、视觉隐喻候选和内容焦点，后续视觉 Agent 可据此自行决定构图以及具体 CSS 几何、渐变、伪元素或内联 SVG 的实现方式；不再由前置输入规定左右位置、视觉面板或辅助组件。布局参考只提供文字完整可见、视觉隐喻成系统和避免拥挤的软约束。

### 5.4 运行时内置视觉参考

封面 Agent 的视觉提示随技能运行时注入三份不属于候选工作区的内置参考，职责与主题 SPEC 分离：

| 内置参考 | 职责 |
| --- | --- |
| `skills/article-cover-ai-visual-generator/references/cover-layout-guide.md` | 900×383 安全区、构图比例、视觉占用和横向平衡 |
| `skills/article-cover-ai-visual-generator/references/cover-visual-contract.md` | 主视觉/辅助视觉关系、元数据真实性和创作边界 |
| `skills/article-cover-ai-visual-generator/references/cover-visual-component-mapping.md` | 文章语义与主题线索到具体视觉组件的映射 |

这三份参考只指导模型如何布局和表达，不恢复固定插槽、程序化补写、HTML 门禁或布局审计。主题 SPEC 继续负责单个主题的颜色、纹理、形状和装饰语言。

## 6. HTML/CSS 输出约定

### 6.1 页面结构

Agent 输出完整 HTML 文档，必须包含一个且仅一个截图页：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <style>完整主题 CSS</style>
  </head>
  <body>
    <main class="page">
      <!-- 视觉背景、装饰、标题和其他文字由模型自行组织 -->
    </main>
  </body>
</html>
```

实际 DOM 不要求固定使用 `main` 或 `section`。运行时只依赖一个可被截图的 `.page`，文字和视觉层由模型自行组织。

### 6.2 允许使用

- 内联 `<style>`；
- CSS Grid、Flex、绝对定位和伪元素；
- CSS 渐变、边框、阴影、遮罩、几何变换；
- 内联 SVG；
- 主题 Token 和主题约定的字体栈；
- `pointer-events:none` 的背景装饰层。

### 6.3 运行边界

- Agent 只能写入当前文章工作目录内的 `ai-cover.html`；
- 截图固定使用 `.page`、900×383 画布和本地 Chromium；
- 不执行 HTML/CSS 结构、布局或视觉质量校验。

## 7. 模型自主排版

### 7.1 设计原则

当前实验阶段 AI 直接决定输入文字的层级和视觉排版；程序不再注入文字。标题、摘要、品牌和日期必须来自输入，AI 不得自行创造期号、文章编号、栏目号或其他数字信息。

这一步优先用于观察模型的真实视觉表现；标题准确性、文字完整性和事实一致性留待后续人工评估。

### 7.2 实验截图流程

```text
AI 输出 ai-cover.html
  ↓
原样复制为 cover.html 供查看
  ↓
直接截图 cover.png
  ↓
仅检查图片是否产出
```

模型生成的 `ai-cover.html` 会直接交给 Chromium 截图，以便先观察模型实际效果。

### 7.3 失败条件

当前实验阶段只有两类失败会阻断交付：

- Agent 没有完成单页 `.page` HTML 生成；
- Chromium 无法从模型产出的 HTML/CSS 生成 `cover.png`。

HTML 结构、裁切、视觉层级等问题暂时不阻断，先通过图片交付观察效果。失败时任务直接失败，不生成或覆盖标准封面。

## 8. 流水线设计

### 8.1 总流程

```text
读取文章终稿
  ↓
解析标题、第一段摘要和账号信息
  ↓
解析封面主题
  ↓
运行现有 cover semantics 分析
  ↓
准备 cover-visual-input.json
  ↓
准备 cover-theme-snapshot.json
  ↓
加载 cover/<id>/AI_DESIGN_SPEC.md
  ↓
启动单个 AI 视觉 Agent
  ↓
document_write: begin → append* → finish
  ↓
直接将 ai-cover.html 交给浏览器截图 900×383
  ↓
仅检查 cover.png 是否产出
  ↓
登记 cover.png 和生成记录
```

### 8.2 阶段契约

AI 视觉封面采用独立阶段记录，不直接复用 Social 图文的多页阶段名：

| 阶段 | 执行者 | 主要职责 | 失败处理 |
| --- | --- | --- | --- |
| `inputs` | Pipeline | 准备文章、主题和语义输入 | 阻断任务 |
| `generation` | 单个 AI 视觉 Agent | 写入完整 HTML/CSS | 保留产物并失败 |
| `screenshots` | `html-pages-to-images` | 直接输出 900×383 PNG | 截图失败则任务失败 |
| `delivery-gate` | 固定程序 | 只检查和登记图片产物 | 图片无效则阻断交付 |

建议新增：

```js
export const AI_VISUAL_COVER_STAGE_CONTRACT = Object.freeze([
  { id: 'inputs', skill: 'fixed-program' },
  { id: 'generation', skill: 'article-cover-ai-visual-generator' },
  { id: 'screenshots', skill: 'html-pages-to-images' },
  { id: 'delivery-gate', skill: 'fixed-program' },
]);
```

### 8.3 Agent 权限

生成阶段只开放：

```text
cap_filesystem_project_read
cap_filesystem_project_document_write
```

Agent 不开放：

- 浏览器审计；
- 网络搜索；
- 文章写入；
- 标题修改；
- 任意路径写入；
- 远程图片下载。

截图和门禁由 Pipeline 在 Agent 完成后执行。Agent 只能写入当前文章工作目录内的 `ai-cover.html`。

## 9. 任务、API 与产物

### 9.1 任务模型

继续使用现有 `cover-image` AI 任务，在任务选项中增加 `mode`：

```js
aiJobs.start({
  batchId,
  candidateId,
  provider,
  type: 'cover-image',
  theme,
  mode: 'ai-visual',
});
```

这样可以继续复用：

- 任务队列；
- 候选级互斥；
- 进度日志；
- 前端 `/api/jobs/:id` 轮询；
- 现有封面本地图片接口。

### 9.2 路由请求

现有接口保持不变，仅扩展请求体：

```http
POST /api/candidates/:id/cover/generate
```

```json
{
  "mode": "ai-visual",
  "theme": "cover-navy-gold",
  "provider": "default"
}
```

早报接口使用相同字段：

```http
POST /api/batches/:id/daily/cover/generate
```

兼容规则：

- 缺少 `mode` 时默认为 `standard`；
- `mode` 不是 `standard` 或 `ai-visual` 时返回 400；
- 不存在的主题继续走现有主题回退；
- AI 模式缺少 SPEC、模型不可用或截图失败时任务直接失败，不回退标准封面。

### 9.3 产物

最终图片始终保持：

```text
<article-workdir>/images/cover.png
```

AI 模式增加以下可审计产物：

```text
<article-workdir>/images/ai-cover.html
<article-workdir>/images/cover.html
<article-workdir>/images/cover-visual-input.json
<article-workdir>/images/cover-theme-snapshot.json
<article-workdir>/images/cover-theme-design-spec.md
<article-workdir>/images/cover-ai-generation.json
<article-workdir>/images/cover-ai-stage-executions.json
<article-workdir>/images/cover-ai-delivery-gate.json
```

其中：

- `ai-cover.html` 是 Agent 原始 HTML/CSS；
- `cover.html` 是原始 AI HTML 的截图源副本，不做插槽注入或结构修复；
- `cover.png` 是最终交付图；
- `cover-ai-generation.json` 记录模式、模型、主题、阶段和输入哈希；
- `cover-ai-stage-executions.json` 记录阶段执行时间和状态；
- `cover-ai-delivery-gate.json` 只记录图片交付检查结果。

Artifact 仍登记为：

```text
kind = 封面图
name = cover.png
```

可以额外登记：

```text
kind = AI视觉封面源文件
kind = AI视觉封面生成记录
```

## 10. 代码改造清单

### 10.1 主题层

新增或修改：

```text
themes/cover/*/AI_DESIGN_SPEC.md
server/shared/themes/cover-ai-spec.mjs
server/platform/application/themes/theme-spec-loader.mjs（可选，若已有通用加载器则扩展）
```

职责：

- 读取内置和用户封面主题的 AI SPEC；
- 校验 SPEC 是否存在和是否属于当前主题；
- 根据 Token 和 `cover.spec` 生成确定性基础 SPEC；
- 输出候选工作目录中的 `cover-theme-design-spec.md`。

不修改：

```text
server/shared/themes/cover-components.mjs
server/shared/themes/cover-theme-compiler.mjs
```

它们继续服务标准封面。

### 10.2 AI Agent 层

建议从当前：

```text
server/features/social-cards/application/social-card-ai-visual-agent.mjs
```

抽取通用的 HTML/CSS 文档 Agent runner，放到平台 Agent 层，例如：

```text
server/platform/agent/ai-visual-document-agent.mjs
```

通用参数包括：

```js
{
  entryPoint,
  skillId,
  workspaceFiles,
  outputPath,
  requiredPageCount,
  canvas,
  getPageCount,
  renderRequest,
  documentWriteSessionId,
  allowedCapabilities,
  onProgress,
}
```

现有 Social 图文 Agent 变成包装器，继续使用：

```text
375×667
多页
ai-beautified.html
social-card-ai-visual-generator
```

新封面 Agent 使用：

```text
900×383
单页
ai-cover.html
article-cover-ai-visual-generator
```

如果抽取通用 runner 的改动风险过高，也可以第一阶段复制现有 Agent 的协议实现，但不建议长期保留两份恢复、分块和协议校验逻辑。

### 10.3 文章业务层

新增：

```text
server/features/articles/application/ai-visual-cover-generator.mjs
server/features/articles/application/ai-visual-cover-composer.mjs
server/features/articles/application/ai-visual-cover-pipeline.mjs
```

职责建议：

| 模块 | 职责 |
| --- | --- |
| `ai-visual-cover-generator.mjs` | 准备输入、加载主题、启动 Agent |
| `ai-visual-cover-composer.mjs` | 构建封面输入、主题快照和最小 HTML 起始文档 |
| `ai-visual-cover-pipeline.mjs` | 阶段记录、截图、门禁、产物登记 |

修改：

```text
server/features/articles/application/cover-image-generator.mjs
```

保留现有标准逻辑，在 `runCoverImageJob()` 根据 `mode` 分支：

```js
if (mode === 'ai-visual') {
  return runAiVisualCoverJob(...);
}
return runStandardCoverJob(...);
```

### 10.4 任务和 HTTP 层

修改：

```text
server/platform/jobs/ai-job-manager.mjs
server/platform/http/routes/media-routes.mjs
server/features/batches/application/ai-job-handlers.mjs
API.md
```

任务管理器增加 `mode` 字段并写入 `runOptions`。处理器把 `job.mode` 或 `options.mode` 传给封面业务层。路由只负责校验和入队，不直接执行 AI 视觉逻辑。

### 10.5 前端层

修改：

```text
public/index.html
public/src/views/cover.js
```

封面工作台增加模式选择：

```text
AI 视觉封面
标准封面
```

默认选中“AI 视觉封面”；“标准封面”作为稳定的手动切换选项保留。

AI 模式下展示：

- 当前使用的封面主题；
- 当前设计模型；
- AI 视觉生成状态；
- 失败回退提示；
- 生成后的 PNG 预览；
- 可选的“查看 AI 封面 HTML”入口。

第一期不增加复杂画廊。点击重新生成时覆盖当前 `cover.png`，保留上一版由现有文章版本或备份机制负责。

## 11. 成本控制

本方案不使用文生图模型，因此不新增图片模型费用。

成本控制规则：

- 每次 AI 视觉封面默认只启动一个文本模型 Agent；
- 单页 HTML/CSS 比多页图文的输出量小；
- 主题 SPEC 是静态文件，不按文章生成；
- 封面只传标题、摘要和主题快照，不传完整来源正文；
- 不自动为所有文章生成，只在用户点击时执行；
- 第一版不默认生成 2–4 个候选；
- Agent 输出预算独立设置，建议低于 Social 多页生成预算；
- 截图失败只重试截图，不重新调用模型；
- AI 生成失败直接结束任务，不自动调用标准封面，避免产生与用户选择不一致的结果。

建议第一期默认配置：

```js
{
  maxModelSteps: 8,
  maxToolCalls: 8,
  maxOutputTokens: 5000,
  maxDocumentChunkChars: 8000,
  pageCount: 1,
  canvas: { width: 900, height: 383 }
}
```

## 12. 运行约束与交付检查

### 12.1 HTML 运行边界

不执行 AI HTML 安全和布局门禁。仅保留运行边界：Agent 只能写入当前文章工作目录内的 `ai-cover.html`，截图使用固定的 `.page` 选择器和 900×383 画布。

### 12.2 当前唯一交付门禁

仅检查：

- Chromium 截图成功；
- `cover.png` 存在且文件大小大于 0；
- 图片产物登记成功。

页面数量、画布尺寸、文字溢出、对比度、裁切和视觉层级暂时只作为后续人工观察项，不阻断图片交付。

布局指南中的视觉占用、右侧实质视觉区和三档层级同样属于生成指导与人工观察项，不作为运行时门禁。

### 12.3 内容原则

AI 视觉封面原则上不应新增事实。后续如恢复内容门禁，以下内容只能来自终稿或程序输入：

- 标题；
- 摘要；
- 账号名称；
- 日期；
- 主题 ID；
- AI 语义高亮词和 motif 枚举。

封面装饰可以抽象表达“网络、趋势、数据或框架”等语义，但不能把抽象图案解释成新的事实或数字。

## 13. 失败策略（实验阶段）

| 失败点 | 处理 |
| --- | --- |
| 封面主题不存在 | 沿用默认主题解析，不影响标准模式 |
| AI SPEC 缺失 | AI 任务失败 |
| 模型不可用 | AI 任务失败 |
| Agent 协议错误 | 按现有协议恢复机制处理，仍失败则任务失败 |
| HTML 不完整或无法截图 | 任务失败，保留 AI 原始产物和阶段报告 |
| HTML 结构、溢出、脚本或远程资源问题 | 暂不拦截，直接交给 Chromium 观察实际效果 |
| 图片未产出或为空 | 交付门禁失败，任务失败 |

AI 模式不再自动调用标准封面生成器，也不覆盖已有标准封面。

## 14. 测试方案

### 14.1 单元测试

新增：

```text
test/ai-visual-cover.test.mjs
```

覆盖：

- `cover-visual-input.json` 生成；
- 主题 SPEC 加载和缺失处理；
- AI HTML 直接进入截图；
- 图片交付检查只验证截图是否成功并登记；
- 生成记录字段完整性。

### 14.2 Agent 协议测试

复用或扩展现有 AI 视觉 Agent 测试，覆盖：

- 只开放 `cap_filesystem_project_read` 和 `cap_filesystem_project_document_write`；
- 首次写入必须为 `begin`；
- 中间使用 `append`；
- 完成必须执行 `finish` 后再返回 `final`；
- 单页达到 1/1 后才能结束；
- 输出文件固定为 `ai-cover.html`；
- 过早 `final` 能恢复；
- JSON 截断能按现有机制恢复；
- Social 图文的 375×667 行为不受影响。

### 14.3 路由和任务测试

扩展：

```text
test/cover-image-generate.test.mjs
```

覆盖：

- 缺省 `mode` 仍走标准封面；
- `mode=standard` 走现有逻辑；
- `mode=ai-visual` 走 AI 视觉逻辑；
- daily 封面和候选封面都能使用 AI 模式；
- 任务轮询字段和候选 ID 保持一致；
- AI 失败时任务失败且不产出标准封面；
- `cover.png`、Artifact 和生成记录正确登记。

### 14.4 样张验收

每个内置封面主题至少选择以下标题类型进行人工验收：

- 短标题；
- 长中文标题；
- 含英文、型号和数字的标题；
- 数据对比标题；
- 合作、终止、趋势、框架等不同语义类型。

重点观察：

- 主题差异是否明显；
- 标题是否始终是第一视觉层；
- CSS/SVG 装饰是否在缩略图尺寸下可见；
- 页面是否退化为普通卡片；
- 标题和摘要是否容易阅读；
- 生成失败时是否保持任务失败、不产生误导性的标准封面。

## 15. 实施顺序

### Phase 0：主题 SPEC 基线

1. 为 10 个内置封面主题补写 `AI_DESIGN_SPEC.md`；
2. 确定封面 SPEC 模板和字段职责；
3. 实现 SPEC 加载和确定性基础 SPEC 回退；
4. 为每个主题准备至少一个 900×383 参考样张。

### Phase 1：通用 Agent 能力

1. 抽取 Social AI 视觉 Agent 的通用分块写入能力；
2. 参数化页数、画布、输出文件和入口技能；
3. 保持现有 Social 图文测试全部通过；
4. 新增单页封面 Agent 的协议测试。

### Phase 2：封面 AI 视觉 Pipeline

1. 新增封面视觉输入文件；
2. 接入封面主题 SPEC；
3. 实现 `ai-cover.html` 生成；
4. 实现 900×383 截图和图片交付门禁；
5. 登记 AI 视觉阶段和产物。

### Phase 3：任务、API 和前端

1. 给 `AiJobManager` 增加封面生成 `mode`；
2. 扩展封面 POST 请求体；
3. 在封面工作台增加标准 / AI 视觉模式；
4. 显示 AI 生成状态和失败状态；
5. 更新 `API.md` 和用户文档。

### Phase 4：质量收口

1. 运行所有封面单元测试和 Agent 协议测试；
2. 对 10 套主题进行样张验收；
3. 执行 `npm run test:fast`；
4. 更新 `docs/architecture.md`、`docs/user-guide.md` 和变更日志；
5. 将 AI 视觉封面标记为可选能力，默认不自动运行。

## 16. 未来扩展

以下能力不纳入第一期，但应避免当前设计阻塞它们：

- 同一次生成输出 2–4 个 AI 封面候选；
- 封面候选画廊和人工选择；
- AI 视觉封面 HTML 的手动微调；
- 主题 SPEC 在主题中心中的可视化编辑；
- 对接真实图片作为用户自备背景；
- 在未来单独接入文生图模型作为可选背景层；
- 将公众号封面上传为微信草稿的 `thumb_media_id`。

如果未来接入文生图模型，再单独评估是否增加独立的文字合成层；当前 HTML/CSS 实验阶段由模型直接完成文字与主视觉。

## 17. 验收标准

完成后必须满足：

1. 封面页可以选择“标准封面”或“AI 视觉封面”；
2. AI 视觉封面使用封面主题和封面专用 `AI_DESIGN_SPEC.md`；
3. 不调用文生图模型；
4. AI Agent 使用单会话分块写入完整 HTML/CSS；
5. 输出固定为单页 900×383；
6. AI 生成的 HTML 直接进入截图链路；
7. AI 封面生成失败时任务直接失败，不自动回退；
8. `cover.png`、源 HTML、输入快照和阶段记录可审计；
9. Social 图文 AI 视觉链路行为不改变；
10. 候选文章和批次早报都能生成 AI 视觉封面；
11. 现有封面测试和全量快速测试通过；
12. 用户可以明确知道当前封面是 AI 视觉生成还是标准渲染；
13. 当前阶段仅保留图片交付检查。

## 18. Phase 4 收口记录

阶段 4 已完成：

- 10 套内置封面主题均通过 AI Design Spec 完整性检查；
- 自动样张测试保留为设计参考，不参与真实 AI HTML 交付判断；
- `npm run test:fast` 全量快速回归通过；
- 架构说明、用户手册和变更日志已同步；
- AI 视觉封面是可选能力，默认仍使用标准封面，不会被自动任务隐式启用。

当前阶段以真实模型生成后的 `cover.png` 为观察对象，后续根据人工抽查结果再决定是否增加质量检查。
