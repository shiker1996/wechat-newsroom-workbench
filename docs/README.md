# 文档索引

本目录文档按三类维护，避免读者把**已上线的功能**误认为待办、或把**历史方案**误认为当前架构：

- **现状**：描述当前系统真实行为的参考文档，随代码改动同步更新（CI 有校验的优先相信测试）。
- **历史决策**：已实施或已拍板的设计评审、复盘记录，保留用于追溯「当时为什么这么做」，不代表当前实现细节。
- **未来计划**：待办与待评审方案，其中描述的功能**尚未实现**。

新增文档时在头部注明类别与状态（如 `> 状态：已实施` / `> 状态：待评审`），并登记到下表。

## 现状

| 文档 | 内容 |
|---|---|
| [open-source-readiness.md](./open-source-readiness.md) | 开源准备与后续工作清单（P0–P2 执行状态） |
| [threat-model.md](./threat-model.md) | 威胁建模：安全边界假设、入口防护、已接受风险 |
| [data-flow.md](./data-flow.md) | 第三方服务数据流：发送什么、何时发送、保存多久、如何删除 |
| [release.md](./release.md) | 发布、升级、降级、备份恢复流程 |
| [architecture.md](./architecture.md) | 架构总览：HTTP 路由、Store、后台任务、LLM 网关、技能运行时、工具注册中心、两条流水线 |
| [configuration.md](./configuration.md) | 配置项参考：`.env`、`config.local.json`、`account-context.json`（含选题评分）、技能覆盖层 |
| [extending.md](./extending.md) | 扩展开发：技能包 / 本地插件 / 远程插件的示例、权限说明、失败语义与版本兼容规则 |
| [safety-defaults.md](./safety-defaults.md) | 模型与信息工具的超时、重试、并发与预算安全默认值 |

## 历史决策

| 文档 | 内容 |
|---|---|
| [2026-07-20-project-init.md](./2026-07-20-project-init.md) | 项目起点：技能封装为应用的可行性讨论 |
| [project-development-journey.md](./project-development-journey.md) | 开发历程与阶段感悟 |
| [project-development-record.md](./project-development-record.md) | 内部工程复盘 |
| [custom-content-and-xiaohongshu-design.md](./custom-content-and-xiaohongshu-design.md) | 自定义图文 + 小红书渠道设计评审（已实施） |
| [dual-content-pools-and-social-card-pipeline.md](./dual-content-pools-and-social-card-pipeline.md) | 文章 / 图文双选题池方案（已实施） |
| [skill-and-tool-extension-plan.md](./skill-and-tool-extension-plan.md) | 技能与工具扩展能力方案（P0–P4 已完成） |
| [tool-plugins-and-configurable-writing-skills.md](./tool-plugins-and-configurable-writing-skills.md) | 工具插件化与技能可配置化方案（已完成） |
| [social-card-storyboard-skill-extension-plan.md](./social-card-storyboard-skill-extension-plan.md) | 图文故事板技能化改造方案 |

## 未来计划

| 文档 | 内容 |
|---|---|
| [0730-todo-list.md](./0730-todo-list.md) | 后续工作事项与已知问题 |
| [optional-feature-todos.md](./optional-feature-todos.md) | 可选功能扩展 TODO（各事项独立状态） |
| [optional-feature-implementation-roadmap.md](./optional-feature-implementation-roadmap.md) | 可选功能实施路线图（部分批次已完成） |
| [event-deep-fetch-and-fact-base-plan.md](./event-deep-fetch-and-fact-base-plan.md) | 事件精选深抓与事实基座升级计划 |
| [typeset-pipeline-optimization-plan.md](./typeset-pipeline-optimization-plan.md) | 排版流水线优化方案（P2 待实施） |
| [article-and-social-theme-json-plan.md](./article-and-social-theme-json-plan.md) | 文章排版与图文视觉主题 JSON 化、版本化及用户自定义主题实施方案 |
| [theme-config-editor-expansion-plan.md](./theme-config-editor-expansion-plan.md) | 主题完整样式配置、生产级实时预览与发布门禁扩展方案 |
| [theme-style-capability-inventory.md](./theme-style-capability-inventory.md) | 现有 20 套主题视觉能力清单、配置消费矩阵与阶段 0 基线 |
| [ai-theme-creation-extension-plan.md](./ai-theme-creation-extension-plan.md) | 主题中心 AI 创建主题、候选确认、受控生成与发布治理扩展方案 |
| [theme-element-customization-expansion-plan.md](./theme-element-customization-expansion-plan.md) | 主题文字、颜色、边框等元素级可配置现状与受控组件属性扩展方案 |
| [star-growth-roadmap.md](./star-growth-roadmap.md) | Star 增长路线图：发布临门一脚、首个公开 Release、可见性渠道与留存运营（待评审） |
