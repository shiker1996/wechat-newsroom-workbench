import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "public/src/views/editorial.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

test("编辑室以对话和成稿门禁为主视图，详细决策字段默认折叠", () => {
  assert.match(html, /class="editorial-focus-grid"[\s\S]*class="editorial-chat"[\s\S]*id="editorial-production-gate"/);
  assert.match(html, /<details class="editorial-decision-details" id="editorial-decision-details">/);
  assert.doesNotMatch(html, /<details class="editorial-decision-details"[^>]*\sopen(?:\s|>)/);
});

test("未通过的成稿门禁可定位到决策底稿字段", () => {
  assert.match(source, /data-gate-field/);
  assert.match(source, /details\.open = true/);
  assert.match(source, /field\.scrollIntoView/);
});

test("成稿门禁显示在全宽对话区下方", () => {
  assert.match(styles, /\.editorial-focus-grid\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(styles, /\.editorial-focus-grid \.editorial-production-gate\s*\{[^}]*position:static[^}]*grid-row:2/);
  assert.match(styles, /\.editorial-focus-grid \.editorial-chat\s*\{[^}]*grid-row:1/);
});

test("编辑会中的超长链接不会撑宽消息区", () => {
  assert.match(styles, /\.editorial-messages\s*\{\s*overflow-x:hidden/);
  assert.match(styles, /\.editorial-message p\s*\{[^}]*overflow-wrap:anywhere[^}]*word-break:break-word/);
  assert.match(styles, /\.editorial-reply textarea\s*\{[^}]*overflow-x:hidden[^}]*overflow-wrap:anywhere/);
});

test("候选题以横向顶部 Tab 栏展示", () => {
  assert.match(html, /class="candidate-tab-arrow previous"[\s\S]*<nav class="candidate-sidebar" id="editorial-candidates" aria-label="编辑候选题"><\/nav>[\s\S]*class="candidate-tab-arrow next"/);
  assert.match(styles, /\.editorial-layout\s*\{\s*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(styles, /\.candidate-sidebar\s*\{[^}]*display:flex[^}]*overflow-x:auto/);
  assert.match(styles, /\.editorial-candidate\s*\{[^}]*flex:0 0 clamp/);
});

test("候选题 Tab 使用两端箭头平滑滚动并隐藏原生滚动条", () => {
  assert.match(styles, /\.candidate-tab-strip \.candidate-sidebar::\-webkit-scrollbar\s*\{\s*display:none/);
  assert.match(source, /sidebar\.scrollBy\(\{[^}]*behavior:\s*"smooth"/);
  assert.match(source, /previous\.disabled = sidebar\.scrollLeft <= 1/);
  assert.match(source, /next\.disabled = sidebar\.scrollLeft >= maxScroll - 1/);
});
