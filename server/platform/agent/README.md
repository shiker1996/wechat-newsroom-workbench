# agent

## 职责

Agent 运行时、工具调用和会话协调基础设施。

## 依赖边界

提供会话、协议、工具目录、工具执行和资源适配基础设施，不包含具体业务 Agent。文章与图文 Agent adapter 位于对应 feature 的 application/agent 目录。

## AI 视觉文档 Agent

`ai-visual-document-agent.mjs` 提供基于 `cap_filesystem_project_read` 与
`cap_filesystem_project_document_write` 的单 Agent 文档生成协议：读取输入、begin、append
分块、finish，再返回 final。它只负责协议编排和画布/输出路径等运行参数，不绑定具体业务
主题或页面尺寸；社交卡和文章封面应通过 feature 层 adapter 注入各自的 skill、输入文件、
画布和输出文件名。
