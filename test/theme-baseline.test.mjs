import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { TYPESET_THEMES, defaultTypesetTheme, markdownToHtml } from '../server/features/articles/application/typeset-pipeline.mjs';
import { renderStoryboardHtml } from '../server/features/social-cards/application/social-card-pipeline.mjs';
import { themeCatalog } from '../server/platform/http/routes/theme-routes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'theme-baseline.json'), 'utf8'));

test('阶段 0 基线清单冻结 6 个文章主题的 ID、标签与前端顺序', () => {
  const expected = baseline.article.themes.map(({ id, label }) => ({ id, label }));
  const runtime = Object.entries(TYPESET_THEMES).map(([id, theme]) => ({ id, label:theme.label }));
  const picker = themeCatalog('article').items.map(({id,label})=>({id,label}));
  assert.deepEqual(runtime, expected);
  assert.deepEqual(picker, expected);
  assert.equal(new Set(expected.map(({ id }) => id)).size, expected.length);
});

test('阶段 0 固定文章样稿保留每套主题的辨识性视觉签名', () => {
  for (const theme of baseline.article.themes) {
    const html = markdownToHtml(baseline.article.sampleMarkdown, { theme:theme.id, kicker:'主题基线' });
    assert.match(html, /<h1\b/);
    assert.match(html, /<h2\b/);
    assert.match(html, /<section\b/);
    assert.match(html, /<table\b/);
    assert.match(html, /<pre\b/);
    assert.match(html, /<img\b/);
    for (const signature of theme.signatures) {
      assert.ok(html.includes(signature), `${theme.id} 缺少视觉签名：${signature}`);
    }
  }
});

test('阶段 0 冻结文章自动主题映射、默认主题与未知主题回退', () => {
  assert.equal(baseline.article.defaultTheme, 'magazine-warm');
  for (const entry of baseline.article.autoMapping) {
    assert.equal(defaultTypesetTheme(entry.input), entry.theme, JSON.stringify(entry.input));
  }
  const fallback = markdownToHtml(baseline.article.sampleMarkdown, { theme:'phase-zero-unknown' });
  const expected = markdownToHtml(baseline.article.sampleMarkdown, { theme:baseline.article.defaultTheme });
  assert.equal(fallback, expected);
});

test('阶段 0 基线清单冻结 14 个图文主题的 ID、标签与前端顺序', () => {
  const expected = baseline.social.themes.map(({ id, label }) => ({ id, label }));
  assert.deepEqual(themeCatalog('social').items.map(({id,label})=>({id,label})), expected);
  assert.equal(new Set(expected.map(({ id }) => id)).size, expected.length);
});

test('阶段 0 固定图文样稿可由全部主题渲染并保留主题类与视觉签名', () => {
  for (const theme of baseline.social.themes) {
    const html = renderStoryboardHtml({ ...baseline.social.sample, visualStyle:theme.id });
    assert.ok(html.includes(`<body class="${theme.class}" data-visual-style="${theme.id}"`), `${theme.id} 未应用预期主题类`);
    assert.ok(html.includes(theme.signature), `${theme.id} 缺少视觉签名：${theme.signature}`);
    assert.match(html, /class="page page-cover/);
    assert.match(html, /class="stat-row"/);
    assert.match(html, /class="page page-ending/);
    assert.match(html, /data-channel="xiaohongshu"/);
  }
});

test('阶段 3 保留图文默认主题，并让未知主题明确失败', () => {
  assert.equal(baseline.social.defaultTheme, 'ice-blue');
  const implicit = renderStoryboardHtml(baseline.social.sample);
  assert.match(implicit, /<body class="theme-ice-blue" data-visual-style="ice-blue"/);
  assert.throws(()=>renderStoryboardHtml({ ...baseline.social.sample, visualStyle:'phase-zero-unknown' }),/未知图文视觉主题/);
});
