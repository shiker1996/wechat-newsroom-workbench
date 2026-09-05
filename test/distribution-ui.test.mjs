import { readStyles } from "./style-fixture.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const topics = fs.readFileSync(path.join(root, "public/src/views/topics.js"), "utf8");
const editorial = fs.readFileSync(path.join(root, "public/src/views/editorial.js"), "utf8");
const styles = readStyles(root);

test("文章选题卡只读展示分发池和读者利益", () => {
  assert.match(topics, /class="candidate-distribution"/);
  assert.match(topics, /item\.distribution_lane/);
  assert.match(topics, /item\.reader_stake/);
  assert.match(styles, /\.distribution-lane-recommendation/);
  assert.match(styles, /\.distribution-lane-notification/);
  assert.match(styles, /\.distribution-lane-experiment/);
});

test("编辑会顶部和候选 Tab 展示分发判断但不提供人工改池控件", () => {
  assert.match(html, /id="editorial-distribution-lane"/);
  assert.match(html, /id="editorial-reader-stake"/);
  assert.match(editorial, /editorial-candidate-lane/);
  assert.match(editorial, /candidate\.distribution_lane/);
  assert.match(editorial, /candidate\.reader_stake/);
  assert.doesNotMatch(html, /name="distribution_lane"|name="reader_stake"/);
  assert.doesNotMatch(editorial, /body:\s*JSON\.stringify\(\{[^}]*distribution_lane/);
});
