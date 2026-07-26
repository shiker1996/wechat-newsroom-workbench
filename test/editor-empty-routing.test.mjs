import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const article = fs.readFileSync(path.join(root, "public/src/views/editorial.js"), "utf8");
const social = fs.readFileSync(path.join(root, "public/src/views/social-editor.js"), "utf8");

test("文章编辑室空池直接引导到热点全景", () => {
  assert.match(article, /当前批次还没有文章候选。<a href="#overview">前往热点全景创建选题<\/a>/);
});

test("三类图文编辑室空状态不再引导到图文选题池", () => {
  const modeLayout = social.slice(social.indexOf("const MODE_LAYOUT"), social.indexOf("function applyModeLayout"));
  assert.doesNotMatch(modeLayout, /href="#social-topics"/);
  assert.match(modeLayout, /tools:[\s\S]*href="#overview"/);
  assert.match(modeLayout, /event:[\s\S]*href="#overview"/);
  assert.match(html, /id="social-editor-empty"[\s\S]*href="#overview"/);
});

test("自定义图文空状态只引导使用页面内创建按钮", () => {
  const custom = social.slice(social.indexOf("custom:{"), social.indexOf("event:{"));
  assert.match(custom, /点击上方「创建自定义图文」添加/);
  assert.doesNotMatch(custom, /href=/);
});

test("切换图文类型时同步主区域空状态", () => {
  assert.match(social, /if\(empty\)empty\.innerHTML=layout\.empty/);
  assert.match(social, /empty\.innerHTML=layout\.empty;empty\.hidden=false/);
});
