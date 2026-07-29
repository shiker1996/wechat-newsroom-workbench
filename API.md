# API 接口文档

## 概览

| 页面（视图） | 加载模块 |
|---|---|
| 今日值班 (dashboard) | app-core.js（首屏） |
| 每日批次 (batches) | app-overview.js（首屏） |
| 热点全景 (overview) | app-overview.js + app-pool-editorial.js |
| 选题池 (topics) | app-pool-editorial.js（按需） |
| 编辑室 (editorial) | app-pool-editorial.js（按需） |
| 文章编辑器 (editor) | app-editor-production.js（按需） |
| 排版预览 (preview) | app-editor-production.js（按需） |
| 热点档案 (hotspots) | app-overview.js（首屏） |
| 产物柜 (artifacts) | app-overview.js（首屏） |
| 采集控制 (system) | app-models-logs.js（首屏） |
| 订阅源 (sources) | app-models-logs.js（首屏） |
| 模型中心 (models) | app-models-logs.js（首屏） |
| 技能与插件 (skills) | public/src/views/system.js（按需） |
| 日志 (logs) | app-models-logs.js（首屏） |
| 内容日历 (calendar) | app-models-logs.js（首屏） |

---

## 批次管理

### GET /api/overview
首页概览数据（批次总数、热点总数、产物总数、最新批次、来源健康）
→ 今日值班

### GET /api/batches
批次列表
→ 今日值班、每日批次

### POST /api/batches
创建新批次 { date, title, note }
→ 每日批次（新建对话框）

### GET /api/batches/:id
单批次详情（含热点列表、来源记录、产物、AI 运行状态）
→ 每日批次（抽屉面板）

### PATCH /api/batches/:id
更新批次 { title, status, stage, note }
→ 每日批次

---

## 采集

### POST /api/batches/:id/collect
启动采集 { sources: ['reddit','rsshub'], maxAgeHours?: 24|48|72|120|168 }
传入 maxAgeHours 时持久化为批次时间窗口，采集过滤与事件研判新鲜度共用；缺省保持批次原值或全局默认 168
→ 每日批次（抽屉面板）

---

## 打标与研判

### POST /api/batches/:id/ai/tag
语义打标 { provider, force, background }
→ 每日批次（抽屉面板）

### POST /api/batches/:id/ai/research
热点研判（聚类、8+2 预选、脑暴）
→ 每日批次（抽屉面板）

### GET /api/batches/:id/overview
热点全景数据（事件聚类、热词）
→ 热点全景

### POST /api/batches/:id/hotword-summary/:word
生成单热词综述
→ 热点全景

---

## 热点

### GET /api/hotspots
热点档案查询 ?q=&source=&date=
→ 热点档案

---

## 选题池

### GET /api/batches/:id/candidates
候选列表（含评分 pool_role, brief_status）
→ 选题池、编辑室、文章编辑器

### POST /api/batches/:id/candidates
加入候选 { hotspotIds: [...] }
→ 选题池

### POST /api/batches/:id/candidates/composite
创建综合选题 { hotspotIds, title, poolRole }
tracks 含 social_cards 时按内容分流：含 GitHub 仓库 → wechat-tool-cards（工具图文）；纯新闻事件 → wechat-event-cards（事件图文，事实基座由事件卡+来源快照合成，见 lib/domain/event-fact-base.mjs）
→ 热点全景（事件卡片 → 创建综合选题）

### POST /api/batches/:id/custom-social-chat/stream
自定义图文对话式策划（NDJSON 流）{ provider, answer, draft, history }
无状态：创建前没有候选记录，草稿与对话历史由前端每轮全量传入；AI 返回 { assistantReply, formUpdates, ready }，前端据此回填创建表单
→ 图文编辑室（创建自定义图文面板 · AI 策划助手）

### POST /api/batches/:id/custom-social-candidates
创建自定义图文候选 { content_type: tutorial|list|opinion, channel: wechat|xiaohongshu, topic, audience, scenario, thesis, points, steps, items, materialUrls, limitations, expected_pages }
要点按行解析，【体验】/【素材】/【建议】前缀标注来源等级；素材链接创建时抓取；轨道 output_mode 写入 wechat-custom-cards 或 xiaohongshu-custom-cards
→ 图文编辑室（创建自定义图文）

### GET /api/creation-entry-points/:entryPoint/social-card-stage-skills
查询图文故事板技能槽位。`entryPoint` 为 `social-tool`、`social-event` 或 `social-custom`；
`contentType` 查询参数分别使用 `repository`、`event` 或 `tutorial|list|opinion`。
返回默认实现、兼容候选、可用状态和不可用原因。

### POST /api/candidates/:id/ai/card-editorial
根据事实基座生成故事板，可传：

```json
{
  "provider": "",
  "stageSkills": {
    "storyboard": "skill-id"
  }
}
```

未显式选择时使用入口默认实现，并在默认不可用时按入口回退：

- `social-tool` → `repository-card-storyboard`
- `social-event` → `event-card-storyboard`
- `social-custom` → `custom-card-storyboard`

显式选择不兼容、未启用或缺少必需工具时返回错误。
实际技能、选择来源和完整阶段 Prompt 会冻结到 generation snapshot。

### DELETE /api/candidates/:id
移除候选
→ 选题池

---

## 编辑室

### GET /api/candidates/:id
候选详情（含 editorial, messages, source_document）
→ 编辑室

### PATCH /api/candidates/:id
更新候选 { angle, thesis }
→ 编辑室（表单保存）

### GET /api/candidates/:id/editorial
编辑决策数据
→ 编辑室

### PUT /api/candidates/:id/editorial
保存编辑决策 { confirmed_facts, author_opinions, ... }
→ 编辑室（表单保存）

### POST /api/candidates/:id/ai/editorial
编辑会 AI 调用（旧，非流式）{ provider, answer }
→ 编辑室（废弃，保留兼容）

### POST /api/candidates/:id/ai/editorial/stream
编辑会 AI 流式调用 { provider, answer } → ndjson
→ 编辑室

### POST /api/candidates/:id/lock
锁定简报（写入 article-brief.md）
→ 编辑室（确认简报）

### POST /api/candidates/:id/source
抓取候选原文 { force }
→ 编辑室

### GET /api/candidates/:id/similar
查询相似历史文章（基于 eventKey + 标题匹配）
→ 编辑室（历史覆盖提示）

---

## 成稿

### POST /api/candidates/:id/ai/draft
AI 起草（单步）{ provider, instructions, existingDraft }
→ 文章编辑器

### POST /api/candidates/:id/ai/article
完整成稿链（规划 → 初稿 → 去 AI → 审稿 → SEO → 终稿）
→ 文章编辑器

### POST /api/batches/:id/ai/typeset
排版 { provider, candidateId, mode, theme }
- `theme` 可选：`magazine-warm`（默认，暖纸杂志风）、`gossip-card`（卡片吃瓜风）
→ 排版预览

---

## 文档（编辑器）

### GET /api/batches/:id/documents
批次全部文档列表，?candidateId=&kind= 时按候选+类型查单篇
→ 文章编辑器（加载全部 / 加载草稿或终稿）

### PUT /api/batches/:id/documents
保存文档 { candidateId, kind, title, content, status }
→ 文章编辑器（保存按钮）

---

## 配图

### GET /api/candidates/:id/images
配图工作区数据（占位列表、本地/CDN 状态）
→ 排版预览

### POST /api/candidates/:id/images/plan
AI 规划配图占位
→ 排版预览

### POST /api/candidates/:id/images/:imageId
保存本地图片 { fileName, mimeType, base64 }
→ 排版预览

### GET /api/candidates/:id/images/:imageId/local
本地图片预览（返回图片文件）
→ 排版预览

### POST /api/candidates/:id/images/:imageId/cdn
上传到 CDN
→ 排版预览

---

## 产物柜

### GET /api/artifacts
产物列表 ?limit=&batch_id=
→ 产物柜

### POST /api/artifacts/reindex
重新扫描工作区，建立产物索引
→ 产物柜

### GET /api/artifacts/:id/content
产物内容预览（返回文件流）
→ 产物柜（点击卡片）

---

## 内容日历

### GET /api/articles
已完结文章列表 ?week=&month=
→ 内容日历

### GET /api/articles/stats
文章统计（累计/本月/本周、按周分布、按类型分布）
→ 产物柜

### GET /api/documents/:id/content
文档正文（返回 text/plain）
→ 内容日历（点击文章标题）、编辑室（历史覆盖提示点击）

---

## 模型

### GET /api/models
模型服务商列表 + 最近调用记录
→ 模型中心

### POST /api/models/test
测试模型连接 { provider }
→ 模型中心

---

## 订阅源

### GET /api/subscriptions
订阅源列表（含最近采集健康状态）
→ 订阅源台账

### POST /api/subscriptions
添加订阅 { kind, value, label }
→ 订阅源台账

### PATCH /api/subscriptions
更新订阅 { kind, value, enabled }
→ 订阅源台账

### DELETE /api/subscriptions
删除订阅 { kind, value }
→ 订阅源台账

### POST /api/subscriptions/test
测试订阅连接 { kind, value }
→ 订阅源台账

---

## 系统

### GET /api/system/health
采集环境检查（Reddit CDP 状态、RSSHub 状态）
→ 采集控制

### GET /api/system/skills
返回只读技能注册表，包括技能包版本、角色、适用入口、内容类型、输入输出契约、必需/可选工具和清单校验状态；同时返回插件能力、启停状态、优先级、健康检查和最近执行结果。
→ 技能与插件

### GET /api/system/skills/:id
返回内置 `SKILL.md` 原文、`skill.json` 结构化契约、来源文件、内容哈希、主/子技能策略归属、历史配置状态，以及该技能可设置的入口/阶段默认范围 `defaultScopes`。
→ 技能与插件

技能写接口 `/versions`、`/dry-run` 和 `/versions/:version/restore` 当前统一返回 `403`。内置技能通过代码仓库修改 `SKILL.md`，不在工作台中在线编辑。

### GET /api/system/skill-entry-defaults
返回主写入口默认映射 `items` 和文章阶段默认映射 `stageItems`。
→ 技能与插件

### PUT /api/system/skill-entry-defaults/:entryPoint
以 `{ "skillId": "..." }` 设置第三方主写技能为入口默认；传空字符串恢复内置路由。
→ 技能与插件

### PUT /api/system/skill-stage-defaults/:entryPoint/:slot
以 `{ "skillId": "..." }` 设置标题、审稿、自然化或 SEO 阶段默认技能；技能必须已启用，并匹配入口、角色和输入输出契约。传空字符串恢复内置默认。
→ 技能与插件

### GET /api/creation-entry-points/:entryPoint/stage-skills
返回指定创作入口的标题、审稿、自然化和 SEO 阶段槽位、当前默认技能、兼容候选及不可用原因，供热点事件、自主写作和批次早报的单次创作配置使用。

### PATCH /api/system/tool-plugins/:id
更新插件启用状态或实现优先级 `{ enabled?, priority?, confirmDisable? }`。仍被活动技能使用时，停用需要显式确认。
→ 技能与插件

### POST /api/system/tool-plugins/:id/test
对指定插件逐能力执行依赖健康检查；停用插件只返回停用状态，不隐式启用。
→ 技能与插件

### GET /api/system/tool-executions
查询工具执行审计 `?batchId=&candidateId=&capability=&limit=`。仅返回参数名、状态、错误码、实现版本、耗时和任务关联，不保存输入正文。
→ 技能与插件、审计

### GET /api/system/generation-snapshots
查询生成快照 `?batchId=&candidateId=&limit=`，用于核对任务使用的技能、Prompt、工具和模型版本。
→ 审计

---

## 任务

### GET /api/jobs/:id
后台任务实时状态（采集、打标、研判、成稿、排版）
→ 各页面（弹窗轮询）

---

## 日志

### GET /api/logs
审计日志 ?type=ai|source|model&limit=
→ 日志
## 批次早报

- `GET /api/batches/:id/daily`：返回当前批次可选的事件事实卡，以及最近保存的批次早报草稿/终稿。
- `POST /api/batches/:id/daily`：启动关系维度早报任务。请求体：`{"provider":"模型配置名","focuses":[{"dimension":"who|what|where","key":"关系键"}]}`；支持跨维度多选，后端对关联事件取并集并去重。
- 生成的 `daily-draft` / `daily-final` 是无候选 ID 的批次级文稿，可在文章编辑器保存版本，并通过排版接口的 `documentKind:"daily-final"` 进入公众号排版。

## 自主写作

- `POST /api/batches/:id/tutorial-chat/stream`：以 NDJSON 流式返回自主写作策划回复和表单更新；`articleMode` 支持 `experience`（心得经验）和 `tutorial`（使用教程）。教程请求可包含 `draft.localProjectPath`，或在本轮回答中提供绝对目录。
- `POST /api/tools/local-project/read`：预检用户明确指定的本地项目目录。只读受支持的文本文件，跳过依赖/构建目录、密钥文件、二进制和符号链接，并受文件数、单文件与总字符数限制。
- `POST /api/batches/:id/custom-articles`：根据对话填好的事实表单创建自主写作项目并启动成稿；旧的 `/tutorials` 路径保留兼容。
- 自主写作项目使用标准文章候选保存 `draft` / `final`，完成后直接出现在文章编辑器和公众号排版页面。
- 本地项目文件按 `user_material` 进入事实基座，只证明代码或配置存在，不证明已执行成功；成稿不得暴露本机绝对路径。
## 受信工具插件管理（P3）

- `POST /api/system/tool-plugin-packages/validate`：预检本地插件目录并返回权限摘要。
- `POST /api/system/tool-plugin-packages/install`：管理员安装受信本地 adapter；需要请求头 `x-admin-confirm: TRUSTED-LOCAL-PLUGIN`。
- `PATCH /api/system/tool-plugins/:id/status`：启用或停用第三方插件；需要管理员确认头。
- `GET /api/system/tool-plugins/:id/versions`：列出可回滚历史版本。
- `POST /api/system/tool-plugins/:id/rollback`：回滚指定版本；需要管理员确认头。
- `DELETE /api/system/tool-plugins/:id`：卸载第三方插件；存在技能依赖时先返回 `409`。
- `GET /api/system/tool-plugin-install-events`：读取插件安装管理审计。

所有本地 adapter 变更都返回 `restartRequired: true`，重启工作台后加载，不在安装请求内执行插件代码。
## 远程 API / MCP 插件（P4）

- `POST /api/system/remote-tool-plugins/validate`：校验声明式远程 Manifest。
- `POST /api/system/remote-tool-plugins`：保存远程连接，默认停用。
- `PATCH /api/system/remote-tool-plugins/:id/status`：即时启用或停用。
- `GET|PUT /api/system/remote-tool-plugins/:id/credentials`：查看配置状态或写入/清除隔离凭据；永不返回凭据原文。
- `POST /api/system/remote-tool-plugins/:id/test`：执行受控连接测试并返回可用性、端点主机和配额状态。
- `DELETE /api/system/remote-tool-plugins/:id`：删除连接；存在技能依赖时先返回 `409`。
- `GET /api/system/remote-tool-plugin-events`：读取安装、启停和卸载事件。

远程连接仅允许 HTTPS，并实施域名、DNS、重定向、超时、响应大小和本地路径隔离策略。`external-write` 能力仍需每次工具调用明确授权。
