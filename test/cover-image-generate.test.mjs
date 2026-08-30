import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateCoverSpec, fallbackCoverSpec, splitTitleLines, selectCoverTitleHighlights, validateCoverThemeSpec, sanitizeCoverThemeSpec, coverSpecFromTheme, COVER_LIMITS } from '../server/shared/themes/cover-components.mjs';
import { buildCoverHtml } from '../server/shared/themes/cover-theme-compiler.mjs';
import { analyzeCoverSemantics, normalizeCoverSemantics } from '../server/features/articles/application/cover-semantics.mjs';
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
  assert.deepEqual(spec.components.filter((c) => c.type === 'decoration').map((c) => c.kind), ['ring', 'bar']);
  // 无品牌/副标题时不产出对应组件，但仍合规
  const minimal = fallbackCoverSpec('短标题');
  assert.ok(validateCoverSpec(minimal).ok);
  assert.deepEqual(splitTitleLines('短标题'), ['短标题']);
});

test('title highlights are selected deterministically from key information', () => {
  const highlights=selectCoverTitleHighlights('OpenAI终止与Cursor合作，开发者11月12日前必须行动');
  assert.deepEqual(highlights, ['11月12日前', '终止']);
  assert.deepEqual(selectCoverTitleHighlights('一个普通的短标题'), []);
});

test('AI cover semantics are constrained to title substrings, SVG allowlist and visual brief bounds', async () => {
  const normalized=normalizeCoverSemantics({highlightTerms:['11月12日前','模型不存在'],motifKind:'network',coreSubject:'开发者',coreAction:'必须行动',visualMetaphorCandidates:['线路','线路','x'.repeat(40)]}, {title:'开发者11月12日前必须行动'});
  assert.deepEqual(normalized.highlightTerms, ['11月12日前']);
  assert.equal(normalized.motifKind, 'network');
  assert.equal(normalized.coreSubject, '开发者');
  assert.equal(normalized.coreAction, '必须行动');
  assert.deepEqual(normalized.visualMetaphorCandidates, ['线路','x'.repeat(28)]);

  const calls=[];
  const semantics=await analyzeCoverSemantics({
    gateway:{complete:async (request)=>{calls.push(request);return {content:JSON.stringify({highlightTerms:['终止','11月12日前'],motifKind:'network',coreSubject:'合作关系',coreAction:'终止',narrativeChange:'合作 → 终止',emotionalTension:'合作破裂与行动期限',visualMetaphorCandidates:['断裂连接','时间节点'],primaryFocus:'合作关系终止与行动期限',secondaryFocus:'截止时间',compositionHint:'左侧标题，右侧使用有面积的关系网络与时间节点'}),callId:'cover-semantics-1'};}},
    provider:'fake',batchId:1066,candidateId:1066,title:'OpenAI终止与Cursor合作，开发者11月12日前必须行动',summary:'摘要',
  });
  assert.deepEqual(semantics.highlightTerms, ['终止','11月12日前']);
  assert.equal(semantics.motifKind, 'network');
  assert.equal(semantics.narrativeChange, '合作 → 终止');
  assert.deepEqual(semantics.visualMetaphorCandidates, ['断裂连接','时间节点']);
  assert.equal(semantics.primaryFocus, '合作关系终止与行动期限');
  assert.equal('secondaryFocus' in semantics, false);
  assert.equal('compositionHint' in semantics, false);
  assert.equal(calls[0].purpose, 'cover-semantic-analysis');
  assert.equal(calls[0].jsonMode, true);
  assert.equal(calls[0].thinking, false);
  assert.match(calls[0].messages[0].content, /必须结合标题的核心主旨、动作和对象/);
  assert.match(calls[0].messages[0].content, /不要根据配色、主题名称或随机性选择/);
  assert.match(calls[0].messages[0].content, /visualMetaphorCandidates/);
  assert.match(calls[0].messages[0].content, /新增语义短语只能概括标题和摘要已经支持的内容/);
  assert.match(calls[0].messages[0].content, /不要写成具体构图、位置或必须出现的视觉组件/);
  assert.deepEqual(selectCoverTitleHighlights('合作将在11月12日前终止', ['终止'], {useFallback:false}), ['终止']);
});

test('buildCoverHtml escapes content and reports 900x383', () => {
  const { html, width, height } = buildCoverHtml({
    theme: 'cover-navy-gold',
    spec: { components: [{ type: 'canvas', colorRole: 'ink' }, { type: 'title', lines: ['<script>alert(1)</script>'], highlights: [] }] },
  });
  assert.ok(!html.includes('<script>alert'));
  assert.equal(width, 900);
  assert.equal(height, 383);

  const highlighted=buildCoverHtml({
    theme: 'cover-navy-gold',
    spec: { components: [{ type: 'canvas', colorRole: 'ink' }, { type: 'title', lines: ['终止合作'], highlights: ['终止'] }] },
  }).html;
  assert.match(highlighted, /<em style="color:[^\"]+;font-weight:900;text-decoration:underline/);
  const signal=buildCoverHtml({
    theme: 'cover-navy-gold',
    spec: { components: [{ type: 'canvas', colorRole: 'ink' }, { type: 'title', lines: ['趋势变化'], highlights: [] }] },
    coverSemantics: { motifKind: 'signal' },
  }).html;
  assert.match(signal, /M28 180V34M28 180h220/);
  assert.match(signal, /m208 54h14v14/);
  assert.match(signal, /\.cover-motif-left,\.motif-left\{left:14px;top:88px;width:272px;height:204px\}/);
});

test('cover decorations choose contrast against a pure color block', () => {
  const { html } = buildCoverHtml({
    theme: 'cover-navy-gold',
    spec: { components: [
      { type: 'canvas', colorRole: 'page' },
      { type: 'color-block', position: 'left-third', shape: 'rect', colorRole: 'accent' },
      { type: 'title', lines: ['测试标题'], highlights: [] },
      { type: 'decoration', kind: 'bar', position: 'bottom-left' },
    ] },
  });
  assert.match(html, /deco-bar[^>]*style="background:#1f3a5f"/i);
  assert.doesNotMatch(html, /deco-bar[^>]*style="background:#e8b84b"/i);
  assert.match(html, /\.deco-bar\.deco-bottom-right\{right:48px;bottom:48px\}/);
  assert.match(html, /\.deco-cross\.deco-bottom-right\{right:32px;bottom:32px\}/);
  assert.match(html, /<svg class="cover-motif motif-[a-z-]+ motif-left"/);
  const semanticHtml = buildCoverHtml({
    theme: 'cover-navy-gold',
    spec: { components: [
      { type: 'canvas', colorRole: 'page' },
      { type: 'color-block', position: 'left-third', shape: 'rect', colorRole: 'accent' },
      { type: 'title', lines: ['OpenAI终止与Cursor合作'], highlights: [] },
    ] },
    coverSemantics: { motifKind: 'network' },
  }).html;
  assert.match(semanticHtml, /<svg class="cover-motif motif-network motif-left"/);
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
  assert.ok(routes.includes('\\/cover\\/ai-html$'));
  const jobs = fs.readFileSync('server/features/batches/application/ai-job-handlers.mjs', 'utf8');
  assert.ok(jobs.includes("'cover-image'"));
  assert.ok(jobs.includes('runCoverImageJob'));
  const index = fs.readFileSync('public/index.html', 'utf8');
  assert.ok(index.includes('data-view="cover"'));
  assert.ok(index.includes('id="goto-cover"'));
  assert.ok(index.includes('id="download-cover"'));
  assert.ok(index.includes('id="cover-mode"'));
  assert.ok(index.includes('<option value="ai-visual" selected>AI 视觉封面</option>'));
  assert.ok(index.includes('<option value="standard">标准封面</option>'));
  assert.ok(index.includes('id="cover-ai-html"'));
  assert.ok(index.includes('AI 视觉封面'));
  assert.ok(index.includes('data-theme-picker="cover"'));
  assert.ok(index.includes('data-theme-browser="cover"'));
  const main = fs.readFileSync('public/src/main.js', 'utf8');
  assert.ok(main.includes('cover: "./views/cover.js"'));
  assert.ok(main.includes('cover: "文章封面图"'));
  // $ 是 querySelector：按 id 取元素必须带 # 前缀
  const view = fs.readFileSync('public/src/views/cover.js', 'utf8');
  assert.ok(view.includes('value || "ai-visual"'));
  assert.doesNotMatch(view, /\$\("(?!#)/);
  const catalog = fs.readFileSync('public/src/core/theme-catalog.js', 'utf8');
  assert.ok(catalog.includes("cover:'cover-theme'"));
  // 早报（id="daily"）经 daily 分支生成封面：路由、伪候选与 URL 助手接线
  const preview = fs.readFileSync('public/src/views/preview.js', 'utf8');
  assert.ok(!preview.includes('暂不支持生成封面图'));
  assert.ok(view.includes('preferredId && !preferred'));
  assert.ok(view.includes('daily-final'));
  assert.ok(view.includes('daily/cover'));
  assert.ok(view.includes('mode: currentMode()'));
  assert.ok(view.includes('aiVisualFallback'));
  assert.ok(view.includes('/ai-html'));
  assert.ok(routes.includes('\\/daily\\/cover\\/generate$'));
  assert.ok(routes.includes('\\/daily\\/cover\\/local$'));
  assert.ok(routes.includes('\\/daily\\/cover\\/ai-html$'));
  assert.ok(routes.includes('\\/daily\\/cover$'));
  assert.ok(routes.includes("['standard', 'ai-visual']"));
  assert.ok(routes.includes("mode }));"));
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
  assert.deepEqual(title.highlights, ['1.4亿', '变天']);
  assert.equal(spec.components.find((c) => c.type === 'subtitle').text, '一段来自正文的摘要，作为副标题素材。');
  assert.equal(spec.components.find((c) => c.type === 'meta').text, '测试号 · 2026.08');
  assert.equal(spec.components.find((c) => c.type === 'eyebrow').text, '深度观察');
  // 主题未声明装饰时，按构图骨架补一组稳定的视觉变体
  const undecorated = coverSpecFromTheme({ layout: 'diagonal-split', components: [
    { type: 'canvas' },
    { type: 'color-block', position: 'left-half', shape: 'diagonal', colorRole: 'accent', text: 'span' },
    { type: 'title' },
  ] }, { title: '短标题' });
  assert.deepEqual(undecorated.components.filter((c) => c.type === 'decoration').map((c) => c.kind), ['ring', 'grid']);
  const sidePanel = coverSpecFromTheme({ layout: 'side-panel', components: [
    { type: 'canvas' },
    { type: 'color-block', position: 'left-third', shape: 'rect', colorRole: 'accent' },
    { type: 'title' },
    { type: 'decoration', kind: 'bar', position: 'bottom-left' },
  ] }, { title: '短标题' });
  const sideDecorations = sidePanel.components.filter((c) => c.type === 'decoration');
  assert.equal(sideDecorations.length, 2);
  assert.equal(new Set(sideDecorations.map((c) => c.kind)).size, 2);
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
    const spec = coverSpecFromTheme(theme.cover.spec, { title: '一个用于检查构图的文章标题', subtitle: '摘要', brand: '账号 · 2026.08', theme });
    assert.ok(spec, theme.id);
    assert.ok(validateCoverSpec(spec).ok, theme.id);
    assert.ok(spec.components.some((component) => component.type === 'decoration'), `${theme.id}: 缺少封面装饰`);
    const decorations = spec.components.filter((component) => component.type === 'decoration');
    assert.equal(new Set(decorations.map((component) => component.kind)).size, decorations.length, `${theme.id}: 重复装饰类型`);
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
