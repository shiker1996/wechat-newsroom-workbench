import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const topics = fs.readFileSync(path.join(root, "public/src/views/topics.js"), "utf8");
const editorial = fs.readFileSync(path.join(root, "public/src/views/editorial.js"), "utf8");
const batch = fs.readFileSync(path.join(root, "public/src/views/batch-drawer.js"), "utf8");

test("文章评分默认显示中文含义并提供公式说明", () => {
  assert.match(html, /评分怎么看？[\s\S]*研判价值 J[\s\S]*最终选题分 F/);
  assert.match(topics, /事件 T[\s\S]*研判 J[\s\S]*最终 F/);
  assert.doesNotMatch(html, /继续使用 H\/B\/P\/S\/D\/F 评分/);
});

test("编辑状态由代码推导并向用户显示结果语言（不再提供人工状态选择）", () => {
  assert.doesNotMatch(html, /name="next_action"/);
  assert.match(editorial, /DISCUSS: "讨论中"[\s\S]*LOCKED: "简报已锁定"/);
});

test("核心黑马筛选不再只显示 8+2", () => {
  assert.match(batch, /核心 8 条 \+ 黑马 2 条/);
  assert.match(batch, /Top-K 研判与选题生成/);
});
