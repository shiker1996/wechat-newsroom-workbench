import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cardBlockEditorHtml } from '../public/src/views/social-editor-model.js';

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8');

test('第三步持久化事实候选索引并通过图文接口暴露', () => {
  const pipeline = read('../server/features/social-cards/application/social-card-pipeline.mjs');
  const route = read('../server/platform/http/routes/social-card-routes.mjs');
  assert.match(pipeline, /social-card-fact-index\.json/);
  assert.match(pipeline, /deterministic-fact-supplement/);
  assert.match(route, /factIndex:parse\('social-card-fact-index\.json'/);
  assert.match(route, /social-card-fact-index\.json/);
  assert.match(route, /reason:'storyboard-regenerated'/);
  assert.match(route, /invalidateSocialCardArtifacts/);
  assert.match(route, /reason:'theme-changed'/);
  assert.match(route, /reason:'channel-changed'/);
  assert.match(route, /layout-report\.json/);
});

test('故事板编辑器展示补充槽位与事实来源，并保留回写字段', () => {
  const html = cardBlockEditorHtml({
    type: 'note',
    title: '能力补充',
    content: '可核验能力说明',
    supplement_slot_id: 'capability',
    fact_ids: ['fact-capability-1'],
    source_refs: ['https://example.com/readme'],
  }, 0);
  assert.match(html, /storyboard-block-provenance/);
  assert.match(html, /自动补充槽位：capability/);
  assert.match(html, /data-supplement-slot-id="capability"/);
  assert.match(html, /data-fact-ids=/);
  assert.match(html, /data-source-refs=/);
});

test('故事板编辑器不会把仅含 items 的列表块展示为空', () => {
  const html = cardBlockEditorHtml({
    type: 'list',
    title: '关键节点',
    content: '',
    items: ['2019年：上市', '2025年：配售'],
  }, 0);
  assert.match(html, /2019年：上市/);
  assert.match(html, /2025年：配售/);
});

test('故事板调整记录显示来源模式、轮次、页码和事实候选', () => {
  const editor = read('../public/src/views/social-editor.js');
  assert.match(editor, /function adjustmentSourceLabel/);
  assert.match(editor, /程序自动补充/);
  assert.match(editor, /第\$\{round\|\|'\?'\}轮/);
  assert.match(editor, /P\$\{operation\.page\|\|'\?'\}/);
  assert.match(editor, /currentFactIndex\?\.candidates/);
  assert.match(editor, /currentContentPlanAdjustments=null/);
  assert.match(editor, /currentLayoutReportPages=\[\]/);
});

test('页面保存和块类型切换携带补充溯源字段', () => {
  const editor = read('../public/src/views/social-editor.js');
  assert.match(editor, /supplement_slot_id/);
  assert.match(editor, /fact_ids/);
  assert.match(editor, /source_refs/);
  assert.match(editor, /dataset\.factIds/);
  assert.match(editor, /dataset\.sourceRefs/);
});
