---
name: custom-card-storyboard
description: 将作者提供的主题、要点和素材规划为教程、清单或观点类公众号和小红书图文故事板，严格保留作者体验、用户素材与模型建议的来源等级。
---

# 自定义图文故事板

只负责 `social-custom` 入口的 `tutorial`、`list` 和 `opinion` 故事板规划。

## 输入

输入契约为 `social_card_fact_base`。每条核心要点必须保留：

- `author_experience`：可以作为作者亲历。
- `user_material`：必须保留来源归属。
- `model_suggestion`：只能作为建议或参考。
- 事实基座可能附带 `web_search` / `news_search` 联网检索结果或 `document_search` 本地知识库检索结果：均属于外部资料，按 `user_material` 同等约束处理——可引用其信息但必须保留来源归属（标题与 URL 或文档路径），不得写成作者亲历或已验证事实。

## 输出

输出契约为 `social_card_storyboard`。教程使用分步结构，清单使用筛选标准与条目结构，观点使用论点、证据与反方边界结构。至少保留一页事实边界。

不得把模型建议写成亲测、效果或收益，不得把个人判断写成行业共识。只输出严格 JSON，不输出发布文案、HTML、CSS 或截图指令。具体规则见 `references/storyboard.md`。
