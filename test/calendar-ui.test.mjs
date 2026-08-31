import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const styles=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const calendar=fs.readFileSync(new URL('../public/src/views/calendar.js',import.meta.url),'utf8');

test('内容日历标题按钮可收缩并在自身显示省略号',()=>{
  assert.match(calendar,/class="inline-button" \$\{action\}>\$\{escapeHtml\(t\)\}<\/button>/);
  assert.match(styles,/\.wechat-weekly-head span:not\(:first-child\),\.wechat-week-row span:not\(:first-child\)\{[^}]*text-align:right/);
  assert.match(calendar,/openArtifactPreview\("\/api\/documents\/" \+ calArticle\.dataset\.calArticle \+ "\/content", \{\s*originalUrl:/);
  assert.match(styles,/\.cal-article \{[^}]*display:flex[^}]*overflow:hidden/);
  assert.match(styles,/\.cal-article \.inline-button \{[^}]*min-width:0[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/);
  assert.match(styles,/\.cal-content-type \{[^}]*flex:0 0 auto/);
});
