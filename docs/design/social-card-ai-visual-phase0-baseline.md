# AI 视觉图文 AV-0 基线与当前进度

> 状态：AV-0 至 AV-7 已完成
>
> 观测日期：2026-08-28
>
> 适用任务：`social-card-beautify`
>
> 主设计：[Social 图文统一内容与视觉生成流程改造方案](./social-card-unified-editorial-visual-pipeline-design.md)

## 1. 基线目的

本基线用于在 AI 视觉 Pipeline 重构前固定当前行为，区分：

- AI 视觉生成链路和程序化图文链路；
- Agent 生成、浏览器观察、确定性审计、截图和交付门禁；
- 模型协议错误、工具预算错误、结构错误和真实布局错误。

本阶段不改变生成算法、不启动服务、不切换默认实现。

## 2. 当前入口和边界

| 项目 | 当前基线 |
| --- | --- |
| 任务入口 | `social-card-beautify` |
| 代码入口 | `server/features/social-cards/application/social-card-beautify.mjs` 的 `runSocialCardBeautify` |
| 程序化入口 | `runSocialCardPipeline` |
| AI Agent 入口 | `social-card-ai-visual-generation`；兼容修复阶段仍使用 `social-card-ai-visual` |
| AI 输出 | `ai-beautified.html`、`ai-beautified-output/` |
| 程序化输出 | `my-design.html`、`output/` |
| 页面写入 | Agent 调用 `filesystem.project.write` |
| 浏览器观察 | `content.social_card.browser_inspect`，仅兼容审计修复 Agent 可见 |
| 确定性审计 | `content.social_card.browser_audit`，仅兼容审计修复 Agent 可见；全量生成 Agent 不可见 |
| 失败回退 | 不生成程序化回退页面 |

## 3. 当前实际流程

```text
准备 fact-sheet/card-plan/主题 SPEC/Layout Guide
  ↓
创建最小 ai-beautified.html 文件
  ↓
全量生成 Agent
  ├─ 读取四份文件
  ├─ set_head 写 CSS
  └─ append_body 逐页写入
  ↓
生成结构门禁
  ↓
兼容审计修复 Agent
  ├─ browser_audit
  ├─ browser_inspect
  └─ replace_pages 单页修复
  ↓
PNG 渲染
  ↓
最终整组布局审计
  ↓
登记 AI 视觉产物
```

当前已具备“生成阶段先完成全部页面，再进入审计阶段”的运行时保护。AV-2 已将全量生成和兼容审计修复拆成两个 Agent 会话；AV-3 已增加结构门禁和一次全量恢复；AV-4 已改为 Pipeline 审计与单页修复 Agent 闭环。

## 4. 固定回归样本

第一批回归样本固定为：

| 样本 | 用途 | 必须观察 |
| --- | --- | --- |
| C004 | 事件图文、价格/性能关系 | 数字卡、对比关系、文字可见性、单页修复 |
| C005 | 事件图文、多页布局 | 页数守恒、生成阶段完整性、页面间隔 |
| C011 | 仓库工具图文 | 工具内容输入、仓库/事件类型不混淆 |
| 一个已有仓库候选 | 程序化与 AI 双链路对照 | 事实输入、主题 SPEC、组件和截图产物 |

样本复跑时必须保存：

```text
fact-sheet.md
card-plan.json
social-theme-design-spec.md
layout-guide.md
my-design.html（如存在）
ai-beautified.html（如存在）
layout-report.json（如存在）
ai-beautified-layout-report.json（如存在）
ai-beautify-report.json（如存在）
Agent 模型调用记录
Agent 工具调用记录
```

实际候选目录中的历史文件不作为不可变 fixture 修改；回归测试使用临时目录或复制后的样本，避免污染用户现有采集结果。

## 5. 统一错误分类

错误分类由 `server/features/social-cards/application/social-card-ai-visual-baseline.mjs` 提供，当前分类为：

| 分类 | 典型错误 | 基线阶段 |
| --- | --- | --- |
| `inputs` | 四份输入缺失、读取失败、来源资料不可用 | inputs |
| `model-json-truncated` | `MODEL_JSON_TRUNCATED`、JSON 结构未闭合 | Agent |
| `agent-budget` | 模型步骤预算、工具调用预算、总耗时预算 | Agent |
| `generation-structure` | 根节点缺失、HTML 不完整、危险结构 | generation-gate |
| `page-count` | 页面数量改变、页码无效、缺页 | generation-gate |
| `layout-audit` | 溢出、裁切、字号、文字不可见、利用率、垂直失衡 | audit-repair/final-audit |
| `screenshots` | PNG 渲染、截图目录或图片生成失败 | screenshots |
| `delivery-gate` | 报告、Artifact 登记或交付状态失败 | delivery-gate |
| `unknown` | 暂时无法归类的错误 | unknown |

分类函数只做观测归类，不改变错误处理策略；阶段状态和技能快照已由 AV-1 接入 Pipeline 报告。

## 6. 当前产物观测

AI 视觉运行开始时会写入：

```text
ai-visual-baseline.json
```

其中记录：

- 候选、批次、内容类型、渠道和主题；
- 故事板页数和目标页数；
- 当前生成/修复是否共用 Agent；
- `browser_inspect`、`browser_audit` 和最终审计的当前边界；
- 输入、HTML、布局报告、截图目录等产物是否存在；
- 可归类的失败类型。

文件只用于基线和诊断，不参与生成输入，不改变页面内容，也不作为交付产物。

## 7. AV-0 验收结果

- 已确认程序化图文入口与 AI 视觉入口不同；
- 已确认两条链路输出目录和 HTML 文件不同；
- 已固定 C004、C005、C011 和仓库样本为第一批回归对象；
- 已建立模型、工具、结构、布局、截图和交付错误分类；
- 已建立 AI 视觉输入和输出产物清单；
- 已记录当前“生成与修复共用 Agent”的事实基线；
- 已补充自动化产物观测函数和基线文件写入；
- 未启动服务，未改变当前默认生成逻辑。

## 8. 下一阶段入口

AV-1 至 AV-7 已完成：AI 视觉流程已经具备正式阶段契约、技能运行快照、阶段执行记录、独立的全量生成 Agent、生成结构门禁、Pipeline 控制的单页审计修复闭环、最终审计、截图完整性和交付门禁、统一技能文档与运行时工具协议，以及前端阶段诊断展示和离线回归覆盖。未启动服务验证。
