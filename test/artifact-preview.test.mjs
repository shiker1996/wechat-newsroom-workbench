import test from 'node:test';
import assert from 'node:assert/strict';
import { imageArtifactPreviewHtml, injectPhonePreviewStyles, isImageArtifact } from '../lib/artifact-preview.mjs';

test('手机预览为文章图片注入响应式覆盖且不修改原文件', () => {
  const source = '<!doctype html><html><head></head><body><img src="a.png" style="object-fit:fill"></body></html>';
  const preview = injectPhonePreviewStyles(source);
  assert.match(preview, /data-workbench-phone-preview/);
  assert.match(preview, /max-width:100%!important/);
  assert.match(preview, /height:auto!important/);
  assert.equal(source.includes('data-workbench-phone-preview'), false);
});

test('图片产物预览页按视口完整展示图片', () => {
  assert.equal(isImageArtifact('page-01.PNG'), true);
  assert.equal(isImageArtifact('article.ai.html'), false);
  const html = imageArtifactPreviewHtml('/api/artifacts/9/content', 'page-01.png');
  assert.match(html, /max-height:calc\(100vh - 48px\)/);
  assert.match(html, /object-fit:contain/);
  assert.match(html, /src="\/api\/artifacts\/9\/content"/);
});
