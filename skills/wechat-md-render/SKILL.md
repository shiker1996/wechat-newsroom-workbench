---
name: wechat-md-render
description: 在公众号 Markdown 转 HTML 前建立稳定的预渲染副本，规范显式 Mermaid、ECharts 和内联模块标记，同时保持正文、来源、图片和注释不变。适用于用户要求预渲染公众号 Markdown，或由 wechat-article-typeset 读取源 Markdown 并生成同名 rendered.md。不负责设计、截图、上传、HTML 或预览。
---

# 微信文章 Markdown 预渲染

读取 UTF-8 Markdown，写入同目录 `<stem>.rendered.md`。默认执行无损复制；只有用户或源文档明确使用受支持的围栏/模块语法时才规范其结构。

## 执行

```powershell
node scripts/md-render.js <input.md> [output.rendered.md]
```

脚本不自动把普通正文中的箭头、列表或代码改成图表。需要将流程改成 Mermaid 时，必须由用户明确要求或源文档已使用 `mermaid` 围栏。

## 门禁

- 输入存在、非空且可按 UTF-8 读取
- 输出非空，正文标题、段落、链接、脚注、图片和 HTML 注释均保留
- 围栏成对闭合；未识别围栏原样保留
- 不生成设计文件、图片或 HTML

独立调用和编排调用都返回实际输出路径。
