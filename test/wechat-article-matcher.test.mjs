import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { matchWechatArticle, matchWechatArticles, matchWechatSocialCopy } from '../server/features/content-planning/wechat-article-matcher.mjs';
import { fetchWechatArticleContent, linkWechatArticleContent } from '../server/features/content-planning/article-content-linker.mjs';
import { Store } from '../server/platform/core/store.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-match-'));
  const store = new Store(path.join(root, 'workbench.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store };
}

test('公众号文章匹配按 URL、标题、规范化标题和相似度分级', () => {
  const artifacts = [{ id: 1, title: 'PDF 处理神器：10ms 分类', normalized_title: 'pdf处理神器10ms分类', article_date: '2026-08-20', version_label: '终稿', artifact_type: '文章终稿', content_url: 'https://mp.weixin.qq.com/s/exact' }];
  assert.equal(matchWechatArticle({ title: '其他标题', published_date: '2026-08-20', content_url: 'https://mp.weixin.qq.com/s/exact' }, artifacts).status, 'auto_confirmed');
  assert.equal(matchWechatArticle({ title: '其他标题', published_date: '2026-08-20', content_url: 'https://mp.weixin.qq.com/s/exact' }, artifacts).contentType, 'article');
  assert.equal(matchWechatArticle({ title: 'PDF 处理神器：10ms 分类', published_date: '2026-08-20' }, artifacts).method, 'title_exact');
  const normalized = matchWechatArticle({ title: 'PDF处理神器10ms分类', published_date: '2026-08-20' }, artifacts);
  assert.equal(normalized.status, 'pending'); assert.equal(normalized.method, 'title_normalized'); assert.equal(normalized.candidates[0].id, 1);
  const similar = matchWechatArticle({ title: 'PDF 处理工具分类', published_date: '2026-08-20' }, artifacts);
  assert.equal(similar.status, 'pending'); assert.equal(similar.method, 'title_date_similarity');
});

test('图文发布文案可作为独立候选参与匹配，普通文章池只使用终稿', () => {
  const artifacts = [
    { id: 1, title: '图文发布标题：部署简单很多', artifact_type: '图文发布文案', article_date: '2026-08-20', version_label: '图文发布文案' },
    { id: 2, title: '图文发布标题：部署简单很多', artifact_type: '文章初稿', article_date: '2026-08-20', version_label: '初稿' },
  ];
  const social = matchWechatSocialCopy({ title: '图文发布标题：部署简单很多', published_date: '2026-08-20' }, artifacts);
  assert.equal(social.status, 'auto_confirmed');
  assert.equal(social.method, 'social_copy_exact');
  assert.equal(social.contentType, 'social');
  assert.equal(matchWechatArticle({ title: '图文发布标题：部署简单很多', published_date: '2026-08-20' }, artifacts).status, 'unmatched');
});

test('批次早报终稿可按文章类型自动匹配', () => {
  const daily = { id: 9, title: '今天的大厂早报', artifact_type: '早报终稿', article_date: '2026-08-24', version_label: '早报终稿' };
  const result = matchWechatArticle({ title: '今天的大厂早报', published_date: '2026-08-24' }, [daily]);
  assert.equal(result.status, 'auto_confirmed');
  assert.equal(result.contentType, 'article');
  assert.equal(result.articleArtifactId, daily.id);
});

test('自动匹配会落库，人工确认后后续重匹配保留人工决策并留下日志', (t) => {
  const { root, store } = fixture(t);
  const artifactPath = path.join(root, 'articles', '2026-08-20-demo', '09-FINAL.md'); fs.mkdirSync(path.dirname(artifactPath), { recursive: true }); fs.writeFileSync(artifactPath, '# “一篇真实文章”\n', 'utf8');
  const artifact = store.upsertArticleArtifact({ filePath: artifactPath, rootPath: root, artifactType: '文章终稿', title: '“一篇真实文章”', normalizedTitle: '一篇真实文章', articleDate: '2026-08-20', versionLabel: '终稿', fileSize: 20, modifiedAt: new Date().toISOString() });
  const importBatch = store.db.prepare("INSERT INTO wechat_import_batches(file_name,import_type,format,imported_at) VALUES('test.csv','notified_articles','csv',?)").run(new Date().toISOString());
  const metric = store.db.prepare("INSERT INTO wechat_article_metrics(import_batch_id,notified,title,published_date,reads,shares,follows_after_read,content_url) VALUES(?,?,?,?,?,?,?,?)").run(Number(importBatch.lastInsertRowid), 1, '一篇真实文章', '2026-08-20', 100, 3, 2, '');
  const first = matchWechatArticles(store); assert.equal(first.pending, 1);
  const pending = store.listWechatArticleMetricMatches({ status: 'pending' })[0]; assert.equal(pending.candidate_snapshot[0].id, artifact.id);
  const confirmed = store.updateWechatArticleMetricMatch(pending.id, { action: 'confirm', articleArtifactId: artifact.id, note: '人工核对标题和日期' });
  assert.equal(confirmed.status, 'confirmed'); assert.equal(confirmed.article_artifact_id, artifact.id); assert.equal(confirmed.content_type, 'article');
  matchWechatArticles(store); assert.equal(store.getWechatArticleMetricMatch(pending.id).status, 'confirmed');
  const indexed = store.listArticleArtifacts()[0];
  assert.equal(indexed.metric_match_count, 1);
  assert.equal(indexed.metric_reads, 100);
  assert.equal(indexed.metric_shares, 3);
  assert.equal(indexed.metric_follows, 2);
  const logs = store.db.prepare('SELECT action FROM wechat_article_match_logs WHERE match_id=? ORDER BY id').all(pending.id).map((item) => item.action);
  assert.deepEqual(logs, ['rematch', 'confirm']); assert.equal(metric.lastInsertRowid > 0, true);
});

test('未匹配公众号内容保持待判定，并支持按类型手动匹配或跳过产物', (t) => {
  const { root, store } = fixture(t);
  const articlePath = path.join(root, 'articles', '2026-08-22-manual', '09-FINAL.md'); fs.mkdirSync(path.dirname(articlePath), { recursive: true }); fs.writeFileSync(articlePath, '# 手动文章\n', 'utf8');
  const article = store.upsertArticleArtifact({ filePath: articlePath, rootPath: root, artifactType: '文章终稿', title: '手动文章', normalizedTitle: '手动文章', articleDate: '2026-08-22', versionLabel: '终稿', fileSize: 10, modifiedAt: new Date().toISOString() });
  const socialPath = path.join(root, 'social-cards', '2026-08-23-manual', 'copy.txt'); fs.mkdirSync(path.dirname(socialPath), { recursive: true }); fs.writeFileSync(socialPath, '# 手动图文\n', 'utf8');
  const social = store.upsertArticleArtifact({ filePath: socialPath, rootPath: root, artifactType: '图文发布文案', title: '手动图文', normalizedTitle: '手动图文', articleDate: '2026-08-23', versionLabel: '图文发布文案', fileSize: 10, modifiedAt: new Date().toISOString() });
  const batch = store.db.prepare("INSERT INTO wechat_import_batches(file_name,import_type,format,imported_at) VALUES('manual.csv','notified_articles','csv',?)").run(new Date().toISOString());
  const first = store.db.prepare("INSERT INTO wechat_article_metrics(import_batch_id,notified,title,published_date,reads,shares,follows_after_read,content_url) VALUES(?,?,?,?,?,?,?,?)").run(Number(batch.lastInsertRowid), 1, '无法自动匹配的文章', '2026-08-22', 100, 2, 1, '');
  const second = store.db.prepare("INSERT INTO wechat_article_metrics(import_batch_id,notified,title,published_date,reads,shares,follows_after_read,content_url) VALUES(?,?,?,?,?,?,?,?)").run(Number(batch.lastInsertRowid), 0, '无法自动匹配的图文', '2026-08-23', 80, 3, 2, '');
  matchWechatArticles(store);
  const firstMatch = store.getWechatArticleMetricMatchByMetric(Number(first.lastInsertRowid));
  const secondMatch = store.getWechatArticleMetricMatchByMetric(Number(second.lastInsertRowid));
  assert.equal(firstMatch.content_type, 'unknown'); assert.equal(secondMatch.content_type, 'unknown');
  assert.equal(store.listWechatMatchArtifacts().some((item) => item.id === article.id), true);
  assert.equal(store.listWechatMatchArtifacts().some((item) => item.id === social.id), true);
  const skipped = store.updateWechatArticleMetricMatch(secondMatch.id, { action: 'skip', contentType: 'social' });
  assert.equal(skipped.status, 'rejected'); assert.equal(skipped.content_type, 'social'); assert.equal(skipped.article_artifact_id, null);
  const confirmed = store.updateWechatArticleMetricMatch(firstMatch.id, { action: 'confirm', contentType: 'article', articleArtifactId: article.id });
  assert.equal(confirmed.status, 'confirmed'); assert.equal(confirmed.content_type, 'article');
});

test('已确认文章优先关联本地终稿并分类证据资产，公开 URL 失败会保存失败快照', async (t) => {
  const { root, store } = fixture(t);
  const articleDir = path.join(root, 'articles', '2026-08-21-evidence'); fs.mkdirSync(articleDir, { recursive: true });
  const finalPath = path.join(articleDir, '09-FINAL.md'); fs.writeFileSync(finalPath, '# 一篇有证据的文章\n\n这是已经发布的正文。', 'utf8');
  const assets = { screenshot: path.join(articleDir, 'screenshot.png'), log: path.join(articleDir, 'run.log'), diff: path.join(articleDir, 'change.diff'), chart: path.join(articleDir, 'chart.json'), failure: path.join(articleDir, 'failure.txt') };
  for (const filePath of Object.values(assets)) fs.writeFileSync(filePath, 'evidence', 'utf8');
  const artifact = store.upsertArticleArtifact({ filePath: finalPath, rootPath: root, artifactType: '文章终稿', title: '一篇有证据的文章', normalizedTitle: '一篇有证据的文章', articleDate: '2026-08-21', versionLabel: '终稿', fileSize: 20, modifiedAt: new Date().toISOString(), evidencePaths: Object.values(assets) });
  const batch = store.db.prepare("INSERT INTO wechat_import_batches(file_name,import_type,format,imported_at) VALUES('test.csv','notified_articles','csv',?)").run(new Date().toISOString());
  store.db.prepare("INSERT INTO wechat_article_metrics(import_batch_id,notified,title,published_date,reads,shares,follows_after_read,content_url) VALUES(?,?,?,?,?,?,?,?)").run(Number(batch.lastInsertRowid), 1, '一篇有证据的文章', '2026-08-21', 200, 4, 3, '');
  matchWechatArticles(store);
  const match = store.listWechatArticleMetricMatches({ status: 'auto_confirmed' })[0];
  const linked = linkWechatArticleContent(store, { matchId: match.id, root, artifactRoots: [root] });
  assert.equal(linked.status, 'linked_local'); assert.equal(linked.snapshot.source_kind, 'local_final'); assert.match(linked.snapshot.content, /已经发布的正文/);
  assert.deepEqual(new Set(linked.evidence_assets.map((item) => item.asset_type)), new Set(['screenshot', 'log', 'code_diff', 'chart', 'failure']));
  const externalArtifactPath = path.join(root, 'articles', '2026-08-22-missing', '09-FINAL.md');
  store.upsertArticleArtifact({ filePath: externalArtifactPath, rootPath: root, artifactType: '文章终稿', title: '没有本地产物', normalizedTitle: '没有本地产物', articleDate: '2026-08-22', versionLabel: '终稿', fileSize: 0, modifiedAt: new Date().toISOString() });
  const externalBatch = store.db.prepare("INSERT INTO wechat_article_metrics(import_batch_id,notified,title,published_date,reads,shares,follows_after_read,content_url) VALUES(?,?,?,?,?,?,?,?)").run(Number(batch.lastInsertRowid), 1, '没有本地产物', '2026-08-22', 10, 1, 0, 'https://example.com/article');
  matchWechatArticles(store);
  const externalMatch = store.getWechatArticleMetricMatchByMetric(Number(externalBatch.lastInsertRowid));
  const failed = await fetchWechatArticleContent(store, { matchId: externalMatch.id, root, fetchImpl: async () => ({ status: 'error', error: '测试抓取失败', content: '', fetched_at: new Date().toISOString() }) });
  assert.equal(failed.status, 'error'); assert.equal(failed.snapshot.source_kind, 'external_url'); assert.equal(failed.snapshot.error, '测试抓取失败');
});
