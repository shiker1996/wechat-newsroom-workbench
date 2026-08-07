> 状态：现状（随代码改动同步更新）

# 配置项参考

本文汇总工作台全部用户可配置项：改什么、写在哪、什么时候生效。技能包与工具插件的**编写和安装**不在本文范围，见 [extending.md](./extending.md)。

配置优先级（高到低）：系统环境变量 → `.env` → `config.local.json` → `config.example.json`（默认值参考）。`.env`、`config.local.json`、`account-context.json` 均被 `.gitignore` 排除，不要提交。修改后需重启工作台生效（技能配置覆盖层除外，见第 4 节）。

## 1. `.env`：密钥与端口

| 键 | 必需 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` / `MINIMAX_API_KEY` / `KIMI_API_KEY` | 至少一个 | LLM 服务商密钥；全部缺失时界面可打开但 AI 功能降级报错 |
| `TAVILY_API_KEY` | 可选 | Tavily 搜索补证 |
| `FIRECRAWL_API_KEY` | 可选 | 原文抓取升级额度 |
| `GITHUB_TOKEN` | 可选 | 提高 GitHub API 限额（项目发现、仓库检查） |
| `UPYUN_*` | 可选 | 又拍云 CDN 上传，仅在用户明确点击上传时使用 |
| `WORKBENCH_PORT` | 可选 | 覆盖监听端口（日常保持默认 4317；并行验收用 4318） |

设置接口只返回密钥是否已配置，不返回原文；模型调用审计不保存密钥。当前字段全集以 `.env.example` 为准。

## 2. `config.local.json`：运行参数

复制 `config.example.json` 为 `config.local.json` 后修改，未写的键用默认值。结构（括注默认值）：

- `port`（4317）、`workspaceRoot`、`contentRoots`：服务端口与内容扫描根目录。
- `reddit`：Reddit 采集。`cdpUrl`、`subreddits`、`limitPerSubreddit`（15）、`navigationTimeoutMs`。
- `rsshub`：RSSHub 采集。`baseUrl`、`routes`（默认 12 条路由）、`disabledRoutes`、`directFeeds`、`maxAgeHours`（168，旧闻窗口）、`concurrency`（5）、`keepAlive`、`startupTimeoutMs`。
- `githubDiscovery`：GitHub 新项目发现。`enabled`、`createdWithinDays`（30）、`minStars`（1000）、`limit`、`cacheTtlMs`。
  - `aiQueries`：AI 兴趣仓库发现。`enabled`、`refreshDays`（7，查询组缓存天数，缓存文件 `data/repo-discovery-queries.json`，可手工编辑）、`maxQueries`（6）、`perQueryLimit`（15）、`relevanceFilter`、`minInterestScore`（6，兴趣分阈值）。LLM 按 `account-context.json` 内容支柱生成 Search 查询组并做相关性打分过滤；任一环节失败自动退化为纯规则发现（Trending + 增长搜索 + 热点提及）。
- `llm`：模型网关。
  - `defaultProvider`、`requestTimeoutMs`、`safetyReserveTokens`、`recentMessageCount`。
  - `providers.<name>`：`label`、`baseUrl`、`model`、`apiKeyEnv`、`contextWindow`、`maxOutputTokens`、`maxTokensField`。
  - 吞吐参数：`taggingChunkSize`（默认 ≤8，按 `maxOutputTokens` 收紧）、`taggingConcurrency`（默认 6）、`eventCardChunkSize`（默认 3）、`eventCardConcurrency`（默认 4）。
- `aiJobs`：AI 后台任务并发。`maxConcurrent`（2）为全局并发上限，超过上限的任务进入 FIFO 队列等待；候选级任务（文章 / 图文 / 排版 / 自主写作）按候选并行，批次级任务（打标 / 研判 / 事件卡 / 自动流程 / 早报）同批次互斥。
- `articleLength`：文章字数门禁（可见字符，统一五处判定：文章 / 早报 / 教程三条 pipeline 的长度返工区间、技能默认门禁、编辑器前端计数与 preflight 检查）。`minVisibleChars`（1300）/ `maxVisibleChars`（2000）为全局默认区间；`pipelines.article` / `pipelines.daily` / `pipelines.tutorial` 可按链路写同名字段做差异覆盖。生效优先级：技能覆盖层 `gates.length` > `articleLength.pipelines[链路]` > `articleLength` 全局 > 内置默认 1300–2000。编辑器前端经 `GET /api/system/settings` 读取全局区间，无需另配。字数门禁为**建议性**：pipeline 会先按区间尽力自动修复，修复后仍超限只记警告、任务照常完成；编辑器保存终稿不再拦截，仅 toast 提示，超限内容可在编辑器手动删减。

超时、重试、并发与 token 预算的安全默认值及适用范围见 [safety-defaults.md](./safety-defaults.md)。

## 3. `account-context.json`：账号画像与选题评分

复制 `account-context.example.json` 后按自己的账号修改。被编辑会、选题契合加分和成稿技能读取。字段含义：

- 画像：`name`、`description`、`readerProfile`、`contentPillars`（前缀映射打标五类，决定账号契合加分命中）、`voiceGuardrails`、`packagingModes`、`followReason`、`conversionBridge`、`differentiators`、`articleFramework`、`contentRatio`。格式化逻辑见 `lib/domain/account-context.mjs`。
- `scoring`（选题评分参数，可整段省略）：只写想改的键，其余回退代码默认值（`lib/llm/research-pipeline.mjs` 的 `DEFAULT_SCORING`）；非法数值安全回退。
  - `weights`：`{ "h": 0.6, "b": 0.25, "p": 0.15 }`——总分公式 `F = H×h + B×b + P×p - S`。
  - `accountFitBonus`（6）：命中 `contentPillars` 对应类目的维度组加分。
  - `categoryPreference`：预排序分类偏好分（大厂 6 / AI 4 / 行业 3 / 综合 1 / 职场 0）。调低或调负可让泛热点沉底。
  - `pBase`：P 分类基分（大厂 50 / AI 40 / 行业 30 / 综合 20 / 职场 10）。
  - `hBase`：H 爆款画像基分（worker_social 48、bigtech 33 等，完整键见示例文件）。
  - 选题报告 `topics-ranked.md` 底部的公式文案跟随实际权重显示。

## 4. 技能配置覆盖层：`writing-skills/<技能id>/active.json`

在「技能与插件」页面维护，不写 Git 管理的技能本体；每次生成会冻结实际生效的 prompt、模型与工具快照，可回滚历史版本。字段（`lib/skills/configuration.mjs`）：

- `prompt`：覆盖层，追加在内置技能 prompt 之后（`CONFIGURED OVERLAY`），与不可变安全门禁冲突时以门禁为准。
- `defaultModel`：该技能默认模型路由。
- `allowedTools`：工具白名单（信息工具槽位能力 ID）。
- `gates`：质量门禁——`length.minVisibleChars` / `maxVisibleChars`（默认跟随 `config.local.json` 的 `articleLength`，内置兜底 1300–2000；覆盖层配置后优先级最高；字数违规只记 warning，不阻断流程）、`facts`（未核验事实/缺来源/模型建议冒充体验，默认 error）、`voice`（第一人称与亲测声明策略）、`repair`（自动返工开关与上限，默认 1 轮）。

选题阶段 5 个技能（`hotspot-tagging`、`event-card-generator`、`hotspot-brainstorm`、`hotspot-synthesis`、`editorial-room`）同样走覆盖层机制；它们在代码里留有内联 fallback，技能目录缺失时行为不变。

## 5. 技能与工具的编写、校验、安装

三类扩展（第三方技能包、本地工具插件、远程 API/MCP 插件）的形态、权限声明、失败语义、版本兼容与上手路径，统一见 [extending.md](./extending.md)；最小示例在 [examples/](./examples/)。内置技能清单与约定见 [skills/README.md](../skills/README.md)。扩展点契约以 `lib/skills/skill-manifest.schema.json` 与 `lib/tools/manifest-loader.mjs` 为准。

## 6. 运行数据与备份

- 运行期目录（均被 `.gitignore` 排除）：`data/`（数据库、缓存、技能包版本档案、工具执行审计、技能覆盖层）、`articles/`、`topics/`、`social-cards/`、`logs/`。
- 备份/恢复/清缓存/批次删除在「设置与数据 → 备份与恢复」；备份含数据库快照、运行配置状态、技能包与插件目录，逐文件记录 SHA-256。LLM 与插件凭据不写入数据库和备份。
