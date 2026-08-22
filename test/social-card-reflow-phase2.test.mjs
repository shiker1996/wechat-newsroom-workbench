import test from 'node:test';
import assert from 'node:assert/strict';
import { getSocialCardTemplatePack } from '../lib/rendering/social-card-template-registry.mjs';
import { resolveSocialCardCapacityProfile } from '../lib/rendering/social-card-capacity.mjs';
import { compileTemplateAwareCardPlan, estimateSocialCardPageLoad } from '../lib/rendering/social-card-reflow.mjs';

function profile(pack = 'brutalist-v1') {
  return resolveSocialCardCapacityProfile({
    templatePack: getSocialCardTemplatePack(pack),
    themeDefinition: { id: 'phase2-test', version: '1', hash: 'test', tokens: {} },
    channelMode: 'xiaohongshu',
    contentType: 'repository',
  });
}

function listPage(items, role = 'feature') {
  return { kind: 'content', role, title: '关键能力', content_blocks: [{ type: 'list', title: '要点清单', items }] };
}

test('模板感知预检会拆分超载列表且不丢失事实', () => {
  const items = Array.from({ length: 9 }, (_, index) => `第${index + 1}条：这是用于验证模板容量的完整事实描述，不能被静默删除。`);
  const result = compileTemplateAwareCardPlan({
    cardPlan: [{ kind: 'cover', title: '封面', content_blocks: [] }, listPage(items), { kind: 'ending', title: '结尾', content_blocks: [] }],
    capacityProfile: profile(),
    maxPages: 7,
  });
  assert.equal(result.changed, true);
  assert.ok(result.finalPageCount >= 4);
  assert.deepEqual(result.pages[0].kind, 'cover');
  assert.deepEqual(result.pages.at(-1).kind, 'ending');
  const outputItems = result.pages.slice(1, -1).flatMap((page) => page.content_blocks.flatMap((block) => block.items || []));
  assert.deepEqual(outputItems, items);
  assert.ok(result.operations.some((item) => item.op === 'split_block'));
});

test('steps、timeline、compare 续页保留结构化成员', () => {
  const p = profile('neon-v1');
  const steps = { kind: 'content', role: 'steps', title: '上手步骤', content_blocks: [{ type: 'steps', title: '操作', items: Array.from({ length: 7 }, (_, i) => ({ title: `步骤${i + 1}`, content: '执行一个完整操作并检查结果' })) }] };
  const timeline = { kind: 'content', role: 'timeline', title: '时间线', content_blocks: [{ type: 'timeline', title: '节点', items: Array.from({ length: 8 }, (_, i) => ({ time: `T${i + 1}`, title: `节点${i + 1}`, content: '公开资料记录的关键变化' })) }] };
  const compare = { kind: 'content', role: 'compare', title: '对比', content_blocks: [{ type: 'compare', title: '对照表', headers: ['维度', 'A', 'B'], rows: Array.from({ length: 8 }, (_, i) => [`维度${i + 1}：这是一个需要完整展示的比较维度`, '保留一段较长说明', '不同之处也需要被看见']) }] };
  for (const page of [steps, timeline, compare]) {
    const result = compileTemplateAwareCardPlan({ cardPlan: [page], capacityProfile: p, maxPages: 10 });
    assert.ok(result.finalPageCount > 1, page.role);
    const originalCount = page.content_blocks[0].items?.length || page.content_blocks[0].rows?.length;
    const outputCount = result.pages.reduce((sum, item) => sum + (item.content_blocks[0].items?.length || item.content_blocks[0].rows?.length || 0), 0);
    assert.equal(outputCount, originalCount, page.role);
  }
});

test('未超容量页面保持原计划和页数', () => {
  const page = listPage(['短条目一', '短条目二']);
  const result = compileTemplateAwareCardPlan({ cardPlan: [page], capacityProfile: profile(), maxPages: 7 });
  assert.equal(result.changed, false);
  assert.deepEqual(result.pages, [page]);
  assert.equal(estimateSocialCardPageLoad(page, profile().roles.feature).overCapacity, false);
});

test('同组过短续页会在硬上限内重新装箱', () => {
  const p = resolveSocialCardCapacityProfile({
    templatePack: getSocialCardTemplatePack('clean-v1'),
    themeDefinition: { id: 'phase2-pack', version: '1', hash: 'test', tokens: {} },
    channelMode: 'xiaohongshu',
    contentType: 'repository',
  });
  const group = 'storyboard-page-4';
  const result = compileTemplateAwareCardPlan({
    cardPlan: [
      { kind: 'quickstart', role: 'steps', title: '三步上手', page_group_id: group, continuation_of: 1, continuation_index: 1, content_blocks: [{ type: 'steps', title: '安装', items: [{ title: '安装', content: '执行安装命令' }] }] },
      { kind: 'quickstart', role: 'steps', title: '三步上手（续）', page_group_id: group, continuation_of: 1, continuation_index: 2, content_blocks: [{ type: 'note', title: '注意', content: '完成后点击 Send。' }] },
    ],
    capacityProfile: p,
    maxPages: 7,
  });
  assert.equal(result.finalPageCount, 1);
  assert.ok(result.operations.some((item) => item.op === 'merge_pages'));
  assert.equal(result.pages[0].content_blocks.length, 2);
  assert.equal(result.pages[0].continuation_index, 1);
});

test('同组续页在不能合并时会移动完整内容块以改善装箱', () => {
  const capacityProfile = {
    roles: {
      feature: {
        structural: { maxBlocks: 4, maxItems: 99 },
        visual: { bodyHeightPx: 280, maxTitleLines: 3 },
        split: { allowed: true, blockTypes: ['text', 'list'] },
      },
    },
  };
  const group = 'storyboard-page-balance';
  const result = compileTemplateAwareCardPlan({
    cardPlan: [
      { kind: 'content', role: 'feature', title: '功能说明', page_group_id: group, continuation_of: 1, continuation_index: 1, content_blocks: [{ type: 'text', title: '概览', content: '一句话概览。' }] },
      { kind: 'content', role: 'feature', title: '功能说明（续）', page_group_id: group, continuation_of: 1, continuation_index: 2, content_blocks: [
        { type: 'text', title: '边界', content: '边界' },
        { type: 'text', title: '细节', content: '这是一段非常长的功能细节说明，用于验证内容块移动。这是一段非常长的功能细节说明，用于验证内容块移动。这是一段非常长的功能细节说明，用于验证内容块移动。' },
      ] },
    ],
    capacityProfile,
    maxPages: 7,
    mergeSlack: 1,
  });
  assert.equal(result.finalPageCount, 2);
  assert.ok(result.operations.some((item) => item.op === 'move_block' && item.from_page === 2 && item.to_page === 1));
  assert.equal(result.pages[0].content_blocks.length, 2);
  assert.equal(result.pages[1].content_blocks.length, 1);
  assert.equal(result.pages[1].continuation_index, 2);
});

test('续页偏空时会从前页移动末尾内容块并保持顺序', () => {
  const capacityProfile = {
    roles: {
      feature: {
        structural: { maxBlocks: 4, maxItems: 99 },
        visual: { bodyHeightPx: 280, maxTitleLines: 3 },
        split: { allowed: true, blockTypes: ['text'] },
      },
    },
  };
  const group = 'storyboard-page-balance-reverse';
  const long = '这是一段非常长的功能细节说明，用于验证内容块移动。这是一段非常长的功能细节说明，用于验证内容块移动。这是一段非常长的功能细节说明，用于验证内容块移动。';
  const result = compileTemplateAwareCardPlan({
    cardPlan: [
      { kind: 'content', role: 'feature', title: '功能说明', page_group_id: group, continuation_of: 1, continuation_index: 1, content_blocks: [{ type: 'text', title: '细节', content: long }, { type: 'text', title: '边界', content: '边界' }] },
      { kind: 'content', role: 'feature', title: '功能说明（续）', page_group_id: group, continuation_of: 1, continuation_index: 2, content_blocks: [{ type: 'text', title: '结论', content: '结论' }] },
    ],
    capacityProfile,
    maxPages: 7,
    mergeSlack: 1,
  });
  assert.ok(result.operations.some((item) => item.op === 'move_block' && item.from_page === 1 && item.to_page === 2));
  assert.equal(result.pages[0].content_blocks[0].title, '细节');
  assert.equal(result.pages[1].content_blocks.map((block) => block.title).join(','), '边界,结论');
});

test('列表拆分会优先均衡续页，保留顺序和续页元数据', () => {
  const items = Array.from({ length: 7 }, (_, index) => `条目${index + 1}：保持完整的事实描述`);
  const result = compileTemplateAwareCardPlan({
    cardPlan: [listPage(items)],
    capacityProfile: {
      roles: {
        feature: {
          structural: { maxBlocks: 4, maxItems: 99 },
          visual: { bodyHeightPx: 330, maxTitleLines: 3 },
          split: { allowed: true, blockTypes: ['list'] },
        },
      },
    },
    maxPages: 7,
  });
  assert.equal(result.finalPageCount, 2);
  const chunks = result.pages.map((page) => page.content_blocks[0].items);
  assert.deepEqual(chunks.flat(), items);
  assert.ok(Math.abs(chunks[0].length - chunks[1].length) <= 1);
  assert.equal(result.pages[1].continuation_index, 2);
  assert.equal(result.pages[1].continuation_of, 1);
});

test('续页超过上限时只记录警告，不删除内容', () => {
  const items = Array.from({ length: 30 }, (_, index) => `事实${index + 1}：长内容`);
  const result = compileTemplateAwareCardPlan({ cardPlan: [listPage(items)], capacityProfile: profile(), maxPages: 2 });
  assert.ok(result.warnings.length > 0);
  assert.equal(result.pages.flatMap((page) => page.content_blocks[0]?.items || []).length, items.length);
});
