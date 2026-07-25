import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { markdownToHtml, runTypesetPipeline, TYPESET_STAGE_CONTRACT, enforceWechatFlowLayout, extractHtmlModelOutput } from '../lib/typeset-pipeline.mjs';
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
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<h2>判断<\/h2>/);
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /<a href="https:\/\/example\.com">来源<\/a>/);
  assert.match(html, /<blockquote>边界提示<\/blockquote>/);
  assert.match(html, /<ul><li>第一项<\/li><li>第二项<\/li><\/ul>/);
  assert.match(html, /#123456/);
  assert.doesNotMatch(html, /<script\b/i);
});

test('公众号 Markdown 转换支持排版技能的嵌套设计 tokens', () => {
  const html = markdownToHtml('# 标题\n\n正文', {
    schema_version:1,
    colors:{ background:'#FFFFFF', text:'#112233', muted:'#445566', accent:'#AABBCC' },
    typography:{ body_px:16, line_height:1.75, h2_px:24 },
    spacing:{ section_px:28, paragraph_px:14 },
    image:{ radius_px:0, caption_px:13 },
  });
  assert.match(html, /#AABBCC/i);
  assert.match(html, /#112233/i);
  assert.match(html, /#445566/i);
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

test('本地排版从项目目录加载技能并通过无 div 门禁', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-assistant-typeset-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const workdir = path.join(root, 'articles', '2026-07-19-c01');
  fs.mkdirSync(workdir, { recursive:true });
  fs.writeFileSync(path.join(workdir, '09-FINAL.md'), '# 测试文章\n\n## 一个判断\n\n这是正文，包含**重点**。\n', 'utf8');
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
  const result = await runTypesetPipeline({ gateway, store, batchId:'batch-1', candidateId:1, provider:'fake', workspaceRoot:root, skillsWorkspaceRoot:process.cwd() });
  const html = fs.readFileSync(result.finalHtml, 'utf8');
  assert.doesNotMatch(html, /<div\b/i);
  assert.doesNotMatch(html, /<style\b/i);
  assert.match(html, /<h1[^>]*>测试文章<\/h1>/);
  assert.ok(artifacts.some((item) => item.name === 'article.ai.draft.html'));
  assert.ok(artifacts.some((item) => item.name === 'article.ai.html'));
  const manifest = JSON.parse(fs.readFileSync(result.skillManifest, 'utf8'));
  const executions = JSON.parse(fs.readFileSync(result.stageExecutions, 'utf8'));
  assert.equal(manifest['magazine-design-advisor'].fallback, false);
  assert.ok(manifest['magazine-design-advisor'].hash);
  assert.deepEqual(executions.map((item) => item.stage), ['rendered','design','images','draft','normalized','gate']);
  assert.deepEqual(executions.map((item) => item.skill), TYPESET_STAGE_CONTRACT.map((item) => item.skill));
  for (const request of modelRequests) {
    assert.match(request.messages[0].content, /## SKILL: wechat-article-typeset/);
  }
  assert.match(modelRequests.find((item) => item.purpose === 'magazine-design').messages[0].content, /## SKILL: magazine-design-advisor/);
  assert.match(modelRequests.find((item) => item.purpose === 'typeset-html').messages[0].content, /## SKILL: wechat-md-to-draft/);
});
