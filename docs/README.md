# 文档索引

本目录只保留**项目使用**与**开发接入**相关的现行文档，随代码改动同步更新（CI 有校验的优先相信测试）：

- 设计方案统一收在 [design/](./design/)；
- 已闭环的历史方案、复盘与审计记录归档在 [archive/](./archive/)；
- 回归基线 JSON（`*-baseline.json`、`configuration-migration-inventory.json`）在 `test/fixtures/`，由 `scripts/snapshot-*` 生成、测试逐字比对，勿手工编辑。

新增文档时在头部注明类别与状态（如 `> 状态：已实施` / `> 状态：待评审`），并登记到下表；已闭环的阶段性文档移入 `archive/` 并更新本索引。

## 使用

| 文档 | 内容 |
|---|---|
| [user-guide.md](./user-guide.md) | 面向使用者的完整手册：安装、配置、采集、选题、成稿、图文、自主写作、备份与排障 |
| [configuration.md](./configuration.md) | 配置项参考：`.env`、`config.local.json`、`account-context.json`（含选题评分）、技能覆盖层 |
| [release.md](./release.md) | 发布、升级、降级、备份恢复流程 |
| [data-flow.md](./data-flow.md) | 第三方服务数据流：发送什么、何时发送、保存多久、如何删除 |

## 开发接入

| 文档 | 内容 |
|---|---|
| [architecture.md](./architecture.md) | 架构总览：HTTP 路由、Store、后台任务、LLM 网关、技能运行时、工具注册中心、两条流水线 |
| [plugin-development.md](./plugin-development.md) | 技能包、工具插件和采集器插件的 Manifest、Adapter、安全与发布指南 |
| [extending.md](./extending.md) | 扩展开发：技能包 / 本地插件 / 远程插件的示例、权限说明、失败语义与版本兼容规则 |
| [safety-defaults.md](./safety-defaults.md) | 模型与信息工具的超时、重试、并发与预算安全默认值 |
| [threat-model.md](./threat-model.md) | 威胁建模：安全边界假设、入口防护、已接受风险 |
| [examples/](./examples/) | 技能包、工具插件、采集器插件的可校验示例（CI 使用） |

## 设计方案（design/）

现行机制的权威描述与待评审方案，集中在 [design/](./design/)：

| 文档 | 内容 |
|---|---|
| [consumer-capability-adaptation-design.md](./design/consumer-capability-adaptation-design.md) | 消费者—能力—工具实现统一治理方案（阶段 0–6 已实施，现行机制的权威描述） |
| [consumer-capability-expansion-design.md](./design/consumer-capability-expansion-design.md) | 消费者能力扩展方案：三类消费者纳入、页面三分组与接入清单（阶段 A–D 已实施，§5.1/§10 有遗留裁定项） |
| [capability-onboarding-configurability-plan.md](./design/capability-onboarding-configurability-plan.md) | 能力接入配置化与开发规范化：五种情形分级、能力生命周期状态机、Agent 登记驱动（阶段 1–4 已实施；页面添加入口 2026-08-15 已下线） |
| [capability-expansion-guide.md](./design/capability-expansion-guide.md) | 能力拓展单一视图：消费者×能力类型成本矩阵、生命周期状态机、三类消费者 SOP 与遗留方向（2026-08-15 汇总，拓展先读） |
| [agent-adapter-configurability-design.md](./design/agent-adapter-configurability-design.md) | Agent 能力适配层配置化设计：resourceKind 档案表 + Agent 双 map 声明，资源类能力接入免改代码（2026-08-15，待评审） |
| [conversation-agent-form-unification-design.md](./design/conversation-agent-form-unification-design.md) | 对话 Agent 表单统一设计（`lib/domain/editorial-readiness.mjs` 的设计依据） |
| [star-growth-roadmap.md](./design/star-growth-roadmap.md) | Star 增长路线图：发布临门一脚、首个公开 Release、可见性渠道与留存运营（待评审） |

## 历史归档（archive/）

已实施完成或被取代的阶段性方案、实施记录、复盘与主题审计，统一归档于 [archive/](./archive/)（含 `archive/audits/`），保留用于追溯「当时为什么这么做」，不代表当前实现细节。要点提示：

- R1–R6 整改系列的实施记录（`r3-*`/`r4-*`/`r5-*`）与 `review-remediation-roadmap.md` 已全部闭环归档；
- 工具调用链与依赖重构（`tool-call-chain-and-dependency-refactor.md`）已由消费者能力治理系列承接；
- 通用对话 ToolCall Agent 架构（`unified-conversation-toolcall-agent-design.md`，Phase 0–5 已完成）归档，当前行为以 [architecture.md](./architecture.md) 为准；
- 开源准备清单（`open-source-readiness.md`）、配置迁移与系统中心重构（`configuration-migration-and-system-center-redesign.md`）等阶段性文档也在此。
