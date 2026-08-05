# 更新日志

本项目遵循[语义化版本](https://semver.org/lang/zh-CN/)，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## 兼容政策

主版本为 0 期间（0.x.y）：minor 可引入新功能与向后兼容的契约演进，patch 只含修复。以下四类接口的兼容承诺：

- **数据库 Schema**：只做幂等、只增式迁移（新增表 / 列、默认值回填），启动时自动执行（`lib/core/store.mjs`）。同一大版本内旧库直接启动即可；跨大版本恢复备份必须走备份包校验（清单 `schemaVersion` + 逐文件 SHA-256，恢复前自动保存快照，失败可回滚）。
- **技能契约**：第三方技能包以 `skill.json` 的 `schemaVersion`（当前 1）与 `compatibleApp` 判定兼容；`schemaVersion` 升版时旧版技能至少保留 1 个 minor 的并行支持期。
- **插件 Manifest**：本地与远程插件以 `schemaVersion`（当前 1）与 `compatibleApp` 判定；不兼容的插件在安装时明确报错，不静默加载。
- **REST API**：`API.md` 记录的路由在同一大版本内只增不破（`test/api-docs-routes.test.mjs` 双向钉死）；破坏性变更先在 CHANGELOG 标记 Deprecated，至少保留 1 个 minor 后才移除。

应用版本的唯一来源是 `package.json` 的 `version` 字段（`lib/version.mjs` 统一读取，技能与插件的 `compatibleApp` 判定均以此为准）。发布流程见 `docs/release.md`。

## [Unreleased]

### Fixed

- AI 任务并发重构回归：`AiJobManager.run()` 不再丢失 `candidateId / documentKind / focus / focuses` 等执行参数（此前入队后以空参数执行，成稿/图文等任务 `getCandidate(undefined)` 报「Provided value cannot be bound to SQLite parameter 1」）
- DeepSeek 推理强度修复：`reasoning_effort` 按官方 OpenAI SDK 用法**顶层下发**（同时保留 `thinking` 内嵌），低强度配置不再失效；未配置强度时显式开启 thinking，避免落到默认 high 导致推理失控
- thinking 开启且推理吃光 `max_tokens`（finish=length 内容为空）时，`complete` / `streamComplete` 自动**回落无思考重试一次**，编辑室等调用不再因此报「未返回流式文本内容」
- 流式请求显式发送 `stream_options.include_usage`，保证 token 用量按 API 返回的 `usage` 统计
- `model_calls` 新增 `reasoning_tokens` 列，记录 DeepSeek `usage.completion_tokens_details.reasoning_tokens`，便于诊断推理开销
- 语义打标单批模型调用失败（超时 / 空内容 / 网络中断）不再拖垮整个批次：抛错后先翻转 thinking 重试一次，仍失败则把该批热点标记为失败跳过，批次结束后可「继续打标」补打；此前网关抛错会直接失败整个 auto 任务
- 流式空内容报错补充诊断信息（finishReason + 推理字符数），便于区分「输出预算耗尽」与「内容过滤」
- 语义打标重试不再把已开启的 thinking 关掉：JSON 截断进入拆分重试时，拆分后的子批继续沿用 thinking（此前拆分路径把 thinking 重置为关闭，导致模型退化问题复现）
- 图文主题代码块对比度：`inverseText` 与 `codeBackground` 同色的主题（crimson / orange / charcoal）代码块此前是黑字黑底几乎不可见；新增 `accent-panel`（白字强调色底）与 `ink-panel`（白字深色底）代码配方并切换这三个主题，代码文字改为 `--ink` / `--inverse` 高对比色
- crimson 列表由「白字黄底」（`hard-card`）改为「白字红底」（新增 `hard-accent` 列表配方），并提升结尾页文字对比度；crimson / orange / charcoal 主题版本升至 1.0.1
- 全量图文主题对比度审计（`scripts/audit-theme-contrast.mjs`，无头浏览器实测）：brutalist 眉题由 1:1 不可见改为正文色；peach / tokyo-night / lavender / solarized 加深强调色使白字达标（步骤号 / 表头 / 结尾页），brand 对比度随之提升；bone-white / ice-blue / mocha / paper-craft / peach / solarized 眉题由 accent2 改为 muted 色提升可读性；相关主题版本升至 1.0.1

### Changed

- 图文故事板内容更充实：单块字数上限从 160 提升到 240，并提示模型写具体内容（能力/机制/命令/数字/边界）、代码块给出完整多行命令序列（安装→初始化→运行→验证），减少代码块/短文本导致的卡片大片留白（`repository/event/custom-card-storyboard/references/storyboard.md` 与 `runtime-contract.md`）

- AI 后台任务并发模型：候选级任务（文章 / 图文 / 排版 / 自主写作）按候选并行，批次级任务（打标 / 研判 / 事件卡 / 自动流程 / 早报）同批次互斥；超出 `aiJobs.maxConcurrent`（默认 2，可配）的任务进入 FIFO 队列以 `queued` 状态等待，不再互相阻塞或报「已有任务运行」
- 服务重启恢复：`queued` 状态的 AI 任务与 `running` 一并标记为中断，避免残留排队记录

- README 顶部示例改为演示封面图（`docs/screenshots/ui-demo-cover.png`，`scripts/render-demo-cover.mjs` 可重新生成），点击跳转 CDN 演示视频 `https://img.shiker.tech/project/export-1785841213192.mp4`（GitHub README 不支持 `<video>` 标签，采用封面图 + 播放链接方案）；原截图保留在 `docs/screenshots/` 作海报与渠道物料

## [0.2.0] - 2026-08-04

### Fixed

- 模型请求超时不再误报「未返回文本内容」：网关识别 AbortController 中断并给出明确超时提示，默认 `requestTimeoutMs` 提升至 5 分钟以适配推理模型长输出
- 对齐 DeepSeek 最新接口定义：`content_filter` / `insufficient_system_resource` 两种 finish_reason 报出明确错误（此前会被当作正常结果拿到半截内容）；provider 新增可选 `reasoningEffort` 透传（thinking 开启时生效）
- RSSHub 依赖安装改用 `--legacy-peer-deps` 修复其 eslint peer 冲突；克隆成功但依赖未装时可续装

### Added

- 主题体系：文章排版与图文主题 JSON 化（注册表 + 主题目录 + 基线校验）；主题编辑器、样式能力清单与覆盖率校验、发布门禁与生产级实时预览；主题中心 AI 创建主题（候选确认、受控发布）；封面标题 / 骨架 / 节奏 / 封面承载配方从编译器硬编码迁移为主题 JSON 显式字段，骨架支持全页型与同骨架组内第二层视觉差异，主题选择器按内容场景与阅读密度辅助决策
- 图文密度与封面标题：故事板密度预算（规划阶段确定性裁剪块数与列表条目）、稀疏页确定性兜底、布局修复失败信息带明细与故事板编辑指引；封面标题强调色块 AI 语义断行，公众号封面标题规则对齐小红书 TITLE_GUIDE
- 选题链 prompt 全面技能化：热点打标、事件卡、探索脑暴、综合研判、编辑会 5 个选题阶段技能（`hotspot-tagging` / `event-card-generator` / `hotspot-brainstorm` / `hotspot-synthesis` / `editorial-room`），经标准技能运行时加载并支持配置覆盖层与 prompt 哈希快照，代码保留内联 fallback；编辑会账号上下文改为 `{{ACCOUNT_CONTEXT}}` 占位符注入
- 选题评分参数可配置：`account-context.json` 新增 `scoring` 段，F=H×h+B×b+P×p-S 权重、账号契合加分、分类偏好、pBase/hBase 基分均可按键覆盖，非法值回退默认；选题报告公式文案跟随实际权重
- 成稿技能变现配合规则：增长与承接契约新增「留言引导与变现配合」（结尾具体留言引导问题、商业词汇自然覆盖、文中广告发布侧位置建议），早报 / 教程 / 自主写作链同步留言引导要求
- 配置项参考文档 `docs/configuration.md`：汇总 `.env`、`config.local.json`、`account-context.json`（含评分参数）与技能覆盖层全部配置字段

- 批次早报生成记录：页面展示最近任务状态（执行中 / 失败原因 / 完成时间），失败与中断可一键重试，刷新页面自动续接执行中的任务

- 文章配图可生成类别：IMG-DATA 结构化占位（事件线 / 数据卡，数据必须来自正文）、确定性单图渲染管线、配图工作台一键生成与放大查看
- 首次安装引导：`npm run setup` / `setup-workbench.cmd` 交互向导（依赖、配置、LLM Key），RSSHub 缺失时可自动从 GitHub 浅克隆并安装依赖，附 Linux/macOS `.sh` 对应脚本
- 编辑室两步备料：进入候选编辑室先幂等抓取全部事件来源原文再解锁对话，失败来源提示不阻断，可跳过
- 本地段落检索插件 `local-passage-retrieval`（`content.passage.retrieve`）：编辑室长正文按「头部 + BM25 相关段落」摘录注入，替代全量截断，检索不可用时自动回退
- 能力槽位体系推广到注册表全部能力：固定 6 个信息槽位之外的工具能力（段落检索、图表渲染、图床上传）自动生成槽位卡片，可在「技能与工具」页统一查看状态并切换偏好实现

- 开源前置整理：MIT 许可证与 `THIRD_PARTY_NOTICES.md`、`SECURITY.md`、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、Issue / PR 模板、CODEOWNERS
- CI（GitHub Actions）：`npm ci`、构建、全量测试、示例技能包 / 插件校验、依赖漏洞与许可证扫描、秘密扫描
- 测试分层：浏览器依赖测试打标，`npm run test:fast` 可在无 Puppeteer 缓存环境运行
- 提交前秘密扫描钩子（`.githooks/pre-commit`，`git config core.hooksPath .githooks` 启用）
- 冷启动验收脚本（`scripts/cold-start-acceptance.sh`）、示例配置与 API 路由清单双向校验测试
- 全字段虚构的 `account-context.example.json`
- 版本兼容验收样例（`test/version-compat.test.mjs`）：旧版数据库幂等迁移、技能包与插件的 `schemaVersion` / `compatibleApp` 判定
- 演示模式（`--demo` / `WORKBENCH_DEMO=1` / `start-workbench.ps1 -Demo`）：无模型服务商时写入两份虚构演示批次（热点、打标、文章 / 图文选题池、排版与终稿产物），使用独立数据库 `data/demo.db`，跳过 RSSHub 自动启动，浏览型视图完整可用
- README 视觉物料：`docs/screenshots/` 工作台截图，`scripts/render-ui-shots.mjs` 可重新生成

### Security

- 技能包安装 / 更新 / 状态 / 删除与插件变更路由补充 `x-admin-confirm` 确认头校验，前端走确认弹窗
- url-fetch 插件拒绝本机 / 内网目标；rsshub 内网判定补全 100.64/10 等保留段；图片预览页 title 补转义
- 重写 Git 历史清除 `data/` 与 `logs/` 残留（含空数据库、缓存与审计截图），仓库迁移至新地址

## [0.1.0] - 2026-07-29

### Added

- 每日早报与自主写作任务
- 来源健康时间线
- 工具插件化：本地 adapter、远程声明式插件（Manifest + 权限声明）
- 写作技能可配置化，图文流程拆分为独立技能

## [0.0.1] - 2026-07-26

### Added

- 初始版本：热点采集、事件研判、选题、编辑室决策、文章成稿、公众号排版与社交图文批次的本地工作台

[Unreleased]: https://github.com/shiker1996/wechat-newsroom-workbench/compare/0.2.0...HEAD
[0.2.0]: https://github.com/shiker1996/wechat-newsroom-workbench/compare/0.1.5...0.2.0
[0.1.0]: https://github.com/shiker1996/wechat-newsroom-workbench/compare/0.0.1...0.1.0
[0.0.1]: https://github.com/shiker1996/wechat-newsroom-workbench/releases/tag/0.0.1
