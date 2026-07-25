# 可选功能扩展实施路线图

> 状态：第一批（待办 7-P0）已完成（2026-07-23）；第二批（待办 1+6）已完成（2026-07-25，见[设计评审](./custom-content-and-xiaohongshu-design.md)）；其余待评审  
> 建立日期：2026-07-23  
> 配套清单：[可选功能扩展 TODO](./optional-feature-todos.md)  
> 说明：本文档的改动定位来自对当前代码的实际摸底（文件与行号均为实施时起点，开发时以最新代码为准）。本文只做实施规划，不代表已排期。

## 1. 总览

| # | 待办 | 当前结论 | 价值 | 改动规模 | 建议批次 |
|---|---|---|---|---|---|
| 7-P0 | 事件卡 + 打标输入升级 | 可立即启动 | 高（直接改善研判质量） | 小到中，零数据库迁移 | 第一批 |
| 1 | 非仓库类自定义图文 | 需先完成设计决策 | 高 | 中到大 | 第二批（与 6 捆绑设计） |
| 6 | 完整小红书渠道模式 | 需先完成设计决策 | 中高 | 中 | 第二批（与 1 捆绑设计） |
| 4 | 单页定向重绘 | 待观察返工频率 | 中 | 中 | 第三批 |
| 5 | 多图文任务并行 | 当前不需要 | 低 | 中 | 不做；仅把互斥键改造作为第 4 项的连带工作 |
| 2 | 仓库订阅与 Release 监控 | 已决策不实施 | — | — | 不做 |
| 3 | 自动发布 | 保留人工发布 | — | — | 不做 |
| 7-P1/P2 | 抓取质量评分 / 多抓取器路由 | 等 P0 验收与额度 | 中高 | 中到中到大 | P0 验收后再评估 |

## 2. 推荐实施顺序与理由

### 第一批：待办 7 的 P0（事件总结优先）

- RSS 摘要已被采集器解析并存入 `hotspots.raw_json.summary`，但打标输入只使用标题、来源和时间。摘要进模型是零迁移改动。
- 原待办文档的启动条件是"模型与抓取额度充足"。P0 只做事件级模型调用，不对全部链接抓取正文，因此抓取额度不构成阻塞；真正的抓取额度需求在 P1/P2。
- 验收标准客观、范围可控，且是 P1/P2 的前置（事件卡是代表来源深抓的组织单位）。

### 第二批：待办 1 + 待办 6（自定义图文与小红书渠道捆绑设计）

- 两者共同触碰三处：故事板 prompt、HTML 渲染分支、CARD GATE。拆开实施会在同一批文件上重复返工。
- 建议先完成一次设计评审（见第 5 节开放决策点），再进入开发。

### 第三批：待办 4（单页定向重绘）

- 连带把 AI 任务互斥键从批次级改为 `batchId + candidateId + type`，这是待办 5 的前置，但多任务并行本身仍不实施。
- 启动前先统计一段时间的真实返工频率，确认值得做。

### 明确不做

- 待办 2：已确认不需要订阅，除非出现明确的持续跟踪需求。
- 待办 3：默认保留人工发布。
- 待办 5：单任务执行满足当前需求。
- 待办 7 的 P1/P2：待 P0 验收后再评估，避免先投入抓取基础设施却没有改善总结质量。

## 3. 第一批：事件卡 + 打标输入升级（待办 7-P0）

### 现状

- 打标：`lib/llm/tasks.mjs:17-31`（`buildTaggingInput`）只给模型 `{id, source, title, url, publishedAt, channel}`；`TAG_SYSTEM` 明确写"只根据标题、来源、链接、发布时间判断"。
- 聚类：`lib/llm/research-pipeline.mjs:86-119`（`clusterItems`）按 eventKey 分组，事件只有代表标题、关键词、来源数等元数据，无事件级总结。
- 热词综述：`lib/llm/research-pipeline.mjs:301-379`（`summarizeHotWords`）输入仅 `{hotword, related_articles:[{event_id, title, source}]}`。
- 全景页：`server.mjs:254-284` 现场生成 atlas 并从 `sources/hotword-summaries.json` 挂热词综述。

### 改动清单

1. `lib/llm/tasks.mjs`：`buildTaggingInput` 从 `raw_json.summary` 取摘要（截断到固定长度，如 500 字）注入打标输入；`TAG_SYSTEM` 文案同步更新。Reddit 条目无摘要，按空缺处理。
2. `lib/llm/research-pipeline.mjs`：
   - `clusterItems` 之后、`summarizeHotWords` 之前新增事件卡阶段：每个事件一次模型调用，输入为该事件的"标题 + RSS 摘要 + 来源 + 时间"，输出事件卡（事件结论、背景、已确认事实、来源增量、分歧、时间线、待核内容、可写角度），落盘 `sources/event-cards.json` 并登记产物。
   - `summarizeHotWords` 改为读取事件卡生成跨事件综述，不再直接根据标题生成。
   - 覆盖范围过大的泛词只用于筛选，不直接充当总结主题（在现有 GENERIC_WORDS 排除词表基础上，增加"单热词关联事件数超阈值则降级为筛选词"的确定性规则）。
3. `server.mjs:254-284`：概述 API 把事件卡挂到事件簇上，前端热点全景可在事件卡片中查看事件卡。
4. 失败处理沿用现有打标的拆分重试模式：单事件卡生成失败不阻塞整批，标记待重试。
5. 测试：`test/tagging-retry.test.mjs`（摘要注入）、`test/research-pipeline.test.mjs`（事件卡阶段、综述改读事件卡、泛词降级）、`test/hotspot-atlas.test.mjs`（如涉及 atlas 结构）。

### 验收标准

- 热点全景中每个事件都有独立、可追溯的事件卡。
- 事件卡能区分已确认事实、媒体主张和待核内容。
- 热词综述引用事件卡，不再只依赖报道标题。
- 摘要不存在的来源（如 Reddit）不打断打标与事件卡生成。

## 4. 第二批：自定义图文 + 小红书渠道（待办 1 + 6）

### 现状

- `lib/repository-inspector.mjs:47` 对非 GitHub URL 直接抛错；候选仓库地址只认热点 URL 为 github.com（`server.mjs:88-91`）。非仓库图文当前完全走不通。
- 手工候选入口 `store.addManualHotspot`（`lib/store.mjs:562-580`）已存在，但仅突发专题使用，server 没有暴露路由。
- HTML 由 `renderStoryboardHtml()`（`lib/social-card-pipeline.mjs:43-72`）程序化渲染，14 套主题 CSS 硬编码；`channel_mode` 不进渲染函数，`output_mode='xiaohongshu'` 目前零代码分支。
- CARD GATE：`lib/social-card-gate.mjs`（仓库型 10 项、事件型 8 项），无自定义内容类型。
- 故事板 prompt 内联在 `server.mjs:498-502`，只有仓库型和事件型两套。

### 改动清单

1. 入口：图文选题池增加"创建自定义图文"，新增 server 路由（创建手工候选或直接建候选 + social_cards 轨道），与仓库候选在 UI 上明确区分。
2. 事实基座：新增 `lib/custom-fact-builder.mjs`（或并入 repository-inspector 分流），支持填写主题、目标受众、使用场景、核心观点、素材链接、作者体验、限制说明和期望页数；素材 URL 走 `lib/source-fetcher.mjs` 抓取后纳入事实基座。复用 `repository_fact_sheets` 表或新增自定义事实表（设计时定）。
3. 内容类型化：种草、生活、教程、清单、经验、观点各有独立故事板契约与 GATE 检查项（`lib/social-card-gate.mjs` 扩展）；`server.mjs:498-502` 增加类型化故事板 prompt。
4. 体验真实性边界：事实基座中明确区分"作者真实体验""用户提供素材""模型建议"三个来源等级；GATE 禁止模型虚构亲测、效果或收益；种草和生活类增加广告、功效表述边界检查。
5. 小红书渠道：`renderStoryboardHtml` 引入 `channel_mode` 分支（页型、页脚、标签页结构）；`skills/xiaohongshu-article-generator/references/` 补小红书专属 reference（现只有 wechat 两个）；图文编辑室暴露 output_mode 选择。
6. 继续复用现有视觉主题、逐页 HTML、布局审计、PNG 截图、配套文案和 ZIP 交付能力，不新建执行器。

### 验收标准

- 不依赖 GitHub 仓库即可从手工输入创建自定义图文并走通完整六阶段交付。
- 自定义图文的事实基座、GATE 和故事板按内容类型切换，且与仓库图文互不干扰。
- 文案中体验性表述均可追溯到三个来源等级之一。
- 小红书模式产出与公众号工具贴图在版式和文案契约上明确区分，不是只换皮复用相同 PNG。

## 5. 第三批：单页定向重绘（待办 4）

### 现状

- 无任何页级操作：唯一重跑手段是整组"重新生成图文"，按契约重跑全部 6 阶段并覆盖同目录全部文件。
- AI 任务互斥为批次级（`lib/ai-job-manager.mjs:17-21`），页级重绘会被同批次其他任务阻塞，反之亦然。

### 改动清单

1. `lib/social-card-pipeline.mjs`：把 `runSocialCardPipeline` 拆出可重入阶段函数，支持 `startFrom` 与 `pageNumbers` 参数；`validateDelivery` 与阶段顺序强校验适配部分重跑。
2. `skills/html-pages-to-images/lib/convert-pages.js`：支持只截指定页（当前全量 `.page`）。
3. `lib/ai-job-manager.mjs`：互斥键改为 `batchId + candidateId + type`，并发数保持 1（不实施多任务并行）。
4. `server.mjs:548-553` 附近新增页级重绘路由；`public/src/views/social-editor.js` 画廊每页加"重绘此页"。
5. 一致性保障：单页修改走"改 card-plan 单页 → 重渲染该页 HTML → 整份 HTML 全量布局审计 → 只重截变更页 PNG"，保证页间叙事与视觉一致性不被单页操作破坏；若单页改动导致相邻页审计失败，明确报错而不是静默通过。

### 启动条件

- 先记录一段时间真实返工频率，确认整组重跑确实是痛点再启动。

### 验收标准

- 单页重绘只重跑必要阶段，不重跑 facts/planning。
- 重绘后 PNG 数与页数一致，交付门禁照常用。
- 同批次其他候选的任务不受页级重绘阻塞。

## 6. 开放决策点（实施前需拍板）

1. 第一批是否即待办 7-P0，还是优先做第二批自定义图文。
2. 待办 1 与 6 是否接受捆绑设计（推荐捆绑）。
3. 事件卡先只落盘 `sources/event-cards.json` 产物，还是直接建 `event_cards` 表入库（推荐先落盘，验收后再定）。
4. 自定义图文与仓库图文共用执行器（推荐共用，分流点在 facts 阶段与 GATE），还是拆分执行器。
5. 自定义图文的内容类型首批开放哪几种（建议先教程、清单、观点三类，种草和生活类因合规边界复杂放第二批）。

## 7. 风险

- 事件卡增加每事件一次模型调用，批次事件数较多时成本和耗时上升；需要沿用打标的小批次与拆分重试机制。
- 摘要质量参差：部分 RSS 源 summary 是全文、部分是截断摘要，需要在事件卡输入中标注证据等级，避免模型把摘要当完整正文引用。
- 自定义图文的体验真实性边界依赖 GATE 约束，模型仍可能在文案阶段生成虚构体验，需要把来源等级贯通到 copy 阶段 prompt。
- 单页重绘拆分执行器阶段时，现有"阶段顺序强校验"（`social-card-pipeline.mjs:129-134`）是最容易引入回归的地方，需优先补测试。
