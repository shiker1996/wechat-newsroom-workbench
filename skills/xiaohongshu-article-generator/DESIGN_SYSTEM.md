# 🎨 小红书图文设计系统 v3

**版本：** v3.0.0
**描述：** 6 套设计哲学，每套包含配色、CSS 类名、布局规范

---

## 快速索引

| 设计哲学 | Key | 主色 | 适用话题 |
|----------|-----|------|----------|
| 霓虹终端 | `neon` | `#00E5FF` | AI/极客/工具 |
| 东京之夜 | `tokyo-night` | `#7AA2F7` | 社区/协作/文艺 |
| 野兽派 | `brutalist` | `#FFD60A` | 硬核/开源/冲击 |
| 极光配色 | `solarized` | `#2AA198` | 绩效/管理/文化/科普 |
| 复古终端 | `retro-terminal` | `#00ff41` | 编程工具/开源/极客 |
| 纸艺暖调 | `paper-craft` | `#C0392B` | 生活好物/文创/种草 |
| 极简炭黑 | `charcoal` | `#1a1a1a` | 高端商务/极简风格 |
| 雾桃白桃 | `peach` | `#fff5f7` | 女性/生活/温柔风格 |
| 落日橙界 | `orange` | `#FF7A00` | 活力/运动/创意类 |
| 冰川冷调 | `ice-blue` | `#93C5FD` | 科技/专业/清新类 |
| 摩卡原木 | `mocha` | `#8B5C3F` | 手作/文艺/温暖治愈 |
| 芋泥暮色 | `lavender` | `#f5f0ff` | 梦幻/文艺/柔和色调 |
| 赤焰硬核 | `crimson` | `#FF2D55` | 热血/运动/硬核风格 |
| 月白清灰 | `bone-white` | `#f5f5f5` | 极简/文艺/清冷高级感 |

---

## 通用结构

所有设计哲学均以以下通用结构为基础，`{哲学前缀}` 替换为各套的缩写：

```html
<!-- 封面 -->
<div class="page page-cover">
  <span class="glass-tag">#热门</span>
  <span class="glass-hot">🔥 免费开源</span>
  <div class="cover-center">
    <div class="icon-circle">🚀</div>
    <div class="cover-title">标题</div>
    <div class="cover-divider"></div>
    <div class="cover-sub">副标题</div>
  </div>
  <div class="cover-bottom">
    <div class="cover-tags"><span class="xhs-tag">#标签</span></div>
    <div class="cover-date">2026.04.30</div>
  </div>
</div>

<!-- 内页 -->
<div class="page">
  <div class="page-inner">
    <div class="{prefix}-topbar">
      <span class="{prefix}-num">📊</span>
      <span class="{prefix}-title">页面标题</span>
      <span class="{prefix}-sub">Subtitle</span>
    </div>
    <div class="page-body" data-valign="center">
      <div class="page-content-stack"><!-- 内容块 --></div>
    </div>
    <div class="bottom-strip">
      <span class="bs-logo">🦊 仓库名</span>
      <span class="bs-right">向左滑动查看更多 →</span>
    </div>
  </div>
</div>
```

### 通用类名（所有哲学共享）

| 类名 | 用途 |
|------|------|
| `.page` `.page-cover` | 页面容器 |
| `.page-inner` | 内页容器 |
| `.page-body` | 正文可用区，负责垂直对齐 |
| `.page-content-stack` | 正文内容栈，负责卡片间距 |
| `.bottom-strip` | 底部导航条 |
| `.bs-logo` / `.bs-right` | 底部文字 |
| `.glass-tag` / `.glass-hot` | 封面角标 |
| `.cover-center` / `.cover-bottom` | 封面布局 |
| `.icon-circle` | 图标容器 |
| `.cover-title` / `.cover-sub` / `.cover-divider` | 封面文字 |
| `.cover-tags` / `.xhs-tag` | 标签 |
| `.cover-date` | 日期 |
| `.stat-row` | 数据卡横向容器 |
| `.scene-row` | 场景卡横向容器 |
| `.section-hdr` | 段落标题（sh-dot + sh-label） |
| `.sh-dot` / `.sh-label` | 标题装饰与文字 |

### 页面布局规范

- 固定尺寸：375×667px，viewport `width=375,height=667`
- 每页围绕一个核心信息组合内容块，不强制固定卡片数量
- 卡片竖向堆叠，stat-row / scene-row 可横向并排
- `.page-inner` 使用 `grid-template-rows: auto minmax(0, 1fr) auto`
- `.page-body` 使用 `min-height:0; display:grid; align-items:center`，正文块统一包进 `.page-content-stack`
- 分隔线必须放在 header 内；`.page-inner` 只能有 header/body/footer 三个直接子元素，避免隐式网格行把正文下推
- 内容栈超过正文区 90% 时切换 `data-valign="start"`；禁止伪元素占位和 `space-between`
- 页面是否过松或溢出必须以 `scripts/layout-audit.mjs` 的浏览器实测结果为准
- deviceScaleFactor: 3（输出 1125×2001px）

---

## 霓虹终端 neon

**Key：** `neon` · **视觉：** 深空 · 霓虹光晕 · 赛博朋克

### 配色
```css
--void:     #080612;
--deep:     #0d0b1e;
--cyan:     #00E5FF;
--magenta:  #FF0080;
--lavender: #E8E0FF;
--terminal: #0f0f1a;
```

### CSS 类名

**页面结构**
```css
.grid-bg       /* 背景网格点阵 */
```

**顶部栏**
```css
.neon-topbar
.nt-num / .nt-title / .nt-sub
```

**数据卡片**
```css
.neon-stat-row / .neon-stat
.ns-num / .ns-label
```

**亮点卡片**
```css
.neon-card
.nc-icon / .nc-title / .nc-body
```

**引言 / 代码块**
```css
.neon-quote / .nq-text / .nq-author
.term-block / .tb-comment / .tb-keyword / .tb-string / .tb-prompt
```

**对比表**
```css
.neon-compare / .nc-table / .nc-table th / .nc-arrow
```

**场景卡 / 总结 / CTA**
```css
.scene-row / .scene-card
.neon-summary / .neon-cta
```

**标签**
```css
.tags-row / .xhs-tag
```

**步骤卡**
```css
.neon-step-row  /* flex 横向容器，gap:8px */
.neon-step     /* 序号 + 标题 + 简述 */
.ns-num        /* 步骤数字（圆形霓虹青 + 发光）*/
.ns-title      /* 步骤标题 */
.ns-body       /* 步骤描述 */
```

**时间线卡**
```css
.neon-tl       /* 时间线容器 */
.neon-tl-node  /* 时间节点（霓虹青圆点 + 发光）*/
.neon-tl-time  /* 时间标签 */
.neon-tl-title /* 事件标题 */
.neon-tl-desc  /* 事件描述 */
```

**人物卡**
```css
.neon-profile  /* 玻璃态人物卡 */
.npf-avatar    /* 头像容器（圆形）*/
.npf-name      /* 姓名 */
.npf-title     /* 身份/职位 */
.npf-quote     /* 引言 */
```

**榜单卡**
```css
.neon-list     /* 榜单行 */
.nl-rank       /* 排名序号（霓虹青大字）*/
.nl-title      /* 条目名称 */
.nl-desc       /* 条目描述 */
```

**提示卡**
```css
.neon-tip      /* 玻璃态提示卡，左边框霓虹品红*/
.nti-icon      /* 提示图标 */
.nti-title     /* 提示标题 */
.nti-body      /* 提示正文 */
```

**勋章卡**
```css
.neon-badge    /* 横向排列容器 */
.nb-tag        /* 勋章标签（霓虹青边框胶囊）*/
```

---

## 东京之夜 tokyo-night

**Key：** `tokyo-night` · **视觉：** 深蓝紫 · 柔和大紫 · 朦胧月亮

### 配色
```css
--tokyo-bg:     #1a1b2e;
--tokyo-card:   #25273e;
--tokyo-purple: #bb86fc;
--tokyo-pink:   #ff79c6;
--tokyo-blue:   #7aa2f7;
--tokyo-cyan:   #7dcfff;
--tokyo-text:   #e2e2e2;
--tokyo-dim:    #565f89;
```

### CSS 类名

**页面结构**
```css
.tokyo-grid-bg
```

**顶部栏**
```css
.tokyo-topbar
.tt-num / .tt-title / .tt-sub
```

**数据卡片**
```css
.tk-stat-row / .tk-stat
.tk-stat-num / .tk-stat-label
```

**亮点卡片**
```css
.tk-card
.tk-card-icon / .tk-card-title / .tk-card-body
```

**引言 / 代码块**
```css
.tk-quote / .tk-quote-text / .tk-quote-author
.tk-code / .tk-code .c / .tk-code .k / .tk-code .s
```

**对比表**
```css
.tk-compare / .tk-table / .tk-table th / .tk-table .arr
```

**场景卡 / 总结 / CTA**
```css
.tk-scene-row / .tk-scene
.tk-scene-icon / .tk-scene-title / .tk-scene-desc
.tk-summary / .tk-sum-icon / .tk-sum-text / .tk-btn
```

**标签**
```css
.xhs-tag
```

**步骤卡**
```css
.tk-step-row
.tk-step
.tk-step-num   /* 柔紫色圆角序号 */
.tk-step-title
.tk-step-body
```

**时间线卡**
```css
.tk-tl
.tk-tl-node    /* 樱花粉圆点 */
.tk-tl-time
.tk-tl-title
.tk-tl-desc
```

**人物卡**
```css
.tk-profile
.tkp-avatar
.tkp-name
.tkp-title
.tkp-quote
```

**榜单卡**
```css
.tk-list
.tkl-rank      /* 柔紫色排名 */
.tkl-title
.tkl-desc
```

**提示卡**
```css
.tk-tip        /* 樱花粉左边框 */
.tki-icon
.tki-title
.tki-body
```

**勋章卡**
```css
.tk-badge
.tkb-tag       /* 柔紫/樱花粉边框胶囊 */
```

---

## 野兽派 brutalist

**Key：** `brutalist` · **视觉：** 高对比 · 黑色粗边框 · 无圆角

### 配色
```css
--brut-black:  #1a1a1a;
--brut-white:  #f5f5f0;
--brut-yellow: #ffd60a;
--brut-red:    #e63946;
--brut-blue:   #457b9d;
--brut-card:   #eeeee8;
```

### CSS 类名

**页面结构**
```css
/* 背景：米白色 */
```

**顶部栏**
```css
.bt-topbar
.bt-num / .bt-title / .bt-sub
```

**数据卡片**（无圆角，border-radius:0 + 粗黑边框 + 硬阴影）
```css
.bt-stat-row / .bt-stat
.bt-stat-num / .bt-stat-label
```

**亮点卡片**（无圆角，border:2px solid #1a1a1a + box-shadow:4px 4px 0 #1a1a1a）
```css
.bt-card
.bt-card-icon / .bt-card-title / .bt-card-body
```

**引言 / 代码块**（红色左边框 6px 粗）
```css
.bt-quote / .bt-quote-text / .bt-quote-author
.bt-code
```

**对比表**
```css
.bt-compare / .bt-table / .bt-table th
```

**场景卡 / 总结 / CTA**
```css
.bt-scene-row / .bt-scene     /* 黄色背景 + 黑色边框 */
.bt-summary / .bt-sum-icon / .bt-sum-text   /* 红色背景 */
.bt-btn                           /* 红色背景 + 黑色边框 */
```

**标签**
```css
.xhs-tag   /* 黄色背景 + 黑色边框 + uppercase */
```

**步骤卡**
```css
.bt-step-row
.bt-step       /* 无圆角，硬黑边框 */
.bt-step-num   /* 亮黄圆形序号 + 黑边框 */
.bt-step-title
.bt-step-body
```

**时间线卡**
```css
.bt-tl         /* 无圆角 */
.bt-tl-node    /* 红色/黄色圆点 + 黑边框 */
.bt-tl-time
.bt-tl-title
.bt-tl-desc
```

**人物卡**
```css
.bt-profile     /* 米白卡片 + 粗黑边框 + 硬阴影 */
.btp-avatar    /* 方形头像 + 黑边框 */
.btp-name
.btp-title
.btp-quote
```

**榜单卡**
```css
.bt-list        /* 无圆角 + 粗黑边框 */
.btl-rank       /* 亮黄大字 + 黑边框 */
.btl-title
.btl-desc
```

**提示卡**
```css
.bt-tip         /* 红色左边框 6px 粗 + 黑边框 */
.bti-icon
.bti-title
.bti-body
```

**勋章卡**
```css
.bt-badge
.btb-tag        /* 黄色背景 + 黑色边框 + uppercase */
```

---

## 极光配色 solarized

**Key：** `solarized` · **视觉：** 暖调自然光 · 琥珀色光晕 · 环保系

### 配色
```css
--bg-dark:    #002b36;
--bg-light:   #fdf6e3;
--card:       #eee8d5;
--primary:    #2AA198;
--secondary:  #DC322F;
--accent:     #B58900;
--text:       #073642;
--muted:      #586e75;
```

### CSS 类名

**页面结构**
```css
.page-cover     /* 暗色封面 + 径向光晕 */
.sol-bg         /* 封面背景渐变层 */
```

**顶部栏**
```css
.sol-topbar
.so-num / .so-title / .so-sub
```

**数据卡片**
```css
.sol-stat-row / .sol-stat
.ss-num / .ss-label
```

**亮点卡片**
```css
.sol-card
.sc-icon / .sc-title / .sc-body
```

**引言 / 代码块**
```css
.sol-quote / .sq-text / .sq-author
.sol-code / .sol-code .c / .sol-code .k / .sol-code .s
```

**对比表**
```css
.sol-compare / .so-table / .so-table th / .so-arrow
```

**场景卡 / 总结 / CTA**
```css
.sol-scene-row / .sol-scene
.sol-summary / .sol-cta
```

**标签**
```css
.xhs-tag
```

**步骤卡**
```css
.sol-step-row
.sol-step
.sol-step-num   /* 薄荷绿圆形序号 */
.sol-step-title
.sol-step-body
```

**时间线卡**
```css
.sol-tl
.sol-tl-node    /* 薄荷绿圆点 */
.sol-tl-time
.sol-tl-title
.sol-tl-desc
```

**人物卡**
```css
.sol-profile
.sol-pf-avatar
.sol-pf-name
.sol-pf-title
.sol-pf-quote
```

**榜单卡**
```css
.sol-list
.soll-rank      /* 薄荷绿排名 */
.soll-title
.soll-desc
```

**提示卡**
```css
.sol-tip        /* 琥珀色左边框 */
.soti-icon
.soti-title
.soti-body
```

**勋章卡**
```css
.sol-badge
.solb-tag       /* 琥珀色/薄荷绿边框胶囊 */
```

---

## 复古终端 retro-terminal

**Key：** `retro-terminal` · **视觉：** 磷光绿 · CRT扫描线 · 赛博复古

### 配色
```css
--void:     #000d00;
--bg:       #001a00;
--primary:  #00ff41;
--secondary: #00cc33;
--glow:     rgba(0,255,65,0.4);
```

### CSS 类名

**页面结构**（CRT扫描线通过 `.page::after` 实现）
```css
.page-cover    /* 墨绿封面 + 网格点阵 */
.rt-cover-grid /* 封面点阵网格叠加 */
```

**顶部栏**
```css
.rt-topbar
.rt-num / .rt-title / .rt-sub
```

**数据卡片**
```css
.rt-stat-row / .rt-stat
.rt-stat-num / .rt-stat-label
```

**亮点卡片**
```css
.rt-card
.rt-card-icon / .rt-card-title / .rt-card-body
```

**引言 / 代码块**
```css
.rt-quote / .rt-quote-text / .rt-quote-author
.rt-code / .rt-code .c / .rt-code .k / .rt-code .s
```

**对比表**
```css
.rt-compare / .rt-table / .rt-arrow
```

**场景卡 / 总结 / CTA**
```css
.rt-scene-row / .rt-scene
.rt-summary / .rt-cta
```

**标签**
```css
.xhs-tag
```

**步骤卡**
```css
.rt-step-row
.rt-step
.rt-step-num   /* 磷光绿圆形序号 + 发光 */
.rt-step-title
.rt-step-body
```

**时间线卡**
```css
.rt-tl
.rt-tl-node    /* 磷光绿圆点 + 发光 */
.rt-tl-time
.rt-tl-title
.rt-tl-desc
```

**人物卡**
```css
.rt-profile
.rt-pf-avatar  /* 磷光绿边框 + 内发光 */
.rt-pf-name
.rt-pf-title
.rt-pf-quote
```

**榜单卡**
```css
.rt-list
.rtl-rank       /* 磷光绿大字 */
.rtl-title
.rtl-desc
```

**提示卡**
```css
.rt-tip        /* 磷光绿左边框发光 */
.rti-icon
.rti-title
.rti-body
```

**勋章卡**
```css
.rt-badge
.rtb-tag        /* 磷光绿边框胶囊 */
```

---

## 纸艺暖调 paper-craft

**Key：** `paper-craft` · **视觉：** 米白纸艺 · 层叠阴影 · 红棕撞色

### 配色
```css
--bg:       #fdf9f3;
--card:     #ffffff;
--border:   #e8ddd0;
--shadow:   #d4c4b0;
--primary:  #C0392B;
--secondary: #E67E22;
--accent:   #F1C40F;
--text:     #2c1810;
--muted:    #8b7355;
```

### CSS 类名

**页面结构**
```css
.page-cover    /* 米白封面 + 纸张点阵纹理 */
.pc-paper-bg    /* 纸张纹理背景 */
```

**顶部栏**
```css
.pc-topbar
.pc-num / .pc-title / .pc-sub
```

**数据卡片**
```css
.pc-stat-row / .pc-stat
.ps-num / .ps-label
```

**亮点卡片**
```css
.pc-card
.pc-icon / .pc-ctitle / .pc-cbody
```

**引言 / 代码块**
```css
.pc-quote / .pc-qtext / .pc-qauthor
.pc-code / .pc-code .c / .pc-code .k / .pc-code .s
```

**对比表**
```css
.pc-compare / .pc-table / .pc-table th / .pc-arrow
```

**场景卡 / 总结 / CTA**
```css
.pc-scene-row / .pc-scene
.pc-summary / .pc-cta
```

**标签**
```css
.xhs-tag
```

**步骤卡**
```css
.pc-step-row
.pc-step
.pc-step-num   /* 中国红圆形序号 + 双层阴影 */
.pc-step-title
.pc-step-body
```

**时间线卡**
```css
.pc-tl
.pc-tl-node    /* 中国红/橙色圆点 + 纸艺阴影 */
.pc-tl-time
.pc-tl-title
.pc-tl-desc
```

**人物卡**
```css
.pc-profile     /* 白色卡片 + 双层阴影 */
.pc-pf-avatar  /* 圆形头像 + 中国红边框 + 阴影 */
.pc-pf-name
.pc-pf-title
.pc-pf-quote
```

**榜单卡**
```css
.pc-list
.pcl-rank       /* 中国红/橙色大字 */
.pcl-title
.pcl-desc
```

**提示卡**
```css
.pc-tip         /* 橙色/中国红左边框 + 纸艺阴影 */
.pcti-icon
.pcti-title
.pcti-body
```

**勋章卡**
```css
.pc-badge
.pcb-tag        /* 橙/黄/红色背景 + 浅棕边框 */
```

## 极简炭黑 charcoal

**Key：** `charcoal` · **视觉：** 冷灰 · 极简留白 · 高端商务

### 配色

```css
--charcoal-bg:    #1a1a1a;
--charcoal-card:  #2C2C2C;
--charcoal-light: #3a3a3a;
--charcoal-accent: #2C2C2C;
--charcoal-text:  #e5e5e5;
--charcoal-muted: #888888;
--charcoal-border: #404040;
```

### CSS 类名

**顶部栏**

```css
.char-topbar
.ch-num / .ch-title / .ch-sub
```

**数据卡片**

```css
.ch-stat-row / .ch-stat
.ch-stat-num / .ch-stat-label
```

**亮点卡片**

```css
.ch-card
.ch-card-icon / .ch-card-title / .ch-card-body
```

**步骤卡**

```css
.ch-step-row
.ch-step
.ch-step-num   /* 炭灰圆形序号 */
.ch-step-title
.ch-step-body
```

**引言卡**

```css
.ch-quote / .ch-quote-text / .ch-quote-author
```

**提示卡**

```css
.ch-tip
.ch-tip-icon / .ch-tip-title / .ch-tip-body
```

**场景卡 / 总结 / CTA**

```css
.ch-scene-row / .ch-scene
.ch-summary / .ch-cta
```

**标签**

```css
.xhs-tag   /* 炭灰背景 + 细边框 */
```

**人物卡**

```css
.ch-profile
.ch-pf-avatar
.ch-pf-name / .ch-pf-title / .ch-pf-quote
```

**时间线卡**

```css
.ch-tl / .ch-tl-node / .ch-tl-time / .ch-tl-title / .ch-tl-desc
```

**榜单卡**

```css
.ch-list / .chl-rank / .chl-title / .chl-desc
```

**提示卡**

```css
.ch-tip / .ch-ti-icon / .ch-ti-title / .ch-ti-body
```

**勋章卡**

```css
.ch-badge / .chb-tag
```

---

## 雾桃白桃 peach

**Key：** `peach` · **视觉：** 蜜桃粉 · 温柔朦胧 · 柔雾感

### 配色

```css
--peach-bg:     #fff5f7;
--peach-card:   #FFB7C5;
--peach-light:  #ffd9e4;
--peach-text:   #5c3a4a;
--peach-muted:  #a06b7d;
--peach-accent: #FF9AB8;
```

### CSS 类名

**顶部栏**

```css
.peach-topbar
.pt-num / .pt-title / .pt-sub
```


**数据卡片**

```css
.pt-stat-row / .pt-stat
.pt-stat-num / .pt-stat-label
```

**亮点卡片**

```css
.pt-card
.pt-card-icon / .pt-card-title / .pt-card-body
```

**步骤卡**

```css
.pt-step-row
.pt-step
.pt-step-num   /* 蜜桃粉圆形序号 */
.pt-step-title
.pt-step-body
```

**引言卡**

```css
.pt-quote / .pt-quote-text / .pt-quote-author
```

**提示卡**

```css
.pt-tip
.pt-tip-icon / .pt-tip-title / .pt-tip-body
```

**场景卡 / 总结 / CTA**

```css
.pt-scene-row / .pt-scene
.pt-summary / .pt-cta
```

**标签**

```css
.xhs-tag   /* 蜜桃粉背景 */
```


**人物卡**

```css
.pt-profile
.pt-pf-avatar
.pt-pf-name / .pt-pf-title / .pt-pf-quote
```

**时间线卡**

```css
.pt-tl / .pt-tl-node / .pt-tl-time / .pt-tl-title / .pt-tl-desc
```

**榜单卡**

```css
.pt-list / .ptl-rank / .ptl-title / .ptl-desc
```

**提示卡**

```css
.pt-tip / .pt-ti-icon / .pt-ti-title / .pt-ti-body
```

**勋章卡**

```css
.pt-badge / .ptb-tag
```


---

## 落日橙界 orange

**Key：** `orange` · **视觉：** 橘橙 · 暖色活力 · 落日感

### 配色

```css
--orange-bg:     #1a1200;
--orange-card:   #FF7A00;
--orange-light:  #ff9a40;
--orange-text:   #fff5e6;
--orange-muted:  #cc8800;
--orange-accent: #FF7A00;
```

### CSS 类名

**顶部栏**

```css
.orange-topbar
.or-num / .or-title / .or-sub
```


**数据卡片**

```css
.or-stat-row / .or-stat
.or-stat-num / .or-stat-label
```

**亮点卡片**

```css
.or-card
.or-card-icon / .or-card-title / .or-card-body
```

**步骤卡**

```css
.or-step-row
.or-step
.or-step-num   /* 橘橙色圆形序号 */
.or-step-title
.or-step-body
```

**引言卡**

```css
.or-quote / .or-quote-text / .or-quote-author
```

**提示卡**

```css
.or-tip
.or-tip-icon / .or-tip-title / .or-tip-body
```

**场景卡 / 总结 / CTA**

```css
.or-scene-row / .or-scene
.or-summary / .or-cta
```


**标签**

```css
.xhs-tag   /* 橘橙背景 */
```


**人物卡**

```css
.or-profile
.or-pf-avatar
.or-pf-name / .or-pf-title / .or-pf-quote
```

**时间线卡**

```css
.or-tl / .or-tl-node / .or-tl-time / .or-tl-title / .or-tl-desc
```

**榜单卡**

```css
.or-list / .orl-rank / .orl-title / .orl-desc
```

**提示卡**

```css
.or-tip / .or-ti-icon / .or-ti-title / .or-ti-body
```

**勋章卡**

```css
.or-badge / .orb-tag
```


---

## 冰川冷调 ice-blue

**Key：** `ice-blue` · **视觉：** 浅蓝冷调 · 清新专业 · 冰感

### 配色

```css
--ice-bg:       #f0f5ff;
--ice-card:     #93C5FD;
--ice-light:    #bfdbfe;
--ice-text:     #1e3a5f;
--ice-muted:    #6b8cae;
--ice-accent:   #3B82F6;
```

### CSS 类名

**顶部栏**

```css
.ice-topbar
.ic-num / .ic-title / .ic-sub
```


**数据卡片**

```css
.ic-stat-row / .ic-stat
.ic-stat-num / .ic-stat-label
```

**亮点卡片**

```css
.ic-card
.ic-card-icon / .ic-card-title / .ic-card-body
```

**步骤卡**

```css
.ic-step-row
.ic-step
.ic-step-num   /* 浅蓝圆形序号 */
.ic-step-title
.ic-step-body
```

**引言卡**

```css
.ic-quote / .ic-quote-text / .ic-quote-author
```

**提示卡**

```css
.ic-tip
.ic-tip-icon / .ic-tip-title / .ic-tip-body
```

**场景卡 / 总结 / CTA**

```css
.ic-scene-row / .ic-scene
.ic-summary / .ic-cta
```

**标签**

```css
.xhs-tag   /* 浅蓝背景 */
```


**人物卡**

```css
.ic-profile
.ic-pf-avatar
.ic-pf-name / .ic-pf-title / .ic-pf-quote
```

**时间线卡**

```css
.ic-tl / .ic-tl-node / .ic-tl-time / .ic-tl-title / .ic-tl-desc
```

**榜单卡**

```css
.ic-list / .icl-rank / .icl-title / .icl-desc
```

**提示卡**

```css
.ic-tip / .ic-ti-icon / .ic-ti-title / .ic-ti-body
```

**勋章卡**

```css
.ic-badge / .icb-tag
```


---



### 参考布局（按内容选用）

冰川冷调可从以下内容块中选择 2-4 类组合，不要求每页全部出现。内容应从顶部自然排布，最终以浏览器布局审计为准。

**可选结构**：

`
每页结构（从上到下）：

1. 主卖点卡 (ic-card + 左边框3px accent)
   图标 + 标题 + 1-2 句核心卖点
   功能：一句话抓住注意力

2. 数据/统计行 (ic-stat-row, 2-3列并排)
   仅展示素材中有价值的数据，不为填充而造数字
   内容：图标/数字 + 短标签
   功能：视觉填充 + 数据感

3. 详细功能卡 (ic-card)
   2-4 个 bullet point（用 • 或 emoji 分行）
   功能：干货主体，提供信息深度

4. 可选提示/使用场景卡 (ic-tip)
   左边框 tip + 场景/避坑建议
   功能：只在确有场景或避坑信息时补充
`

**关键参数**：
- page-body: min-height:0 / display:grid / align-items:center / overflow:hidden
- page-content-stack: width:100% / display:flex / flex-direction:column / gap:8px
- gap: 7-8px
- 卡片数量由内容高度决定；生成后运行 `scripts/layout-audit.mjs`
- 主卖点卡添加 border-left:3px solid var(--ice-accent)
## 摩卡原木 mocha

**Key：** `mocha` · **视觉：** 棕咖暖调 · 原木质感 · 温暖治愈

### 配色

```css
--mocha-bg:     #faf6f1;
--mocha-card:   #8B5C3F;
--mocha-light:  #a0714f;
--mocha-text:   #3d2b22;
--mocha-muted:  #7a5240;
--mocha-accent: #6d4630;
```

### CSS 类名

**顶部栏**

```css
.mocha-topbar
.mc-num / .mc-title / .mc-sub
```

**数据卡片**

```css
.mc-stat-row / .mc-stat
.mc-stat-num / .mc-stat-label
```


**亮点卡片**

```css
.mc-card
.mc-card-icon / .mc-card-title / .mc-card-body
```

**步骤卡**

```css
.mc-step-row
.mc-step
.mc-step-num   /* 棕咖圆形序号 */
.mc-step-title
.mc-step-body
```

**引言卡**

```css
.mc-quote / .mc-quote-text / .mc-quote-author
```

**提示卡**

```css
.mc-tip
.mc-tip-icon / .mc-tip-title / .mc-tip-body
```

**场景卡 / 总结 / CTA**

```css
.mc-scene-row / .mc-scene
.mc-summary / .mc-cta
```

**标签**

```css
.xhs-tag   /* 棕咖背景 */
```

**人物卡**

```css
.mc-profile
.mc-pf-avatar
.mc-pf-name / .mc-pf-title / .mc-pf-quote
```

**时间线卡**

```css
.mc-tl / .mc-tl-node / .mc-tl-time / .mc-tl-title / .mc-tl-desc
```

**榜单卡**

```css
.mc-list / .mcl-rank / .mcl-title / .mcl-desc
```

**提示卡**

```css
.mc-tip / .mc-ti-icon / .mc-ti-title / .mc-ti-body
```

**勋章卡**

```css
.mc-badge / .mcb-tag
```

---

## 芋泥暮色 lavender

**Key：** `lavender` · **视觉：** 淡紫温柔 · 梦幻朦胧 · 暮色感

### 配色

```css
--lav-bg:     #f5f0ff;
--lav-card:   #B986F8;
--lav-light:  #d4b3ff;
--lav-text:   #3d2d52;
--lav-muted:  #8a6aab;
--lav-accent: #9b59d0;
```

### CSS 类名

**顶部栏**

```css
.lav-topbar
.lv-num / .lv-title / .lv-sub
```

**数据卡片**

```css
.lv-stat-row / .lv-stat
.lv-stat-num / .lv-stat-label
```


**亮点卡片**

```css
.lv-card
.lv-card-icon / .lv-card-title / .lv-card-body
```

**步骤卡**

```css
.lv-step-row
.lv-step
.lv-step-num   /* 淡紫圆形序号 */
.lv-step-title
.lv-step-body
```

**引言卡**

```css
.lv-quote / .lv-quote-text / .lv-quote-author
```

**提示卡**

```css
.lv-tip
.lv-tip-icon / .lv-tip-title / .lv-tip-body
```

**场景卡 / 总结 / CTA**

```css
.lv-scene-row / .lv-scene
.lv-summary / .lv-cta
```

**标签**

```css
.xhs-tag   /* 淡紫背景 */
```

**人物卡**

```css
.lv-profile
.lv-pf-avatar
.lv-pf-name / .lv-pf-title / .lv-pf-quote
```

**时间线卡**

```css
.lv-tl / .lv-tl-node / .lv-tl-time / .lv-tl-title / .lv-tl-desc
```

**榜单卡**

```css
.lv-list / .lvl-rank / .lvl-title / .lvl-desc
```

**提示卡**

```css
.lv-tip / .lv-ti-icon / .lv-ti-title / .lv-ti-body
```

**勋章卡**

```css
.lv-badge / .lvb-tag
```

---

## 赤焰硬核 crimson

**Key：** `crimson` · **视觉：** 焰红 · 高强冲击 · 硬核热血

### 配色

```css
--crim-bg:     #1a0508;
--crim-card:   #FF2D55;
--crim-light:  #ff5c7a;
--crim-text:   #fff0f2;
--crim-muted:  #cc2244;
--crim-accent: #FF2D55;
```

### CSS 类名

**顶部栏**

```css
.crim-topbar
.cr-num / .cr-title / .cr-sub
```


**数据卡片**

```css
.cr-stat-row / .cr-stat
.cr-stat-num / .cr-stat-label
```

**亮点卡片**

```css
.cr-card
.cr-card-icon / .cr-card-title / .cr-card-body
```

**步骤卡**

```css
.cr-step-row
.cr-step
.cr-step-num   /* 焰红圆形序号 */
.cr-step-title
.cr-step-body
```

**引言卡**

```css
.cr-quote / .cr-quote-text / .cr-quote-author
```

**提示卡**

```css
.cr-tip
.cr-tip-icon / .cr-tip-title / .cr-tip-body
```

**场景卡 / 总结 / CTA**

```css
.cr-scene-row / .cr-scene
.cr-summary / .cr-cta
```

**标签**

```css
.xhs-tag   /* 焰红背景 */
```

**人物卡**

```css
.cr-profile
.cr-pf-avatar
.cr-pf-name / .cr-pf-title / .cr-pf-quote
```

**时间线卡**

```css
.cr-tl / .cr-tl-node / .cr-tl-time / .cr-tl-title / .cr-tl-desc
```

**榜单卡**

```css
.cr-list / .crl-rank / .crl-title / .crl-desc
```

**提示卡**

```css
.cr-tip / .cr-ti-icon / .cr-ti-title / .cr-ti-body
```

**勋章卡**

```css
.cr-badge / .crb-tag
```

---

## 月白清灰 bone-white

**Key：** `bone-white` · **视觉：** 月白淡灰 · 高级极简 · 清冷文艺

### 配色

```css
--bone-bg:     #f5f5f5;
--bone-card:   #E5E7EB;
--bone-light:  #d1d5db;
--bone-text:   #374151;
--bone-muted:  #9ca3af;
--bone-accent: #6b7280;
```

### CSS 类名

**顶部栏**

```css
.bone-topbar
.bw-num / .bw-title / .bw-sub
```


**数据卡片**

```css
.bw-stat-row / .bw-stat
.bw-stat-num / .bw-stat-label
```

**亮点卡片**

```css
.bw-card
.bw-card-icon / .bw-card-title / .bw-card-body
```

**步骤卡**

```css
.bw-step-row
.bw-step
.bw-step-num   /* 浅灰圆形序号 */
.bw-step-title
.bw-step-body
```

**引言卡**

```css
.bw-quote / .bw-quote-text / .bw-quote-author
```

**提示卡**

```css
.bw-tip
.bw-tip-icon / .bw-tip-title / .bw-tip-body
```

**场景卡 / 总结 / CTA**

```css
.bw-scene-row / .bw-scene
.bw-summary / .bw-cta
```

**标签**

```css
.xhs-tag   /* 浅灰背景 */
```

**人物卡**

```css
.bw-profile
.bw-pf-avatar
.bw-pf-name / .bw-pf-title / .bw-pf-quote
```

**时间线卡**

```css
.bw-tl / .bw-tl-node / .bw-tl-time / .bw-tl-title / .bw-tl-desc
```

**榜单卡**

```css
.bw-list / .bwl-rank / .bwl-title / .bwl-desc
```

**提示卡**

```css
.bw-tip / .bw-ti-icon / .bw-ti-title / .bw-ti-body
```

**勋章卡**

```css
.bw-badge / .bwb-tag
```

---

## 通用卡片类型参考

以下为所有设计哲学共享的通用 CSS 类名，各套在前面章节定义自身前缀对应的专属版本（如 `.neon-stat-row` / `.tk-stat-row` / `.bt-stat-row`）。

### 横向容器

| 容器类名 | 内容 | 布局 |
|----------|------|------|
| `.stat-row` | `.stat-card` × N | flex 横向，gap:8px |
| `.scene-row` | `.scene-card` × N | flex 横向，gap:8px |

### 通用卡片 CSS

```css
/* ========== 数据卡 ========== */
.stat-card { padding:10px 8px;text-align:center;flex:1; }
.stat-num  { font-size:22px;font-weight:bold;display:block; }
.stat-label { font-size:10px;letter-spacing:0.5px;display:block;margin-top:2px; }

/* ========== 亮点卡 ========== */
.feat-card { padding:12px; }
.feat-icon { font-size:20px;margin-bottom:6px; }
.feat-title { font-size:13px;font-weight:bold;margin-bottom:4px; }
.feat-body { font-size:11px;line-height:1.5; }

/* ========== 步骤卡 ========== */
.step-card { display:flex;align-items:flex-start;gap:10px;padding:10px 12px; }
.step-num  { font-size:18px;font-weight:bold;flex-shrink:0; }
.step-title { font-size:13px;font-weight:bold;margin-bottom:2px; }
.step-body { font-size:11px;line-height:1.5; }

/* ========== 时间线卡 ========== */
.timeline-card { display:flex;gap:10px;padding:8px 0;border-bottom:1px solid rgba(128,128,128,0.2); }
.tl-node  { width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:4px; }
.tl-content { flex:1; }
.tl-time { font-size:10px;letter-spacing:0.5px;margin-bottom:2px; }
.tl-title { font-size:12px;font-weight:bold;margin-bottom:2px; }
.tl-desc  { font-size:11px;line-height:1.5; }

/* ========== 引言卡 ========== */
.quote-card { border-left:3px solid var(--primary);padding:8px 12px; }
.quote-text { font-size:12px;line-height:1.6;font-style:italic; }
.quote-author { font-size:10px;margin-top:4px;letter-spacing:0.5px; }

/* ========== 对比卡 ========== */
.compare-card { overflow:hidden; }
.compare-table { width:100%;border-collapse:collapse;font-size:11px; }
.compare-table th { padding:8px 10px;text-align:left;font-size:10px;letter-spacing:0.5px; }
.compare-table td { padding:8px 10px;vertical-align:top; }
.compare-arrow { text-align:center;padding:0 6px; }

/* ========== 总结卡 ========== */
.summary-card { padding:12px;text-align:center; }
.sum-icon { font-size:20px;margin-bottom:6px; }
.sum-text { font-size:13px;font-weight:bold;line-height:1.5; }

/* ========== CTA卡 ========== */
.cta-card { padding:12px;text-align:center; }
.cta-text { font-size:14px;font-weight:bold; }
.cta-sub  { font-size:10px;margin-top:4px; }

/* ========== 代码卡 ========== */
.code-card { background:#0d0b1e;border:1px solid rgba(255,255,255,0.1);padding:10px 12px;font-family:'Courier New',monospace;font-size:11px;line-height:1.7;overflow-x:auto; }
.code-lang { font-size:9px;letter-spacing:1px;margin-bottom:6px;opacity:0.6; }

/* ========== 人物卡 ========== */
.profile-card { display:flex;gap:12px;padding:12px;align-items:flex-start; }
.profile-avatar { width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0; }
.profile-info { flex:1; }
.profile-name { font-size:12px;font-weight:bold;margin-bottom:2px; }
.profile-title { font-size:10px;opacity:0.7;margin-bottom:6px; }
.profile-quote { font-size:11px;line-height:1.5;font-style:italic; }

/* ========== 榜单卡 ========== */
.list-card { display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(128,128,128,0.15); }
.list-rank { font-size:16px;font-weight:bold;width:24px;text-align:center;flex-shrink:0; }
.list-content { flex:1; }
.list-title { font-size:12px;font-weight:bold;margin-bottom:2px; }
.list-desc { font-size:10px;line-height:1.4; }

/* ========== 提示卡 ========== */
.tip-card { display:flex;gap:10px;padding:10px 12px; }
.tip-icon { font-size:16px;flex-shrink:0; }
.tip-content { flex:1; }
.tip-title { font-size:12px;font-weight:bold;margin-bottom:2px; }
.tip-body { font-size:11px;line-height:1.5; }

/* ========== 勋章卡 ========== */
.badge-card { display:flex;flex-wrap:wrap;gap:6px;padding:10px 0; }
.badge-tag { font-size:10px;padding:3px 9px;border-radius:20px;letter-spacing:0.5px; }
```

### 通用卡片一览

| 类名 | 名称 | 内容结构 |
|------|------|----------|
| `.stat-card` | 数据卡 | 大数字 + 小标签 |
| `.feat-card` | 亮点卡 | 图标 + 标题 + 描述 |
| `.scene-card` | 场景卡 | 图标 + 人群 + 使用场景 |
| `.step-card` | 步骤卡 | 序号 + 步骤标题 + 简述 |
| `.timeline-card` | 时间线卡 | 节点 + 时间 + 事件描述 |
| `.quote-card` | 引言卡 | 大引言 + 出处 |
| `.compare-card` | 对比卡 | 表格（表头 + 2+ 行对比）|
| `.summary-card` | 总结卡 | 图标 + 核心结论 |
| `.cta-card` | CTA卡 | 主按钮文字 + 副标题 |
| `.code-card` | 代码卡 | 等宽代码块 + 语言标签 |
| `.profile-card` | 人物卡 | 头像 + 身份 + 引言 |
| `.list-card` | 榜单卡 | 排名 + 条目名称 + 数值 |
| `.tip-card` | 提示卡 | 💡 图标 + 要点提示 |
| `.badge-card` | 勋章卡 | 徽章标签展示 |

**最后更新：** 2026-04-30
