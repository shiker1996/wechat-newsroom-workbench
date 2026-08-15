# 自定义图文 + 小红书渠道 设计评审（待办 1 + 6）

> 状态：已拍板（2026-07-25），第一批已实施完成（2026-07-25）
> 拍板结论：决策 2 捆绑设计；决策 3 复用 `repository_fact_sheets` 表（方案 A）；决策 4 共用执行器、facts/GATE 分流（方案 A）；决策 5 首批教程、清单、观点三类（方案 A）；决策 6 来源等级进数据结构 + GATE 检查（方案 A）
> 历史实施记录：当时使用 `skills/xiaohongshu-article-generator/references/custom-cards.md`；现已拆分为 `skills/custom-card-storyboard/` 与生成交付阶段的 `references/copy-custom.md`。其余记录包括 `lib/domain/custom-fact-builder.mjs`、`lib/domain/social-card-gate.mjs`、自定义创建路由和图文渲染链路。
> 追加（2026-07-25）：创建入口改为对话式策划——`lib/llm/custom-social-chat.mjs` + 流式路由 `POST /api/batches/:id/custom-social-chat/stream`（无状态，草稿与历史由前端全量传入），AI 策划编辑逐轮把方案回填进创建表单（`formUpdates` 经 `sanitizeFormUpdates` 白名单清洗），表单始终可手改，创建仍走原有路由与门禁；导航拆分为「工具图文」/「自定义图文」两个入口共用 `#view-social-editor`
> 建立日期：2026-07-25
> 配套文档：[可选功能扩展 TODO](./optional-feature-todos.md)（第 1、6 项）、[实施路线图](./optional-feature-implementation-roadmap.md)（第 4、6 节）
> 说明：本文档基于 2026-07-25 对当前代码的实际摸底（文件与行号为实施起点，开发时以最新代码为准）。本文只做设计评审，逐项拍板后才进入开发。

## 1. 范围与背景

- 待办 1：非仓库类自定义图文。当前图文生产链只面向 GitHub 仓库，种草、生活、教程、清单、经验、观点类内容无法创建。
- 待办 6：完整小红书渠道模式。当前 `channel_mode` 只进 LLM 输入和 `card-plan.json`，不进渲染；`output_mode='xiaohongshu'` 零代码分支。
- 路线图第 6 节决策点 1 已定：本批做 1+6。其余决策点见第 3 节。

## 2. 现状摸底摘要

### 入口与候选

- 非 GitHub URL 在 `lib/integrations/repository-inspector.mjs:47` 直接抛错；非仓库图文当前完全走不通。
- 手工候选唯一入口是 `store.addManualHotspot`（`lib/core/store.mjs:565`），server 未暴露路由（`API.md:55` 的文档滞后于实现）。
- 唯一现成的"非仓库图文"路径是突发专题：`POST /api/batches/breaking` → breaking-analysis → 建 `social_cards` 轨道，`output_mode='wechat-event-cards'`。

### 执行器

- 六阶段契约在 `lib/llm/social-card-pipeline.mjs:12-19`（facts → planning → generation → layout-audit → screenshots → delivery-gate）。
- `contentType` 分流点在 `lib/llm/social-card-pipeline.mjs:143`：读 `candidate_tracks.output_mode`，`'wechat-event-cards'` → event，其余 → repository。
- `output_mode` 实际取值只有两个：`'wechat-tool-cards'`（默认）与 `'wechat-event-cards'`（突发）；`'xiaohongshu'` 从未写入数据库。

### GATE 与 prompt

- CARD GATE：`lib/domain/social-card-gate.mjs`，仓库型 10 项（:1-15）、事件型 8 项（:17-32），在 pipeline facts 阶段前执行（:146-148）。无自定义内容类型。
- 故事板 prompt 内联在 `server.mjs:585-592`（event / repository 两套，contentType 切换），前缀是 `loadSkillBundle('xiaohongshu-article-generator')`。

### 渲染与交付

- `renderStoryboardHtml`（`lib/llm/social-card-pipeline.mjs:72-102`）14 套主题 CSS 硬编码；`channel_mode` 不进渲染函数。
- 当时 `skills/xiaohongshu-article-generator/references/` 只有 `layout-contract.md`、`wechat-event-cards.md`、`wechat-tool-cards.md`，无小红书专属 reference；该问题现已通过独立故事板技能与按内容类型加载的 `copy-*.md` 收敛。
- 无独立 social_cards 表；图文产物落盘 `social-cards/<batch>-<candidate>/` 并登记 artifacts 表。

### 前端

- `public/src/views/social-editor.js` 无 output_mode / channel 选择 UI。

### 事实基座存储

- `repository_fact_sheets` 表（`lib/core/store.mjs:215-225`）：`candidate_row_id` 主键 + `data_json` 自由 JSON 字段。GATE 只读 `data_json` 里的业务字段，`repository`/`source_url` 两列不参与校验——复用该表容纳自定义事实基座零迁移。

## 3. 决策点（逐项拍板）

### 决策 2：待办 1 与 6 是否捆绑设计

- 方案 A（推荐）：捆绑。两者共同触碰故事板 prompt、渲染分支、CARD GATE 三处；拆开会在同一批文件上重复返工，且"小红书自定义图文"正是最高频的真实需求组合。
- 方案 B：先做 1 后做 6。自定义图文先只出公众号版式，小红书后补。优点是先收敛内容类型契约；缺点是 GATE/prompt 要改两轮。
- 方案 C：只做 6 不做 1。价值最低，仓库图文用户群固定，小红书模式缺少自定义内容支撑。

**推荐 A。**

### 决策 3：自定义图文事实基座的存储方式

- 方案 A（推荐）：复用 `repository_fact_sheets` 表 + 沿用落盘双写。`data_json` 已是自由 JSON，`repository` 列置空、`source_url` 放主素材链接或 `custom://<candidateId>`；facts 阶段落盘 `social-cards/<dir>/facts.json` 与现有仓库图文一致。零数据库迁移，查询/登记逻辑全部复用。
- 方案 B：新建 `custom_fact_sheets` 表。语义更干净，但要加迁移、加 store 方法、加查询分支，而表结构与现有表几乎同构。
- 方案 C：只落盘 JSON 不入表。与事件卡当时的"先落盘"策略类似，但 facts 阶段现有机制就是双写，绕开表反而要改 pipeline。

**推荐 A。**

### 决策 4：与仓库图文共用执行器还是拆分

- 方案 A（推荐）：共用 `runSocialCardPipeline`，分流点保持现有模式——`output_mode` 决定 `contentType`，facts 阶段分流到自定义事实构建器，GATE 按 contentType 选检查项。现有六阶段骨架、布局审计、截图、ZIP 交付全部复用。
- 方案 B：拆独立执行器。隔离更彻底，但六阶段里只有 facts 和 GATE 两项真正不同，复制整条 pipeline 会制造长期双轨维护成本（前端刚收敛完双轨，不宜在后端再开一条）。

**推荐 A。** 分流键沿用 `candidate_tracks.output_mode`，新增取值建议：`wechat-custom-cards` / `xiaohongshu-custom-cards`（渠道 × 内容形态都编码进 output_mode，与现有 `wechat-tool-cards` / `wechat-event-cards` 命名一致）。

### 决策 5：首批开放哪几种内容类型

- 方案 A（推荐）：先教程、清单、观点三类。事实基座以"观点/步骤/条目 + 素材链接"为主，GATE 检查项简单（主题明确、条目有来源、页数达标、禁止表达已填），合规边界清晰。
- 方案 B：六类全开（含种草、生活）。种草和生活类的广告、功效、亲测表述边界复杂，需要额外的合规 GATE 和文案约束，第一批容易拖期。
- 方案 C：只做教程一类。最稳但价值释放太慢。

**推荐 A**；种草、生活、经验类放第二批，届时补合规 GATE。

### 决策 6（新增）：体验真实性三来源等级的落点

路线图把"作者真实体验 / 用户提供素材 / 模型建议"三级区分列为风险。需要在拍板时确认落点：

- 方案 A（推荐）：等级标注进事实基座数据结构（每条事实带 `source_level` 字段），GATE 检查"体验性表述是否均有 source_level 且非模型虚构"，同时把等级贯通到故事板与 copy 阶段 prompt。
- 方案 B：只在 prompt 里约束，不动数据结构。实现最轻，但 GATE 无法客观检查，约束力弱。

**推荐 A。**

## 4. 实施改动清单草案（拍板后细化）

1. **入口**：图文选题池增加"创建自定义图文"（主题、内容类型、目标受众、核心观点、素材链接、作者体验、限制说明、期望页数）；新增 server 路由建手工候选 + `social_cards` 轨道（`output_mode` 按渠道与类型写入）；顺带补 `API.md:55` 滞后的手工候选路由文档。
2. **事实基座**：新增 `lib/domain/custom-fact-builder.mjs`：表单字段 + 素材 URL（走 `lib/integrations/source-fetcher.mjs` 抓取）组装为事实基座，写 `repository_fact_sheets`（`data_json` 带 `kind:'custom'`、`content_type`、`source_level` 标注）并落盘。
3. **GATE**：`lib/domain/social-card-gate.mjs` 新增 `evaluateCustomCardGate`，按内容类型（教程/清单/观点）出检查项；公共项含来源等级完整性检查。
4. **故事板 prompt**：`server.mjs:585-592` 增加 custom 分支（类型化模板 + 渠道约束），前缀 skill bundle 同步。
5. **小红书渲染**：`renderStoryboardHtml` 引入 `channel_mode` 分支（页型、页脚、标签页结构）；`skills/xiaohongshu-article-generator/references/` 新增小红书专属 reference。
6. **前端**：`public/src/views/social-editor.js` 暴露 output_mode / channel 选择；选题池区分仓库候选与自定义候选。
7. **测试**：custom-fact-builder、类型化 GATE、pipeline contentType 分流、渲染 channel_mode 分支。

## 5. 验收标准

- 不依赖 GitHub 仓库即可从手工输入创建自定义图文并走通完整六阶段交付。
- 自定义图文的事实基座、GATE 和故事板按内容类型切换，且与仓库图文互不干扰（现有仓库/突发两条路径回归无损）。
- 文案中体验性表述均可追溯到三个来源等级之一。
- 小红书模式产出与公众号工具贴图在版式和文案契约上明确区分，不是只换皮复用相同 PNG。

## 6. 风险

- 体验真实性依赖 GATE + prompt 双约束，模型仍可能在文案阶段生成虚构体验；source_level 必须贯通到 copy 阶段 prompt，不能只停在 facts。
- `renderStoryboardHtml` 加 channel 分支会触碰 14 套硬编码主题，需防止渠道分支与主题分支交叉爆炸；建议小红书首批只支持限定主题子集。
- output_mode 取值膨胀（渠道 × 类型组合），需在 pipeline 分流处集中解析，避免散落的字符串比较。
- 素材抓取质量参差，自定义事实基座需标注素材抓取状态（成功/失败/未提供），GATE 据此拦截"无素材且要求亲测"的组合。
