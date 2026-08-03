import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const editor = fs.readFileSync(new URL("../public/src/views/editor.js", import.meta.url), "utf8");
const preview = fs.readFileSync(new URL("../public/src/views/preview.js", import.meta.url), "utf8");

test("排版任务完成后主动刷新产物并加载最新 HTML", () => {
  assert.match(editor, /job\.status === "completed" && job\.type === "typeset"[\s\S]*dispatchEvent\(new CustomEvent\("typeset:completed"/);
  assert.match(preview, /addEventListener\("typeset:completed"[\s\S]*loadProductionPreview\(\)/);
  assert.match(preview, /const prevId = document\.getElementById\("typeset-candidate"\)\?\.value/);
  assert.match(preview, /preview=phone&v=' \+ encodeURIComponent\(htmlArtifact\.modified_at\)/);
});
