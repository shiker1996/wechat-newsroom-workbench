# 见字 · 公众号编辑工作台

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/shiker1996/wechat-newsroom-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/shiker1996/wechat-newsroom-workbench/actions/workflows/ci.yml)
[![Node.js ≥ 24](https://img.shields.io/badge/Node.js-%E2%89%A5%2024-339933?logo=nodedotjs&logoColor=white)](./package.json)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6?logo=windows&logoColor=white)](#支持矩阵)

本地优先的中文内容编辑与图文生产工作台。它以每日批次为主线，把热点采集、事实研判、选题、编辑决策、文章成稿、公众号排版和社交图文交付保存在同一个可审计的本地工作区中。

> **是什么**：面向个人公众号作者的本地内容生产工作台——从热点采集到可直接粘贴的公众号富文本，全链路在本机完成，全程留痕可审计。
>
> **不是什么**：不是 SaaS 服务、不是多用户系统、不是跨平台软件。只监听 `127.0.0.1`，仅支持 Windows，仅供本机可信用户使用（见「安全边界」）。

## 功能总览

| 链路 | 覆盖能力 |
|---|---|
| 采集与研判 | 日常 / 突发批次、阶段状态与中断恢复；Reddit、RSSHub 与 GitHub 项目发现，每个来源单独记录状态、耗时、条数与错误；热点历史检索；热点全景（事件指纹语义聚簇、加权词云、媒体覆盖排名、国内 / 全球 / 国外分栏与多源筛选） |
| 选题与编辑 | 文章池与图文池独立评分、排名、去重和历史覆盖提示；编辑室 AI 流式回应且一次只追问一个关键问题，将明确回答沉淀为结构化决策，执行 WRITE_NOW / 实践 / 未决问题门禁 |
| 成稿与排版 | 按锁定简报执行规划、类型化初稿、去 AI、审稿、SEO 与 2000 字门禁，保留全部阶段产物；配图工作台管理来源与版权状态，按用户明确操作上传 CDN，并真实调用预渲染、HTML 规范化和无 `div` 门禁技能脚本 |
| 图文生产 | 工具图文、事件图文和自定义图文三条入口，面向公众号与小红书生成可编辑故事板、确定性 HTML 和逐页 PNG；自主写作（心得经验 / 使用教程）；批次早报与突发任务专用分析 |
| 扩展与运维 | 可安装技能包、受信本地工具插件、声明式远程 API / MCP 插件，保留生成快照和工具执行审计；运行设置、采集服务控制、订阅健康历史、ZIP 备份 / 校验 / 恢复；产物索引与本地公众号富文本复制；采集环境检查、执行日志和失败原因留存 |

接口清单见 [API.md](./API.md)。计划将仓库公开前需要完成的治理、安全和发布工作见 [docs/open-source-readiness.md](./docs/open-source-readiness.md)。

## 安全边界（务必先读）

- **本项目仅供本机可信用户使用，不支持公网或局域网部署。** HTTP 服务的监听地址在代码中固定为 `127.0.0.1`（`server.mjs`），没有任何配置项可以改为 `0.0.0.0` 或其它主机；请勿自行修改绑定地址后暴露到网络。
- 服务**没有登录、会话、CSRF 防护或多用户权限隔离**。任何能访问本机回环地址的进程都能调用全部 API，包括读取本地文件、执行 AI 任务和触发外部写入。
- `x-admin-confirm`、`x-restore-confirm` 请求头只是**本机防误操作确认**（防止误点恢复备份、安装插件等破坏性按钮），**不是鉴权手段**，不防御任何主动攻击者。
- 安全问题的报告渠道、支持版本和响应预期见 [SECURITY.md](./SECURITY.md)；各第三方服务的数据流向（发送什么、何时发送、如何删除）见 [docs/data-flow.md](./docs/data-flow.md)。

## 目录

- [功能总览](#功能总览)
- [安全边界（务必先读）](#安全边界务必先读)
- [启动](#启动)
  - [支持矩阵](#支持矩阵)
  - [可选依赖：Mermaid 图表](#可选依赖mermaid-图表)
- [接入大模型](#接入大模型)
- [编辑、成稿与排版](#编辑成稿与排版)
- [图文生产](#图文生产)
- [自主写作、早报与突发任务](#自主写作早报与突发任务)
- [技能、插件与设置](#技能插件与设置)
- [Reddit 如何执行](#reddit-如何执行)
- [RSSHub 如何执行](#rsshub-如何执行)
- [数据与产物](#数据与产物)
- [当前边界](#当前边界)
- [许可证与商标](#许可证与商标)
- [发布与版本](#发布与版本)

## 启动

要求 Windows、Node.js 24 或更高版本。当前 Reddit 专用浏览器、RSSHub 生命周期和快捷启动脚本使用 PowerShell；核心 Node.js 服务只监听 `127.0.0.1`，没有面向公网部署所需的登录与多用户权限系统。

### 支持矩阵

| 组件 | 必要性 | 说明 |
|---|---|---|
| Windows 10/11 + PowerShell | 必需 | 启动、停止、Reddit 浏览器和 RSSHub 管理脚本均为 PowerShell；其它系统需自行替换脚本 |
| Node.js ≥ 24 | 必需 | 数据库使用 Node 内置的 `node:sqlite`（无需编译原生模块）；低于 24 无法启动 |
| LLM 服务商（DeepSeek / MiniMax / Kimi 任一） | 必需 | 至少配置一个 API Key 才能跑通成稿链；全部缺失时界面可打开但 AI 功能降级报错 |
| Python 3 | 可选 | 热点原文本地抓取回退；自动发现 `py`/`python`/Codex 内置 Python，找不到可用 `WRITE_ASSISTANT_PYTHON` 指定 |
| Chrome / Chromium | 可选 | Reddit 采集走 CDP 专用浏览器；技能级渲染（图文转图、排版截图）由技能目录内的 Puppeteer 自带 Chromium |
| RSSHub 本地实例 | 可选 | 默认从 `RSSHub/` 目录启动；也可用 `directFeeds` 直连订阅或只采集 Reddit |
| 网络服务商（Firecrawl / Tavily / GitHub / 又拍云） | 可选 | 原文抓取升级、搜索补证、项目发现、CDN 上传，未配置时对应功能降级或关闭 |
| 磁盘空间 | — | 首次安装约需 1–2 GB（npm 依赖 + 技能级 Puppeteer Chromium），运行数据另计 |

**当前仅支持 Windows。** 核心服务本身是标准 Node.js，理论上可在 macOS / Linux 运行，但启动脚本、浏览器采集与验收测试均未在非 Windows 环境验证，请勿当作跨平台软件使用；跨平台可行性评估在开源路线图中（`docs/open-source-readiness.md` P2）。

Windows 可直接双击根目录的 `start-workbench.cmd`。脚本会检查 Node.js 版本和已有服务，按需在后台启动工作台，健康检查通过后自动打开浏览器。

```powershell
npm start
```

首次运行或依赖发生变化时，请先在项目根目录安装依赖。已有锁文件时推荐：

```powershell
npm ci
```

`npm ci`/`npm install` 会通过 `postinstall` 级联安装技能目录内的独立依赖（`skills/*/package.json`，如 ECharts 与 Puppeteer）。离线或下载失败只影响对应渲染功能，可稍后在技能目录内单独执行 `npm install` 补齐。

开发时可使用 `npm run dev` 监听服务端和 `lib` 目录变更。提交前至少执行：

```powershell
npm run build
npm test
```

`npm run build` 是语法、前端入口和本地 import 完整性校验，不会生成独立发布包。

### 可选依赖：Mermaid 图表

普通文章、Markdown 代码块和表格不依赖 Mermaid。只有文章包含 ```` ```mermaid ```` 图表并需要在排版阶段转成 PNG 时，才需要安装 Mermaid CLI：

```powershell
npm install -D @mermaid-js/mermaid-cli
```

Mermaid CLI 使用 Puppeteer 驱动 Chromium/Chrome。工作台会依次查找：

1. `PUPPETEER_EXECUTABLE_PATH` 指定的浏览器；
2. Windows 系统安装的 Google Chrome；
3. Puppeteer 下载缓存中的 Chrome。

启动脚本会执行 `scripts/check-env.mjs`。缺少 Mermaid CLI 或可用浏览器时只显示 `[警告]`，不会阻止普通文章功能启动；但包含 Mermaid 图表的文章会停止排版，以避免图表被静默丢失。可单独运行以下命令检查环境：

```powershell
node scripts/check-env.mjs
```

浏览器打开 `http://127.0.0.1:4317`。

如果重复运行启动命令，工作台会提示“已经在运行”并正常退出，不需要再启动第二份服务。SQLite 的实验性警告已在 npm 脚本中隐藏；它不是运行错误。

需要修改端口、RSSHub 路由、模型参数或内容目录时，把 `config.example.json` 复制为 `config.local.json` 后修改。该文件不会进入 Git。工作台的“设置与数据”页面也可维护 `.env` 中受支持的运行参数、控制 Reddit/RSSHub 进程并导出或恢复备份。
账号定位（名称、读者画像、内容支柱、风格约束等）把 `account-context.example.json` 复制为 `account-context.json` 后按自己的账号修改，字段含义见示例文件与 `lib/domain/account-context.mjs`；该文件不会进入 Git，请勿提交真实账号画像。
临时并行验收可在 `.env` 设置 `WORKBENCH_PORT=4318`；日常运行保持默认 `4317` 即可。

## 接入大模型

工作台内置 OpenAI 兼容模型网关，默认提供 DeepSeek、MiniMax、Kimi 三条路由。推荐复制 `.env.example` 为 `.env`：

```powershell
Copy-Item .env.example .env
```

然后编辑 `.env`，只填写实际使用的服务商：

```dotenv
DEEPSEEK_API_KEY=你的密钥
MINIMAX_API_KEY=你的密钥
MOONSHOT_API_KEY=你的密钥
```

可选的 `TAVILY_API_KEY` 用于配置 Tavily 搜索，`FIRECRAWL_API_KEY` 用于提高 Firecrawl 抓取额度，`GITHUB_TOKEN` 用于提高 GitHub API 限额；又拍云上传仅在配置 `UPYUN_*` 且用户明确点击上传时执行。`.env.example` 给出了当前常用字段；开源前仍需按 [开源准备清单](./docs/open-source-readiness.md) 与运行时字段做一次完整对齐。

`.env` 已被 Git 忽略。设置接口只返回密钥是否已配置，不返回密钥原文；模型调用审计也不保存密钥。工作台也支持在启动服务的 PowerShell 窗口设置环境变量：

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
   首次进入编辑会时，服务端通过可配置的“网页正文”工具槽抓取候选原始 URL。内置路由会优先复用足量 RSS 正文；GitHub 仓库走专用仓库检查；普通网页先执行本地 Python 抓取，质量不足时才升级 Firecrawl，全部失败后只在摘要达到最低长度时降级使用摘要。当回答中出现新 URL，也会先抓取再调用编辑模型。标题、摘要、作者、发布时间和正文会缓存到 `data/source-cache/` 并写入 SQLite。
2. 当问题已经解决，把下一动作设为 `WRITE_NOW`，保存后锁定 `article-brief.md`。实践型选题缺少已确认经历、仍有未决问题或没有锁定命题时，系统拒绝进入成稿。
3. 从“编辑室”确认简报并启动完整成稿链。系统依次生成 `00-article-brief.md` 到 `09-FINAL.md`，审稿未通过时允许一次定向修订；仍未通过或终稿超过 2000 可见字符会明确失败。终稿阶段还会为必须人工提供的来源图、资料图插入结构化占位；没有必要图片时记录为已检查但不制造空占位。
4. 在“排版预览”的配图工作台逐项提供图片、来源和版权状态。本地保存不会上传；只有明确点击某张素材的“上传 CDN”才调用又拍云上传器。上传成功前保留原始终稿和本地文件，不写入伪 URL。
5. 配图全部取得真实 HTTPS 地址后，点击“生成 / 更新排版 HTML”。系统生成 `09-FINAL.images.md`，再调用 `wechat-md-render`、`wechat-html-normalizer` 和 `wechat-html-check-no-div`，生成正式 `article.ai.html`。未解决占位、本地图片、图表或内联视觉模块会阻止正式排版。
6. 正式 HTML 就绪后点击“复制公众号富文本”，直接粘贴到公众号编辑器；不再依赖外部复制页。

每个后台任务都在弹窗中显示逐步日志，成功文件同时进入产物柜。模型返回截断 JSON、审稿不通过、排版门禁失败和预览服务错误都会记录为失败，而不是只记录一次 HTTP 调用成功。

## 图文生产

工作台提供工具图文、事件图文和自定义图文三条生产入口，并支持微信公众号与小红书两个渠道。图文使用统一的 `375 × 667` 页面尺寸，但会根据渠道调整封面表达、信息密度和结尾引导。

推荐工作流：

1. 先建立对应事实基座：工具图文读取仓库与 README，事件图文读取事件卡、来源快照和事实边界，自定义图文读取作者填写的主题、要点和素材；自定义图文创建时可显式勾选联网搜索、新闻时效检索或本地知识库检索，检索结果作为带来源的外部素材一并写入事实基座。
2. 在事实基座卡片中选择公众号或小红书。渠道会写入候选轨道和故事板决策，后续重新生成时继续沿用。
3. 让 AI 生成卡片故事板。故事板保留逐页标题、内部说明、证据、内容块和页面版式。
4. 展开“编辑本页内容”微调标题、正文、内容块小标题及步骤、数据、对比、时间线等结构化内容；也可以逐页指定版式。保存只更新故事板，不触发单张图片重绘。
5. 内容确认后点击“生成图文”，系统根据当前故事板整组生成配套文案、HTML 和逐页 PNG，并执行布局审计与交付门禁。

智能混排支持以下版式：

- `poster`：封面海报大字。
- `editorial`：观点、背景和事实解释使用杂志分栏；单内容块采用标题与正文左右构图，多内容块按实际顺序分栏。
- `data`：数字指标和对比信息。
- `checklist`：清单与场景。1～5 项单列，6～8 项双列普通密度，9 项及以上双列紧凑；换行或使用中文顿号分隔的清单均可识别。
- `steps`：快速开始、教程、流程和时间线；普通文本中的连续编号步骤也会转换为步骤组件。
- `minimal`：结论、提醒和收尾页。

逐页手动版式优先于整组版式；版式与内容块不匹配时会安全降级为适合当前内容的版式。页面固定高度，布局审计会检查利用率、上下留白、溢出和裁切。图文产物保存在 `social-cards/<批次>-<候选>/`，包括 `card-plan.json`、`copy.txt`、`my-design.html`、`layout-report.json`、`delivery-report.json` 和 `output/page-*.png`。

## 自主写作、早报与突发任务

- “自主写作”支持 `experience`（心得经验）和 `tutorial`（使用教程）。教程可读取用户明确指定的本地项目目录，但只读取受支持的文本文件，跳过依赖、构建目录、密钥文件、二进制与符号链接；本地文件只能作为“材料存在”的证据，不能被写成实际运行结果。创建时可显式勾选联网搜索、新闻时效检索（Tavily）或本地知识库检索（只读扫描 `config.local.json` 的 `documentSearch.roots` 授权目录，如 Obsidian 库），结果作为带来源的外部素材写入事实基座，不写成作者亲历。
- “批次早报”从事件事实卡中按主体、动作或地区关系选材，保存批次级草稿和终稿，不要求先创建文章候选。
- “突发任务”创建独立突发批次，支持专用分析、补充材料和路线选择，再进入标准文章或图文生产链。

这些任务与普通热点文章共用模型配置、阶段技能选择、文档版本、任务日志、产物索引和排版能力。

## 技能、插件与设置

- 内置技能位于 `skills/`，通过 `skill.json` 声明角色、入口、内容类型、输入输出契约和工具权限。
- 第三方技能包可先校验再安装，安装后启用；启停、更新、卸载和版本变化均保留事件记录。
- 本地工具插件属于受信代码，安装需要管理员确认头且重启后加载。远程 API / MCP 插件使用声明式 Manifest、HTTPS 与隔离凭据，启停可即时生效。
- 文章主写技能、标题/审稿/自然化/SEO 阶段技能、图文故事板技能和信息工具槽都可配置；每次生成会冻结实际技能、Prompt、模型和工具选择。
- “设置与数据”可维护运行参数、查看来源健康、控制 Reddit/RSSHub、导出 ZIP 备份并在显式确认后恢复。恢复前会自动生成安全备份。

开发扩展格式与校验命令见 [skills/README.md](./skills/README.md)、[docs/examples/skill-package](./docs/examples/skill-package) 和 [docs/examples/tool-plugin](./docs/examples/tool-plugin)。

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
2. 工作台启动时会检查 RSSHub；若不可用，在项目根目录运行 `powershell -ExecutionPolicy Bypass -File scripts/rsshub-start.ps1`。
3. 给冷启动最多 180 秒。
4. 每个目标路由都限制 `limit=30`，默认最多 5 个来源并发读取，逐路由隔离并保留错误。
5. 默认 `keepAlive: true`，RSSHub 在工作台运行期间保持可用；可在“设置与数据”中显式停止或重启。
6. 如果把 `keepAlive` 配为 `false`，采集任务只会停止由本次任务启动的 RSSHub，不会停止原本就在运行的实例。

默认路由包括晚点、TechCrunch、虎嗅、Solidot、ReadHub、界面、Anthropic、36Kr 热榜，以及 GitHub Trending 的日/周/月榜；还会按配置执行 GitHub 新项目发现。实际路由以 `config.local.json` 覆盖后的运行配置为准。

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
- `card-plan.json`
- `my-design.html`
- `layout-report.json`
- `delivery-report.json`
- `output/page-*.png`

工作台不会在重新索引时改写或删除历史文章。备份包含数据库、运行配置状态、技能包与插件目录等受支持数据；恢复是显式破坏性操作，必须先校验备份并提交确认头，服务端会先保存恢复前快照。

数据库使用 Node.js 24 内置的 `node:sqlite` 驱动（WAL 模式，启动命令已带 `--disable-warning=ExperimentalWarning` 抑制实验性提示），不依赖任何原生编译模块。运行期生成的目录：`data/`（数据库、来源与 GitHub 缓存、工具执行审计、技能包版本档案）、`articles/`、`topics/`、`social-cards/`（流水线产物）、`logs/`（运行日志），这些目录都被 `.gitignore` 排除，不会进入仓库。

数据的生命周期管理：**导出**走「设置与数据 → 备份与恢复」下载完整备份；**按批次删除**分两级——归档（批次抽屉内操作，可恢复，数据仅不再出现在当前选择器）与彻底删除（仅已归档批次，先展示影响范围：热点 / 候选 / 文档计数与产物目录清单，确认后级联删除数据库记录并清理产物目录，审计类记录脱钩保留，不可恢复，建议先导出备份）；**缓存清理**在「备份与恢复」面板一键清空 GitHub API 与来源正文缓存（随采集自动重建）；**完整清空**即停止服务后删除上述目录和根目录 `.env`。

备份包内含数据库快照、运行配置状态、技能包与插件目录，清单逐文件记录大小与 SHA-256（`schemaVersion: 1`）。彻底删除数据：先停止服务，再删除上述目录和根目录 `.env` 即可；LLM 与插件凭据不写入数据库。升级兼容：启动时自动执行幂等建表迁移，旧版本直接启动即可；跨大版本恢复备份时强制校验清单版本与文件哈希，恢复前自动保存快照，失败可回滚。

## 当前边界

当前生产链已经把两个技能的关键契约内置进工作台，并对确定性排版步骤直接调用技能脚本：

```text
热点采集 → hotspot-to-topics-orchestrated
         → 编辑会 / 锁定简报
         → wechat-mp-topic-to-article
         → wechat-article-typeset

图文事实基座 → xiaohongshu-article-generator
             → 可编辑卡片故事板 / 智能混排
             → html-pages-to-images
             → 布局审计 / 交付门禁
```

事实补充只通过已配置且被当前技能授权的信息工具执行，不把模型常识自动当成已确认事实；成稿阶段使用来源快照、事件卡、编辑室确认事实和作者材料。遇到 JS 渲染、登录、付费墙或反爬时会记录 `partial/error` 并进入 `RESEARCH_FIRST`。网页抓取拒绝本机、内网和保留地址，并限制 DNS、重定向、响应体大小与超时。

来源图和资料图已经接入配图工作台。事件线、数据卡两类结构化信息图可由规划阶段标记为「可生成」，工作台一键确定性渲染本地 PNG；Mermaid 与声明式 ECharts 围栏可在排版链中转成 PNG；转换失败会保留原围栏并阻止正式交付，转换成功后仍需取得 HTTPS 图片地址。可执行脚本式 ECharts 配置会被拒绝。后台任务在服务重启后仍保留数据库审计记录，但内存中的逐行实时日志不会恢复。

当前版本定位为单机、本地可信用户工具：只监听回环地址，没有账号、租户隔离、CSRF 防护或公网 API 鉴权。不要直接把端口暴露到局域网或互联网。正式开源与公开发布前的缺口见 [docs/open-source-readiness.md](./docs/open-source-readiness.md)。

## 许可证与商标

本项目代码以 [MIT 许可证](./LICENSE) 开源，第三方材料的来源与许可证见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

「见字」是本项目的名称，其文字标识与界面中的「见」字印章样式仅用于标识本项目的官方版本。代码可按 MIT 自由使用、修改和再分发，但修改版或衍生产品在公开分发时不得使用「见字」名称或印章样式暗示与本项目存在官方关联或背书。

## 发布与版本

本项目以**源码仓库**方式分发，不发布 npm 包（`package.json` 保持 `private: true`），使用方式为克隆仓库后按「启动」一节安装运行。版本遵循语义化版本，变更记录见 [CHANGELOG.md](./CHANGELOG.md)，数据库 Schema、技能契约、插件 Manifest 与 REST API 的兼容政策也在其中定义；发布打包与升级 / 降级 / 备份恢复流程见 [docs/release.md](./docs/release.md)。
