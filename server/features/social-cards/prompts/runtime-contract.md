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
  "recommended_pages": 4,
  "card_plan": [
    {
      "kind": "内容类型允许的页型",
      "role": "cover|concept|feature|steps|data|compare|evidence|timeline|risk|ending",
      "title": "简短的核心页标题（8–14字，不写解释句）",
      "goal": "本页要表达的事实结论或内容结论",
      "evidence": ["事实基座中直接支持本页的证据"],
      "content_blocks": [
        {
          "type": "{{BLOCK_TYPES}}",
          "title": "可选小标题",
          "content": "仅 text/note/highlight/code 使用；单块不超过240字，内容具体充实",
          "items": [],
          "headers": [],
          "rows": [],
          "source_refs": ["事实基座中直接支持该块的来源标识"],
          "visual": {
            "emphasis": "normal|strong|hero",
            "tone": "default|accent|danger|success|warning|muted",
            "icon": "none|metric|ai|price|warning|source|user|timeline|rocket",
            "badge": "可选的短标签"
          }
        }
      ]
    }
  ]
}
```

补充要求：

- `recommended_pages` 必须落在所选类型技能规定的范围内；公共默认目标为 4–7 页。不要为了满足数量复制事实或堆叠背景、证据和行动建议。
- 普通内容页使用 1–3 个有实质内容的块；封面最多 1 个核心内容块，结尾页最多 2 个内容块。只有事实充分且模板容量允许时才增加页面或内容块。
- 每页必须同时输出明确的 `kind` 和 `role`。程序按显式 `kind/role`、类型别名、标题推断的顺序识别页面职责；标题不得覆盖显式角色。
- 结构化内容块必须使用对应结构字段，禁止把块级正文塞进 `content`：`list` 使用 `items` 字符串数组；`stats` 使用 `items` 数组；`steps`、`timeline`、`scenes` 使用对象数组；`compare` 使用 `headers` 和 `rows`。只有 `text`、`note`、`highlight` 和 `code` 使用 `content`。
- `list` 的每条内容必须是独立条目，不要把多个事实用逗号、分号或换行外的长句拼成一个段落；列表项正文放在 `items`，不是列表块的 `content`。
- 内容页和结尾页标题只保留核心主题或结论，禁止使用“标题：解释句/操作说明”的结构；解释放入 `content_blocks`，封面标题可保留完整主张。
- 不得把内部指令、学习目标或布局说明写入标题、goal 和正文。
- 不得输出 HTML、CSS、脚本、坐标、尺寸或本地路径。
- 每个 content_block 必须给出 source_refs；结构化条目的对象也可单独给出 source_refs。引用只能来自事实基座或已核验素材，不得编造来源标识。
- `visual` 是关键信息提取后的语义视觉意图，可放在内容块或结构化条目上，不是 CSS 配置。承载核心事实、数字变化、主体关系、对比、时间变化、边界或操作路径的块必须输出 `visual`；普通背景段落可以省略。只能使用上述枚举值；`badge` 最多 12 个字，必须是当前事实或叙事职责的准确短标签，不得凭空增加“官方数据”“实测”等证据等级。若模型遗漏，运行时会按块类型和标题做保守兜底。
- `visual.emphasis` 用于标记块或条目的重点程度，`tone` 用于表达事实支持的语义色调，`icon` 只能使用受控图标键。每页最多标记 1 个 `hero` 块、2 个 `strong` 块，避免所有内容同时高亮。
- 普通 `text`、`highlight`、`note` 块如需在一句话中突出数字、主体或短语，应在保留完整 `content` 的同时提供 `content_runs`：`[{"text":"原文片段","role":"normal|metric|label|warning|source","tone":"default|accent|danger|success|warning|muted","emphasis":"normal|strong"}]`。片段必须按原文顺序完整覆盖 `content`，不得改写、增删事实；没有把握时只使用块级 `visual`。
- `list.items`、`timeline.items`、`steps.items`、`scenes.items` 中的对象，以及 `compare.rows` 中需要强调的单元格，也可以使用同样的 `visual` 和 `content_runs`。列表/表格对象用 `{ "content": "完整条目", "visual": {...}, "content_runs": [...] }`；时间线、步骤和场景对象保留自身的 `time`/`title`/`content` 字段，`content_runs` 只覆盖 `content`；不要为了装饰给每一条都添加图标或徽章。
- 不输出字号、颜色值、坐标、间距、HTML、CSS、SVG 或表情字符；具体视觉实现由后续渲染器和渠道主题决定。视觉意图不得替代 `source_refs`，也不得成为新增事实的来源。

## 四类故事板的公共门槛

- `repository`：至少有已核验的项目定位和能力事实；快速上手页只有在事实基座提供真实命令或完整操作路径时才生成。
- `event`：至少有一个带来源的核心确认事实；时间线、回应和讨论页按事实条件生成，不为凑页制造争议。
- `open_source_technology`：至少有机制、架构或工作路径证据；只有项目功能、README、Star 或 Trending 时降级为工具图文或普通事件。
- `open_source_trend`：至少满足“跨来源、跨主体、跨时间”中的两类变化信号；只有单个仓库、单次发布或榜单排名时降级为技术/事件/工具图文。

降级是内容安全路径，不是失败：证据不足时缩短故事板、移除不成立的页型，并在 `must_disclose` 或边界页说明缺口；不得用推断补齐。

## 内容计划调整器

布局失败后的内容计划调整使用 `social-card-content-planner` 用途。模型只能返回 `split_page`、`move_block`、`merge_pages`、`add_component` 四类受控操作；不得返回 HTML、CSS、完整 `card_plan` 或任意新事实。`add_component` 必须引用目标页 `pageCandidates` 中列出的页面专属组件，携带已登记的 `source_refs`，并返回由 AI 生成的展示 `block`；`source_text` 只作为证据，不能原样写入 block。模型不填写 `slot_id`，程序根据组件的页面绑定和统一槽位语义表解析槽位，再校验展示文案、页面角色、故事线、槽位与内容块类型、候选事实、操作数量、来源引用和原子守恒，校验通过后才应用，并重新编译和审计。
