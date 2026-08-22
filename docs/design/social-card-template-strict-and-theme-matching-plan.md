# Social 图文模板严格渲染与新主题模板匹配方案

> 当前实现说明：模板选择、容量、内容计划和修复顺序的统一现状见 [Social 图文生成现状与运行链路](./social-card-generation-current-flow.md)。本文重点记录模板严格渲染和主题匹配的改造过程。

状态：Phase 1、Phase 2、Phase 3 已完成，Phase 4 已完成本地确定性验证，待有模型凭据后做候选端到端重生成

范围：仅 Social 图文主题、Social 故事板和 Social 图文渲染。文章主题、封面主题及其交互不在本方案内。

关联方案：`social-card-semantic-storyboard-theme-template-design.md`

Phase 0 基线：[social-card-template-strict-phase0-baseline.md](./social-card-template-strict-phase0-baseline.md)

当前状态：Phase 0、Phase 1、Phase 2、Phase 3 已完成；Phase 4 已完成渲染器、匹配器和历史兼容路径验证，候选 787/767 的真实重生成仍待模型凭据。

## 1. 背景与问题

当前专用 Social 模板包（`neon-v1`、`brutalist-v1`、`editorial-v1`、`clean-v1`）在首次布局审计失败时，会整组回退到 `standard-v1`。这保证了“尽量出图”，但会产生主题与实际模板不一致的结果：主题颜色仍然保留，页面结构却已经换成标准模板。

候选 787 已出现该情况：请求的是 `brutalist-v1`，实际交付使用了 `standard-v1`，最终布局审计虽然通过，但用户无法仅凭主题选择判断实际模板。

同时，新 Social 主题的模板绑定还不够明确：

- 复制内置主题会继承原主题模板包；
- AI 创建 Social 主题只生成颜色、字阶、配方和组件，不生成模板包；
- 导入没有模板包的主题时，模板包字段仍可缺省；
- resolver 在缺少模板包时默认使用 `standard-v1`。

因此，新主题可能成为“自定义主题 Token + 标准模板”，而不是完整的“主题 + 模板”组合。

## 2. 目标

1. 新生成的专用模板尽量保持主题与模板一致，不再无感整组切换到 `standard-v1`。
2. 新建 Social 主题时由程序明确匹配模板包，AI 不直接自由编写模板 ID。
3. 保留 `standard-v1`，但将其定位为兼容模板和显式的稳定模板，而不是新主题的默认推荐模板。
4. 不迁移历史已发布图文，不批量重生成旧故事板。
5. 模板严格模式失败时给出明确失败原因，保留安全构图、密度调整和受控内容修复能力。

## 3. 非目标

- 不删除 `standard-v1` 模板注册和标准 renderer。
- 不修改历史 HTML、PNG、文案和已经发布的图文。
- 不强制回填历史 `storyboard_theme_snapshot_json`。
- 不改变文章主题和封面主题的创建、预览、发布流程。
- 不让 AI 输出任意 HTML、CSS、坐标或模板代码。

## 4. 目标模板角色

### 4.1 专用模板包

| 视觉方向 | 模板包 |
|---|---|
| 终端、未来感、网格、开发者工具 | `neon-v1` |
| 高冲击、硬边框、黑白强对比、海报感 | `brutalist-v1` |
| 纸张、编辑、印刷、衬线、来源账页 | `editorial-v1` |
| 清爽、柔和、工具卡、低装饰 | `clean-v1` |

模板包负责页面角色构图和内容承载能力，主题 Token 和 Social 配方负责颜色、字体、阴影、纹理与局部组件表现。

### 4.2 `standard-v1`

`standard-v1` 保留，但重新定义为：

- 旧故事板和旧主题的兼容 renderer；
- 用户/AI 主题没有模板包时的兼容默认值；
- 用户明确选择的稳定通用模板；
- 专用模板问题排查时的人工对照样本。

新主题创建界面中不再把它作为首选推荐项，显示名称改为“标准兼容模板”，并明确提示它不提供专用视觉结构。

## 5. 新主题的模板匹配流程

### 5.1 复制内置主题

继续继承源主题的 `social.templatePack`。用户可以在主题编辑器中更换模板包，发布前重新执行主题固定样稿和模板元数据门禁。

### 5.2 AI 创建 Social 主题

AI 只生成：

- 颜色 Token；
- 字体和字阶；
- Social recipes；
- 组件配方；
- 设计摘要和视觉气质。

程序随后根据请求偏好、设计摘要、字体/纹理/骨架配方执行确定性匹配：

```text
终端 / futuristic / grid / mono
  → neon-v1

bold / hard / high-impact / brutal
  → brutalist-v1

paper / editorial / serif / print
  → editorial-v1

clean / soft / restrained / tool-card
  → clean-v1
```

匹配结果写入 `social.templatePack: { id, version }`，并在编辑器中展示“程序推荐，可手动调整”。AI 输出不得覆盖该系统字段。

### 5.3 导入主题和无模板包主题

- 导入的 Social 主题没有模板包时，先按上述规则自动匹配；
- 无法判断时使用 `standard-v1`，但标记为“兼容模板待确认”；
- 发布门禁要求新建主题明确绑定模板包；
- 历史用户主题仍允许按兼容路径打开，不做批量迁移。

## 6. 取消模板级自动回退

### 6.1 新流程

专用模板首轮布局审计失败后，不再自动整组切换 `standard-v1`：

```text
专用模板首轮审计失败
  → 同模板安全构图
  → 同模板舒展/扩展密度
  → 受控 AI 扩写、缩写或压缩现有文字
  → 重新审计
  → 仍失败：明确报错并定位问题页
```

安全构图、密度调整和内容修复只允许改变现有页面的承载方式或文字长度，不得改变事实、页数、页面顺序和内容块结构。

### 6.2 `standard-v1` 的使用边界

取消的是“审计失败后的自动整组回退”，不是删除 `standard-v1`：

- resolver 对缺少模板包的旧/自定义主题仍可使用 `standard-v1`；
- 用户可以显式选择“标准兼容模板”；
- 历史产物不重新渲染时不受影响；
- 新绑定专用模板的生成不会静默改变模板包。

### 6.3 失败反馈

最终失败信息至少包含：

- 请求模板包及版本；
- 失败页码和页面角色；
- 布局审计问题；
- 已尝试的安全构图、密度调整和内容修复轮次；
- 建议在故事板中修改页面，或由用户主动选择“使用标准兼容模板重试”。

“使用标准兼容模板重试”如果保留，应是用户明确点击的二次操作，而不是后台自动行为。

## 7. 实施阶段

### 阶段 1：模板严格模式

- 将专用模板的自动 fallback 改为严格模式；
- 保留 `standard-v1` registry、resolver 默认值和显式手动选择；
- 记录首轮审计报告，避免只留下回退后的最终报告；
- 更新模板指标，区分“显式兼容模板”和“自动模板回退”；
- 增加 brutalist、neon、editorial、clean 的动态长标题、长清单和步骤页回归样例。

#### 阶段 1 实施结果（2026-08-21）

- `runSocialCardPipeline` 已移除专用模板首轮审计失败后的整组 `standard-v1` 自动切换；安全构图、舒展/扩展密度和受控文字修复仍在同一模板内执行。
- `renderStoryboardHtml` 的显式 `templatePackOverride` 兼容入口保留，`standard-v1` registry、resolver 默认值和手动选择路径不变。
- 生成产物新增 `template-audit-initial.json`，严格失败新增 `template-failure-report.json`；失败报告包含请求/实际模板、每轮审计、失败页、密度/构图尝试和修复轮次。
- `social-template-metrics.json` 新增 `fallbackKind`、`initialLayoutPass`、`auditAttempts`、`strictFailure`，聚合统计区分模板级自动回退、resolver 回退、resolver 默认兼容和显式兼容模板。
- 相关 Social 图文回归测试共 96 项，全部通过；历史产物未改写。

### 阶段 2：新主题模板匹配

- 新增 Social 模板匹配器，输出模板包 ID、版本和匹配理由；
- AI Social 主题创建完成后自动写入模板包；
- 复制主题继续继承模板包；
- 导入主题按规则匹配，无法判断时标记兼容待确认；
- 编辑器展示“程序推荐 / 用户调整 / 兼容模板”来源。

#### 阶段 2 实施结果（2026-08-21）

- 新增确定性 Social 模板匹配器，按主题名称、描述、标签、设计摘要、字体、纹理、形状、阅读偏好等受控信号，为 `neon-v1`、`brutalist-v1`、`editorial-v1`、`clean-v1` 计算匹配分数和理由。
- AI 创建 Social 主题时，模型不得决定模板包；服务端会移除候选中可能携带的模板字段，再写入程序匹配的 `social.templatePack` 和 `social.templateMatch`。
- 新建、导入、复制和保存 Social 用户主题都会补齐模板绑定；复制主题记录“复制继承”，无明确方向时使用 `standard-v1` 并标记“标准兼容/待确认”。
- 主题详情和编辑器展示匹配来源、置信度和理由；文章主题、封面主题不经过该匹配器。
- 新增 `themes/schema/theme.schema.json`、运行时校验和正式编译器 usage map 对匹配摘要的契约支持。
- 阶段 2 专项回归测试与原有 AI/主题测试全部通过。

### 阶段 3：发布门禁和界面调整

- 新 Social 主题发布前要求有明确模板包；
- `standard-v1` 在列表中改名为“标准兼容模板”；
- 新主题默认推荐专用模板，不再默认推荐 `standard-v1`；
- 预览页显示模板包、角色模板和是否为兼容模板；
- 保留旧主题只读兼容报告，不原地迁移历史主题。

#### 阶段 3 实施结果（2026-08-21）

- 新建的 Social 用户主题必须带有效 `social.templatePack` 才能通过发布门禁；文章和封面主题继续使用原有门禁。
- 缺少模板包的历史 Social 用户主题仍可按 `standard-v1` 打开和预览，但发布门禁会给出 `TEMPLATE_REQUIRED`，主题编辑器切换为只读兼容报告，不原地补写模板绑定。
- `standard-v1` 的显示名称改为“标准兼容模板”；主题目录、编辑器和正式预览补充模板来源、兼容标记、角色模板映射和匹配摘要。
- 专用模板说明明确不会在审计失败时静默切换到其他模板。
- 阶段 3 专项测试与相关主题门禁测试通过。

### 阶段 4：明日验证

- 用候选 787 验证 `charcoal → brutalist-v1`，确认失败时不再自动变成标准模板；
- 用候选 767 验证列表型故事板的长清单和步骤页；
- 验证 AI 创建一个终端风格主题是否自动匹配 `neon-v1`；
- 验证 AI 创建一个清爽工具卡主题是否自动匹配 `clean-v1`；
- 验证缺失模板包的旧主题仍能打开和显式使用 `standard-v1`；
- 验证文章主题和封面主题没有被影响。

#### 阶段 4 本地验证结果（2026-08-21）

- 直接使用当前正式渲染器重放候选 787 的既有故事板，输出模板包为 `brutalist-v1`，角色模板包含 `poster-cover`、`thesis-split`、`feature-grid`、`numbered-steps`、`hard-cta`；未发生 `standard-v1` 模板级回退。
- 直接使用当前正式渲染器重放候选 767 的列表型故事板，输出模板包为 `clean-v1`，角色模板覆盖 `clean-cover`、`clean-problem`、`clean-feature`、`clean-steps`、`clean-compare`、`clean-ending`，列表内容仍由故事板页结构承载。
- AI 主题匹配器确定性验证通过：终端/未来感主题命中 `neon-v1`（high），清爽工具卡主题命中 `clean-v1`（high），无明确方向主题使用 `standard-v1` 并标记 `compatibility/low`。
- 现有候选 787 交付物的历史指标仍记录 `requestedTemplate=brutalist-v1`、`renderedTemplate=standard-v1`，这是改造前产物，不代表当前渲染结果；未覆盖历史 HTML/PNG。
- 现有缺模板用户主题通过接口验证为 `legacy=true`、`editorMode=read-only`，并返回 `TEMPLATE_REQUIRED`；标准兼容预览标签为“标准兼容模板”。
- 全量自动化回归 1142 项通过，文章主题和封面主题路径未出现回归。
- 当前工作区未配置 `DEEPSEEK_API_KEY` 或其它模型凭据，因此未直接触发 787/767 的真实整组重生成，避免在无法完成图文文案阶段时覆盖历史交付物。补充凭据后只需重新生成故事板/图文并检查 `social-template-metrics.json` 的 `requestedTemplate` 与 `renderedTemplate`。

## 8. 验收标准

- 新专用模板布局失败时不会静默渲染成 `standard-v1`；
- 最终产物的 `requestedTemplate` 与 `renderedTemplate` 一致，除非用户主动选择兼容模板；
- AI 新建 Social 主题必有模板匹配结果和匹配理由；
- 复制、导入、AI 创建三条路径的模板绑定行为一致可解释；
- `standard-v1` 仍可渲染旧故事板、无模板包主题和用户显式选择的兼容模板；
- 历史已发布图文不需要迁移，现有文件不被改写；
- 文章主题、封面主题和既有主题管理能力回归通过。

## 9. 待办清单

- [x] 下掉专用模板的模板级自动回退。
- [x] 新增 Social 新主题模板匹配器。
- [x] AI 创建主题自动写入 `social.templatePack`。
- [x] 导入/复制主题补齐模板匹配来源和兼容提示。
- [x] 将 `standard-v1` 调整为“标准兼容模板”的产品定位和界面文案。
- [x] 保留历史主题兼容路径，不做批量迁移。
- [x] 用当前渲染器和 AI 匹配器完成候选/新主题的本地确定性验证。
- [ ] 在有模型凭据后重新生成候选 787、767，完成真实端到端交付验证。
