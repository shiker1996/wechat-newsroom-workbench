import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../server/platform/core/store.mjs';
import { parseWechatExport } from '../server/features/content-planning/wechat-export-parser.mjs';
import { buildWechatInsights, classifyWechatArticle, matchWechatPerformance } from '../server/features/content-planning/wechat-content-insights.mjs';
import { buildContentFeedbackSnapshot, buildContentFeedbackPromptContext, extractArticleContentFeatures } from '../server/features/content-planning/wechat-content-feedback.mjs';
import { buildSocialContentFeedbackSnapshot, extractSocialContentFeatures } from '../server/features/content-planning/social-content-feedback.mjs';
import { buildContentPlanningRecommendation, sortMaterialsByPlanningRecommendation } from '../server/features/content-planning/content-planning-recommendations.mjs';
import { buildWechatStrategyRecommendations } from '../server/features/content-planning/wechat-strategy-recommendations.mjs';
import { buildAdjustmentDraft, buildFeedbackAdjustmentMessages, buildFeedbackAdjustmentPatchMessages, confirmAdjustmentDraft, currentSkillFile, resolveTitleSkillTarget } from '../server/features/content-planning/feedback-adjustment.mjs';
import { buildSocialFeedbackAdjustmentDraft, buildSocialFeedbackAdjustmentPatchMessages, buildSocialFeedbackAdjustmentPlanningMessages, resolveSocialSkillTargets } from '../server/features/content-planning/social-feedback-adjustment.mjs';
import { loadSkillBundle } from '../server/platform/llm/skill-runtime.mjs';
import { handleContentRoutes } from '../server/platform/http/routes/content-routes.mjs';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-planning-'));
  const store = new Store(path.join(root, 'workbench.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return store;
}

test('素材入箱会保存评估、栏目和日历计划', (t) => {
  const store = workspace(t);
  const material = store.createWritingMaterial({ sourceType: 'conversation', title: '一次真实复盘', rawText: '我遇到问题，后来找到原因，结果工作流失败了，但建议记录边界。' });
  const column = store.listContentColumns()[0];
  store.saveWritingAssessment(material.id, { account_fit: { level: 'medium', reason: '命中' }, completeness: { level: 'medium', reason: '待补' }, topic_potential: { level: 'high', reason: '有反差' }, deepening_directions: ['补充失败证据'], recommended_column_id: column.id });
  const plan = store.createWritingPlan({ materialId: material.id, columnId: column.id, titleDirection: '真实复盘 + 工作流', titleIntent: '分享型', plannedDate: '2026-09-04', status: 'planned' });
  assert.equal(store.getWritingMaterial(material.id).assessment.topic_potential.level, 'high');
  assert.equal(store.listCalendarContent({ month: '2026-09' }).find((item) => item.content_type === 'writing_plan').id, plan.id);
});

test('文章发布信息可分别关联内容计划和文章文档，并在重复保存时更新原记录', (t) => {
  const store = workspace(t);
  const material = store.createWritingMaterial({ sourceType: 'project', title: '发布关联测试', rawText: '记录一次发布关联。' });
  const column = store.listContentColumns()[0];
  const plan = store.createWritingPlan({ materialId: material.id, columnId: column.id, titleDirection: '真实复盘', plannedDate: '2026-09-04', status: 'planned' });
  const first = store.saveArticlePublication({ planId: plan.id, contentUrl: 'https://mp.weixin.qq.com/s/example', publishedAt: '2026-09-05', titleAtPublish: '发布后的最终标题', contentRole: '涨粉', distributionLane: '推荐' });
  assert.equal(first.status, 'awaiting_metrics');
  const second = store.saveArticlePublication({ planId: plan.id, contentUrl: 'https://mp.weixin.qq.com/s/example-2', publishedAt: '2026-09-06', titleAtPublish: '改过的最终标题' });
  assert.equal(second.id, first.id);
  assert.equal(second.content_url, 'https://mp.weixin.qq.com/s/example-2');
  assert.equal(store.listCalendarContent({ month: '2026-09' }).find((item) => item.id === plan.id).publication_status, 'awaiting_metrics');

  const batch = store.createBatch({ date: '2026-09-06', title: '文档关联测试' });
  const document = store.saveDocument({ batchId: batch.id, kind: 'final', title: '文章文档标题', content: '# 文章文档标题\n\n正文', status: 'finalized' });
  const linked = store.saveArticlePublication({ documentId: document.id, titleAtPublish: '文章文档发布标题' });
  assert.equal(linked.status, 'registered');
  assert.equal(store.getArticlePublication({ documentId: document.id }).title_at_publish, '文章文档发布标题');
});

test('五类公众号导出可逐个导入并按唯一键合并', (t) => {
  const store = workspace(t);
  const html = '<table><tr><th>用户增长</th></tr><tr><th>时间</th><th>新关注人数</th><th>取消关注人数</th><th>净增关注人数</th><th>累积关注人数</th></tr><tr><td>2026-08-30</td><td>10</td><td>2</td><td>8</td><td>100</td></tr></table>';
  const parsed = parseWechatExport(Buffer.from(html), 'user_analysis.xls');
  const first = store.importWechatExport({ fileName: 'user_analysis.xls', importType: 'user_growth', format: parsed.format, sheets: parsed.sheets });
  const second = store.importWechatExport({ fileName: 'user_analysis-2.xls', importType: 'user_growth', format: parsed.format, sheets: parsed.sheets });
  assert.equal(first.row_count, 1); assert.equal(second.row_count, 1);
  assert.equal(store.getWechatReview().growth.length, 1);
  assert.equal(store.listWechatImports().length, 2);
});

test('内容趋势导出会按带空占位列的三段表头读取日期、渠道和指标', (t) => {
  const store = workspace(t);
  const sheets = [{ name: 'New Sheet1', rows: [
    ['', '数据趋势概况', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '日期', '渠道', '阅读人数', '', '日期', '分享人数', '跳转阅读原文人数', '微信收藏人数', '发表篇数', '', '传播渠道', '发表日期', '内容标题', '阅读人数', '阅读人数占比'],
    ['', '2026-08-01', '公众号消息', 98, '', '2026-08-01', 220, 0, 146, 2, '', '全部', '20260809', '一篇文章', 10056, 0.2],
    ['', '2026-08-01', '聊天会话', 35, '', '2026-08-02', 140, 0, 88, 1, '', '推荐', '20260809', '另一篇文章', 9867, 0.3],
  ] }];
  const result = store.importWechatExport({ fileName: 'tendency.xls', importType: 'content_trends', format: 'biff-xls', sheets });
  assert.equal(result.row_count, 2);
  const review = store.getWechatReview();
  assert.deepEqual(review.trends.map(({ stat_date, reads, shares, favorites, published_count }) => ({ stat_date, reads, shares, favorites, published_count })), [
    { stat_date: '2026-08-01', reads: 133, shares: 360, favorites: 234, published_count: 3 },
  ]);
  assert.deepEqual(review.channels.map(({ channel, reads }) => ({ channel, reads })), [
    { channel: '公众号消息', reads: 98 },
    { channel: '聊天会话', reads: 35 },
  ]);
});

test('历史文章会初步识别题材和标题结构，并提供软性表现信号', () => {
  const articles = [
    { title: 'PDF处理神器：10ms分类，无需OCR转Markdown', reads: 1460, follows_after_read: 8 },
    { title: 'AI工具效率翻倍：我的真实使用记录', reads: 100, follows_after_read: 1 },
    { title: '程序员为什么还在加班？', reads: 80, follows_after_read: 0 },
  ];
  const classified = classifyWechatArticle(articles[0]);
  const insights = buildWechatInsights(articles);
  const signal = matchWechatPerformance('我想复盘 PDF 工具的使用效果和效率变化', insights);
  assert.ok(classified.topic_tags.includes('开发者工具'));
  assert.equal(classified.title_structure, '结果 / 数字承诺');
  assert.ok(insights.topics.some((item) => item.label === '开发者工具'));
  assert.ok(insights.title_structures.some((item) => item.label === '结果 / 数字承诺'));
  assert.equal(signal.level, 'low');
  assert.ok(signal.sample_count > 0);
  assert.match(signal.reason, /历史题材|标题结构/);
});

test('公众号复盘看板按已确认产物拆分文章和图文数据轨道', async () => {
  let responseBody;
  const store = {
    getWechatReview: () => ({ articles: [
      { id: 1, title: '文章终稿：真实复盘', published_date: '2026-08-29', reads: 1200, shares: 10, follows_after_read: 4, notified: 1 },
      { id: 2, title: '工具图文：三步上手', published_date: '2026-08-30', reads: 800, shares: 18, follows_after_read: 3, notified: 0 },
    ], growth: [], weekly: [], notified: { count: 1, reads: 1200 }, unnotified: { count: 1, reads: 800 }, channels: [], regular_readers: [], imports: [] }),
    listWechatArticleMetricMatches: () => [{ metric_id: 1, status: 'confirmed', artifact_type: '文章终稿' }, { metric_id: 2, status: 'confirmed', artifact_type: '图文发布文案' }],
  };
  const handled = await handleContentRoutes({ request: { method: 'GET' }, response: {}, pathname: '/api/wechat/review', searchParams: new URLSearchParams(), store, artifactRoots: [], mime: {}, json: (_response, _status, value) => { responseBody = value; } });
  assert.equal(handled, true);
  assert.deepEqual(responseBody.review_tracks.article.articles.map((item) => item.id), [1]);
  assert.deepEqual(responseBody.review_tracks.social.articles.map((item) => item.id), [2]);
  assert.equal(responseBody.review_tracks.social.top_articles[0].reads, 800);
});

test('正文特征抽取覆盖结构、证据、结果和标题兑现线索', () => {
  const features = extractArticleContentFeatures({ source_kind: 'local_final', title: 'PDF 工具：3 步转 Markdown', content: '# PDF 工具：3 步转 Markdown\n\n先说问题：以前整理 PDF 很慢。\n\n## 实测结果\n\n- 处理 3 个文件\n- 节省 10 分钟\n\n```bash\npdf-tool run\n```\n\n> 失败时要检查 OCR\n\n![截图](evidence/result.png)' }, { metricTitle: 'PDF 工具：3 步转 Markdown', evidenceAssets: [{ asset_type: 'screenshot' }, { asset_type: 'failure' }] });
  assert.equal(features.heading_count, 2);
  assert.equal(features.structure.list_item_count, 2);
  assert.equal(features.structure.code_block_count, 1);
  assert.equal(features.structure.image_count, 1);
  assert.equal(features.opening_problem.detected, true);
  assert.equal(features.markers.has_result, true);
  assert.equal(features.markers.has_failure, true);
  assert.equal(features.evidence.asset_count, 2);
  assert.equal(features.title_fulfillment.status, 'likely_fulfilled');
});

test('反馈快照按题材、标题结构和正文结构聚合，并保留软性边界', () => {
  const make = (id, reads, follows, content) => ({ metric_id: id, import_batch_id: 1, metric_title: 'PDF 工具：3 步转 Markdown', published_date: `2026-08-${String(id).padStart(2, '0')}`, reads, follows_after_read: follows, content_status: 'ok', writer_skill_id: 'wechat-mp-tech-deep', features: extractArticleContentFeatures({ source_kind: 'local_final', title: 'PDF 工具：3 步转 Markdown', content }, { metricTitle: 'PDF 工具：3 步转 Markdown', evidenceAssets: [{ asset_type: 'screenshot' }] }), evidence_assets: [{ asset_type: 'screenshot' }] });
  const rows = [1, 2, 3].map((id) => make(id, id * 100, id, '# PDF 工具：3 步转 Markdown\n\n问题是整理 PDF 太慢。\n\n## 结果\n\n最终节省 10 分钟。'));
  const feedback = buildContentFeedbackSnapshot(rows, { review: { channels: [{ channel: '公众号消息', reads: 220 }] } });
  assert.equal(feedback.linked_article_count, 3);
  assert.equal(feedback.confidence, 'medium');
  assert.ok(feedback.topic_signals.some((item) => item.label === '开发者工具'));
  assert.ok(feedback.title_signals.some((item) => item.label === '结果 / 数字承诺'));
  assert.ok(feedback.body_signals.some((item) => item.id === 'opening_problem'));
  assert.equal(feedback.writer_skill_evidence[0].skill_id, 'wechat-mp-tech-deep');
  assert.equal(feedback.writer_skill_evidence[0].sample_count, 3);
  assert.ok(feedback.recommendations.length >= 2);
  assert.ok(feedback.unresolved_questions.some((item) => item.includes('相关性')));
});

test('正文特征和反馈快照可以持久化并按最新记录读取', (t) => {
  const store = workspace(t);
  store.importWechatExport({ fileName: 'notified.csv', importType: 'notified_articles', format: 'csv', sheets: [{ name: '内容', rows: [['内容标题', '发表日期', '阅读人数', '分享人数', '阅读后关注人数'], ['PDF 工具：3 步转 Markdown', '2026-08-30', 1200, 20, 6]] }] });
  const metric = store.listWechatArticleMetrics()[0];
  const snapshot = store.saveArticleContentSnapshot({ metricId: metric.id, sourceKind: 'local_final', sourcePath: 'C:/articles/09-final.md', title: metric.title, content: '# PDF 工具：3 步转 Markdown\n\n问题是整理 PDF 太慢。\n\n最终节省 10 分钟。' });
  const features = extractArticleContentFeatures(snapshot, { metricTitle: metric.title });
  const savedFeatures = store.saveArticleContentFeatures({ snapshotId: snapshot.id, metricId: metric.id, features });
  assert.equal(savedFeatures.features.markers.has_result, true);
  const savedFeedback = store.saveContentFeedbackSnapshot(buildContentFeedbackSnapshot([{ ...metric, metric_id: metric.id, metric_title: metric.title, content_status: 'ok', snapshot_id: snapshot.id, source_kind: snapshot.source_kind, writer_skill_id: 'wechat-mp-tutorial', features, evidence_assets: [] }], { review: {} }));
  assert.equal(store.getLatestContentFeedbackSnapshot().id, savedFeedback.id);
  assert.equal(store.getLatestContentFeedbackSnapshot().writer_skill_evidence[0].skill_id, 'wechat-mp-tutorial');
  assert.equal(store.getArticleContentFeatures(snapshot.id).features.content_chars, features.content_chars);
});

test('反馈快照注入上下文只作为不可信参考，按标题和写作目标裁剪', () => {
  const feedback = { confidence: 'medium', metric_window_start: '2026-08-01', metric_window_end: '2026-08-30', topic_signals: [{ label: 'AI 工具', sample_count: 3 }], title_signals: [{ label: '结果 / 数字承诺', sample_count: 3 }], body_signals: [{ label: '有真实证据资产', sample_count: 3 }], recommendations: [{ type: 'title', target: '标题', text: '可尝试结果型标题' }, { type: 'body', target: '正文', text: '补充失败边界' }], unresolved_questions: ['样本仍然有限'] };
  const title = buildContentFeedbackPromptContext(feedback, { target: 'title' });
  const writing = buildContentFeedbackPromptContext(feedback, { target: 'writing' });
  assert.match(title, /untrusted-data/); assert.match(title, /结果 \/ 数字承诺/); assert.doesNotMatch(title, /补充失败边界/);
  assert.match(writing, /有真实证据资产/); assert.match(writing, /补充失败边界/); assert.doesNotMatch(writing, /结果 \/ 数字承诺/);
});

test('反哺优先按文章 manifest 识别实际标题技能，并支持已安装技能覆盖', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-feedback-title-target-'));
  try {
    const artifactDir = path.join(root, 'articles', 'sample');
    const installedDir = path.join(root, 'data', 'installed-skills', 'hot-title-generator');
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.mkdirSync(installedDir, { recursive: true });
    fs.mkdirSync(path.join(root, 'writing-skills', 'hot-title-generator'), { recursive: true });
    fs.writeFileSync(path.join(artifactDir, '00-skill-manifest.json'), JSON.stringify({ stageSkillSelections: { title: { selectedSkill: 'hot-title-generator' } } }));
    fs.writeFileSync(path.join(installedDir, 'SKILL.md'), '# 安装版标题技能\n原规则。\n');
    fs.writeFileSync(path.join(installedDir, 'skill.json'), JSON.stringify({ schemaVersion: 1, id: 'hot-title-generator', name: '爆款标题生成器', version: '1.0.0', kind: 'title', entryPoints: ['hotspot-article'], contentTypes: ['article'], inputContract: 'article_fact_base', outputContract: 'title_candidates', requiredCapabilities: [], optionalCapabilities: [], compatibleApp: '>=0.1.0', source: { type: 'installed', url: '' } }));
    fs.writeFileSync(path.join(root, 'data', 'skill-packages.json'), JSON.stringify({ schemaVersion: 1, packages: { 'hot-title-generator': { id: 'hot-title-generator', status: 'enabled' } }, entryDefaults: {}, stageDefaults: { 'hotspot-article': { title: 'hot-title-generator' } } }));
    fs.writeFileSync(path.join(root, 'writing-skills', 'hot-title-generator', 'SKILL.md'), '# 覆盖版标题技能\n');
    const target = resolveTitleSkillTarget({ workspaceRoot: root, analyses: [{ metric_id: 7, file_path: path.join(artifactDir, '09-FINAL.md') }], feedback: { source_metric_ids: [7] } });
    assert.equal(target.skillId, 'hot-title-generator');
    assert.equal(target.source, 'artifact-manifest');
    assert.equal(currentSkillFile(root, 'hot-title-generator'), path.join(root, 'writing-skills', 'hot-title-generator', 'SKILL.md'));
    assert.match(loadSkillBundle({ workspaceRoot: root, skillName: 'hot-title-generator' }).prompt, /覆盖版标题技能/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('复盘反馈生成最小配置与技能草案，确认前不写文件，确认后运行时读取覆盖技能', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-feedback-adjustment-'));
  try {
    fs.mkdirSync(path.join(root, 'skills', 'title-generator'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', 'wechat-mp-tech-hotspot'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', 'wechat-mp-tech-deep'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'title-generator', 'SKILL.md'), '# 标题技能\n\n原规则。\n');
    fs.writeFileSync(path.join(root, 'skills', 'wechat-mp-tech-hotspot', 'SKILL.md'), '# 写作技能\n\n原规则。\n');
    fs.writeFileSync(path.join(root, 'skills', 'wechat-mp-tech-deep', 'SKILL.md'), '# 技术深解\n\n原规则。\n');
    const accountContext = { name: '测试账号', contentRatio: { '开源项目': '60%' }, distributionStrategy: { recommendation: { purpose: '拉新' } }, scoring: { weights: { h: 0.6, b: 0.25, p: 0.15 }, categoryPreference: { '🤖 AI/技术动态': 0 } } };
    fs.writeFileSync(path.join(root, 'account-context.json'), JSON.stringify(accountContext, null, 2) + '\n');
    const feedback = { id: 9, confidence: 'medium', linked_article_count: 4, metric_window_start: '2026-08-01', metric_window_end: '2026-08-30', writer_skill_evidence: [{ skill_id: 'wechat-mp-tech-deep', sample_count: 4 }] };
    const draft = buildAdjustmentDraft({ workspaceRoot: root, feedback, strategy: { ready: true }, accountContext, writerSkillId: 'wechat-mp-tech-hotspot', modelResult: {
      planning: { summary: '强化结果型标题和正文边界', selected_writer_skill_id: 'wechat-mp-tech-deep', writer_skill_reason: '正文反馈集中在原理解释和可复算证据，因此落到技术深解。', warnings: ['样本仍需继续积累'] },
      patch: { account_patch: { scoring: { categoryPreference: { '🤖 AI/技术动态': 6 }, topicWeights: { '开源项目': 1.2 } }, contentRatio: { note: '不应写入' }, distributionStrategy: { preference: '不应写入' }, followReason: '不应自动改长期承诺', name: '不应被修改' }, skill_edits: [{ skill_id: 'title-generator', edits: [{ section: '生成', old_text: '原规则。', new_text: '优先突出已经核验的结果和读者收益。', reason: '标题信号显示需要加强结果兑现。' }] }, { skill_id: 'wechat-mp-tech-deep', edits: [{ section: '写作规则', old_text: '原规则。', new_text: '补充失败边界和适用条件。', reason: '正文反馈集中在原理和证据拆解。' }] }] },
    } });
    assert.equal(draft.changes.length, 3);
    assert.ok(!fs.existsSync(path.join(root, 'writing-skills')));
    assert.match(draft.changes.find((item) => item.id === 'account-context').new_content, /AI\/技术动态/);
    assert.doesNotMatch(draft.changes.find((item) => item.id === 'account-context').new_content, /不应写入|不应自动改长期承诺|topicWeights/);
    assert.match(draft.changes.find((item) => item.id === 'title-generator').new_content, /优先突出已经核验的结果和读者收益/);
    assert.doesNotMatch(draft.changes.find((item) => item.id === 'title-generator').new_content, /标题信号|样本|非因果|根据反馈/);
    assert.equal(draft.source.writer_skill_id, 'wechat-mp-tech-deep');
    assert.match(draft.source.writer_skill_reason, /原理解释/);
    const result = confirmAdjustmentDraft({ workspaceRoot: root, draft });
    assert.equal(result.written.length, 3);
    assert.ok(fs.existsSync(path.join(root, 'writing-skills', 'title-generator', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(root, 'writing-skills', 'wechat-mp-tech-deep', 'SKILL.md')));
    assert.match(loadSkillBundle({ workspaceRoot: root, skillName: 'title-generator' }).prompt, /优先突出已经核验的结果/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'account-context.json'), 'utf8')).name, '测试账号');
    assert.equal(draft.changes.find((item) => item.id === 'title-generator').old_content, '# 标题技能\n\n原规则。\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('没有显式写作技能映射时，正文样本和结构信号允许 AI 推断写作技能', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-feedback-adjustment-inference-'));
  try {
    fs.mkdirSync(path.join(root, 'skills', 'title-generator'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', 'wechat-mp-tech-deep'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'title-generator', 'SKILL.md'), '# 标题技能\n原有标题规则。\n');
    fs.writeFileSync(path.join(root, 'skills', 'wechat-mp-tech-deep', 'SKILL.md'), '# 技术深解\n原有正文规则。\n');
    const draft = buildAdjustmentDraft({
      workspaceRoot: root,
      feedback: { linked_article_count: 5, body_signals: [{ id: 'evidence', sample_count: 5 }], writer_skill_evidence: [] },
      strategy: {},
      accountContext: {},
      modelResult: {
        planning: { selected_writer_skill_id: 'wechat-mp-tech-deep', writer_skill_reason: '题材与正文结构均指向技术原理拆解。', target_intents: [{ skill_id: 'wechat-mp-tech-deep', intent: '强化技术原理和证据边界' }] },
        patch: { skill_edits: [{ skill_id: 'wechat-mp-tech-deep', edits: [{ old_text: '原有正文规则。', new_text: '正文先解释原理，再给出可复核的证据和适用边界。', reason: '基于题材与正文结构的 AI 推断。' }] }] },
      },
    });
    assert.equal(draft.source.writer_skill_id, 'wechat-mp-tech-deep');
    assert.equal(draft.source.writer_skill_selection_source, 'ai_inference');
    assert.equal(draft.changes.length, 1);
    assert.equal(draft.changes[0].id, 'wechat-mp-tech-deep');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('复盘反馈草案确认检测源文件冲突，不覆盖用户新改内容', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-feedback-adjustment-conflict-'));
  try {
    fs.mkdirSync(path.join(root, 'skills', 'title-generator'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'title-generator', 'SKILL.md'), '# 标题技能\n');
    const draft = buildAdjustmentDraft({ workspaceRoot: root, feedback: { id: 1 }, accountContext: {}, modelResult: { planning: {}, patch: { skill_edits: [{ skill_id: 'title-generator', edits: [{ old_text: '# 标题技能', new_text: '# 标题技能\n\n新规则。' }] }] } }, writerSkillId: 'wechat-mp-tech-hotspot' });
    fs.writeFileSync(path.join(root, 'skills', 'title-generator', 'SKILL.md'), '# 标题技能\n\n用户修改。\n');
    assert.throws(() => confirmAdjustmentDraft({ workspaceRoot: root, draft }), (error) => error.code === 'ADJUSTMENT_SOURCE_CONFLICT');
    assert.equal(fs.existsSync(path.join(root, 'writing-skills', 'title-generator', 'SKILL.md')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('反馈调整 Prompt 不强制猜测正文技能，且旧版本草案不能确认', () => {
  const messages = buildFeedbackAdjustmentMessages({ feedback: { writer_skill_evidence: [] }, accountContext: {}, strategy: {}, writerSkillCatalog: [] });
    assert.match(messages.system, /才必须把 selected_writer_skill_id 填 null/);
    assert.match(messages.system, /target_intents/);
  const patchMessages = buildFeedbackAdjustmentPatchMessages({ feedback: {}, strategy: {}, accountContext: {}, plan: {}, titleSkill: '# 标题技能' });
  assert.match(patchMessages.system, /old_text/);
  assert.match(patchMessages.system, /不得新增/);
  assert.match(messages.system, /不得修改 followReason/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-feedback-stale-'));
  try {
    const draft = { status: 'pending', source: { adjustment_version: 'v1' }, changes: [] };
    assert.throws(() => confirmAdjustmentDraft({ workspaceRoot: root, draft }), (error) => error.code === 'ADJUSTMENT_DRAFT_STALE');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('复盘调整接口调用模型生成草案，但生成阶段不写入技能覆盖文件', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-feedback-adjustment-route-'));
  const store = new Store(path.join(root, 'workbench.db'));
  try {
    fs.mkdirSync(path.join(root, 'skills', 'title-generator'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', 'wechat-mp-tech-hotspot'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', 'wechat-mp-tech-deep'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'title-generator', 'SKILL.md'), '# 标题技能\n');
    fs.writeFileSync(path.join(root, 'skills', 'wechat-mp-tech-hotspot', 'SKILL.md'), '# 写作技能\n');
    fs.writeFileSync(path.join(root, 'skills', 'wechat-mp-tech-deep', 'SKILL.md'), '# 技术深解\n');
    fs.writeFileSync(path.join(root, 'account-context.json'), JSON.stringify({ name: '测试账号' }));
    store.saveContentFeedbackSnapshot({ confidence: 'medium', linked_article_count: 4, metricWindowStart: '2026-08-01', metricWindowEnd: '2026-08-30', writerSkillEvidence: [], recommendations: [{ type: 'title', text: '试试结果型标题' }] });
    let responseBody; let responseStatus; const calls = [];
    const handled = await handleContentRoutes({ request: { method: 'POST' }, response: {}, pathname: '/api/wechat/feedback/adjustments/generate', searchParams: new URLSearchParams(), store, artifactRoots: [], mime: {}, root, body: async () => ({}), models: { complete: async ({ purpose, thinking }) => { calls.push({ purpose, thinking }); return purpose === 'content-feedback-adjustment-plan' ? ({ provider: 'fake', model: 'fake-plan', content: JSON.stringify({ summary: '标题和正文校准', selected_writer_skill_id: 'wechat-mp-tech-deep', writer_skill_reason: '正文反馈是原理和证据拆解。', target_intents: [{ skill_id: 'title-generator', intent: '强化结果兑现', evidence_summary: '标题需要强化结果兑现。' }, { skill_id: 'wechat-mp-tech-deep', intent: '强化原理与证据拆解', evidence_summary: '正文反馈是原理和证据拆解。' }], account_intent: { action: 'no_change' }, warnings: [] }) }) : ({ provider: 'fake', model: 'fake-patch', content: JSON.stringify({ account_patch: {}, skill_edits: [{ skill_id: 'title-generator', edits: [{ section: '标题', old_text: '# 标题技能', new_text: '# 标题技能\n\n强化结果兑现。', reason: '标题需要强化结果兑现。' }] }, { skill_id: 'wechat-mp-tech-deep', edits: [{ section: '正文', old_text: '# 技术深解', new_text: '# 技术深解\n\n强化原理与证据拆解。', reason: '正文反馈是原理和证据拆解。' }] }], warnings: [] }) }); } }, json: (_response, status, value) => { responseStatus = status; responseBody = value; } });
    assert.equal(handled, true); assert.equal(responseStatus, 201); assert.equal(responseBody.status, 'pending'); assert.equal(responseBody.changes.length, 1);
    assert.deepEqual(calls.map((item) => item.purpose), ['content-feedback-adjustment-plan', 'content-feedback-adjustment-patch']); assert.ok(calls.every((item) => item.thinking === true));
    assert.equal(responseBody.source.writer_skill_id, null);
    assert.equal(fs.existsSync(path.join(root, 'writing-skills', 'title-generator', 'SKILL.md')), false);
  } finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('已跳过的复盘调整草案可以删除，其他状态受保护', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-feedback-adjustment-delete-'));
  const store = new Store(path.join(root, 'workbench.db'));
  try {
    const rejected = store.saveContentFeedbackAdjustmentDraft({ summary: '待删除草案' });
    store.updateContentFeedbackAdjustmentDraftStatus(rejected.id, 'rejected');
    assert.deepEqual(store.deleteContentFeedbackAdjustmentDraft(rejected.id), { id: rejected.id, deleted: true });
    assert.equal(store.getContentFeedbackAdjustmentDraft(rejected.id), null);

    const pending = store.saveContentFeedbackAdjustmentDraft({ summary: '待确认草案' });
    assert.throws(() => store.deleteContentFeedbackAdjustmentDraft(pending.id), (error) => error.code === 'ADJUSTMENT_DRAFT_DELETE_NOT_ALLOWED');
    store.updateContentFeedbackAdjustmentDraftStatus(pending.id, 'confirmed');
    assert.throws(() => store.deleteContentFeedbackAdjustmentDraft(pending.id), (error) => error.code === 'ADJUSTMENT_DRAFT_DELETE_NOT_ALLOWED');
  } finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('图文反哺按实际执行记录定位故事板技能和文案生成技能', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'social-feedback-adjustment-targets-'));
  try {
    const artifactDir = path.join(root, 'social-card'); fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, 'copy.txt'), '发布文案');
    fs.writeFileSync(path.join(artifactDir, 'social-card-stage-executions.json'), JSON.stringify([
      { stage: 'planning', skill: 'repository-card-storyboard' },
      { stage: 'generation', skill: 'xiaohongshu-article-generator' },
    ]));
    const result = resolveSocialSkillTargets({ matches: [{ status: 'confirmed', content_type: 'social', artifact_type: '图文发布文案', file_path: path.join(artifactDir, 'copy.txt') }] });
    assert.deepEqual(result.targets.map((item) => item.skill_id), ['repository-card-storyboard', 'xiaohongshu-article-generator']);
    assert.equal(result.targets[0].role, 'storyboard'); assert.equal(result.targets[1].role, 'copy');
    const planning = buildSocialFeedbackAdjustmentPlanningMessages({ feedback: { linked_social_count: 4 }, targets: result.targets });
    assert.match(planning.system, /故事板只处理页面职责/); assert.match(planning.system, /文案技能只处理标题/);
    const patch = buildSocialFeedbackAdjustmentPatchMessages({ feedback: {}, plan: { target_intents: [{ skill_id: 'repository-card-storyboard', intent: '强化页面信息层级' }] }, skills: { 'repository-card-storyboard': '# 故事板\n原规则。\n' } });
    assert.match(patch.system, /不得新增“复盘反馈/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('图文反馈提取发布文案、故事板和布局成品并形成特征对照', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'social-content-feedback-features-'));
  try {
    const first = path.join(root, 'first'); const second = path.join(root, 'second');
    for (const directory of [first, second]) fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(first, 'copy.txt'), '怎么解决部署难题？\n\n三步完成配置，省下 10 分钟。\n\n注意：未实际运行，请先测试。\n\n关注我看后续。');
    fs.writeFileSync(path.join(first, 'card-plan.json'), JSON.stringify({ pages: [
      { kind: 'cover', title: '三步解决部署问题', evidence: ['README'], content_blocks: [{ type: 'text', content: '部署问题' }] },
      { kind: 'problem', title: '问题', evidence: ['README'], content_blocks: [{ type: 'text', content: '问题' }] },
      { kind: 'capability', title: '能力', evidence: ['README'], content_blocks: [{ type: 'list', content: '能力' }] },
      { kind: 'quickstart', title: '快速开始', evidence: ['README'], content_blocks: [{ type: 'code', content: 'run' }] },
      { kind: 'limitation', title: '限制', evidence: ['README'], content_blocks: [{ type: 'note', content: '限制' }] },
      { kind: 'ending', title: '关注后续', evidence: ['README'], content_blocks: [{ type: 'text', content: '后续' }] },
    ] }));
    fs.writeFileSync(path.join(first, 'layout-report.json'), JSON.stringify({ valid: true, pages: [{ valid: true, utilization: 80, issues: [], overflowPixels: 0, clippedPixels: 0 }] }));
    fs.writeFileSync(path.join(first, 'social-card-stage-executions.json'), JSON.stringify([{ stage: 'planning', skill: 'repository-card-storyboard' }, { stage: 'generation', skill: 'xiaohongshu-article-generator' }]));
    fs.writeFileSync(path.join(second, 'copy.txt'), '工具介绍，没有后续提示。');
    fs.writeFileSync(path.join(second, 'card-plan.json'), JSON.stringify({ pages: [{ kind: 'cover', title: '工具', content_blocks: [{ type: 'text', content: '介绍' }] }] }));
    fs.writeFileSync(path.join(second, 'layout-report.json'), JSON.stringify({ valid: false, pages: [{ valid: false, utilization: 45, issues: ['内容溢出'], overflowPixels: 12, clippedPixels: 2 }] }));
    const rows = [
      { status: 'confirmed', content_type: 'social', artifact_type: '图文发布文案', file_path: path.join(first, 'copy.txt'), metric_id: 1, metric_title: '三步解决部署问题', reads: 1000, shares: 30, follows_after_read: 10, published_date: '2026-08-01' },
      { status: 'confirmed', content_type: 'social', artifact_type: '图文发布文案', file_path: path.join(second, 'copy.txt'), metric_id: 2, metric_title: '工具介绍', reads: 500, shares: 5, follows_after_read: 1, published_date: '2026-08-02' },
      { status: 'confirmed', content_type: 'article', artifact_type: '文章终稿', file_path: path.join(second, 'copy.txt'), metric_id: 3, metric_title: '不应进入图文', reads: 999, shares: 99, follows_after_read: 99, published_date: '2026-08-03' },
    ];
    const features = extractSocialContentFeatures(rows[0]);
    assert.equal(features.copy.has_boundary, true); assert.equal(features.storyboard.page_count, 6); assert.equal(features.layout.valid, true);
    const feedback = buildSocialContentFeedbackSnapshot(rows);
    assert.equal(feedback.linked_social_count, 2); assert.equal(feedback.copy_ready_count, 2); assert.equal(feedback.storyboard_ready_count, 2);
    assert.equal(feedback.layout_summary.overflow_page_count, 1);
    assert.ok(feedback.copy_signals.find((item) => item.id === 'early_benefit').present.sample_count >= 1);
    assert.ok(feedback.storyboard_signals.find((item) => item.id === 'limitation').present.sample_count >= 1);
    assert.deepEqual(feedback.source_metric_ids, [1, 2]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('图文技能草案只融合原有规则，确认后写入技能覆盖目录', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'social-feedback-adjustment-draft-'));
  try {
    fs.mkdirSync(path.join(root, 'skills', 'repository-card-storyboard'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', 'xiaohongshu-article-generator'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'repository-card-storyboard', 'SKILL.md'), '# 故事板\n\n原故事板规则。\n');
    fs.writeFileSync(path.join(root, 'skills', 'xiaohongshu-article-generator', 'SKILL.md'), '# 文案技能\n\n原文案规则。\n');
    const targets = [{ skill_id: 'repository-card-storyboard', role: 'storyboard', sample_count: 4 }, { skill_id: 'xiaohongshu-article-generator', role: 'copy', sample_count: 4 }];
    const draft = buildSocialFeedbackAdjustmentDraft({ workspaceRoot: root, feedback: { id: 3, linked_social_count: 4 }, targets, modelResult: {
      planning: { summary: '强化图文叙事与文案兑现', target_intents: [{ skill_id: 'repository-card-storyboard', intent: '强化页面信息层级' }, { skill_id: 'xiaohongshu-article-generator', intent: '强化标题与发布文案兑现' }] },
      patch: { skill_edits: [
        { skill_id: 'repository-card-storyboard', edits: [{ old_text: '原故事板规则。', new_text: '先明确读者问题，再按事实、机制、结果组织页面。', reason: '强化页面信息层级。' }] },
        { skill_id: 'xiaohongshu-article-generator', edits: [{ old_text: '原文案规则。', new_text: '标题和发布文案必须准确兑现首屏承诺。', reason: '强化标题与发布文案兑现。' }] },
      ] },
    } });
    assert.equal(draft.changes.length, 2); assert.equal(draft.source.scope, 'social');
    assert.ok(!fs.existsSync(path.join(root, 'writing-skills')));
    const result = confirmAdjustmentDraft({ workspaceRoot: root, draft });
    assert.deepEqual(result.written, ['writing-skills/repository-card-storyboard/SKILL.md', 'writing-skills/xiaohongshu-article-generator/SKILL.md']);
    assert.match(fs.readFileSync(path.join(root, 'writing-skills', 'xiaohongshu-article-generator', 'SKILL.md'), 'utf8'), /准确兑现首屏承诺/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('图文文案反哺可以修改技能包中的 TITLE_GUIDE.md，而不把规则误写进 SKILL.md', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'social-feedback-adjustment-guide-'));
  try {
    const skillDir = path.join(root, 'skills', 'xiaohongshu-article-generator'); fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# 文案技能\n读取 TITLE_GUIDE.md。\n');
    fs.writeFileSync(path.join(skillDir, 'TITLE_GUIDE.md'), '# 标题规范\n\n标题先说明具体痛点，再给出可兑现的结果。\n');
    const draft = buildSocialFeedbackAdjustmentDraft({ workspaceRoot: root, feedback: { linked_social_count: 10 }, targets: [{ skill_id: 'xiaohongshu-article-generator', role: 'copy', sample_count: 10 }], modelResult: {
      planning: { summary: '收窄图文标题承诺', target_intents: [{ skill_id: 'xiaohongshu-article-generator', intent: '强化标题痛点与结果兑现' }] },
      patch: { skill_edits: [{ skill_id: 'xiaohongshu-article-generator', file: 'TITLE_GUIDE.md', edits: [{ old_text: '标题先说明具体痛点，再给出可兑现的结果。', new_text: '标题先说明具体痛点，再给出事实基座能够支持的结果。', reason: '强化标题承诺的可兑现性。' }] }] },
    } });
    assert.equal(draft.changes.length, 1); assert.equal(draft.changes[0].file, 'TITLE_GUIDE.md'); assert.equal(draft.changes[0].path, 'writing-skills/xiaohongshu-article-generator/TITLE_GUIDE.md');
    assert.match(draft.changes[0].source_path, /skills[\\/]xiaohongshu-article-generator[\\/]TITLE_GUIDE\.md/);
    assert.ok(!fs.existsSync(path.join(root, 'writing-skills')));
    confirmAdjustmentDraft({ workspaceRoot: root, draft });
    assert.ok(fs.existsSync(path.join(root, 'writing-skills', 'xiaohongshu-article-generator', 'TITLE_GUIDE.md')));
    assert.match(fs.readFileSync(path.join(root, 'writing-skills', 'xiaohongshu-article-generator', 'TITLE_GUIDE.md'), 'utf8'), /事实基座能够支持/);
    assert.match(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), /读取 TITLE_GUIDE/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('图文反哺接口独立于文章反馈快照，并以 thinking 两阶段生成草案', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'social-feedback-adjustment-route-'));
  const store = new Store(path.join(root, 'workbench.db'));
  try {
    let responseBody; let responseStatus; const calls = [];
    const handled = await handleContentRoutes({ request: { method: 'POST' }, response: {}, pathname: '/api/wechat/feedback/adjustments/generate', searchParams: new URLSearchParams(), store, artifactRoots: [], mime: {}, root, body: async () => ({ scope: 'social' }), models: { complete: async ({ purpose, thinking }) => { calls.push({ purpose, thinking }); return { provider: 'fake', model: 'fake', content: JSON.stringify(purpose.endsWith('plan') ? { summary: '图文校准', target_intents: [], warnings: [] } : { skill_edits: [], warnings: [] }) }; } }, json: (_response, status, value) => { responseStatus = status; responseBody = value; } });
    assert.equal(handled, true); assert.equal(responseStatus, 200); assert.equal(responseBody.status, 'no_change'); assert.equal(responseBody.saved, false); assert.equal(store.listContentFeedbackAdjustmentDrafts({ limit: 10 }).length, 0);
    assert.deepEqual(calls.map((item) => item.purpose), ['social-feedback-adjustment-plan', 'social-feedback-adjustment-patch']); assert.ok(calls.every((item) => item.thinking === true));
  } finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('图文反馈可以通过独立接口重新计算，不依赖文章反馈快照', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'social-feedback-rebuild-'));
  const store = new Store(path.join(root, 'workbench.db'));
  try {
    let responseBody; let responseStatus;
    const handled = await handleContentRoutes({ request: { method: 'POST' }, response: {}, pathname: '/api/wechat/feedback/rebuild-social', searchParams: new URLSearchParams(), store, artifactRoots: [], mime: {}, root, body: async () => ({}), json: (_response, status, value) => { responseStatus = status; responseBody = value; } });
    assert.equal(handled, true); assert.equal(responseStatus, 200); assert.equal(responseBody.status, 'ok'); assert.equal(responseBody.count, 0);
  } finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('复盘反馈为素材生成目标、标题结构和下一步验证提示，并支持复盘优先排序', () => {
  const feedback = {
    confidence: 'medium',
    topic_signals: [{ label: '开发者工具', sample_count: 4, avg_reads: 1200, follows_per_thousand_reads: 5 }],
    title_signals: [{ label: '结果 / 数字承诺', sample_count: 4, avg_reads: 1200 }],
  };
  const insights = buildWechatInsights([{ title: 'PDF 工具：10ms 转 Markdown', reads: 1200, follows_after_read: 6 }]);
  const material = { title: 'PDF 工具怎么选', raw_text: '我测试了一个 PDF 工具，结果节省了时间。', assessment: { account_fit: { level: 'high' }, completeness: { level: 'medium' }, topic_potential: { level: 'high' } } };
  const recommendation = buildContentPlanningRecommendation(material, { feedback, insights });
  assert.equal(recommendation.recommended_topic, '开发者工具');
  assert.equal(recommendation.recommended_title_structure, '结果 / 数字承诺');
  assert.equal(recommendation.target_label, '涨粉');
  assert.match(recommendation.validation_question, /验证/);
  assert.match(recommendation.next_teaser, /下一篇预告/);
  const sorted = sortMaterialsByPlanningRecommendation([{ id: 1, updated_at: '2026-08-30T00:00:00Z', planning_recommendation: { priority_score: 20 } }, { id: 2, updated_at: '2026-08-29T00:00:00Z', planning_recommendation: { priority_score: 80 } }]);
  assert.deepEqual(sorted.map((item) => item.id), [2, 1]);
});

test('账号策略建议至少要求两个不同内容周期，并只输出待确认草案', () => {
  const base = { linked_article_count: 4, confidence: 'medium', topic_signals: [{ label: '开发者工具', sample_count: 4, avg_reads: 1200, total_reads: 4800, total_follows: 24, follows_per_thousand_reads: 5 }], title_signals: [{ label: '结果 / 数字承诺', sample_count: 4, avg_reads: 1200, total_reads: 4800, total_follows: 24, follows_per_thousand_reads: 5 }] };
  const blocked = buildWechatStrategyRecommendations({ snapshots: [{ ...base, id: 1, metric_window_start: '2026-08-01', metric_window_end: '2026-08-15' }] });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.cycle_count, 1);
  const ready = buildWechatStrategyRecommendations({ snapshots: [{ ...base, id: 2, metric_window_start: '2026-08-16', metric_window_end: '2026-08-30' }, { ...base, id: 1, metric_window_start: '2026-08-01', metric_window_end: '2026-08-15' }], accountContext: { contentRatio: { '开源项目、工具与工程实践': '60%', '开发者职场与切身利益': '20%', '平台事件与科技商业影响': '15%', '技术认知与原创长文': '5%' } }, review: { articles: [] } });
  assert.equal(ready.ready, true);
  assert.equal(ready.cycle_count, 2);
  assert.ok(ready.suggestions.some((item) => item.type === 'contentRatio'));
  assert.ok(ready.suggestions.some((item) => item.type === 'packaging'));
  assert.ok(ready.caveats.some((item) => item.includes('不会自动写入')));
});
