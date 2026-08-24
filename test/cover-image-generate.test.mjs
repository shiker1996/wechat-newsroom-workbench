import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateCoverSpec, fallbackCoverSpec, splitTitleLines, validateCoverThemeSpec, sanitizeCoverThemeSpec, coverSpecFromTheme, COVER_LIMITS } from '../server/shared/themes/cover-components.mjs';
import { buildCoverHtml } from '../server/shared/themes/cover-theme-compiler.mjs';
import { loadThemeDirectory } from '../server/shared/themes/theme-loader.mjs';

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

test('title fidelity: rewritten or truncated titles are rejected when expectedTitle is given', () => {
  const original = 'DeepSeek 1.4亿入股宇树，人形机器人要变天了？';
  // 改写标题（AI 自拟）→ 拒绝
  const rewritten = { components: [{ type: 'canvas', colorRole: 'ink' }, { type: 'title', lines: ['王兴兴回应', '战略配售'] }] };
  assert.equal(validateCoverSpec(rewritten, original).ok, false);
  // 截掉后半句 → 拒绝
  const truncated = { components: [{ type: 'canvas', colorRole: 'ink' }, { type: 'title', lines: ['DeepSeek 1.4亿', '入股宇树'] }] };
  assert.equal(validateCoverSpec(truncated, original).ok, false);
  // 仅断行位置不同（允许空白差异）→ 通过；长标题允许最多 3 行
  const faithful = { components: [{ type: 'canvas', colorRole: 'ink' }, { type: 'title', lines: ['DeepSeek 1.4亿', '入股宇树，人形机', '器人要变天了？'] }] };
  assert.equal(validateCoverSpec(faithful, original).ok, true);
  const faithful2 = { components: [{ type: 'canvas', colorRole: 'ink' }, { type: 'title', lines: ['AI 编程的分水岭', '时刻'] }] };
  assert.equal(validateCoverSpec(faithful2, 'AI 编程的分水岭时刻').ok, true);
  // 4 行仍超 titleLines 上限 → 拒绝
  const fourLines = { components: [{ type: 'canvas', colorRole: 'ink' }, { type: 'title', lines: ['DeepSeek 1.4亿', '入股宇树，', '人形机器人', '要变天了？'] }] };
  assert.equal(validateCoverSpec(fourLines, original).ok, false);
  // 不传 expectedTitle 时保持旧行为
  assert.equal(validateCoverSpec(rewritten).ok, true);
});

test('fallbackCoverSpec splits long titles into two constrained lines', () => {  const spec = fallbackCoverSpec('这是一个非常非常长的文章标题用来测试断行逻辑是否正常工作', { brand: '账号名 · 2026.08', subtitle: '副标题' });
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
  assert.equal(covers.length, 10);
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
  const routes = fs.readFileSync('server/platform/http/routes/media-routes.mjs', 'utf8');
  assert.ok(routes.includes('\\/cover\\/generate$'));
  assert.ok(routes.includes('\\/cover\\/local$'));
  const jobs = fs.readFileSync('server/features/batches/application/ai-job-handlers.mjs', 'utf8');
  assert.ok(jobs.includes("'cover-image'"));
  assert.ok(jobs.includes('runCoverImageJob'));
  const index = fs.readFileSync('public/index.html', 'utf8');
  assert.ok(index.includes('data-view="cover"'));
  assert.ok(index.includes('id="goto-cover"'));
  assert.ok(index.includes('id="download-cover"'));
  assert.ok(index.includes('data-theme-picker="cover"'));
  assert.ok(index.includes('data-theme-browser="cover"'));
  const main = fs.readFileSync('public/src/main.js', 'utf8');
  assert.ok(main.includes('cover: "./views/cover.js"'));
  assert.ok(main.includes('cover: "文章封面图"'));
  // $ 是 querySelector：按 id 取元素必须带 # 前缀
  const view = fs.readFileSync('public/src/views/cover.js', 'utf8');
  assert.doesNotMatch(view, /\$\("(?!#)/);
  const catalog = fs.readFileSync('public/src/core/theme-catalog.js', 'utf8');
  assert.ok(catalog.includes("cover:'cover-theme'"));
  // 早报（id="daily"）经 daily 分支生成封面：路由、伪候选与 URL 助手接线
  const preview = fs.readFileSync('public/src/views/preview.js', 'utf8');
  assert.ok(!preview.includes('暂不支持生成封面图'));
  assert.ok(view.includes('preferredId && !preferred'));
  assert.ok(view.includes('daily-final'));
  assert.ok(view.includes('daily/cover'));
  assert.ok(routes.includes('\\/daily\\/cover\\/generate$'));
  assert.ok(routes.includes('\\/daily\\/cover\\/local$'));
  assert.ok(routes.includes('\\/daily\\/cover$'));
});

test('theme-baked cover spec: validation and deterministic article fill-in', () => {
  const themeSpec = { components: [
    { type: 'canvas', colorRole: 'ink' },
    { type: 'color-block', position: 'left-third', shape: 'rect', colorRole: 'accent' },
    { type: 'eyebrow', form: 'badge', text: '深度观察' },
    { type: 'title', align: 'center' },
    { type: 'subtitle', withBar: true },
    { type: 'meta' },
    { type: 'decoration', kind: 'dots', position: 'bottom-right' },
  ] };
  assert.equal(validateCoverThemeSpec(themeSpec).ok, true);
  // 缺 canvas / eyebrow 无静态文案 / 未知组件都拒绝
  assert.equal(validateCoverThemeSpec({ components: [{ type: 'title' }] }).ok, false);
  assert.equal(validateCoverThemeSpec({ components: [{ type: 'canvas' }, { type: 'eyebrow', form: 'text' }] }).ok, false);
  assert.equal(validateCoverThemeSpec({ components: [{ type: 'canvas' }, { type: 'unknown' }] }).ok, false);
  // 半幅色块必须 span 跨布局；窄色块不受限
  assert.equal(validateCoverThemeSpec({ components: [{ type: 'canvas' }, { type: 'color-block', position: 'left-half', shape: 'diagonal', colorRole: 'accent' }, { type: 'title' }] }).ok, false);
  assert.equal(validateCoverThemeSpec({ components: [{ type: 'canvas' }, { type: 'color-block', position: 'left-half', shape: 'diagonal', colorRole: 'accent', text: 'span' }, { type: 'title' }] }).ok, true);
  assert.equal(validateCoverThemeSpec({ components: [{ type: 'canvas' }, { type: 'color-block', position: 'left-third', shape: 'rect', colorRole: 'accent', text: 'hold' }, { type: 'title' }] }).ok, true);
  // AI 归一化路径自动纠正为 span 而不是丢弃色块
  const sanitized = sanitizeCoverThemeSpec({ components: [{ type: 'canvas' }, { type: 'color-block', position: 'right-half', shape: 'diagonal', colorRole: 'accent' }, { type: 'title' }] });
  assert.equal(sanitized.spec.components.find((c) => c.type === 'color-block')?.text, 'span');

  const spec = coverSpecFromTheme(themeSpec, {
    title: 'DeepSeek 1.4亿入股宇树，人形机器人要变天了？',
    subtitle: '一段来自正文的摘要，作为副标题素材。',
    brand: '测试号 · 2026.08',
  });
  assert.ok(spec);
  const title = spec.components.find((c) => c.type === 'title');
  assert.equal(title.lines.join(''), 'DeepSeek 1.4亿入股宇树，人形机器人要变天了？');
  assert.equal(title.align, 'center');
  assert.deepEqual(title.highlights, []);
  assert.equal(spec.components.find((c) => c.type === 'subtitle').text, '一段来自正文的摘要，作为副标题素材。');
  assert.equal(spec.components.find((c) => c.type === 'meta').text, '测试号 · 2026.08');
  assert.equal(spec.components.find((c) => c.type === 'eyebrow').text, '深度观察');
  // 无摘要时不产出 subtitle 组件
  const bare = coverSpecFromTheme(themeSpec, { title: '短标题' });
  assert.ok(!bare.components.some((c) => c.type === 'subtitle'));
  // 构图不合规 → null（调用方回退 fallbackCoverSpec）
  assert.equal(coverSpecFromTheme({ components: [] }, { title: 'x' }), null);
});

test('all builtin cover themes carry a valid baked spec', () => {
  const covers = loadThemeDirectory('themes').filter((d) => d.targets?.includes('cover'));
  assert.equal(covers.length, 10);
  for (const theme of covers) {
    const result = validateCoverThemeSpec(theme.cover?.spec);
    assert.ok(result.ok, `${theme.id}: ${JSON.stringify(result.issues)}`);
    const spec = coverSpecFromTheme(theme.cover.spec, { title: '一个用于检查构图的文章标题', subtitle: '摘要', brand: '账号 · 2026.08' });
    assert.ok(spec, theme.id);
    assert.ok(validateCoverSpec(spec).ok, theme.id);
  }
});

test('cover generator resolves themes deterministically from baked specs', () => {
  const source = fs.readFileSync('server/features/articles/application/cover-image-generator.mjs', 'utf8');
  assert.ok(source.includes('resolveWorkspaceTheme'));
  assert.ok(source.includes('coverSpecFromTheme'));
  assert.ok(!source.includes('planCoverSpec'));
  assert.ok(source.includes('workspaceRoot, workdir, store'));
});


test('runCoverImageJob daily 分支：candidateId 为 null 时走早报终稿与 daily 目录', async () => {
  const { Store } = await import('../server/platform/core/store.mjs');
  const { runCoverImageJob } = await import('../server/features/articles/application/cover-image-generator.mjs');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-daily-cover-'));
  const store = new Store(path.join(tempRoot, 'test.db'));
  try {
    const batch = store.createBatch({ date: '2026-08-07', title: '早报封面' });
    // 缺少 daily-final：明确报错，不落到候选错误
    await assert.rejects(
      runCoverImageJob({ gateway: null, store, batchId: batch.id, candidateId: null, workspaceRoot: tempRoot }),
      /缺少早报终稿/,
    );
    // 候选级入口：不存在的候选报候选错误
    await assert.rejects(
      runCoverImageJob({ gateway: null, store, batchId: batch.id, candidateId: 999, workspaceRoot: tempRoot }),
      /候选不存在/,
    );
    // daily-final 就位后应越过文档检查（后续渲染依赖截图技能，这里只验证到报错点不再是终稿缺失）
    store.saveDocument({ batchId: batch.id, candidateId: null, kind: 'daily-final', title: '测试早报', content: '第一段正文内容足够长，可以作为封面副标题素材。' });
    const source = fs.readFileSync('server/features/articles/application/cover-image-generator.mjs', 'utf8');
    assert.ok(source.includes("batchArticlesDir(workspaceRoot, batch), 'daily'"));
    assert.ok(source.includes("'daily-final'"));
  } finally {
    store.close?.();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
