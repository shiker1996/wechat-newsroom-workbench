import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { indexArticleArtifacts, normalizeTitle } from '../server/platform/artifacts/article-artifact-indexer.mjs';
import { Store } from '../server/platform/core/store.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'article-index-'));
  const store = new Store(path.join(root, 'workbench.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store };
}

test('本地文章索引提取标题、日期、版本、证据并关联发布计划', (t) => {
  const { root, store } = fixture(t);
  const articleDir = path.join(root, 'articles', '2026-08-20-index-demo');
  const evidenceDir = path.join(articleDir, 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const finalPath = path.join(articleDir, '09-FINAL.md');
  fs.writeFileSync(finalPath, '---\npublish_url: https://mp.weixin.qq.com/s/index-demo\n---\n\n# 本地文章索引测试\n\n正文。', 'utf8');
  fs.writeFileSync(path.join(articleDir, '04-draft.md'), '# 本地文章索引测试\n\n草稿。', 'utf8');
  fs.writeFileSync(path.join(articleDir, 'article.ai.html'), '<html><head><title>本地文章索引测试</title></head><body><h1>本地文章索引测试</h1></body></html>', 'utf8');
  const copyPath = path.join(root, 'social-cards', '2026-08-20-social-demo-c001', 'copy.txt');
  fs.mkdirSync(path.dirname(copyPath), { recursive: true });
  fs.writeFileSync(copyPath, '本地发布文案标题：这个工具让部署简单很多\n\n正文。', 'utf8');
  fs.writeFileSync(path.join(evidenceDir, 'screenshot.png'), 'fake-image', 'utf8');

  const material = store.createWritingMaterial({ sourceType: 'project', title: '本地文章索引测试', rawText: '素材。' });
  const column = store.listContentColumns()[0];
  const plan = store.createWritingPlan({ materialId: material.id, columnId: column.id, titleDirection: '本地文章索引测试', plannedDate: '2026-08-20', status: 'done' });
  const batch = store.createBatch({ date: '2026-08-20', title: '文章索引批次' });
  const document = store.saveDocument({ batchId: batch.id, kind: 'final', title: '本地文章索引测试', content: '# 本地文章索引测试\n\n正文。', filePath: finalPath, status: 'finalized' });
  store.saveArticlePublication({ planId: plan.id, documentId: document.id, contentUrl: 'https://mp.weixin.qq.com/s/index-demo', publishedAt: '2026-08-21', titleAtPublish: '本地文章索引测试' });

  const first = indexArticleArtifacts(store, [root]);
  assert.equal(first.files_seen, 4);
  assert.equal(first.indexed, 4);
  const final = store.listArticleArtifacts().find((item) => item.file_path === finalPath);
  assert.equal(final.title, '本地文章索引测试');
  assert.equal(final.article_date, '2026-08-20');
  assert.equal(final.version_label, '终稿');
  assert.equal(final.content_url, 'https://mp.weixin.qq.com/s/index-demo');
  assert.equal(final.document_id, document.id);
  assert.equal(final.plan_id, plan.id);
  assert.equal(final.material_id, material.id);
  assert.equal(final.column_id, column.id);
  assert.ok(final.evidence_paths.some((item) => item.endsWith('screenshot.png')));
  assert.equal(normalizeTitle('“本地文章索引测试”'), '本地文章索引测试');

  const social = store.listArticleArtifacts().find((item) => item.file_path === copyPath);
  assert.equal(social.title, '本地发布文案标题：这个工具让部署简单很多');
  assert.equal(social.artifact_type, '图文发布文案');
  assert.equal(social.version_label, '图文发布文案');

  const second = indexArticleArtifacts(store, [root]);
  assert.equal(second.indexed, 4);
  assert.equal(store.listArticleArtifacts().length, 4);
  assert.equal(store.articleArtifactStats().total, 4);
  assert.equal(store.articleArtifactStats().latest_run.status, 'completed');
});

test('批次早报 daily/03-FINAL.md 进入可匹配的文章终稿索引', (t) => {
  const { root, store } = fixture(t);
  const dailyPath = path.join(root, 'articles', 'batch-early-report', 'daily', '03-FINAL.md');
  fs.mkdirSync(path.dirname(dailyPath), { recursive: true });
  fs.writeFileSync(dailyPath, '# 今天的大厂早报\n\n早报正文。', 'utf8');

  const result = indexArticleArtifacts(store, [root]);
  assert.equal(result.files_seen, 1);
  const daily = store.listArticleArtifacts().find((item) => item.file_path === dailyPath);
  assert.equal(daily.artifact_type, '早报终稿');
  assert.equal(daily.version_label, '早报终稿');
  assert.equal(daily.title, '今天的大厂早报');
  assert.ok(store.listWechatMatchArtifacts().some((item) => item.id === daily.id));
});
