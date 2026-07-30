import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const atlas=fs.readFileSync(new URL("../public/src/views/atlas.js",import.meta.url),"utf8");
const system=fs.readFileSync(new URL("../public/src/views/system.js",import.meta.url),"utf8");
const main=fs.readFileSync(new URL("../public/src/main.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
const systemRoutes=fs.readFileSync(new URL("../lib/http/routes/system-routes.mjs",import.meta.url),"utf8");

test("热点全景空批次合并为空态并引导打开批次采集研判",()=>{
  assert.match(html,/id="atlas-stage-empty" hidden/);
  assert.match(html,/data-atlas-collect/);
  assert.match(atlas,/const noBatchData=Number\(atlas\.eventCount\|\|0\)===0/);
  assert.match(atlas,/section\.hidden=noBatchData/);
  assert.match(atlas,/openBatch\(state\.activeBatchId\)/);
});

test("采集控制显示最后检查时间并支持 Reddit、RSSHub、GitHub 单卡重试",()=>{
  assert.match(html,/id="system-last-checked"/);
  for(const target of ["reddit","rsshub","github"])assert.match(html,new RegExp(`data-health-target="${target}"`));
  assert.match(system,/async function loadSystem\(target = "all", button = null\)/);
  assert.match(system,/最后检查：/);
  assert.match(systemRoutes,/\['all', 'reddit', 'rsshub', 'github'\]\.includes\(target\)/);
  assert.match(systemRoutes,/target === 'all' \|\| target === 'reddit'/);
});

test("说明文字提高可读性并自动收起与顶栏重复的页面标题",()=>{
  assert.match(main,/section-intro-title-redundant/);
  assert.match(main,/introTitle\?\.textContent\.trim\(\)===titles\[view\]/);
  assert.match(css,/\.section-intro-title-redundant h2\{display:none\}/);
  assert.match(css,/\.subscription-test-result,\.source-health,\.source-cost-note\{font-size:11px\}/);
});
