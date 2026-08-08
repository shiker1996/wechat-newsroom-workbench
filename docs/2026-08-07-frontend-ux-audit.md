# 前端交互、布局与设计问题审查报告

- 日期：2026-08-07
- 范围：`public/index.html`、`public/styles.css`、`public/src/main.js`、`public/src/core/*`、`public/src/views/*`（全部 25 个视图文件）
- 方式：静态代码审查（未运行页面验证运行期行为，个别与时序相关的条目已标注）

问题按严重程度分组，每条注明文件与行号（基于审查时的工作区状态，行号可能随后续改动漂移）。

---

## 一、高严重度（可能导致数据丢失、操作失效或明显故障）

### 数据安全与错误吞噬

1. **文档加载失败被当作"无文档"，存在覆盖风险** — `src/views/editor.js:527-528`。`loadSelectedDocument` 的 `catch {}` 把网络/服务端错误当作空文档处理，编辑器填入模板 `# 标题`；草稿自动保存（`editor.js:49-52`）一旦触发，PUT 会用模板内容覆盖服务端已有文稿。建议：失败时 toast 报错并保留旧内容。
2. **恢复备份后不刷新前端状态** — `src/views/system.js:120-142`。恢复替换了全部工作区数据，但内存中的 `state.batches`、`state.subscriptions`、模型列表全部过期，用户继续在旧数据上操作。建议：恢复成功后 `location.reload()` 或重载全部视图数据。
3. **`createBatch` 无错误处理、无防重复提交** — `src/views/batch-drawer.js:43-55`。同文件 `createBreakingBatch` 有 try/catch + 禁用按钮，`createBatch` 两者皆无：接口失败静默无反馈，双击/回车可创建重复批次。建议对齐 `createBreakingBatch` 写法。
4. **视图加载失败完全静默（死按钮）** — `src/main.js:81-84`。动态 `import()` 失败只 `console.error`，点击导航后页面停在原视图无任何提示。建议失败时 toast。
5. **`request()` 对空/非 JSON 响应直接抛错** — `src/core/http.js:4-9`。无条件 `response.json()`，遇 204、HTML 错误页或空 body 抛 `SyntaxError`，错误信息不可读；GET 也强制带 `content-type: application/json`。建议按状态码/content-type 判断后再解析。
6. **轮询完成后对已打开的 `<dialog>` 再次 `showModal()` 抛异常** — `src/views/batch-drawer.js:128, 314`。任务完成后走 `openBatch()`，若抽屉仍打开，`showModal()` 抛 `InvalidStateError`，并以技术性报错 toast 给用户。建议 `if (!dialog.open) dialog.showModal()`。

### 不可逆操作缺确认 / 反馈承诺未兑现

7. **「重新生成整组图文」无确认，直接覆盖已有交付物** — `src/views/social-editor.js:225, 348`。对比 `editor.js:651` 恢复版本有 `confirmAction`，标准不一。
8. **重新生成封面无确认** — `src/views/cover.js:94-103`。状态文案自己写明"可重新生成覆盖"（cover.js:70），说明覆盖是已知破坏性操作，却无确认。
9. **「保存失败 · 点击重试」是不可点的死文案** — `src/views/editor.js:694`。该状态节点全文件无任何 click 处理器。建议绑定重试或改文案。
10. **故事板逐页编辑在重渲染时静默丢失** — `src/views/social-editor.js:266, 305, 326-328`。切换整组版式/视觉主题/渠道/逐页版式会全量重建 DOM，`<details>` 编辑器中未保存的修改被清空，无警告。
11. **生成故事板失败时清空现有故事板视图** — `src/views/social-editor.js:191`。catch 分支 `renderCardPlan([])` 把已有计划替换成空态，视觉上像被删了。建议失败时恢复原内容。
12. **批量替换无确认且破坏撤销栈** — `src/views/editor.js:592-601`。`replaceAll` 整体赋值 `editor.value`，无确认、无预览，且清空浏览器原生撤销历史。

### 布局与样式失效

13. **多个 CSS 变量未定义却被引用，样式静默失效** — `styles.css` 中 `--cream`、`--mono`、`--serif`、`--soft`、`--accent`、`--paper-soft` 0 处定义，被引用于 `:404`（整条 font 缩写作废）、`:132`、`:55`、`:914`、`:746` 等。var() 无回退值，属性直接失效且无报错。
14. **移动端媒体查询被内联样式击穿** — `src/main.js:43` 用 `bs.style.display="block"` 控制批次切换器，`styles.css:509` 的 `@media(max-width:760px){.batch-switcher{display:none}}` 永远失效。建议改用 class 切换。
15. **大量 7–10px 文字，低于可读下限** — `styles.css:37, 40, 159`（7px）、`:256`（10px）、`:27`（8px）等遍及全局，另有 `topics.js:122,127` 内联 `font-size:9px`。系统性可读性/可访问性问题，建议正文信息不低于 11–12px。

### 轮询与资源泄漏

16. **多处轮询无超时上限、无退避、无视图切换清理** —
    - `src/views/daily.js:98-111`：`while(true)` 固定间隔轮询，无上限；离开视图后 `getElementById("daily-job-status")` 为 null 会抛 TypeError。
    - `src/views/tutorial.js:246-263`、`src/views/cover.js:77-92`：无限循环，job 卡死时按钮永久 loading；cover 轮询失败 `catch(()=>{})` 后状态停留在"正在生成…"死状态。
    - `src/views/editorial.js:473-492`：轮询无法取消，与 `editor.js:733` 的 `clearTimeout(state.jobTimer)` 还会互相清掉对方的轮询。
    - `src/main.js:159-172`：每 4s 固定轮询 `/api/jobs`，失败后照常再排期；`jobNoticeState` Map 永不清理；标签页隐藏时不暂停。
    建议：统一轮询工具（超时上限 + 指数退避 + 视图卸载清理）。
17. **新增订阅无表单校验** — `src/views/subscriptions.js:110-118`。不检查空值、URL 格式、重复订阅；界面有"测试"按钮但提交时不引导先测试。
18. **删除模型配置无影响提示** — `src/views/system.js:299-312`。删除默认模型时不提示将回退到哪个模型。
19. **产物/日历预览 iframe 无加载态与错误兜底** — `src/views/artifacts.js:20-29`、`src/views/calendar.js:31`。iframe 直接设 src，404 时对话框直接渲染后端错误页；关闭对话框不清 `iframe.src`，大文件后台继续加载且下次打开闪现旧内容。calendar 还硬编码 `my-design.html` 路径。
20. **图文画廊翻页按钮可能永久失效** — `src/views/social-editor.js:324`。监听器在模块顶层 `if(!window.__socialDeliveryBound)` 块内绑定且用 `?.` 静默跳过，若绑定时机 DOM 未就绪即为死按钮（与加载时序相关，需运行期复核）。建议改为 document 级事件委托。

### 2026-08-08 修复记录（#7、#8、#10、#11、#20）

- #7：`social-editor.js` 生成按钮点击处理器在已有交付物（`delivery.ready`）时先 `confirmAction`，确认后才入队重新生成。
- #8：`cover.js` 以模块变量 `coverExists` 记录当前封面状态（`loadCoverState` 内更新），`generateCover` 在封面已存在时先 `confirmAction`。
- #10：**取舍**——采用「重建前检测未保存修改并 confirmAction 警告」，而非「收集编辑并在重建后恢复」。原因：逐页编辑器含可增删的动态内容块列表，快照/还原实现复杂且易与保存后的服务端数据不一致；警告方案最小且与项目内其他破坏性操作确认模式一致。实现：模块变量 `storyboardDirty`，编辑器内 `input` 事件、增删内容块、切换块类型时置位，`renderCardPlan` 重建时复位；整组版式、逐页版式、构图模式、渠道四个会触发重建的变更在提交前检查，用户取消则回退下拉值。视觉主题切换不重建 DOM，无需拦截。
- #11：`runStoryboard` catch 分支由 `renderCardPlan([])` 改为 `renderCardPlan(currentCardPlan, currentLayoutDecisions)`，失败时恢复原故事板内容，toast 标为 error。
- #20：画廊上一张/下一张按钮改为 `__socialDeliveryBound` 块内 document 级 click 委托，删除顶层 `?.` 绑定，避免 DOM 未就绪时死按钮。

---

## 二、中严重度（体验受损、反馈缺失或一致性破坏）

### 静默失败与加载态缺失

21. **多处 `catch {}` 静默吞错** — `src/views/topics.js:116,139`（排行榜加载）、`batch-drawer.js:83`（突发分析）、`src/main.js:90-94`（模型列表，失败后所有模型下拉变空白且无原因提示）、`src/views/preview.js:332`（图片工作台，无法区分网络错误与无配图）。建议至少降级提示。
22. **列表/图谱请求期间无 loading 指示** — `src/views/hotspots.js:21`、`topics.js:53`、`atlas.js:197`。
23. **复制反馈文案张冠李戴** — `src/main.js:129`。`[data-copy]` 无论复制什么都 toast"启动命令已复制"，且 `writeText` 无 `.catch`。
24. **「检查采集环境」按钮名不副实** — `index.html:90`。文案是检查，实际只做 `go("system")` 跳转（`system.js:11`）。
25. **toast 无类型区分、时长一刀切** — `src/core/ui.js:12-16`。成功/失败同样式、固定 2600ms，长错误读不完。

### 交互一致性问题

26. **原生 `confirm`/`prompt` 与自定义 `confirmAction` 混用** — `editor.js:57`、`editorial.js:48`、`atlas.js:356,381`、`theme-manager.js:66` 用原生弹窗，其余删除/归档用自定义对话框。建议统一走 `confirmAction`。
27. **危险操作确认粒度不一** — 批次删除/归档/重打标有确认，但 `confirmBreakingRoute`（batch-drawer.js:251-257，不可逆写入选题池）、"加入候选"、daily"清空已选"（daily.js:146）无确认。
28. **上传 CDN / 生成图片等按钮无防重复点击** — `preview.js:41-43, 370-383`（与 `[data-generate-image]` 的 withLoading 标准不一）；订阅开关连续点击产生并发 PATCH，响应顺序不保证（`subscriptions.js:119-125`）。建议请求期间 disable。
29. **编辑室表单无离开保护** — `editorial.js` 只在切换候选时 confirm，导航跳走/关闭页面无拦截；`editor.js:842` 为编辑器绑了 `beforeunload`，两处行为不一致。
30. **标题输入框静默改写正文 H1** — `editor.js:803-811`。单向同步，用户正文中不同的 H1 会被无声覆盖。建议仅在两者原本一致时同步。
31. **插入图表后禁用了错误的按钮** — `editor.js:156`。`card?.querySelector("button")` 选中的是「忽略」而非「插入文章」。建议用 `[data-insert-visual]` 选择器。
32. **"打开批次"按钮无独立事件，靠整行冒泡** — `dashboard.js:34-38`。点卡片任意位置（包括选择文本）都打开抽屉，按钮语义虚设；要么按钮独立绑定，要么明确整卡可点并加 `role="button"`/键盘支持。
33. **`<span style="cursor:pointer">` 模拟可点击元素，键盘不可达** — `editorial.js:269`、`social-editor.js:135`、`calendar.js:77`；`atlas.js:246` 的 SVG 节点仅靠 `<title>`。建议改用 `<button>` 或补全 ARIA/键盘事件。
34. **筛选 tab 可访问性标注不一致** — atlas tab 有 `aria-pressed`（`index.html:145,151`），批次状态（:517-521）、来源筛选（:784-789）、日志类型（:837-841）等同类 tab 全无；skills.js:163 的选项卡用 `aria-pressed` 而 system.js:149 用 `aria-selected`，两种模式并存。建议统一 `role="tab"` + `aria-selected`。
35. **RSSHub KV 行删除交互隐晦** — `system.js:41-52, 191-199`。已有行点"删除"仅加 class 标记、保存才生效，且无"有 N 项待删除"提示；新行删除文案 `×` 与已有行"删除/撤销"不一致。

### 布局与响应式

36. **硬编码视口高度导致嵌套滚动** — `styles.css:278`（`.writing-desk{height:calc(100vh - 275px)}`）、`:274`、`:286`（iframe 650px）、`.editorial-messages{max-height:390px}`。矮屏下页面滚动 + 多个内部滚动条嵌套。
37. **日期比较混用本地时区与 UTC** — `dashboard.js:22-23`、`calendar.js:48`。负时区用户会看到日历条目落到前一天、近 7 天批次漏算。建议统一本地日期解析。
38. **维度命名跨视图不一致** — 同一维度 `what` 在 topics 显示"对比"（topics.js:79）、daily 显示"动作"（daily.js:14）、atlas 两套词典（atlas.js:129-130）。建议抽共享维度词典常量。
39. **字数目标魔法数字互相矛盾** — `index.html:411` 硬编码 "0 / 2000"，`:451` 硬编码 "目标 1,500 字"，同一视图两个默认目标不一致。

### 状态管理

40. **模型配置双入口、状态不同步** — `models.js`（缓存到 `window.__models`）与 `system.js` 模型管理（模块级 `runtimeModels`）是两份重复 UI，用户难以判断去哪边改配置；`models.js:32` 未配置 `maxOutputTokens` 时渲染字面 "undefined"。
41. **更新任何工具状态后全量重拉并重渲染** — `skills.js:152,271,288,...`。勾选/改优先级都全量重建 DOM，输入焦点随之丢失。建议局部更新。
42. **教程 `candidateId` 跨项目残留** — `tutorial.js:296,307`。模块级变量从不重置，新建写作可能走 retry URL 指向旧候选。
43. **AI 主题生成中关闭创建器，候选面板残留** — `theme-manager.js:47`。
44. **排行榜展开/收起状态重载后失同步** — `topics.js:104-114,137`。文案与实际 display 状态脱节。
45. **图片放大遮罩监听泄漏且无可访问性** — `preview.js:158-168`。点击关闭不移除 document 级 Esc 监听（反复放大累积）；无 `role="dialog"`、无关闭按钮、焦点不进入遮罩。
46. **订阅健康点阵算法与注释矛盾** — `subscriptions.js:46-68`。注释写"固定50个"代码是 `maxDots = 100`；3 个来源也显示 100 点，点数与真实数量不对应，易误导。
47. **质量检查跳转用行高估算会跑偏** — `editor.js:324`。长段落自动换行时严重偏移；`jumpToHeading` 已有精确实现（`editor.js:405`）可复用。
48. **「检查中」toast 噪音** — `system.js:378,423` 一次操作两条 toast；`social-editor.js:325-328` 每个下拉变更都弹成功 toast。建议成功静默、仅失败提示。
49. **技能搜索、atlas 筛选输入无防抖** — `skills.js:48`、`atlas.js:44-47`。每次按键全量重渲染。
50. **每次切换候选都重新请求 /api/models** — `editorial.js:166` 无缓存（editor.js:701 的 `ensureModelOptions` 有缓存模式可复用）。
51. **批次归档模式靠 h3 中文文本匹配隐藏区块** — `batch-drawer.js:129-138`。任何文案微调都会让归档视图泄漏可操作的采集/AI 按钮。建议加 `data-section` 稳定标识。
52. **主题预览 iframe `sandbox="allow-same-origin"` + srcdoc 注入服务端 HTML** — `theme-manager.js:30,33`。本地工具风险可控，仍建议收紧 sandbox 或加 CSP。

---

## 三、低严重度（代码质量与维护性）

53. **死代码** — `styles.css` 约 266/267 行 `.editorial-layout`/`.candidate-sidebar` 重复定义两遍，前段整段被覆盖；`preview.js:268` `gotoCoverBtn.disabled = false` 无条件强制启用；`models.js:1` 未使用的 `$`/`$$` import；`theme-manager.js:22` 无意义三元 `reset=true?'...':''`。
54. **压缩单行代码** — `index.html:335,747` 数千字符单行；`theme-manager.js` 全文 68 行每行数百字符；`social-editor.js:92-94,324-328`、`topics.js:132-147` 突然压缩。review/diff 极困难，建议统一格式化。
55. **重复实现** — `escapeHtml` 三份（`core/ui.js:2`、`core/theme-catalog.js`、`skill-selection.js`，行为已开始分化）；`editorial.js:361-429` 与 `social-editor.js:380-420` 流式对话逻辑几乎逐行重复（建议抽 `streamChat()`）；`submitSkillZip`（skills.js:237-243）与 system.js 备份上传绕开 `request()` 各写一遍 fetch。
56. **`document.execCommand` 已废弃仍在用** — `editor.js:607`（undo/redo，且无条件标脏）、`preview.js:422`。
57. **魔法数字散落** — 自动保存 1200ms（editor.js:52）、F≥55 成稿线在 editorial 与 topics 各写一份、图片 8MB 上限（preview.js:355）、atlas 尺寸/缩放步进不一致（1.2 vs 1.12，atlas.js:72,106）、日志 limit=150、轮询间隔 1500/1800/1200 多处各异。建议集中到常量。
58. **字符统计正则误伤连字符** — `editor.js:210`。`.replace(/[*_`>#-]/g,"")` 删除正文所有 `-`（"端到端"、"well-known"），字数统计偏少。
59. **重复段落 offset 定位错误** — `editor.js:245-247`。`indexOf` 对内容相同的重复段落算错 offset，点击"段落过长"跳到第一处。
60. **数据属性值经 escapeHtml 后与原始值比较失配** — `daily.js:47,57,135`。key 含 `&`/`"` 时选项变死按钮。
61. **`node.className = ""` 清空容器类** — `dashboard.js:33`。与空态设 `className="empty-state"` 不对称，建议 classList。
62. **外链缺 `rel="noopener"`、死链接 `href="#"`** — `hotspots.js:27`、`atlas.js:298`；无 URL 时渲染可点的 `#` 会滚到页顶。
63. **占位符泄露开发者本机路径** — `index.html:228` placeholder 写死 `E:\Documents\write-assistant`。
64. **内联样式散落** — `index.html:861-862`、`topics.js:122,127`、`batch-drawer.js:87`、`calendar.js:77`，与样式体系脱节。
65. **文案不一致** — 技能停用确认两处不同（skills.js:317 vs :333）；"删除连接"/"卸载"术语漂移（skills.js:115 vs :293）；筛选"第三方"与标签"已安装"混用；`label.firstChild.textContent` 依赖 DOM 首节点是文本节点（subscriptions.js:15-23），结构微调即静默失效。
66. **行尾与代码风格不统一** — `batch-drawer.js`、`daily.js` 为 CRLF（其余 LF）；`var`/`const`、分号省略与保留混杂（preview.js:207-209 等）。
67. **时间字符串假设 ISO 格式** — `daily.js:82`、`batch-drawer.js:273`。非 ISO 输入会显示乱码。
68. **日志视图无自动刷新、无详情展开** — `logs.js:30` 截断 200 字符后无法看全文，排障信息不足。
69. **z-index 无体系** — toast 40、paper-noise 20、rail 10、sticky 8/7/3/2 混用，纯靠碰巧不冲突。
70. **`.map(escapeHtml)` 直传多参** — `topics.js:87`。当前碰巧可用，属隐患写法，建议 `.map(x => escapeHtml(x))`。
71. **全局 document 级事件委托长期存活** — `subscriptions.js:143-159`、`artifacts.js:20-28`。同名 data 属性在其他视图复用时会被意外处理。
72. **批次切换器初始无 option** — `index.html:88`。`go()` 先显示、dashboard.js:24 之后才填充，非 dashboard 首屏会看到短暂空 select。
73. **表单校验缺失** — `batch-drawer.js:30-33` 突发专题 URLs 不校验合法性；`createBatch` 日期/标题无前端校验。

---

## 四、优先修复建议

按投入产出比，建议优先处理：

1. **数据安全类**：#1（文档覆盖风险）、#2（恢复备份状态过期）、#3（createBatch）、#12（批量替换不可逆）。
2. **统一基础设施**：封装带错误处理/类型/时长的 `request()` 与 toast（#5、#25）；统一轮询工具（#16）；统一 `confirmAction`（#26、#27）。
3. **样式系统修复**：补齐未定义 CSS 变量或加回退值（#13）、消灭 7–10px 文字（#15）、修复移动端媒体查询（#14）。
4. **一致性收口**：维度词典共享（#38）、模型配置双入口合并（#40）、格式化压缩单行文件（#54）。

> 注：审查同时确认了一些做得对的地方——`confirmAction` 与 `method="dialog"` 表单模式配合正确；导航 hash 与 pushState 防重入处理得当；用户可控字段基本都过了 `escapeHtml`，未发现明显 innerHTML 注入点（例外见 #52）；atlas 的 `wheel` 监听绑在容器上而非 innerHTML 节点，重渲染不丢监听。

## 事项状态总览（2026-08-08 更新）

- **已修复（33 项）**：
  - 数据安全：#1 #2 #3 #12
  - 基础设施：#4 #5 #14 #16 #25
  - 样式系统：#13 #15
  - 高严重度收尾：#6 #7 #8 #9 #10 #11 #17 #18 #19 #20
  - 静默失败/加载态：#21 #22 #23 #24
  - 一致性/去重：#26 #27 #37 #38 #40 #54 #55
- **未处理（中严重度，22 项）**：#28–#36、#39、#41–#52（防重复点击、离开保护、标题改写 H1、假按钮可访问性、tab 标注统一、KV 行删除交互、嵌套滚动、字数目标矛盾、状态管理一组等）
- **未处理（低严重度，18 项）**：#53、#56–#72

## 修复记录（2026-08-08，#1–#25、#37–#40、#54–#55）

### 第一轮：优先修复建议四组（#1 #2 #3 #5 #12 #13 #14 #15 #16 #25 #38 #40 #54）

- **#1**：`editor.js` loadSelectedDocument catch 改为 toast 报错并 `return` 保留现有内容，不再填模板覆盖服务端文稿。
- **#2**：`system.js` 恢复备份成功后 toast 提示并 `location.reload()`。
- **#3**：`batch-drawer.js` createBatch 对齐 createBreakingBatch：try/catch + toast + 提交期间禁用按钮。
- **#12**：`editor.js` replaceAll 先统计匹配数并 `confirmAction` 确认（提示不可撤销），无匹配直接提示返回。
- **#5**：`core/http.js` request() 重写——GET 不带 content-type；204/空 body 返回 null；按响应 content-type 解析；HTML 错误页抛 `HTTP <status>：摘要`。
- **#25**：`core/ui.js` toast 支持 success/info/error 类型（error 4500ms），styles.css 补类型样式。
- **#16**：新增 `core/poll.js`（指数退避 + 超时上限 + 可取消），迁移 daily/tutorial/cover/editorial/main.js 五处轮询；cover 失败死状态消除；editorial 不再共用 `state.jobTimer`；main.js 后台轮询失败退避、标签页隐藏暂停、jobNoticeState 定期清理。
- **#14**：批次切换器显隐改 `visible` class 切换，移动端媒体查询恢复生效。
- **#13**：`:root` 补齐 `--serif/--mono/--cream/--paper-soft/--soft/--accent` 六个变量，取值均复用现有设计体系。
- **#15**：styles.css 全部 7–10px 字号提升至 11px（仅主题目录微缩预览保留 10px）；topics.js 内联 9px 同改。
- **#38**：新增 `core/dimensions.js` 共享维度词典，topics/daily/atlas 统一为 `who→主体 / what→动作 / where→场合`（与后端 DIMENSION_POOL_ROLES 口径一致，topics 的"对比"改为"动作"）。
- **#40**：system.js 保留为唯一模型管理入口，models 视图加跳转按钮；`loadModelSettings()` 同步刷新 `state.models`/`window.__models`；models.js "undefined" 字面量修复（改"默认"）。
- **#54**：index.html 两处、theme-manager.js 全文、social-editor.js/topics.js 指定段落手工拆行（纯空白改动，去空白后逐字节等价；theme-manager 因测试有源码正则断言不做 prettier 自动格式化）。

### 第二轮：高严重度收尾与静默失败（#4 #6–#11 #17–#24）

- **#4**：`main.js` 视图动态 import 失败 toast error。
- **#6**：`batch-drawer.js` openBatch 加 `if (!drawer.open)` 守卫，轮询刷新不再抛 InvalidStateError。
- **#7**：social-editor 重新生成整组图文前，已有交付物时 `confirmAction` 确认。
- **#8**：cover 重新生成封面前，已有封面时 `confirmAction` 确认（新增 `coverExists` 状态）。
- **#9**：`editor.js` 保存失败状态绑定点击重试（仅 error 态可点），styles.css 补可点击视觉提示。
- **#10**：故事板未保存修改检测（`storyboardDirty` + input 委托），触发全量重建的四个变更（整组版式/逐页版式/构图模式/渠道）提交前 `confirmAction` 警告，取消时回退下拉值。**取舍**：未做快照恢复，警告方案最小且与服务端数据一致性更稳。
- **#11**：生成故事板失败时 `renderCardPlan(currentCardPlan, currentLayoutDecisions)` 恢复原内容，不再清空为空态。
- **#17**：新增订阅三道校验：非空、direct 类型 URL 格式、kind+value 查重。
- **#18**：`system.js` 删除模型配置按服务端回退逻辑写明影响：默认模型说明回退到哪个模型（无回退提示会被拒绝），非默认模型提示已指定任务将运行失败。
- **#19**：`core/ui.js` 新增 `openArtifactPreview(url, { originalUrl })`：加载态、JSON 错误体/error 事件兜底、关闭清 `iframe.src`；artifacts.js/calendar.js 接入；calendar 硬编码 `my-design.html` 改走 `/api/artifacts/:id/preview`（用查询已返回的产物 id）。
- **#20**：图文画廊翻页按钮改 document 级事件委托（`#social-gallery-prev/next`），不再依赖绑定时机。
- **#21**：topics 排行榜两处、preview 图片工作台、main.js 模型列表、batch-drawer 突发分析的静默 catch 均加 toast error 或界面降级提示；preview 区分网络错误与无配图空态。
- **#22**：hotspots/topics/atlas 列表请求加 `aria-busy` + 占位文案的加载态（对齐 tutorial.js 现有模式）。
- **#23**：`[data-copy]` toast 改 `copy.dataset.copyLabel || "已复制"`，writeText 失败 toast error。
- **#24**：「检查采集环境」按钮改文案为「采集环境设置」（实际行为是跳转 system 视图，那里另有真正的检查按钮）。

### 第三轮：#26 / #27 / #37 / #55

- **#26 统一 confirmAction**：`editor.js`（confirmDiscardEdits，两个 change 监听改为 async）、`editorial.js:49`（切换候选）、`atlas.js` offerPoolExit、`theme-manager.js` 归档主题均改为 `confirmAction` 并给出动作化 confirmText。**取舍**：`atlas.js` 的 `prompt("综合选题名称…")` 需要文本输入，`confirmAction` 不支持输入，按既定取舍保留原生 prompt。
- **#27 危险操作补确认**：`batch-drawer.js` confirmBreakingRoute（写入选题池前确认，提示不可逆）；topics.js「加入候选」实际位于 `topics.js`（`data-ranking-add` / `data-social-ranking-add`，报告原写 batch-drawer.js 系行号漂移），已补确认；`daily.js`「清空已选」补确认（空选时直接返回不弹窗）。
- **#37 本地时区**：`dashboard.js` 近 7 天筛选改用 `localDate(weekAgo)`（`localDate` 增加可选日期参数，原无参行为不变）；`calendar.js` 新增 `parseLocalDate`，`batch_date`（YYYY-MM-DD）按本地时区解析，负时区用户日历落点不再偏前一天。其余 `toISOString()` 用法均为日志时间戳展示，不涉及日期比较，未改。
- **#55 去重**：
  - `escapeHtml`：`skill-selection.js` 已是从 `core/ui.js` 导入（报告所述第三份已不存在）；`core/theme-catalog.js` 的 `safe` 改为委托 `escapeHtml`，但保留 `value ?? ''` 语义——`safe(undefined)` 原输出空串，直接换 `escapeHtml` 会输出 `"undefined"`，故只收口转义表不改变空值行为。
  - 流式对话：新增 `core/stream-chat.js`（`streamChat()`），`editorial.js` 与 `social-editor.js` 两处改为调用。差异以参数保留：title/errorLabel 文案、`onDone` 回调（editorial 重开编辑室，social 维护 history 并回填表单）、`rethrow`（editorial 失败抛给上层 toast，social 就地 toast）。
  - zip 上传：`submitSkillZip` 与 system.js 备份 validate/restore 并非 multipart，而是 `application/zip` 二进制 body；`core/http.js` 的 `request()` 本就支持自定义 content-type 与 body，三处直接改用 `request()`，无需新增 multipart 支持。错误兜底文案由「安装失败」等变为 `HTTP <状态码>`（服务端始终返回 `error` 字段时不触发）。

