import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/core/store.mjs';
import { AiJobManager } from '../lib/llm/ai-job-manager.mjs';
import { handleModelRoutes } from '../lib/http/routes/model-routes.mjs';
import { handleContentRoutes } from '../lib/http/routes/content-routes.mjs';
import { AI_JOB_TYPES, createAiJobHandlers } from '../lib/jobs/ai-job-handlers.mjs';
import { applyWorkbenchSchema, runDatabaseMigrations } from '../lib/persistence/migrations.mjs';
import { extractHtmlModelOutput as extractPureHtml, defaultTypesetTheme as selectPureTheme } from '../lib/rendering/typeset-output.mjs';
import { budgetCardPlan } from '../lib/rendering/social-card-plan.mjs';
import { resolveCardLayoutDecision as resolvePureLayout } from '../lib/rendering/social-card-layout.mjs';
import { inferCardPageRole as inferPureRole, stableCardCompositionSeed as pureCompositionSeed } from '../lib/rendering/social-card-role.mjs';
import { semanticCardColumns } from '../lib/rendering/social-card-columns.mjs';
import { normalizeCardComposition as normalizePureComposition } from '../lib/rendering/social-card-composition.mjs';
import { cardPlanRepairStructureIssues as pureRepairIssues, sanitizeCardPlan as sanitizePurePlan } from '../lib/rendering/storyboard-content.mjs';
import { numberedTextSteps, renderStoryboardBlock } from '../lib/rendering/storyboard-html-content.mjs';
import { renderStoryboardSections } from '../lib/rendering/storyboard-page-renderer.mjs';
import { renderStoryboardDocument } from '../lib/rendering/storyboard-document-renderer.mjs';
import { markdownToHtml as renderPureMarkdown, normalizeDesignTokens as normalizePureDesignTokens } from '../lib/rendering/markdown-renderer.mjs';
import { lineDiff as editorLineDiff, markdownHeadings as editorMarkdownHeadings, qualityIssues as editorQualityIssues, visibleChars as editorVisibleChars, writingStatistics as editorWritingStatistics } from '../public/src/views/editor-document-model.js';
import { candidateMode as socialCandidateMode, cardBlockEditorHtml as socialCardBlockEditorHtml, socialFactsHtml, socialScoreView } from '../public/src/views/social-editor-model.js';

function workspace(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = new Store(path.join(root, 'workbench.db'));
  return { root, store };
}

function cleanup({ root, store }) {
  store?.close();
  fs.rmSync(root, { recursive: true, force: true });
}

function captureJson() {
  const responses = [];
  return {
    responses,
    json(_response, status, data) {
      responses.push({ status, data });
    },
  };
}

test('refactoring baseline: extracted route handlers keep the HTTP delegation contract', async () => {
  const contentCapture = captureJson();
  const contentHandled = await handleContentRoutes({
    request: { method: 'GET' },
    response: {},
    pathname: '/api/hotspots',
    searchParams: new URLSearchParams(),
    store: {
      listHotspots(input) {
        assert.deepEqual(input, { q: '', source: '', date: '', limit: 200 });
        return [{ id: 1, title: 'baseline hotspot' }];
      },
    },
    artifactRoots: [],
    mime: {},
    json: contentCapture.json,
  });

  assert.equal(contentHandled, true);
  assert.deepEqual(contentCapture.responses, [{
    status: 200,
    data: [{ id: 1, title: 'baseline hotspot' }],
  }]);

  const modelCapture = captureJson();
  const modelHandled = await handleModelRoutes({
    request: { method: 'GET' },
    response: {},
    pathname: '/api/models',
    root: '',
    config: {},
    store: { listModelCalls: (limit) => [{ limit }] },
    models: { listProviders: () => ({ providers: [], defaultProvider: 'test' }) },
    body: async () => ({}),
    json: modelCapture.json,
  });

  assert.equal(modelHandled, true);
  assert.deepEqual(modelCapture.responses, [{
    status: 200,
    data: {
      providers: [],
      defaultProvider: 'test',
      calls: [{ limit: 50 }],
    },
  }]);

  const unhandled = await handleContentRoutes({
    request: { method: 'GET' },
    response: {},
    pathname: '/api/not-a-route',
    searchParams: new URLSearchParams(),
    store: {},
    artifactRoots: [],
    mime: {},
    json() {},
  });
  assert.equal(unhandled, false);
});

test('refactoring baseline: batch, hotspot, candidate, document and artifact relations remain connected', () => {
  const ctx = workspace('newsroom-refactor-store-');
  try {
    const batch = ctx.store.createBatch({
      date: '2026-08-09',
      title: 'refactoring baseline',
      requestedTracks: ['article', 'social_cards'],
    });
    ctx.store.addHotspots(batch.id, 'manual', [{
      title: 'baseline hotspot',
      url: 'https://example.com/baseline',
    }]);

    const hotspot = ctx.store.getBatch(batch.id).hotspots[0];
    const candidates = ctx.store.addCandidates(batch.id, [hotspot.id], {
      tracks: ['article', 'social_cards'],
    });
    const candidate = candidates.find((item) => item.id);
    assert.ok(candidate);
    assert.deepEqual(
      ctx.store.listCandidateTracks(candidate.id).map((item) => item.track).sort(),
      ['article', 'social_cards'],
    );

    ctx.store.updateCandidateTrack(candidate.id, 'article', { status: 'drafting' });
    const document = ctx.store.saveDocument({
      batchId: batch.id,
      candidateId: candidate.id,
      kind: 'draft',
      title: 'baseline draft',
      content: '# Baseline\n\nContent',
      status: 'draft',
    });
    assert.equal(document.batch_id, batch.id);
    assert.equal(document.candidate_row_id, candidate.id);

    const artifactPath = path.join(ctx.root, 'baseline.md');
    fs.writeFileSync(artifactPath, '# Baseline\n', 'utf8');
    const stat = fs.statSync(artifactPath);
    ctx.store.upsertArtifact({
      batchId: batch.id,
      candidateId: candidate.id,
      kind: '文章初稿',
      name: path.basename(artifactPath),
      path: artifactPath,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });

    const fetched = ctx.store.getBatch(batch.id);
    assert.equal(fetched.hotspots.length, 1);
    assert.equal(fetched.artifacts.length, 1);
    assert.equal(ctx.store.listDocuments(batch.id).length, 1);
    assert.equal(ctx.store.listArtifacts({ batchId: batch.id }).length, 1);
    assert.equal(ctx.store.listCandidates(batch.id, 'article')[0].track_status, 'drafting');
  } finally {
    cleanup(ctx);
  }
});

test('refactoring baseline: supported AI job types are accepted and persisted', async () => {
  const ctx = workspace('newsroom-refactor-jobs-');
  try {
    const batch = ctx.store.createBatch({ date: '2026-08-09', title: 'job baseline' });
    const gateway = { config: { defaultProvider: 'test' }, resolve() {} };
    const manager = new AiJobManager(ctx.store, gateway, {
      aiJobs: { maxConcurrent: 20 },
      rsshub: { maxAgeHours: 168 },
      workspaceRoot: ctx.root,
    });
    manager.run = (job) => new Promise((resolve) => {
      setImmediate(() => {
        job.status = 'completed';
        resolve();
      });
    });

    const types = [
      'tag', 'retag', 'event-cards', 'research', 'breaking-analysis',
      'article', 'daily', 'tutorial', 'typeset', 'social-card', 'cover-image', 'auto',
    ];
    const jobs = types.map((type, index) => manager.start({
      batchId: batch.id,
      type,
      candidateId: index + 1,
      documentKind: type === 'typeset' ? 'final' : null,
    }));

    assert.deepEqual(
      new Set(ctx.store.listAiRuns(batch.id).map((item) => item.type)),
      new Set(types),
    );
    assert.ok(jobs.every((job) => job.status === 'running' || job.status === 'queued'));
    assert.throws(
      () => manager.start({ batchId: batch.id, type: 'unsupported-job' }),
      /AI/,
    );

    for (let attempt = 0; attempt < 50 && (manager.pending.length || manager.activeCount); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(manager.pending.length, 0);
    assert.equal(manager.activeCount, 0);
    assert.ok(jobs.every((job) => ['completed', 'failed'].includes(manager.get(job.id).status)));
  } finally {
    cleanup(ctx);
  }
});

test('refactoring stage 2: every supported AI job type has an explicit handler', () => {
  const handlers = createAiJobHandlers({ store: {}, gateway: {}, config: {}, log() {} });
  assert.deepEqual([...handlers.keys()], AI_JOB_TYPES);
  assert.equal(handlers.size, 12);
  assert.equal(handlers.has('unsupported-job'), false);
});

test('refactoring stage 2: manager delegates execution context and owns completion persistence', async () => {
  const updates = [];
  const store = {
    getBatch: () => ({ id: 'batch-1', max_age_hours: 72 }),
    updateAiRun: (id, patch) => updates.push({ id, patch }),
  };
  const manager = new AiJobManager(store, { config: { defaultProvider: 'test' } }, {
    aiJobs: { maxConcurrent: 1 }, rsshub: { maxAgeHours: 168 },
  });
  let received;
  manager.handlers = new Map([['article', async (context) => {
    received = context;
    return { ok: true };
  }]]);
  const job = { id: 'job-1', type: 'article', batchId: 'batch-1', status: 'running', logs: [] };
  const options = { candidateId: 7, documentKind: 'final' };

  await manager.run(job, options);

  assert.equal(received.job, job);
  assert.equal(received.maxAgeHours, 72);
  assert.equal(received.options, options);
  assert.equal(job.status, 'completed');
  assert.deepEqual(job.result, { ok: true });
  assert.ok(updates.some(({ patch }) => patch.status === 'completed' && patch.result_json === '{"ok":true}'));
});

test('refactoring stage 3: Store remains a facade over domain repositories', () => {
  const ctx = workspace('newsroom-refactor-repositories-');
  try {
    assert.equal(ctx.store.repositories.aiRuns.db, ctx.store.db);
    assert.equal(ctx.store.repositories.batches.db, ctx.store.db);
    assert.equal(ctx.store.repositories.content.db, ctx.store.db);
    assert.equal(ctx.store.repositories.runtimeAudit.db, ctx.store.db);
    assert.equal(ctx.store.repositories.sourceRuns.db, ctx.store.db);
    assert.equal(ctx.store.repositories.hotspots.db, ctx.store.db);
    assert.equal(ctx.store.repositories.candidates.db, ctx.store.db);
    assert.equal(ctx.store.repositories.themes.db, ctx.store.db);
    assert.equal(ctx.store.repositories.visualDecisions.db, ctx.store.db);

    const batch = ctx.store.createBatch({ date: '2026-08-09', title: 'repository contract' });
    assert.equal(ctx.store.repositories.batches.list().some((item) => item.id === batch.id), true);
    ctx.store.createAiRun({ id: 'repository-job', batchId: batch.id, type: 'article', provider: 'test' });
    assert.deepEqual(ctx.store.getAiRun('repository-job'), ctx.store.repositories.aiRuns.get('repository-job'));
    ctx.store.updateAiRun('repository-job', { status: 'completed', progress: 'done' });
    assert.equal(ctx.store.repositories.aiRuns.get('repository-job').status, 'completed');

    ctx.store.saveUserThemeDraft({ id: 'repository-theme', target: 'article', label: 'Repository theme', definitionJson: '{}' });
    assert.deepEqual(ctx.store.getUserTheme('repository-theme'), ctx.store.repositories.themes.get('repository-theme'));

    ctx.store.saveVisualDecision({ batchId: batch.id, visualType: 'mermaid', action: 'inserted' });
    assert.deepEqual(ctx.store.visualDecisionStats(), ctx.store.repositories.visualDecisions.stats());

    const document = ctx.store.saveDocument({ batchId: batch.id, kind: 'daily-final', title: 'Repository document', content: '正文' });
    assert.deepEqual(ctx.store.getDocumentContent(document.id), ctx.store.repositories.content.getDocumentContent(document.id));
  } finally {
    cleanup(ctx);
  }
});

test('refactoring stage 3: migration runner executes schema definitions and checks foreign keys', () => {
  let migrated = false;
  const db = { exec() {}, prepare: (sql) => ({ all: () => { assert.equal(sql, 'PRAGMA foreign_key_check'); return []; } }) };
  runDatabaseMigrations(db, () => { migrated = true; });
  assert.equal(migrated, true);
});

test('refactoring stage 5: schema ownership lives outside the Store facade', () => {
  assert.equal(typeof applyWorkbenchSchema, 'function');
  assert.equal(Object.hasOwn(Store.prototype, 'migrateSchema'), false);
});

test('refactoring stage 4: typeset output cleanup and theme selection are pure rendering functions', () => {
  assert.equal(extractPureHtml('说明\n```html\n<article>正文</article>\n```'), '<article>正文</article>');
  assert.equal(selectPureTheme({ category: '🤖 AI/技术动态' }), 'tech-wire');
});

test('refactoring stage 4: storyboard density budgeting is a pure rendering function', () => {
  const result = budgetCardPlan([{ kind: 'cover', content_blocks: [{ type: 'text' }, { type: 'note' }, { type: 'highlight' }] }]);
  assert.equal(result.pages[0].content_blocks.length, 2);
  assert.equal(result.trims.length, 1);
});

test('refactoring stage 4: social card layout recommendation is independent from the pipeline', () => {
  const decision = resolvePureLayout({ kind: 'content', content_blocks: [{ type: 'stats' }] });
  assert.equal(decision.layout, 'data');
  assert.equal(decision.source, 'recommended');
});

test('refactoring stage 4: page role and composition seed are deterministic pure functions', () => {
  const page = { kind: 'quickstart', title: '开始', content_blocks: [{ type: 'steps' }] };
  assert.equal(inferPureRole(page), 'steps');
  assert.equal(pureCompositionSeed(page, 0, 'seed'), pureCompositionSeed(page, 0, 'seed'));
});

test('refactoring stage 4: semantic card columns are decided without pipeline side effects', () => {
  const blocks = [{ type: 'stats', content: 'A' }, { type: 'stats', content: 'B' }];
  assert.equal(semanticCardColumns({ content_blocks: blocks }, blocks), 'split-even');
});

test('refactoring stage 4: smart composition normalization is independent from the pipeline', () => {
  const result = normalizePureComposition({ kind: 'cover', content_blocks: [] }, { seed: 'contract' });
  assert.equal(result.role, 'cover');
  assert.equal(result.composition.columns, 'single');
});

test('refactoring stage 4: storyboard cleanup and repair guards are pure rendering functions', () => {
  const original = [{
    kind: 'content',
    title: '让读者一眼知道：核心结论',
    goal: '本页旨在：解释价值',
    evidence: ['公开资料'],
    content_blocks: [{ type: 'list', title: '请看清单', items: ['让读者知道第一项', '第二项'] }],
  }];
  const cleaned = sanitizePurePlan(original);

  assert.equal(cleaned[0].title, '核心结论');
  assert.equal(cleaned[0].goal, '解释价值');
  assert.equal(cleaned[0].content_blocks[0].title, '看清单');
  assert.equal(cleaned[0].content_blocks[0].items[0], '第一项');
  assert.ok(cleaned[0].role);
  assert.ok(cleaned[0].composition.id);

  const changed = structuredClone(cleaned);
  changed[0].content_blocks.pop();
  assert.deepEqual(pureRepairIssues(cleaned, changed), ['P1 内容块数量必须保持为 1']);
});

test('refactoring stage 4: storyboard content blocks render without pipeline dependencies', () => {
  assert.deepEqual(numberedTextSteps('1. 安装：运行命令 2. 启动：打开页面'), [
    { title: '安装', content: '运行命令' },
    { title: '启动', content: '打开页面' },
  ]);
  assert.equal(numberedTextSteps('内存为 27.8 MB，耗时 3.2 秒').length, 0);
  assert.match(
    renderStoryboardBlock({ type: 'list', title: '<清单>', items: ['✅ 第一项', '第二项'] }),
    /<h2>&lt;清单&gt;<\/h2><ul><li>第一项<\/li><li>第二项<\/li><\/ul>/,
  );
  assert.match(
    renderStoryboardBlock({ type: 'timeline', content: '- 第一阶段\n- 第二阶段' }),
    /class="content-block list-block"/,
  );
});

test('refactoring stage 4: storyboard pages assemble independently from the AI pipeline', () => {
  const sections = renderStoryboardSections({
    topic: '<主题>',
    contentType: 'custom',
    channelMode: 'xiaohongshu',
    compiledTheme: { recipes: { skeleton: 'stacked', coverSupport: 'lead', coverTitle: 'plain' } },
    pages: [{ kind: 'cover', title: '<封面>', lead: '摘要' }, { kind: 'ending', title: '结束' }],
  });
  assert.match(sections, /data-page-number="1"/);
  assert.match(sections, /data-page-number="2"/);
  assert.match(sections, /小红书 · &lt;主题&gt;/);
  assert.match(sections, /<h1>&lt;封面&gt;<\/h1>/);
  assert.match(sections, /class="cover-support cover-support-lead">摘要<\/p>/);
});

test('refactoring stage 4: storyboard document shell injects theme CSS and metadata', () => {
  const html = renderStoryboardDocument({
    topic: '<主题>',
    contentType: 'event',
    channelMode: 'xiaohongshu',
    sections: '<section class="page"></section>',
    compiledTheme: {
      id: 'contract-theme',
      className: 'theme-contract',
      version: '1.2.3',
      hash: 'contract-hash',
      css: '.theme-contract{--accent:#123456}',
    },
  });
  assert.match(html, /<title>&lt;主题&gt; · 事件图文<\/title>/);
  assert.match(html, /\.theme-contract\{--accent:#123456\}<\/style>/);
  assert.match(html, /class="theme-contract" data-visual-style="contract-theme" data-theme-version="1.2.3" data-theme-hash="contract-hash" data-channel="xiaohongshu"/);
  assert.match(html, /<section class="page"><\/section><\/body><\/html>$/);
});

test('refactoring stage 4: markdown conversion and design token normalization are pure rendering functions', () => {
  const normalized = normalizePureDesignTokens({
    colors: { accent: 'invalid' },
    typography: { body_px: 99 },
    spacing: { section_px: 1 },
  });
  assert.equal(normalized.colors.accent, '#C4473A');
  assert.equal(normalized.typography.body_px, 18);
  assert.equal(normalized.spacing.section_px, 20);

  const html = renderPureMarkdown('# 标题\n\n正文 **加粗**\n\n| 列一 | 列二 |\n| --- | --- |\n| A | B |\n\n```js\nconst x = 1;\n```');
  assert.match(html, /<h1 style=/);
  assert.match(html, /<table style=/);
  assert.match(html, /data-language="js"/);
  assert.match(html, /font-weight: bold/);
});

test('refactoring stage 4: editor document analysis is independent from DOM state', () => {
  const markdown = '# 标题\n\n## 第一节\n\n这是足够长的正文内容，用于验证段落、字数和章节统计能够稳定工作。\n\n```js\n# 代码内标题\n```';
  assert.deepEqual(editorMarkdownHeadings(markdown).map(({ level, text }) => ({ level, text })), [
    { level: 1, text: '标题' },
    { level: 2, text: '第一节' },
  ]);
  assert.ok(editorVisibleChars(markdown) > 10);
  assert.equal(editorWritingStatistics(markdown).sections, 1);
  assert.deepEqual(editorQualityIssues('# 标题\n\n## 空章节'), [{ type: '空章节', message: '章节“空章节”缺少正文', offset: 6 }]);
  assert.equal(editorLineDiff('A\nB', 'A\nC'), '  A\n- B\n+ C');
});

test('refactoring stage 4: social editor presentation rules are independent from DOM state', () => {
  assert.equal(socialCandidateMode('custom-cards-xiaohongshu'), 'custom');
  assert.equal(socialCandidateMode('event-cards-wechat'), 'event');
  assert.equal(socialCandidateMode('repository-cards'), 'tools');
  assert.match(socialCardBlockEditorHtml({ type: 'text', title: '<标题>', content: '正文' }, 0), /value="&lt;标题&gt;"/);
  assert.match(socialFactsHtml({ contentType: 'repository', facts: { error: '<失败>' } }), /&lt;失败&gt;/);
  assert.deepEqual(socialScoreView({ score: { finalScore: 88 } }, 'custom'), {
    finalScore: 88,
    partsHtml: '<span>自定义图文不参与选题评分</span>',
  });
});
