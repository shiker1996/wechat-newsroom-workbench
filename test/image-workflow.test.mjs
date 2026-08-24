import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyImagePlan, parseImagePlaceholders, getImageWorkspace, saveLocalImage,
  saveImageMetadata, buildImagesMarkdown, registerGeneratedImageAssets } from '../server/features/articles/application/image-workflow.mjs';

test('配图规划只插入结构化注释且不改写正文', () => {
  const markdown = '# 标题\n\n第一段说明事实。\n\n第二段给出判断。';
  const planned = applyImagePlan(markdown, [{ type:'资料', content:'官方数据截图', afterExact:'第一段说明事实。', ratio:'16:9', suggestedSource:'官方网站', copyrightAction:'待确认' }]);
  assert.match(planned, /<!-- IMG:资料:01 \| 内容:官方数据截图/);
  assert.match(planned, /IMAGE-SUPPLY-LIST/);
  assert.equal(planned.replace(/<!--[^]*?-->/g, '').replace(/\s+/g, ''), markdown.replace(/\s+/g, ''));
  assert.equal(parseImagePlaceholders(planned)[0].id, '资料:01');
});

test('自动生成图必须上传 CDN 后才进入排版副本', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-image-assets-'));
  try {
    fs.mkdirSync(path.join(root, 'images'));
    fs.writeFileSync(path.join(root, 'images', 'mermaid-1.png'), 'png');
    const markdown = '# 标题\n\n![mermaid-1](images/mermaid-1.png)\n';
    registerGeneratedImageAssets(root, 'Mermaid', ['images/mermaid-1.png']);
    const workspace = getImageWorkspace(root);
    assert.equal(workspace.items[0].status, 'local');
    assert.deepEqual(workspace.manualUnresolved, []);
    assert.deepEqual(workspace.generatedPending, ['生成图:mermaid-1']);
    assert.deepEqual(buildImagesMarkdown(root, markdown).unresolved, ['生成图:mermaid-1']);

    const manifestPath = path.join(root, 'image-assets.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.items['生成图:mermaid-1'].url = 'https://img.example.com/mermaid-1.png';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const ready = buildImagesMarkdown(root, markdown);
    assert.deepEqual(ready.unresolved, []);
    assert.match(ready.content, /https:\/\/img\.example\.com\/mermaid-1\.png/);
    assert.doesNotMatch(ready.content, /images\/mermaid-1\.png/);

    fs.writeFileSync(path.join(root, 'images', 'mermaid-1.png'), 'new-png');
    registerGeneratedImageAssets(root, 'Mermaid', ['images/mermaid-1.png']);
    const changed = getImageWorkspace(root).items[0];
    assert.equal(changed.status, 'local');
    assert.equal(changed.url, '');
    assert.equal(changed.uploadedAt, null);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('无必要图片时记录已规划状态但不制造占位', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'image-plan-none-'));
  try {
    const final = applyImagePlan('# 标题\n\n正文。', []);
    fs.writeFileSync(path.join(root, '09-FINAL.md'), final, 'utf8');
    const workspace = getImageWorkspace(root);
    assert.equal(workspace.planned, true);
    assert.equal(workspace.total, 0);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('本地图片保留原文件，取得 HTTPS 映射后才替换排版副本', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'image-assets-'));
  try {
    const final = applyImagePlan('# 标题\n\n正文需要截图。', [{ type:'来源', content:'官方页面截图', afterExact:'正文需要截图。', ratio:'4:3' }]);
    fs.writeFileSync(path.join(root, '09-FINAL.md'), final, 'utf8');
    saveLocalImage(root, '来源:01', { fileName:'source.png', mimeType:'image/png', base64:Buffer.from('fake-png').toString('base64'), source:'官方网站', copyright:'待确认' });
    saveImageMetadata(root, '来源:01', { source:'官方网站', copyright:'官方媒体资料，可注明出处使用' });
    const local = getImageWorkspace(root);
    assert.equal(local.items[0].status, 'local');
    assert.equal(buildImagesMarkdown(root, final).unresolved[0], '来源:01');
    const manifestPath = path.join(root, 'image-assets.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.items['来源:01'].url = 'https://img.example.com/source.png';
    manifest.items['来源:01'].key = 'source.png';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
    const resolved = buildImagesMarkdown(root, final);
    assert.deepEqual(resolved.unresolved, []);
    assert.match(resolved.content, /!\[官方页面截图\]\(https:\/\/img\.example\.com\/source\.png\)/);
    assert.doesNotMatch(resolved.content, /IMAGE-SUPPLY-LIST|<!-- IMG:/);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('Windows 拖入文件缺少 MIME 时可按扩展名识别图片', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dropped-image-assets-'));
  try {
    const final = applyImagePlan('# 标题\n\n正文需要截图。', [{ type:'来源', content:'本地截图', afterExact:'正文需要截图。' }]);
    fs.writeFileSync(path.join(root, '09-FINAL.md'), final, 'utf8');
    const saved = saveLocalImage(root, '来源:01', {
      fileName:'dragged.PNG', mimeType:'', base64:Buffer.from('image-bytes').toString('base64'),
    });
    assert.equal(saved.mimeType, 'image/png');
    assert.equal(saved.status, 'local');
    assert.deepEqual(getImageWorkspace(root).manualUnresolved, ['来源:01']);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('批次早报从 03-FINAL.md 读取人工配图占位', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-image-assets-'));
  try {
    const final = applyImagePlan('# 早报\n\n正文需要截图。', [{ type:'资料', content:'早报截图', afterExact:'正文需要截图。' }]);
    fs.writeFileSync(path.join(root, '03-FINAL.md'), final, 'utf8');
    const workspace = getImageWorkspace(root);
    assert.equal(workspace.items[0].id, '资料:01');
    assert.deepEqual(workspace.manualUnresolved, ['资料:01']);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});
