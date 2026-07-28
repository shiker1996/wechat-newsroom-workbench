import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { markdownToHtml, runTypesetPipeline, TYPESET_STAGE_CONTRACT, enforceWechatFlowLayout, extractHtmlModelOutput, defaultTypesetTheme } from '../lib/llm/typeset-pipeline.mjs';
import { loadSkillBundle } from '../lib/llm/skill-runtime.mjs';

test('项目排版总技能声明与执行器使用相同的六阶段契约', () => {
  const bundle = loadSkillBundle({ workspaceRoot:process.cwd(), skillName:'wechat-article-typeset' });
  assert.equal(bundle.fallback, false);
  assert.deepEqual(TYPESET_STAGE_CONTRACT.map((item) => item.id), ['rendered','design','images','draft','normalized','gate']);
  for (const { id, skill } of TYPESET_STAGE_CONTRACT) {
    assert.match(bundle.prompt, new RegExp(`\\b${id}\\b`));
    assert.match(bundle.prompt, new RegExp(skill));
  }
  assert.doesNotMatch(bundle.prompt, /wechat-preview-url|wechat-html-to-preview/i);
  assert.match(bundle.prompt, /article\.ai\.html/);
});

test('公众号 Markdown 转换保留结构并应用设计 token', () => {
  const html = markdownToHtml(`# 标题

## 判断

正文有**重点**和[来源](https://example.com)。

> 边界提示

- 第一项
- 第二项`, { accentColor:'#123456', textColor:'#202020', mutedColor:'#666666' });
  assert.match(html, /<h1 style="[^"]*">标题<\/h1>/);
  assert.match(html, /<h2 style="[^"]*"><span style="[^"]*">01 \/<\/span>判断<\/h2>/);
  assert.match(html, /<span leaf=""><span textstyle="" style="font-weight: bold;color:#123456">重点<\/span><\/span>/);
  assert.match(html, /<a href="https:\/\/example\.com" style="[^"]*#123456[^"]*">来源<\/a>/);
  assert.match(html, /<section style="[^"]*">边界提示<\/section>/);
  assert.match(html, /<ul style="[^"]*"><li style="[^"]*">第一项<\/li><li style="[^"]*">第二项<\/li><\/ul>/);
  assert.match(html, /#123456/);
  assert.doesNotMatch(html, /<script\b/i);
});

test('公众号 Markdown 转换支持脚注：引用上标 + 文末来源区', () => {
  const html = markdownToHtml('# 标题\n\n正文有出处[^1]和另一处[^2]。\n\n结尾。\n\n[^1]: 来源一，2025-07-25。\n[^2]: 来源二。\n');
  assert.match(html, /出处<sup style="color:#76533B[^"]*">\[1\]<\/sup>/);
  assert.match(html, /<sup style="color:#76533B[^"]*">\[2\]<\/sup>/);
  assert.doesNotMatch(html, /\[\^1\]/);
  assert.doesNotMatch(html, /\[\^2\]:/);
  const footnoteSection = html.slice(html.lastIndexOf('···'));
  assert.match(footnoteSection, /<p style="font-size:13px;color:#786F66[^"]*"><sup[^>]*>\[1\]<\/sup> 来源一，2025-07-25。<\/p>/);
  assert.match(footnoteSection, /<sup[^>]*>\[2\]<\/sup> 来源二。<\/p>/);
  // 来源区在正文之后
  assert.ok(html.indexOf('结尾。') < html.indexOf('来源一'));
});

test('gossip-card 主题：眉题章节 + 深色引述块 + 墨色加粗 + 无 kicker', () => {
  const html = markdownToHtml('# 标题\n\n## 钉钉篇\n\n正文**加粗**。\n\n## 美团篇\n\n> 引述\n', { theme: 'gossip-card', kicker: '橙序员' });
  assert.match(html, /#FF6B35/i);
  assert.match(html, /<section style="[^"]*border-left:5px solid #FF6B35[^"]*"><span style="[^"]*letter-spacing:3px[^"]*">📍 第一篇<\/span><h2 style="[^"]*">钉钉篇<\/h2><\/section>/);
  assert.match(html, /📍 第二篇/);
  assert.match(html, /<section style="[^"]*background:#111111;color:#FFFFFF;border-radius:12px[^"]*">引述<\/section>/);
  assert.match(html, /<span leaf=""><span textstyle="" style="font-weight: bold;color:#1F2937">加粗<\/span><\/span>/);
  assert.doesNotMatch(html, /橙序员/);
  assert.doesNotMatch(html, /01 \//);
});

test('未知主题回退到 magazine-warm 渲染', () => {
  const html = markdownToHtml('# 标题\n\n## 判断\n', { theme: 'nope' });
  assert.match(html, /<h2 style="[^"]*"><span style="[^"]*">01 \/<\/span>判断<\/h2>/);
});

test('列表项加粗前缀与正文用 font-weight:normal 断开（SPEC §5.7）', () => {
  const html = markdownToHtml('- **成本控制机制**：设用量警报。\n- 普通项\n');
  assert.match(html, /<li style="[^"]*"><span leaf=""><span textstyle="" style="font-weight: bold;color:#76533B">成本控制机制<\/span><\/span><span leaf=""><span textstyle="" style="font-weight: normal">：设用量警报。<\/span><\/span><\/li>/);
  assert.match(html, /<li style="[^"]*">普通项<\/li>/);
});

test('公众号 Markdown 转换支持眉题（kicker）与杂志卡片引用', () => {
  const html = markdownToHtml('# 标题\n\n> 引述一句\n', { kicker: '橙序员' });
  assert.match(html, /<p style="margin:0 0 14px"><span style="display:inline-block;[^"]*background:#76533B[^"]*">橙序员<\/span><\/p><h1/);
  assert.match(html, /<section style="[^"]*background:rgba\(118,83,59,0\.1\);border-left:4px solid #76533B;border-radius:0 12px 12px 0[^"]*">引述一句<\/section>/);
  assert.doesNotMatch(html, /<blockquote\b/i);
  // 无 kicker 时不输出眉题
  assert.doesNotMatch(markdownToHtml('# 标题\n'), /kickerChip|橙序员/);
});

test('公众号 Markdown 转换直接输出内联样式，无 style 标签', () => {
  const html = markdownToHtml('# 标题\n\n正文 **重点** `code`。\n\n![图](https://example.com/a.png)\n');
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /<div\b/i);
  assert.match(html, /<article style="[^"]*font-size:16px[^"]*">/);
  assert.match(html, /<img src="https:\/\/example\.com\/a\.png" alt="图" style="[^"]*max-width:100%[^"]*">/);
  // 门禁约束：流式标签不得出现固定像素宽高
  assert.doesNotMatch(html, /(?:width|height)\s*:\s*\d+px/i);
});

test('公众号 Markdown 转换支持排版技能的嵌套设计 tokens', () => {
  const html = markdownToHtml('## 标题\n\n正文 **重点**', {
    schema_version:1,
    colors:{ background:'#FFFFFF', text:'#112233', muted:'#445566', accent:'#AABBCC' },
    typography:{ body_px:16, line_height:1.75, h2_px:24 },
    spacing:{ section_px:28, paragraph_px:14 },
    image:{ radius_px:0, caption_px:13 },
  });
  assert.match(html, /#AABBCC/i);
  assert.match(html, /#112233/i);
  assert.match(html, /font-size:24px/);
  assert.match(html, /line-height:1\.75/);
});

test('规范化前强制根容器使用公众号流式布局', () => {
  const guarded = enforceWechatFlowLayout('<html><head><style>article{max-width:720px;margin:0 auto}</style></head><body><article>正文</article></body></html>');
  assert.match(guarded, /body>article,body>main\{width:auto!important;max-width:none!important;margin-left:0!important;margin-right:0!important\}/);
  assert.ok(guarded.indexOf('data-wechat-flow-guard') > guarded.indexOf('article{max-width:720px'));
});

test('模型 HTML 响应会剥离说明文字和 Markdown 围栏', () => {
  const html = extractHtmlModelOutput('以下是按 draft 阶段生成的初稿。\n```html\n<!doctype html><html><body><article>正文</article></body></html>\n```');
  assert.equal(html, '<!doctype html><html><body><article>正文</article></body></html>');
  assert.doesNotMatch(html, /以下是|```/);
});

function createTypesetFixture(t, markdown = '# 测试文章\n\n## 一个判断\n\n这是正文，包含**重点**。\n') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-assistant-typeset-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const workdir = path.join(root, 'articles', '2026-07-19-c01');
  fs.mkdirSync(workdir, { recursive:true });
  fs.writeFileSync(path.join(workdir, '09-FINAL.md'), markdown, 'utf8');
  const artifacts = [];
  const modelRequests = [];
  const store = {
    getCandidate: () => ({ id:1, batch_id:'batch-1', candidate_id:'C01' }),
    getBatch: () => ({ id:'batch-1', batch_date:'2026-07-19' }),
    upsertArtifact: (item) => artifacts.push(item), updateBatch: () => {}, updateModelCall: () => {},
  };
  const gateway = {
    resolve: () => ({ provider:{ maxOutputTokens:4096 } }),
    complete: async (request) => {
      modelRequests.push(request);
      return request.purpose === 'magazine-design'
        ? ({ content:JSON.stringify({ schemeMarkdown:'# 设计方案', tokens:{ colors:{ background:'#FFFFFF', accent:'#C4473A', text:'#202522', muted:'#6C736E' }, typography:{ body_px:16, line_height:1.8, h2_px:22 }, spacing:{ section_px:30, paragraph_px:16 }, image:{ radius_px:0, caption_px:13 } } }), finishReason:'stop', callId:1 })
        : ({ content:'<!doctype html><html><head><style>article{width:720px;max-width:720px;margin:0 auto}</style></head><body><article><h1>测试文章</h1><h2>一个判断</h2><p>这是正文，包含<strong>重点</strong>。</p></article></body></html>', finishReason:'stop', callId:2 });
    },
  };
  return { root, artifacts, modelRequests, store, gateway };
}

test('本地排版默认走确定性渲染，不调用模型生成 HTML，跳过浏览器内联化', async (t) => {
  const { root, artifacts, modelRequests, store, gateway } = createTypesetFixture(t);
  const result = await runTypesetPipeline({ gateway, store, batchId:'batch-1', candidateId:1, provider:'fake', workspaceRoot:root, skillsWorkspaceRoot:process.cwd() });
  const html = fs.readFileSync(result.finalHtml, 'utf8');
  assert.doesNotMatch(html, /<div\b/i);
  assert.doesNotMatch(html, /<style\b/i);
  assert.match(html, /<h1 style="[^"]*">测试文章<\/h1>/);
  assert.match(html, /<article style="[^"]*font-size:16px[^"]*">/);
  assert.ok(artifacts.some((item) => item.name === 'article.ai.draft.html'));
  assert.ok(artifacts.some((item) => item.name === 'article.ai.html'));
  const manifest = JSON.parse(fs.readFileSync(result.skillManifest, 'utf8'));
  const executions = JSON.parse(fs.readFileSync(result.stageExecutions, 'utf8'));
  assert.equal(manifest['magazine-design-advisor'].fallback, false);
  assert.ok(manifest['magazine-design-advisor'].hash);
  assert.deepEqual(executions.map((item) => item.stage), ['rendered','design','images','draft','normalized','gate']);
  assert.deepEqual(executions.map((item) => item.skill), TYPESET_STAGE_CONTRACT.map((item) => item.skill));
  assert.match(executions.find((item) => item.stage === 'draft').detail, /确定性渲染/);
  assert.match(executions.find((item) => item.stage === 'normalized').detail, /跳过浏览器内联化/);
  // 确定性主路径只调用一次模型（design tokens），不再请求 typeset-html
  assert.deepEqual(modelRequests.map((item) => item.purpose), ['magazine-design']);
  assert.match(modelRequests[0].messages[0].content, /## SKILL: wechat-article-typeset/);
  assert.match(modelRequests[0].messages[0].content, /## SKILL: magazine-design-advisor/);
});

test('批次级早报无需候选ID即可进入公众号排版', async (t) => {
  const { root, artifacts, store, gateway } = createTypesetFixture(t);
  const dailyDir=path.join(root,'articles','batch-1','daily');
  fs.mkdirSync(dailyDir,{recursive:true});
  fs.writeFileSync(path.join(dailyDir,'03-FINAL.md'),'# 今日早报\n\n## 主线\n\n这是批次早报正文。','utf8');
  store.getCandidate=()=>null;
  const result=await runTypesetPipeline({gateway,store,batchId:'batch-1',candidateId:null,documentKind:'daily-final',provider:'fake',workspaceRoot:root,skillsWorkspaceRoot:process.cwd()});
  assert.match(result.workdir,/daily$/);
  assert.ok(fs.existsSync(result.finalHtml));
  assert.ok(artifacts.some((item)=>item.name==='article.ai.html'));
});

test('排版主题参数生效：gossip-card 输出橙红卡片风且主题配色覆盖 LLM tokens', { timeout: 60000 }, async (t) => {
  const { root, store, gateway } = createTypesetFixture(t);
  const result = await runTypesetPipeline({ gateway, store, batchId:'batch-1', candidateId:1, provider:'fake', workspaceRoot:root, skillsWorkspaceRoot:process.cwd(), theme:'gossip-card' });
  const html = fs.readFileSync(result.finalHtml, 'utf8');
  assert.match(html, /#FF6B35/i);
  assert.match(html, /📍 第一篇/);
  assert.doesNotMatch(html, /#C4473A/i);
  const executions = JSON.parse(fs.readFileSync(result.stageExecutions, 'utf8'));
  assert.match(executions.find((item) => item.stage === 'draft').detail, /主题 gossip-card/);
});

test('未知排版主题直接报错', async (t) => {
  const { root, store, gateway } = createTypesetFixture(t);
  await assert.rejects(
    runTypesetPipeline({ gateway, store, batchId:'batch-1', candidateId:1, provider:'fake', workspaceRoot:root, skillsWorkspaceRoot:process.cwd(), theme:'nope' }),
    /未知排版主题：nope/,
  );
});

test('自动主题按候选类型映射，与成稿链写作技能判定一致', () => {
  assert.equal(defaultTypesetTheme({ category:'🏢 大厂战略', angle:'大厂离谱八卦' }), 'gossip-card');
  assert.equal(defaultTypesetTheme({ category:'🏢 大厂战略', angle:'战略分析' }), 'research-report');
  assert.equal(defaultTypesetTheme({ category:'🤖 AI/技术动态', angle:'新品发布' }), 'tech-wire');
  assert.equal(defaultTypesetTheme({ category:'📈 行业趋势' }), 'research-report');
  assert.equal(defaultTypesetTheme({ category:'💼 职场生态' }), 'career-essay');
  assert.equal(defaultTypesetTheme({ category:'📰 综合资讯' }), 'news-digest');
  assert.equal(defaultTypesetTheme({ composite:true, category:'📰 综合资讯' }), 'research-report');
  assert.equal(defaultTypesetTheme({}), 'magazine-warm');
});

test('新主题渲染出完全不同的视觉语言，不只是换色', () => {
  const md = '# 标题\n\n## 一节\n\n正文\n\n> 引述\n\n- 要点\n\n---\n\n## 二节\n';
  // 暗色终端：暗底、等宽 # 章节、终端面板引述、› 列表、注释分隔
  const tech = markdownToHtml(md, { theme: 'tech-wire' });
  assert.match(tech, /background:#0D1117/);
  assert.match(tech, /monospace[^"]*dashed/);
  assert.match(tech, /># </);
  assert.match(tech, /background:#161B22/);
  assert.match(tech, /list-style:none/);
  assert.match(tech, /› /);
  assert.match(tech, /\/\* ─/);
  // 财经印刷：居中双线大标题、居中章节、方框引述、◆ 分隔
  const report = markdownToHtml(md, { theme: 'research-report' });
  assert.match(report, /border-top:6px double/);
  assert.match(report, /text-align:center[^"]*letter-spacing:2px[^"]*border-bottom:2px solid #1A1A1A/);
  assert.match(report, /border:1px solid #1A1A1A/);
  assert.match(report, /◆/);
  // 书信手账：正文衬线、「一、」章节、大引号引文、星点分隔
  const career = markdownToHtml(md, { theme: 'career-essay' });
  assert.match(career, /background:#F6EFDF;color:#3B3226;font-family:Georgia/);
  assert.match(career, /一、/);
  assert.match(career, /font-size:30px[^"]*">“/);
  assert.match(career, /✦/);
  // 黑白快讯：黑底白字标题块、黑条章节、粗黑分隔
  const news = markdownToHtml(md, { theme: 'news-digest' });
  assert.match(news, /background:#111111;color:#FFFFFF;padding:18px/);
  assert.match(news, /display:inline-block;background:#111111/);
  assert.match(news, /border-top:4px solid #111111/);
  // 杂志风章节编号只在 numbered-rule 主题出现
  assert.doesNotMatch(tech, /01 \//);
  assert.match(markdownToHtml(md, { theme: 'magazine-warm' }), /01 \//);
});

test('theme auto 时按候选映射主题：八卦候选走 gossip-card', { timeout: 60000 }, async (t) => {
  const { root, store, gateway } = createTypesetFixture(t);
  store.getCandidate = () => ({ id:1, batch_id:'batch-1', candidate_id:'C01', category:'🏢 大厂战略', angle:'离谱八卦盘点' });
  const result = await runTypesetPipeline({ gateway, store, batchId:'batch-1', candidateId:1, provider:'fake', workspaceRoot:root, skillsWorkspaceRoot:process.cwd(), theme:'auto' });
  const html = fs.readFileSync(result.finalHtml, 'utf8');
  assert.match(html, /#FF6B35/i);
  const executions = JSON.parse(fs.readFileSync(result.stageExecutions, 'utf8'));
  assert.match(executions.find((item) => item.stage === 'draft').detail, /主题 gossip-card/);
});

test('draftMode llm 保留模型初稿路径并走浏览器内联化', async (t) => {
  const { root, artifacts, modelRequests, store, gateway } = createTypesetFixture(t);
  const result = await runTypesetPipeline({ gateway, store, batchId:'batch-1', candidateId:1, provider:'fake', workspaceRoot:root, skillsWorkspaceRoot:process.cwd(), draftMode:'llm' });
  const html = fs.readFileSync(result.finalHtml, 'utf8');
  assert.doesNotMatch(html, /<div\b/i);
  assert.doesNotMatch(html, /<style\b/i);
  assert.match(html, /<h1[^>]*>测试文章<\/h1>/);
  assert.ok(artifacts.some((item) => item.name === 'article.ai.html'));
  const executions = JSON.parse(fs.readFileSync(result.stageExecutions, 'utf8'));
  assert.deepEqual(executions.map((item) => item.stage), ['rendered','design','images','draft','normalized','gate']);
  assert.deepEqual(modelRequests.map((item) => item.purpose), ['magazine-design', 'typeset-html']);
  assert.match(modelRequests.find((item) => item.purpose === 'typeset-html').messages[0].content, /## SKILL: wechat-md-to-draft/);
});

test('含 mermaid 围栏的文章经 images 阶段转图后完成排版', { timeout: 180000 }, async (t) => {
  const { root, artifacts, store, gateway } = createTypesetFixture(t,
    '# 测试文章\n\n## 流程\n\n```mermaid\ngraph TD\n  A[采集] --> B[成稿]\n```\n\n正文。\n');
  const result = await runTypesetPipeline({ gateway, store, batchId:'batch-1', candidateId:1, provider:'fake', workspaceRoot:root, skillsWorkspaceRoot:process.cwd() });
  const html = fs.readFileSync(result.finalHtml, 'utf8');
  assert.doesNotMatch(html, /```mermaid/);
  assert.match(html, /<img src="images\/mermaid-1\.png"/);
  const executions = JSON.parse(fs.readFileSync(result.stageExecutions, 'utf8'));
  assert.match(executions.find((item) => item.stage === 'images').detail, /Mermaid 1 张/);
  assert.ok(artifacts.some((item) => item.name === '09-FINAL.mermaid.md'));
  const workdir = path.join(root, 'articles', '2026-07-19-c01');
  assert.ok(fs.statSync(path.join(workdir, 'images', 'mermaid-1.png')).size > 0);
});
