# API 接口文档

## 本地安全会话

- `GET /api/security/session`：建立当前进程内的本地会话并返回随机 CSRF token。
- `POST /api/security/confirmation`：在 CSRF 校验通过后签发 60 秒、一次性、绑定操作类型的敏感操作确认 token。

> 当前版本：0.5.x。本文是本地 REST/NDJSON 接口的完整路由参考，并由 `test/api-docs-routes.test.mjs` 与代码双向校验。面向用户的操作流程见 [详细使用手册](./docs/user-guide.md)，扩展契约见 [插件开发指南](./docs/plugin-development.md)。

## 能力依赖图（只读）

- `GET /api/system/capability-graph`：返回技能、编码功能、采集源、能力和实现组成的统一依赖图，以及各能力的 `ready / degraded / blocked / unused` 状态；`consumerStates` 给出每条消费者—能力关系的可用性、原因码（`CONSUMER_NOT_DECLARED` / `ADAPTER_MISSING` / `ADAPTER_DEGRADED` / `SKILL_NOT_ALLOWED` / `NO_ENABLED_IMPLEMENTATION` / `IMPLEMENTATION_UNHEALTHY`）与候选实现。
- `GET /api/system/capability-consumers`：返回全部消费者的清单及可用/降级/阻断关系统计（Agent / 技能 / 流水线功能三类；页面按类型分组，Agent 归属的运行时技能不单列）；feature 消费者携带 `purpose` 用途说明。
- `GET /api/system/capability-consumers/:consumerId`：返回单个消费者的完整能力链路（声明、适配、技能授权、实现状态、不可用原因、已知缺口），只读且不含本地路径、allowedRoots 或凭据。技能消费者的 `runtimeSkillIds` 视为其自身，`skillAuthorizations` 返回自身的授权描述（editable/locked/whitelist/version）；feature 消费者的 `skillAuthorizations` 恒为空数组（无授权开关），详情顶层携带 `purpose` 用途说明，各行携带 `requirement`/`failurePolicy`/`triggerPolicy`/`resultPolicy`。
- `GET /api/system/conversation-agent-runs?limit=100`：返回三类对话 Agent 的统一运行历史、关联工具调用，以及按入口和能力聚合的成功率、失败数和平均耗时；`estimatedCost` 在供应商未提供可审计费用时为 `null`。
- `GET /api/system/tools/:id/status-impact`：模拟停用普通工具后的能力阻断、降级和剩余候选。
- `GET /api/system/collectors/:id/status-impact`：模拟停用采集器后的采集源影响。

阶段 1 的影响接口只读，不会修改工具状态。

停用或卸载工具时，客户端必须先读取对应 `status-impact`，确认 `canDisable=true` 后将返回的 `impactVersion` 放入状态修改请求。服务端会重新计算影响：版本过期返回 `409 requiresImpactConfirmation`；断开必需能力返回 `409 blocked`。停用仅影响新任务，历史记录继续保留。

- `GET /api/system/tool-invocations/:resolutionId`：按尝试顺序返回一次能力调用的首选实现、失败原因、兜底来源和最终实现。
- `PUT /api/system/capability-routes/:capability`：设置统一能力首选实现，正文为 `{ "preferredImplementationId": "plugin-id" }`；传空值表示恢复自动选择。能力未登记（`registered:false`）时拒绝设置首选，返回 `400 CAPABILITY_NOT_REGISTERED`。
- `POST /api/system/capability-catalog`：能力目录草案确认入库（需管理员确认），正文为 `{ "entries": [{ "id", "name", "description", "category" }] }`；逐条校验 ID 格式与必填字段，已登记条目返回 `400`。目录外能力的实现允许存在（调试期宽容），但任何启用路径（内置/第三方/远程工具与采集器）都会被拒绝并返回 `400 CAPABILITY_NOT_REGISTERED`，必须先经本接口或手工补目录条目。

## 概览

| 页面（视图） | 加载模块 |
|---|---|
| 今日值班 | `public/src/views/dashboard.js` |
| 每日批次 | `public/src/views/batches.js`、`batch-drawer.js` |
| 热点全景 | `public/src/views/atlas.js` |
| 文章池 / 图文池 | `public/src/views/topics.js` |
| 编辑室 | `public/src/views/editorial.js` |
| 文章编辑器 | `public/src/views/editor.js` |
| 排版预览 | `public/src/views/preview.js` |
| 图文编辑室 | `public/src/views/social-editor.js` |
| 自主写作 | `public/src/views/tutorial.js` |
| 批次早报 | `public/src/views/daily.js` |
| 热点档案 | `public/src/views/hotspots.js` |
| 产物柜 | `public/src/views/artifacts.js` |
| 设置与采集 | `public/src/views/system.js` |
| 技能与插件 | `public/src/views/skills.js` |
| 订阅源 | `public/src/views/subscriptions.js` |
| 模型中心 | `public/src/views/models.js` |
| 日志 | `public/src/views/logs.js` |
| 内容日历 | `public/src/views/calendar.js` |

---

## 调用约定与安全边界

- 默认地址为 `http://127.0.0.1:4317`，所有接口均位于 `/api` 下；服务只监听回环地址。
- 普通 JSON 请求使用 `Content-Type: application/json`。流式策划与编辑会接口返回 `application/x-ndjson`，每行一个 `{ type, ... }` 事件。
- 创建资源通常返回 `201`，启动后台任务通常返回 `202`；输入错误返回 `400`，资源不存在返回 `404`，状态或依赖冲突返回 `409`。
- 后台任务启动响应包含任务 ID；用 `GET /api/jobs/:id` 轮询。服务重启后逐行内存日志不会恢复，但数据库中的运行审计仍可通过 `GET /api/jobs` 查询。
- 本 API 面向本机单用户工作台，没有通用登录、会话或公网鉴权。插件安装和备份恢复使用专用确认头，只是防误操作门禁，不是多用户授权机制。
- 路径参数中的批次 ID、技能 ID、插件 ID 和文件名应 URL 编码。文档中的 `:id` 为路径占位符。

### 主题目录

- `GET /api/themes?target=article|social`：按目标列出已发布主题，包含默认主题、来源、版本、哈希和固定样稿预览色。
- `GET /api/themes/:id`：读取单个主题的公开元数据；用户主题同时返回五项发布兼容报告、`full/read-only` 编辑模式和目标配方目录。可用 `target=article|social` 校验目标兼容性。
- `GET /api/themes/manage`：列出当前工作区的用户主题，包括草稿和归档状态。
- `POST /api/themes`：创建用户主题草稿。
- `POST /api/themes/ai/generate`：根据文章/图文/封面视觉描述生成短期 AI 主题候选（封面主题为纯 token 主题，无组件配方），执行结构化输出修复、确定性规范化、五项发布审计、正式样稿编译及与内置/用户主题的视觉相似度比较；响应包含最近主题、差异摘要和重新生成建议，候选默认 15 分钟过期且不写入主题草稿。
- `POST /api/themes/ai/candidates/:candidateId/create`：确认服务端短期候选并创建用户主题草稿；只接受可选名称和描述，不接受前端回传主题定义，成功后候选立即失效。
- `POST /api/social/template-proposals`：根据 Social 主题意图和可选基础模板包生成短期模板提案。模型只能返回受控 JSON；服务端补齐提案 ID、状态、来源和 provenance，并执行字段、角色、内容块和安全清理。请求可用 `draftMode=html-css` 生成仅隔离预览草稿，默认 `json`；提案默认 20 分钟过期且不会写入生产模板目录。
- `POST /api/social/template-proposals/ai/generate`：上述模板提案生成接口的语义别名，兼容按 AI 生成路径调用的客户端。
- `POST /api/themes/social-template-proposals/generate`：主题中心使用的模板提案生成兼容入口，契约与 Social 模板提案接口一致。
- `GET /api/social/template-proposals/:proposalId`：读取仍在 TTL 内的短期模板提案；过期返回 `410`。提案进入生产前仍需后续编译、正式样稿门禁和用户确认。
- `POST /api/social/template-proposals/:proposalId/compile`：将受控 JSON 提案编译为正式 Social renderer 配置，生成固定 375×667 样稿并执行角色、内容块、对比度、字体层级、伪元素可见性和安全门禁；仅返回预览与审计结果，不创建生产模板包。
- `POST /api/social/template-proposals/:proposalId/confirm`：在正式样稿门禁通过后，将模板提案作为版本化自定义模板包绑定到指定 Social 用户主题草稿；不直接发布主题，需继续调用主题发布接口。
- `GET /api/social/template-proposals/metrics`：读取 Social 模板提案生成、正式编译、确认绑定和门禁失败指标；返回接受率、正式通过率、失败角色、过空/溢出统计，以及是否有足够真实证据进入 renderer 扩展评估。
- `POST /api/themes/preview`：对请求中的未保存文章或图文主题定义执行严格校验，并用正式生产编译器返回固定样稿 HTML、`usageMap` 和可选字段影响高亮；不写入草稿。
- `POST /api/themes/:id/clone`：复制内置或已发布用户主题为新草稿。
- `PUT /api/themes/:id/draft`：保存结构化主题草稿。
- `POST /api/themes/:id/validate`：执行与发布相同的 Schema、对比度、编译覆盖、固定样稿 HTML 和布局结构五项门禁，问题包含字段与样稿节点。
- `POST /api/themes/:id/preview`：使用用户主题草稿或请求中的临时定义返回正式编译固定样稿。
- `POST /api/themes/:id/publish`：发布新的不可变主题版本。
- `POST /api/themes/:id/archive`：归档用户主题，保留历史版本。
- `GET /api/themes/:id/versions`：读取版本历史。
- `POST /api/themes/:id/versions/:version/restore`：从历史版本创建新草稿。
- `POST /api/themes/import`：导入安全 JSON，并且只创建用户草稿；重复 ID 与未知 Schema 会被拒绝。
- `GET /api/themes/:id/export`：导出规范主题 JSON；用户主题可用 `draft=1` 导出当前草稿。
- `GET /api/themes/:id/usage`：读取总使用次数、涉及批次、最近使用时间及版本级统计。
- `GET /api/themes/:id/archive-impact`：归档前检查历史版本和任务引用影响。

---

## 可复制调用示例

以下示例假设服务运行在默认地址 `http://127.0.0.1:4317`。curl 示例在 Windows PowerShell 中请使用 `curl.exe`（`curl` 是 `Invoke-WebRequest` 的别名）。

### NDJSON 流（编辑会 / 策划流式接口）

流式接口返回 `application/x-ndjson`，每行一个 `{ "type": ... }` 事件：`delta` 为增量文本，`done` 携带最终结果，`error` 表示失败。

```bash
curl.exe -N -X POST http://127.0.0.1:4317/api/candidates/1/ai/editorial/stream ^
  -H "Content-Type: application/json" ^
  -d "{\"answer\": \"这个选题可以写，重点放在影响面\"}"
```

输出示例（逐行到达）：

```ndjson
{"type":"delta","text":"可以写。"}
{"type":"delta","text":"建议从影响面切入……"}
{"type":"done","data":{"summary":"..."}}
```

PowerShell 原生读取流（`Invoke-RestMethod` 会等全部响应，不适合流式）：

```powershell
$req = [System.Net.Http.HttpRequestMessage]::new('Post', 'http://127.0.0.1:4317/api/candidates/1/ai/editorial/stream')
$req.Content = [System.Net.Http.StringContent]::new('{"answer":"可以写"}', [Text.Encoding]::UTF8, 'application/json')
$client = [System.Net.Http.HttpClient]::new()
$resp = $client.SendAsync($req, 'ResponseHeadersRead').Result
$reader = [System.IO.StreamReader]::new($resp.Content.ReadAsStreamAsync().Result)
while (($line = $reader.ReadLine()) -ne $null) { Write-Host $line }
```

### 后台任务（启动 → 轮询）

启动后台任务返回 `202` 与任务 ID，用 `GET /api/jobs/:id` 轮询状态：

```bash
# 启动成稿任务（202）
curl.exe -X POST http://127.0.0.1:4317/api/candidates/1/ai/article ^
  -H "Content-Type: application/json" -d "{}"
# => {"id":"<jobId>","type":"article","status":"running",...}

# 轮询单个任务
curl.exe http://127.0.0.1:4317/api/jobs/<jobId>

# 最近任务列表（服务重启后数据库审计仍可查）
curl.exe "http://127.0.0.1:4317/api/jobs?limit=10"
```

```powershell
$job = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4317/api/candidates/1/ai/article' -ContentType 'application/json' -Body '{}'
Invoke-RestMethod -Uri "http://127.0.0.1:4317/api/jobs/$($job.id)"
```

### 错误响应

错误统一为 `{ "error": "<人类可读原因>" }`，状态码遵循上文约定：

```bash
curl.exe -X POST http://127.0.0.1:4317/api/candidates/999999/ai/article -H "Content-Type: application/json" -d "{}"
# HTTP 404
# {"error":"候选不存在"}
```

### 确认头（防误操作门禁，非鉴权）

变更类管理路由必须带确认头，否则返回错误。技能 / 插件变更用 `x-admin-confirm: TRUSTED-LOCAL-PLUGIN`：

```bash
# 卸载一个已安装技能
curl.exe -X DELETE http://127.0.0.1:4317/api/system/skills/<skillId> ^
  -H "x-admin-confirm: TRUSTED-LOCAL-PLUGIN"
```

备份恢复用 `x-restore-confirm: RESTORE`（恢复前服务端自动保存快照）：

```bash
curl.exe -X POST http://127.0.0.1:4317/api/system/backup/restore ^
  -H "Content-Type: application/json" -H "x-restore-confirm: RESTORE" ^
  -d "{\"file\": \"backup-2026-07-31.zip\"}"
```

> OpenAPI 决策（2026-07-31）：不生成 OpenAPI。路由表以手写本文档为准，`test/api-docs-routes.test.mjs` 在 CI 中双向校验代码路由与文档条目，漂移会直接拦截；引入 OpenAPI 生成器会增加一套需要同步的 schema 维护成本，对本机单用户 API 收益有限。

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

### POST /api/batches/breaking
创建突发批次。请求体可包含 `{ date, title, note, urls, requestedTracks }`；`urls` 可为数组或换行文本，`requestedTracks` 缺省为 `["article"]`。突发批次与普通每日批次隔离。
→ 突发任务

### GET /api/batches/:id
单批次详情（含热点列表、来源记录、产物、AI 运行状态）
→ 每日批次（抽屉面板）

### PATCH /api/batches/:id
更新批次 { title, status, stage, note, lifecycleStatus: active|completed|archived }（归档是可恢复的删除）
→ 每日批次

### GET /api/batches/:id/delete-impact
彻底删除前的影响范围预览 { batch, counts: { hotspots, candidates, documents, sourceRuns, subscriptionRuns, modelCalls, aiRuns, artifacts }, directories: [{ kind, dir, exists, files, bytes, skipped }] }；与其他批次共享的遗留目录标记 skipped
→ 每日批次（抽屉面板 · 已归档批次）

### DELETE /api/batches/:id
彻底删除已归档批次：级联删除子表记录（审计类表脱钩保留）并清理产物目录，不可恢复。仅 `archived` 批次可删（否则 409）；需要请求头 `x-admin-confirm: DELETE-BATCH`
→ 每日批次（抽屉面板 · 已归档批次）

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

### POST /api/batches/:id/ai/auto
启动采集后的自动流水线，按当前状态继续打标、事件卡和研判。
→ 每日批次

### POST /api/batches/:id/ai/event-cards
为本批次补生成或重建事件事实卡。

### POST /api/batches/:id/pipeline-failures/:failureId/retry

只重试指定失败对象。采集按原 `subscription_run` 的单个来源执行，打标按单个热点执行，事件卡按单个 `event_id` 执行，研判阶段错误整体重跑研判；成功后失败记录自动转为 `resolved`，失败时回到 `open` 并更新原因。

### POST /api/batches/:id/pipeline-failures/:failureId/skip

将可安全隔离的失败对象标为已跳过。采集源只影响当前批次；打标热点退出研究范围；事件卡对应事件退出本批次研判。批次级研判错误不能跳过。

### POST /api/batches/:id/pipeline-failures/:failureId/reopen

把 `skipped` 或 `resolved` 记录恢复为 `open`；打标热点同步恢复研究资格，事件重新进入事件卡与研判范围。
→ 每日批次

### GET /api/batches/:id/overview
热点全景数据（事件聚类、热词）
→ 热点全景

### GET /api/batches/:id/ranking
文章池的研判排名与预选结果。

### GET /api/batches/:id/social-ranking
图文池的独立排名、GitHub 项目发现结果与历史覆盖信息。

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
自定义图文对话式策划（NDJSON 流）{ provider, answer, draft, history }。固定使用显式只读 ToolCall，关闭 provider 隐式搜索，并返回 `assistant.delta`、`tool.requested`、`tool.running`、`tool.completed`、`tool.failed`、`agent.limit`；外部资料仅以带公开 URL 的【素材】写入表单，`done.data` 包含 `agentRunId` 与 `toolCalls`。
无状态：创建前没有候选记录，草稿与对话历史由前端每轮全量传入；AI 返回 { assistantReply, formUpdates, ready }，前端据此回填创建表单
→ 图文编辑室（创建自定义图文面板 · AI 策划助手）

### POST /api/batches/:id/custom-social-candidates
创建自定义图文候选 { content_type: tutorial|list|opinion, channel: wechat|xiaohongshu, topic, audience, scenario, thesis, points, steps, items, materialUrls, limitations, expected_pages }
要点按行解析，【体验】/【素材】/【建议】前缀标注来源等级；素材链接创建时抓取；轨道 output_mode 写入 wechat-custom-cards 或 xiaohongshu-custom-cards
→ 图文编辑室（创建自定义图文）

### POST /api/batches/:id/repository-candidates
手动添加仓库图文候选 { url: GitHub 仓库地址, channel: wechat|xiaohongshu }
URL 规范化为裸仓库地址（https://github.com/owner/repo）；经手工热点建立 social_cards 候选，轨道 output_mode 写入 wechat-tool-cards 或 xiaohongshu-tool-cards；后续仓库核验、故事板与生成走工具图文既有流程
→ 图文编辑室（添加仓库图文）

### GET /api/creation-entry-points/:entryPoint/social-card-stage-skills
查询图文故事板技能槽位。`entryPoint` 为 `social-tool`、`social-event` 或 `social-custom`；
`contentType` 查询参数分别使用 `repository`、`event` 或 `tutorial|list|opinion`。
命名说明：`social-custom` 是图文阶段管线的历史入口名，会话 Agent 层使用 `custom-social`，两者指同一自定义图文通道，
`lib/skills/entry-routing.mjs` 的别名机制双向兼容；新增代码应使用 `custom-social`，`social-custom` 仅为兼容保留（阶段 6 起弃用，不删除）。
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

### GET /api/candidates/:id/similar-social
查询同仓库或同主题的历史图文覆盖记录。
→ 图文编辑室

### DELETE /api/candidates/:id/tracks/:track
只移除候选的指定轨道（`article` 或 `social_cards`）；候选没有其它轨道时一并删除候选。

### POST /api/candidates/:id/tracks
护栏路由：文章池与图文池使用独立评分，不支持候选跨池添加，统一返回 `409`。
→ 选题池

### DELETE /api/candidates/:id
移除候选
→ 选题池

---

## 突发任务

### POST /api/batches/:id/ai/breaking-analysis
启动突发事件专用分析任务，可选择模型服务商。

### GET /api/batches/:id/breaking-analysis
读取突发分析、来源、事实边界和当前路线。

### POST /api/batches/:id/breaking-materials
向突发任务补充材料 URL，`urls` 可为数组或换行文本；材料会进入后续突发分析的来源处理链。

### POST /api/batches/:id/breaking-analysis/route
确认后续路线与编辑决策，使任务进入文章或图文生产链。

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
编辑会 NDJSON 对话流，返回 `assistant.delta`、`assistant.thinking`、`tool.requested`、`tool.running`、`tool.completed`、`tool.failed`、`agent.limit`、`done` 和 `error`。工具事件只公开能力名、原因、状态、摘要和公开来源，不返回完整参数、绝对路径或插件配置；`done.data` 附带 `agentRunId` 与 `toolCalls`。
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

### GET /api/candidates/:id/writer-skills
返回此候选可用的主写技能、推荐实现、当前默认和不可用原因。

### GET /api/candidates/:id/stage-skills
返回标题、审稿、自然化和 SEO 阶段的可用技能槽位。

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
- `theme` 可选：`auto`、`magazine-warm`（暖纸杂志风）、`gossip-card`（卡片吃瓜风）、`tech-wire`（暗色终端）、`research-report`（财经印刷）、`career-essay`（书信手账）、`news-digest`（黑白快讯）。
- `auto` 按候选类别和文章形态选择主题；无法识别时回退 `magazine-warm`。
→ 排版预览

---

## 文档（编辑器）

### GET /api/batches/:id/documents
批次全部文档列表，?candidateId=&kind= 时按候选+类型查单篇
→ 文章编辑器（加载全部 / 加载草稿或终稿）

### PUT /api/batches/:id/documents
保存文档 { candidateId, kind, title, content, status }
→ 文章编辑器（保存按钮）

### GET /api/documents/:id/revisions
列出文档版本。

### GET /api/documents/:id/revisions/:version
读取指定版本。

### POST /api/documents/:id/revisions/:version/restore
把指定历史版本恢复为当前正文；恢复本身也会形成新版本。

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

### PUT /api/candidates/:id/images/:imageId
只更新图片来源、版权状态、说明等元数据，不上传文件。

### GET /api/candidates/:id/images/:imageId/local
本地图片预览（返回图片文件）
→ 排版预览

### POST /api/candidates/:id/images/:imageId/cdn
上传到 CDN
→ 排版预览

### POST /api/candidates/:id/images/:imageId/generate
可生成占位（`IMG-DATA`，timeline / datacard）确定性生成本地 PNG；仅本地写入，上传仍需显式调用 `/cdn`
→ 排版预览（配图工作台「生成图片」）

### GET /api/batches/:id/daily/images
读取批次早报配图工作区。

### POST /api/batches/:id/daily/images/:imageId
保存批次早报本地图片。

### POST /api/batches/:id/daily/images/:imageId/generate
根据早报配图占位中的结构化 generate 规格生成本地图片。

### GET /api/batches/:id/daily/images/:imageId/local
预览批次早报本地图片。

### POST /api/batches/:id/daily/images/:imageId/cdn
把批次早报图片上传到已配置 CDN。

### POST /api/batches/:id/visual-plan
根据文稿生成声明式视觉建议，返回建议、复杂度与可执行边界。

### POST /api/visual-preview
对选定视觉建议生成预览。

### POST /api/visual-decisions
保存编辑者对视觉建议的接受、拒绝和原因，供后续统计。

---

## 文章封面图

### POST /api/candidates/:id/cover/generate
生成 900×383 公众号封面图 { provider?, theme? }；theme 为封面主题 id 或 "auto"（AI 按文章调性选主题）。缺少成稿终稿时返回 409。返回 202 AI 任务（type=cover-image）
→ 文章封面图

### GET /api/candidates/:id/cover
封面图状态 { exists, size?, modifiedAt?, title? }。

### GET /api/candidates/:id/cover/local
封面 PNG 预览（返回图片文件）
→ 文章封面图

### POST /api/batches/:id/daily/cover/generate
生成批次早报的 900×383 封面图 { provider?, theme? }；终稿取批次级 daily-final 文档，产物落 articles/<批次>/daily/images/cover.png。缺少早报终稿时返回 409。返回 202 AI 任务（type=cover-image，candidateId=null）
→ 文章封面图

### GET /api/batches/:id/daily/cover
早报封面图状态 { exists, size?, modifiedAt?, title? }。

### GET /api/batches/:id/daily/cover/local
早报封面 PNG 预览（返回图片文件）
→ 文章封面图

---

## 图文故事板与交付

### GET /api/social/template-metrics
读取 Social 图文按模板包、主题和页面角色聚合的运行指标与容量校准建议。支持 `templatePackId`、`themeId`、`pageRole` 查询参数；容量偏差只建议调整 profile，只有发现未覆盖的结构原语时才建议评估 renderer 扩展。

### GET /api/candidates/:id/card-editorial
读取图文事实基座、门禁、渠道和当前故事板。

### PUT /api/candidates/:id/card-editorial
保存图文编辑决策与完整故事板。

### PUT /api/candidates/:id/card-pages/:page
只更新指定页的标题、正文和结构化内容块，不触发渲染。

### PUT /api/candidates/:id/card-pages/:page/layout
设置或清除指定页的版式 / 构图选择。

### POST /api/candidates/:id/card-pages/:page/ai
根据布局审计和完整事实基座，对指定故事板页执行 AI 扩写或缩写；只更新故事板，不直接重绘 PNG。

### POST /api/candidates/:id/card-channel
切换 `wechat` / `xiaohongshu` 渠道并持久化到候选轨道与编辑决策。

### POST /api/candidates/:id/repository/inspect
检查工具图文关联的 GitHub 仓库，生成或刷新仓库事实清单。

### POST /api/candidates/:id/card-lock
执行事实和编辑门禁，锁定图文故事板。

### POST /api/candidates/:id/ai/social-card
按已锁定故事板启动整组图文生成，产出文案、HTML、PNG、布局与交付报告。

### GET /api/candidates/:id/social-cards
读取图文交付状态、图片清单、文案、事实清单和报告。

### GET /api/candidates/:id/social-cards/files/:path
返回图文工作区内的受控文件；`?download=1` 触发下载。

### GET /api/candidates/:id/social-cards/download
下载整组图文 ZIP。

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

### GET /api/artifacts/:id/preview
返回适合当前产物类型的预览页或重定向。

### GET /api/artifacts/:id/:assetPath
读取 HTML 产物引用的相对图片等资产；服务端限制在已索引产物目录内。

---

## 内容日历

### GET /api/articles
已完结文章列表 ?week=&month=
→ 内容日历

### GET /api/articles/stats
文章统计（累计/本月/本周、按周分布、按类型分布）
→ 产物柜

### GET /api/calendar
返回文章和图文合并后的内容日历数据。

### GET /api/documents/:id/content
文档正文（返回 text/plain）
→ 内容日历（点击文章标题）、编辑室（历史覆盖提示点击）

---

## 模型

### GET /api/models
模型服务商列表 + 最近调用记录
→ 模型中心

### POST /api/models/config
旧模型配置兼容接口。新配置应使用统一配置资源接口；密钥写入隔离凭据 Profile，响应不回传密钥原文。
→ 模型中心

### DELETE /api/models/config/:provider
删除用户维护的模型配置；内置配置按实现规则恢复默认或停用。
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

### GET /api/subscriptions/health-history
查询来源健康历史，支持 `?days=&limit=`。

---

## 系统

### GET /api/system/health
采集环境检查（Reddit CDP、RSSHub、GitHub API 与 Node.js）。`?target=all|reddit|rsshub|github` 可只检查一个目标。
→ 采集控制

### POST /api/system/cache/clear
清理采集缓存 { kind: 'github-cache' | 'source-cache' | 'all' } → { cleared: [{ kind, removed }] }；缓存随采集自动重建，不影响数据库与产物
→ 设置与数据（备份与恢复面板）

读取可在 UI 中维护的应用 / RSSHub 环境变量和解析后的路径。敏感字段只返回 `configured`。

### GET|PUT /api/system/settings
GET 返回脱敏后的当前运行设置；PUT 更新受支持的 `.env` 字段。空值不覆盖现有密钥，`clear: true` 才清除。

### POST /api/system/runtime/:service/:action
控制 `rsshub|reddit` 的 `start|stop|restart`。仅适用于当前 Windows / PowerShell 本机运行方式。

### GET /api/system/backup
导出工作台 ZIP 备份。

### POST /api/system/backup/validate
上传 ZIP 二进制并只做格式、清单、路径和哈希校验，不写入工作区。

### POST /api/system/backup/restore
恢复已校验且与当前应用版本兼容的 ZIP；要求会话绑定的一次性 `backup-restore` 操作确认令牌。恢复前自动保存安全备份。

### GET /api/system/skills
返回只读技能注册表，包括技能包版本、角色、适用入口、内容类型、输入输出契约、必需/可选工具和清单校验状态；同时返回插件能力、启停状态、优先级、健康检查和最近执行结果。
→ 技能与插件

### GET /api/system/skills/:id
返回内置 `SKILL.md` 原文、`skill.json` 结构化契约、来源文件、内容哈希、主/子技能策略归属、历史配置状态，以及该技能可设置的入口/阶段默认范围 `defaultScopes`。
→ 技能与插件

内置技能的旧在线写接口 `/versions`、`/dry-run` 和 `/versions/:version/restore` 统一返回 `403`。内置技能通过代码仓库修改；第三方技能使用下述技能包管理接口。

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

### GET /api/creation-entry-points/:entryPoint/skills
按 `entryPoint`、`contentType` 和可选 `recommendedSkillId` 返回主写技能候选。

### GET /api/system/information-capability-slots
返回网页抓取、仓库检查、本地项目读取等信息能力槽位及当前插件实现。

### PUT /api/system/information-capability-slots/:slot
以 `{ "pluginId": "..." }` 设置槽位实现；空字符串恢复默认选择。

### POST /api/system/skill-packages/validate
预检本地技能包目录，校验清单、契约、路径和冲突，不安装。

### POST /api/system/skill-packages/install
安装第三方技能包、保存版本并启用。

### PATCH /api/system/skills/:id/status
启用或停用第三方技能；依赖关系不允许破坏时返回冲突。

### POST /api/system/skills/:id/update
从技能包记录的来源更新第三方技能。

### DELETE /api/system/skills/:id
卸载第三方技能；内置技能不可卸载。

### GET /api/system/skill-install-events
读取技能安装、更新、启停和卸载事件。

### POST /api/system/skills/:id/versions
### POST /api/system/skills/:id/versions/:version/restore
### POST /api/system/skills/:id/dry-run
内置技能只读护栏：第三方技能包已改用独立的安装/更新/卸载路由，以上历史管理端点统一返回 `403`，内置技能请通过代码仓库修改 `SKILL.md`。

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

### GET /api/jobs
返回最近持久化任务，支持 `?limit=`；用于服务重启后恢复状态提示。

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

- `POST /api/batches/:id/tutorial-chat/stream`：以 NDJSON 流式返回自主写作策划回复和表单更新；`articleMode` 支持 `experience`（心得经验）和 `tutorial`（使用教程）。教程请求可包含 `draft.localProjectPath`，或在本轮回答中提供绝对目录。路径只在服务端映射为临时项目资源，流中返回 `assistant.delta`、`tool.requested`、`tool.running`、`tool.completed`、`tool.failed` 与 `agent.limit`；`done.data` 包含 `agentRunId` 和 `toolCalls`。
- `POST /api/tools/local-project/read`：预检用户明确指定的本地项目目录。只读受支持的文本文件，跳过依赖/构建目录、密钥文件、二进制和符号链接，并受文件数、单文件与总字符数限制。
- `POST /api/batches/:id/custom-articles`：根据对话填好的事实表单创建自主写作项目并启动成稿；旧的 `/tutorials` 路径保留兼容。
- `GET /api/batches/:id/custom-articles`：列出本批自主写作项目及草稿 / 任务状态；旧的 `/tutorials` 路径保留兼容。
- `POST /api/candidates/:id/custom-article-runs`：重新执行已有自主写作项目，可沿用上次生成快照或显式改用最新技能。
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

- `POST /api/system/remote-tool-plugins/validate`：校验声明式远程 Manifest。响应附带 `catalogDrafts`：Manifest 声明了目录外能力时生成目录条目草案（保守占位，`needsCompletion: true`），需人工确认后经 `POST /api/system/capability-catalog` 入库，不自动写入。
- `POST /api/system/remote-tool-plugins`：保存远程连接，默认停用。响应同样附带 `catalogDrafts`。
- `PATCH /api/system/remote-tool-plugins/:id/status`：即时启用或停用。
- `POST /api/system/remote-tool-plugins/:id/first-run-confirm`：首次执行确认；确认前该插件的真实调用会被拒绝（`FIRST_RUN_CONFIRM_REQUIRED`），避免“安装即信任所有能力”。
- `GET|PUT /api/system/remote-tool-plugins/:id/credentials`：查看配置状态或写入/清除隔离凭据；永不返回凭据原文。
- `POST /api/system/remote-tool-plugins/:id/test`：执行受控连接测试并返回可用性、端点主机和配额状态。
- `DELETE /api/system/remote-tool-plugins/:id`：删除连接；存在技能依赖时先返回 `409`。
- `GET /api/system/remote-tool-plugin-events`：读取安装、启停和卸载事件。

远程连接仅允许 HTTPS，并实施域名、DNS、重定向、超时、响应大小和本地路径隔离策略。`external-write` 能力仍需每次工具调用明确授权。
### GET|PUT /api/system/skills/:id/configuration

读取或保存技能/工具 Manifest 声明的动态配置。普通字段写入 `extension_settings`，秘密字段只写入隔离凭据 Profile；读取接口仅返回秘密字段是否已配置。工具使用对应路径 `GET|PUT /api/system/tool-plugins/:id/configuration`。

当技能是 Agent 运行时技能时，GET 额外返回 `capabilityAuthorization`（可编辑能力 `editable`、锁定原因 `locked`、当前白名单 `whitelist`、配置 `version`/`configHash`/`integrity`）；PUT 携带 `capabilityAuthorization` 字段时走能力授权写入路径（写入 `writing-skills/<skillId>/active.json`，不影响动态配置）。无归属入口的技能（流水线阶段技能等）同样可写入：其可声明集合以自身 Manifest 的 required/optionalCapabilities 为准，适配状态恒为 ready：

- 只允许启停"已声明、`declaration=optional`、`adapterStatus=ready`"的能力；必需、降级、未声明或目录外能力返回 `400 CAPABILITY_AUTHORIZATION_INVALID` 及逐条 `issues`；
- `dryRun:true` 只返回影响预览（`impact`：哪些消费者的哪些能力会在 available/unavailable 间翻转），不落盘；
- `expectedVersion` 必传，做乐观并发控制：缺失返回 `400 CAPABILITY_AUTHORIZATION_INVALID`，版本过期返回 `409 CONFIG_VERSION_CONFLICT`（含 `currentVersion`）；active.json 的 hash 链断裂返回 `409 CONFIG_INTEGRITY_BROKEN`；
- 每次写入 `version` 单调递增并记录 `parentHash`；`capabilities:null` 清除白名单恢复全放行；`capabilities:[]` 为显式空白名单，表示全部禁止（图谱中输出 `SKILL_NOT_ALLOWED`）。

### POST /api/system/skills/:id/configuration/test

校验当前动态配置是否完整。工具使用对应路径 `POST /api/system/tool-plugins/:id/configuration/test`，并继续执行插件健康检查。
### GET /api/collector-plugins

返回已注册的内置采集器 Manifest。阶段 0 仅提供协议与发现能力，`executionStatus: "legacy-active"` 表示生产采集仍走原有 `JobManager`。

### GET /api/collection-sources

返回 `collection_sources` 中的统一来源实例。阶段 0 会先从旧订阅配置幂等同步，旧 `/api/subscriptions` 响应和写入行为保持不变。

内置 `declarative-web-page` 采集器支持公开静态 HTML 页面。来源配置使用声明式 CSS 子集（标签、类、ID、属性与后代选择器），可配置标题、链接、摘要、作者、时间及有限分页；不执行页面脚本。页面请求逐跳执行公网地址校验，并限制响应类型、大小和重定向次数。

内置 `browser-web-page` 采集器支持客户端渲染页面及受控的点击、输入、等待动作。每个来源使用隔离 Profile，浏览器在受限环境的独立子进程运行并受父进程硬超时控制；页面导航和资源请求继续执行公网地址校验。登录识别元素命中时返回 `AUTH_REQUIRED`。

### 可安装采集插件

- `POST /api/system/collector-plugin-packages/validate`：校验本地或远程采集插件目录。
- `POST /api/system/collector-plugin-packages/install`：安装已校验插件；需要受信管理确认头，初始状态为停用。
- `PATCH /api/system/collector-plugins/:id/status`：启用或停用第三方采集插件。
- `POST /api/system/collector-plugins/:id/first-run-confirm`：确认远程采集端点和权限摘要后允许首次真实执行。
- `GET /api/system/collector-plugins/:id/versions`：列出升级时归档的可回滚历史版本。
- `POST /api/system/collector-plugins/:id/rollback`：回滚到指定归档版本并保持停用，等待人工确认后重新启用；需要管理员确认头。
- `DELETE /api/system/collector-plugins/:id`：卸载插件；有关联来源时必须传 `confirmImpact:true`，来源记录始终保留。
- `GET /api/system/collector-plugin-events`：查询安装、启停、确认和卸载审计事件。

### GET /api/system/extension-configurations

返回所有声明动态 `configuration` Schema 的技能、工具和采集器，以及配置状态和脱敏后的当前值，供运行与配置中心自动生成扩展配置目录。

### GET /api/system/configuration/catalog

返回统一配置资源目录。资源类型包括 `system`、`model-provider`、`tool`、`collector` 和 `skill`；响应只包含 Schema、配置状态及脱敏值。

### GET|PUT /api/system/configuration/:type/:id

通过统一资源标识读取或保存配置。秘密字段写入隔离凭据 Profile，不通过读取接口回显；既有技能、工具、采集器和模型专用接口在迁移期继续兼容。

### POST /api/system/configuration/:type/:id/test

校验指定统一配置资源的当前有效配置是否完整。阶段 1 只执行通用 Schema 完整性检查，具体工具和服务的连接测试由后续迁移阶段接入。

### POST /api/system/configuration/model-provider

注册新的模型 Provider（添加模型）。入参为创建所需的非敏感字段（`id`、`label`、`baseUrl`、`model`、`contextWindow`、`maxOutputTokens`），写入 `config.local.json` 的 `llm.providers`；密钥等后续字段由统一配置资源的保存流程写入隔离凭据 Profile，不写 `.env`。返回新建 Provider 的统一配置资源条目。

### GET|PUT /api/system/collector-plugins/:id/configuration

读取或保存采集插件的全局动态配置。普通字段进入 `extension_settings`，秘密字段进入隔离凭据 Profile。

### POST /api/system/collector-plugins/:id/configuration/test

校验采集插件全局配置是否完整；正式采集与单源测试使用同一份解析结果。

### POST /api/collection-sources

创建统一来源实例。当前支持 Reddit、RSSHub/X 和直连 Feed；服务端负责规范化稳定 `sourceKey` 和重复检查。

### PATCH|DELETE /api/collection-sources/:id

编辑、启停或删除来源实例。`managed=1` 的系统来源不允许删除或编辑。

### POST /api/collection-sources/test

保存前按 `pluginId + config` 测试来源。

### POST /api/collection-sources/assist

分析网页中的重复内容结构，返回最多 3 组经过真实提取验证的候选。静态 HTML 没有列表时自动使用隔离浏览器进行无点击动态渲染，并通过 `targetPluginId` 指示前端使用静态或动态采集器。可选 `intent` 用于多个候选的 AI 语义排序；摘要、作者、日期只从确定性白名单中选择，并在二次提取达到填充率门槛后返回。只分析公开 HTTP/HTTPS 页面，不保存或启用来源。

```json
{
  "pluginId": "declarative-web-page",
  "url": "https://example.com/news",
  "intent": "采集页面中的主新闻列表"
}
```

响应中的 `page.mode` 为 `static` 或 `dynamic`；`targetPluginId` 为实际应保存的底层插件；`candidates[].config` 可直接提交到来源测试接口，`preview` 用于人工确认。AI 不可用或输出无效时仍返回确定性候选。
分析静态网页中的重复内容结构，返回最多 3 组已经过真实提取验证的声明式采集候选。静态 HTML 没有列表时自动使用隔离浏览器进行一次无点击动态渲染分析，并通过 `targetPluginId` 指示前端切换采集器。请求体为 `{ pluginId: "declarative-web-page", url }`；只分析公开 HTTP/HTTPS 页面，不保存或启用采集源。

### POST /api/collection-sources/:id/test

使用服务端已保存配置测试指定来源，并更新最近测试状态。
### GET /api/system/configuration/migration-status

返回统一配置资源迁移覆盖率、仍命中 legacy fallback 的资源与字段，以及是否达到停止兼容读取的安全条件。响应不包含秘密原值。
### PATCH /api/system/collector-tools/:id

更新采集工具的启用状态或优先级。停用操作受能力影响门禁保护。
