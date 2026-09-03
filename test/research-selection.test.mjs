import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../server/platform/core/store.mjs';
import { mergeResearchPoints, normalizeRejectedAngles, normalizeResearchPoints } from '../server/features/articles/domain/research-selection.mjs';
import { normalizeResearchCoverageResult, researchCoverageNeedsRevision } from '../server/features/articles/domain/research-coverage.mjs';

test('研判采用点按 point_id 或正文去重，并保留结构化写作信息', () => {
  const points = normalizeResearchPoints([
    { point_id: 'I1', scope: 'internal', kind: 'anomaly', label: '反常点', statement: '宣传与实测存在落差', event_title: '事件一' },
    { point_id: 'I1', scope: 'internal', kind: 'anomaly', statement: '重复点' },
    { scope: 'internal', kind: 'anomaly', statement: '宣传与实测存在落差' },
  ]);
  assert.equal(points.length, 1);
  assert.equal(points[0].event_title, '事件一');
});

test('研判采用点默认追加，删除和清空需要显式操作', () => {
  const current = [{ point_id: 'I1', scope: 'internal', statement: '反常一' }, { point_id: 'R1', scope: 'inter_event', statement: '关系一' }];
  assert.equal(mergeResearchPoints(current, { append: [{ point_id: 'I1', statement: '重复' }, { point_id: 'I2', statement: '反常二' }] }).length, 3);
  assert.deepEqual(mergeResearchPoints(current, { remove: ['I1'] }).map((item) => item.point_id), ['R1']);
  assert.deepEqual(mergeResearchPoints(current, { clear: true }), []);
});

test('研判贴合度结果标准化并拦截核心点缺失', () => {
  const report = normalizeResearchCoverageResult({ status: 'needs_revision', summary: '缺少关系展开', items: [{ point_id: 'R1', status: 'omitted', explanation: '只复述事件' }] });
  assert.equal(report.status, 'needs_revision');
  assert.equal(researchCoverageNeedsRevision(report), true);
});

test('研判贴合度检查识别明确舍弃方向被重新写回', () => {
  const rejected = normalizeRejectedAngles('不写海外市场对比：当前证据不足');
  const report = normalizeResearchCoverageResult({ status: 'pass', rejected_point_leakage: rejected });
  assert.equal(report.rejected_point_leakage.length, 1);
  assert.equal(researchCoverageNeedsRevision(report), true);
});

test('编辑底稿持久化结构化研判采用点', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-selection-'));
  const store = new Store(path.join(root, 'test.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const batch = store.createBatch({ date: '2026-09-03', title: '研判采用点' });
  store.addHotspots(batch.id, 'manual', [{ title: '事件', url: 'https://example.com/event' }]);
  const hotspot = store.getBatch(batch.id).hotspots[0];
  const candidate = store.addCandidates(batch.id, [hotspot.id], { tracks: ['article'] })[0];
  store.saveEditorial(candidate.id, { adopted_research_points: [{ point_id: 'I1', scope: 'internal', kind: 'anomaly', statement: '宣传与实测存在落差' }] });
  assert.deepEqual(store.getEditorial(candidate.id).adopted_research_points.map((item) => item.point_id), ['I1']);
});
