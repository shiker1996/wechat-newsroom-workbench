import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const drawer = fs.readFileSync(path.join(root, "public/src/views/batch-drawer.js"), "utf8");
const subscriptions = fs.readFileSync(path.join(root, "public/src/views/subscriptions.js"), "utf8");
const atlas = fs.readFileSync(path.join(root, "public/src/views/atlas.js"), "utf8");

test("纯图标按钮具有明确可访问名称", () => {
  assert.match(html, /data-graph-zoom="out"[^>]*aria-label="缩小事件关系图"/);
  assert.match(html, /class="close-button preview-close" aria-label="关闭产物预览"/);
  assert.match(drawer, /data-close-drawer aria-label="关闭批次详情"/);
  assert.match(subscriptions, /aria-label="删除订阅源：\$\{escapeHtml\(item\.label\)\}"/);
});

test("图标按钮满足舒适点击区域并显示键盘焦点", () => {
  assert.match(styles, /button:focus-visible[\s\S]*outline:3px solid var\(--yellow\)/);
  assert.match(styles, /\.close-button\s*\{[^}]*min-width:44px[^}]*min-height:44px/);
  assert.match(styles, /\.candidate-tab-arrow\s*\{[^}]*min-width:44px[^}]*min-height:44px/);
  assert.match(styles, /\.graph-zoom button\s*\{[^}]*min-width:40px[^}]*min-height:40px/);
});

test("筛选和关系维度向辅助技术同步选中状态", () => {
  assert.match(html, /data-atlas-scope="全部" role="tab" aria-selected="true"/);
  assert.match(html, /data-graph-lens="who" role="tab" aria-selected="true"/);
  assert.match(html, /data-batch-filter="all" role="tab" aria-selected="true"/);
  assert.match(html, /data-log-type="" role="tab" aria-selected="true"/);
  assert.match(html, /data-capability-tab="skills" role="tab" aria-selected="true"/);
  assert.match(atlas, /setAttribute\("aria-selected", String\(button === lensButton\)\)/);
});

test("动态反馈通过状态区域播报并尊重减少动态偏好", () => {
  assert.match(html, /id="toast" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)/);
});
