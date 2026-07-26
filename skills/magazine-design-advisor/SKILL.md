---
name: magazine-design-advisor
description: 根据已预渲染的公众号 Markdown 制定克制、可实现的杂志风视觉方案，并输出人类可读的 design-scheme.md 与机器可读的 magazine-design-tokens.json。适用于公众号文章视觉设计、配色和版式建议，或由 wechat-article-typeset 调用。不修改正文、不截图、不上传、不生成 HTML。
---

# 公众号杂志风设计顾问

读取 `<stem>.rendered.md`，根据主题、受众、内容结构和已有图表生成两份同源设计产物。

## 产物

`<stem>.design-scheme.md` 说明：设计概念、信息层级、组件使用位置、图片与图表策略、无障碍和移动端注意事项。

`magazine-design-tokens.json` 至少包含：

```json
{
  "schema_version": 1,
  "colors": {"background": "#FFFFFF", "text": "#222222", "muted": "#666666", "accent": "#B42318"},
  "typography": {"body_px": 16, "line_height": 1.75, "h2_px": 24},
  "spacing": {"section_px": 28, "paragraph_px": 14},
  "image": {"radius_px": 0, "caption_px": 13}
}
```

所有颜色使用 6 位十六进制；正文与背景保持清晰对比；正文不小于 15px。避免大面积渐变、低对比灰字、复杂多栏和依赖 hover 的效果。

## 选择原则

- 设计服务内容类型，不为“杂志感”强加卡片。
- 全文使用一个主强调色和有限的辅助色。
- 数据、时间线和引用采用不同但一致的层级表达。
- 方案中的每个组件必须能由下游 HTML 或截图技能实现。
- 不在设计阶段改写、删减正文或补造图片。

写入后解析 tokens JSON 并确认 scheme 中引用的 token 名称存在。
