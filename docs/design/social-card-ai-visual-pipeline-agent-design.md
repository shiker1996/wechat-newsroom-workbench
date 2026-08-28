# Social 图文 AI 视觉生成 Pipeline + Agent 改造方案

> 状态：AV-0 至 AV-7 已完成
>
> 范围：仅改造 `social-card-beautify` 的 AI 视觉生成链路。
>
> 明确不包含：来源准备、事实基座、故事板生成、程序化图文渲染和故事板内容结构调整。

## 1. 目标

将 AI 视觉生成从“一个 Agent 生成、审计、修复全包”改为由 Pipeline 管理阶段、由 Agent 执行有限任务：

```text
已生成故事板
  ↓
CSS Agent → 页面 Agent
  ↓
生成结构门禁
  ↓
程序布局审计 → 单页修复 Agent → 程序复核
  ↓
最终整组审计
  ↓
截图与交付门禁
```

故事板是只读输入。AI 视觉链路不重新生成、不修改、不补充故事板，也不创建独立叙事文件。

## 2. 固定输入

Pipeline 为候选目录准备四份文件，Agent 通过文件工具读取：

```text
fact-sheet.md                  事实和来源边界
card-plan.json                 已生成故事板和页面职责
social-theme-design-spec.md    当前主题设计规范
layout-guide.md                通用页面结构和排版规范
```

另传少量运行参数：

```json
{
  "channelMode": "xiaohongshu",
  "requiredPageCount": 6,
  "outputHtml": "ai-beautified.html"
}
```

不重复传入完整事实、故事板、组件词汇表、程序化构图、页面壳或冗长 `aiDesignContract`。

## 3. 阶段职责

| 阶段 | 执行者 | 主要职责 |
| --- | --- | --- |
| `inputs` | Pipeline | 准备输入文件、冻结技能/模型/工具快照 |
| `generation` | CSS Agent + 页面 Agent | 分两个独立循环读取资料，先写 CSS，再逐页写入完整页面 |
| `generation-gate` | Pipeline | 检查 HTML 根节点、页数、页码、安全结构 |
| `audit-repair` | Pipeline + 单页修复 Agent | 审计问题页，生成明确修复指令，单页修复并复核 |
| `final-audit` | Pipeline | 执行整组浏览器布局审计 |
| `screenshots` | Pipeline | 仅对最终通过的 HTML 截图 |
| `delivery-gate` | Pipeline | 登记 HTML、PNG、报告和阶段记录 |

## 4. Agent 权限边界

### 4.1 CSS Agent 与页面 Agent

只开放：

```text
filesystem.project.read
filesystem.project.write
```

生成阶段拆为两个独立的 Agent 循环，顺序固定为：

1. CSS Agent 读取四份输入文件；
2. CSS Agent 使用 `set_head` 和 `append_head_css` 写入全局 CSS；
3. CSS Agent 返回本阶段短 JSON 确认，Pipeline 检查 CSS 文件状态；
4. 页面 Agent 读取工作文件和当前 HTML；
5. 页面 Agent 使用 `append_body` 逐页写入完整 `.page`；
6. 达到目标页数后返回本阶段短 JSON 确认，Pipeline 检查页面状态。

CSS Agent 和页面 Agent 都禁止调用浏览器审计、浏览器观察、`replace_pages`，也禁止把完整 HTML 放进 JSON。CSS Agent 禁止 `append_body`，页面 Agent 禁止修改全局 CSS。模型确认只是阶段完成信号，文件状态和结构门禁才是最终依据。

### 4.2 单页修复 Agent

由 Pipeline 在审计失败后启动，只接收：

- 目标页编号；
- 目标页当前 HTML；
- 当前主题和 Layout Guide 的必要规则；
- 程序生成的 `repairInstructions`；
- 允许的写入路径和模式。

修复 Agent 只能修改当前问题页，不能改页数、页面职责、事实、来源或其他页面。

## 5. 审计边界

浏览器观察、确定性审计和修复职责分离：

| 能力 | 作用 | 是否判断通过 |
| --- | --- | --- |
| `browser_inspect` | 返回指定页真实 DOM、计算样式和边界 | 否 |
| `browser_audit` | 按规则检查溢出、裁切、字号、可见性、利用率和对比度 | 是 |
| 修复 Agent | 根据程序修复指令修改目标页 | 否 |

全量生成阶段不可见审计能力。AV-2 期间暂保留旧的兼容审计修复 Agent；AV-4 将其替换为 Pipeline 控制的单页修复流程。

## 6. 失败处理

- JSON 截断：只反馈短 JSON 修复请求，不重新传入 HTML；
- 生成结构失败：停在 `generation-gate`，不进入布局修复；
- 页面数量错误：保留草稿和诊断，不启动逐页审计；
- 单页布局失败：只重试当前问题页，达到上限后停止；
- 最终审计失败：不生成或登记正式 PNG；
- AI 视觉失败：不自动回退为程序化图文成功结果。

## 7. 阶段实施状态

### AV-0：基线冻结（已完成）

已固定输入、输出、错误分类、回归样本和产物清单。

### AV-1：Pipeline Runtime（已完成）

已接入技能快照、模型快照、工具目录、阶段契约和阶段执行记录。

### AV-2：全量生成 Agent（已完成）

已将全量页面生成从旧审计修复 Agent 中拆出，并进一步拆为 CSS Agent 和页面 Agent 两个独立循环。两个 Agent 只读文件和写文件，不可见浏览器审计工具；CSS 阶段先写样式，页面阶段再写入 `ai-beautified.html`。

### AV-3：结构门禁和生成恢复（已完成）

已完善根节点、页数、页码、空页面、内部字段和截断 HTML 检查；结构失败时最多执行一次全量生成恢复，恢复仍失败则保留草稿和诊断，不进入布局修复。

### AV-4：Pipeline 审计和单页修复（已完成）

已将实际路径改为“程序审计 → 单页修复 Agent → 程序复核”；修复 Agent 不可见 `browser_audit`，每次只处理一个问题页，并在页面无变化或问题签名不变时停止。

### AV-5：最终审计和交付门禁（已完成）

已统一最终整组布局审计、截图完整性和交付状态；最终审计失败会跳过 PNG，截图失败只重试截图，不重新调用 Agent，并保留诊断产物。

### AV-6：技能规范化（已完成）

已同步 `social-card-ai-visual-generator` 的说明、工具权限、输入文件、分阶段写入协议和返回示例：CSS Agent 只写样式，页面 Agent 只追加页面；修复 Agent 只处理一个目标页；`browser_inspect` 仅用于观察；`browser_audit` 仅由 Pipeline 调用；阶段 `final` 不再冒充最终交付通过。

### AV-7：前端和回归（已完成）

已补充 AI 视觉阶段状态、当前修复页、失败原因、保留 HTML/报告展示和 AI 视觉运行诊断页；只读接口同步暴露阶段执行记录、结构门禁、单页修复报告和交付门禁。已完成离线回归，未启动服务。

## 8. 验收标准

1. 全量生成 Agent 不可见 `browser_inspect` 和 `browser_audit`；
2. 生成阶段只写 CSS 和逐页追加 HTML；
3. 生成完成后才执行结构门禁和布局审计；
4. 审计修复只修改目标页；
5. 最终审计通过后才截图和登记交付；
6. 全流程不修改故事板生成逻辑、不修改 `card-plan.json`；
7. 程序化图文和 AI 视觉图文保持两条独立链路。
