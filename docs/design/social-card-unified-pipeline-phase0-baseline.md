# Social 图文统一流程：Phase 0 现状基线

> 状态：Phase 0 已完成
>
> 采集时间：2026-08-26
>
> 对应设计：[Social 图文统一内容与视觉生成流程改造方案](./social-card-unified-editorial-visual-pipeline-design.md)
>
> 机器可读报告：[social-card-unified-pipeline-phase0-baseline.json](./social-card-unified-pipeline-phase0-baseline.json)

## 1. 阶段目标

Phase 0 只回答三个问题：

1. 当前仓库工具图文和事件图文实际生成了什么；
2. 渲染器声明支持什么，但故事板实际命中了什么；
3. 后续“来源准备 → 事实基座 → 叙事提炼 → 故事板 → 视觉渲染”改造应以哪些产物作为回归基线。

本阶段只读取既有产物，没有修改生成逻辑，也没有把手工制作的技能对比页面计入统计。

## 2. 固定回归样本

| 样本 | 类型 | 故事板阶段 | 页数 | 主要页面角色 |
| --- | --- | --- | --- | --- |
| C004 / M6 Mac mini | 事件 | `open-source-technology-storyboard` | 6 | cover、concept、feature、data、risk、ending |
| 马云增持与阿里 AI | 事件 | `event-card-storyboard` | 5 | cover、concept、timeline、compare、ending |
| 600 行代码 AI 编程助手 | 仓库 | `repository-card-storyboard-test` | 6 | cover、concept、feature、steps、concept、risk |

这组三样本覆盖了本次改造最关键的对照关系：一个具体技术事件、一个普通事件和一个仓库工具。当前样本中尚未找到可以确认属于“趋势类”的独立固定产物，因此趋势类样本留作后续补充，不在本报告中冒充趋势基线。

手工使用 `xiaohongshu-article-generator` 制作的 C004 技能对比页面也不纳入统计，因为它不是当前程序生成链路的自然产物。

## 3. 内容块命中情况

三个样本合计 17 页、32 个内容块：

| 内容块 | 实际数量 | 占全部内容块 | 说明 |
| --- | ---: | ---: | --- |
| `text` | 10 | 31.25% | 普通解释、标题或结论文本 |
| `list` | 12 | 37.50% | 事实和要点的主要承载形式 |
| `note` | 6 | 18.75% | 风险、边界和补充说明 |
| `code` | 1 | 3.13% | 仓库示例中的代码块 |
| `steps` | 1 | 3.13% | 仓库示例中的步骤块 |
| `timeline` | 1 | 3.13% | 事件示例中的时间线 |
| `compare` | 1 | 3.13% | 事件示例中的对比块 |

其中 `text/list/note` 共 28 个，占 87.5%。本次改造关注的结构化视觉块 `stats/compare/steps/timeline/scenes/highlight` 共命中 3 个，占 9.375%；只有 3/17 个页面包含这类结构化视觉块。

### 3.1 C004 基线

C004 的 6 页实际只有：

```text
text × 4
list × 5
note × 2
```

这意味着 C004 已有的价格、AI 性能和产品定位事实尚未转成：

- `stats` 数字卡；
- `compare` 前后对比卡；
- `compare.variant=flow` 价格箭头关系；
- `highlight` 核心矛盾/结论卡；
- 语义化的价格、AI、风险图标和证据徽章。

因此，当前 C004 的问题不是“页面没有内容”，而是“内容关系没有被结构化表达”。

### 3.2 仓库样本基线

仓库样本已命中 `steps` 和 `code`，说明现有程序具备将部分工具信息视觉化的能力。但它仍缺少统一的叙事元数据来标记：

```text
痛点 → 机制 → 结果 → 使用场景 → 限制
```

后续不能只看“是否出现 steps”，还要检查步骤是否服务于仓库的核心问题，场景和限制是否被错误合并。

### 3.3 事件样本基线

普通事件样本已命中 `timeline` 和 `compare`，说明事件故事板并非完全不会选择结构化块；但命中依赖具体故事板提示和事实形态，不是统一契约保证的结果。

当前仍没有：

- 统一的事件矛盾字段；
- 数字关系到 `stats` 的稳定转换；
- 前后变化到关系流/箭头的稳定转换；
- 官方宣称、媒体测试和待验证信息的视觉口径区分。

## 4. 渲染能力与实际命中的区别

当前故事板契约和 HTML 渲染器已经声明或处理以下基础内容块：

```text
text、list、code、note、stats、compare、steps、timeline、scenes、highlight
```

但能力声明不等于实际命中。当前基线可以归纳为：

| 能力 | 当前状态 | Phase 0 判断 |
| --- | --- | --- |
| `text/list/note` | 稳定渲染、稳定命中 | 已有能力，但承载过重 |
| `code/steps` | 已渲染，仓库样本有命中 | 可作为仓库回归能力 |
| `timeline/compare` | 已渲染，事件样本有命中 | 需要统一故事板触发规则 |
| `stats` | 有渲染分支，固定样本未命中 | 首要补齐 C004 回归 |
| `scenes/highlight` | 有渲染分支，固定样本未命中 | 需要叙事提炼提供明确意图 |
| `compare.variant=flow` | 尚无专门关系流实现 | 下一阶段新增受控变体 |
| 语义图标/徽章 | 尚无统一字段和白名单渲染 | 下一阶段新增受控协议 |
| 证据口径徽章 | 部分存在于事实校验，不稳定呈现于页面 | 需要绑定 `claim_type/source_refs` |

结论是：第一步不应重写整个渲染器，而应先让叙事提炼和故事板稳定产出正确的视觉意图；随后再补齐关系流、图标和徽章的确定性渲染。

## 5. 对后续阶段的回归要求

### Phase 1：叙事提炼

- 三类样本都生成 `social-card-narrative-focus.json`；
- C004 必须有可回溯的 `hook`、`reader_question`、`tension` 和 `visual_motifs`；
- 仓库样本必须能表达痛点—机制—结果，不能只生成泛化标题；
- 无足够证据时允许 `tension.type=none`。

### Phase 2：故事板结构命中

- C004 至少稳定命中 `stats`、`compare` 或 `highlight` 中的一种，优先命中 `stats + compare`；
- 事件变化、价格、指标前后关系不能继续默认降级为 `list`；
- 仓库样本需要稳定命中 `steps`、`scenes` 或能力结构中的一种；
- 所有结构化块保留 `fact_ids`、`claim_type` 和 `source_refs`。

### Phase 3：视觉关系组件

- C004 生成可审计的“4499 元 → +2500 元 → 6999 元”关系流；
- `icon_key/badge/tone` 使用系统白名单；
- “官方宣称”“媒体测试”“待验证”不能被渲染成同一种无差别事实；
- 不允许通过任意 HTML/CSS 或未来源支持的箭头制造因果暗示。

### Phase 4：合并、修复和渠道降级

- `stats`、`compare.variant=flow`、时间线和核心 `highlight` 视为不可随意拆散的叙事组件；
- 页面合并必须检查 `narrative_role`、`narrative_group`、`fact_ids` 和 `source_refs`；
- 小红书优先支持完整视觉组件，公众号按模板能力安全降级；
- 所有降级、拆页和修复要写入调整记录。

## 6. 阶段 0 产物

- [机器可读基线报告](./social-card-unified-pipeline-phase0-baseline.json)
- [统一流程设计方案](./social-card-unified-editorial-visual-pipeline-design.md)
- [现有实现基线](./social-card-generation-current-flow.md)

Phase 0 完成后，下一步应进入 Phase 1：冻结叙事提炼契约，并让仓库与事件故事板消费同一份叙事主线数据。
