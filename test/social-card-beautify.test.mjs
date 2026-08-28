import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aiVisualStyleCoverageIssues, applyBeautifyShellPatch, auditAiVisualContent, buildAiRenderRequest, buildAiVisualCardPlan, buildBeautifyContext, buildBeautifyShell, extractBeautifiedHtml, extractBeautifyPatch, normalizeAiVisualCentering, runSocialCardBeautify, validateAiVisualScreenshotSet, validateBeautifiedHtml, validateBeautifyPatch } from '../server/features/social-cards/application/social-card-beautify.mjs';
import { runAudit } from '../server/features/social-cards/application/social-card-pipeline.mjs';
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
    content: '{"type":"tool_requests","assistant_note":"调用浏览器审计","requests":[{"requestId":"tr_1","capability":"content.social_card.browser_audit","arguments":{"page":1}}]',
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
  const shell = buildBeautifyShell(context);
  assert.equal((shell.match(/class="page(?: page-cover)?"/g) || []).length, 2);
  assert.equal((shell.match(/class="cover-center ai-page-slot"/g) || []).length, 1);
  assert.equal((shell.match(/class="page-body ai-page-slot"/g) || []).length, 1);
  assert.equal((shell.match(/class="page-inner"/g) || []).length, 1);
  assert.equal((shell.match(/class="sol-topbar"/g) || []).length, 1);
  assert.equal((shell.match(/class="bottom-strip"/g) || []).length, 1);
  assert.match(shell, /\.page-body\.ai-page-slot\{[^}]*gap:8px/);
  assert.match(shell, /\.sol-topbar\{[^}]*font-size:10px/);
  assert.match(shell, /\.sol-title\{[^}]*font-size:14px/);
  assert.match(shell, /\.bottom-strip\{[^}]*font-size:10px/);
  assert.equal((shell.match(/composition-|template-clean/g) || []).length, 0);
  assert.match(shell, /--inverseText:var\(--inverse\)/);
  assert.doesNotMatch(shell, /AI VISUAL\s*\//);
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
    files: ['card-plan.json', 'event-analysis.json', 'social-theme-design-spec.md', 'layout-guide.md'],
    instruction: '先读取 workspace.files 中列出的文件；页面职责与内容安排以 card-plan.json（数据库故事板快照）为准，补充事实以 repository-fact-sheet.json、event-analysis.json 或 custom-fact-sheet.json 为准，当前主题视觉规范以 social-theme-design-spec.md 为准，通用排版和密度以 layout-guide.md 为准。设计规范只能控制视觉，不能作为页面正文素材。不要把内部路径、来源 ID 或技术字段展示为页面文案。',
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
  assert.match(request.workspace.instruction, /当前主题视觉规范/);
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

test('AI 内容审计按故事板内容块检查覆盖，不把事实清单全部数字设为必选', () => {
  const plan = {
    pages: [{ page: 1, title: '快速上手', content_blocks: [{ type: 'steps', title: '三步开始', items: ['安装 border-beam', '导入组件', '配置参数'] }] }],
  };
  const html = '<html><body><section class="page"><div class="page-body"><h2>三步开始</h2><p>安装 border-beam，导入组件后配置参数。</p></div></section></body></html>';
  const audit = auditAiVisualContent(html, plan, 'Star 2519；最新版本 v1.3.0');
  assert.equal(audit.valid, true, audit.issues.join('；'));
  assert.equal(audit.pages[0].blocks[0].status, 'covered');
  assert.equal(audit.issues.some((issue) => /2519|v1\.3\.0/.test(issue)), false);
});

test('AI 内容审计阻止对应页面内容块完全丢失，并把未知显式数据作为警告', () => {
  const plan = {
    pages: [{ page: 1, content_blocks: [{ type: 'metric', title: '价格变化', content: '价格从 6999元 上涨 2500元' }] }],
  };
  const missing = auditAiVisualContent('<html><body><section class="page"><div class="page-body">只有装饰性结语</div></section></body></html>', plan, '');
  assert.equal(missing.valid, false);
  assert.match(missing.issues.join('；'), /内容块/);
  const warning = auditAiVisualContent('<html><body><section class="page"><div class="page-body">价格变化：6999元，上涨2500元，另称9999元</div></section></body></html>', plan, '');
  assert.equal(warning.valid, true, warning.issues.join('；'));
  assert.match(warning.warnings.join('；'), /9999元/);
});

test('AI 美化 HTML 保留页面数量、关键数字和来源链接', () => {
  const beautified = '<!doctype html><html><head><style>.page{width:375px;height:667px}</style></head><body><section class="page"><h1><strong>阿里投入 800 亿</strong></h1><a href="https://example.com/source">来源</a></section><section class="page"><p>第二页 6 亿</p></section></body></html>';
  const result = validateBeautifiedHtml(original, beautified);
  assert.equal(result.valid, true, result.issues.join('；'));
  assert.equal(result.pageCount, 2);
});

test('AI 视觉生成门禁逐页检查组件类是否有对应 CSS', () => {
  const html = '<!doctype html><html><head><style>.page{width:375px;height:667px}.crim-stat{padding:8px}[data-ai-page="2"] .crim-tip-card{padding:12px}</style></head><body><section class="page"><div class="crim-feat-card">P1</div><div class="crim-stat">有全局样式</div></section><section class="page" data-ai-page="2"><div class="crim-tip-card">P2</div><div class="crim-feat-card" style="color:red">内联样式</div></section></body></html>';
  assert.deepEqual(aiVisualStyleCoverageIssues(html), ['P1 缺少组件 CSS：.crim-feat-card']);
  const result = validateBeautifiedHtml(html, html, { protectedTokens: [] });
  assert.equal(result.valid, false);
  assert.deepEqual(result.styleCoverageIssues, ['P1 缺少组件 CSS：.crim-feat-card']);
});

test('AI 视觉生成门禁检查封面视觉组件 CSS 覆盖', () => {
  const html = '<!doctype html><html><head><style>.page{width:375px;height:667px}.cover-center{display:flex}.cover-sub{font-size:14px}.xhs-tag{font-size:10px}</style></head><body><section class="page page-cover"><div class="page-inner"><span class="glass-tag">主题</span><span class="glass-hot">重点</span><div class="cover-center"><div class="cover-mark">✦</div><div class="cover-title">封面标题</div><div class="cover-divider"></div><div class="cover-sub">封面副标题</div></div><div class="cover-bottom"><div class="cover-tags"><span class="xhs-tag">#标签</span></div><div class="cover-date">2026.08.28</div></div></div></section></body></html>';
  assert.deepEqual(aiVisualStyleCoverageIssues(html), ['P1 缺少组件 CSS：.glass-tag、.glass-hot、.cover-mark、.cover-title、.cover-divider、.cover-bottom、.cover-tags、.cover-date']);
  const result = validateBeautifiedHtml(html, html, { protectedTokens: [] });
  assert.equal(result.valid, false);
  assert.deepEqual(result.styleCoverageIssues, ['P1 缺少组件 CSS：.glass-tag、.glass-hot、.cover-mark、.cover-title、.cover-divider、.cover-bottom、.cover-tags、.cover-date']);
});

test('最小 AI 页面壳可以被布局审计识别', async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-card-ai-audit-'));
  const context = { topic: '测试事件', theme: { id: 'ice-blue' }, channelMode: 'wechat', requiredPageCount: 2 };
  const shell = buildBeautifyShell(context);
  const patch = { css: '.ai-layout{height:400px;padding:20px}', pages: [
    { page: 1, page_html: '<div class="ai-layout"><h1>核心事实</h1><p>页面一内容</p></div>' },
    { page: 2, page_html: '<div class="ai-layout"><h1>关键数字 800 亿</h1><p>页面二内容</p></div>' },
  ] };
  const applied = applyBeautifyShellPatch(shell, patch);
  const htmlPath = path.join(workdir, 'ai-beautified.html');
  const reportPath = path.join(workdir, 'ai-beautified-layout-report.json');
  fs.writeFileSync(htmlPath, applied.html, 'utf8');
  const report = await runAudit(path.resolve('skills/xiaohongshu-article-generator/scripts/layout-audit.mjs'), htmlPath, reportPath, workdir);
  assert.equal(report.pageCount, 2);
  assert.equal(report.pages.some((page) => page.issues.includes('missing_page_body')), false);
  assert.equal(report.pages.some((page) => page.issues.includes('missing_content_stack')), false);
});

test('AI 完整 HTML 的封面以 cover-center 作为布局审计内容区', async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-card-ai-cover-audit-'));
  const htmlPath = path.join(workdir, 'ai-beautified.html');
  const reportPath = path.join(workdir, 'page-01-layout-report.json');
  fs.writeFileSync(htmlPath, '<!doctype html><html><head><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}.page{width:375px;height:667px;background:#111;color:#fff}.page-inner{height:100%;padding:36px 16px 42px;display:flex;flex-direction:column}.cover-center{flex:1;display:flex;flex-direction:column;justify-content:center;gap:12px}.cover-bottom{height:30px}.cover-mark{font-size:28px}.cover-title{font-size:34px}.cover-sub{font-size:12px}.xhs-tag{font-size:10px}</style></head><body><section class="page page-cover"><div class="page-inner"><span class="glass-tag">主题</span><div class="cover-center"><div class="cover-mark">✦</div><div class="cover-title">封面标题</div><div class="cover-divider"></div><div class="cover-sub">封面副标题</div></div><div class="cover-bottom"><span class="xhs-tag">#标签</span><span class="cover-date">2026.08.28</span></div></div></section></body></html>', 'utf8');
  const report = await runAudit(path.resolve('skills/xiaohongshu-article-generator/scripts/layout-audit.mjs'), htmlPath, reportPath, workdir, { page: 1 });
  assert.equal(report.valid, true, JSON.stringify(report));
  assert.equal(report.pages[0].kind, 'cover');
  assert.ok(report.pages[0].bodyHeight > 0);
  assert.equal(report.pages[0].issues.includes('missing_page_body'), false);
});

test('封面布局审计不把 cover-center 的 flex 全高当成实际内容', async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-card-ai-cover-density-'));
  const htmlPath = path.join(workdir, 'ai-beautified.html');
  const reportPath = path.join(workdir, 'page-01-layout-report.json');
  fs.writeFileSync(htmlPath, '<!doctype html><html><head><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}.page{width:375px;height:667px;overflow:hidden;background:#111;color:#fff}.page-inner{height:100%;padding:0 16px 32px;display:flex;flex-direction:column}.cover-center{flex:1;display:flex;flex-direction:column;justify-content:center;gap:12px}.cover-mark{font-size:40px;line-height:1}.cover-title{font-size:32px;line-height:1.2}.cover-sub{font-size:11px;line-height:1.6}.cover-bottom{height:33px;display:flex;justify-content:space-between}.cover-tags,.cover-date{font-size:10px}</style></head><body><section data-ai-page="1" class="page page-cover"><div class="page-inner"><span style="position:absolute;top:36px;left:16px">装饰</span><div class="cover-center"><div class="cover-mark">✦</div><div class="cover-title">封面标题</div><div class="cover-sub">封面副标题</div></div><div class="cover-bottom"><div class="cover-tags">#标签</div><div class="cover-date">2026.08.28</div></div></div></section></body></html>', 'utf8');
  const report = await runAudit(path.resolve('skills/xiaohongshu-article-generator/scripts/layout-audit.mjs'), htmlPath, reportPath, workdir, { page: 1 });
  assert.equal(report.valid, true, JSON.stringify(report));
  assert.ok(report.pages[0].utilization >= 45 && report.pages[0].utilization <= 90, JSON.stringify(report.pages[0]));
});

test('逐页 AI 布局审计只检查当前页面，不被尚未生成的页面阻断', async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-card-ai-page-audit-'));
  const htmlPath = path.join(workdir, 'ai-beautified.html');
  const reportPath = path.join(workdir, 'page-01-layout-report.json');
  fs.writeFileSync(htmlPath, '<!doctype html><html><head><style>.page{width:375px;height:667px}.page-inner{height:667px}.ai-page-slot{height:520px;display:flex;flex-direction:column;justify-content:flex-start}.content{height:300px;background:#fff}</style></head><body><section class="page" data-page-kind="content"><div class="page-inner"><div class="page-body ai-page-slot"><div class="content">P1</div></div></div></section><section class="page" data-page-kind="content"><div class="page-inner"><div class="page-body ai-page-slot"></div></div></section></body></html>', 'utf8');
  const report = await runAudit(path.resolve('skills/xiaohongshu-article-generator/scripts/layout-audit.mjs'), htmlPath, reportPath, workdir, { page: 1 });
  assert.equal(report.pageCount, 1);
  assert.equal(report.pages[0].page, 1);
  assert.equal(report.valid, true, JSON.stringify(report));
  assert.equal(report.pages[0].styleSamples[0].text, 'P1');
  assert.match(report.pages[0].styleSamples[0].fontSize, /px$/);
});

test('AI 视觉统一垂直居中：归一 data-valign 并注入确定性居中规则', () => {
  const source = '<!doctype html><html lang="zh-CN"><head><style id="base">.page-body{flex:1;display:flex;flex-direction:column}.page-cover .page-body{justify-content:flex-end}</style><style id="ai-page-repair-3">[data-ai-page="3"] .page-body{justify-content:flex-start;align-content:flex-start}</style></head><body data-render-mode="ai-visual"><section class="page"><div class="page-body" data-valign="start"><p>内容</p></div></section><section class="page page-cover"><div class="page-body"><p>封面</p></div></section></body></html>';
  const output = normalizeAiVisualCentering(source);
  assert.match(output, /id="ai-page-centering"/);
  assert.match(output, /\[data-ai-page="3"\] \.page-body\{justify-content:flex-start/);
  assert.match(output, /justify-content:center !important/);
  assert.doesNotMatch(output, /data-valign="start"/);
  assert.match(output, /data-valign="center"/);
  assert.equal(normalizeAiVisualCentering(output), output);
});

test('AI 美化 HTML 只统计精确的 page 类，不把 page-number 当成页面', () => {
  const source = '<html><body><section class="page page-cover"><span class="page-number">01</span></section><section class="page page-content"><span class="page-number">02</span></section></body></html>';
  const result = validateBeautifiedHtml(source, source);
  assert.equal(result.valid, true, result.issues.join('；'));
  assert.equal(result.pageCount, 2);
});

test('AI 美化 HTML 拒绝改页数、脚本和事实数字丢失', () => {
  const result = validateBeautifiedHtml(original, '<html><body><section class="page"><script>alert(1)</script><p>阿里投入 80 亿</p></section></body></html>');
  assert.equal(result.valid, false);
  assert.match(result.issues.join('；'), /页面数量改变|脚本|关键事实/);
});

test('AI 返回代码围栏或解释时只提取完整 HTML', () => {
  const result = extractBeautifiedHtml('下面是结果：\n```html\n<!doctype html><html><body><section class="page">ok</section></body></html>\n```');
  assert.match(result, /^<!doctype html>/i);
  assert.match(result, /<\/html>$/i);
});

test('AI 美化改为返回增量补丁，并由程序合并到页面壳', () => {
  const source = '<!doctype html><html><head></head><body><section class="page" data-page-number="1"><div class="ai-page-slot" data-ai-page="1"></div></section><section class="page" data-page-number="2"><div class="ai-page-slot" data-ai-page="2"></div></section></body></html>';
  const patch = extractBeautifyPatch(JSON.stringify({
    css: '.ai-beautify-fragment{border:2px solid var(--accent)}',
    pages: [
      { page: 1, page_html: '<div class="hero-layout"><h1>阿里投入 <strong>800 亿</strong></h1><span class="ai-beautify-badge">核心数字</span></div>' },
      { page: 2, page_html: '<div class="comparison-layout"><h1>第二页 <strong>6 亿</strong></h1><span class="ai-beautify-arrow">→</span></div>' },
    ],
  }));
  const patchCheck = validateBeautifyPatch(source, patch);
  assert.equal(patchCheck.valid, true, patchCheck.issues.join('；'));
  const applied = applyBeautifyShellPatch(source, patch);
  assert.equal(applied.warnings.length, 0, applied.warnings.join('；'));
  assert.match(applied.html, /阿里投入 <strong>800 亿<\/strong>/);
  assert.match(applied.html, /ai-beautify-badge/);
  assert.equal(validateBeautifiedHtml(source, applied.html, { protectedTokens: [] }).valid, true);
});

test('AI 美化增量补丁拒绝危险 HTML、错误页数和空补丁', () => {
  const source = '<html><body><section class="page"></section><section class="page"></section></body></html>';
  const result = validateBeautifyPatch(source, {
    css: '<script>alert(1)</script>',
    pages: [{ page: 1, fragment: '<img src="https://example.com/a.png">' }],
  });
  assert.equal(result.valid, false);
  assert.match(result.issues.join('；'), /危险|不安全|页面数量|没有可应用/);
});

test('AI 美化增量补丁允许主题组件所需的扩展 CSS，但拒绝过大 CSS', () => {
  const source = '<html><body><section class="page"></section></body></html>';
  const page = [{ page: 1, page_html: '<div class="theme-card">内容</div>' }];
  assert.equal(validateBeautifyPatch(source, { css: '.theme-card{color:var(--ink)}'.padEnd(7000, ' '), pages: page }).valid, true);
  const oversized = validateBeautifyPatch(source, { css: 'x'.repeat(12001), pages: page });
  assert.equal(oversized.valid, false);
  assert.match(oversized.issues.join('；'), /增量 CSS 过大/);
});

test('AI 视觉 Agent 的单页补丁拒绝一次提交多页内容', () => {
  const source = '<html><body><section class="page"></section><section class="page"></section></body></html>';
  const result = validateBeautifyPatch(source, {
    css: '.card{color:var(--ink)}',
    pages: [{ page: 1, page_html: '<div>第一页</div>' }, { page: 2, page_html: '<div>第二页</div>' }],
  }, { allowPartialPages: true, maxPagesPerPatch: 1, expectedPage: 1 });
  assert.equal(result.valid, false);
  assert.match(result.issues.join('；'), /页面增量过大/);
});

test('AI 美化修复补丁可以只替换问题页并复用上一版 HTML', () => {
  const shell = '<html><head></head><body><section class="page"><div class="ai-page-slot"></div></section><section class="page"><div class="ai-page-slot"></div></section></body></html>';
  const first = { css: '.card{color:red}', pages: [
    { page: 1, page_html: '<div class="card">第一页</div>' },
    { page: 2, page_html: '<div class="card">第二页</div>' },
  ] };
  const initial = applyBeautifyShellPatch(shell, first);
  const repair = { css: '', pages: [{ page: 2, page_html: '<div class="card">第二页修复</div>' }] };
  const check = validateBeautifyPatch(initial.html, repair, { allowPartialPages: true, allowEmptyCss: true });
  assert.equal(check.valid, true, check.issues.join('；'));
  const merged = applyBeautifyShellPatch(initial.html, repair, { includeBaseCss: false });
  assert.match(merged.html, /第一页/);
  assert.match(merged.html, /第二页修复/);
  assert.doesNotMatch(merged.html, /第二页<\/div>/);
});

test('AI 美化增量补丁拒绝内部滚动容器', () => {
  const source = '<html><body><section class="page"></section><section class="page"></section></body></html>';
  const result = validateBeautifyPatch(source, {
    css: '.ai-body{overflow-y:auto}',
    pages: [
      { page: 1, page_html: '<div>第一页</div>' },
      { page: 2, page_html: '<div>第二页</div>' },
    ],
  });
  assert.equal(result.valid, false);
  assert.match(result.issues.join('；'), /内部滚动容器/);
});

test('AI 美化增量补丁拒绝重复页面壳和内部来源标识', () => {
  const source = '<html><body><section class="page"></section></body></html>';
  const result = validateBeautifyPatch(source, {
    css: '',
    pages: [{ page: 1, page_html: '<div class="ai-page-slot">价格：6999元（hotspot:20881）</div>' }],
  });
  assert.equal(result.valid, false);
  assert.match(result.issues.join('；'), /页面壳结构/);
  assert.match(result.issues.join('；'), /内部来源标识/);
});

test('封面插槽允许使用 cover-tags 和 xhs-tag 内容组件', () => {
  const source = '<html><body><section class="page page-cover"><div class="cover-center ai-page-slot"></div></section></body></html>';
  const result = validateBeautifyPatch(source, {
    css: '.cover-tags{display:flex;gap:8px}',
    pages: [{ page: 1, page_html: '<div class="icon-circle">🚀</div><h1 class="cover-title">核心事实</h1><div class="cover-tags"><span class="xhs-tag">重点</span></div>' }],
  }, { allowPartialPages: true, maxPagesPerPatch: 1, expectedPage: 1 });
  assert.equal(result.valid, true, result.issues.join('；'));
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

test('Pipeline 审计发现问题时启动单页修复 Agent 并重新审计', async () => {
  const workspaceRoot = process.cwd();
  const batchId = `.tmp-social-card-contrast-${process.pid}-${Date.now()}`;
  const workdir = path.join(workspaceRoot, 'social-cards', `${batchId}-c001`);
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(path.join(workdir, 'event-analysis.json'), JSON.stringify({ analysis: { factBase: { confirmedFacts: ['M7 系列预计 2027 上半年发布'] } } }));
  const editorialPlan = [{ kind: 'content', role: 'data', title: '关键数字', content_blocks: [{ type: 'metric', text: '800 亿', source_refs: [] }] }];
  fs.writeFileSync(path.join(workdir, 'social-theme-snapshot.json'), JSON.stringify({ id: 'ice-blue' }));
  const promptCalls = [];
  let callCount = 0;
  let cssGenerationCallCount = 0;
  let pageGenerationCallCount = 0;
  let repairCallCount = 0;
  let copyCallCount = 0;
  const gateway = {
    resolve: () => ({ provider: { maxOutputTokens: 6000, model: 'test-model' } }),
    complete: async ({ messages, purpose }) => {
      promptCalls.push(messages.map((message) => message.content || '').join('\n'));
      callCount += 1;
      const cssGenerationResponses = [
        { type: 'tool_requests', assistant_note: '读取资料', requests: [{ requestId: 'tr_read_1', capability: 'filesystem.project.read', arguments: { resourceId: 'project:current' }, reason: '读取四份资料' }] },
        { type: 'tool_requests', assistant_note: '写入基础 CSS', requests: [{ requestId: 'tr_head_1', capability: 'filesystem.project.write', arguments: { resourceId: 'project:current', path: 'ai-beautified.html', mode: 'set_head', content: '<style>html,body{margin:0}.page{width:375px;height:667px;box-sizing:border-box;padding:24px;background:#fff;color:#0f172a}.page-body{height:560px;box-sizing:border-box;padding:20px 0;display:flex;flex-direction:column;gap:16px;justify-content:center}</style>' }, reason: '写入基础 CSS' }] },
        { type: 'tool_requests', assistant_note: '追加组件 CSS', requests: [{ requestId: 'tr_head_components', capability: 'filesystem.project.write', arguments: { resourceId: 'project:current', path: 'ai-beautified.html', mode: 'append_head_css', content: '<style>.card{height:400px;padding:24px;background:#dbeafe;border-radius:16px;line-height:1.6;flex:none}.card-body{font-size:9px}</style>' }, reason: '写入组件 CSS' }] },
        { type: 'final', assistantReply: 'CSS 阶段已完成' },
      ];
      const pageGenerationResponses = [
        { type: 'tool_requests', assistant_note: '读取当前页面壳', requests: [{ requestId: 'tr_pages_read_1', capability: 'filesystem.project.read', arguments: { resourceId: 'project:current' }, reason: '读取工作文件和已写入 CSS' }] },
        { type: 'tool_requests', assistant_note: '写入页面', requests: [{ requestId: 'tr_page_1', capability: 'filesystem.project.write', arguments: { resourceId: 'project:current', path: 'ai-beautified.html', mode: 'append_body', content: '<section class="page" data-page-kind="content"><div class="page-body"><div class="card"><strong>关键数字</strong><br><span class="card-body">800 亿</span></div><div class="card"><span class="card-body">M7 系列预计 2027 上半年发布</span></div></div></section>' }, reason: '写入完整页面' }] },
        { type: 'final', assistantReply: '页面阶段已完成' },
      ];
      const repairResponses = [
        { type: 'tool_requests', assistant_note: '修复 P1 溢出', requests: [{ requestId: 'tr_repair_1', capability: 'filesystem.project.write', arguments: { resourceId: 'project:current', path: 'ai-beautified.html', mode: 'replace_page_with_styles', page: 1, page_html: '<section class="page" data-page-kind="content"><div class="page-body"><div class="card"><strong>关键数字</strong><br><span class="card-body">800 亿</span></div><div class="card"><span class="card-body">M7 系列预计 2027 上半年发布</span></div></div></section>', scoped_css: '.card{height:200px}' }, reason: '按审计指令修复 P1' }] },
        { type: 'final', assistantReply: '布局审计通过', htmlPath: 'ai-beautified.html' },
      ];
      const copyResponses = ['测试事件说明。\n#测试 #AI #工具 #效率'];
      const isCssGeneration = String(purpose).includes('css-generation-agent');
      const isPageGeneration = String(purpose).includes('page-generation-agent');
      const isCopy = purpose === 'social-card-copy';
      const responses = isCopy ? copyResponses : isCssGeneration ? cssGenerationResponses : isPageGeneration ? pageGenerationResponses : repairResponses;
      const responseIndex = isCopy ? copyCallCount++ : isCssGeneration ? cssGenerationCallCount++ : isPageGeneration ? pageGenerationCallCount++ : repairCallCount++;
      return {
        provider: 'test-provider', model: 'test-model', callId: callCount,
        content: isCopy ? responses[responseIndex] : JSON.stringify(responses[responseIndex] || responses[responses.length - 1]),
      };
    },
  };
  const store = {
    getBatch: () => ({ id: 'batch', batch_date: '2026-08-27' }),
    getCandidate: () => ({ candidate_id: 'C001', hotspot_title: '测试事件' }),
    getCardEditorial: () => ({ visual_style: 'mocha', card_plan_json: JSON.stringify(editorialPlan) }),
    upsertArtifact: () => {},
  };
  try {
    const result = await runSocialCardBeautify({ gateway, store: { ...store, getBatch: () => ({ id: batchId, batch_date: '2026-08-27' }) }, batchId, candidateId: 'C001', provider: 'test-provider', workspaceRoot });
    assert.equal(result.status === 'passed' || result.status === 'layout-review-required', true);
    assert.equal(callCount, 10);
    assert.ok(promptCalls.some((prompt) => /social-card-ai-visual-generator|完整 AI 视觉 HTML/.test(prompt)));
    assert.match(promptCalls.at(-1), /单页修复|P1/);
    assert.match(fs.readFileSync(path.join(workdir, 'social-theme-design-spec.md'), 'utf8'), /# 摩卡原木 · Social AI Design Spec/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(workdir, 'social-theme-snapshot.json'), 'utf8')).id, 'mocha');
    const beautifiedHtml = fs.readFileSync(path.join(workdir, 'ai-beautified.html'), 'utf8');
    assert.match(beautifiedHtml, /class="card"/);
    assert.match(beautifiedHtml, /id="ai-page-repair-1"/);
    assert.match(beautifiedHtml, /\[data-ai-page="1"\] \.card\{height:200px\}/);
    assert.equal(fs.existsSync(path.join(workdir, 'social-card-ai-visual-skill-manifest.json')), true);
    const stageExecutions = JSON.parse(fs.readFileSync(path.join(workdir, 'social-card-ai-visual-stage-executions.json'), 'utf8'));
    assert.deepEqual(stageExecutions.stages.map((stage) => stage.stage), SOCIAL_CARD_AI_VISUAL_STAGE_CONTRACT.map((stage) => stage.id));
    assert.equal(stageExecutions.stages.every((stage) => stage.status === 'completed'), true);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('AI 美化校验失败时直接失败，不生成程序化回退页面', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'social-card-ai-no-fallback-'));
  const workdir = path.join(workspaceRoot, 'social-cards', 'batch-c001');
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(path.join(workdir, 'event-analysis.json'), JSON.stringify({ analysis: { factBase: { confirmedFacts: ['核心事实'] } } }));
  const editorialPlan = [{ kind: 'cover', role: 'cover', title: '核心事实', content_blocks: [] }];
  fs.writeFileSync(path.join(workdir, 'social-theme-snapshot.json'), JSON.stringify({ id: 'ice-blue' }));
  fs.writeFileSync(path.join(workdir, 'ai-beautified.html'), '<html>旧回退页</html>');
  fs.mkdirSync(path.join(workdir, 'ai-beautified-output'), { recursive: true });
  fs.writeFileSync(path.join(workdir, 'ai-beautified-output', 'page-01.png'), 'old');
  fs.writeFileSync(path.join(workdir, 'ai-beautify-report.json'), '{"fallbackApplied":true}');
  const store = {
    getBatch: () => ({ id: 'batch', batch_date: '2026-08-27' }),
    getCandidate: () => ({ candidate_id: 'C001', hotspot_title: '测试事件' }),
    getCardEditorial: () => ({ card_plan_json: JSON.stringify(editorialPlan) }),
  };
  let repairCalls = 0;
  const gateway = {
    resolve: () => ({ provider: { maxOutputTokens: 6000, model: 'test-model' } }),
    complete: async ({ purpose }) => {
      if (purpose === 'social-card-copy') return { content: '测试事件说明。\n#测试 #AI #工具 #效率', provider: 'test-provider', model: 'test-model' };
      if (String(purpose).includes('social-card-beautify-agent')) repairCalls += 1;
      return { content: JSON.stringify({ type: 'final', assistantReply: '完成' }), provider: 'test-provider', model: 'test-model' };
    },
  };
  await assert.rejects(
    runSocialCardBeautify({ gateway, store, batchId: 'batch', candidateId: 'C001', provider: 'test-provider', workspaceRoot }),
    /未生成程序化回退页面/,
  );
  assert.equal(fs.existsSync(path.join(workdir, 'ai-beautified.html')), true);
  assert.equal(fs.existsSync(path.join(workdir, 'ai-beautified-generation-gate.json')), true);
  assert.match(fs.readFileSync(path.join(workdir, 'ai-beautified-generation-gate.json'), 'utf8'), /恢复|blocked|attempts/);
  assert.equal(repairCalls, 0);
  assert.equal(fs.existsSync(path.join(workdir, 'ai-beautified-output')), false);
  assert.equal(fs.existsSync(path.join(workdir, 'ai-beautify-report.json')), false);
});
