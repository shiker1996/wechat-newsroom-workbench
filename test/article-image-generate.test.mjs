import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyImagePlan, parseImagePlaceholders } from '../server/features/articles/application/image-workflow.mjs';
import { buildGenerateImageHtml, generateArticleImage } from '../server/features/articles/application/article-image-generator.mjs';

const base = '第一段话在这里结束。\n\n第二段。';
const timeline = { kind:'timeline', title:'发布节奏', items:[{ label:'3 月', value:'v1 发布' }, { label:'6 月', value:'v2 发布' }] };

test('generatable placements persist IMG-DATA and parse back', () => {
  const out = applyImagePlan(base, [{ type:'资料', content:'发布节奏时间线', afterExact:'第一段话在这里结束。', ratio:'16:9', generate:timeline }]);
  assert.ok(out.includes('<!-- IMG-DATA:资料:01 '));
  const [item] = parseImagePlaceholders(out);
  assert.equal(item.generate.kind, 'timeline');
  assert.equal(item.generate.items.length, 2);
});

test('invalid generate data is rejected and falls back to manual supply', () => {
  const cases = [
    { kind:'evil', items:[{ label:'a', value:'b' }, { label:'c', value:'d' }] },
    { kind:'timeline', items:[{ label:'only', value:'one' }] },
    { kind:'timeline', items:[{ label:'a-->x', value:'b' }, { label:'c', value:'d' }] },
  ];
  for (const generate of cases) {
    const out = applyImagePlan(base, [{ type:'资料', content:'x', afterExact:'第二段。', generate }]);
    assert.ok(!out.includes('IMG-DATA'), JSON.stringify(generate));
  }
});

test('generated html escapes content and honors ratio sizes', () => {
  const { html, width, height } = buildGenerateImageHtml({ kind:'datacard', title:'<script>alert(1)</script>', items:[{ label:'a', value:'<b>1</b>' }, { label:'c', value:'2' }] }, '4:3');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<b>1</b>'));
  assert.equal(width, 750);
  assert.equal(height, 562);
  assert.throws(() => buildGenerateImageHtml({ kind:'unknown', items:[] }), /未知的可生成图片类型/);
});

test('generated structured images use article tokens and adapt card layout to item count', () => {
  const { html } = buildGenerateImageHtml({ kind:'datacard', title:'指标', items:[
    { label:'核心', value:'42%' }, { label:'增长', value:'18%' }, { label:'覆盖', value:'9' },
  ] }, '16:9', { colors:{ background:'#101820', surface:'#1B2733', text:'#FFFFFF', muted:'#A7B4C2', accent:'#FF7A59', line:'#3D5368', inverseText:'#101820' }, shape:{ radiusPx:4, borderWidthPx:2, shadow:'none' }, typography:{ headingFamily:'sans' } });
  assert.match(html, /--bg:#101820/);
  assert.match(html, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(html, /class="stat"/);
  assert.match(html, /--accent:#FF7A59/);
  assert.match(html, /background:color-mix\(in srgb,var\(--surface\) 88%,var\(--accent\)\)/);
  assert.doesNotMatch(html, /d-card|d-value|d-label/);
});

test('timeline image uses the social-card rail component structure', () => {
  const { html } = buildGenerateImageHtml({ kind:'timeline', title:'演进', items:[
    { label:'2024', value:'开始试点' }, { label:'2025', value:'规模化应用' },
  ] }, '16:9');
  assert.match(html, /class="content-block timeline-block"/);
  assert.match(html, /class="tl"/);
  assert.match(html, /class="tl-node"/g);
  assert.match(html, /class="tl-time"/g);
  assert.doesNotMatch(html, /class="t-(?:list|row|dot|label|value)"/);
});

test('dense timeline scales down before the fixed 16:9 canvas clips its last node', () => {
  const { html } = buildGenerateImageHtml({ kind:'timeline', title:'六周演进', items:[
    { label:'第1周', value:'一' }, { label:'第2周', value:'二' }, { label:'第3周', value:'三' },
    { label:'第4周', value:'四' }, { label:'第5周', value:'五' }, { label:'第6周', value:'六' },
  ] }, '16:9');
  assert.match(html, /--component-scale:1\.15/);
  assert.match(html, /第6周[\s\S]*六/);
});

test('结构化图片由排版期自动生成，工作台不再提供逐张生成按钮', () => {
  const routes = fs.readFileSync('server/platform/http/routes/media-routes.mjs', 'utf8');
  assert.ok(routes.includes('/generate$'));
  assert.ok(routes.includes('dailyImageGenerateMatch'));
  assert.match(routes, /daily\\\/images[\s\S]*dailyImageGenerateMatch/);
  assert.ok(routes.includes('generateArticleImage'));
  assert.ok(routes.includes('registerGeneratedSlotImage'));
  const preview = fs.readFileSync('public/src/views/preview.js', 'utf8');
  assert.match(preview, /排版自动生成/);
  assert.doesNotMatch(preview, /data-generate-image|generateImageAsset|data-generate-trigger/);
});

test('concurrent article image generation uses isolated screenshot directories', async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'article-image-concurrency-'));
  const outputDirs = [];
  const renderHtmlPages = async ({ htmlFile, outputDir }) => {
    outputDirs.push(outputDir);
    const html = fs.readFileSync(htmlFile, 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const image = path.join(outputDir, 'page-01.png');
    fs.writeFileSync(image, html.includes('时间线 A') ? 'image-a' : 'image-b');
    return { success:true, data:{ images:[image] } };
  };
  try {
    const [first, second] = await Promise.all([
      generateArticleImage({ workdir, slotId:'资料:01', ratio:'16:9', renderHtmlPages,
        generate:{ kind:'timeline', title:'时间线 A', items:[{ label:'1', value:'A' }, { label:'2', value:'B' }] } }),
      generateArticleImage({ workdir, slotId:'资料:02', ratio:'16:9', renderHtmlPages,
        generate:{ kind:'timeline', title:'时间线 B', items:[{ label:'1', value:'C' }, { label:'2', value:'D' }] } }),
    ]);
    assert.notEqual(outputDirs[0], outputDirs[1]);
    assert.equal(fs.readFileSync(first.localPath, 'utf8'), 'image-a');
    assert.equal(fs.readFileSync(second.localPath, 'utf8'), 'image-b');
    assert.equal(fs.existsSync(first.htmlPath), true);
    const leftovers = fs.readdirSync(path.join(workdir, 'images')).filter((name) => name.startsWith('.generate-'));
    assert.deepEqual(leftovers, []);
  } finally {
    fs.rmSync(workdir, { recursive:true, force:true });
  }
});
