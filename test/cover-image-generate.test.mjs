import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { validateCoverSpec, fallbackCoverSpec, splitTitleLines, COVER_LIMITS } from '../lib/themes/cover-components.mjs';
import { buildCoverHtml } from '../lib/themes/cover-theme-compiler.mjs';
import { loadThemeDirectory } from '../lib/themes/theme-loader.mjs';

const validSpec = {
  components: [
    { type: 'canvas', colorRole: 'ink' },
    { type: 'color-block', position: 'left-third', shape: 'rect', colorRole: 'accent' },
    { type: 'eyebrow', form: 'badge', text: '深度观察' },
    { type: 'title', lines: ['AI 编程的', '分水岭时刻'], highlights: ['分水岭'], align: 'left' },
    { type: 'subtitle', text: '从工具到协作范式的迁移', withBar: true },
    { type: 'meta', text: 'MoonTech · 2026.08' },
    { type: 'decoration', kind: 'dots', position: 'bottom-right' },
  ],
};

test('valid cover spec passes and is normalized', () => {
  const result = validateCoverSpec(validSpec);
  assert.ok(result.ok, JSON.stringify(result.issues));
  assert.equal(result.spec.components.length, validSpec.components.length);
  assert.equal(result.spec.components.find((c) => c.type === 'title').highlights[0], '分水岭');
});

test('invalid specs are rejected so callers fall back', () => {
  const cases = [
    null,
    { components: [] },
    { components: [{ type: 'title', lines: ['只有标题没有画布'] }] }, // 缺 canvas
    { components: [{ type: 'canvas' }, { type: 'title', lines: ['hello'], highlights: ['不存在'] }] }, // 高亮非子串
    { components: [{ type: 'canvas' }, { type: 'title', lines: ['x'.repeat(COVER_LIMITS.lineChars + 1)] }] }, // 行超长
    { components: [{ type: 'canvas' }, { type: 'title', lines: ['a'] }, { type: 'unknown' }] }, // 未知组件
    { components: [{ type: 'canvas' }, { type: 'canvas' }, { type: 'title', lines: ['a'] }] }, // 超出 max
    { components: [{ type: 'canvas' }, { type: 'title', lines: ['a'] }, { type: 'subtitle', text: 'x'.repeat(COVER_LIMITS.subtitleChars + 1) }] }, // 副标题超长
  ];
  for (const input of cases) {
    assert.equal(validateCoverSpec(input).ok, false, JSON.stringify(input));
  }
});

test('fallbackCoverSpec splits long titles into two constrained lines', () => {
  const spec = fallbackCoverSpec('这是一个非常非常长的文章标题用来测试断行逻辑是否正常工作', { brand: '账号名 · 2026.08', subtitle: '副标题' });
  const title = spec.components.find((c) => c.type === 'title');
  assert.ok(title.lines.length >= 1 && title.lines.length <= COVER_LIMITS.titleLines);
  for (const line of title.lines) assert.ok([...line].length <= COVER_LIMITS.lineChars, line);
  // fallback 规格本身必须能过校验（保证永远出图）
  assert.ok(validateCoverSpec(spec).ok);
  assert.ok(spec.components.some((c) => c.type === 'subtitle'));
  assert.ok(spec.components.some((c) => c.type === 'meta'));
  // 无品牌/副标题时不产出对应组件，但仍合规
  const minimal = fallbackCoverSpec('短标题');
  assert.ok(validateCoverSpec(minimal).ok);
  assert.deepEqual(splitTitleLines('短标题'), ['短标题']);
});

test('buildCoverHtml escapes content and reports 900x383', () => {
  const { html, width, height } = buildCoverHtml({
    theme: 'cover-navy-gold',
    spec: { components: [{ type: 'canvas', colorRole: 'ink' }, { type: 'title', lines: ['<script>alert(1)</script>'], highlights: [] }] },
  });
  assert.ok(!html.includes('<script>alert'));
  assert.equal(width, 900);
  assert.equal(height, 383);
});

test('unknown theme id falls back to default cover theme', () => {
  const { themeId } = buildCoverHtml({ theme: '不存在的主题', spec: fallbackCoverSpec('测试标题') });
  assert.equal(themeId, 'cover-navy-gold');
  // 非 cover 目标的主题不能拿来做封面
  const { themeId: articleTheme } = buildCoverHtml({ theme: 'news-digest', spec: fallbackCoverSpec('测试标题') });
  assert.equal(articleTheme, 'cover-navy-gold');
});

test('all builtin cover themes render every block layout', () => {
  const covers = loadThemeDirectory('themes').filter((d) => d.targets?.includes('cover'));
  assert.equal(covers.length, 5);
  for (const theme of covers) {
    for (const position of ['left-third', 'right-panel', 'top-band', 'full']) {
      const { html } = buildCoverHtml({
        theme,
        spec: { components: [
          { type: 'canvas', colorRole: 'page' },
          { type: 'color-block', position, shape: 'rect', colorRole: 'accent' },
          { type: 'title', lines: ['测试标题'], highlights: [] },
          { type: 'meta', text: '账号 · 2026.08' },
        ] },
      });
      assert.ok(html.includes('测试标题'), `${theme.id}/${position}`);
    }
  }
});

test('cover routes, job type and navigation are wired', () => {
  const routes = fs.readFileSync('lib/http/routes/media-routes.mjs', 'utf8');
  assert.ok(routes.includes('\\/cover\\/generate$'));
  assert.ok(routes.includes('\\/cover\\/local$'));
  const jobs = fs.readFileSync('lib/llm/ai-job-manager.mjs', 'utf8');
  assert.ok(jobs.includes("'cover-image'"));
  assert.ok(jobs.includes('runCoverImageJob'));
  const index = fs.readFileSync('public/index.html', 'utf8');
  assert.ok(index.includes('data-view="cover"'));
  assert.ok(index.includes('id="goto-cover"'));
  assert.ok(index.includes('id="download-cover"'));
  const main = fs.readFileSync('public/src/main.js', 'utf8');
  assert.ok(main.includes('cover: "./views/cover.js"'));
  assert.ok(main.includes('cover: "文章封面图"'));
});
