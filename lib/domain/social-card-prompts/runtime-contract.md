## 固定运行契约：事实基座到图文故事板

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
        {"type": "{{BLOCK_TYPES}}", "title": "可选小标题", "content": "单块不超过240字，内容具体充实（写明机制、命令、步骤、数字、边界），避免卡片大片留白；代码块给完整多行命令序列", "source_refs": ["事实基座中直接支持该块的来源标识"]}
      ]
    }
  ]
}
```

补充要求：

- 每页使用 2–4 个内容块。
- 内容页和结尾页标题只保留核心主题或结论，禁止使用“标题：解释句/操作说明”的结构；解释放入 `content_blocks`，封面标题可保留完整主张。
- 不得把内部指令、学习目标或布局说明写入标题、goal 和正文。
- 不得输出 HTML、CSS、脚本、坐标、尺寸或本地路径。
- 每个 content_block 必须给出 source_refs；结构化条目的对象也可单独给出 source_refs。引用只能来自事实基座或已核验素材，不得编造来源标识。

## 内容计划调整器

布局失败后的内容计划调整使用 `social-card-content-planner` 用途。模型只能返回 `split_page`、`move_block`、`merge_pages`、`add_fact_block` 四类受控操作；不得返回 HTML、CSS、完整 `card_plan` 或任意新事实。`add_fact_block` 必须声明目标页面角色允许的 `slot_id`，可携带事实候选 `fact_ids`，并携带已登记 `source_refs`；程序会校验页面角色、故事线、槽位与内容块类型、候选事实、操作数量、来源引用和原子守恒，校验通过后才应用，并重新编译和审计。
