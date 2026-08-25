## 固定运行契约：事实基座到图文故事板

完整的生成阶段、修复顺序和产物说明见 [Social 图文生成现状与运行链路](../../../docs/design/social-card-generation-current-flow.md)。本文只冻结模型输入输出契约。

只依据运行时事实信封规划故事板，不得增加事实、体验、数字、效果、收益、引语或来源。

返回严格 JSON：

```json
{
  "target_reader": "",
  "pain_point": "",
  "tool_positioning": "",
  "must_highlight": "",
  "must_disclose": "",
  "getting_started": "",
  "forbidden_claims": "",
  "recommended_pages": 4到10,
  "card_plan": [
    {
      "kind": "内容类型允许的页型",
      "role": "cover|concept|feature|steps|data|compare|evidence|timeline|risk|ending",
      "title": "简短的核心页标题（8–14字，不写解释句）",
      "goal": "本页要表达的事实结论或内容结论",
      "evidence": ["事实基座中直接支持本页的证据"],
      "content_blocks": [
        {"type": "{{BLOCK_TYPES}}", "title": "可选小标题", "content": "仅 text/note 使用；单块不超过240字，内容具体充实", "items": [], "headers": [], "rows": [], "source_refs": ["事实基座中直接支持该块的来源标识"]}
      ]
    }
  ]
}
```

补充要求：

- 普通内容页使用 2–4 个内容块；封面最多 1 个核心内容块，结尾页最多 2 个内容块。不要为了满足数量复制事实或堆叠背景、证据和行动建议。
- 结构化内容块必须使用对应结构字段，禁止把块级正文塞进 `content`：`list` 使用 `items` 字符串数组；`stats` 使用 `items` 数组；`steps`、`timeline`、`scenes` 使用对象数组；`compare` 使用 `headers` 和 `rows`。只有 `text`、`note`、`highlight` 和 `code` 使用 `content`。
- `list` 的每条内容必须是独立条目，不要把多个事实用逗号、分号或换行外的长句拼成一个段落；列表项正文放在 `items`，不是列表块的 `content`。
- 内容页和结尾页标题只保留核心主题或结论，禁止使用“标题：解释句/操作说明”的结构；解释放入 `content_blocks`，封面标题可保留完整主张。
- 不得把内部指令、学习目标或布局说明写入标题、goal 和正文。
- 不得输出 HTML、CSS、脚本、坐标、尺寸或本地路径。
- 每个 content_block 必须给出 source_refs；结构化条目的对象也可单独给出 source_refs。引用只能来自事实基座或已核验素材，不得编造来源标识。

## 内容计划调整器

布局失败后的内容计划调整使用 `social-card-content-planner` 用途。模型只能返回 `split_page`、`move_block`、`merge_pages`、`add_component` 四类受控操作；不得返回 HTML、CSS、完整 `card_plan` 或任意新事实。`add_component` 必须引用目标页 `pageCandidates` 中列出的页面专属组件，携带已登记的 `source_refs`，并返回由 AI 生成的展示 `block`；`source_text` 只作为证据，不能原样写入 block。模型不填写 `slot_id`，程序根据组件的页面绑定和统一槽位语义表解析槽位，再校验展示文案、页面角色、故事线、槽位与内容块类型、候选事实、操作数量、来源引用和原子守恒，校验通过后才应用，并重新编译和审计。
