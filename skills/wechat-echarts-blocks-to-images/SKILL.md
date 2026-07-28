---
name: wechat-echarts-blocks-to-images
description: 将 Markdown 当前工作文件中的显式 ECharts 配置围栏渲染为 PNG 并替换为图片引用。适用于公众号数据图表转图或由 wechat-article-typeset 在 Mermaid 和内联模块之后串行处理 images.md 工作文件；不处理 Mermaid、普通代码块或内联模块，未经授权不得上传图片。
---

# ECharts 围栏转图片

只处理语言标记为 `echarts` 的围栏。配置必须解析为 JSON 或该技能明确支持的安全对象格式；不要执行来源不明的任意 JavaScript。

## 流程

流水线直接执行确定性脚本：

```
node scripts/render-echarts.mjs <input.md> <output.md> [imageDir]
```

脚本从工作文件提取 ECharts 围栏，验证配置（仅 JSON 对象、长度上限 200K 字符），为每个围栏生成自包含 HTML（内联本技能 `node_modules/echarts` 的 `echarts.min.js`，禁用动画并以 `finished` 事件作为完成标志），复用 `html-pages-to-images` 技能安装的 puppeteer 截图产出 `echarts-N.png`（2x 分辨率），再把围栏替换为相对 PNG 路径。stdout 最后一行输出 JSON 报告 `{"converted":N,"failed":[...],"images":[...]}`；有失败时退出码为 1。

没有围栏时原样保留并报告 `converted: 0`。单图失败时保留对应围栏和错误信息，不得用空白图片替换。预览模式如需上传图床，必须先获得用户明确授权。

## 门禁

确认成功围栏数与图片数一致、图片尺寸非零、坐标文字未明显裁切、其它正文和已处理图片未变化、没有静默上传。
