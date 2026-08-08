import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const editor=fs.readFileSync(new URL('../public/src/views/editor.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');

test('编辑器集合查询使用 $$，不把单元素查询结果当数组',()=>{
  assert.doesNotMatch(editor,/(^|[^$])\$\([^)]*\)\.forEach/m);
  assert.match(editor,/\$\$\("input\[name=doc-kind\]"\)\.forEach/);
});

test('草稿编辑使用防抖自动保存并展示保存状态',()=>{
  assert.match(editor,/setTimeout\(\(\)=>\{/);
  assert.match(editor,/saveDocument\(\{automatic:true\}\)/);
  assert.match(editor,/selectedDocKind\(\)!=="draft"/);
  assert.match(html,/id="document-save-state"[^>]+role="status"/);
});

test('保存期间的新修改通过编辑代次避免被误标为已保存',()=>{
  assert.match(editor,/editGeneration\+=1/);
  assert.match(editor,/savingGeneration===editGeneration/);
  assert.match(editor,/有新修改 · 即将自动保存/);
});

test('未保存内容在关闭页面前触发浏览器保护',()=>{
  assert.match(editor,/beforeunload/);
  assert.match(editor,/event\.returnValue=""/);
});

test('编辑器支持保存快捷键和限定焦点的查找快捷键',()=>{
  assert.match(editor,/event\.key\.toLowerCase\(\)==="s"/);
  assert.match(editor,/event\.key\.toLowerCase\(\)==="f"/);
  assert.match(editor,/document\.activeElement===document\.getElementById\("markdown-editor"\)/);
  assert.match(html,/id="find-dialog"/);
});

test('查找替换支持逐个替换、全部替换和大小写选项',()=>{
  assert.match(editor,/function findNext\(\)/);
  assert.match(editor,/function replaceOne\(\)/);
  assert.match(editor,/function replaceAll\(\)/);
  assert.match(html,/id="find-case-sensitive"/);
});

test('Markdown 工具栏提供常用结构与撤销重做',()=>{
  for(const command of ['heading','bold','quote','unordered-list','ordered-list','link','undo','redo']){
    assert.match(html,new RegExp(`data-markdown-command="${command}"`));
  }
  assert.match(editor,/function applyMarkdownCommand\(command\)/);
  assert.match(editor,/function applyHistoryCommand\(command\)/);
  assert.match(editor,/function pushHistory\(value\)/);
  assert.doesNotMatch(editor,/document\.execCommand\(/);
});

test('Markdown 加粗与链接支持编辑器快捷键',()=>{
  assert.match(editor,/event\.key\.toLowerCase\(\)==="b"/);
  assert.match(editor,/applyMarkdownCommand\("bold"\)/);
  assert.match(editor,/event\.key\.toLowerCase\(\)==="k"/);
  assert.match(editor,/applyMarkdownCommand\("link"\)/);
});

test('专注模式可切换、记忆偏好并通过 Esc 退出',()=>{
  assert.match(html,/id="editor-focus-mode"[^>]+aria-pressed="false"/);
  assert.match(editor,/localStorage\.setItem\("editor-focus-mode"/);
  assert.match(editor,/event\.key==="Escape"/);
  assert.match(editor,/document\.body\.classList\.toggle\("editor-focus"/);
});

test('文章大纲解析一至三级标题并排除代码围栏',()=>{
  assert.match(html,/id="document-outline"/);
  assert.match(editor,/function markdownHeadings\(markdown\)/);
  assert.equal(editor.includes('/^(#{1,3})\\s+'),true);
  assert.match(editor,/inFence=!inFence/);
});

test('大纲章节可同时定位编辑器与预览并记忆展开状态',()=>{
  assert.match(editor,/function jumpToHeading\(button\)/);
  assert.match(editor,/editor\.setSelectionRange\(offset,offset\)/);
  assert.match(editor,/function textareaTextOffsetTop\(editor,offset\)/);
  assert.match(editor,/textareaTextOffsetTop\(editor,offset\)/);
  assert.match(editor,/getBoundingClientRect\(\)\.top-preview\.getBoundingClientRect\(\)\.top/);
  assert.match(editor,/preview\.querySelectorAll\("h1,h2,h3"\)/);
  assert.match(editor,/localStorage\.setItem\("editor-outline-visible"/);
});

test('窄桌面宽度下保存按钮留在工具栏网格内',()=>{
  assert.match(css,/@media\(max-width:1200px\)/);
  assert.match(css,/\.writing-toolbar #save-document\{grid-column:6;max-width:100%\}/);
});

test('写作统计实时计算字数、段落与阅读时长',()=>{
  assert.match(html,/id="writing-stats"/);
  assert.match(editor,/function writingStatistics\(markdown\)/);
  assert.match(editor,/Math\.ceil\(chars\/400\)/);
  assert.match(editor,/stat-paragraphs/);
});

test('章节完整度检查标题后的正文展开量',()=>{
  assert.match(editor,/headings=markdownHeadings\(markdown\)\.filter/);
  assert.match(editor,/>=50/);
  assert.match(editor,/stats\.complete===stats\.sections/);
});

test('写作目标按批次、候选与文稿类型分别保存',()=>{
  assert.match(html,/id="writing-goal-dialog"/);
  assert.match(editor,/writing-goal:\$\{state\.activeBatchId/);
  assert.match(editor,/selectedDocKind\(\)/);
  assert.match(editor,/localStorage\.setItem\(writingGoalKey\(\)/);
});

test('写作目标实时计算百分比并限制合理范围',()=>{
  assert.match(editor,/Math\.min\(100,Math\.round\(stats\.chars\/goal\*100\)\)/);
  assert.match(editor,/value<200\|\|value>10000/);
  assert.match(editor,/--goal-progress/);
});

test('质量检查覆盖空章节、长段落、标题结构和来源链接',()=>{
  assert.match(html,/id="quality-dialog"/);
  assert.match(editor,/function qualityIssues\(markdown\)/);
  assert.match(editor,/缺少一级标题/);
  assert.match(editor,/段落过长/);
  assert.match(editor,/缺少正文/);
  assert.match(editor,/尚未包含任何来源链接/);
});

test('质量问题支持点击定位正文且不会自动改写',()=>{
  assert.match(editor,/function jumpToQualityIssue\(button\)/);
  assert.match(editor,/editor\.setSelectionRange\(offset,offset\)/);
  const body=editor.slice(editor.indexOf('function jumpToQualityIssue'),editor.indexOf('function markdownHeadings'));
  assert.doesNotMatch(body,/setRangeText/);
});

test('发布前检查统一汇总保存、目标、质量与终稿门禁',()=>{
  assert.match(html,/id="editor-preflight"/);
  assert.match(html,/id="preflight-dialog"/);
  assert.match(editor,/function preflightChecks\(/);
  assert.match(editor,/label:"保存状态"/);
  assert.match(editor,/label:"写作目标"/);
  assert.match(editor,/label:"内容质量"/);
  assert.match(editor,/label:"终稿门禁"/);
  assert.match(editor,/data-preflight-action/);
});

test('空候选批次不请求 candidateId 0 且候选恢复后清除空态提示',()=>{
  assert.match(editor,/if\s*\(\s*!candidateId\s*&&\s*!daily\s*\)\s*\{/);
  assert.match(editor,/setSaveState\("saved","等待锁定候选"\)/);
  assert.match(editor,/ctxEl\.innerHTML = writingOptions\.length/);
  assert.match(editor,/\? "事实、观点、禁写项不会被压缩"/);
});
