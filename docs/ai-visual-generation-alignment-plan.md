# AI 视觉生成对齐方案

> 当前状态：生成链路已按本文目标实施。当前生效口径以 `docs/design/social-card-ai-visual-pipeline-agent-design.md` 和代码为准；本文保留实施过程和决策记录。

## 1. 目标

将项目中的 AI 视觉生成版改造成与本次对话中生成的“本地版”和“技能生成版”一致的生成模式：

```text
完整读取资料
→ 在同一个视觉上下文中完成整组页面策划
→ 自主设计主题、组件、装饰、层级和页面节奏
→ 一次性生成完整 HTML + CSS
→ 原样保留 Agent 产物
```

本方案的对齐目标是自由 HTML/CSS 生成效果，不是复用项目当前的确定性页面渲染器。目标产物允许使用 Agent 自己设计的主题组件类，例如 `.neon-card`、`.neon-stat-row`，不要求转换成程序化渲染器的类名。

## 2. 术语和边界

### 2.1 三种生成方式

| 名称 | 定义 | 目标关系 |
|---|---|---|
| 本地版 | 当前对话中直接由模型完成整套 HTML/CSS 设计 | 视觉参考 |
| 技能生成版 | 通过旧版 `xiaohongshu-article-generator` 技能，由一个完整上下文生成 `my-design.html` | 主要流程参考 |
| AI 视觉生成版 | 项目 `social-card-beautify` 中的 Agent 生成 `ai-beautified.html` | 本方案改造对象 |

### 2.2 明确不复用的内容

目标 AI 视觉生成阶段不调用以下程序化视觉渲染器：

- `resolveCardCompositionDecision`
- `renderStoryboardSections`
- `renderNeonStoryboardSections`
- `renderStoryboardBlock`
- `renderStoryboardHtml`
- `compileSocialTheme` 生成页面 CSS

这些函数可以继续服务于项目的确定性本地渲染链路，但不应参与 AI 视觉 HTML 的生成。

### 2.3 当前后置阶段边界

- 结构门禁
- 浏览器布局审计
- AI 页面修复 Agent
- 内容审计
- 程序化视觉修补
- 程序化回退页面
- 将自由 HTML 转换成程序化模板

以上阶段当前仍关闭，用于只观察 Agent 原始 HTML/CSS。截图和轻量交付门禁已恢复，由 Pipeline 在生成完成后执行；截图失败只重试截图，不重新调用 AI。

## 3. 已解决的历史问题

早期流程在 [`server/features/social-cards/application/social-card-ai-visual-agent.mjs`](../server/features/social-cards/application/social-card-ai-visual-agent.mjs) 中拆成两个独立循环：

```text
CSS Agent
  → append_head_css

Page Agent
  → append_body / append_body_with_styles
```

这曾造成以下结构性差异，当前已改为单 Agent：

1. CSS 和 HTML 不在同一个设计上下文内完成。
2. CSS Agent 无法看到页面最终构图，容易漏写或误写组件 CSS。
3. Page Agent 只能继承已有 CSS，不能完整调整视觉系统。
4. CSS 被限制为最多 3 个分片，每片 3500 字符。
5. 页面被强制逐页追加，页面之间难以保持整体节奏。
6. 工具协议和阶段切换占用了大量模型上下文。
7. 当前结构契约要求固定类名，削弱了技能生成版的自由组件表达。
8. `ai-visual-card-plan.json` 已作为生成 Agent 的候选工作区输入。
9. `social-theme-snapshot.json` 已作为生成 Agent 的候选工作区输入，但 AI-facing 副本会移除程序化字号、行高和间距 token。
10. AI 视觉生成和技能版比较时使用同一份 `card-plan.json` 与事实基座；不复制布局参考到候选目录，避免输入重复。

## 4. 目标架构

### 4.1 新的生成流程

```text
runSocialCardBeautify
  ├─ 准备固定输入文件
  │   ├─ card-plan.json
  │   ├─ ai-visual-card-plan.json
  │   ├─ 原始事实 JSON
   │   ├─ social-theme-design-spec.md
   │   ├─ social-theme-snapshot.json
   │   └─ copy.txt
   │
   │   （layout-guide.md、xhs-visual-contract.md、visual-component-mapping.md
   │    由技能运行时随 Prompt 注入，不复制到候选目录）
  │
  ├─ 创建最小 HTML 容器
  │
  ├─ 启动 Single Visual Agent
  │   ├─ 一次读取全部工作文件
  │   ├─ 内部完成整组视觉解释
  │   ├─ 内部决定组件和页面节奏
  │   └─ 在同一 Agent 会话中分块追加完整 HTML + CSS
  │
  └─ 原样保存生成结果
```

### 4.2 Agent 的职责

Single Visual Agent 同时负责：

- 阅读故事板和事实基座
- 识别每页核心信息
- 选择视觉主焦点和辅助层级
- 将主题 SPEC 翻译成真实 CSS
- 设计主题装饰
- 设计页面组件
- 设计完整页面 HTML
- 保持整组页面的统一性和节奏

Agent 不负责：

- 事实采集
- 修改故事板
- 运行浏览器审计
- 调用本地程序渲染器
- 等待另一个 Agent 补 CSS

## 5. 输入契约

### 5.1 统一输入文件

生成 Agent 应一次读取以下候选工作区文件：

```json
[
  "card-plan.json",
  "ai-visual-card-plan.json",
  "repository-fact-sheet.json / event-analysis.json / custom-fact-sheet.json",
  "social-theme-design-spec.md",
  "social-theme-snapshot.json",
  "copy.txt"
]
```

其中：

- `card-plan.json` 是页面职责、页序和正文事实的权威来源。
- `ai-visual-card-plan.json` 是给视觉 Agent 使用的精简语义索引，不得改变正文事实。
- 原始事实 JSON 只用于解释、补充边界和核对事实。
- `social-theme-design-spec.md` 是主题视觉语言的权威来源。
- `social-theme-snapshot.json` 提供主题版本和运行快照信息，不替代主题 SPEC。
- `copy.txt` 如果生成，则作为已经确定的配套文案输入，不在视觉 Agent 中重新生成。

以下三份资料属于技能内置参考，不放入候选工作区，也不由 Agent 重复读取：

- `xhs-visual-contract.md`：通用 DOM 结构和组件语义；
- `layout-guide.md`：尺寸、安全区、字号、间距和视觉占用目标；
- `visual-component-mapping.md`：事实语义到视觉组件的映射建议。

这样每份资料只有一个来源：候选文件负责本次内容和主题，内置参考负责通用设计规则。

### 5.2 故事板一致性

为便于和本地版、技能生成版比较，AI 视觉生成阶段不执行以下变换：

- 不合并页面
- 不拆分页面
- 不改变页序
- 不执行模板容量重排
- 不重新生成故事板

比较实验必须使用同一份 `card-plan.json` 和同一份事实基座。

### 5.3 主题一致性

主题 SPEC 应提供：

- 颜色语义
- 字体家族
- 背景纹理
- 页面装饰
- 强、中、弱视觉层级
- 主题组件方向
- 主题应避免的视觉退化

主题 SPEC 不提供字号、字重、行高或间距数值；这些排版参数统一由 `skills/social-card-ai-visual-generator/references/layout-guide.md` 决定。`xhs-visual-contract.md` 只提供结构关系和组件语义。

但不再强制：

- 固定页面模板
- 固定组件类名
- 固定 `.page-content-stack`
- 固定 CSS 选择器目录
- 固定圆角、阴影或卡片结构

硬约束只保留安全和事实要求；视觉表达由 Agent 自主决定。375×667 的通用页面骨架和内容栈仍作为与本地版、技能生成版一致的版式基线，但不把主题组件类名或某个主题的圆角、阴影和页面模板固定下来。

## 6. Prompt 设计

### 6.1 Prompt 结构

主 Prompt 采用以下顺序：

```text
角色
→ 任务目标
→ 输入文件职责
→ 视觉设计要求
→ HTML/CSS 输出要求
→ 事实边界
→ 安全边界
→ 完成标准
```

### 6.2 核心任务描述

Agent 的核心任务应明确为：

> 你是这组社交卡片的主视觉设计师和 HTML/CSS 执行者。请先在内部完成整组页面的视觉策划，再一次性写出完整的 `ai-beautified.html`。你需要同时负责主题 CSS、页面背景、装饰、页面结构、组件样式和全部页面 HTML。不要把页面交给另一个 Agent，不要先写一套与页面无关的基础卡片 CSS。

### 6.3 自由发挥边界

允许 Agent 自由决定：

- 组件命名
- 组件横向或纵向构图
- 卡片是否圆角
- 阴影、边框和色块形式
- 数字、步骤、证据和结论的强调方式
- 页面装饰的位置和面积
- 页面之间的节奏变化

必须保持：

- 页数、页序和页面职责不变
- 独立事实不丢失
- 不虚构数字、人物、结论或体验
- 主题装饰在原尺寸下可感知
- 正文可读
- 页面适合 375×667 画布
- 不使用脚本、远程资源或事件处理器

### 6.4 完成标准

Agent 只有在以下条件都满足时才返回完成：

- 已写入完整 HTML 文档
- 所有页面均已生成
- CSS 和 HTML 属于同一套视觉系统
- 主题装饰已经实际落地
- 页面组件不是只有裸类名
- 页面之间存在可解释的视觉节奏

## 7. 工具协议

### 7.1 新增单 Agent 分块写入模式

这里的“完整文档生成”指 Agent 在同一个会话内拥有整份文档的设计责任，
不要求模型在一次响应中输出整份 HTML。为避免超过模型单次输出上限，生成阶段采用
“单 Agent、分块追加”的写入协议。

新增仅允许在生成阶段使用的项目插件能力 `cap_filesystem_project_document_write`：

```json
{
  "type": "tool_requests",
  "requests": [
    {
      "capability": "cap_filesystem_project_document_write",
      "arguments": {
        "operation": "append",
        "sessionId": "<agent-run-id>",
        "requestId": "chunk-001",
        "expectedRevision": 0,
        "path": "<absolute-candidate-path>/ai-beautified.html",
        "content": "<style>...</style>"
      }
    }
  ]
}
```

Agent 可以按以下顺序提交多个分块：

```text
begin
→ append（主题基础 CSS、主题组件 CSS、页面 HTML，可按多个分块）
→ finish
```

CSS 和页面仍然可以分批写入，但它们属于同一个 Single Visual Agent，
不是两个独立 Agent。Agent 在首次写入前必须已经完成整组页面的视觉策划。

当前不提供程序拼接快捷模式；后续如确有需要，`write_full_html` 也只能是插件内部的单次写入封装，不能成为视觉生成 Agent 的默认路径。

### 7.2 分块写入工具的职责

`begin` 创建本次会话的文档容器；`append` 原样追加 Agent 提交的内容；`finish`
关闭文档并保留写入摘要。插件只做以下与视觉无关的确定性检查：

- 写入路径必须位于调用方授权的候选工作目录
- 单块和整份文档不能超过大小上限
- 通过 `revision` 保证分块按 Agent 提交顺序追加
- 通过 `requestId` 支持重复请求幂等
- 返回最终字节数和 SHA-256 摘要

程序不做以下事情：

- 不补 CSS
- 不补页面结构
- 不改类名
- 不调整 gap、padding、字号或颜色
- 不插入主题装饰
- 不替换页面
- 不生成程序化回退页面

### 7.3 旧模式兼容

保留 `append_head_css`、`append_body` 和旧双 Agent 流程，但放入兼容模式：

```text
AI_VISUAL_GENERATION_MODE=single-document   // 默认
AI_VISUAL_GENERATION_MODE=split-agents      // 兼容回退
```

默认只使用 `single-document`，兼容模式仅用于回归和故障定位。

## 8. Pipeline 改造点

### 8.1 Agent 层

在 [`server/features/social-cards/application/social-card-ai-visual-agent.mjs`](../server/features/social-cards/application/social-card-ai-visual-agent.mjs) 中使用：

```js
runSocialCardAiVisualGenerationAgent()
```

该函数负责一次完整的读文件、视觉策划和文档写入，不再调用 `runCssAgent()` 与 `runPageAgent()`。

### 8.2 Beautify 层

在 [`server/features/social-cards/application/social-card-beautify.mjs`](../server/features/social-cards/application/social-card-beautify.mjs) 中：

1. 保留 `aiHtmlScaffold()`，只作为文件初始化容器。
2. 将 `ai-visual-card-plan.json` 加入 `workspaceFiles`。
3. 将 `social-theme-snapshot.json` 加入 `workspaceFiles`。
4. 生成一次 `copy.txt` 后作为只读输入提供给视觉 Agent。
5. 生成阶段改为调用 Single Visual Agent。
6. 首次生成使用分块追加，不执行 CSS Agent/Page Agent 拆分。
7. 生成完成后只执行截图和交付登记；不执行结构门禁、布局审计、AI 修复或内容审计。
8. 生成失败时保留原始 HTML 和诊断，不做程序化修补。

### 8.3 技能层

调整 [`skills/social-card-ai-visual-generator/SKILL.md`](../skills/social-card-ai-visual-generator/SKILL.md)：

- 从“双 Agent 编排契约”改为“单 Agent 整页生成契约”。
- 保留事实、安全、尺寸和可读性边界。
- 删除 CSS 分片和 Page Agent 的强制流程描述。
- 删除固定主题组件类名要求。
- 保留通用页面骨架和内容栈作为生成基线，但不由程序注入或修补；具体主题组件、圆角、阴影和装饰仍由 Agent 自主决定。
- 将页面骨架与主题表达分离：骨架服务稳定的画布、间距和可读性，主题不被固定模板限制；排版和间距数值集中由 Layout Guide 管理。
- 保留主题装饰必须实际可见、不能退化为纯色背景的要求。

### 8.4 Prompt 体量

主 Prompt 应尽量短，把创作任务放在前面，把工具限制放在后面。建议只保留：

```text
任务目标：1 段
输入职责：1 段
视觉要求：5–8 条
事实和安全边界：5–8 条
输出要求：4–6 条
```

详细主题表达放在 `social-theme-design-spec.md`，不要重复塞进系统 Prompt。

## 9. 模型调用策略

为了接近本地版和技能生成版，Single Visual Agent 应统一以下参数：

- 使用与技能生成版相同的 provider 和 model
- 使用与技能生成版一致的温度设置
- 不强制 `thinking: false`
- 提供完整文档所需的输出预算
- 不启用 CSS 分片专用预算
- 不启用页面逐页预算
- 不让模型在每页之间被重新初始化

同一输入和同一模型也不能保证逐字节一致，但应保证生成机制一致，视觉差异只来自模型随机性，而不是 Pipeline 拆分。

## 10. 失败处理

第一阶段的失败处理分为两类。

### 10.1 协议失败

例如：JSON 无法安全恢复、没有写入文件、写入路径错误。仅缺少尾部闭合符且内容完整时由解析器直接恢复；其他协议错误才要求 Agent 重新提交更短的完整写入请求，但不得修改视觉内容。

### 10.2 视觉或结构问题

例如：缺少主题装饰、卡片间距不理想、某个组件样式较弱。第一阶段只记录诊断，不自动修复，不进入布局审计。

## 11. 验证方案

### 11.1 单元测试

- Single Visual Agent 能读取全部工作文件。
- `cap_filesystem_project_document_write` 的 `begin`、`append` 和 `finish` 生命周期可用。
- 分块追加属于同一个 Agent 会话，不重新启动 CSS Agent 或 Page Agent。
- 写入结果必须逐字保留 Agent 提交的 HTML/CSS。
- 不允许调用 `renderStoryboardHtml` 或本地模板渲染器。
- 不允许调用浏览器审计工具。
- 生成失败时不会触发程序化补丁。

### 11.2 集成测试

使用同一份：

- `card-plan.json`
- 事实基座
- 主题 SPEC
- `copy.txt`
- provider/model

分别生成技能版和 AI 版，比较：

- 页面数量和页序
- 主题辨识度
- 装饰可见性
- 强视觉组件使用情况
- 页面之间的节奏
- 组件样式完整度
- 卡片间距和整体留白
- 文案和事实保留情况

### 11.3 验收标准

AI 版达到以下标准即可进入下一阶段：

1. 不再出现 CSS Agent 已写样式但 Page Agent 使用另一套类名的问题。
2. 不再出现内容页只有纯色背景或主题装饰只存在于极低透明度的问题。
3. 不再普遍出现卡片缺少 gap 的问题。
4. 相邻页面能使用不同的主视觉组件或强调方式。
5. HTML/CSS 由一个完整视觉上下文生成。
6. 生成阶段不依赖程序化视觉修补。
7. 与技能生成版的差异主要来自模型随机性，而不是 Agent 编排结构。

## 12. 实施顺序

### 第一步：建立单 Agent 生成模式

- 新增 `runSocialCardAiVisualFullDocumentAgent`。
- 新增并接入 `cap_filesystem_project_document_write` 分块写入插件。
- 默认关闭旧 CSS/Page 双 Agent。
- 保持修复、审计和后置阶段关闭。

### 第二步：统一输入

- 加入 `ai-visual-card-plan.json`。
- 加入 `social-theme-snapshot.json`。
- 固定 `card-plan.json` 和事实文件来源。
- 让视觉 Agent 使用已经生成的 `copy.txt`。

### 第三步：精简视觉技能

- 删除拆分 Agent 的流程要求。
- 删除固定组件类名门槛。
- 保留事实、安全和画布边界。
- 强化“先内部策划，再整页生成”的任务说明。

### 第四步：使用 1080 候选做对照生成

- 同一输入生成技能版和 AI 版。
- 保留原始 HTML、Prompt 快照和输入快照。
- 只做人工视觉对照，不进入审计修复。

### 第五步：再决定是否恢复后置阶段

当前已恢复截图和交付门禁；结构诊断、浏览器审计、AI 修复和内容审计仍保持关闭，待生成质量稳定后再单独评估。

后置阶段不能反向决定生成阶段的视觉结构。

## 13. 结论

本次改造的核心不是继续增加主题 CSS、结构门禁或修复规则，而是恢复完整的视觉上下文：

```text
从双 Agent 拆分生成
改为单 Agent 整页生成
从程序约束组件类名
改为 Prompt 驱动视觉表达
从双 Agent 逐段拼接 CSS/HTML
改为一次性写出完整文档
```

只有先完成这一步，项目里的 AI 视觉生成才有机会达到本地版和技能生成版的效果。
