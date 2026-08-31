import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const styles=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const calendar=fs.readFileSync(new URL('../public/src/views/calendar.js',import.meta.url),'utf8');
const materialInbox=fs.readFileSync(new URL('../public/src/views/material-inbox.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

test('内容日历标题按钮可收缩并在自身显示省略号',()=>{
  assert.match(calendar,/class="inline-button" \$\{action\}>\$\{escapeHtml\(t\)\}<\/button>/);
  assert.match(styles,/\.wechat-weekly-head span:not\(:first-child\),\.wechat-week-row span:not\(:first-child\)\{[^}]*text-align:right/);
  assert.match(calendar,/openArtifactPreview\("\/api\/documents\/" \+ calArticle\.dataset\.calArticle \+ "\/content", \{\s*originalUrl:/);
  assert.match(styles,/\.cal-article \{[^}]*display:flex[^}]*overflow:hidden/);
  assert.match(styles,/\.cal-article \.inline-button \{[^}]*min-width:0[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/);
  assert.match(styles,/\.cal-content-type \{[^}]*flex:0 0 auto/);
});

test('素材只进入自主写作，不再生成或展示内容日历计划',()=>{
  assert.match(calendar,/\.filter\(\(item\) => item\.content_type !== "writing_plan"\)/);
  assert.doesNotMatch(materialInbox,/data-material-plan-toggle|data-material-plan-form|writing-material-plans/);
  assert.doesNotMatch(index,/排进内容日历|也可以单独排进内容日历|data-material-plan-toggle/);
});
