# 文档索引

本目录文档按三类维护，避免读者把**已上线的功能**误认为待办、或把**历史方案**误认为当前架构：

- **现状**：描述当前系统真实行为的参考文档，随代码改动同步更新（CI 有校验的优先相信测试）。
- **历史决策**：已实施或已拍板的设计评审、复盘记录，已归档至 [archive/](./archive/)，保留用于追溯「当时为什么这么做」，不代表当前实现细节。
- **未来计划**：待办与待评审方案，其中描述的功能**尚未实现**。

新增文档时在头部注明类别与状态（如 `> 状态：已实施` / `> 状态：待评审`），并登记到下表；已闭环的阶段性文档移入 `archive/` 并更新本索引。

## 现状

| 文档 | 内容 |
|---|---|
| [open-source-readiness.md](./open-source-readiness.md) | 开源准备与后续工作清单（P0–P2 执行状态） |
| [threat-model.md](./threat-model.md) | 威胁建模：安全边界假设、入口防护、已接受风险 |
| [data-flow.md](./data-flow.md) | 第三方服务数据流：发送什么、何时发送、保存多久、如何删除 |
| [release.md](./release.md) | 发布、升级、降级、备份恢复流程 |
| [architecture.md](./architecture.md) | 架构总览：HTTP 路由、Store、后台任务、LLM 网关、技能运行时、工具注册中心、两条流水线 |
| [configuration.md](./configuration.md) | 配置项参考：`.env`、`config.local.json`、`account-context.json`（含选题评分）、技能覆盖层 |
| [user-guide.md](./user-guide.md) | 面向使用者的完整手册：安装、配置、采集、选题、成稿、图文、自主写作、备份与排障 |
| [plugin-development.md](./plugin-development.md) | 技能包、工具插件和采集器插件的 Manifest、Adapter、安全与发布指南 |
| [configuration-migration-and-system-center-redesign.md](./configuration-migration-and-system-center-redesign.md) | 旧配置迁移、统一配置资源模型与系统配置中心重构实施方案 |
| [configuration-migration-inventory.json](./configuration-migration-inventory.json) | 阶段 0 旧配置字段、秘密属性、消费点和迁移目标机器清单 |
| [extending.md](./extending.md) | 扩展开发：技能包 / 本地插件 / 远程插件的示例、权限说明、失败语义与版本兼容规则 |
| [ai-assisted-web-source-configuration-plan.md](./ai-assisted-web-source-configuration-plan.md) | 网页自动采集的静态优先、动态降级、AI 排序和字段复验方案（Phase 0–3 已实施，Phase 4 待实施） |
| [safety-defaults.md](./safety-defaults.md) | 模型与信息工具的超时、重试、并发与预算安全默认值 |
| [r6-release-and-disk-hygiene.md](./r6-release-and-disk-hygiene.md) | R6 发布治理实施结果、磁盘清理精确路径盘点及人工确认条件 |
| [consumer-capability-adaptation-design.md](./consumer-capability-adaptation-design.md) | 消费者—能力—工具实现统一治理方案（阶段 0–6 已实施，现行机制的权威描述） |
| [consumer-capability-expansion-design.md](./consumer-capability-expansion-design.md) | 消费者能力扩展方案：三类消费者纳入、页面三分组与接入清单（阶段 A–D 已实施，§5.1/§10 有遗留裁定项） |
| [capability-onboarding-configurability-plan.md](./capability-onboarding-configurability-plan.md) | 能力接入配置化与开发规范化：五种情形分级、能力生命周期状态机、Agent 登记驱动（阶段 1–4 已实施；页面添加入口 2026-08-15 已下线） |
| [capability-expansion-guide.md](./capability-expansion-guide.md) | 能力拓展单一视图：消费者×能力类型成本矩阵、生命周期状态机、三类消费者 SOP 与遗留方向（2026-08-15 汇总，拓展先读） |
| [agent-adapter-configurability-design.md](./agent-adapter-configurability-design.md) | Agent 能力适配层配置化设计：resourceKind 档案表 + Agent 双 map 声明，资源类能力接入免改代码（2026-08-15，待评审） |

## 历史决策

已实施完成或被取代的阶段性方案、实施记录与复盘，统一归档于 [archive/](./archive/)（37 篇，2026-08-14 整理）。要点提示：

- R1–R6 整改系列的实施记录（`r3-*`/`r4-*`/`r5-*`）与 `review-remediation-roadmap.md` 已全部闭环归档；
- 工具调用链与依赖重构（`tool-call-chain-and-dependency-refactor.md`）已由消费者能力治理系列承接；
- 通用对话 ToolCall Agent 架构（`unified-conversation-toolcall-agent-design.md`，Phase 0–5 已完成）归档，当前行为以 [architecture.md](./architecture.md) 为准；
- 主题体系、技能扩展、图文流水线等已实施方案（`article-and-social-theme-json-plan.md` 等）均在此。

## 未来计划

| 文档 | 内容 |
|---|---|
| [star-growth-roadmap.md](./star-growth-roadmap.md) | Star 增长路线图：发布临门一脚、首个公开 Release、可见性渠道与留存运营（待评审） |
