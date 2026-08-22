# Social 图文模板提案与 AI 辅助创建：Phase 0 基线

状态：已完成

基线日期：2026-08-21

本阶段只固化能力边界和数据契约，不改变现有 Social 生成行为。

## 1. 当前模板包

| 模板包 | renderer | 页面角色 | 定位 |
|---|---|---|---|
| `standard-v1` | `current-deterministic-renderer` | 10 个角色 | 标准兼容模板 |
| `neon-v1` | `neon-v1` | 10 个角色 | 终端、网格、未来感 |
| `brutalist-v1` | `brutalist-v1` | 10 个角色 | 硬边框、高冲击、海报感 |
| `editorial-v1` | `editorial-v1` | 10 个角色 | 纸张、印刷、编辑感 |
| `clean-v1` | `clean-v1` | 10 个角色 | 清爽、柔和、工具卡 |

四个专用模板包可以被多个主题复用；主题 Token、recipe 和组件配置继续决定颜色、字体、纹理和局部视觉效果。

## 2. 页面角色和内容块

页面角色固定为：

```text
cover / concept / feature / steps / data / compare / evidence / timeline / risk / ending
```

当前 renderer 内容块白名单为：

```text
text / list / code / note / stats / compare / steps / timeline / scenes / highlight
```

小红书渠道允许全部 10 种内容块；公众号 Social 渠道当前只允许 `text`、`list`、`code`、`note`。

每个模板角色还声明：

- 角色版式 ID；
- 支持的内容块；
- 最大内容块数；
- 最大结构化条目数。

这些能力是故事板生成前注入的约束，也是故事板生成后的程序校验依据。

## 3. renderer 原语边界

当前可复用的 renderer 原语包括：

- 页面骨架：单列、双栏、交替流、上下锚定；
- 页面角色：封面、问题、功能、步骤、数据、对比、证据、时间线、风险、结尾；
- 内容组件：文本、列表、代码、提示、统计、对比、步骤、时间线、场景和强调块；
- 视觉组件：眉题、页眉、页码、页脚、色块标题、边框、阴影、轨道、印章、网格、纸张边线和伪元素装饰；
- 主题参数：颜色、字体、字号、行高、间距、圆角、边框、阴影、纹理和组件配方。

AI 模板草稿可以探索新组合，也可以提出新的 HTML/CSS 结构；但进入生产前必须转换为受控角色、插槽、Token 和组件配置，或进入 renderer 开发队列。

## 4. 提案 Schema

正式契约位于：

[social-template-proposal.schema.json](../../themes/schema/social-template-proposal.schema.json)

模板提案必须包含：

- Social 目标和提案 ID；
- 视觉方向；
- 10 个角色的版式和承载能力；
- 密度、装饰和标题处理；
- 提案来源和状态；
- 可选的 AI HTML/CSS 草稿，但草稿只能进入隔离预览。

提案 Schema 不允许保存任意脚本、网络请求或生产级未审计代码。

## 5. 版本关系

```text
proposalId（提案草稿，短期可变）
        ↓ 用户确认并通过门禁
templatePack.id + templatePack.version（生产模板，稳定可追踪）
        + theme.id + theme.version（主题 Token，独立演进）
        + storyboard snapshot（生成时固化模板版本）
```

- 提案版本用于迭代草稿，不直接参与生产渲染；
- 模板包版本在结构、角色能力或 renderer 契约变化时递增；
- 主题版本只描述颜色、字体、recipe 和组件 Token 的变化；
- 故事板快照记录模板包 ID、模板版本、主题 ID、主题版本和渠道；
- 历史图文不因新模板发布而迁移或重渲染。

## 6. 低置信度匹配原因

`social.templateMatch` 现在额外记录：

- `reasonCode`：`CLEAR_DIRECTION`、`NO_DIRECTION_SIGNAL`、`WEAK_DIRECTION_SIGNAL`、`AMBIGUOUS_DIRECTION_SIGNAL`；
- `score`：胜出方向分数；
- `runnerUpScore`：次优方向分数；
- `margin`：胜出与次优方向的分差。

因此界面可以区分：

- 没有任何视觉信号；
- 有信号但太弱；
- 多个方向接近、无法明确判断；
- 已明确命中特定模板。

低置信度仍使用 `standard-v1`，但可以据此展示“建议创建模板提案”。

## 7. 阶段 0 结论

- 现有模板注册表、角色能力、内容块白名单和 renderer 可作为模板提案编译的基础；
- 新方案不需要改写现有图文生成链路；
- AI HTML/CSS 草稿需要独立的隔离预览和规范化边界；
- 生产模板必须继续经过正式 renderer 和确定性发布门禁；
- 下一阶段可以先实现低置信度提示和模板提案入口，不必立即实现新 renderer。
