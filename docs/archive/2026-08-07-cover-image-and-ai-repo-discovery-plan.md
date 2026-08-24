# 工作事项与实施方案：公众号封面图、AI 兴趣仓库、事实基座链接入库

日期：2026-08-07
状态：P0 / P1 / P2（批次出口）均已完成（2026-08-07）

## 背景与排查结论

### A. 公众号封面图生成（缺失功能）

代码库中**没有公众号文章封面图功能**。与"图"相关的现有链路只有两条：

- **文章配图**（IMG-DATA 占位图）：`public/src/views/preview.js` → `POST /api/candidates/:id/images/:slot/generate`（`server/platform/http/routes/media-routes.mjs:88-97`）→ `server/platform/llm/article-image-generator.mjs` → `skills/html-pages-to-images`（puppeteer 截图）。只支持 timeline/datacard 两种结构化图，非封面。
- **图文卡片封面页**：`server/platform/llm/social-card-pipeline.mjs:705`（封面标题 AI 断行），属 social-card 体系，与公众号封面无关。
- 未发现 WeChat 草稿 `thumb_media_id` 封面上传相关代码。

**需求定义（用户确认）**：以公众号文章标题为基础，生成 900×383 的封面图；理想情况下可上传为公众号素材并挂到草稿 `thumb_media_id`。

### B. 工具图文缺"AI 拉取兴趣仓库"（功能缺口）

- 现有 GitHub 仓库发现全是规则驱动，无 AI 参与：
  - Trending：`collectors/rsshub.mjs` 走 RSSHub `/github/trending/{daily,weekly,monthly}/any`；
  - 增长搜索：`collectors/github-discovery.mjs` 硬编码 `stars:>=1000 created:>=近30天 fork:false archived:false`；
  - 热点提及：从热点正文正则提取 github.com 链接。
- `account-context.json` 有丰富兴趣信号（`contentPillars`、`readerProfile`、`scoring.categoryPreference`），但**没有任何环节把兴趣转成 GitHub 搜索查询**；LLM 只在下游（`server/platform/llm/research-pipeline.mjs` 写推荐理由、storyboard 规划）介入。
- 缺口集中在"兴趣 → 查询 → 相关性筛选"一段；下游基础设施（`server/platform/integrations/github-api.mjs` 缓存、`mergeRepository` 去重、`server/domain/repository-candidate.mjs` 候选入库、`skills/repository-card-storyboard/`）全部现成。
- 缺 UI/配置入口：工具图文页（`public/src/views/social-editor.js`，`MODE_LAYOUT.tools`）只有"手动粘贴 URL"。

### C. 事实基座合规提示（Bug，直接阻塞热点创作）

触发机制：editorial-room 技能的合规护栏（`skills/editorial-room/SKILL.md:14-17`、回退 `server/platform/llm/editorial-room.mjs:24-28`）要求用户引用的论据必须出现在"事件卡 confirmedFacts 或已抓取来源快照"（`server/domain/event-fact-base.mjs:9-63`）中，否则要求"明确具体内容与引用边界"。

已有入库通道：编辑会对话中粘贴 URL 会被正则提取并抓取入库（`server/platform/http/routes/article-routes.mjs:99-105` 普通 / `:111-121` 流式；`server/platform/integrations/source-fetcher-core.mjs:115-126` override 缓存 + `store.saveHotspotSource` 落库）。

**实际 Bug（本次提示"朝夕光年/沐瞳科技无出处支撑"的成因）**：

1. `article-routes.mjs:104` 只抓取答案中的**第一个 URL**（`match(...)||[])[0]`），同时贴多个链接时其余永远进不了事实基座；
2. 抓取失败静默，不像 `autoFetchEditorialEvents`（`article-routes.mjs:64-77`）那样把失败说明追加进回复；
3. 综合（composite）候选的 override 快照落到 `hotspot_id=0`（`source-fetcher-core.mjs:148-150`），而 `eventGroupsForCandidate` 只按事件内真实热点 ID 回查（`event-fact-base.mjs:28-31`），该快照永远不会被读回——此路径贴链接完全无效；
4. 编辑会前端和技能提示均未告知"粘贴链接即可触发抓取入库"，模型只会反复要求"明确出处"。

## 优先级

| 优先级 | 事项 | 性质 | 理由 |
|---|---|---|---|
| P0 | C：编辑会外部链接入库修复 | Bug 修复 | 直接阻塞当前热点创作，改动小、收益立竿见影 |
| P1 | A：公众号封面图生成 | 新功能 | 用户刚需（900×383、基于标题），需设计生成方案 |
| P2 | B：AI 兴趣仓库发现 | 新功能 | 增强型需求，可阶段实施 |

## 实施方案

### P0 — 事项 C：编辑会外部链接入库修复（✅ 已完成，2026-08-07）

涉及文件：`server/platform/core/store.mjs`、`server/platform/integrations/source-fetcher-core.mjs`、`server/domain/event-fact-base.mjs`、`server/platform/http/routes/article-routes.mjs`、`skills/editorial-room/SKILL.md`、`public/src/views/editorial.js`。

实际实现（与原规格略有调整——override 统一改走新建的候选级存储，而非修复 hotspot_id=0 回读）：

1. **新增 `candidate_sources` 表**（`UNIQUE(candidate_row_id, url)`，镜像 `hotspot_sources` 字段）与 `saveCandidateSource`/`listCandidateSources`，专门承载编辑会粘贴的补充来源，解决"一个候选多个补充链接"无法入 `hotspot_sources`（按 hotspot_id 单行覆盖）的问题；
2. **override 抓取统一落 candidate_sources**：`fetchCandidateSourceImplementation` 新增 `urlOverrides` 数组参数（兼容原 `urlOverride`），逐条串行抓取、单条失败不影响其余，缓存文件按 `candidate-{id}-override-{hash}.json` 稳定命名；原 composite 场景的 `hotspot_id=0` 孤儿分支已移除；
3. **事实基座注入**：`eventGroupsForCandidate` 末尾追加 `event_id:'user-supplied'`（"用户补充来源"）合成分组，`synthesizeEventAnalysis` 与编辑会输入自动带上；
4. **多 URL 提取 + 结果可见**：普通/流式两端点提取答案中全部 URL（去重、上限 5 条），抓取结果逐条（✅/❌ + 标题/字数/原因）写入对话（`addEditorialMessage` 落库 + 拼进回复/流式 delta）；
5. **提示声明**：`skills/editorial-room/SKILL.md` 事实基座规则新增一条（粘贴链接自动抓取入库、失败须明说）；编辑会输入框 placeholder 已补充说明。

验证：新增 `test/candidate-sources.test.mjs`（存取覆盖、多 URL 抓取、composite 入库与事实基座读回、无补充来源不注入）；`npm run test:fast` 667 通过、0 失败。

### P1 — 事项 A：公众号封面图生成（✅ 已完成，2026-08-07）

需求要点：以文章标题为主体，比例 900:383（公众号封面 2.35:1），风格与账号调性（`account-context.json`）一致。

**✅ 已实施，详见 `docs/2026-08-07-cover-image-design.md`（含实施记录）**。要点：

- **AI 非视觉生成**：AI 只产出结构化设计规格 JSON（组件选择与参数、标题断行/高亮、文案），图片由确定性 HTML/CSS + `html-pages-to-images` 渲染，规格非法时回退默认构图，保证永远出图；
- **组件自由组合**：提供组件目录（底色、色块、标题、标签、副标题、信息行、装饰）由 AI 按文章调性组合，不做固定版式三选一；效果图三版式（`skills/html-pages-to-images/output/cover-mockup/`）作为预置组合示例与兜底；
- **封面主题进主题中心**：新增 `target: 'cover'`，封面主题 = 配色 token 组合，一期内置 4~6 套，二期开放 AI 生成封面主题；
- 一期范围：生成 + 预览 + 重新生成；上传公众号素材（`thumb_media_id`）、手动微调 UI 留二期。

**待确认项**（已解决）：封面风格偏好——已定为"文字排版 + 主题色块"的确定性模板，AI 文生图不做。

### P2 — 事项 B：AI 兴趣仓库发现（✅ 已完成批次出口，2026-08-07；直达出口不做）

分三步，每步可独立交付：

1. **兴趣 → 查询**：✅ 新增 `server/platform/llm/repo-discovery.mjs` 的 `planRepoDiscoveryQueries`，读 `account-context.json` 的 `contentPillars`/`readerProfile`，用 LLM 产出 GitHub Search 查询组（label/关键词/language/时间窗/minStars），消毒后落缓存 `data/repo-discovery-queries.json`（`refreshDays` 内复用，可手工编辑），失败回退缓存或空数组；
2. **相关性筛选**：✅ `collectors/github-discovery.mjs` 支持 `aiQueries` 查询组（新通道 `ai-search`，优先级介于 trending 与 search 之间，逐组独立搜索、单组失败不影响其余）；采集编排层（`server/platform/jobs/job-manager.mjs`）对 `ai-search` 结果调 `filterRepositoriesByInterest` 做 LLM 兴趣打分（≥6 保留，分数/理由随 `raw_json` 入库），同时被规则通道发现的仓库仅降回规则身份不丢弃，过滤失败 fail-open 放行；
3. **入口**：✅ 仅批次出口——过滤后的仓库作为 github 组热点（`sourceType='ai-search'`、`sourceName='AI 兴趣发现 · {label}'`）随采集入批次，经研判评分自然流入工具图文池；工具图文页"AI 推荐仓库"直达出口按用户决定不做。

配置：`githubDiscovery.aiQueries`（`enabled/refreshDays/maxQueries/perQueryLimit/relevanceFilter/minInterestScore`，默认值见 `server/platform/core/config.mjs` 与 `config.example.json`）。

验证：新增 `test/repo-discovery.test.mjs`（查询组消毒/缓存/降级、相关性过滤阈值与 fail-open、采集归并与通道优先级）；`npm run test:fast` 672 通过、0 失败。

## 实施顺序建议

1. P0（事项 C）— 修复编辑会链接入库，解开当前创作阻塞；
2. P1（事项 A）— 封面图生成一期（生成 + 预览，不含上传）；
3. P2（事项 B）— 按 1→2→3 步推进。
