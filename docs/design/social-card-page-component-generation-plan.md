# Social 图文页面专属组件生成层方案

> 当前实现说明：本文记录组件生成层的阶段设计和执行过程。当前完整运行顺序请以 [Social 图文生成现状与运行链路](./social-card-generation-current-flow.md) 为准。
>
> 重要收敛：AI 只返回 `add_component`，不填写 `slot_id`；内容计划只接收目标页 `pageCandidates`，不再把全局事实组件池暴露给模型。文中早期“全局补充池”“AI 返回 `slot_id`”描述属于改造前基线。

## 1. 背景

改造前的 Social 图文曾经从全局事实索引生成补充组件，并要求 AI 直接返回 `slot_id`。这些问题已在阶段 1–3 收敛：当前补充组件绑定目标页和页面角色，AI 只选择页面专属组件，槽位由程序按统一语义表解析。事实索引中的字段名（例如 `coreCapabilities`、`sections`、`value`）也不再作为展示标题。

本方案只改 Social 图文链路，不改文章主题、文章生成、封面主题和历史已发布图文。

## 2. 目标与非目标

### 2.1 目标

- 故事板核心组件继续决定页面讲什么；
- 补充组件在生成时绑定目标页面、页面角色和语义意图；
- 组件标题不再直接使用事实索引字段名；
- AI 选择内容和表达方式，程序负责来源、容量和布局安全；
- 槽位从 AI 的硬约束改为程序侧的语义提示、排序和容量元数据；
- 装箱失败只归因于无合适组件、容量不足或结构门禁，不再因为 AI 自由填写槽位而失败。

### 2.2 非目标

- 不重写 Social 模板渲染器；
- 不取消页面角色和模板容量定义；
- 不删除来源、事实守恒和浏览器布局门禁；
- 不迁移历史已发布图文；
- 不改文章和封面生成链路。

## 3. 改造前基线与问题（历史记录）

当前链路是：

```text
事实索引
  → 全局通用补充组件池
  → 按语义槽位筛选
  → AI/程序返回 slot_id
  → 槽位、块类型、来源和容量校验
  → 装箱渲染
```

当前存在四个问题：

1. `factComponent()` 直接使用 `candidate.label` 作为组件标题，字段名可能进入页面；
2. `buildSocialCardContentComponents()` 为所有页面建立一个全局补充池，组件没有目标页面上下文；
3. AI 仍需返回 `slot_id`，程序又对槽位进行二次硬校验；
4. 事实索引和组件层分别维护槽位语义映射，存在规则漂移。

## 4. 组件模型

### 4.1 核心组件

核心组件来自故事板，必须绑定页面并保持故事板意图：

```json
{
  "component_id": "core-p4-block-1",
  "kind": "core",
  "page": 4,
  "role": "feature",
  "title": "一键同步反馈",
  "render_type": "text",
  "content": "所有编辑和评论完成后，点击 Send 即可发送反馈。",
  "fact_ids": [],
  "source_refs": ["README:usage"]
}
```

### 4.2 页面专属补充组件

补充组件由页面上下文和事实候选共同生成：

```json
{
  "component_id": "supplement-p6-run-01",
  "kind": "supplement",
  "page": 6,
  "role": "steps",
  "semantic_intent": "run",
  "title": "启动本地审查",
  "content": "使用命令启动本地页面审查，并在浏览器中完成修改。",
  "render_candidates": ["note", "steps", "code"],
  "preferred_render": "note",
  "fact_ids": ["fact-7618481ec22a"],
  "source_refs": ["README:usage"],
  "estimated_height_px": { "min": 58, "expected": 82, "max": 124 },
  "split_policy": "atomic"
}
```

组件标题必须使用 `display_label` 或页面语义标题，不能直接展示 `coreCapabilities`、`sections`、`value`、`topics` 等索引字段名。原始 `path` 仅用于审计和过滤。

## 5. 页面专属组件生成

组件生成器接收单页上下文：

```json
{
  "page": {
    "page_number": 6,
    "role": "steps",
    "title": "三步开启视觉审查（续）",
    "story_intent": "补充运行和验证方式",
    "core_components": ["core-p6-code-1"]
  },
  "capacity": {
    "max_blocks": 4,
    "remaining_blocks": 2,
    "remaining_height_px": 116
  },
  "component_policy": {
    "preferred_intents": ["run", "verify"],
    "allowed_render_types": ["note", "steps", "code"],
    "max_components": 1
  },
  "fact_candidates": []
}
```

程序先筛选来源、页面职责和容量，AI 负责自然标题、事实压缩和渲染建议。程序再执行标题归一化、容量预检和来源校验。

## 6. 槽位调整

槽位保留，但不再要求 AI 直接填写：

```text
AI 返回 semantic_intent=run
  → 程序根据页面角色解析为 slot_id=run
  → 程序选择可承载的 render_type
```

槽位继续提供：

- 页面职责提示；
- 候选排序权重；
- 可用块类型建议；
- 最大条目数和容量信息。

程序仍硬校验：

- 来源和 `fact_id` 一致；
- 组件属于目标页面；
- 渲染类型可用；
- 页面块数、条目数和像素容量安全；
- 浏览器布局无 overflow、clipped、horizontal overflow。

语义槽位不再作为 AI 操作失败的唯一原因。

## 7. 实施阶段

### 阶段 0：契约盘点与语义来源收敛

- 冻结核心组件、补充组件、事实候选和页面组件候选的字段边界；
- 统一 `display_label`、`semantic_intent`、`render_candidates`、`estimated_height_px` 字段命名；
- 盘点并标记 `SLOT_TAGS`、`SLOT_SEMANTIC_TAGS` 等重复语义映射；
- 明确 `slot_id` 为程序内部解析字段，不作为 AI 操作契约；
- 增加字段名泄漏、元数据事实和旧操作格式的回归测试；
- 阶段 0 不改变生产装箱结果。

#### 阶段 0 执行记录（已完成）

- 新增 `lib/rendering/social-card-page-component-contract.mjs`，冻结页面组件契约版本、核心/补充组件类型和页面语义映射；
- 核心组件和补充组件统一增加 `schemaVersion`、`componentId`、`kind`、`page`、`role`、`semanticIntent`、`semanticIntentCandidates`、`displayLabel` 等阶段 0 字段；
- 事实索引和组件装箱改为共享同一份 `SOCIAL_CARD_SLOT_SEMANTIC_TAGS`，消除两套槽位语义映射的漂移；
- 保留现有 `id`、`content.title` 和 `slot_id` 读写行为，生产装箱逻辑未在阶段 0 切换；
- 新增 `test/social-card-page-component-contract-phase0.test.mjs`，覆盖组件字段、语义映射和字段名展示标签归一化；
- 阶段 1 再启用 `displayLabel` 生成自然页面标题，阶段 3 再逐步取消 AI 对 `slot_id` 的直接依赖。

### 阶段 1：事实语义归一化

- 为事实候选增加 `display_label` 和 `semantic_intent_candidates`；
- 过滤 `topics`、仓库统计、版本状态、字段名和项目分类；
- 为 README 章节和数组字段生成自然语义标题；
- 保留原始路径用于审计，不允许直接展示。

#### 阶段 1 执行记录（已完成）

- `buildSocialCardFactIndex` 为每个候选写入 `display_label`、`semantic_intent`、`semantic_intent_candidates`、`component_eligible` 和排除原因；
- topics、仓库统计和“项目主题：...”分类值仍保留在事实索引中供审计，但不会进入补充组件池，也不会进入 AI 候选提示；
- 补充组件的 `content.title` 改用自然展示标签，`sections`、`coreCapabilities` 等字段名不再直接出现在页面组件标题中；
- 组件槽位兼容性统一读取候选资格标记和阶段 0 的元数据分类器，避免事实索引与组件装箱重复维护过滤规则；
- 新增 `test/social-card-page-component-generation-phase1.test.mjs`，覆盖候选归一化、组件池过滤、提示词过滤和资格标记校验；
- 阶段 1 未改变页面专属组件生成和装箱策略，下一阶段再把组件候选按 page/role 绑定。

### 阶段 2：页面专属组件生成

- 新增按页面生成组件候选的函数；
- 组件绑定 `page`、`role`、`semantic_intent`；
- 根据剩余高度和块数生成候选组件；
- AI 只负责组件内容和表达方式，程序负责候选范围和来源。

#### 阶段 2 执行记录（已完成）

- 新增 `buildSocialCardPageComponentCandidates`，按有效页面的 `page/role` 遍历允许的补充槽位；
- 每个候选同时绑定 `slotId`、`preferredRender`、语义得分和 `capacityEstimate`，不再只有一个全局事实组件池；
- 候选生成复用现有页面高度估算器，先排除超容量或无法保留安全余量的渲染形式；
- 装箱器优先消费当前页面的专属候选；只有兼容代码路径缺少页面候选快照时，程序内部才允许读取全局来源池，AI 提示和新操作不暴露该池；
- 图文生成链路使用有效故事板（模板预检/续页之后）构建页面候选，并把候选快照写入 `social-card-content-components.json`；
- 新增 `test/social-card-page-component-generation-phase2.test.mjs`，覆盖页面绑定、容量过滤和跨页隔离；
- 阶段 2 仍保留全局候选字段作为程序内部兜底，操作接口收敛放在阶段 3。

### 阶段 3：装箱接口收敛

- 用 `add_component` 作为唯一的内容计划补充操作；
- AI 不再必填 `slot_id`；
- 程序根据组件语义意图解析槽位和渲染类型；
- 将语义匹配从硬失败调整为排序与告警；
- 保留容量、来源和浏览器硬门禁。

#### 阶段 3 执行记录（已完成）

- 内容计划 Schema 新增 `add_component`，要求 `page`、`component_id`、来源引用和 AI 生成的展示 `block`；`slot_id` 不再是 AI 输出字段；
- 组件操作在程序侧根据页面专属候选、角色和语义标签解析为内部校验结构，复用既有来源、事实和容量门禁；
- `render_type` 可由组件候选或操作显式选择，缺省时使用组件首选渲染形式；
- 无法解析组件、角色槽位或事实来源时明确失败，不静默补入通用槽位；
- 旧内容计划操作不再接受；历史故事板进入生成入口时应提示先重新生成故事板；
- 新增 `test/social-card-component-operation-phase3.test.mjs`，覆盖新 Schema、语义解析、应用和未知组件失败路径。

### 阶段 4：新链路回归与历史故事板拦截

- 历史故事板不进入新的图文生成链路，生成入口提示重新生成故事板；
- 新链路不再写入旧的通用字段绑定；
- 使用 clean、neon、brutalist、editorial 四套模板回归；
- 验证标题不泄漏字段名，步骤续页能够优先补充 run/verify/boundary 内容。

#### 阶段 4 执行记录（已完成）

- 历史故事板若没有 `storyboard_theme_snapshot_json.templatePack`，统一标记为 `needs-storyboard`，禁止直接渲染或生成图文，并返回“请先重新生成故事板”；
- 主题切换接口不再把历史故事板静默迁移到当前主题，仅允许已有新快照且模板能力一致时执行同模板换肤；
- 既有四模板真实浏览器回归覆盖 `clean-v1`、`neon-v1`、`brutalist-v1`、`editorial-v1`，共享仓库故事板均通过 overflow、clipped、horizontal overflow、text too small 等硬门禁；
- 新增历史故事板拦截测试，四模板回归测试继续作为阶段 4 的真实渲染验收。

## 8. 验收标准

1. 页面不出现 `coreCapabilities`、`sections`、`value`、`topics` 等事实索引字段名；
2. 核心组件和补充组件在产物中可区分；
3. 补充组件带有目标页面和语义意图；
4. AI 不填写或自由修改槽位不会导致有效组件失败；
5. 装箱失败能区分“无合适组件”和“容量不足”；
6. 步骤页优先补充安装、运行、验证或边界事实；
7. 四个内置模板继续通过真实浏览器布局门禁。

## 9. 结论

组件装箱是盒子层能力，页面专属组件生成是内容层能力。只有先为每页生成语义正确、标题自然、容量可估算的组件，再交给装箱器选择承载方式，才能避免字段名泄漏和槽位冲突，并接近技能生成图文的效果。
