# 公众号排版流水线优化方案

> 状态：P0、P1-b（方案 A）已完成（2026-07-27）；主题预设不做（用户决定），P2 待实施
> 涉及核心文件：`lib/llm/typeset-pipeline.mjs`、`skills/wechat-*`、`server.mjs`

## 背景与现状

`runTypesetPipeline()`（`lib/llm/typeset-pipeline.mjs:190`）执行 6 阶段契约：

| 阶段 | 现状 | 问题 |
| --- | --- | --- |
| 1 rendered | `wechat-md-render` 基本是复制 + 非空校验 | 仪式性步骤 |
| 2 design | LLM 生成设计方案 + design tokens | 每次重新掷骰子，风格不稳定 |
| 3 images | 检测到 mermaid/echarts/内联模块直接**阻断报错** | 技能无脚本，等于功能缺失 |
| 4 draft | LLM 直接产出整篇 HTML，结构不保真则回退 `markdownToHtml()` | 成本高、延迟大、不稳定 |
| 5 normalized | Puppeteer/Chromium 计算 CSS 级联，物化内联样式 | 每篇排版起一个浏览器，很重 |
| 6 gate | `check-html.mjs` 确定性门禁 | 合理，保留 |

核心问题：**LLM 在干机械活（拼 HTML），机械活（渲染图表）却没人干**。

## 优化目标

- 排版从「2 次 LLM 调用 + 1 次浏览器启动」降到「0~1 次 LLM 调用、无浏览器」
- 消除 draft 阶段的回退路径，输出稳定可预期
- 补齐 mermaid/echarts 渲染能力，images 阶段名实相符
- 同账号文章风格保持一致

## 方案（按优先级排序）

### P0：draft 阶段改为确定性渲染为主路径 ✅ 已完成

**思路反转**：LLM 不再产出整篇 HTML，只做 design 阶段（生成 tokens——这是 LLM 擅长且低风险的事）；HTML 由确定性代码按 tokens 拼装。

落地情况（2026-07-27）：

- `markdownToHtml()` 已重写为 tokens 驱动的内联样式渲染器（`buildInlineStyles()` + 每元素 `style` 属性），不再生成 `<style>` 块；期间修掉一个真 bug：font-family 的双引号会截断 `style` 属性
- `runTypesetPipeline` 新增 `draftMode` 参数，默认 `deterministic` 不调模型、无回退路径；`draftMode: 'llm'` 保留旧路径用于实验对比
- 结构保真检查保留为门禁，不再作为回退触发器

### P0：normalized 阶段轻量化或移除 ✅ 已完成

落地情况（2026-07-27）：

- 确定性主路径跳过 Puppeteer，初稿直接作为 `article.ai.html`（已是内联样式），最终仍过 `check-html.mjs` 门禁
- `skills/wechat-html-normalizer` 仅保留给 `draftMode: 'llm'` 实验路径使用

### P1：design tokens 沉淀为主题预设（部分落地）

用户决定不做「LLM tokens 缓存复用」：每天一篇文章，design 阶段一次 LLM 调用成本可接受。

但「命名主题」已于 2026-07-27 落地：`TYPESET_THEMES`（typeset-pipeline.mjs）把版式抽成主题。主题不只定配色，还定**整套视觉语言**——眉题形式（色块 chip / 线框 line-label / 等宽 `$` 命令行 / 居中字距标签）、大标题（衬线常规 / 黑底白字反白块 / 居中双线压顶 / 大衬线展示）、章节标题（01 编号、📍 卡片眉题、等宽 `#` 前缀、「一、」中文序号、黑条反白、居中字距）、引述块（暖卡、渐变卡、终端面板、方框、大引号拉页、粗黑边条）、列表（默认圆点 / › 光标前缀）、分隔符（··· / 细线 / ✦ 星点 / 粗黑杠 / `/* ── */` 注释 / ◆）以及正文字体（无衬线 / 全衬线）、导语、两端对齐、加粗用色；design tokens 决定配色与字阶，主题 tokens 作底色，显式选择主题时主题配色覆盖 LLM tokens。入口：`runTypesetPipeline({ theme })` → `aiJobs.start({ theme })` → `POST /api/batches/:id/ai/typeset` body 传 `theme`。现有主题：`magazine-warm`（暖纸杂志）、`gossip-card`（卡片吃瓜）、`tech-wire`（暗色终端）、`research-report`（财经印刷）、`career-essay`（书信手账）、`news-digest`（黑白快讯）；对比样张可用 `markdownToHtml` 逐主题渲染（参见 test/typeset-pipeline.test.mjs 的结构断言）。

主题选择（2026-07-27）：默认 `theme: 'auto'`，由 `defaultTypesetTheme(candidate)` 确定性映射（不调用模型）。映射规则：🏢 大厂战略 + 角度含「趣/离谱/八卦」→ `gossip-card`（与成稿链 `writerSkill` 同一判定）；综合文（`composite`）与 📈 行业趋势、严肃 🏢 大厂战略 → `research-report`；🤖 AI/技术动态 → `tech-wire`；💼 职场生态 → `career-essay`；📰 综合资讯 → `news-digest`；其他 → `magazine-warm`。排版页「排版主题」下拉框列出全部主题，`auto` 选项随选中候选显示实际映射结果；显式选择时覆盖自动映射。

主题配色校准（2026-07-27，参考外部六款样张）：`gossip-card` accent 由靛蓝 `#6366F1` 改为橙红 `#FF6B35`，引述块由渐变卡改为深色块（`dark-block`，`#111` 底白字加粗）；`magazine-warm` 补齐暖纸底色 tokens（`#F5EFE3` 纸底 / `#30261F` 墨色 / `#76533B` 棕褐 accent），暖卡引述背景随之改为 accent 浅透 `rgba(accent,0.1)` 以保证纸底上的对比度；`buildInlineStyles` 颜色合并优先级明确为：主题底色 < 旧版扁平 token（`accentColor` 等） < 嵌套 `colors`。

### P1：补齐 mermaid/echarts 确定性渲染脚本 ✅ 已完成（方案 A）

落地情况（2026-07-27）：

- `skills/mermaid-render/scripts/render-mermaid.mjs`：提取 ` ```mermaid ` 围栏 → 优先调用项目本地 `@mermaid-js/mermaid-cli`，兼容全局安装 → 按 `PUPPETEER_EXECUTABLE_PATH`、系统 Chrome、Puppeteer 缓存的顺序选择浏览器（以 node 直接运行入口绕开 Windows spawn `.cmd` 的 `EINVAL` 限制）→ PNG 替换围栏
- `skills/wechat-echarts-blocks-to-images/scripts/render-echarts.mjs`：提取 ` ```echarts ` 围栏（仅接受 JSON 对象、200K 字符上限，不执行任意 JS）→ 自包含 HTML（内联技能内 `npm i echarts` 的 echarts.min.js，`finished` 事件做完成标志）→ 复用 `html-pages-to-images` 的 puppeteer 截图（2x 分辨率）
- 两个脚本统一契约：`node <script> <input.md> <output.md> [imageDir]`，stdout 末行 JSON 报告，单围栏失败保留原围栏并以退出码 1 报告，绝不静默丢图
- 流水线 images 阶段串行调用两个脚本，产出 `09-FINAL.mermaid.md` / `09-FINAL.echarts.md` 工件；渲染失败即阻断。内联视觉模块（stats-grid/timeline）仍维持阻断（无执行器）

### P2：阶段契约精简

- rendered（纯复制）并入主流程，不再单独成阶段
- images 校验逻辑并入 P0 渲染器前置检查
- 6 阶段收敛为 3~4 阶段，减少工件文件数量

## 实施顺序（实际执行）

1. ~~P0-a：扩展 `markdownToHtml()` 支持 tokens + 直接内联样式~~ ✅
2. ~~P0-b：主路径切换为确定性渲染；normalized 主路径轻量化~~ ✅
3. ~~P1-a：主题预设~~ 用户决定取消
4. ~~P1-b：mermaid/echarts 确定性渲染脚本（直接落地方案 A）~~ ✅
5. P2：阶段精简（待实施）

## 验证方式

- 用现有 `articles/` 下若干批次的 `09-FINAL.md` 跑新路径，对比 `article.ai.html` 通过 gate 且结构完整
- 含 mermaid/echarts 的样例验证 images 阶段渲染替换 ✅（`test/typeset-chart-render.test.mjs` + 流水线集成测试覆盖）
- `npm test`（现有 `test/` 套件）全绿 ✅ 261/261
