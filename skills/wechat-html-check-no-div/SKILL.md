---
name: wechat-html-check-no-div
description: 对公众号终稿 HTML 执行确定性门禁，检查 div 开标签、非法 style 块、脚本、事件处理器、未处理图表围栏和文档首尾杂质，并输出机器可读结果。适用于 wechat-html-normalizer 之后、生成复制页预览之前或用户要求验收 article.ai.html；只检查，不自动改写内容。
---

# 公众号 HTML 门禁

使用脚本检查，不依赖肉眼或模糊字符串搜索：

```powershell
node scripts/check-html.mjs article.ai.html
```

脚本成功时退出码为 0，并输出 `{"valid":true,"issues":[]}`；失败时退出码非零并列出问题。

## 检查项

- 存在 `<div>` 开标签
- 存在任何 `<style>` 或 `link[rel=stylesheet]`
- 存在 `<script>`、`on*=` 事件处理器、iframe 或 form
- 存在未处理的 Mermaid/ECharts 围栏
- `</html>` 后存在非空内容

门禁失败后由编排器决定是否再次调用 `wechat-html-normalizer`。最多重试两轮；相同问题未减少时立即停止，避免无意义循环。该技能本身不修改 HTML。
