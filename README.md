# 见字 · 公众号编辑工作台

本地优先的公众号日常生产工作台。当前 MVP 已覆盖：

- 每日批次与阶段状态
- Reddit 与 RSSHub 并发采集；每个 subreddit、RSSHub 路由和直连 Feed 单独记录状态、耗时、条数与错误
- 热点历史检索
- 热点全景：用打标后的事件指纹生成全量语义事件簇、事件加权词云、媒体覆盖排名、国内/全球/国外分栏和多源筛选
- 选题池：从全量热点人工入池，并承接技能评分字段
- 编辑室：AI 流式回应且一次只追问一个关键问题，将明确回答沉淀为结构化决策，并执行 WRITE_NOW / 实践 / 未决问题门禁
- 文章编辑器：按锁定简报执行规划、类型化初稿、去 AI、审稿、SEO 与 2000 字门禁，保留全部阶段产物
- 排版预览：管理必要配图、来源与版权状态，按用户明确操作上传 CDN，并真实调用预渲染、HTML 规范化和无 `div` 门禁技能脚本
- Markdown / JSON / HTML / 配图资产产物索引，以及本地公众号富文本复制
- 采集环境检查、执行日志和失败原因留存

## 启动

要求 Node.js 24 或更高版本，不需要安装 npm 依赖。

```powershell
npm start
```

浏览器打开 `http://127.0.0.1:4317`。

如果重复运行启动命令，工作台会提示“已经在运行”并正常退出，不需要再启动第二份服务。SQLite 的实验性警告已在 npm 脚本中隐藏；它不是运行错误。

需要修改端口、RSSHub 路由或内容目录时，把 `config.example.json` 复制为 `config.local.json` 后修改。该文件不会进入 Git。
临时并行验收可在 `.env` 设置 `WORKBENCH_PORT=4318`；日常运行保持默认 `4317` 即可。

## 接入大模型

工作台内置 OpenAI 兼容模型网关，默认提供 DeepSeek、MiniMax、Kimi 三条路由。推荐复制 `.env.example` 为 `.env`：

```powershell
Copy-Item .env.example .env
```

然后编辑 `.env`：

```dotenv
DEEPSEEK_API_KEY=你的密钥
MINIMAX_API_KEY=你的密钥
MOONSHOT_API_KEY=你的密钥
```

`.env` 已被 Git 忽略，API Key 不会写入 SQLite 或返回浏览器。工作台也支持在启动服务的 PowerShell 窗口设置环境变量：

```powershell
$env:DEEPSEEK_API_KEY = '你的密钥'
$env:MINIMAX_API_KEY = '你的密钥'
$env:MOONSHOT_API_KEY = '你的密钥'
npm start
```

只需配置实际使用的服务商。系统环境变量的优先级高于 `.env`，因此 `.env` 不会覆盖外部已有设置。模型名、Base URL、上下文窗口和输出上限可在 `config.local.json` 的 `llm.providers` 中覆盖，参考结构见 `config.example.json`。修改 `.env`、环境变量或配置后需要重启工作台。

“模型中心”提供最小连接测试、当前批次 AI 打标和调用审计；编辑室、完整成稿链和杂志排版设计均可选择已配置服务商。第三方模型调用会产生费用，并会把对应标题、链接、简报或草稿发送给所选服务商。

每日批次抽屉提供完整的采集后流水线：

1. `开始/继续打标`：只处理尚未完成完整语义标注的热点。打标完成后立即生成事件事实卡（可复用，缺失自动补生成）。
2. `重新打标全部`：用当前模型覆盖本批全部语义标注并重建事件卡，适合修改提示词或更换模型后重跑。
3. `生成/重新执行事件研判`：在全量打标完成后生成事件聚类、核心 8 条 + 黑马 2 条、候补 3 条、探索脑暴和 H/B/P/S/D/F 临时总榜，并自动写入选题池。事件打分会获得所属议题热度的小额加成（多事件议题中的事件不至于整体沉没）；覆盖多个事件的热词还会自动生成"议题综合"候选（综合选题，去重幂等），与事件候选同池竞争。

事件研判生成 `sources/phase-G-output.json`、`sources/event-clusters.json`、`sources/event-cards.json`、`sources/preselection-ranking.json`、`sources/account-context-snapshot.md`、`hotspot-overview.html`、`editorial-agenda.md` 和 `topics-ranked.md`。事件卡为每个事件沉淀结论、已确认事实、来源增量、分歧、时间线、待核内容和可写角度，按小批次并发生成（可用 `llm.providers.*.eventCardChunkSize` / `eventCardConcurrency` 覆盖，默认 3 个事件一批、并发 4）；热词综述以事件卡为依据生成，覆盖范围过大的泛词只用于筛选。合规风险只标记不删除；临时包装不代表作者立场，仍需在编辑室锁定简报后才能成稿。

上下文超过安全预算时，工作台保留事实、来源、作者确认、编辑决策和禁写项，保留最近对话原文，只压缩更早的讨论与旧稿。压缩后仍超限会明确报错，不会静默截断。热点打标按小批次调用；某批结构缺项或 JSON 截断时，只拆分重试缺失项目，已成功结果不会重复计费。

## 编辑、成稿与排版

1. 在“编辑室”选择候选，点击“发送回答 / 让 AI 提问”。AI 回答会逐段显示，每轮只问一个会改变选题方向的问题；你的明确回答会被拆分为公共事实、作者观点、实践证据、否定角度、未决问题和禁写项。
   首次进入编辑会时，服务端默认通过 Firecrawl 托管 MCP 的 `firecrawl_scrape` 抓取候选原始 URL；不可用时回退 `scripts/fetch-hotspot-url.py`。当你的编辑会回答中出现新 URL，也会先执行 MCP 抓取再调用编辑模型。标题、摘要、作者、发布时间和正文会缓存到 `data/source-cache/` 并写入 SQLite。编辑室可以查看抓取方式、状态与来源摘录，也可以手动刷新。
2. 当问题已经解决，把下一动作设为 `WRITE_NOW`，保存后锁定 `article-brief.md`。实践型选题缺少已确认经历、仍有未决问题或没有锁定命题时，系统拒绝进入成稿。
3. 从“编辑室”确认简报并启动完整成稿链。系统依次生成 `00-article-brief.md` 到 `09-FINAL.md`，审稿未通过时允许一次定向修订；仍未通过或终稿超过 2000 可见字符会明确失败。终稿阶段还会为必须人工提供的来源图、资料图插入结构化占位；没有必要图片时记录为已检查但不制造空占位。
4. 在“排版预览”的配图工作台逐项提供图片、来源和版权状态。本地保存不会上传；只有明确点击某张素材的“上传 CDN”才调用又拍云上传器。上传成功前保留原始终稿和本地文件，不写入伪 URL。
5. 配图全部取得真实 HTTPS 地址后，点击“生成 / 更新排版 HTML”。系统生成 `09-FINAL.images.md`，再调用 `wechat-md-render`、`wechat-html-normalizer` 和 `wechat-html-check-no-div`，生成正式 `article.ai.html`。未解决占位、本地图片、图表或内联视觉模块会阻止正式排版。
6. 正式 HTML 就绪后点击“复制公众号富文本”，直接粘贴到公众号编辑器；不再依赖外部复制页。

每个后台任务都在弹窗中显示逐步日志，成功文件同时进入产物柜。模型返回截断 JSON、审稿不通过、排版门禁失败和预览服务错误都会记录为失败，而不是只记录一次 HTTP 调用成功。

## Reddit 如何执行

普通 Chrome 默认不开放外部控制端口，工作台不能直接接管用户日常浏览器。MVP 使用一个独立 Chrome 配置：

```powershell
powershell -File .\scripts\start-reddit-chrome.ps1
```

如需先检查 Chrome 路径而不启动浏览器：

```powershell
powershell -File .\scripts\start-reddit-chrome.ps1 -ValidateOnly
```

脚本会：

1. 在 `data/reddit-chrome-profile` 保存专用浏览器配置。
2. 使用 `9222` 端口开启 Chrome DevTools Protocol。
3. 打开 `old.reddit.com`。

首次使用时在这个新窗口登录 Reddit。以后 Cookie 保留，工作台只连接这个专用配置，不读取日常 Chrome Profile。采集器逐个 subreddit 导航，用一次有界 DOM 脚本提取前 15 条；出现 403 或安全页时明确记录失败，不回退到匿名 JSON 接口。

Chrome 由用户启动和关闭。工作台不会在后台擅自启动可见浏览器，也不会强杀浏览器进程。

## RSSHub 如何执行

工作台遵守现有技能的生命周期约定：

1. 先检查 `http://127.0.0.1:1200/`。
2. 若不可用，在项目根目录运行 `powershell -ExecutionPolicy Bypass -File scripts/rsshub-start.ps1`。
3. 给冷启动最多 180 秒。
4. 每个目标路由都限制 `limit=30`，默认最多 5 个来源并发读取，逐路由隔离并保留错误。
5. 采集结束后，仅当 RSSHub 是本次任务启动的才运行停止脚本。
6. 若 RSSHub 原本就在运行，任务结束后不会停止它。

默认路由与 `hot-trends-summary` 当前配置一致，包括晚点、TechCrunch、虎嗅、Solidot、ReadHub、界面、Anthropic 和 36Kr 热榜。

## 数据与产物

运行数据保存在 `data/workbench.db`，SQLite 开启 WAL。采集得到的每条热点关联到一个每日批次和具体来源身份（而不只笼统记为 `rsshub`），因此同标题的不同信源不会互相覆盖，可以按日期、来源和关键词长期检索。订阅源台账展示最近一次采集健康状态；服务重启时仍处于 `running` 的批次、采集与 AI 任务会自动标为 `interrupted`，允许从对应步骤重跑。

点击“重新扫描工作区”时，工作台只读扫描配置根目录，识别以下规范产物：

- `trends-raw.md`
- `topics-ranked.md`
- `topics-selected.md`
- `editorial-agenda.md`
- `editorial-decisions.md`
- `article-brief.md`
- `09-FINAL.md`
- `image-assets.json`
- `09-FINAL.images.md`
- `article.ai.html`
- `hotspot-overview.html`

工作台不会改写或删除历史文章。

## 当前边界

当前生产链已经把两个技能的关键契约内置进工作台，并对确定性排版步骤直接调用技能脚本：

```text
热点采集 → hotspot-to-topics-orchestrated
         → 编辑会 / 锁定简报
         → wechat-mp-topic-to-article
         → wechat-article-typeset
```

编辑会会抓取已选热点的原始公开 URL，但不会自动搜索网络补造更多事实；成稿阶段只使用来源快照、编辑室确认的事实和作者材料。遇到 JS 渲染、登录、付费墙或反爬时会记录 `partial/error` 并进入 `RESEARCH_FIRST`。抓取器拒绝本机、内网和保留地址，限制重定向、响应体大小与超时。需要新增事实时应先回到编辑室补研究。来源图和资料图已经接入配图工作台；Mermaid、ECharts 和内联视觉模块仍会在检测到时停止并说明需先转图。后台任务在服务重启后仍保留数据库审计记录，但内存中的逐行实时日志不会恢复。
