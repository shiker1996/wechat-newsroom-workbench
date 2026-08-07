# 第三方服务数据流说明

> 对应开源清单 2.3：说明每个外部服务"发送什么、何时发送、保存多久、如何删除"。
> 本项目本机优先：所有采集缓存、事实基座、文章与图文产物、模型调用记录、工具执行审计均保存在本地 `data/`（SQLite 与文件），不会主动同步到任何自有服务器。

## 总览

| 服务 | 发送内容 | 触发时机 | 凭据 | 本地留存 |
| --- | --- | --- | --- | --- |
| 模型服务商（DeepSeek / MiniMax / Kimi） | 完整提示词：技能 Prompt、事实基座、文章正文、图文故事板、账号画像（AI 兴趣发现 / AI 主题生成）、封面标题与摘要等 | 每次 AI 任务（写作、排版、故事板、评分、兴趣打分、封面排版决策等） | 对应 `*_API_KEY`，Bearer 头 | `model_calls` 表记录调用元数据；正文产物存工作区目录 |
| Firecrawl（MCP） | 待抓取的单条公开 URL | 热点原文抓取（`SOURCE_FETCH_PROVIDER=auto/firecrawl` 时优先） | `FIRECRAWL_API_KEY`（可选），Bearer 头 | 抓取结果存 `data/source-cache/` 与数据库 |
| Tavily | 检索关键词（编辑室取最近一条用户消息前 200 字；信息槽位为技能传入的查询词） | ① 配置 `tavily.enabled` 且任务开启 webSearch（默认关闭）；② 通过网络搜索 / 新闻搜索信息槽位执行（`tavily-search` 插件，技能显式授权后调用） | `TAVILY_API_KEY` | 编辑室检索摘要进入模型上下文，不单独落库；槽位执行的查询词与结果元数据记入 `tool_executions` 审计 |
| GitHub API | 仓库路径、Trending 页面请求、AI 生成的 Search 查询词 | GitHub 项目发现（含 AI 兴趣仓库发现通道）、仓库事实核验 | `GITHUB_TOKEN`（可选），Bearer 头 | `data/github-cache/` 缓存响应（公开仓库数据）；AI 查询组缓存 `data/repo-discovery-queries.json`，可手工编辑 |
| RSSHub（自托管） | 订阅路由请求 | 热点采集、订阅刷新 | 无（本机实例 `127.0.0.1:1200`） | 订阅配置与热点存数据库 |
| Reddit | 无主动发送：通过本机 Chrome CDP 读取页面 | Reddit 热点采集 | 使用用户本机 Chrome 的登录态，不离开本机 | 热点条目存数据库；浏览器 Profile 在 `data/reddit-chrome-profile/` |
| 又拍云 CDN | 图片文件本体 | 仅当用户在配图工作台显式点击"上传 CDN"（external-write 逐次确认） | `UPYUN_OPERATOR` / `UPYUN_PASSWORD` | 上传审计记录 URL 与 key；本地保留原图 |

## 通用原则

1. **无密钥不发送**：缺少凭据时对应功能明确报"未配置"，不会匿名降级调用（RSSHub 自托管、GitHub 公开数据、Firecrawl 免费档 scrape 除外，三者本就支持无密钥使用）。
2. **外部写入逐次确认**：又拍云上传是唯一对外写入第三方存储的操作，必须由用户逐次点击确认；审计日志只记录参数名、目标 URL 和插件版本，不复制图片或凭据。
3. **正文与凭据不进日志**：工具执行审计（`tool_executions`）与任务日志默认脱敏，不记录文档正文、密钥和完整远程响应。

## 保存多久与如何删除

- **本地数据**：热点、文章、快照、缓存会一直保留，直到用户在"设置与数据"页删除对应批次、清空缓存或删除 `data/` 目录；SQLite 数据库与产物目录均可整体删除，无隐藏副本（ZIP 备份除外，备份由用户自行管理）。
- **第三方服务侧**：发送到模型服务商、Firecrawl、Tavily、又拍云的数据遵循各服务商的保留政策，本项目无法代为删除；如需删除，请使用各服务商的控制台或按其政策申请。又拍云已上传图片可在又拍云控制台按 key 删除（审计日志中保留了 key）。
- **Reddit 登录态**：删除 `data/reddit-chrome-profile/` 即清除本项目中保存的 Reddit 会话；浏览器本身的登录不受影响。

## 历史任务可追溯

每次生成任务会保存 generation snapshot（技能 Prompt 哈希、模型与版本、工具插件与版本），用于复现当时实际调用的服务商与版本；删除批次时关联快照一并删除。
