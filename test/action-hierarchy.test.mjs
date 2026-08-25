import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const batch = fs.readFileSync(path.join(root, "public/src/views/batch-drawer.js"), "utf8");
const topics = fs.readFileSync(path.join(root, "public/src/views/topics.js"), "utf8");
const editorial = fs.readFileSync(path.join(root, "public/src/views/editorial.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

test("流水线按状态只突出一个下一步，并把重试收进高级操作", () => {
  assert.match(batch, /const pipelinePrimaryAction = researchDone[\s\S]*data-view-research[\s\S]*data-ai-tag[\s\S]*data-ai-event-cards[\s\S]*data-ai-research/);
  assert.match(batch, /class="pipeline-next"[\s\S]*pipelinePrimaryAction[\s\S]*class="pipeline-retry-menu"/);
  assert.match(styles, /\.pipeline-actions\s*\{[^}]*display:flex/);
});

test("选题卡突出编辑入口，移出操作收进更多菜单", () => {
  assert.match(topics, /class="ink-button candidate-primary-action" data-editorial-id/);
  assert.match(topics, /class="candidate-more"[\s\S]*data-remove-track/);
});

test("文章池和图文池展示统一的事件类型标签", () => {
  assert.match(topics, /const contentClassLabels = \{/);
  assert.match(topics, /open_source_technology: "开源技术"/);
  assert.match(topics, /open_source_trend: "开源趋势"/);
  assert.match(topics, /github_project: "纯项目"/);
  assert.match(topics, /content-class-tag/);
});

test("成稿门禁通过后降低继续对话按钮权重", () => {
  assert.match(editorial, /replyButton\.classList\.toggle\("ink-button", !ready\)/);
  assert.match(editorial, /replyButton\.classList\.toggle\("ghost-button", ready\)/);
});
