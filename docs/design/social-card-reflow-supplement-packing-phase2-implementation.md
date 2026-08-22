# Social 图文补充装箱与尺寸兜底：阶段 2 实施记录

## 目标

在 AI 内容计划调整或布局修复没有得到理想尺寸时，增加确定性的最后一道尺寸兜底：

1. 补充事实组件先按页面容量生成 `compact / normal / typography` 尺寸变体。
2. 压缩只作用于说明性文字，按语义边界加省略号；不截断代码、命令、URL，不删除列表条目，也不改变 `fact_ids`、`source_refs`。
3. 舒展排版使用有限字体放大档位，并把同一个 `font_scale` 同时交给容量预估和 HTML 渲染，避免预估模型与浏览器结果偏离。
4. 确定性拆页仍然优先；只有拆页没有解决溢出时，才对 `text / note / list / steps` 执行程序化压缩兜底。

## 变体契约

补充组件新增 `sizeVariants`：

```json
[
  { "id": "compact", "mode": "compress", "fontScale": 1, "content": {} },
  { "id": "normal", "mode": "normal", "fontScale": 1, "content": {} },
  { "id": "typography-106", "mode": "typography", "fontScale": 1.06, "content": {} },
  { "id": "typography-112", "mode": "typography", "fontScale": 1.12, "content": {} }
]
```

`compact` 只在内容有安全压缩空间时生成。命令或 URL 被识别为受保护 token；代码候选不会生成字符截断变体。字体放大上限为普通块 `1.18`、代码块 `1.12`。

页面专属候选在容量预估阶段选择变体，并记录 `variantId`、`sizeMode`、`fontScale` 和 `capacityEstimate`。同一槽位优先选择接近安全利用率上限的候选，避免补充块继续造成大面积留白。

## 渲染与预估一致性

- `renderSocialCardContentComponent` 把选中的变体写入 `font_scale`、`size_variant`、`size_mode`。
- `estimateSocialCardPageLoad` 会按块的 `font_scale` 放大估算高度。
- `renderStoryboardBlock` 对标题、正文、列表、步骤、代码、表格等元素输出内联字号/行高，覆盖模板 CSS 的同名规则。
- 浏览器布局审计仍是最终权威，尺寸变体不是对审计结果的绕过。

## 溢出最后兜底

`reflowPage` 的顺序为：相邻代码块合并 → 确定性拆页/重排 → 对仍然超载的页面执行两档说明文字压缩（约 `0.82`、`0.68`）。每次压缩记录 `compact_text_fallback` 操作；事实来源字段原样保留。压缩后仍超载时继续返回布局失败，不静默删除事实。

## 测试

- 组件尺寸变体、技术 token 保护、`font_scale` 高度估算：`test/social-card-content-components-phase1.test.mjs`
- 内联字体放大覆盖模板 CSS：`test/social-card-storyboard-p0.test.mjs`
- 拆页不可用时的省略号兜底：`test/social-card-reflow-phase2.test.mjs`
- Social 全量回归：`node --test test/social-card-*.test.mjs`

阶段 2 不改变文章主题、封面主题，也不允许程序化压缩代码、命令、URL 或删除事实条目。
