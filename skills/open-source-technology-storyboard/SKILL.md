---
name: open-source-technology-storyboard
description: 将有机制、架构或性能证据的开源技术资料规划为可追溯的技术图文故事板。
---

# 开源技术图文故事板

只负责 `social-event` 入口中被分类为 `open_source_technology` 的 `event` 内容。故事板必须先组织“问题—机制/架构—证据—边界”的技术叙事，再决定页面数量和版式；不得把单一仓库 README 伪装成技术深解文章。

## 输入

输入契约为 `social_card_fact_base`，内容类型必须是 `event` 且分类为 `open_source_technology`。只使用事实基座中的确认事实、分类证据、来源引用和明确未知项。机制、架构、性能数字必须绑定来源；没有机制或架构证据时降级为普通事件/工具图文；没有基准证据时不得生成性能对比页，改写为已知能力与限制。

## 输出

输出契约为 `social_card_storyboard`。每个页面必须同时返回明确的 `kind` 和 `role`，每个内容块必须带 `source_refs`。只输出严格 JSON，不输出发布文案、HTML、CSS 或截图指令。封面最多 1 个核心内容块，结尾页最多 2 个内容块；整组优先控制在 4–6 页，相邻职责应优先合并，不能因为职责数量机械一页一责。

具体页面结构、页面选择、事实分配、内容块和技术边界规则见 `references/storyboard.md`。
