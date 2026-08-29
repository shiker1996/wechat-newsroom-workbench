# 纸艺暖调 · Social AI Design Spec

> 主题 ID：paper-craft · 版本：1.0.2 · 目标：Social 图文视觉生成

## 主题定位

纸张、印刷边线和轻微错位感。

主题识别由以下颜色、形状、组件处理和装饰方向共同建立；页面焦点与信息层级由 AI 视觉技能根据事实决定。

## 设计 Token

### 配色

| 语义 | 实际颜色 | 运行时变量 |
|---|---|---|
| 画布背景 | #D8CBB3 | var(--bg) |
| 卡片表面 | #FFFAF0 | var(--surface) |
| 页面底色 | #F5EAD6 | var(--page) |
| 正文/标题 | #3A2820 | var(--ink) |
| 辅助文字 | #80685A | var(--muted) |
| 主强调色 | #C0392B | var(--accent) |
| 次强调色 | #D9A441 | var(--accent2) |
| 分隔线 | #B79B7E | var(--line) |
| 深色表面反色文字 | #FFFFFF | var(--inverse) |
| 代码/深色表面 | #362721 | var(--code) |

正文使用 var(--ink)，辅助信息使用 var(--muted)；深色表面使用匹配的反色文字，强调色先检查实际背景对比度。

### 字体

- 字体：正文 sans；标题 serif。
- 排版和布局统一遵循 AI 视觉技能提供的 Layout Guide，本主题不另设数值。

### 形状与效果

- 圆角：2px；边框：1px；阴影：hard。
- 可选主题视觉词汇（不要逐页机械复用）：{
  "surface": "palette",
  "frame": "palette-frame",
  "decoration": "paper-offset",
  "eyebrow": "stamp",
  "coverTitle": "editorial",
  "coverSupport": "lead",
  "ending": "accent-fill",
  "list": "tinted-card",
  "code": "dark-panel"
}
- 主题纹理：paper-grain；装饰强度只作参考，实际透明度由页面 Agent 按背景和可读性调整。

### 组件级主题配置

以下配置只提供组件的字体家族、语义颜色和边框角色；字号、字重、行高和具体构图由 Layout Guide、故事板事实与页面 Agent 决定：

```json
{
  "eyebrow": {
    "fontFamily": "inherit",
    "colorRole": "muted"
  }
}
```

## 语义组件配方

以下配方说明不同事实在本主题下适合采用的视觉处理。组件选择、每页数量和整组节奏由 AI 视觉技能根据事实与页面职责决定，不要为了填充空间虚构指标、步骤或结论。

| 语义组件 | 适用输入 | 当前主题配方 | 实现边界 |
|---|---|---|---|
| metric-focus | 数字、比例、价格、规模或版本 | lead | 用 accent 或 accent2 放大事实；使用 hard 投影，不新增数字 |
| process-rail | 步骤、流程、执行循环或时间顺序 | paper-offset | 用节点、箭头或阶段条表达顺序；不改变步骤内容 |
| signal-grid | 3–4 个并列问题、能力或选项 | tinted-card | 用 surface 与 line 形成可扫描的并列层级 |
| warning-panel | 风险、限制、未验证项或证据边界 | palette-frame | 用 accent2、边框或状态底色提高边界信息辨识度 |
| terminal-panel | 代码、命令或安装指令 | dark-panel | 用 code 表面、mono 字体和主题边框保持操作感 |
| accent-fill | 结论、总结、适用人群或下一步 | accent-fill | 用 accent 与 inverse 形成结论色块，不扩展事实 |

主题可以用 accent / accent2 / surface / inverse 和 hard 投影拉开层级；页面 Agent 可以改变组件构图、尺寸、强调位置和装饰位置，具体强弱由页面职责决定。

## 组件视觉绑定

### 主题组件绑定

- 主题类名前缀：`.pc-*`。
- 保留通用页面骨架、组件语义和 HTML 层级；使用本主题前缀承载主题样式。
- 主题可以自由设计组件内部的构图、局部布局、内外边距、尺寸、错位和装饰，只要不新增页面壳、插槽或另一套组件语义。
- 组件选择仍由页面职责、事实语义和 `card-plan.json` 决定；主题配方只说明哪些视觉处理适合当前主题。

## 主题装饰

主题装饰方向：使用受控的纸张错位、阴影或轻微倾斜边缘。 纹理可使用细颗粒或纸张噪点。 允许加入轻微的纸张错位或倾斜感。

装饰应在 375×667 原尺寸下可感知，但具体载体、位置、尺寸、透明度和构图由页面 Agent 根据当前页面决定；可以使用背景层、伪元素或主题组件。装饰只承担氛围和层级，不承载事实，必须位于内容后方并保持文字可读。

## 主题视觉应用

- 使用主题 Token、组件前缀和主题装饰建立识别度；具体组件、构图和页面节奏由 AI 视觉技能根据事实决定。
- 使用 `accent / accent2 / surface / inverse` 形成层级对比：数字焦点、证据边界和结论收束都可以采用主题化处理，但不要求每页或每组固定出现某种组件。
- 主题视觉只承担层级与氛围，不承载事实；保留通用页面骨架和语义结构即可。
