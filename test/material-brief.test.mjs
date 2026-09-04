import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../server/platform/core/store.mjs';
import { materialBriefReadiness, materialBriefPointLines } from '../server/features/content-planning/material-brief-service.mjs';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'material-brief-'));
  const store = new Store(path.join(root, 'workbench.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return store;
}

test('素材简报只有明确选择候选主线且补齐边界后才可锁定', () => {
  const base = {
    mainlineCandidates: [{ id: 'mainline-1', title: '主线', thesis: '观点', counter_argument: '限制', argument: ['论据'] }],
    factSummary: [{ id: 'fact-1', text: '事实' }],
    tension: '反差',
    audience: '目标读者',
    selectedMainlineId: '',
  };
  assert.equal(materialBriefReadiness(base).ready, false);
  assert.ok(materialBriefReadiness(base).flags.includes('待补主线'));
  assert.equal(materialBriefReadiness({ ...base, selectedMainlineId: 'mainline-1' }).ready, true);
  assert.ok(materialBriefReadiness({ ...base, selectedMainlineId: 'mainline-1', missingEvidence: ['待核验'] }).flags.includes('待补证据'));
  assert.ok(materialBriefReadiness({ ...base, selectedMainlineId: 'mainline-1', mainlineCandidates: [{ ...base.mainlineCandidates[0], counter_argument: '' }] }).flags.includes('待补边界'));
});

test('素材简报要点优先使用作者当前手工编辑的输入', () => {
  const lines = materialBriefPointLines({
    authorExperienceConfirmed: false,
    factSummary: [{ text: '素材事实' }],
    mainlineCandidates: [{ id: 'mainline-1', thesis: '观点', argument: ['模型建议'] }],
    selectedMainlineId: 'mainline-1',
  });
  assert.deepEqual(lines, ['【素材】素材事实', '【建议】模型建议']);
});

test('素材简报拒绝不存在的素材，并禁止通过 PATCH 越过确认门槛', (t) => {
  const store = workspace(t);
  const material = store.createWritingMaterial({ sourceType: 'text', title: '真实素材', rawText: '正文' });
  assert.throws(() => store.createWritingMaterialBrief({ materialIds: [999999] }), /素材不存在/);
  assert.equal(store.listWritingMaterialBriefs().length, 0);
  const brief = store.createWritingMaterialBrief({ materialIds: [material.id] });
  assert.throws(() => store.updateWritingMaterialBrief(brief.id, { status: 'confirmed' }), /确认接口/);
  assert.throws(() => store.updateWritingMaterialBrief(brief.id, { materialIds: [999999] }), /素材不存在/);
  assert.deepEqual(store.getWritingMaterialBrief(brief.id).materialIds, [material.id]);
});
