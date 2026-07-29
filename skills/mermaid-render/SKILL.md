---
name: mermaid-render
description: 将 Markdown 中显式的 Mermaid 围栏渲染为 PNG，并用本地路径或经用户授权上传后的 HTTPS URL 替换原围栏。适用于 Mermaid 流程图、架构图、时序图和状态图转图片，或由 wechat-article-typeset 串行处理 images.md 工作文件。未经明确授权不得上传图片。
---

# Mermaid 围栏转图片

只处理 ` ```mermaid` 围栏，不从普通正文猜测图表。

## 流程

流水线直接执行确定性脚本：

```
node scripts/render-mermaid.mjs <input.md> <output.md> [imageDir]
```

脚本按出现顺序提取围栏，为每个围栏写 `<imageDir>/mermaid-N.mmd`，优先调用项目本地安装的 Mermaid CLI（`@mermaid-js/mermaid-cli`，兼容全局安装），并使用 `PUPPETEER_EXECUTABLE_PATH`、系统 Chrome 或 Puppeteer 缓存中的 Chrome 渲染 `mermaid-N.png`，再把围栏替换为相对 PNG 路径。stdout 最后一行输出 JSON 报告 `{"converted":N,"failed":[...],"images":[...]}`；有失败时退出码为 1。

渲染前检查 `npx mmdc --version`。节点文本来自用户内容时，转义会破坏 Mermaid 语法的字符；不得改写节点含义。单个围栏失败时保留原围栏并报告，不得删除内容。预览模式如需上传图床，必须先获得用户明确授权。

## 门禁

- 输出图片存在且非空
- 替换数量等于成功渲染数量
- 其它正文、图片和图表围栏保持不变
- 不回显上传凭据，不默认调用图床
