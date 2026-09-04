# XHS Skill 与 AI 视觉图文产物差异核对方案

> 状态：待逐项核对
>
> 建立时间：2026-08-28
>
> 目的：以真实的 `E:\Downloads\skills\skills\xiaohongshu-article-generator` 技能产物为基准，找出它与当前 `social-card-ai-visual-generator` 产物的可验证差异，并逐项收敛视觉结果。

## 1. 核对基准

### 1.1 XHS Skill 基准

- 技能说明：`E:\Downloads\skills\skills\xiaohongshu-article-generator\SKILL.md`
- 设计系统：`E:\Downloads\skills\skills\xiaohongshu-article-generator\DESIGN_SYSTEM.md`
- 布局指南：`E:\Downloads\skills\skills\xiaohongshu-article-generator\LAYOUT_GUIDE.md`
- 实际产物：`E:\Documents\write-assistant\social-cards\2026-08-26-a5e768d9bd-c004-xhs-skill\my-design.html`
- 实际截图：`E:\Documents\write-assistant\social-cards\2026-08-26-a5e768d9bd-c004-xhs-skill\output\`

从技能文件和实际 HTML 已确认：

1. Agent 负责从素材生成 `my-design.html` 和 `copy.txt`。
2. 截图脚本主要负责 Puppeteer 截图，不负责根据页面角色调用隐藏模板。
3. 设计系统提供通用页面骨架、各设计哲学的 CSS 类名和参考布局。
4. 通用内页结构是 `page → page-inner → topbar → page-body → bottom-strip`。
5. 内容页通常采用 1–4 张卡片和 4 层填充基线：主卖点卡、数据/统计行、详细功能卡、提示/场景卡。
6. 封面使用 `page-cover`、`cover-center`、`cover-bottom`、图标/标签/标题/分隔线/日期等结构。

### 1.2 改造前 AI 视觉基准（历史样例）

- AI 技能：`E:\Documents\write-assistant\skills\social-card-ai-visual-generator\SKILL.md`
- 候选目录：`E:\Documents\write-assistant\social-cards\2026-08-28-586c83da9c-c012\`
- HTML：`ai-beautified.html`
- 主题规范：`social-theme-design-spec.md`
- 布局指南：`layout-guide.md`
- 实际截图：`ai-beautified-output\`

从这份改造前 HTML 已确认：

1. AI 视觉链路要求 Agent 从零生成完整 `ai-beautified.html`。
2. 当前页面主要使用 `.page`、`.page-body`、`.crim-*` 组件。
3. 页面没有完整采用 XHS Skill 的 `page-inner`、`bottom-strip` 和封面 `cover-center / cover-bottom` 结构。
4. 当前页面主要是内容卡片纵向堆叠，后续补入了统一的内框、轨道圆环、径向渐变和斜向光带。
5. 当时主题 SPEC 已包含 crimson 组件、orbit 装饰和 4 层内容建议，但这些规则没有全部转化为强制 HTML 结构；现行主题 SPEC 已将通用结构和组件目录移出，改为只提供主题视觉绑定。

## 2. 已确认的核心差异

以下表格记录的是 2026-08-28 样例在本轮规范收口前的差异快照；规范调整完成后，需要重新生成样例验证实际视觉变化。

| 核对项 | XHS Skill 实际产物 | 当前 AI 视觉产物 | 当前判断 |
| --- | --- | --- | --- |
| 生成职责 | Agent 写 HTML；脚本截图 | Agent 写完整 HTML；Pipeline 截图和交付登记 | 生成契约不同 |
| 页面外壳 | `page-inner + topbar + page-body + bottom-strip` | 同一通用骨架，由 Agent 完整写入 | 现行结构已对齐 |
| 封面结构 | 图标块、角标、标题、分隔线、副标题、底部标签/日期 | 同一通用封面骨架，主题负责视觉处理 | 现行结构已对齐 |
| 内容密度 | 参考 4 层填充；内容页偏紧凑 | 以 3–4 个有意义内容层和 60%–80% 视觉占用为目标 | 现行约束已收紧 |
| 内容组件 | `.card`、`.stat`、`.tip`、`.list`、`.mini-grid`、`.diagram` 等组合 | `.crim-card`、`.crim-list`、`.crim-step-row`、`.crim-tip` 等组合 | 组件命名和组合方式不同 |
| 页眉页脚 | 页眉和底部导航均参与视觉构图 | 同一通用骨架，主题可改变外观 | 现行结构已对齐 |
| 装饰 | 主题 CSS 中的背景、边框、阴影、色条、渐变共同参与构图 | 主题 SPEC 明确要求装饰在原尺寸可感知并参与层级 | 现行 Prompt/SPEC 已加强 |
| 视觉骨架 | 通用骨架较稳定，Agent 在其中填充内容 | 通用骨架由内置视觉契约约束，主题 SPEC 只负责主题层 | 差异主要来自视觉决策自由度 |

## 2.1 规范文件对比：第一项核对结果

### `LAYOUT_GUIDE.md` 与 `layout-guide.md`

核对结论：当前 `layout-guide.md` 基本沿用了外部 `LAYOUT_GUIDE.md`，但不是完全相同。

已经确认的差异：

| 项目 | 外部 XHS `LAYOUT_GUIDE.md` | 当前 `layout-guide.md` |
| --- | --- | --- |
| `.page-body` 基础 CSS | `flex`、纵向排列、`gap:8px`，没有强制 `justify-content` | 额外加入 `justify-content:center` |
| 标签最小字号 | 9px | 10px |
| 页面利用率 | 82%–95% 为推荐目标 | 采用生成阶段 60%–80% 内容区视觉占用目标，不执行运行时审计 |
| 审计说明 | 主要是视觉排版建议 | 现行生成阶段不执行布局审计；只保留截图和交付登记 |
| 垂直对齐 | 建议视觉重心略偏上 | 明确要求整组页面统一垂直居中 |

因此，`layout-guide.md` 可以视为“外部布局指南 + 当前项目的布局和居中规则”，是技能运行时注入的通用布局参考，不是候选主题输入。

### `DESIGN_SYSTEM.md` 与 `social-theme-design-spec.md`

核对结论：两者差异明显，当前 SPEC 不是外部设计系统的等价副本。

外部 `DESIGN_SYSTEM.md` 是一份完整的通用设计系统：

- 先定义所有主题共享的 HTML 骨架：`page-inner`、`topbar`、`page-body`、`bottom-strip`；
- 再定义封面骨架：`cover-center`、`cover-bottom`、图标、标签、分隔线和日期；
- 包含 14 套设计哲学；
- 每套哲学都有对应的配色、组件类名和 CSS 视觉实现；
- 末尾还提供通用卡片 CSS 和组件目录。

改造前的 `social-theme-design-spec.md` 是按主题 JSON 生成的 crimson 专版规范：

- 主要提供主题 Token、`crim-*` 组件名、少量核心 CSS 配方和装饰层；
- 只保留当前主题，不包含外部设计系统的完整通用组件库；
- “页面编排”主要是文字建议，但当时的 SPEC 仍把通用页面结构写进了主题文件；现行版本只声明主题如何接入通用骨架，不再复制骨架和通用组件 CSS；
- 保留当前 AI 链路的事实边界和安全要求，不复制生成流程、截图或运行时审计职责；
- 旧版 SPEC 曾写有“程序负责页面壳、AI 只生成插槽内容”，但该旧规则已从主题 SPEC 和主题规范生成器移除；当前 AI 视觉技能与主题 SPEC 均要求 Agent 写入完整 HTML 页面。

外部 crimson 设计系统与改造前 crimson SPEC 也不是一一对应：外部使用 `.cr-card`、`.cr-stat`、`.cr-tip` 等类名说明和通用卡片体系；改造前 SPEC 主要使用 `.crim-card`、`.crim-stat`、`.crim-tip`，并把运行时变量统一成 `--bg`、`--surface`、`--accent` 等。现行版本只保留 `.crim-*` 前缀绑定，完整组件语义由 `xhs-visual-contract.md` 提供。

### 第一项核对结论

“昨天参考外部文件生成当前 Layout Guide”这个判断基本成立；`layout-guide.md` 的主体内容确实高度相似，只加入了项目自己的布局和居中约束。

但不能把同样的结论套到现行 SPEC：它不再定义页面骨架或通用组件目录，只保留主题 Token、视觉绑定和装饰配方；完整骨架、封面结构、组件语义和基础 CSS 统一由 `xhs-visual-contract.md` 提供。

历史上的第一处阻断点是“规范与技能协议冲突”，现已统一：

```text
旧主题 SPEC：程序提供 page 壳，AI 只生成 ai-page-slot 内容
当前统一规则：程序只提供空 HTML，AI 自己生成完整 page 壳
```

因此，当前样例没有使用 `page-inner`、`bottom-strip` 等结构，首先是旧版规范冲突和生成阶段契约未统一造成的。现在完整页面骨架由 `xhs-visual-contract.md` 和 AI 视觉技能统一，主题 SPEC 只负责把主题视觉套到这套骨架上。

### 2.2 本轮收口后的职责边界

| 文件 | 只负责 | 不再负责 |
| --- | --- | --- |
| `social-card-ai-visual-generator/SKILL.md` | 读取输入、事实保真、生成顺序、写入协议、审计修复边界 | 维护通用组件 CSS 细节或主题 Token |
| `references/xhs-visual-contract.md` | 通用页面骨架、封面结构、组件语义和基础 CSS | 主题配色、具体事实和页面内容 |
| `references/layout-guide.md` | 375×667 画布、安全区、字号、间距、利用率和布局基线 | 主题视觉风格或组件语义目录；不作为候选工作区文件 |
| `themes/social/<id>/AI_DESIGN_SPEC.md` | 主题 Token、类名前缀、组件视觉覆盖和装饰配方 | 页面骨架、固定页面模板、通用组件目录和通用门禁 |

本轮同步修正了主题 SPEC 生成器，避免之后重新生成主题文件时把通用结构和组件 CSS 带回来。

## 3. 不应继续使用的错误假设

以下判断不作为本方案依据：

- 不把项目内 `social-card-template-registry.mjs` 的 `roleTemplates` 当作 `E:\Downloads` 技能的实现机制。
- 不把“根据页面角色调用固定模板”描述成 XHS Skill 的工作方式。
- 不因为主题 SPEC 中存在组件表，就默认 AI 已经使用了所有组件或完整页面骨架。
- 不把“增加一个 orbit 圆环和渐变”视为已经达到 XHS Skill 的整体版式效果。

## 4. 目标效果定义

目标不是让当前 AI 视觉结果复用项目内程序化模板，而是让它在视觉和 HTML 生成契约上接近 XHS Skill 的实际产物：

1. 使用同等明确的通用页面骨架。
2. 使用同等明确的封面结构。
3. 使用同等明确的内容密度和卡片组合基线。
4. 使用主题专属 CSS，而不是只使用主题颜色。
5. 让装饰层参与页面构图，而不是统一叠加在所有页面上。
6. 保留当前 AI 视觉链路的事实完整性、截图和交付门禁；视觉问题通过生成 Prompt/SPEC 解决，不在生成后用程序审计修补。

页面角色固定模板不是本目标的必要条件；如果后续发现 XHS Skill 的实际产物存在更具体的页面构图模式，再以实际 HTML 和截图为证据补充。

## 5. 逐项核对顺序

### C0：确认比较输入

状态：待核对

- [ ] 用同一份事实和同一份页面计划分别运行 XHS Skill 与 AI 视觉链路。
- [ ] 对比两次的页数、页面职责、标题和内容块数量。
- [ ] 不用 M6 的 7 页产物直接证明 React 6 页产物的版式差异；两者目前不是同一份内容输入。

### C1：核对通用页面外壳

状态：待核对

- [ ] 当前 AI HTML 是否强制包含 `page-inner`。
- [ ] 当前 AI HTML 是否强制包含顶部栏和底部导航。
- [ ] 当前 AI HTML 的封面是否使用独立的封面内容区和底部信息区。

### C2：核对内容密度

状态：待核对

- [ ] 普通内容页是否按照 3–4 层有效内容组织。
- [ ] 是否避免只输出“标题 + 一张卡”或“标题 + 多张同质卡片”。
- [ ] 是否保留 XHS Skill 的统计行、提示卡、列表、网格、图示等组合能力。

### C3：核对主题 CSS

状态：待核对

- [ ] 当前 crimson CSS 是否覆盖封面、页眉、卡片、统计、步骤、提示、总结和 CTA。
- [ ] 当前 AI 生成是否真的使用主题前缀类名，而不是只使用颜色变量。
- [ ] 当前字体、字号、圆角、边框、阴影是否与目标主题设计系统一致。

### C4：核对装饰构图

状态：部分完成，待核对

- [x] 当前页面已经有可见的内框、轨道圆环、渐变和斜向光带。
- [ ] 装饰是否根据封面、内容页、步骤页和结尾页产生变化。
- [ ] 装饰是否与内容层级发生关系，而不是所有页面复用相同外壳。

### C5：核对视觉验收

状态：待核对

- [ ] 用同一份输入生成两套 375×667 截图。
- [ ] 逐页比较页面外壳、内容密度、标题层级、卡片层级、装饰和底部收束。
- [ ] 以视觉差异清单为依据逐项修改，不一次性混入多个未经验证的改动。

## 6. 待决定的实现方向

完成 C0–C5 的事实核对后，再在以下两种方式中选择：

### 方向 A：让 AI 视觉技能执行 XHS Skill 的版式契约

将 XHS Skill 的通用骨架、封面结构、4 层内容基线和主题 CSS 规则写入 AI 视觉生成契约。Agent 仍然生成完整 HTML，但必须遵守同一套结构。

### 方向 B：对同一份输入直接使用 XHS Skill 生成图文

如果目标是稳定获得与前天完全同类的产物，则直接复用 XHS Skill 的生成方式，当前 AI 视觉链路只负责事实审计或不再参与视觉生成。

两种方向的取舍必须在完成 C0–C5 后决定，不能仅根据主题 SPEC 或单个页面截图推断。

## 7. 当前结论

当前已经确认的事实是：

> 两套产物的主要差异来自不同的 HTML 生成契约和设计系统执行方式；不是因为 XHS Skill 使用了项目内隐藏的页面角色固定模板。

规范层本轮已完成收口；下一步仍核对 C0：使用同一份输入确认两套产物的真实差异范围，并重新生成样例验证规范是否真正进入视觉结果。

## 8. 当前 AI 视觉生成阶段流程（核对稿）

本节只描述“生成阶段”，不包含后面的浏览器布局审计、单页修复、最终截图和交付登记。

### 8.1 Pipeline 准备输入

入口是 `social-card-beautify`。Pipeline 先完成以下动作：

1. 读取候选、批次和数据库故事板；故事板为空则停止。
2. 将数据库故事板写成候选目录中的 `card-plan.json`。
3. 检查并确定原始事实文件：`repository-fact-sheet.json`、`event-analysis.json` 或 `custom-fact-sheet.json`。
4. 生成 `ai-visual-card-plan.json`，作为 Pipeline 内部的精简视觉计划记录。
5. 从 `themes/social/<theme-id>/AI_DESIGN_SPEC.md` 复制主题 SPEC 到候选目录的 `social-theme-design-spec.md`，作为本次运行唯一的主题专属输入。
6. 由技能运行时把 `xhs-visual-contract.md`、`layout-guide.md` 和 `visual-component-mapping.md` 作为内置参考注入 Prompt，不复制到候选目录。
7. 生成空的 `ai-beautified.html` 脚手架。

正常生成 Agent 实际读取的候选工作文件是：

```text
card-plan.json
原始事实 JSON
social-theme-design-spec.md
```

### 8.2 加载技能提示词

Pipeline 通过 `loadSkillBundle` 加载 `social-card-ai-visual-generator`。技能运行时会把以下内容拼成 Agent 的系统提示词：

```text
SKILL.md
根目录下的其他 Markdown 参考文件
references/ 下的 Markdown 参考文件
不可变安全门禁
```

因此，新增的 `references/xhs-visual-contract.md` 不需要加入候选目录的四份输入文件；它会随技能包进入 Agent 提示词。这一步已经具备生效条件，但必须通过重新生成产物验证 Agent 是否实际遵守。

### 8.3 启动全量生成 Agent

Pipeline 将技能提示词、运行参数和工具目录交给 `runSocialCardAiVisualGenerationAgent`。生成阶段只开放：

```text
cap_filesystem_project_read
cap_filesystem_project_write
```

浏览器观察和布局审计在这个阶段不可用。

### 8.4 Agent 读取资料

正常路径下，Agent 第一次模型动作被约束为一次 `cap_filesystem_project_read`，读取上面的四份候选工作文件。读取结果随后保留在对话历史中，用于生成 CSS 和页面，不把正文重新复制到用户消息。

如果 Agent 提前返回 `final`，包装器会拒绝结束并要求继续完成 CSS 或缺失页面；这属于生成过程控制，不是视觉审计。

### 8.5 Agent 写入 CSS

Agent 先通过 `cap_filesystem_project_write` 的 `set_head` 写入基础 CSS：

- 主题变量；
- 页面画布；
- 页面外壳和基础排版；
- 通用工具类；
- 主题和组件样式。

如果需要拆分，可以再使用 `append_head_css` 写入组件 CSS。当前实现允许最多 3 个 CSS 分片，且必须先完成 `set_head`。

### 8.6 Agent 逐页写入 HTML

CSS 分片完成后，Agent 只能通过 `append_body` 一次追加一页完整 `.page`，直到达到 `requiredPageCount`：

```text
set_head
  ↓
append_head_css（可选）
  ↓
append_body P1
  ↓
append_body P2
  ↓
...
  ↓
append_body Pn
  ↓
final
```

当前技能新增的 XHS 通用契约要求页面在这个阶段使用：

- 内页：`page-inner + 页眉 + page-body + bottom-strip`；
- 封面：`page-cover + page-inner + cover-center + cover-bottom`；
- 主题前缀组件；
- 普通内容页默认 3–4 层有效内容；
- 主题装饰伪元素或背景层。

### 8.7 生成结束后的结构门禁

Agent 返回 `final` 后，Pipeline 会执行一次生成门禁。当前门禁检查：

- 是否有完整 `html` 根节点；
- 是否有 `body` 节点；
- 是否找到 `.page`；
- 页面数量是否等于 `requiredPageCount`；
- 是否包含脚本、危险资源、事件属性；
- HTML 是否超过最大长度。

当前门禁尚未检查以下 XHS 视觉契约：

- `.page-inner` 是否存在；
- `bottom-strip` 是否存在；
- 封面是否有 `cover-center / cover-bottom`；
- 是否使用完整组件结构；
- 普通内容页是否达到 3–4 层；
- 主题装饰是否实际落地。

### 8.8 生成失败时的恢复

如果 Agent 没有完成确认，或 HTML 根节点/页数/安全性门禁失败：

1. Pipeline 清空 `ai-beautified.html`，重新写入空脚手架；
2. 将上一轮门禁问题拼入恢复指令；
3. 从头再运行一次全量生成；
4. 第二次仍失败则阻断，不进入布局审计修复。

### 8.9 生成阶段与后续阶段的边界

生成阶段完成且结构门禁通过后，才进入：

```text
逐页浏览器布局审计
  ↓
单页 AI 修复
  ↓
最终整组布局审计
  ↓
PNG 截图
  ↓
交付登记
```

因此，当前“视觉结果不像 XHS Skill”的主要检查点，应该先放在 8.5–8.7：技能契约是否进入 Agent、Agent 是否写出 XHS 骨架，以及生成门禁是否验证这些结构，而不是先看后面的截图脚本。

### 8.10 过时的服务端契约方法已移除

此前服务端文件 `server/features/social-cards/application/social-card-beautify.mjs` 中存在两个未接入生成流程的方法：`buildThemeLayoutGuide()` 和 `buildAiDesignContract()`。调用点核对确认，前者仅被后者内部引用，后者没有任何生成流程或其他模块调用，因此它们不会影响实际产物，保留反而容易造成“服务端已经传入结构化契约”的误解。

这两个方法及其专用常量现已删除；测试文件中的失效导入也已同步清理。当前实际生效的视觉契约只有：

```text
主题 SPEC + Layout Guide + 技能内置视觉契约（进入 Agent 提示词/文件）
```

后续如果需要结构化契约，应该明确设计新的实际调用链，而不是恢复这两个已经废弃的方法。

### 8.11 2026-08-28 封面审计兼容修复

本轮首次按新契约运行时，P1 失败的直接原因已确认：完整 AI 封面使用 `page-inner → cover-center → cover-bottom`，但项目内布局审计脚本仍只查找 `.page-body`，返回 `missing_page_body`；该结构问题又没有进入修复反馈，最终被包装成“修复后审计问题未变化”。

已修复项目内 `skills/xiaohongshu-article-generator/scripts/layout-audit.mjs`：

- 内页继续以 `.page-body` 作为内容区；
- 完整 AI 封面以 `.page-inner` 的可见内容作为利用率测量范围，包含顶部标签、`cover-center` 和 `cover-bottom`；
- 封面辅助层不再被误判为普通正文小字号；
- AI 技能正文统一改为“内页 `.page-body`、封面 `.cover-center`”，并要求生成基础 CSS 包含 `box-sizing:border-box`。

这次修改的是项目内审计适配和 AI 生成技能，不修改 `E:\Downloads\skills\skills\xiaohongshu-article-generator` 原始技能。
