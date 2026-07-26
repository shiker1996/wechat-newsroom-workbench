import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const drawer=fs.readFileSync(new URL("../public/src/views/batch-drawer.js",import.meta.url),"utf8");
const batches=fs.readFileSync(new URL("../public/src/views/batches.js",import.meta.url),"utf8");
const dashboard=fs.readFileSync(new URL("../public/src/views/dashboard.js",import.meta.url),"utf8");

test("批次详情提供完成、归档和重新打开操作",()=>{
  assert.match(drawer,/data-batch-lifecycle="completed"/);
  assert.match(drawer,/data-batch-lifecycle="archived"/);
  assert.match(drawer,/data-batch-lifecycle="active"/);
  assert.match(drawer,/async function updateBatchLifecycle\(lifecycleStatus\)/);
  assert.match(drawer,/JSON\.stringify\(\{lifecycleStatus\}\)/);
});

test("当前批次选择器排除已完成和已归档批次",()=>{
  assert.match(dashboard,/\(b\.lifecycle_status\|\|"active"\)==="active"/);
  assert.match(batches,/completed:"已完成"/);
  assert.match(batches,/archived:"已归档"/);
});
