import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const editorSource = fs.readFileSync(path.join(root, "public/src/views/editor.js"), "utf8");
const pageSource = fs.readFileSync(path.join(root, "public/index.html"), "utf8");

test("文章编辑器使用本地 Markdown 渲染器并关闭原始 HTML", () => {
  assert.match(pageSource, /\/vendor\/markdown-it\.min\.js/);
  assert.match(editorSource, /window\.markdownit\(\{[\s\S]*html:\s*false/);
  assert.match(editorSource, /linkify:\s*true/);
  assert.ok(fs.existsSync(path.join(root, "public/vendor/markdown-it.min.js")));
});

test("文章编辑区和预览区绑定双向同步滚动", () => {
  assert.match(editorSource, /addEventListener\("scroll",\s*\(\) => syncScroll\(editor, preview\)/);
  assert.match(editorSource, /addEventListener\("scroll",\s*\(\) => syncScroll\(preview, editor\)/);
  assert.match(editorSource, /scrollTop\s*=\s*scrollProgress\(source\)/);
});
