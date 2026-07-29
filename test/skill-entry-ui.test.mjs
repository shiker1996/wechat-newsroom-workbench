import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const editorial=fs.readFileSync(new URL('../public/src/views/editorial.js',import.meta.url),'utf8');
const tutorial=fs.readFileSync(new URL('../public/src/views/tutorial.js',import.meta.url),'utf8');

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
