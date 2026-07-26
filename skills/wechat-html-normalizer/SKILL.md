---
name: wechat-html-normalizer
description: 使用 Chromium 计算 CSS 级联并将公众号相关样式确定性写入每个元素的内联 style，随后删除全部 style 标签、外链样式、脚本、事件属性和 div，输出可复制粘贴的 article.ai.html。适用于 wechat-article-typeset 在预览前规范化 HTML，或修复公众号复制后样式丢失；不改写正文、不上传图片、不生成预览。
---

# 公众号 HTML 规范化

把 `article.ai.draft.html` 转为不依赖外置 CSS 的 `article.ai.html`。必须运行脚本，不能只让模型手工搬运样式。

## 执行

```powershell
node scripts/normalize-html.mjs article.ai.draft.html article.ai.html
```

脚本在 Chromium 中完成 CSS 级联计算，将允许的 computed style 写入元素内联 `style`，再删除：

- 所有 `<style>` 和 `link[rel=stylesheet]`
- `<script>`、`iframe`、`form` 及事件处理属性
- 无语义 `div`；块级 div 转为 `section`，行内 div 转为 `span`

远程 stylesheet 不允许联网加载；检测到时失败并报告 URL。需要的 CSS 必须先写进初稿 `<style>` 或元素内联样式。

## 保真规则

- 保留可见文字、顺序、链接、图片、来源、alt 和文案语义。
- 不改写图片 URL，不上传本地图片。
- 不把 Chromium 桌面视口计算出的 `width`、`min/max-width`、`height`、`min/max-height`、定位坐标写入正文流元素。固定计算尺寸会在公众号窄容器重新换行后造成撑宽、重叠或异常留白。
- 根级 `main`/`article` 必须保持响应式：不得固化桌面居中产生的左右外边距或像素宽度。页面宽度交给公众号编辑器容器控制。
- CSS 伪元素中的纯文本内容应实体化为 span；图片型或复杂伪元素必须报告。
- flex/grid 不作为公众号兼容保证。关键布局应由上游使用 table、section、p、span 等可复制结构。
- 先写临时文件，通过非空和保真检查后再替换输出。

## 验收

脚本成功时输出 JSON 摘要。随后必须运行 `wechat-html-check-no-div`；最终 HTML 不得包含任何 `<style>`、stylesheet link、script、事件属性或 div，也不得在正文流元素上包含像素固定宽高。
