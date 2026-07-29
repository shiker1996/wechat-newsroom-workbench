---
name: repository-card-storyboard
description: 将已核验的 GitHub 仓库、产品资料或工具事实规划为公众号和小红书工具图文故事板，覆盖痛点、能力、快速上手、适用场景与限制。
---

# 工具图文故事板

只负责 `social-tool` 入口的故事板规划。

## 输入

输入契约为 `social_card_fact_base`，内容类型必须是 `repository`。只使用已核验仓库事实、README、来源 URL 和明确的未知项。

## 输出

输出契约为 `social_card_storyboard`。故事板必须回答：

- 工具是什么，解决什么具体问题。
- 核心能力怎样工作。
- 用户怎样开始。
- 适合谁，有哪些限制、权限和成熟度边界。

不得虚构实际体验、效果、性能、价格、权限、Star、开源协议或安装命令。只输出严格 JSON，不输出发布文案、HTML、CSS 或截图指令。

具体页序与字段规则见 `references/storyboard.md`。渠道、Schema 和构图安全约束由固定运行时注入。
