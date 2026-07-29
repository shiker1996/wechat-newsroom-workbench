import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const editorial=fs.readFileSync(new URL('../public/src/views/editorial.js',import.meta.url),'utf8');
const tutorial=fs.readFileSync(new URL('../public/src/views/tutorial.js',import.meta.url),'utf8');
const daily=fs.readFileSync(new URL('../public/src/views/daily.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');

test('article creation entries expose and submit compatible writer selections',()=>{
  assert.match(html,/id="editorial-writer-skill"/);
  assert.match(html,/id="tutorial-writer-skill"/);
  assert.match(editorial,/\/writer-skills/);
  assert.match(editorial,/skillId: document\.getElementById\("editorial-writer-skill"\)/);
  assert.match(tutorial,/creation-entry-points\/independent-writing\/skills/);
  assert.match(html,/name="skillId"/);
  assert.match(html,/id="editorial-stage-skills"/);
  assert.match(html,/本次创作配置/);
  assert.match(html,/id="editorial-skill-summary"/);
  assert.match(html,/id="reset-editorial-skills"/);
  assert.match(editorial,/selectedStageSkills/);
  assert.match(editorial,/updateEditorialSkillSummary/);
  assert.match(editorial,/stageSkills:/);
});

test('autonomous writing and batch daily expose the same per-run stage skill flow',()=>{
  assert.match(html,/id="tutorial-stage-skills"/);
  assert.match(html,/id="daily-stage-skills"/);
  assert.match(tutorial,/independent-writing\/stage-skills/);
  assert.match(tutorial,/input\.stageSkills=selectedStageSkills/);
  assert.match(daily,/batch-daily\/stage-skills/);
  assert.match(daily,/stageSkills=selectedStageSkills/);
  assert.match(server,/entryPoint:'independent-writing',[\s\S]*?requested:input\.stageSkills/);
  assert.match(server,/entryPoint:'batch-daily',requested:requestedStages/);
  assert.match(server,/hasExplicitStages/);
});

test('批次早报第二步在宽屏使用覆盖确认与成稿配置双区布局',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const styles=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
  assert.match(html,/class="daily-production-grid"/);
  assert.match(html,/class="daily-review-column"/);
  assert.match(html,/class="daily-settings-column"/);
  assert.match(styles,/\.daily-production-panel\{width:min\(100%,1280px\);max-width:none/);
  assert.match(styles,/\.daily-production-grid\{display:grid;grid-template-columns:minmax\(0,.92fr\) minmax\(390px,1.08fr\)\}/);
  assert.match(styles,/@media\(max-width:1050px\).*?\.daily-production-grid\{grid-template-columns:1fr\}/s);
});

test('autonomous writing uses the same creation configuration interaction as hotspot articles',()=>{
  assert.match(html,/id="tutorial-creation-skill-settings"/);
  assert.match(html,/id="tutorial-skill-summary"/);
  assert.match(html,/id="reset-tutorial-skills"/);
  assert.match(html,/id="close-tutorial-skills"/);
  assert.match(html,/选择主写与加工方式/);
  assert.match(tutorial,/function updateTutorialSkillSummary/);
  assert.match(tutorial,/stage-skills-loaded/);
  assert.match(tutorial,/removeAttribute\("open"\)/);
});
