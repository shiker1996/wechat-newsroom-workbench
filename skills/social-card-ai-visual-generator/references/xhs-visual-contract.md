# XHS 视觉生成通用契约

> 本文件由 `social-card-ai-visual-generator` 运行时作为内置参考注入，不复制到候选工作目录，也不属于 `workspace.files`。本文件只负责通用结构关系和组件语义。

> 来源：`E:\Downloads\skills\skills\xiaohongshu-article-generator\DESIGN_SYSTEM.md` 与 `LAYOUT_GUIDE.md`
>
> 用途：给 `social-card-ai-visual-generator` 提供与 XHS Skill 一致的通用 HTML 骨架和组件结构。主题颜色、字体、边框、阴影和装饰仍以候选目录中的 `social-theme-design-spec.md` 为准。

## 1. 适用边界

这不是项目内程序化模板，也不是按页面角色调用的隐藏渲染器。它是 Agent 生成完整 HTML 时必须遵守的通用视觉契约：

- 页面外壳固定；
- 封面结构固定；
- 内页页眉、内容区和底部导航固定；
- 内容组件从统一目录中选择；
- 具体主题样式由当前主题 SPEC 覆盖；
- 页面内容仍必须完全服从 `card-plan.json` 和事实 JSON。

## 2. 通用页面骨架

### 2.1 封面

```html
<section class="page page-cover">
  <div class="page-inner">
    <span class="glass-tag">主题标签</span>
    <span class="glass-hot">🔥 核心卖点</span>
    <div class="cover-center">
      <div class="cover-mark">图标或短标识</div>
      <div class="cover-title">主标题</div>
      <div class="cover-divider"></div>
      <div class="cover-sub">副标题或一句事实说明</div>
    </div>
    <div class="cover-bottom">
      <div class="cover-tags">
        <span class="xhs-tag">#标签</span>
      </div>
      <div class="cover-date">2026.08.28</div>
    </div>
  </div>
</section>
```

封面必须有明确的主视觉重心。允许保留 30%–45% 留白，但不能只输出标题和一块空背景；至少要有图标/标记、标题、分隔线或标签中的两个辅助层。

封面利用率按 `cover-center` 的实际可见子元素与 `cover-bottom` 的实际可见子元素计算；`cover-center` 自身通常通过 `flex: 1` 占满剩余空间，不能把这个弹性容器的全高当成内容。顶部角标是装饰层，不单独撑高利用率。

### 2.2 内页

```html
<section class="page">
  <div class="page-inner">
    <header class="xhs-topbar">
      <span class="xhs-num">01</span>
      <span class="xhs-title">页面标题</span>
      <span class="xhs-sub">SECTION</span>
    </header>
    <main class="page-body">
      <div class="page-content-stack">
        <!-- 1–4 个有意义的内容组件，默认 3–4 层填充 -->
      </div>
    </main>
    <footer class="bottom-strip">
      <span class="bs-logo">账号或项目名</span>
      <span class="bs-right">继续阅读 →</span>
    </footer>
  </div>
</section>
```

主题前缀可以把 `xhs-` 替换为 SPEC 声明的主题前缀，但不能删除 `page-inner`、`page-body` 或 `bottom-strip`。例如主题 SPEC 声明 `crim-*` 时，页眉使用 `.crim-topbar`、`.crim-num`、`.crim-title`、`.crim-sub`，外壳仍保持本契约结构。

## 2.3 结构职责（布局数值见 Layout Guide）

本契约只规定结构关系和布局职责；所有页面尺寸、对齐和间距数值以 `references/layout-guide.md` 为准。如果两份资料出现差异，以 Layout Guide 的布局实现为准。

- `.page-inner` 是页面内部的纵向容器；封面标签和装饰可以绝对定位，不计入正常流。
- `.page-body` 是唯一的正文可用区，负责承载内容并提供垂直对齐空间。
- `.page-content-stack` 是内容页唯一的纵向内容栈，负责标题、卡片和辅助层的纵向排列。
- `.page-inner`、`.page-body` 和 `.page-content-stack` 不得依赖固定 Grid 行号；不能因为绝对定位的标签或装饰改变正常流子元素数量后产生空白或错位。
- `.page-body` 必须只承载一个 `.page-content-stack`；普通内容页不得把多个卡片直接放成 `.page-body` 的兄弟元素。

## 3. 通用组件目录

组件必须使用主题 SPEC 中对应的主题前缀类名；下表是语义和结构基线。

| 组件 | 推荐结构 | 适用内容 |
| --- | --- | --- |
| 亮点卡 | `card/feat-card` + `card-title` + `card-body` | 一个核心卖点或事实结论 |
| 数据行 | `stat-row` + 2–3 个 `stat` | 数字、比例、价格、规模 |
| 场景行 | `scene-row` + 2–3 个 `scene-card` | 用户、人群、使用场景 |
| 步骤卡 | `step-card` + `step-num` + `step-title` + `step-body` | 操作路径、流程、安装步骤 |
| 时间线 | `timeline-card` + 节点/时间/标题/描述 | 时间顺序和事件演进 |
| 引言卡 | `quote-card` + `quote-text` + `quote-author` | 可核验的引用或观点边界 |
| 对比卡 | `compare-card` + 表头/对比行/箭头 | 前后变化、方案差异 |
| 总结卡 | `summary-card` + 图标 + 核心结论 | 页面结论、判断收束 |
| CTA 卡 | `cta-card` + `cta-title` + `cta-body` | 结尾行动或查看演示 |
| 代码卡 | `code-card` + 语言标签 + 代码文本 | 命令、配置、短代码 |
| 人物卡 | `profile-card` + 身份 + 引言 | 人物、组织、角色观点 |
| 列表卡 | `list-card` + `list-rank` + `list-title` + `list-desc` | 榜单、条目、清单 |
| 提示卡 | `tip-card` + `tip-icon` + `tip-title` + `tip-body` | 风险、限制条件、使用建议 |
| 勋章组 | `badge-card` + `badge-tag` | 标签、关键词、分类 |

### 3.1 基础结构示例

以下通用类名只用于说明组件语义；实际生成必须替换为当前主题 SPEC 声明的主题前缀类名，并使用主题自己的颜色、边框、圆角和阴影。

```html
<div class="card accent">
  <div class="card-title">核心卖点</div>
  <div class="card-body">保留事实清单允许表达的一到两句内容。</div>
</div>

<div class="stat-row">
  <div class="stat"><span class="stat-num">3</span><span class="stat-label">独立模块</span></div>
  <div class="stat"><span class="stat-num">MIT</span><span class="stat-label">开源许可</span></div>
</div>

<div class="tip">
  <div class="tip-icon">💡</div>
  <div>
    <div class="tip-title">使用边界</div>
    <div class="tip-body">把事实、推断和未验证信息分开表达。</div>
  </div>
</div>
```

如果主题 SPEC 已提供主题前缀组件，例如 `.crim-card`、`.crim-stat`、`.crim-tip`，使用主题前缀实现同样的组件语义，不要只使用普通文本和裸边框替代组件。

### 3.2 通用组件结构基线

以下只示范组件之间的结构关系，不提供文字或间距数值。主题 SPEC 可以覆盖颜色、边框、圆角、阴影和字体家族，但不得降低组件的语义结构或把组件退化成裸文本。

```css
/* 数据卡 */
.stat-card { text-align:center; flex:1; }
.stat-num { display:block; }
.stat-label { display:block; }

/* 亮点卡 */


/* 步骤卡 */
.step-card { display:flex; align-items:flex-start; }
.step-num { flex-shrink:0; }

/* 时间线卡 */
.timeline-card { display:flex; border-bottom:1px solid rgba(128,128,128,.2); }
.tl-node { width:8px; height:8px; flex-shrink:0; border-radius:50%; }
.tl-content { flex:1; }

/* 引言卡 */
.quote-card { border-left:3px solid var(--accent); }
.quote-text { font-style:italic; }

/* 对比卡：不要用裁切隐藏表格或长文本；圆角由主题边框和背景表达 */
.compare-card { min-width:0; }
.compare-table { width:100%; border-collapse:collapse; }
.compare-table th { text-align:left; }
.compare-table td { vertical-align:top; }
.compare-arrow { text-align:center; }

/* 总结和 CTA */
.summary-card { text-align:center; }
.cta-card { text-align:center; }

/* 代码卡：必须在 375px 画布内完整可见，不使用内部滚动 */
.code-card { font-family:'Courier New',monospace; overflow-wrap:anywhere; }
.code-lang { opacity:.6; }

/* 人物卡 */
.profile-card { display:flex; align-items:flex-start; }
.profile-avatar { width:40px; height:40px; flex-shrink:0; display:flex; align-items:center; justify-content:center; border-radius:50%; }
.profile-info { flex:1; }
.profile-title { opacity:.7; }
.profile-quote { font-style:italic; }

/* 列表、提示和勋章 */
.list-card { display:flex; align-items:center; border-bottom:1px solid rgba(128,128,128,.15); }
.list-rank { width:24px; flex-shrink:0; text-align:center; }
.list-content { flex:1; }
.tip-card { display:flex; align-items:flex-start; }
.tip-icon { flex-shrink:0; }
.tip-content { flex:1; }
.badge-card { display:flex; flex-wrap:wrap; }
.badge-tag { border-radius:20px; }
```

主题前缀组件（例如 `.crim-card`）必须达到相同的结构语义；如果主题组件名称不同，生成 Agent 仍要按上面的语义映射实现，并按 `layout-guide.md` 为不同文本职责选择字号和字重。

## 4. 内容层组合基线

普通内容页优先按照以下顺序组织，不要求每页机械重复，但不能退化成单一卡片堆叠：

1. 主亮点卡：一句话说明本页最重要事实；
2. 数据/对比/图示层：突出 2–3 个数字或关系；
3. 详细功能层：列表、步骤、时间线、人物、代码或网格；
4. 提示/场景/总结层：表达边界、影响、下一步或结论。

硬规则：

- 每页最多 4 个主要内容组件；
- 内容密度允许时，普通内容页默认 3–4 层；
- 事实允许时，内容栈应形成内容区约 60%–80% 的视觉占用；主组件要有足够视觉重量，不能让整组页面都只占中部一小条；
- 封面和结尾页可以少于 3 层，但必须有明确主视觉；
- 不用空白卡、重复卖点或无意义 emoji 填充；
- 内容页整体垂直居中，卡片内部文字默认左对齐。

### 4.1 整组视觉节奏与角色焦点

视觉节奏是整组页面的软性质量要求，不改变 `card-plan.json` 的页数、事实或页面职责，也不作为浏览器布局硬门禁。生成前先为每页选择一个首要视觉焦点：

| 页面语义 | 首选焦点组件 | 次级承接 |
| --- | --- | --- |
| 指标、规模、价格、比例 | 1 个大数字或 2–3 个数据单元 | 一句解释或限制条件 |
| 证据、来源、边界、待验证 | 证据卡、强调边框或状态徽章 | 来源状态、验证范围、风险提示 |
| 结论、判断、结尾 | 使用 `accent` 或 `accent2` 的结论色块 | 普通表面说明、标签或下一步 |
| 时间线、步骤、演进 | 节点线、编号或箭头关系 | 关键节点说明与当前状态 |
| 人物、组织、事件 | 人物/组织焦点卡或引言卡 | 身份、动作、影响或后续观察 |

规则：

- 每页一个首要焦点，1–2 个次级层；不要让所有组件面积、边框、字重完全相同；
- 相邻内容页至少在主组件类型、强调位置、卡片轮廓或明暗层级之一不同；
- 避免整组连续使用同一种“大圆角卡片纵向堆叠”；事实结构相同且必须重复时，可改变主次面积或强调位置，不强行换掉最合适的组件；
- “蓝橙强调”只是某些主题的表现，实际必须使用当前主题的 `accent`、`accent2`、`surface` 和 `inverse`；
- 系统 Emoji 只作小型提示，整组主要视觉语言优先由数字、色块、文字徽章、边框节点和 CSS 几何装饰承担；
- 缺少数字、证据或结论事实时，不得为了满足视觉节奏虚构对应内容。

## 5. 主题绑定与装饰

- 主题 SPEC 决定背景、表面、文字、强调色、字体、圆角、边框、阴影和主题前缀；
- 主题 SPEC 的 `decoration` 和 `texture` 必须落地到每页可见的伪元素或背景层；
- 装饰必须服务于页面构图，可以使用内框、渐变、色条、轨道、扫描线、错位层或圆弧；
- 装饰使用 `pointer-events:none`，位于内容层之后，不得遮挡文字；
- 不因为通用骨架而覆盖主题特色，组件形状和颜色应由主题 SPEC 具体实现。

## 6. 生成前结构检查

写入每页前逐项确认：

- 封面是否有 `page-cover`、`page-inner`、`cover-center`、`cover-bottom`；
- 内页是否有 `page-inner`、页眉、`page-body`、唯一的 `page-content-stack`、`bottom-strip`，且内容卡片均位于内容栈内；
- 页面是否只使用 1–4 个有意义组件；
- 是否至少有一个主题组件，而不是只有裸文本；
- 普通内容页是否达到 3–4 层有效内容；
- 内容密度是否来自真实组件和事实关系，而不是空白占位；
- 主题装饰是否真正可见；
- 整组相邻页面是否连续使用相同主卡片轮廓；
- 指标、证据和结论页面是否分别形成数字焦点、证据边界和结论色块；
- 页眉、页脚和内容区是否保留安全边距。
