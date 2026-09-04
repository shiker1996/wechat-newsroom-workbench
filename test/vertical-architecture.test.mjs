import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('领域层不反向依赖 LLM 编排层', () => {
  const files = fs.readdirSync(path.join(root, 'server', 'shared', 'domain'), { recursive: true })
    .filter((file) => String(file).endsWith('.mjs'));
  for (const file of files) {
    const source = read(path.join('server', 'shared', 'domain', file));
    assert.doesNotMatch(source, /from ['"][^'"]*\/llm\//, `领域文件 ${file} 不应依赖 llm`);
    assert.doesNotMatch(source, /from ['"][^'"]*\/features\//, `领域文件 ${file} 不应反向依赖 features`);
  }
});

test('shared 与低层 platform 不反向依赖业务 feature', () => {
  const walk = (directory) => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(relative) : entry.name.endsWith('.mjs') ? [relative] : [];
  });
  for (const file of walk('server/shared')) {
    assert.doesNotMatch(read(file), /from ['"][^'"]*\/(?:features|platform)\//, `shared 文件 ${file} 不应依赖 features/platform`);
  }
  for (const layer of ['core', 'collectors', 'connectors', 'extensions', 'persistence', 'plugin-sdk', 'plugins', 'tools']) {
    for (const file of walk(path.join('server/platform', layer))) {
      assert.doesNotMatch(read(file), /from ['"][^'"]*\/features\//, `低层 platform 文件 ${file} 不应依赖 features`);
    }
  }
});

test('platform 只有面向应用的适配层可以依赖业务 feature', () => {
  const walk = (directory) => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(relative) : entry.name.endsWith('.mjs') ? [relative] : [];
  });
  const allowed = new Set(['agent', 'application', 'http', 'integrations', 'jobs', 'llm']);
  for (const file of walk('server/platform')) {
    const relative = path.relative(path.join(root, 'server', 'platform'), path.join(root, file));
    const layer = relative.split(path.sep)[0];
    if (allowed.has(layer)) continue;
    assert.doesNotMatch(read(file), /from ['"][^'"]*\/features\//, `platform/${relative} 不应依赖业务 feature`);
  }
});

test('platform/llm 只保留通用基础设施', () => {
  const files = fs.readdirSync(path.join(root, 'server', 'platform', 'llm'))
    .filter((name) => name.endsWith('.mjs')).sort();
  assert.deepEqual(files, [
    'context-manager.mjs', 'context-safety.mjs', 'decision-tools.mjs', 'events.mjs', 'gateway.mjs', 'model-json-repair.mjs', 'model-json.mjs', 'output-budget.mjs', 'responses-api.mjs',
    'skill-runtime.mjs', 'stream-events.mjs', 'web-search.mjs',
  ]);
});

test('研究与图文生产调用方通过业务垂直入口访问核心流水线', () => {
  const callers = [
    'server.mjs',
    'server/platform/http/route-helpers.mjs',
    'server/platform/http/routes/task-routes.mjs',
    'server/platform/http/routes/candidate-routes.mjs',
    'server/platform/http/routes/batch-routes.mjs',
    'server/platform/http/routes/social-card-routes.mjs',
    'server/features/batches/application/pipeline-failure-retry.mjs',
    'server/features/batches/application/auto-pipeline.mjs',
    'server/features/batches/application/ai-job-handlers.mjs',
    'server/features/research/llm/tasks.mjs',
    'server/features/articles/llm/daily-pipeline.mjs',
    'server/platform/application/themes/theme-preview.mjs',
    'server/platform/application/themes/social-template-proposal-compiler.mjs',
  ];
  for (const file of callers) {
    const source = read(file);
    assert.doesNotMatch(source, /from ['"][^'"]*(?:research-pipeline|social-card-pipeline|domain\/(?:event-fact-base|hotspot-atlas|custom-fact-builder|social-card-storyboard-contracts))\.mjs['"]/, `${file} 不应直接穿透旧业务模块`);
  }
});

test('研究和图文垂直入口暴露稳定的业务能力集合', async () => {
  const research = await import('../server/features/research/index.mjs');
  const socialCards = await import('../server/features/social-cards/index.mjs');
  for (const name of ['runResearchPipeline', 'ensureBatchEventCards', 'clusterItems', 'dimensionSelections', 'scoreCards', 'buildHotspotAtlas']) {
    assert.equal(typeof research[name], 'function', `research 入口缺少 ${name}`);
  }
  for (const name of ['runSocialCardPipeline', 'renderStoryboardHtml', 'cleanCardPlanJson', 'evaluateCardGate', 'buildSocialCardFactEnvelope']) {
    assert.equal(typeof socialCards[name], 'function', `social-cards 入口缺少 ${name}`);
  }
});

test('文章与采集生产调用方通过业务垂直入口访问核心能力', async () => {
  const callers = [
    'server.mjs',
    'server/platform/http/routes/article-routes.mjs',
    'server/platform/http/routes/media-routes.mjs',
    'server/platform/http/routes/task-routes.mjs',
    'server/platform/http/routes/candidate-routes.mjs',
    'server/platform/http/routes/system-routes.mjs',
    'server/features/batches/application/ai-job-handlers.mjs',
    'server/features/batches/application/auto-pipeline.mjs',
    'server/features/collection/application/collection-job-manager.mjs',
    'server/features/batches/application/pipeline-failure-retry.mjs',
    'server/platform/application/themes/theme-preview.mjs',
  ];
  for (const file of callers) {
    const source = read(file);
    assert.doesNotMatch(source, /from ['"][^'"]*\/(?:article-pipeline|typeset-pipeline|breaking-analysis-pipeline|daily-pipeline|tutorial-pipeline|cover-image-generator|article-image-generator|image-workflow|visual-planner|editorial-room|domain\/collection-quality|collectors\/source-service)\.mjs['"]/, `${file} 不应直接穿透文章/采集旧模块`);
  }
  const articles = await import('../server/features/articles/index.mjs');
  const collection = await import('../server/features/collection/index.mjs');
  for (const name of ['runArticlePipeline', 'runTypesetPipeline', 'runBreakingAnalysisPipeline', 'runDailyPipeline', 'planArticleVisuals', 'planImagePlaceholders']) {
    assert.equal(typeof articles[name], 'function', `articles 入口缺少 ${name}`);
  }
  for (const name of ['filterCollectedItems', 'CollectionSourceService', 'createStoreCollectionRunner']) {
    assert.equal(typeof collection[name], name === 'CollectionSourceService' ? 'function' : 'function', `collection 入口缺少 ${name}`);
  }
});

test('采集业务用例位于 collection 垂直，platform/collectors 只保留插件运行时', () => {
  const application = path.join(root, 'server', 'features', 'collection', 'application');
  for (const name of ['source-service.mjs', 'collection-runner.mjs', 'store-collection-runner.mjs', 'static-page-assistant.mjs']) {
    assert.equal(fs.existsSync(path.join(application, name)), true, `collection application 缺少 ${name}`);
  }
  for (const name of ['source-service.mjs', 'runner.mjs', 'store-runner.mjs', 'static-page-assistant.mjs']) {
    assert.equal(fs.existsSync(path.join(root, 'server', 'platform', 'collectors', name)), false, `platform/collectors 仍包含业务用例：${name}`);
  }
  const platformFiles = fs.readdirSync(path.join(root, 'server', 'platform', 'collectors'))
    .filter((name) => name.endsWith('.mjs'));
  assert.deepEqual(platformFiles.sort(), [
    'builtin-registry.mjs', 'contracts.mjs', 'package-manager.mjs', 'registry.mjs', 'runtime-registry.mjs', 'settings.mjs',
  ]);
});

test('批次与图文门禁实现位于对应业务垂直', async () => {
  const batchRoutes = read('server/platform/http/routes/batch-routes.mjs');
  const server = read('server.mjs');
  const socialPipeline = read('server/features/social-cards/application/social-card-pipeline.mjs');
  assert.doesNotMatch(batchRoutes, /domain\/(?:batch-pipeline-status|batch-deletion|topic-score-operations)\.mjs/);
  assert.doesNotMatch(server, /domain\/batch-deletion\.mjs/);
  assert.doesNotMatch(socialPipeline, /from ['"]\.\.\.\/domain\/social-card-gate\.mjs['"]/);
  const batches = await import('../server/features/batches/index.mjs');
  assert.equal(typeof batches.buildBatchPipelineStatus, 'function');
  assert.equal(typeof batches.deleteBatchPermanently, 'function');
});

test('server 每个模块目录都有 README 说明职责与依赖边界', () => {
  const walkDirectories = (directory) => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const relative = path.join(directory, entry.name);
    return [relative, ...walkDirectories(relative)];
  });
  for (const directory of walkDirectories('server')) {
    assert.equal(
      fs.existsSync(path.join(root, directory, 'README.md')),
      true,
      `${directory} 缺少 README.md`
    );
  }
});
