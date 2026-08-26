# Project Content Skills

这些技能随项目版本管理，成稿和排版运行时默认从本目录加载，不依赖当前操作系统用户的 Codex 技能目录。

包含：

- `hotspot-tagging`：热点语义标注与全量预评估（选题链打标阶段）
- `event-card-generator`：事件事实卡生成（选题链事件研判阶段）
- `event-research-analyzer`：读取事件关联报道正文，形成故事板和图文共用的深度事件事实基座（事件图文自动前置阶段）
- `hotspot-brainstorm`：热点探索脑暴，生成临时探索卡（选题链脑暴阶段）
- `hotspot-synthesis`：热点综合研判与竞争修正（选题链复排阶段）
- `editorial-room-chat`：公众号编辑会主持人，锁定简报前的对话式决策（选题链编辑会阶段）

以上 5 个为选题阶段技能：前 4 个由代码经 `server/platform/llm/selection-prompts.mjs` 按名固定加载并保留内联 prompt 作为技能缺失时的 fallback，不进入创作入口路由。

对话 agent 技能（prompt 唯一事实源，技能缺失时加载直接报错，代码不再内联 prompt）：

- `editorial-room-chat`：编辑室对话（同上，属选题链编辑会阶段）
- `tutorial-chat`：自主写作策划对话
- `custom-social-chat`：自定义图文策划对话

`editorial-room-chat` 与 `custom-social-chat` 的账号上下文位置使用 `{{ACCOUNT_CONTEXT}}` 占位符，由代码注入 `account-context.json` 的格式化内容。

- `wechat-mp-topic-to-article`：公众号成稿总编排契约
- `wechat-mp-tech-hotspot`：技术热点快评
- `wechat-mp-tech-deep`：技术原理深解
- `wechat-mp-deep-dive`：行业、职场和社会事件分析
- `wechat-mp-gossip-chill`：轻量职场与大厂趣闻
- `wechat-mp-composite`：多热点综合与趋势综述
- `wechat-mp-daily`：围绕主体、动作或场合关系归纳关联事件的公众号早报
- `wechat-mp-personal-writing`：根据作者真实经历、心得与判断生成自主经验文章
- `wechat-mp-tutorial`：根据真实环境、步骤和证据生成可复现教程

当前文章入口分为热点事件文、批次早报文和自主写作文；自主写作内部按心得经验/使用教程选择独立事实契约与技能。三类成稿统一进入文章编辑器与公众号排版。工具清单不进入热点文章路由，由图文流程承接。
- `title-generator`：标题生成与筛选
- `humanizer-zh`：去 AI 表达
- `article-reviewer`：事实、逻辑和风险审稿
- `seo-keyword-scoring`、`seo-content-optimizer`：SEO 阶段
- `article-image-placeholders`：来源图和资料图占位
- `article-visual-planner`：Mermaid/ECharts 图表插入建议（编辑器「图表建议」环节）
- `wechat-article-typeset`：公众号排版总编排契约
- `wechat-md-render`、`magazine-design-advisor`、`wechat-md-to-draft`：预渲染、杂志设计和 HTML 初稿
- `wechat-html-normalizer`、`wechat-html-check-no-div`：HTML 净化和最终门禁
- `mermaid-render`、`wechat-echarts-blocks-to-images`：可视化转图契约
- `html-pages-to-images`、`upyun-upload-image`：截图和经授权的图片上传依赖

默认加载路径为 `<workspaceRoot>/skills`。只有显式设置 `CODEX_SKILLS_ROOT` 时才会使用外部技能目录覆盖项目版本。

更新技能时应复制完整目录，并通过测试确认成稿的 `00-skill-manifest.json` 或排版的 `typeset-skill-manifest.json` 记录的是项目内文件和新的内容哈希。
