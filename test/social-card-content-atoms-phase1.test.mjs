import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSocialCardContentAtoms,
  buildSocialCardContentAtomSnapshot,
  compareSocialCardContentAtomConservation,
  validateSocialCardContentAtoms,
} from '../lib/rendering/social-card-content-atoms.mjs';

test('阶段 1 旧故事板可生成兼容内容原子和稳定兜底来源', () => {
  const plan = [{ kind: 'capability', role: 'feature', title: '能力', evidence: ['README:Features'], content_blocks: [
    { type: 'list', title: '功能', items: ['编辑', '评论'] },
    { type: 'text', content: '支持浏览器内反馈。' },
  ] }];
  const atoms = buildSocialCardContentAtoms(plan);
  assert.equal(atoms.length, 3);
  assert.equal(atoms[0].source_status, 'provided');
  assert.deepEqual(atoms[0].source_refs, ['README:Features']);
  assert.equal(atoms[2].source_status, 'provided');
  assert.equal(validateSocialCardContentAtoms(plan, atoms).valid, true);
});

test('阶段 1 条目级来源优先于页面级来源且原子 id 不重复', () => {
  const plan = [{ kind: 'quickstart', role: 'steps', title: '步骤', evidence: ['README:Usage'], content_blocks: [{
    type: 'steps',
    items: [
      { title: '安装', content: '运行命令', source_refs: ['README:Install'] },
      { title: '启动', content: '打开页面', source_refs: ['README:Run'] },
    ],
  }] }];
  const atoms = buildSocialCardContentAtoms(plan);
  assert.deepEqual(atoms.map((item) => item.source_refs), [['README:Install'], ['README:Run']]);
  assert.equal(new Set(atoms.map((item) => item.id)).size, atoms.length);
});

test('阶段 1 原子快照记录校验结果但不改变渲染故事板', () => {
  const plan = [{ kind: 'content', role: 'concept', title: '说明', content_blocks: [{ type: 'note', content: '注意事项' }] }];
  const before = JSON.stringify(plan);
  const snapshot = buildSocialCardContentAtomSnapshot(plan);
  assert.equal(snapshot.validation.valid, true);
  assert.equal(snapshot.summary.atomCount, 1);
  assert.equal(snapshot.atoms[0].source_status, 'legacy-fallback');
  assert.equal(JSON.stringify(plan), before);
});

test('阶段 1 可以识别来源引用守恒变化', () => {
  const plan = [{ kind: 'content', role: 'feature', title: '说明', evidence: ['README:A'], content_blocks: [{ type: 'text', content: '事实' }] }];
  const before = buildSocialCardContentAtoms(plan);
  const after = [{ ...plan[0], evidence: ['README:B'] }];
  const report = compareSocialCardContentAtomConservation(before, buildSocialCardContentAtoms(after));
  assert.equal(report.atomCountDelta, 0);
  assert.equal(report.sourceRefsPreserved, false);
});
