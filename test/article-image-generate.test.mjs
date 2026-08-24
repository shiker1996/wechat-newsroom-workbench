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

test('generate endpoint and workbench button are wired', () => {
  const routes = fs.readFileSync('server/platform/http/routes/media-routes.mjs', 'utf8');
  assert.ok(routes.includes('/generate$'));
  assert.ok(routes.includes('dailyImageGenerateMatch'));
  assert.match(routes, /daily\\\/images[\s\S]*dailyImageGenerateMatch/);
  assert.ok(routes.includes('generateArticleImage'));
  assert.ok(routes.includes('registerGeneratedSlotImage'));
  const preview = fs.readFileSync('public/src/views/preview.js', 'utf8');
  assert.ok(preview.includes('data-generate-image'));
  assert.ok(preview.includes('generateImageAsset'));
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
