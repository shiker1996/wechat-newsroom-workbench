import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/core/store.mjs';
import { runEditorialTurn } from '../lib/llm/editorial-room.mjs';

test('锁定期间完成的编辑会请求不能覆盖已锁定简报', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'editorial-lock-'));
  const store = new Store(path.join(tempRoot, 'test.db'));
  try {
    const batch = store.createBatch({ date: '2026-08-10', title: '并发锁定测试' });
    store.addHotspots(batch.id, 'manual', [{ title: '测试选题', url: 'https://example.com/topic' }]);
    const hotspot = store.getBatch(batch.id).hotspots[0];
    const candidate = store.addCandidates(batch.id, [hotspot.id], { tracks: ['article'] })[0];
    store.updateCandidate(candidate.id, { angle: '锁定角度', thesis: '锁定命题' });
    store.saveEditorial(candidate.id, { confirmed_facts: '锁定前事实', next_action: 'WRITE_NOW', brief_status: 'WRITE_NOW' });

    let release;
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const gateway = {
      config: { defaultProvider: 'mock', providers: { mock: { maxOutputTokens: 4096 } } },
      async complete() {
        markStarted();
        await new Promise((resolve) => { release = resolve; });
        return {
          content: JSON.stringify({
            assistantReply: '这是一条迟到的编辑会回复',
            nextQuestion: '',
            candidateUpdates: { angle: '不应覆盖的角度', thesis: '不应覆盖的命题' },
            editorial: { confirmed_facts: '不应覆盖的事实', next_action: 'WRITE_NOW' },
            fetchEvents: ['E001'],
          }),
          finishReason: 'stop',
          usage: { total_tokens: 10 },
          model: 'mock',
        };
      },
    };

    const pending = runEditorialTurn({ gateway, store, candidateId: candidate.id, provider: 'mock', workspaceRoot: process.cwd() });
    await started;
    store.saveEditorial(candidate.id, { brief_status: 'LOCKED' });
    store.updateCandidate(candidate.id, { status: 'locked' });
    release();

    const result = await pending;
    const saved = store.getCandidate(candidate.id);
    assert.equal(result.ignoredBecauseLocked, true);
    assert.equal(saved.editorial.brief_status, 'LOCKED');
    assert.equal(saved.editorial.confirmed_facts, '锁定前事实');
    assert.equal(saved.angle, '锁定角度');
    assert.equal(saved.thesis, '锁定命题');
    assert.deepEqual(result.fetchEvents, []);
    assert.match(store.listEditorialMessages(candidate.id).at(-1).content, /迟到的编辑会回复/);
  } finally {
    store.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('编辑室互斥成稿按钮，编辑器以锁定状态或已有文稿兜底展示', () => {
  const editorial = fs.readFileSync(new URL('../public/src/views/editorial.js', import.meta.url), 'utf8');
  const editor = fs.readFileSync(new URL('../public/src/views/editor.js', import.meta.url), 'utf8');
  assert.match(editorial, /editorialRequestPending = true/);
  assert.match(editorial, /btn\.disabled = editorialRequestPending/);
  assert.match(editorial, /请等待 AI 编辑回应完成后再开始成稿/);
  assert.match(editor, /item\.status === "locked" \|\| item\.brief_status === "LOCKED" \|\| documentedCandidateIds\.has/);
});
