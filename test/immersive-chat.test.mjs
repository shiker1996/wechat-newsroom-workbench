import { readStyles } from "./style-fixture.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const styles=readStyles();
const main=fs.readFileSync(new URL('../public/src/main.js',import.meta.url),'utf8');

test('自主写作沉浸对话移除动画祖先的 fixed 定位约束',()=>{
  assert.match(styles,/\.tutorial-writing-workspace:has\(\.editorial-chat\.immersive\)\s*\{[^}]*animation:none[^}]*transform:none/);
  assert.match(styles,/\.editorial-chat\.immersive\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/);
  assert.match(main,/classList\.toggle\("immersive"\)/);
});
