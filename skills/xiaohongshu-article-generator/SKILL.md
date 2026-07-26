---
name: xiaohongshu-article-generator
description: 从文章、突发事件事实基座、自定义主题素材、产品资料、GitHub 项目或工具信息生成逐页图文 HTML、配套文案和 PNG。支持小红书图文、微信公众号工具贴图、事件卡片和自定义图文（教程/清单/观点），包含事实清单、标题、内容分块、375×667 分页、布局审计、截图和增长承接。
---

# 图文生成

生成可审计的 `my-design.html`、对外文案和逐页 PNG。布局以浏览器实测为准，不按字符数或固定卡片数量猜测。

## 输入

读取或推断以下字段：

- `channel_mode`：`xiaohongshu`、`wechat-tool-cards`、`wechat-event-cards`、`wechat-custom-cards` 或 `xiaohongshu-custom-cards`
- `topic`、`tool_name`、`source_url`
- 已核验功能、数字、限制条件和安装步骤
- 可选增长字段：`content_role`、`expected_action`、`practical_increment`、`conversion_bridge`、`follow_reason`
- `workdir`：默认 `<topic-slug>/`

用户要求公众号工具贴图、上游素材选型来自公众号编排器，或调用参数指定微信公众号时，使用 `wechat-tool-cards`；其余小红书请求使用 `xiaohongshu`。公众号工具贴图暂时复用小红书已经验证过的标题钩子、短句、emoji 和标签表达，但仍按公众号页面结构、事实门禁和自然承接交付。

## 开始前

按模式读取规范：

- `xiaohongshu`：读取 `COPY_GUIDE.md`、`TITLE_GUIDE.md`、`DESIGN_SYSTEM.md` 和 [references/layout-contract.md](references/layout-contract.md)
- `wechat-tool-cards`：读取 `COPY_GUIDE.md`、`TITLE_GUIDE.md`、[references/wechat-tool-cards.md](references/wechat-tool-cards.md)、`DESIGN_SYSTEM.md` 中选定风格的相关章节，以及 [references/layout-contract.md](references/layout-contract.md)。复用小红书的标题、emoji、短句和标签逻辑；遇到“亲测”、效果、数字、免费、开源、性能等表达时，以公众号事实门禁为最高优先级
- `wechat-event-cards`：读取 [references/wechat-event-cards.md](references/wechat-event-cards.md)、`DESIGN_SYSTEM.md` 和 [references/layout-contract.md](references/layout-contract.md)。只使用事件事实基座中的确认事实、带归属的主张、回应、时间线和来源审计
- `wechat-custom-cards` / `xiaohongshu-custom-cards`：读取 [references/custom-cards.md](references/custom-cards.md)、`DESIGN_SYSTEM.md` 和 [references/layout-contract.md](references/layout-contract.md)。只使用自定义事实基座中带来源等级的要点、步骤、条目和已抓取素材；体验真实性三来源等级是硬约束

从素材提取事实、受众、核心价值和禁用表达。不得虚构使用体验、节省时间、Star 数、性能、价格、开源协议或效果。GitHub 数字须记录采集时间；无法实时核验时省略数字。

## 工作流

### 1. 建立事实清单

写入 `fact-sheet.md`：

- 每项外部事实标记 `verified`、`unverified` 或 `opinion`
- 记录直接支持它的 URL 和采集时间
- 只有 `verified` 可作为确定事实进入卡片
- `unverified` 只能进入“待确认”或“使用前检查”，不得变成卖点
- 未亲自运行工具时明确写“基于项目文档整理”，不得写“我实测”

### 2. 规划卡片

写入 `card-plan.json`。每页只承担一个核心信息，并把内容块标记为不可拆分原子块或可拆分文本块。

公众号模式优先采用：封面 → 解决什么问题 → 核心能力 → 快速上手 → 适用场景 → 限制/权限 → 总结承接。只保留素材支持的页面，正常 4–7 页，不得为凑页重复卖点。

事件模式优先采用：封面 → 发生了什么 → 时间线 → 证据核验 → 各方说法 → 为什么重要 → 事实边界 → 结尾。正常 4–10 页；缺少对应材料时合并页面，不得为了冲突感把未核实主张写成事实。

自定义图文模式按 [references/custom-cards.md](references/custom-cards.md) 的内容类型组织：教程用分步页、清单用条目页、观点用论据页，均须保留一页事实边界；正常 4–10 页。

小红书模式按相应文案和标题规范规划。两种模式都要让读者能回答“它是什么、对我有什么用、怎么开始、有什么坑”。

### 3. 生成标题和对外文案

标题必须准确、具体且有场景：

- 公众号模式：按 `TITLE_GUIDE.md` 生成 3–5 个短标题备选，优先组合具体痛点、已核验数字、情绪钩子和具象结果；允许 emoji。没有可靠数字或真实体验时删去对应要素，不得为满足公式补写
- 小红书模式：按 `TITLE_GUIDE.md` 生成，但不得为了公式虚构数字、体验或收益

`copy.txt` 按自然阅读顺序组织，不出现 P1/P2、页码或布局指令。公众号模式参照 `COPY_GUIDE.md` 使用短句、emoji、口语化板块和末尾 6–8 个标签；结尾最多一个自然承接句，不连续索要关注、点赞、在看和转发。没有真实体验时禁止使用“我用了”“亲测”“加班减半”等体验措辞。事件模式必须为未核实内容保留说话者和边界表达，不煽动网暴，不把争议定性为结论。

### 4. 选择视觉风格并生成 HTML

根据话题和受众从 `DESIGN_SYSTEM.md` 选择一套风格。程序员工具默认 `ice-blue`、`neon` 或 `brutalist`；突发事件默认 `charcoal`、`crimson` 或 `bone-white`；不明确时使用 `ice-blue`。

每页使用：

```html
<section class="page" data-page-kind="content">
  <div class="page-inner">
    <header class="page-header">...</header>
    <main class="page-body" data-valign="center">
      <div class="page-content-stack">...</div>
    </main>
    <footer class="page-footer">...</footer>
  </div>
</section>
```

`data-page-kind` 只能是 `cover`、`content` 或 `ending`。内容页必须使用 `.page-content-stack`。内容接近上限时改为 `data-valign="start"`。禁止使用伪元素、固定高度、空白卡、`space-between` 或缩放来伪造填充。`.page` 固定 375×667（小红书与公众号一致）且 `overflow:hidden`，但隐藏溢出不能作为通过依据。

### 5. 布局审计并迭代

生成 HTML 后运行：

```powershell
node scripts/layout-audit.mjs my-design.html --json layout-report.json
```

按报告处理：

- `overflow` / `clipped`：移动最后一个原子块，再拆分长文本或简化装饰
- `underfilled`：合并相邻同主题页，或补充事实清单中已有的例子、限制和步骤
- `overfilled`：减少块数或拆页，不把正文压到 11px 以下
- 仅轻微间距问题才调整 gap/padding，单轮不超过 2px

最多自动迭代三轮，每轮重新审计；相同问题没有改善时停止并报告页面和像素值。

### 6. 截图与交付校验

只有审计通过后，读取并调用 `html-pages-to-images` 截取 `.page`，视口 375×667，`deviceScaleFactor` 默认 3。确认：

- PNG 数量等于页面数量且每张非空
- HTML、`copy.txt` 和 PNG 的标题、工具名与关键数字一致
- 公众号模式允许复用小红书式 emoji 和末尾标签串，但不得包含虚构体验、无来源数字或事实门禁禁止的夸张承诺
- 增长字段只影响结构和自然承接，不改变事实

## 输出

```text
<topic>/
  fact-sheet.md
  card-plan.json
  my-design.html
  copy.txt
  layout-report.json
  output/page-01.png ...
```

完成时报告模式、页数、各页利用率范围、事实数量、警告和截图路径。不要声称已发布到小红书或公众号。

---

**版本**：v5.1.0｜**最后更新**：2026-07-25
