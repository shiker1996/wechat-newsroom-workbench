# Social 图文 AI 视觉生成 Pipeline + Agent 改造方案

> 状态：AV-0 至 AV-7 已完成
>
> 范围：仅改造 `social-card-beautify` 的 AI 视觉生成链路。
>
> 明确不包含：来源准备、事实基座、故事板生成、程序化图文渲染和故事板内容结构调整。
>
> 最近更新：2026-08-30。当前生成阶段以单 Agent 分块写入为准；截图和交付门禁开启，结构门禁、布局审计、AI 修复和内容审计保持关闭。

## 1. 目标

将 AI 视觉生成收束为由一个 Agent 负责完整视觉设计、由 Pipeline 负责输入准备、截图和交付登记：

```text
已生成故事板
  ↓
单个 AI 视觉 Agent（document_write 分块写入完整 HTML/CSS）
  ↓
截图与交付门禁
```

故事板是只读输入。AI 视觉链路不重新生成、不修改、不补充故事板，也不创建独立叙事文件。

## 2. 固定输入

Pipeline 为候选目录准备本次运行的内容与主题文件，Agent 通过文件工具一次读取：

```text
card-plan.json                 已生成故事板和页面职责
ai-visual-card-plan.json       只读视觉语义索引
原始事实 JSON                  事实和来源边界
social-theme-design-spec.md    当前主题设计规范
social-theme-snapshot.json     主题版本和运行快照
copy.txt                       已生成的配套文案
```

`xhs-visual-contract.md`、`layout-guide.md` 和 `visual-component-mapping.md` 不复制到候选目录，由技能运行时随 Prompt 注入，分别负责通用结构、布局基线和语义组件映射。它们不是本次运行的候选输入，也不由 Agent 重复读取。

输入职责进一步收敛：`layout-guide.md` 是字号、字重、行高和间距数值的唯一来源；`xhs-visual-contract.md` 只描述 DOM 结构和组件语义；`social-theme-design-spec.md` 只描述主题视觉，不定义排版或间距数值；AI 侧的 `social-theme-snapshot.json` 只保留主题运行元数据和容量/形状信息，不暴露程序化字号、行高和间距 token。程序化渲染链路仍可使用完整主题 Token。

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
| `generation` | 单个 AI 视觉 Agent | 读取冻结资料并通过文档分块写入完整 HTML/CSS |
| `screenshots` | Pipeline | 对生成后的 HTML 逐页截图，供人工直接验证视觉产物 |
| `delivery-gate` | Pipeline | 登记 HTML、PNG、报告和阶段记录 |

## 4. Agent 权限边界

### 4.1 AI 视觉 Agent

只开放：

```text
filesystem.project.read
filesystem.project.document_write
```

生成阶段只启动一个 AI 视觉 Agent。它先读取冻结输入，再用 `document_write.begin`、多个 `append` 和 `finish` 原样写入完整 HTML/CSS；分块只解决模型输出长度，不由程序拼接或补写视觉内容。Agent 不调用浏览器审计，也不输出完整 HTML JSON。

`buildAiVisualGenerationBrief()` 只补充本次运行的页数、输入清单、主题标识和 `styleBrief`；固定的视觉、布局、事实和写入规则由技能正文、内置参考和阶段指令分别负责，避免运行时 Prompt 重复定义。

## 5. 审计边界

生成与交付职责分离：

| 能力 | 作用 | 是否判断通过 |
| --- | --- | --- |
| `document_write` | 原样分块写入 AI 视觉 HTML/CSS | 否 |
| `html-pages-to-images` | 把生成后的每个 `.page` 输出为 PNG | 否 |
| `delivery-gate` | 检查 HTML、copy 和 PNG 文件是否完整并登记 | 是 |

全量生成阶段只开放项目读取和文档分块写入能力；截图和交付检查在 Agent 完成后执行，不反馈为自动修复。

## 6. 失败处理

- JSON 仅缺少尾部闭合符且内容完整：解析器按 JSON 结构直接恢复，不再次调用 AI；无法安全恢复或字段不符合协议时，才反馈短请求并要求模型缩短分块；
- 截图失败：只重试截图阶段，不重新调用 AI；
- HTML、copy 或 PNG 文件不完整：交付门禁阻断登记并保留生成产物；
- AI 视觉失败：不自动回退为程序化图文成功结果。

## 7. 阶段实施状态

### AV-0：基线冻结（已完成）

已固定输入、输出、错误分类、回归样本和产物清单。

### AV-1：Pipeline Runtime（已完成）

已接入技能快照、模型快照、工具目录、阶段契约和阶段执行记录。

### AV-2：全量生成 Agent（已完成）

已收束为单个全量 AI 视觉 Agent。Agent 读取冻结输入，通过 `document_write` 的 begin/append/finish 分块原样写入 `ai-beautified.html`，不由程序拼接 CSS 或页面。

每次生成使用新的文档写入会话 ID，避免重试复用旧会话；生成只有同时满足 Agent 正常返回 `final`、文档成功 `finish`、实际页面数与故事板一致时才算完成。

### AV-3：截图和交付登记（已完成）

已恢复截图和轻量交付门禁：生成完成后输出逐页 PNG，并检查 HTML、copy 和 PNG 数量/文件是否完整；截图失败只重试截图，不重新调用 Agent。

### AV-4：技能规范化（已完成）

已同步 `social-card-ai-visual-generator` 的说明、工具权限、输入文件和分块写入协议；技能只负责完整视觉 HTML，截图和交付登记由编排层负责。

同时已将主题设计规范中的 `fontWeight`、`sizeScale` 等程序化默认值从 AI-facing SPEC 移除；视觉契约不再提供组件级字号、字重或间距 CSS 示例，相关数值统一读取 `layout-guide.md`。

### AV-5：前端和回归（已完成）

已补充 AI 视觉阶段状态、失败原因、HTML/PNG/交付报告展示和 AI 视觉运行诊断页；只读接口同步暴露阶段执行记录和交付门禁。已完成离线回归。

## 8. 验收标准

1. 全量生成 Agent 不可见 `browser_inspect` 和 `browser_audit`；
2. 生成阶段只写 CSS 和逐页追加 HTML；
3. 生成完成后执行截图和交付文件检查；
4. 截图失败不重新调用 AI，只重试截图阶段；
5. 交付文件完整后登记交付；
6. 全流程不修改故事板生成逻辑、不修改 `card-plan.json`；
7. 程序化图文和 AI 视觉图文保持两条独立链路。
