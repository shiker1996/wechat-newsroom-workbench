---
name: wechat-inline-modules-to-images
description: 将公众号 Markdown 工作文件中的显式 stats-grid、timeline 等内联 HTML 模块截图为 PNG，并替换为 Markdown 图片引用。适用于 wechat-article-typeset 的串行图片处理或单独把内联模块转图；读取当前工作文件而非固定从 rendered.md 重建，不处理 Mermaid、ECharts 围栏或普通 HTML。
---

# 公众号内联模块转图片

只处理带有明确受支持类名的独立模块，如 `.stats-grid`、`.timeline`。不要把普通表格、引用或任意 `div` 自动截图。

## 流程

1. 读取调用方指定的当前 Markdown 工作文件和可选 `magazine-design-tokens.json`。
2. 提取模块，为每个模块生成自包含 HTML 页面。
3. 使用 `html-pages-to-images` 按模块根选择器截图。
4. 以相对 PNG 路径替换模块；只有预览模式且用户授权后才上传并写 HTTPS URL。
5. 先写临时输出，确认模块数与图片数一致后更新工作文件。

没有匹配模块时原样保留工作文件并报告 `converted: 0`。不得从旧的 `<stem>.rendered.md` 重新生成并覆盖已经处理的 Mermaid 结果。

## 门禁

检查所有成功模块均被替换、生成图片非空、未处理模块原样保留、正文未变化、没有静默上传。
