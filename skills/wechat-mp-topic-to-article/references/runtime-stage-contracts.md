# 成稿运行阶段契约

执行器在每次模型调用时加载总技能、全部 references 和当前阶段子技能，并明确当前阶段 ID。阶段顺序固定为：

```text
brief → fact-base → planning → drafting → draft-quality-gate → title-generation → humanize → review → seo-keyword-scoring → seo-optimization → final-quality-gate → research-coverage → visual-planning → image-planning → publication-safety-gate
```

## `brief`

校验并保存锁定简报。该阶段不调用模型。简报、编辑决策、事实与作者观点是全部下游阶段的唯一授权来源。

## `fact-base`

只根据锁定事实、作者观点和来源正文建立事实基座，不使用模型常识补齐日期、数字、人物行为、任职经历、合同细节、引语或来源。对 IPO、上市、估值、融资、违法、造假、压榨、骚扰、事故伤亡和其他公司/个人负面主张记录证据等级、来源归因、日期和使用边界。只返回严格 JSON：

```json
{"claims":[{"id":"claim-1","claim":"待使用主张","status":"verified|disputed|unverified|opinion","evidence":"来源直接证据或作者观点说明","sourceUrl":"直接来源 URL","sourceTitle":"来源标题","sourceType":"official|reliable_media|user_material|anonymous|other","publishedAt":"来源日期","attribution":"主张由谁提出","boundary":"正文使用边界"}],"missingEvidence":["缺失证据"],"forbiddenClaims":["禁止写入的主张"]}
```

没有直接证据的外部事实标为 `unverified`。

事实基座完成后，执行器会生成 `02-publication-claim-register.json`。`verified` 只表示来源直接支持该主张，不表示标题可以脱离归因使用；高影响主张没有可靠证据时只能降格、删除或停止。

## `planning`

根据锁定简报和事实基座建立作者素材、大纲与第一轮标题方向。综合选题明确多个热点之间的关联逻辑；普通选题围绕单一主线。只返回严格 JSON：

```json
{"distributionLane":"推荐池|通知池|实验池","readerStake":"对读者工作、收入、岗位、效率、成本或选择的具体影响","contentRole":"拉新|沉淀|搜索","expectedAction":["评论|分享|收藏|关注|搜索"],"practicalIncrement":"具体实用增量","materialsMarkdown":"作者素材补充","outlineMarkdown":"完整结构大纲","titleCandidates":[{"title":"标题","reason":"理由"}],"selectedTitle":"阶段选中标题","coreKeywords":["核心词"],"remainingRisks":["剩余风险"]}
```

`distributionLane` 与 `readerStake` 继承锁定简报，不得擅自换池；缺失时才根据账号上下文提出建议。`outlineMarkdown` 包含核心判断、目标读者、分发池、读者利益、内容角色、事实基座、结构大纲、信息增量、实用增量和增长承接。

## `drafting`

同时使用总契约与选定写作子技能。只使用 `verified` 事实；`disputed` 呈现分歧，`opinion` 明确为作者判断，`unverified` 不进入正文。前三段自然完成背景、核心冲突、作者判断和阅读钩子；关键事实就近保留来源。输出完整 Markdown，第一行是唯一 H1，不附说明。

## `draft-quality-gate` / `final-quality-gate`

同时使用总契约、写作技能和 `article-reviewer`，执行语义门禁，不用问号、固定词或单一引用格式作机械判断。检查标题兑现、开头、单一主线、章节推进、事实与观点边界、来源覆盖、信息增量、自然表达和发布合规。只返回严格 JSON：

```json
{"pass":true,"issues":[{"type":"fact|structure|opening|citation|voice|title","message":"具体问题","repair":"具体修复要求"}],"strengths":["有效优点"],"citationCoverage":100,"summary":"一句总评"}
```

只有实质影响发布的问题才判定失败，不因个人风格偏好失败。标题、摘要、封面文案和前 200 字单独审核；高影响事实没有可靠证据、争议没有明确归因、或标题有未核实数字/动作/负面指控时必须失败。返工严格按 issues 修复，保留已核验事实、来源、作者立场与风险边界，不新增事实。

第一人称作者判断或阅读动作（如“我看”“我读完后的判断”）不等于第一人称亲测。只有正文声称作者本人测试、部署或使用产品并得到具体结果，且输入中没有已确认实践证据时，才作为未经核实的亲测拦截。

## `title-generation`

同时使用总契约与 `title-generator`，根据已经完成的初稿、事实基座和发布主张登记重新生成标题。准确兑现正文，不夸大，默认不超过 28 个汉字。IPO、上市、估值、融资和公司/个人负面指控必须有对应已核验事实或明确可靠来源归因；只返回严格 JSON：

```json
{"distributionLane":"推荐池|通知池|实验池","readerStake":"具体读者利益","titleCandidates":[{"title":"标题","reason":"理由","score":0}],"selectedTitle":"最终标题","coreKeywords":["核心词"]}
```

`score` 使用 0–12。

## `humanize`

同时使用总契约与 `humanizer-zh`。保留事实、数字、引语、来源、标题、作者观点、素材锚点和风险边界；将“作者判断：”“反方边界：”等元话语标签和模板化结尾改写为自然句式。只输出完整 Markdown，不附评分或修改总结。

## `review`

同时使用总契约与 `article-reviewer`。依据事实基座修订，不新增事实。先输出可发布 Markdown，再在文末保留 `artifact-contracts.md` 规定的唯一 REVIEW 注释。存在 blocker 或未解决 major 时使用 `needs-revision` 并指定返工阶段；最多自动返工两轮。

## `seo-keyword-scoring`

使用 `seo-keyword-scoring` 的确定性评分能力。输出核心词、相对搜索信号、相关词、可用来源数和数据局限；评分不是微信搜索量。

## `seo-optimization`

同时使用总契约与 `seo-content-optimizer`。不改变事实、引语、作者立场、实用增量、来源或已通过审稿的转化段，不新增高影响主张、财经数字、负面指控或绝对化判断；移除 REVIEW 注释，只输出完整 Markdown。SEO 后还要通过发布合规专项门禁。

## `length-repair`

正文低于 `min_visible_chars` 时，只依据事实基座补充必要解释、因果链、反方边界和读者可执行信息；正文超过 `max_visible_chars` 时，只删除重复背景、次要案例和同义结论。两种情况都必须保留标题、关键事实、来源、作者立场、风险边界和实用增量，禁止新增未经核验的事实。只输出完整 Markdown。

## `research-coverage`

使用 `article-reviewer` 对最终 SEO 版本进行语义贴合度检查，只检查作者在编辑室明确采用的研判拓展点。输出 `research-coverage-review.json`，逐条标记 `full`、`partial`、`omitted` 或 `contradicted`；核心采用点没有被文章解释和展开时返回 `needs_revision`，不得用事件摘要或关键词命中代替覆盖。

## `visual-planning`

同时使用总契约与 `article-visual-planner`。只针对确有理解增量的位置规划 Mermaid/ECharts 图表，数字必须逐项来自事实基座；图表围栏在 `image-planning` 之前插入正文，规划结果写入 `09-visual-plan.json`。

## `image-planning`

同时使用总契约与 `article-image-placeholders`。只为必须由编辑提供的来源图、资料图或参考图插入结构化注释；不为纯装饰图强加占位。输出 `09-FINAL.md`，不得进入排版。

## `publication-safety-gate`

在图表规划和配图占位完成后，对实际 `09-FINAL.md` 执行最后一次发布合规检查。模型结合事实基座、发布主张登记和程序风险扫描，逐项检查标题、摘要、封面文案、前 200 字、正文高影响主张、来源归因、名誉、隐私、财经误导和版权风险。只返回与质量门禁相同结构的 JSON；任何无法核验的核心高影响主张、标题中的未核实数字/动作或明显名誉风险都必须 `pass:false`。该门禁失败时不得进入排版。
