---
name: mermaid-render
description: 将 Markdown 中显式的 Mermaid 围栏渲染为 PNG，并用本地路径或经用户授权上传后的 HTTPS URL 替换原围栏。适用于 Mermaid 流程图、架构图、时序图和状态图转图片，或由 wechat-article-typeset 串行处理 images.md 工作文件。未经明确授权不得上传图片。
---

# Mermaid 围栏转图片

只处理 ` ```mermaid` 围栏，不从普通正文猜测图表。

## 流程

1. 读取当前 Markdown 工作文件并按出现顺序提取围栏。
2. 为每个围栏写临时 `.mmd`，使用已安装的 Mermaid CLI 渲染 PNG。
3. 本地模式将围栏替换为相对 PNG 路径；预览模式只有在获得上传授权后才上传并替换为 HTTPS URL。
4. 写入临时 Markdown，验证后替换调用方指定的工作文件。

渲染前检查 `npx mmdc --version`。节点文本来自用户内容时，转义会破坏 Mermaid 语法的字符；不得改写节点含义。单个围栏失败时保留原围栏并报告，不得删除内容。

## 门禁

- 输出图片存在且非空
- 替换数量等于成功渲染数量
- 其它正文、图片和图表围栏保持不变
- 不回显上传凭据，不默认调用图床
