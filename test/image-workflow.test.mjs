import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyImagePlan, parseImagePlaceholders, getImageWorkspace, saveLocalImage,
  saveImageMetadata, buildImagesMarkdown } from '../lib/image-workflow.mjs';

test('配图规划只插入结构化注释且不改写正文', () => {
  const markdown = '# 标题\n\n第一段说明事实。\n\n第二段给出判断。';
  const planned = applyImagePlan(markdown, [{ type:'资料', content:'官方数据截图', afterExact:'第一段说明事实。', ratio:'16:9', suggestedSource:'官方网站', copyrightAction:'待确认' }]);
  assert.match(planned, /<!-- IMG:资料:01 \| 内容:官方数据截图/);
  assert.match(planned, /IMAGE-SUPPLY-LIST/);
  assert.equal(planned.replace(/<!--[^]*?-->/g, '').replace(/\s+/g, ''), markdown.replace(/\s+/g, ''));
  assert.equal(parseImagePlaceholders(planned)[0].id, '资料:01');
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
