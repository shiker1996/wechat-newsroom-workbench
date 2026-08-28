## 当前运行阶段：自定义事实基座到自定义图文故事板

只依据自定义事实基座规划卡片，不得虚构体验、效果、数字或收益。体验真实性三来源等级是硬约束：source_level=author_experience 的要点可以写成第一人称亲历；user_material 必须保留来源归属；model_suggestion 只能表述为建议或参考，禁止写成亲测、效果或收益。

按内容类型组织故事线：

- 教程：cover → 场景与痛点 → step 分步页 → 注意事项 → ending
- 清单：cover → 筛选标准 → item 条目页 → 边界 → ending
- 观点：cover → 核心论点 → highlight 论据页 → 反方与边界 → ending

返回严格 JSON：

```json
{
  "target_reader": "",
  "pain_point": "",
  "tool_positioning": "内容定位",
  "must_highlight": "",
  "must_disclose": "来源等级与体验边界",
  "getting_started": "",
  "forbidden_claims": "",
  "recommended_pages": 4,
  "card_plan": [
    {
      "kind": "cover|highlight|step|item|boundary|ending",
      "role": "cover|concept|feature|steps|risk|ending",
      "title": "简短的核心页标题（8–14字，不写解释句）",
      "goal": "用一句话说明本页的生成目标（仅供内部生成阶段使用，不会展示在卡片上），不要写成学习目标。错误示例：'读者能...'、'本页旨在...'；正确示例：'三步完成配置，第二步最容易漏。'",
      "evidence": ["事实基座中支持本页的要点，标注来源等级"],
      "content_blocks": [
        {"type": "{{CARD_BLOCK_TYPES}}", "title": "可选小标题", "content": "每块不超过 240 字，内容要具体：写明做法、步骤、要点、数字与边界，不要空泛；教程步骤/清单条目写够细节，让卡片内容充实，避免大片留白；禁止出现'让读者...'、'本页旨在...'等指令描述", "source_refs": ["事实基座中的来源标识"]}
      ]
    }
  ]
}
```

### 视觉意图示例

视觉意图不能改变作者体验、用户素材和模型建议的来源等级，只能突出已有内容中的关键步骤、关键判断和边界：

```json
{
  "type": "steps",
  "title": "配置步骤",
  "items": [
    {"title": "准备配置", "content": "填写已确认的参数。", "visual": {"emphasis": "strong", "icon": "source"}},
    {"title": "确认边界", "content": "模型建议尚未实测。", "visual": {"tone": "warning", "icon": "warning", "badge": "未实测"}}
  ],
  "source_refs": ["事实基座中的教程来源"]
}
```

需要突出一句话时，保留完整 `content`，并按原文顺序提供 `content_runs`；不得把模型建议标成作者亲历。

教程步骤块示例：

```json
{
  "type": "steps",
  "title": "配置步骤",
  "items": [
    {"title": "准备配置", "content": "填写事实基座中明确要求的参数。"},
    {"title": "执行操作", "content": "运行事实基座提供的真实命令或操作。"}
  ],
  "source_refs": ["事实基座中的教程来源"]
}
```

清单块示例：

```json
{
  "type": "list",
  "title": "筛选标准",
  "items": ["标准一：具体条件", "标准二：具体边界"],
  "source_refs": ["事实基座中的清单来源"]
}
```

补充要求：

- 内容页和结尾页标题只保留核心主题或结论，禁止使用“标题：解释句/操作说明”的结构；解释放入 `content_blocks`，封面标题可保留完整主张；

- 每页内容块遵守固定画布密度预算：封面最多 1 个、内容页 2–3 个、结尾页最多 2 个；同一页最多 2 个列表块，单页列表条目合计不超过 9 条。超出推荐页数时不得裁剪事实，生成阶段会优先合并或拆分续页；只有超过绝对安全上限才阻断。
- 至少一页说明事实边界与限制（boundary）。
- model_suggestion 要点不得单独成页充当卖点。
- must_disclose 必须写明体验性表述来自作者确认、建议性内容未实测。
- 每个内容块必须提供 `source_refs`，结构化条目可单独提供来源引用；引用必须来自自定义事实基座，不得编造来源。
