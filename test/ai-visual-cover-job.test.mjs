import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { Store } from '../server/platform/core/store.mjs';
import { getBuiltinThemeRegistry } from '../server/shared/themes/theme-registry.mjs';
import { runAiVisualCoverJob } from '../server/features/articles/application/ai-visual-cover-generator.mjs';

for (const custom of [false, true]) {
test(`AI 封面 Pipeline 冻结输入、直接截图并登记交付产物（${custom ? '自定义' : '内置'}主题）`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cover-job-'));
  const store = new Store(path.join(root, 'cover.db'));
  const replies = [
    JSON.stringify({ type: 'tool_requests', assistant_note: '追加封面', requests: [{ requestId: 'tr_cover_append_job', capability: 'cap_filesystem_project_document_write', arguments: { operation: 'append', content: '<!doctype html><html><head><style>.page{width:900px;height:383px;background:#111;color:#fff;border:2px solid #e8b84b}.decor{background:linear-gradient(90deg,#111,#e8b84b)}</style></head><body><main class="page"><i class="decor"></i><h1>模型直接生成的标题</h1><p>模型直接生成的摘要</p><small>模型直接生成的信息</small></main></body></html>' }, reason: '追加封面 HTML' }] }),
    JSON.stringify({ type: 'tool_requests', assistant_note: '完成封面', requests: [{ requestId: 'tr_cover_finish_job', capability: 'cap_filesystem_project_document_write', arguments: { operation: 'finish' }, reason: '完成封面写入' }] }),
    JSON.stringify({ type: 'final', assistantReply: '已完成 AI 视觉封面 HTML 生成' }),
  ];
  const batch = store.createBatch({ date: '2026-08-30', title: '封面测试批次' });
  let candidateId;
  try {
    if (custom) {
      const definition = { ...structuredClone(getBuiltinThemeRegistry().require('cover-navy-gold')), id: 'custom-cold-cover', label: '冷白庄重', source: 'user' };
      delete definition.file;
      store.getUserTheme = (id) => id === definition.id ? { status: 'published', active_version_id: 1, active_definition_json: JSON.stringify(definition) } : null;
    }
    const hotspot = store.addManualHotspot(batch.id, { title: '封面测试热点' });
    candidateId = store.addCandidates(batch.id, [hotspot.id], { tracks: ['article'] })[0].id;
    const gateway = {
      config: { defaultProvider: 'mock', providers: { mock: { model: 'mock-model', maxOutputTokens: 5000 } } },
      resolve() { return { provider: this.config.providers.mock }; },
      async complete(request) {
        if (request.purpose === 'cover-semantic-analysis') return { callId: 'semantic-1', model: 'mock-model', content: JSON.stringify({ highlightTerms: ['测试'], motifKind: 'network' }) };
        return { callId: `cover-${replies.length}`, model: 'mock-model', content: replies.shift() };
      },
    };
    const result = await runAiVisualCoverJob({
      gateway,
      store,
      batchId: batch.id,
      candidateId,
      provider: 'mock',
      workspaceRoot: process.cwd(),
      workdir: path.join(root, 'article'),
      title: '测试标题',
      summary: '这是用于验证封面直出流程的测试摘要。',
      brand: '测试号 · 2026.08',
      themeId: custom ? 'custom-cold-cover' : 'cover-navy-gold',
      renderExecute: async ({ outputDir }) => {
        const image = path.join(outputDir, 'page-01.png');
        fs.writeFileSync(image, Buffer.from('fake-png'));
        return { success: true, data: { images: [image] } };
      },
    });
    const imageDir = path.join(root, 'article', 'images');
    assert.equal(result.mode, 'ai-visual');
    assert.equal(result.width, 900);
    assert.equal(result.height, 383);
    assert.equal(fs.existsSync(path.join(imageDir, 'cover.png')), true);
    assert.equal(fs.existsSync(path.join(imageDir, 'ai-cover.html')), true);
    assert.equal(fs.existsSync(path.join(imageDir, 'cover.html')), true);
    assert.equal(fs.existsSync(path.join(imageDir, 'cover-visual-input.json')), true);
    assert.equal(fs.existsSync(path.join(imageDir, 'cover-theme-snapshot.json')), true);
    assert.equal(fs.existsSync(path.join(imageDir, 'cover-theme-design-spec.md')), true);
    if (custom) assert.match(fs.readFileSync(path.join(imageDir, 'cover-theme-design-spec.md'), 'utf8'), /冷白庄重/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(imageDir, 'cover-ai-delivery-gate.json'), 'utf8')).status, 'passed');
    assert.match(fs.readFileSync(path.join(imageDir, 'cover.html'), 'utf8'), /模型直接生成的标题/);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(imageDir, 'cover-ai-delivery-gate.json'), 'utf8')).checks), ['image']);
    assert.doesNotMatch(fs.readFileSync(path.join(imageDir, 'cover.html'), 'utf8'), /<script>/);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
}
