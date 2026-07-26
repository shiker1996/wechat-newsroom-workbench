---
name: wechat-md-to-draft
description: 将公众号 Markdown 工作文件连同设计方案和设计 tokens 转换为保留全部正文、来源、图片与结构的 UTF-8 HTML 初稿 article.ai.draft.html。适用于用户要求 Markdown 转公众号 HTML 初稿，或由 wechat-article-typeset 在图片处理后调用。不负责图片上传、HTML 规范化、门禁、预览或发布。
---

# 公众号 Markdown 转 HTML 初稿

读取 `<stem>.images.md`、`<stem>.design-scheme.md` 和 `magazine-design-tokens.json`，写入同目录 `article.ai.draft.html`。

## 转换规则

- 只转换结构与样式，不改写正文、标题、数字、来源和图片说明。
- H1 只出现一次；H2/H3 保持原顺序。
- 段落、列表、引用、表格、代码、脚注和图片使用语义化 HTML。
- 颜色、字号和间距从 tokens 读取；不要另造第二套设计值。
- 文档根容器使用响应式流式布局：`width:auto; max-width:none; margin:0`。不要设置 `720px` 等页面级固定宽度，不要用 `margin:auto` 模拟桌面居中；公众号编辑器会提供自己的正文宽度。
- 正文段落、标题、列表和引用不得设置固定高度。允许用行高与上下 margin/padding 控制节奏，让窄屏换行后高度自然增长。
- 公众号正文样式尽量使用元素内联 `style`；不要依赖脚本、表单、iframe 或交互事件。
- HTML 注释中的手动供图信息保留为注释，不展示给读者。

长文可按完整章节分段转换，再按原顺序拼接。不能拆开列表、表格、代码块、引用或图片说明；拼接后只保留一套文档壳。

## 门禁

检查输出非空、UTF-8、标签基本闭合，标题及 H2/H3 数量与 Markdown 一致，链接和图片数量没有无故减少，且不残留 Mermaid/ECharts 围栏。发现围栏时返回上游图片阶段，不在本技能中假装处理。
