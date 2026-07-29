import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const editor=fs.readFileSync(new URL("../public/src/views/editor.js",import.meta.url),"utf8");
const batches=fs.readFileSync(new URL("../public/src/views/batches.js",import.meta.url),"utf8");
const dashboard=fs.readFileSync(new URL("../public/src/views/dashboard.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");

test("文章编辑器无锁定候选时禁用写作、AI 与检查工具并只保留热点全景入口",()=>{
  assert.match(editor,/function setWritingDeskAvailability\(available\)/);
  assert.match(editor,/\.markdown-toolbar button/);
  assert.match(editor,/control\.disabled=!available/);
  assert.match(editor,/setWritingDeskAvailability\(Boolean\(writingOptions\.length\)\)/);
  assert.match(editor,/href="#overview">前往热点全景创建选题/);
  assert.doesNotMatch(editor,/href="#editorial">文章编辑室/);
});

test("批次管理支持生命周期筛选、标题搜索和已完成待归档分组",()=>{
  assert.match(html,/id="batch-search"/);
  assert.match(html,/data-batch-filter="completed">已完成待归档/);
  assert.match(batches,/lifecycleFilter==="all"\|\|lifecycle===lifecycleFilter/);
  assert.match(batches,/batch\.title\|\|""/);
  assert.match(batches,/\["completed","已完成待归档"\]/);
});

test("效率反馈展示采集到研判耗时与最近批次基线",()=>{
  assert.match(dashboard,/采集到研判耗时/);
  assert.match(dashboard,/collectToResearchDurationMs/);
  assert.match(dashboard,/efficiencyBaseline/);
  assert.match(dashboard,/近 \$\{baseline\.sampleSize\} 批均值/);
});
