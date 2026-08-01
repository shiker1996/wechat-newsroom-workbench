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

### Added

- 文章配图可生成类别：IMG-DATA 结构化占位（事件线 / 数据卡，数据必须来自正文）、确定性单图渲染管线、配图工作台一键生成与放大查看
- 首次安装引导：`npm run setup` / `setup-workbench.cmd` 交互向导（依赖、配置、LLM Key、RSSHub），附 Linux/macOS `.sh` 对应脚本
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

[Unreleased]: https://github.com/shiker1996/wechat-newsroom-workbench/compare/0.1.0...HEAD
[0.1.0]: https://github.com/shiker1996/wechat-newsroom-workbench/compare/0.0.1...0.1.0
[0.0.1]: https://github.com/shiker1996/wechat-newsroom-workbench/releases/tag/0.0.1
