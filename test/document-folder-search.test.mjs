import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getToolRegistry } from '../server/platform/tools/index.mjs';
import { attachInformationSearch } from '../server/platform/integrations/information-search.mjs';

function makeVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-vault-'));
  fs.writeFileSync(path.join(root, '笔记方法.md'), '# 卡片笔记法\n\n卡片笔记法强调原子化记录，每条笔记只讲一件事。\n', 'utf8');
  fs.mkdirSync(path.join(root, 'projects'));
  fs.writeFileSync(path.join(root, 'projects', '写作系统.md'), '写作流水线包含采集、研判和成稿三个阶段。\n卡片笔记法可以作为素材来源。\n', 'utf8');
  fs.writeFileSync(path.join(root, '无关.md'), '购物清单：牛奶、鸡蛋。\n', 'utf8');
  fs.mkdirSync(path.join(root, '.obsidian'));
  fs.writeFileSync(path.join(root, '.obsidian', 'app.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(root, '图片附件.png.txt.md.png'), 'binary', 'utf8');
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('document-folder-search ranks vault notes and returns sourced snippets', async () => {
  const { root, cleanup } = makeVault();
  try {
    const registry = await getToolRegistry();
    const result = await registry.execute('cap_content_document_search', { query: '卡片笔记法', root, maxResults: 5 }, { allowedRoots: [root] });
    assert.equal(result.status, 'ok');
    assert.equal(result.provenance.plugin, 'document-folder-search');
    assert.equal(result.data.documents.length, 2);
    const [first] = result.data.documents;
    assert.equal(first.docId, '笔记方法.md');
    assert.equal(first.title, '卡片笔记法');
    assert.ok(first.score > result.data.documents[1].score);
    assert.match(first.snippet, /卡片笔记法/);
    assert.match(first.lineRange, /^\d+-\d+$/);
    assert.equal(first.scope, root);
  } finally { cleanup(); }
});

test('document search skips dot directories, non-text files and empty hits', async () => {
  const { root, cleanup } = makeVault();
  try {
    const registry = await getToolRegistry();
    const empty = await registry.execute('cap_content_document_search', { query: '量子引力', root }, { allowedRoots: [root] });
    assert.equal(empty.status, 'ok');
    assert.equal(empty.data.documents.length, 0);
    assert.ok(empty.warnings.some((item) => /没有命中/.test(item)));
    const app = await registry.execute('cap_content_document_search', { query: 'app json', root }, { allowedRoots: [root] });
    assert.equal(app.status, 'ok');
    assert.equal(app.data.documents.length, 0);
  } finally { cleanup(); }
});

test('document search rejects queries without effective keywords and roots outside authorization', async () => {
  const { root, cleanup } = makeVault();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-outside-'));
  try {
    const registry = await getToolRegistry();
    const short = await registry.execute('cap_content_document_search', { query: '的 了', root }, { allowedRoots: [root] });
    assert.equal(short.status, 'error');
    assert.equal(short.error.code, 'INVALID_INPUT');
    const denied = await registry.execute('cap_content_document_search', { query: '卡片笔记', root: outside }, { allowedRoots: [root] });
    assert.equal(denied.status, 'error');
    assert.equal(denied.error.code, 'PATH_OUTSIDE_ALLOWED_ROOTS');
  } finally {
    cleanup();
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('attachInformationSearch merges document findings across authorized roots', async () => {
  const { root, cleanup } = makeVault();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-work-'));
  try {
    const fact = { topic: '卡片笔记法' };
    const result = await attachInformationSearch({
      fact, input: { enableDocumentSearch: true }, root: work,
      toolContext: {}, documentRoots: [root],
    });
    assert.deepEqual(result.attached, ['document_search']);
    assert.equal(fact.document_search.provider, 'document-folder-search');
    assert.equal(fact.document_search.documents.length, 2);
    assert.equal(fact.document_search.documents[0].docId, '笔记方法.md');
    assert.equal('results' in fact.document_search, false);
  } finally {
    cleanup();
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('document search without configured roots degrades to a note', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-work-'));
  try {
    const fact = { topic: '卡片笔记法' };
    const result = await attachInformationSearch({
      fact, input: { enableDocumentSearch: 'true' }, root: work, toolContext: {}, documentRoots: [],
    });
    assert.deepEqual(result.attached, []);
    assert.ok(result.notes.some((item) => /未配置授权知识库目录/.test(item)), JSON.stringify(result.notes));
    assert.equal('document_search' in fact, false);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});
