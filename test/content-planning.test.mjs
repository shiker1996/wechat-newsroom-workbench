import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../server/platform/core/store.mjs';
import { parseWechatExport } from '../server/features/content-planning/wechat-export-parser.mjs';
import { buildWechatInsights, classifyWechatArticle, matchWechatPerformance } from '../server/features/content-planning/wechat-content-insights.mjs';
import { buildContentFeedbackSnapshot, buildContentFeedbackPromptContext, extractArticleContentFeatures } from '../server/features/content-planning/wechat-content-feedback.mjs';
import { buildContentPlanningRecommendation, sortMaterialsByPlanningRecommendation } from '../server/features/content-planning/content-planning-recommendations.mjs';
import { buildWechatStrategyRecommendations } from '../server/features/content-planning/wechat-strategy-recommendations.mjs';

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
  const make = (id, reads, follows, content) => ({ metric_id: id, import_batch_id: 1, metric_title: 'PDF 工具：3 步转 Markdown', published_date: `2026-08-${String(id).padStart(2, '0')}`, reads, follows_after_read: follows, content_status: 'ok', features: extractArticleContentFeatures({ source_kind: 'local_final', title: 'PDF 工具：3 步转 Markdown', content }, { metricTitle: 'PDF 工具：3 步转 Markdown', evidenceAssets: [{ asset_type: 'screenshot' }] }), evidence_assets: [{ asset_type: 'screenshot' }] });
  const rows = [1, 2, 3].map((id) => make(id, id * 100, id, '# PDF 工具：3 步转 Markdown\n\n问题是整理 PDF 太慢。\n\n## 结果\n\n最终节省 10 分钟。'));
  const feedback = buildContentFeedbackSnapshot(rows, { review: { channels: [{ channel: '公众号消息', reads: 220 }] } });
  assert.equal(feedback.linked_article_count, 3);
  assert.equal(feedback.confidence, 'medium');
  assert.ok(feedback.topic_signals.some((item) => item.label === '开发者工具'));
  assert.ok(feedback.title_signals.some((item) => item.label === '结果 / 数字承诺'));
  assert.ok(feedback.body_signals.some((item) => item.id === 'opening_problem'));
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
  const savedFeedback = store.saveContentFeedbackSnapshot(buildContentFeedbackSnapshot([{ ...metric, metric_id: metric.id, metric_title: metric.title, content_status: 'ok', snapshot_id: snapshot.id, source_kind: snapshot.source_kind, features, evidence_assets: [] }], { review: {} }));
  assert.equal(store.getLatestContentFeedbackSnapshot().id, savedFeedback.id);
  assert.equal(store.getArticleContentFeatures(snapshot.id).features.content_chars, features.content_chars);
});

test('反馈快照注入上下文只作为不可信参考，按标题和写作目标裁剪', () => {
  const feedback = { confidence: 'medium', metric_window_start: '2026-08-01', metric_window_end: '2026-08-30', topic_signals: [{ label: 'AI 工具', sample_count: 3 }], title_signals: [{ label: '结果 / 数字承诺', sample_count: 3 }], body_signals: [{ label: '有真实证据资产', sample_count: 3 }], recommendations: [{ type: 'title', target: '标题', text: '可尝试结果型标题' }, { type: 'body', target: '正文', text: '补充失败边界' }], unresolved_questions: ['样本仍然有限'] };
  const title = buildContentFeedbackPromptContext(feedback, { target: 'title' });
  const writing = buildContentFeedbackPromptContext(feedback, { target: 'writing' });
  assert.match(title, /untrusted-data/); assert.match(title, /结果 \/ 数字承诺/); assert.doesNotMatch(title, /补充失败边界/);
  assert.match(writing, /有真实证据资产/); assert.match(writing, /补充失败边界/); assert.doesNotMatch(writing, /结果 \/ 数字承诺/);
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
