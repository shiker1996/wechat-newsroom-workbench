# 内容规划模块

本目录承载主动写作素材箱和公众号后台导出复盘的领域适配代码。

- `wechat-export-parser.mjs` 只负责把 HTML 表格、CSV/TSV 和 BIFF `.xls` 转为统一二维表，不直接写数据库。
- `wechat-content-insights.mjs` 负责对历史文章做可解释的题材、标题结构初判，并聚合阅读与阅读后关注信号；它不替代人工判断，也不改写主评分。
- `wechat-article-matcher.mjs` 负责把公众号文章指标按 URL、标题和日期相似度关联到本地文章产物；普通文章只使用终稿，`social-cards/**/copy.txt` 作为独立的图文发布文案候选；非精确候选进入人工确认，确认与拒绝会留下匹配日志。
- `wechat-content-feedback.mjs` 负责对已确认正文做确定性结构特征抽取，并按题材、标题结构、正文结构和渠道结果生成带样本范围与置信度的反馈快照；反馈快照可作为标题和写作阶段的一次性参考上下文，但不自动修改创作配置。
- `social-content-feedback.mjs` 负责读取已确认图文同目录的 `copy.txt`、`card-plan.json`、`layout-report.json` 和阶段执行记录，分别提取文案成品、故事板结构与布局交付特征，并按“有/无该特征”的阅读、分享和关注结果做软对照；不把布局门禁或历史相关性当作因果结论。
- `content-planning-recommendations.mjs` 将反馈快照和素材评估合成为可解释的软推荐，支持复盘优先排序、目标选择、标题结构提示和下一篇验证预告；不替代热点评分，也不自动修改账号长期策略。
- `wechat-strategy-recommendations.mjs` 在两个不同内容周期后生成只读账号策略草案，覆盖内容配比、栏目优先级、分发比例和关注理由；建议必须由作者确认后手工写回账号配置。
- 持久化由 `server/platform/persistence/repositories/content-planning-repository.mjs` 负责。
- HTTP 入口位于 `server/platform/http/routes/content-routes.mjs`；复盘洞察在应用适配层组合，素材评估只把历史表现作为软性推荐，不改变现有热点选题评分链。
- 栏目是独立实体，不把栏目字段写入 `account-context.json`。
