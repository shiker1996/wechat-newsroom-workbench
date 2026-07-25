import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('自动任务类型串联打标、事件卡与事件研判', () => {
  const manager = fs.readFileSync(new URL('../lib/ai-job-manager.mjs', import.meta.url), 'utf8');
  assert.match(manager, /'tag','retag','event-cards','research','breaking-analysis','article','typeset','social-card','auto'/);
  const autoBranch = manager.slice(manager.indexOf("job.type === 'auto'"));
  assert.match(autoBranch, /runBreakingAnalysisPipeline/);
  const tagAt = autoBranch.indexOf('tagBatch');
  const cardsAt = autoBranch.indexOf('ensureBatchEventCards');
  const researchAt = autoBranch.indexOf('runResearchPipeline');
  assert.ok(tagAt > -1 && cardsAt > tagAt && researchAt > cardsAt, 'auto 必须按 打标→事件卡→研判 顺序串联');
});

test('事件卡是独立环节：单独任务类型，打标不再顺带生成', () => {
  const manager = fs.readFileSync(new URL('../lib/ai-job-manager.mjs', import.meta.url), 'utf8');
  const tagBranch = manager.slice(manager.indexOf("job.type === 'tag'"), manager.indexOf("job.type === 'event-cards'"));
  assert.doesNotMatch(tagBranch, /ensureBatchEventCards/);
  const cardsBranch = manager.slice(manager.indexOf("job.type === 'event-cards'"));
  assert.match(cardsBranch, /ensureBatchEventCards/);
  assert.match(cardsBranch, /regenerate:Boolean\(force\)/);
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.ok(server.includes('/api\\/batches\\/([^/]+)\\/ai\\/event-cards'), 'server.mjs 缺少 /ai/event-cards 路由');
  assert.match(server, /batch\.event_cards = \{ count: cardTotal \? Math\.min\(cardCount, cardTotal\) : 0/);
  const ui = fs.readFileSync(new URL('../public/src/views/batch-drawer.js', import.meta.url), 'utf8');
  assert.match(ui, /data-ai-event-cards/);
  assert.match(ui, /生成事件卡/);
});

test('批次一键自动化路由与手动重试入口并存', () => {
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.ok(server.includes('/api\\/batches\\/([^/]+)\\/ai\\/auto'), 'server.mjs 缺少 /ai/auto 路由');
  assert.match(server, /type:'auto'/);
  const ui = fs.readFileSync(new URL('../public/src/views/batch-drawer.js', import.meta.url), 'utf8');
  assert.match(ui, /job\.type === "collect"[\s\S]*?\/ai\/auto/);
  assert.match(ui, /job\.type === "research" \|\| job\.type === "auto"/);
  assert.match(ui, /data-ai-retag/);
  assert.match(ui, /data-ai-research/);
  assert.match(ui, /一键采集并研判/);
});
