import { readStyles } from "./style-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css=readStyles();

test("中等屏幕全局顶栏允许标题与操作区分行",()=>{
  assert.match(css,/@media \(min-width:761px\) and \(max-width:1280px\)/);
  assert.match(css,/\.topbar \{ align-items:flex-start;flex-wrap:wrap;gap:14px 24px; \}/);
  assert.match(css,/\.topbar>div:first-child \{ flex:1 1 100%; \}/);
  assert.match(css,/\.top-actions \{ width:100%;flex-wrap:wrap;justify-content:flex-end/);
});

test("中等屏幕批次选择器可伸缩且顶栏按钮不拆字",()=>{
  assert.match(css,/\.top-actions \.batch-switcher \{ flex:1 1 190px;max-width:280px; \}/);
  assert.match(css,/\.top-actions button \{ flex:0 0 auto;white-space:nowrap; \}/);
});
