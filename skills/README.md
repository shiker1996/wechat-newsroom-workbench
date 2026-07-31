# Project Content Skills

这些技能随项目版本管理，成稿和排版运行时默认从本目录加载，不依赖当前操作系统用户的 Codex 技能目录。

包含：

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
- `wechat-article-typeset`：公众号排版总编排契约
- `wechat-md-render`、`magazine-design-advisor`、`wechat-md-to-draft`：预渲染、杂志设计和 HTML 初稿
- `wechat-html-normalizer`、`wechat-html-check-no-div`：HTML 净化和最终门禁
- `mermaid-render`、`wechat-echarts-blocks-to-images`：可视化转图契约
- `html-pages-to-images`、`upyun-upload-image`：截图和经授权的图片上传依赖

默认加载路径为 `<workspaceRoot>/skills`。只有显式设置 `CODEX_SKILLS_ROOT` 时才会使用外部技能目录覆盖项目版本。

更新技能时应复制完整目录，并通过测试确认成稿的 `00-skill-manifest.json` 或排版的 `typeset-skill-manifest.json` 记录的是项目内文件和新的内容哈希。
