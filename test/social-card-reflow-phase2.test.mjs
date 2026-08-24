import test from 'node:test';
import assert from 'node:assert/strict';
import { getSocialCardTemplatePack } from '../server/shared/rendering/social-card-template-registry.mjs';
import { resolveSocialCardCapacityProfile } from '../server/shared/rendering/social-card-capacity.mjs';
import { compileTemplateAwareCardPlan, estimateSocialCardPageLoad, normalizeEventStoryboardPages, normalizeRepositoryStoryboardPages } from '../server/shared/rendering/social-card-reflow.mjs';

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

test('事件故事板收束来源边界页，并在容量允许时合并主事实与多节点时间线', () => {
  const capacityProfile = profile('clean-v1');
  const pages = [
    { kind: 'cover', role: 'cover', title: '封面', content_blocks: [] },
    { kind: 'what-happened', role: 'concept', title: '发生了什么', content_blocks: [{ type: 'text', content: '主体在公开场合宣布一项重要计划。' }] },
    { kind: 'timeline', role: 'timeline', title: '关键节点', content_blocks: [{ type: 'timeline', items: [
      { time: '2019年', title: '上市', content: '完成上市' },
      { time: '2025年', title: '宣布计划', content: '发布公告' },
    ] }] },
    { kind: 'evidence', role: 'evidence', title: '信息来源与核验', content_blocks: [{ type: 'list', items: ['来源一支持该事实', '来源二提供补充'] }] },
    { kind: 'risk', role: 'risk', title: '事实边界和开放问题', content_blocks: [{ type: 'list', items: ['时间细节仍待确认', '后续影响尚待观察'] }] },
    { kind: 'ending', role: 'ending', title: '后续观察', content_blocks: [{ type: 'list', items: ['关注后续公告'] }] },
  ];
  const result = normalizeEventStoryboardPages({ pages, capacityProfile });
  assert.equal(result.pages.length, 4);
  assert.deepEqual(result.pages.map((page) => page.role), ['cover', 'concept', 'compare', 'ending']);
  assert.equal(result.pages[1].content_blocks.some((block) => block.type === 'timeline'), true);
  assert.equal(result.pages[2].title, '争议焦点');
  assert.equal(result.pages[2].content_blocks.length, 2);
  assert.ok(result.operations.some((operation) => operation.op === 'merge_event_auxiliary_pages'));
  assert.ok(result.operations.some((operation) => operation.op === 'merge_event_timeline_into_summary'));
});

test('工具故事板按相邻职责白名单合并，不跨封面和快速上手结尾', () => {
  const capacityProfile = profile('clean-v1');
  const pages = [
    { kind: 'cover', role: 'cover', title: '封面', content_blocks: [] },
    { kind: 'problem', role: 'concept', title: '痛点', content_blocks: [{ type: 'text', content: '手动处理重复配置，维护成本高。' }] },
    { kind: 'capability', role: 'feature', title: '核心能力', content_blocks: [{ type: 'list', items: ['统一配置入口', '减少重复处理'] }] },
    { kind: 'quickstart', role: 'steps', title: '快速上手', content_blocks: [{ type: 'code', content: 'npm install demo\nnpm run start' }] },
    { kind: 'limitation', role: 'risk', title: '使用边界', content_blocks: [{ type: 'note', content: '权限和网络条件需要单独确认。' }] },
    { kind: 'ending', role: 'ending', title: '最后确认', content_blocks: [{ type: 'list', items: ['确认运行环境'] }] },
  ];
  const result = normalizeRepositoryStoryboardPages({ pages, capacityProfile });
  assert.equal(result.pages.length, 4);
  assert.deepEqual(result.pages.map((page) => page.role), ['cover', 'concept', 'steps', 'ending']);
  assert.equal(result.pages[1].content_blocks.length, 2);
  assert.equal(result.pages[2].content_blocks.some((block) => block.type === 'code'), true);
  assert.equal(result.pages[3].content_blocks.length, 2);
  assert.ok(result.operations.some((operation) => operation.op === 'merge_repository_problem_capability'));
  assert.ok(result.operations.some((operation) => operation.op === 'merge_repository_limitations_ending'));
});

test('拆页不可用时，程序化压缩以省略号作为最后兜底且不触碰命令', () => {
  const p = structuredClone(profile('clean-v1'));
  p.roles.feature.split = { allowed: false, blockTypes: [] };
  const original = '这是一段非常长的说明，用来模拟 AI 改写后仍然无法放入固定卡片的情况。'.repeat(18);
  const result = compileTemplateAwareCardPlan({
    cardPlan: [{ kind: 'content', role: 'feature', title: '能力说明', content_blocks: [{ type: 'note', title: '说明', content: original, source_refs: ['README:test'], fact_ids: ['fact-test'] }] }],
    capacityProfile: p,
    maxPages: 7,
  });
  const block = result.pages[0].content_blocks[0];
  assert.ok(block.content.length < original.length);
  assert.match(block.content, /…$/u);
  assert.deepEqual(block.source_refs, ['README:test']);
  assert.ok(result.operations.some((item) => item.op === 'compact_text_fallback'));
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

test('同一故事线的重复代码和说明块会在模板重排前去重并移除空续页', () => {
  const group = 'storyboard-page-steps-duplicates';
  const duplicateCode = (title, content) => ({ type: 'code', title, content, source_refs: ['README:quickstart'] });
  const duplicateNote = { type: 'note', title: '快捷键冲突处理', content: '若终端快捷键与编辑器冲突，运行向导自动调整映射。', source_refs: ['README:quickstart'] };
  const result = compileTemplateAwareCardPlan({
    cardPlan: [
      { kind: 'quickstart', role: 'steps', title: '快速上手', page_group_id: group, continuation_index: 1, content_blocks: [duplicateCode('启动命令', '# 打开当前目录\ntode .\n# 打开指定文件并跳转到第 10 行第 5 列\ntode main.py -g 10:5'), duplicateNote] },
      { kind: 'quickstart', role: 'steps', title: '快速上手（续）', page_group_id: group, continuation_index: 2, content_blocks: [duplicateCode('启动命令（续）', '# 打开当前目录\ntode .\n# 打开指定文件并跳转到第10行第5列\ntode main.py -g 10:5'), duplicateNote] },
    ],
    capacityProfile: profile('clean-v1'),
    maxPages: 7,
  });
  assert.equal(result.finalPageCount, 1);
  assert.equal(result.pages.flatMap((page) => page.content_blocks).length, 2);
  assert.ok(result.operations.some((item) => item.op === 'dedupe_duplicate_block'));
  assert.ok(result.warnings.some((item) => item.includes('去重')));
});

test('相关代码块会先合并再装箱，避免安装页只剩单个代码块', () => {
  const page = {
    kind: 'quickstart', role: 'steps', title: '一分钟快速上手', page_group_id: 'steps-code-pack',
    content_blocks: [
      { type: 'code', title: '安装', content: 'curl -fsSL https://example.test/install | bash', source_refs: ['README:install'] },
      { type: 'code', title: '启动', content: '# 打开当前目录\ntool .\n# 远程连接\ntool --ssh user@host', source_refs: ['README:run'] },
      { type: 'note', title: '注意', content: '需要支持图形协议的终端。', source_refs: ['README:prerequisite'] },
    ],
  };
  const result = compileTemplateAwareCardPlan({ cardPlan: [page], capacityProfile: profile('clean-v1'), maxPages: 7 });
  assert.equal(result.finalPageCount, 1);
  assert.equal(result.pages[0].content_blocks.filter((block) => block.type === 'code').length, 1);
  assert.ok(result.operations.some((item) => item.op === 'coalesce_code_blocks'));
});

test('相邻代码块合并后处于近似容量区间时不提前拆页', () => {
  const capacityProfile = {
    roles: {
      steps: {
        structural: { maxBlocks: 4, maxItems: 9 },
        visual: { bodyHeightPx: 386, maxTitleLines: 3 },
        split: { allowed: true, blockTypes: ['code', 'note', 'text'] },
      },
    },
  };
  const result = compileTemplateAwareCardPlan({
    cardPlan: [{
      kind: 'quickstart',
      role: 'steps',
      title: '三步上手',
      content_blocks: [
        { type: 'code', title: '安装命令', content: 'curl -fsSl https://tode.sh/install | bash' },
        { type: 'code', title: '启动编辑器', content: '# 打开当前目录\ntode .\n\n# 打开指定文件并跳转至第 10 行\ntode main.py -g 10' },
        { type: 'note', title: '快捷键冲突处理', content: '若遇到按键无响应，运行 tode --shortcut-setup 进入向导。' },
      ],
    }],
    capacityProfile,
    maxPages: 7,
  });
  assert.equal(result.finalPageCount, 1);
  assert.equal(result.pages[0].content_blocks.filter((block) => block.type === 'code').length, 1);
  assert.equal(result.pages[0].content_blocks.length, 2);
  assert.ok(result.operations.some((item) => item.op === 'coalesce_code_blocks'));
  assert.equal(result.preflight[0].nearFit, true);
});

test('长代码块按完整命令组拆分并保持命令顺序', () => {
  const capacityProfile = {
    roles: {
      steps: {
        structural: { maxBlocks: 4, maxItems: 99 },
        visual: { bodyHeightPx: 260, maxTitleLines: 3 },
        split: { allowed: true, blockTypes: ['code', 'note', 'text'] },
      },
    },
  };
  const code = [
    '# 安装工具\ncurl -fsSL https://example.test/install | bash',
    '# 初始化项目\ntool init --workspace demo',
    '# 启动服务\ntool run --port 4317',
  ].join('\n\n');
  const result = compileTemplateAwareCardPlan({
    cardPlan: [{ kind: 'quickstart', role: 'steps', title: '快速开始', content_blocks: [{ type: 'code', title: '命令', content: code, source_refs: ['README:commands'] }] }],
    capacityProfile,
    maxPages: 7,
  });
  assert.ok(result.pages.length > 1);
  assert.ok(result.operations.some((item) => item.op === 'split_block' && item.blockType === 'code' && item.boundary === 'semantic'));
  assert.equal(result.pages.flatMap((page) => page.content_blocks).filter((block) => block.type === 'code').map((block) => block.content).join('\n\n'), code);
});

test('长说明按段落拆分并保持原文顺序', () => {
  const capacityProfile = {
    roles: {
      feature: {
        structural: { maxBlocks: 4, maxItems: 99 },
        visual: { bodyHeightPx: 170, maxTitleLines: 3 },
        split: { allowed: true, blockTypes: ['code', 'note', 'text'] },
      },
    },
  };
  const content = [
    '第一段说明工具的工作方式，并保留来源事实。',
    '第二段说明需要的环境条件和权限边界。',
    '第三段说明失败时如何检查日志和恢复。',
  ].join('\n\n');
  const result = compileTemplateAwareCardPlan({
    cardPlan: [{ kind: 'capability', role: 'feature', title: '能力说明', content_blocks: [{ type: 'note', title: '使用说明', content, source_refs: ['README:usage'] }] }],
    capacityProfile,
    maxPages: 7,
  });
  assert.ok(result.pages.length > 1);
  assert.ok(result.operations.some((item) => item.op === 'split_block' && item.blockType === 'note' && item.boundary === 'semantic'));
  assert.equal(result.pages.flatMap((page) => page.content_blocks).filter((block) => block.type === 'note').map((block) => block.content).join('\n\n'), content);
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

test('代码语义单元可在续页之间平衡，不会留下空页或半条命令', () => {
  const capacityProfile = {
    roles: {
      steps: {
        structural: { maxBlocks: 4, maxItems: 99 },
        visual: { bodyHeightPx: 400, maxTitleLines: 3 },
        split: { allowed: true, blockTypes: ['code', 'note', 'text'] },
      },
    },
  };
  const group = 'storyboard-page-balance-code';
  const result = compileTemplateAwareCardPlan({
    cardPlan: [
      { kind: 'quickstart', role: 'steps', title: '快速开始', page_group_id: group, continuation_index: 1, content_blocks: [{ type: 'text', title: '概览', content: '一句话概览。' }] },
      { kind: 'quickstart', role: 'steps', title: '快速开始（续）', page_group_id: group, continuation_index: 2, content_blocks: [{ type: 'code', title: '命令', content: '# 安装\ncurl install\n\n# 启动\ntool run' }] },
    ],
    capacityProfile,
    maxPages: 7,
    mergeSlack: 1,
  });
  assert.equal(result.finalPageCount, 2);
  assert.ok(result.operations.some((item) => item.op === 'move_block' && item.boundary === 'semantic' && item.blockType === 'code'));
  assert.deepEqual(result.pages.flatMap((page) => page.content_blocks.filter((block) => block.type === 'code').map((block) => block.content)), ['# 安装\ncurl install', '# 启动\ntool run']);
  assert.ok(result.pages.every((page) => page.content_blocks.length > 0));
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

test('推荐页数只是软预算，超过后仍保留全部续页和事实', () => {
  const items = Array.from({ length: 30 }, (_, index) => `事实${index + 1}：需要完整保留的长内容说明`);
  const result = compileTemplateAwareCardPlan({ cardPlan: [listPage(items)], capacityProfile: profile(), maxPages: 2, absoluteMaxPages: 20 });
  assert.ok(result.finalPageCount > 2);
  assert.equal(result.pageBudget.recommendedExceeded, true);
  assert.equal(result.pageBudget.absoluteExceeded, false);
  assert.ok(result.warnings.some((item) => item.includes('超过推荐页数')));
  assert.equal(result.pages.flatMap((page) => page.content_blocks[0]?.items || []).length, items.length);
});

test('超过绝对页数只产生阻断标记，不执行静默截断', () => {
  const items = Array.from({ length: 30 }, (_, index) => `事实${index + 1}：需要完整保留的长内容说明`);
  const result = compileTemplateAwareCardPlan({ cardPlan: [listPage(items)], capacityProfile: profile(), maxPages: 2, absoluteMaxPages: 3 });
  assert.equal(result.pageBudget.absoluteExceeded, true);
  assert.ok(result.warnings.some((item) => item.includes('绝对安全上限')));
  assert.equal(result.pages.flatMap((page) => page.content_blocks[0]?.items || []).length, items.length);
});

test('高度建议模式不会因静态高度高估提前拆页，浏览器可接管最终裁决', () => {
  const capacityProfile = {
    roles: {
      feature: {
        structural: { maxBlocks: 4, maxItems: 99 },
        visual: { bodyHeightPx: 120, maxTitleLines: 3 },
        split: { allowed: true, blockTypes: ['text'] },
      },
    },
  };
  const page = {
    kind: 'content',
    role: 'feature',
    title: '静态模型容易高估的页面',
    content_blocks: [{ type: 'text', title: '说明', content: '这是一段较长说明。'.repeat(30) }],
  };
  const strict = compileTemplateAwareCardPlan({ cardPlan: [page], capacityProfile, maxPages: 7 });
  const advisory = compileTemplateAwareCardPlan({ cardPlan: [page], capacityProfile, maxPages: 7, heightAdvisory: true });
  assert.ok(strict.finalPageCount > 1 || strict.operations.some((item) => item.op === 'compact_page'));
  assert.equal(advisory.finalPageCount, 1);
  assert.equal(advisory.operations.some((item) => item.op === 'split_page' || item.op === 'compact_page'), false);
});

test('高度建议模式仍遵守块数量等模板结构硬上限', () => {
  const capacityProfile = {
    roles: {
      feature: {
        structural: { maxBlocks: 1, maxItems: 99 },
        visual: { bodyHeightPx: 1000, maxTitleLines: 3 },
        split: { allowed: true, blockTypes: ['text'] },
      },
    },
  };
  const page = {
    kind: 'content',
    role: 'feature',
    title: '结构超限页面',
    content_blocks: [
      { type: 'text', title: '一', content: '内容一' },
      { type: 'text', title: '二', content: '内容二' },
    ],
  };
  const result = compileTemplateAwareCardPlan({ cardPlan: [page], capacityProfile, maxPages: 7, heightAdvisory: true });
  assert.equal(result.finalPageCount, 2);
});
