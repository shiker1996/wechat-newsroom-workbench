---
name: xiaohongshu-article-generator
description: 接收已锁定的图文故事板与事实基座，生成公众号或小红书配套文案，完成确定性 HTML 组装、布局审计与安全修复、逐页截图和交付校验。
---

# 图文生成与交付

本技能不负责选择故事线或首次规划故事板。输入必须包含已通过固定门禁与
`social_card_storyboard` Schema 校验的 `card_plan`。

## 输入

- 已锁定的 `card_plan`
- 对应事实基座与来源边界
- `channel_mode` 和内容类型
- 视觉主题、版式与构图模式
- 可选增长字段和工作目录

不得自行新增页面、改变页序或补造事实。故事板缺失时应停止，而不是重新规划。

## 工作流

### 1. 读取已锁定故事板

将事实清单和故事板写入工作目录，确认页面数量、标题、证据和内容块完整。只允许固定程序执行字段清洗与构图规范化。

### 2. 生成配套文案

读取 `COPY_GUIDE.md`、`TITLE_GUIDE.md` 以及当前内容类型 reference：

- 工具图文：`references/copy-tool.md`
- 开源技术图文：`references/copy-technology.md`
- 开源趋势图文：`references/copy-trend.md`
- 事件图文：`references/copy-event.md`
- 自定义图文：`references/copy-custom.md`

文案必须是可以直接发布的纯文本：不使用 Markdown 或 HTML 样式（标题符号、加粗、列表符号、链接语法、代码块等一律禁止），结构只靠分行与数字编号表达；公众号与小红书图文均不支持渲染标记文案。文案不得出现页码和布局指令，不得增加故事板与事实基座之外的体验、数字、效果或定性。公众号与小红书均在末尾输出 6–8 个准确话题标签；标签必须与内容严格相关，不得堆砌无关热词。

### 3. 确定性组装 HTML

依据 `DESIGN_SYSTEM.md` 和 `references/layout-contract.md` 选择视觉语言。HTML 骨架、页面尺寸、受控构图注册表和安全清洗由固定代码负责，模型不得输出任意 HTML 或 CSS。

### 4. 布局审计与安全修复

使用 `scripts/layout-audit.mjs` 对浏览器真实布局进行审计。先尝试固定程序的安全构图回退；仍失败时只允许在保持事实、标题、页数和页序不变的前提下压缩或补充已有内容。

### 5. 截图与交付

布局审计通过后调用 `html-pages-to-images`。固定程序校验 PNG 数量、HTML、故事板、配套文案和关键事实一致性。

## 输出

```text
<topic>/
  fact-sheet.md
  card-plan.json
  my-design.html
  copy.txt
  layout-report.json
  delivery-report.json
  output/page-01.png ...
```

不要声称已发布到公众号或小红书。
