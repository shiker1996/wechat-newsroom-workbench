---
name: wechat-article-typeset
description: 将项目成稿 09-FINAL.md 编排为适合微信公众号编辑器的最终 HTML。作为项目正式排版总契约，依次编排预渲染、杂志设计、图片处理、HTML 初稿、规范化和最终门禁，输出 article.ai.html。适用于项目排版任务、Markdown 转公众号 HTML 和成稿链后的正式排版；不负责撰稿、事实审查、外部预览、上传或公众号发布。
---

# 公众号文章排版编排器

把 `09-FINAL.md` 转换为经过确定性门禁的 `article.ai.html`。将本技能作为项目排版的唯一总流程契约；执行器负责读取本技能和当前阶段子技能，再调用模型或确定性脚本。

开始前完整读取 [references/pipeline-contract.md](references/pipeline-contract.md)。严格使用其中的阶段 ID、输入输出和门禁。不要增加预览、复制页、发布或隐式上传阶段。

## 执行原则

- 只改变结构与视觉表达，不改写正文、标题、数字、来源、链接、图片说明或作者观点。
- 严格串行执行六个阶段；每一步读取上一阶段的规范产物，禁止从旧文件重新生成并覆盖前序结果。
- AI 阶段同时加载本总技能、产物契约和当前子技能；确定性阶段直接执行子技能脚本。
- 每阶段通过门禁后再进入下一阶段；失败时保留最后一个有效产物并停止。
- 记录技能文件、内容哈希、阶段输入输出、状态和完成时间。
- `article.ai.html` 是唯一最终排版产物。本技能不调用外部预览服务，不生成复制页链接。

## 六阶段编排

### 1. `rendered`

使用 `wechat-md-render` 将 `09-FINAL.md` 预渲染为 `09-FINAL.rendered.md`。保留全部正文、来源、图片和手动供图注释。

### 2. `design`

同时加载本技能与 `magazine-design-advisor`，基于预渲染文章生成：

- `09-FINAL.design-scheme.md`
- `magazine-design-tokens.json`

设计必须服务文章主题和阅读层级，避免模板化黑白方案、低对比文字、复杂多栏与依赖交互的效果。

### 3. `images`

将预渲染文章作为连续工作文件处理，输出 `09-FINAL.images.md`：

1. 有 Mermaid 围栏时使用 `mermaid-render`
2. 有支持的内联视觉模块时使用 `wechat-inline-modules-to-images`
3. 有 ECharts 围栏时使用 `wechat-echarts-blocks-to-images`
4. 处理已提供的文章图片和结构化配图清单

允许最终 HTML 引用项目可解析的本地图片路径。遇到未提供的手动配图，或当前项目没有对应可视化执行器时，明确阻断，不得删除、伪造或跳过内容。

### 4. `draft`

同时加载本技能与 `wechat-md-to-draft`，读取图片工作稿、设计方案和设计 tokens，生成 `article.ai.draft.html`。模型输出必须通过标题、章节、链接和图片保真门禁；不通过时可使用确定性 Markdown 转换器，但回退结果仍须通过同一门禁。

### 5. `normalized`

执行 `wechat-html-normalizer/scripts/normalize-html.mjs`，将样式计算并内联，删除脚本、事件属性、外部样式、`style` 标签和 `div`，输出 `article.ai.html`。不得用模型模拟规范化脚本。

### 6. `gate`

执行 `wechat-html-check-no-div/scripts/check-html.mjs`。只有门禁返回有效结果，才把任务标记为 `typeset/completed`；否则保留失败产物并停止。

## 完成汇报

报告源文件、设计产物、HTML 初稿、最终 `article.ai.html`、门禁结果、技能清单和阶段执行清单。不要声称已生成复制页、上传或发布。
