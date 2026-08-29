import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAiRenderRequest, buildAiVisualCardPlan, buildBeautifyContext, createAiVisualDocumentWriteSessionId, runSocialCardBeautify, validateAiVisualGenerationCompletion, validateAiVisualScreenshotSet } from '../server/features/social-cards/application/social-card-beautify.mjs';
import { buildSocialCardCopyInput, generateSocialCardCopy, validateSocialCardCopy } from '../server/features/social-cards/application/social-card-copy.mjs';
import { SOCIAL_CARD_AI_VISUAL_STAGE_CONTRACT } from '../server/features/social-cards/application/social-card-ai-visual-pipeline.mjs';
import { parseModelJson, parseModelJsonWithRepair } from '../server/platform/llm/model-json.mjs';

const original = '<!doctype html><html><head><style>.page{width:375px;height:667px}</style></head><body><section class="page"><h1>阿里投入 800 亿</h1><a href="https://example.com/source">来源</a></section><section class="page"><p>第二页 6 亿</p></section></body></html>';

test('共享发布文案模块统一组装事实输入并清理标签结果', async () => {
  const input = buildSocialCardCopyInput({
    channelMode: 'xiaohongshu',
    topic: '测试事件',
    contentType: 'event',
    eventAnalysis: { sources: [{ url: 'https://example.com/event' }] },
    cardPlan: [{ kind: 'cover', title: '测试事件' }],
  });
  assert.deepEqual(input.source_url, ['https://example.com/event']);
  let received;
  const result = await generateSocialCardCopy({
    gateway: { complete: async (request) => { received = request; return { content: '正文\n#事件 #行业 #观察' }; } },
    provider: 'test',
    skillPrompt: 'COPY_GUIDE.md\nreferences\\copy-event.md',
    channelMode: 'xiaohongshu',
    contentType: 'event',
    eventAnalysis: { sources: [] },
  });
  assert.equal(result.copy, '正文\n#事件 #行业 #观察');
  assert.equal(received.purpose, 'social-card-copy');
  assert.equal(validateSocialCardCopy(result.copy).valid, true);
});

test('模型输出只缺失最外层闭合括号时安全恢复 JSON', () => {
  const result = parseModelJson({
    content: '{"type":"tool_requests","assistant_note":"调用浏览器审计","requests":[{"requestId":"tr_1","capability":"content.social_card.browser_audit","arguments":{"page":1},"reason":"审计页面"}]',
    finishReason: 'length',
  });
  assert.equal(result.type, 'tool_requests');
  assert.equal(result.requests[0].arguments.page, 1);
});

test('模型工具请求尾部括号错位但页面内容完整时安全恢复 JSON', () => {
  const result = parseModelJson({
    content: '{"type":"tool_requests","assistant_note":"调用浏览器审计","requests":[{"requestId":"tr_1","capability":"content.social_card.browser_audit","arguments":{"page":1,"patch":{"css":".card{color:red}","pages":[{"page":1,"page_html":"<div class=\\"card\\">P1</div>"}}],"reason":"审计 P1"}}]',
    finishReason: 'length',
  });
  assert.equal(result.requests[0].arguments.patch.pages[0].page_html, '<div class="card">P1</div>');
});

test('模型输出在字符串或内部结构中截断时仍拒绝', () => {
  assert.throws(() => parseModelJson({ content: '{"type":"tool_requests","requests":[{"reason":"未完成', finishReason: 'length' }), /输出达到上限/);
});

test('JSON 无法安全恢复时可把格式错误反馈给模型重试一次', async () => {
  let repairCalls = 0;
  const parsed = await parseModelJsonWithRepair({ content: '{"type":"tool_requests","requests":[{"reason":"截断', finishReason: 'length' }, {
    label: 'AI 视觉 Agent',
    repair: async (error) => {
      repairCalls += 1;
      assert.equal(error.code, 'MODEL_JSON_TRUNCATED');
      return { content: '{"type":"final","assistantReply":"修复完成"}' };
    },
  });
  assert.equal(repairCalls, 1);
  assert.equal(parsed.type, 'final');
});

test('AI 美化上下文读取最终故事板和主题契约，而不是只读取旧 HTML', () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-card-beautify-'));
  fs.writeFileSync(path.join(workdir, 'card-plan.json'), JSON.stringify({ pages: [{ kind: 'cover', role: 'cover', title: '核心事实', content_blocks: [] }, { kind: 'content', role: 'metric', title: '关键数字', content_blocks: [{ type: 'metric', text: '800 亿', source_refs: ['fact-1'] }] }] }));
  fs.writeFileSync(path.join(workdir, 'social-theme-snapshot.json'), JSON.stringify({ id: 'solarized', label: '极光配色', version: '1.0.1', templatePack: { id: 'clean-v1', version: 1 } }));
  const context = buildBeautifyContext({ workdir, original, candidate: { hotspot_title: '测试事件' }, editorial: { output_mode: 'wechat' } });
  assert.equal(context.requiredPageCount, 2);
  assert.equal(context.storyboardPageCount, 2);
  assert.equal(context.storyboard[1].content_blocks[0].type, 'metric');
  assert.equal(context.theme.id, 'solarized');
  assert.equal(context.layoutContract.pageWidth, 375);
});

test('AI 请求只保留创作与安全校验所需字段', () => {
  const request = buildAiRenderRequest({
    topic: '测试事件',
    contentType: 'event',
    channelMode: 'wechat',
    bodyClass: 'legacy-page',
    compositionMode: 'smart',
    layoutStyle: 'auto',
    sourceLabel: '旧来源标签',
    disclosure: '旧披露信息',
    requiredPageCount: 2,
    storyboardPageCount: 2,
    storyboard: [],
    theme: { id: 'ice-blue' },
    sourceUrls: [],
    protectedTokens: ['800 亿'],
    layoutContract: {
      pageWidth: 375,
      pageHeight: 667,
      requiredPageSelector: '.page',
      requiredPageKinds: ['cover', 'content', 'ending'],
      requiredInnerStructure: ['.page-inner'],
      minBodyTextPx: 11,
    },
  });
  assert.deepEqual(Object.keys(request), ['workspace', 'channelMode', 'requiredPageCount']);
  assert.deepEqual(request.workspace, {
    resourceId: 'project:current',
    files: ['card-plan.json', 'ai-visual-card-plan.json', 'event-analysis.json', 'social-theme-snapshot.json', 'social-theme-design-spec.md', 'copy.txt'],
    instruction: '必须先一次读取 workspace.files 中列出的全部本次运行输入，再开始视觉策划和写入。workspace.files 只包含 card-plan.json、ai-visual-card-plan.json、原始事实 JSON、social-theme-design-spec.md、social-theme-snapshot.json 和 copy.txt；它们分别负责故事板事实、视觉语义索引、事实核对、主题配方、运行元数据和只读文案。layout-guide.md、xhs-visual-contract.md、visual-component-mapping.md 已随本技能作为内置参考注入，不属于 workspace.files，不要重复读取或把它们当成候选内容。所有输入只控制设计和事实边界，不能把路径、来源 ID、技术字段或规范说明展示为页面正文。',
  });
  assert.equal(request.channelMode, 'wechat');
  assert.equal('bodyClass' in request, false);
  assert.equal('componentVocabulary' in request, false);
  assert.equal('sourceUrls' in request, false);
  assert.equal('storyboard' in request, false);
  assert.equal('protectedTokens' in request, false);
  assert.equal('layoutContract' in request, false);
  assert.equal('aiDesignContract' in request, false);
});

test('AI 请求可以追加当前主题的 Markdown 设计规范', () => {
  const request = buildAiRenderRequest({ requiredPageCount: 5, theme: { id: 'ice-blue' } }, {
    workspaceFiles: ['fact-sheet.md', 'ai-visual-card-plan.json', 'social-theme-design-spec.md'],
  });
  assert.deepEqual(request.workspace.files, ['fact-sheet.md', 'ai-visual-card-plan.json', 'social-theme-design-spec.md']);
  assert.match(request.workspace.instruction, /workspace\.files.*本次运行输入/);
  assert.match(request.workspace.instruction, /内置参考注入/);
});

test('AI 视觉故事板只保留内容语义并移除预设视觉和程序化构图字段', () => {
  const plan = buildAiVisualCardPlan({
    schemaVersion: 9,
    topic: 'React 动效组件库',
    channel_mode: 'xiaohongshu',
    capacityProfile: { version: 1 },
    reflow: { repaired: true },
    pages: [{
      kind: 'cover',
      role: 'cover',
      title: 'React 动效三件套',
      goal: '说明项目定位',
      evidence: ['README 明确列出三个包'],
      composition: { id: 'hero-frame', alignment: 'center' },
      layout_style: 'auto',
      content_blocks: [{
        type: 'text',
        title: '项目定位',
        content: 'Border Beam、Liquid Gooey、Thinking Orbs 独立成包。',
        source_refs: ['https://example.com/readme'],
        visual: { emphasis: 'hero', icon: 'rocket' },
        content_runs: [{ text: 'Border Beam', role: 'metric' }],
        items: [],
      }],
    }],
  });
  assert.deepEqual(Object.keys(plan), ['schemaVersion', 'topic', 'channel_mode', 'requiredPageCount', 'pages']);
  assert.equal(plan.requiredPageCount, 1);
  assert.equal(plan.pages[0].page, 1);
  assert.equal('visual' in plan.pages[0].content_blocks[0], false);
  assert.equal('composition' in plan.pages[0], false);
  assert.equal('layout_style' in plan.pages[0], false);
  assert.equal('content_runs' in plan.pages[0].content_blocks[0], false);
  assert.equal('items' in plan.pages[0].content_blocks[0], false);
  assert.equal('mustInclude' in plan.pages[0], false);
});

test('AI 请求不暴露内部来源标识', () => {
  const request = buildAiRenderRequest({
    topic: '测试事件',
    contentType: 'event',
    requiredPageCount: 1,
    storyboard: [{
      page: 1,
      content_blocks: [{ type: 'metric', text: '800 亿', source_refs: ['hotspot:20881'], fact_ids: ['fact-1'] }],
      evidence: [{ text: '公开资料', evidence_refs: ['evidence-1'], source_urls: ['https://example.com/source'] }],
      visual: { emphasis: '800 亿', source_refs: ['hotspot:20881'] },
    }],
    theme: { id: 'ice-blue' },
  });
  assert.deepEqual(Object.keys(request), ['workspace', 'channelMode', 'requiredPageCount']);
  assert.equal('storyboard' in request, false);
  assert.equal(request.workspace.files.includes('card-plan.json'), true);
});

test('AI 视觉截图门禁校验两位数页面文件、数量和空文件', () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-card-ai-screenshot-gate-'));
  const first = path.join(workdir, 'page-01.png');
  const second = path.join(workdir, 'page-02.png');
  fs.writeFileSync(first, 'png-1', 'utf8');
  fs.writeFileSync(second, 'png-2', 'utf8');
  assert.equal(validateAiVisualScreenshotSet([first, second], 2).valid, true);
  assert.match(validateAiVisualScreenshotSet([first], 2).issues.join('；'), /截图数量不一致|缺少 page-02\.png/);
  fs.writeFileSync(second, '', 'utf8');
  assert.match(validateAiVisualScreenshotSet([first, second], 2).issues.join('；'), /page-02\.png 文件为空/);
  fs.rmSync(workdir, { recursive: true, force: true });
});

test('AI 视觉生成只有正常 final、文档 finish 且页面完整时才算完成', () => {
  assert.equal(validateAiVisualGenerationCompletion({
    agent: { type: 'final', documentFinished: true },
    generatedPageCount: 6,
    requiredPageCount: 6,
  }).valid, true);

  const incomplete = validateAiVisualGenerationCompletion({
    agent: { type: 'limit', documentFinished: false },
    generatedPageCount: 0,
    requiredPageCount: 6,
  });
  assert.equal(incomplete.valid, false);
  assert.match(incomplete.issues.join('；'), /Agent 未正常完成|文档未成功 finish|页面数不完整/);
});

test('AI 视觉重新生成使用新的文档写入会话 ID', () => {
  const first = createAiVisualDocumentWriteSessionId('batch-1', 'candidate-1');
  const second = createAiVisualDocumentWriteSessionId('batch-1', 'candidate-1');
  assert.notEqual(first, second);
  assert.match(first, /^ai-visual-batch-1-candidate-1-[A-Za-z0-9]{16}$/);
  assert.ok(first.length <= 120);
});

test('AI 视觉生成链路不再包含结构门禁、布局审计、修复和内容审计阶段', async () => {
  const { SOCIAL_CARD_AI_VISUAL_STAGE_CONTRACT } = await import('../server/features/social-cards/application/social-card-ai-visual-pipeline.mjs');
  assert.deepEqual(
    SOCIAL_CARD_AI_VISUAL_STAGE_CONTRACT.map((stage) => stage.id),
    ['inputs', 'copy', 'generation', 'screenshots', 'delivery-gate'],
  );
  assert.doesNotMatch(fs.readFileSync(path.resolve('server/features/social-cards/application/social-card-beautify.mjs'), 'utf8'), /runSocialCardAiVisualRepairAgent|ai-visual-content-audit|ai-beautified-generation-gate/);
});
