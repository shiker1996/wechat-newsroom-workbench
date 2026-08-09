import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "public/src/views/dashboard.js"), "utf8");
const workbenchQueries = fs.readFileSync(path.join(root, "lib/persistence/queries/workbench-query-service.mjs"), "utf8");

test("首页首屏提供五项可操作值班信号", () => {
  assert.match(html, /id="dashboard-attention"/);
  for (const label of ["采集状态", "当前流程", "待确认选题", "成稿门禁", "失败任务"]) assert.match(dashboard, new RegExp(label));
  assert.match(dashboard, /class="attention-card \$\{item\.tone\}"/);
});

test("采集状态进入采集源，当前流程打开批次详情", () => {
  assert.match(dashboard, /label: "采集状态"[\s\S]*go: "sources"/);
  assert.match(dashboard, /label: "当前流程"[\s\S]*batch: latest\?\.id/);
  assert.doesNotMatch(dashboard, /go: "subscriptions"/);
});

test("首页概览返回当前批次异常与待办统计", () => {
  assert.match(workbenchQueries, /failedRuns:/);
  assert.match(workbenchQueries, /pendingArticleCandidates:/);
  assert.match(workbenchQueries, /blockedBriefs:/);
  assert.match(workbenchQueries, /sourceOk:/);
});

test("累计数据退为四项次级指标", () => {
  assert.match(dashboard, /\["今日文章"[\s\S]*\["累计产物"/);
  assert.doesNotMatch(dashboard, /\["HOTSPOTS"/);
});

test("工作台展示基于真实记录的内部生产效率反馈",()=>{
  assert.match(html,/id="dashboard-efficiency"/);
  assert.match(html,/id="efficiency-insight"/);
  for(const label of ["采集到研判耗时","AI 任务成功率","选题推进率","产物输出"])assert.match(dashboard,new RegExp(label));
  assert.match(dashboard,/data\.bottleneck/);
});
