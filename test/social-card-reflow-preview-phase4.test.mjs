import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSocialCardReflowPreview } from '../lib/rendering/social-card-reflow-preview.mjs';

test('reflow preview exposes continuation pages without raw copy', () => {
  const before = [{ title: '功能清单', content_blocks: [{ type: 'list', items: ['a', 'b', 'c'] }] }];
  const after = [
    { title: '功能清单', page_group_id: 'storyboard-page-1', continuation_of: 1, continuation_index: 1, content_blocks: [{ type: 'list', items: ['a'] }] },
    { title: '功能清单（续）', page_group_id: 'storyboard-page-1', continuation_of: 1, continuation_index: 2, content_blocks: [{ type: 'list', items: ['b', 'c'] }] },
  ];
  const preview = buildSocialCardReflowPreview({ beforePlan: before, afterPlan: after, operations: [{ op: 'split_page', page: 1, groups: [{ blocks: [{ block: 0, items: [0] }] }, { blocks: [{ block: 0, items: [1, 2] }] }] }] });
  assert.equal(preview.beforePageCount, 1);
  assert.equal(preview.afterPageCount, 2);
  assert.equal(preview.pageDelta, 1);
  assert.equal(preview.addedPages[0].continuationIndex, 2);
  assert.equal(preview.addedPages[0].blocks[0].itemCount, 2);
  assert.equal('a' in preview.addedPages[0], false);
  assert.equal(preview.requiresRegeneration, true);
  assert.equal(preview.htmlUpdated, false);
  assert.equal(preview.pngUpdated, false);
});

test('empty preview remains safe for non-structural edits', () => {
  const preview = buildSocialCardReflowPreview({ beforePlan: [{ title: 'P1' }], afterPlan: [{ title: 'P1 新' }] });
  assert.equal(preview.pageDelta, 0);
  assert.deepEqual(preview.addedPages, []);
  assert.equal(preview.operationCount, 0);
});
