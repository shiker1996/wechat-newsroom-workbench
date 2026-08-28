# 赤焰硬核 · Social AI Design Spec

> 主题 ID：crimson · 版本：1.0.1 · 目标：Social 图文视觉生成

## 主题定位

赤红、暗黑与亮黄构成的高冲击硬核主题。

设计重点：保持主题辨识度，同时让核心事实、关键数字、人物/组织、变化方向和限制条件成为视觉焦点。允许使用图标、徽章和箭头，但装饰必须服务于信息层级。

## 设计 Token

### 配色

| 语义 | 实际颜色 | 运行时变量 |
|---|---|---|
| 画布背景 | #130408 | var(--bg) |
| 卡片表面 | #2D0B14 | var(--surface) |
| 页面底色 | #22070E | var(--page) |
| 正文/标题 | #FFF1F4 | var(--ink) |
| 辅助文字 | #E29AAA | var(--muted) |
| 主强调色 | #FF2D55 | var(--accent) |
| 次强调色 | #FFD60A | var(--accent2) |
| 分隔线 | #7E1D32 | var(--line) |
| 深色表面反色文字 | #22070E | var(--inverse) |
| 代码/深色表面 | #090103 | var(--code) |

正文使用 var(--ink)，辅助信息使用 var(--muted)；深色表面必须使用 var(--inverse)，浅色表面不得使用反色文字。强调数字、价格变化、冲突和风险时使用 var(--accent2)，并先检查实际背景对比度。

### 字体与间距

- 字体：正文 sans；标题 sans。
- 字号档位：标题约 34px；小标题约 12px；正文参考 11px；辅助文字参考 10px。最小字号和最终范围以 `layout-guide.md` 与 AI 视觉技能为准。
- 行高：1.45；字距：-0.05em。
- 主题 Token：内容边距 18px；章节间距 24px；段落间距 12px；卡片间距 12px。
- AI 视觉页面仍以 8px 为基础网格，内容区建议使用 8px gap；主题 Token 是风格参考，不得造成溢出。

### 形状与效果

- 圆角：4px；边框：1px；阴影：hard。
- 主题视觉配方（仅影响外观，不是页面模板）：{
  "surface": "palette",
  "frame": "palette-frame",
  "decoration": "orbit",
  "eyebrow": "accent",
  "coverTitle": "poster",
  "coverSupport": "statement",
  "ending": "accent-fill",
  "list": "hard-accent",
  "code": "accent-panel"
}
- 主题效果：{
  "texture": "none",
  "decorationOpacity": 0.35,
  "contentTiltDeg": 0
}

### 组件级主题配置

以下配置决定组件的默认字体、字号档位、语义颜色和边框角色；具体内容仍由故事板事实决定：

```json
{}
```

## 页面结构边界

通用页面骨架、封面结构、页眉/内容区/底部导航、内容层数量、居中方式和画布尺寸由 AI 视觉生成技能内置的 `xhs-visual-contract.md` 与 `layout-guide.md` 统一定义。本主题不新增页面壳、插槽或页面角色模板；只提供本主题页眉类名、组件类名、Token 和装饰实现。生成完整 HTML 时保留通用结构，并使用本主题前缀类名承载主题样式。

## 组件视觉绑定

### 主题组件绑定

- 主题类名前缀：`.crim-*`。
- 通用组件的语义、HTML 层级和基础 CSS 以 `xhs-visual-contract.md` 为准；生成时将契约中的组件类名替换为本主题前缀，并保留同等语义结构。
- 本主题只覆盖组件的颜色、字体、边框、圆角、投影、渐变和装饰，不新增页面壳、插槽、布局容器或另一套组件目录。
- 组件选择仍由页面职责、事实语义和 `card-plan.json` 决定；主题配方只说明哪些视觉处理适合当前主题。

## 必须落地的装饰层

主题配方 decoration=orbit、装饰透明度 0.35 必须落地为可执行的主题装饰实现；本节给出每页至少一个可见装饰元素的实现方式，实际生成与门禁由 AI 视觉技能统一执行。装饰必须使用主题变量，不能只写“可添加装饰”而不落地 CSS。

使用页面伪元素建立细边框与轨道环：

```css
.page { position:relative; isolation:isolate; overflow:hidden; background:radial-gradient(circle at 85% 10%,color-mix(in srgb,var(--accent) 14%,transparent),transparent 55%),var(--page); }
.page::before { content:""; position:absolute; inset:16px; border:1px solid color-mix(in srgb,var(--accent) 32%,transparent); opacity:var(--decoration-opacity); pointer-events:none; z-index:0; }
.page::after { content:""; position:absolute; width:180px; height:180px; right:-72px; top:-58px; border:1px solid color-mix(in srgb,var(--accent) 76%,transparent); border-radius:50%; box-shadow:0 0 0 9px color-mix(in srgb,var(--accent2) 10%,transparent),0 0 28px color-mix(in srgb,var(--accent) 14%,transparent); opacity:var(--decoration-opacity); pointer-events:none; z-index:0; }
.page-body { position:relative; z-index:1; background:linear-gradient(135deg,transparent 0 70%,color-mix(in srgb,var(--accent) 5%,transparent) 70.4% 70.8%,transparent 71%); }
```

轨道环和细边框是主题识别元素，每页至少保留其中一项；装饰层必须位于内容后方，不得遮挡文字。

纹理：无额外纹理，优先使用渐变、边框或色块建立深度。

本主题装饰层只承担氛围和层级，不承载事实信息；通用安全、可读性和事实门禁由 AI 视觉技能与视觉契约统一执行。

## 主题视觉应用

- 使用主题 Token、组件前缀和主题装饰为通用组件建立识别度；具体组件仍按事实语义选择，不机械重复同一种视觉处理。
- 主题强调色、边框、圆角、投影和渐变只负责信息层级与氛围，不改变页面数量、页面角色、内容层数量或事实表达。

## 通用门禁引用

画布、安全区、字体范围、利用率、垂直居中、溢出/裁切/内部滚动和事实完整性由 AI 视觉技能、`layout-guide.md` 与 `xhs-visual-contract.md` 统一定义，本主题不重复声明。主题层只需确保其颜色语义、主题组件和装饰在这些通用门禁下仍保持可读、可见和不遮挡内容。

## 最小示例

```html
<div class="crim-feat-card">
  <div class="crim-feat-icon">✦</div>
  <div class="crim-feat-title">核心亮点</div>
  <div class="crim-feat-body">这里放事实清单和故事板允许表达的一到两句内容。</div>
</div>
```

该示例只说明主题类名和结构，不是固定页面模板；具体页面应根据 card-plan.json 的职责选择组件。
