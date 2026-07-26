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
  assert.match(html, /评分怎么看？[\s\S]*历史表现 H[\s\S]*综合成稿分 F/);
  assert.match(topics, /历史 H[\s\S]*潜力 B[\s\S]*总分 F/);
  assert.doesNotMatch(html, /继续使用 H\/B\/P\/S\/D\/F 评分/);
});

test("编辑状态保留机器值但向用户显示结果语言", () => {
  assert.match(html, /option value="DISCUSS">继续讨论/);
  assert.match(html, /option value="WRITE_NOW">可以成稿/);
  assert.match(editorial, /DISCUSS: "讨论中"[\s\S]*LOCKED: "简报已锁定"/);
});

test("核心黑马筛选不再只显示 8+2", () => {
  assert.match(batch, /核心 8 条 \+ 黑马 2 条/);
  assert.match(batch, /核心 \/ 黑马筛选 · 六维评分/);
});
