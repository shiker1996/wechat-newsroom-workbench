import { readStyles } from "./style-fixture.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "public/src/views/editorial.js"), "utf8");
const topicsSource = fs.readFileSync(path.join(root, "public/src/views/topics.js"), "utf8");
const streamSource = fs.readFileSync(path.join(root, "public/src/core/stream-chat.js"), "utf8");
const agentEventsSource = fs.readFileSync(path.join(root, "public/src/core/agent-events.js"), "utf8");
const styles = readStyles(root);

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

test("编辑室首屏聚焦对话与写作主线，资料区默认按需展开", () => {
  assert.match(html, /class="editorial-focus-grid"[\s\S]*class="editorial-focus-rail"[\s\S]*id="editorial-production-gate"/);
  assert.match(html, /<details class="editorial-reference-details event-card-panel" id="event-card-panel" hidden>/);
  assert.match(html, /<details class="editorial-reference-details editorial-research-panel" id="editorial-research-panel" hidden>/);
  assert.match(styles, /\.editorial-focus-grid\s*\{[^}]*grid-template-columns:minmax\(0,1\.35fr\) minmax\(300px,.65fr\)[^}]*height:clamp\(560px,calc\(100vh - 300px\),740px\)/);
  assert.match(styles, /\.editorial-focus-rail\s*\{[^}]*display:flex[^}]*flex-direction:column/);
  assert.match(styles, /\.editorial-reference-details>summary\s*\{[^}]*cursor:pointer/);
  assert.match(html, /id="editorial-production-hint" aria-live="polite"/);
});

test("编辑室右侧成稿门禁不会因窄栏 flex 收缩而溢出容器", () => {
  assert.match(styles, /editorial-focus-grid \.editorial-focus-rail\{overflow-x:hidden;overflow-y:auto/);
  assert.match(styles, /editorial-focus-rail>\.editorial-focus-brief,\.editorial-focus-grid \.editorial-focus-rail>\.editorial-production-gate\{flex:0 0 auto\}/);
  assert.match(styles, /editorial-focus-rail \.editorial-production-gate\{box-sizing:border-box;width:100%;max-width:100%;min-width:0;flex-shrink:0\}/);
  assert.match(styles, /editorial-focus-rail \.editorial-gate-check\{[^}]*white-space:normal/);
});

test("编辑室研判展示候选命题和四类语义关系，不展示机器信号标题", () => {
  assert.match(source, /由研判形成的候选选题/);
  assert.match(source, /事件内部的研判/);
  assert.match(source, /事件之间的研判/);
  assert.match(source, /前后 \/ 回应 \/ 对比 \/ 趋势/);
  assert.match(source, /已合并.*条证据/);
  assert.doesNotMatch(source, /事件内信号（/);
  assert.doesNotMatch(source, /事件间关系候选（/);
});

test("研判拓展点由编辑会 Agent 对话决定，页面只读展示采用状态", () => {
  assert.match(source, /由编辑室 Agent 根据已经确认的角度和命题自动选择/);
  assert.match(source, /本页只读展示，不需要手动勾选/);
  assert.doesNotMatch(source, /data-research-point/);
  assert.doesNotMatch(source, /data-research-reject/);
  assert.doesNotMatch(source, /function recommendResearchPoints/);
  assert.doesNotMatch(source, /preselectedResearchPoints/);
  assert.doesNotMatch(html, /type="checkbox"[^>]*data-research-point/);
});

test("编辑会中的超长链接不会撑宽消息区", () => {
  assert.match(styles, /\.editorial-messages\s*\{\s*overflow-x:hidden/);
  assert.match(styles, /\.editorial-message p\s*\{[^}]*overflow-wrap:anywhere[^}]*word-break:break-word/);
  assert.match(styles, /\.editorial-reply textarea\s*\{[^}]*overflow-x:hidden[^}]*overflow-wrap:anywhere/);
});

test("编辑室发送回答前立即清空输入并阻止重复发送", () => {
  assert.match(source, /async function sendEditorialAnswer\(\) \{\s*if \(editorialRequestPending\) return;/);
  assert.match(source, /if \(answerEl\) answerEl\.value = "";\s*editorialRequestPending = true;/);
  assert.doesNotMatch(source, /onDone: async \(data\) => \{\s*const answerEl/);
});

test("流式对话在布局完成后补滚外层与思考过程内层，避免底部内容被截住", () => {
  assert.match(streamSource, /scrollToLatest\(messages\)/);
  assert.match(streamSource, /await onDone\?\.\(done === true \? \{\} : done\);[\s\S]*scrollMessagesToLatest\(\)/);
  assert.match(agentEventsSource, /export function scrollToLatest/);
  assert.match(agentEventsSource, /requestAnimationFrame\(\(\) => \{[\s\S]*requestAnimationFrame\(apply\)/);
  assert.match(styles, /\.editorial-messages\s*\{\s*scroll-behavior:auto;\s*\}/);
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

test("编辑室区分加载和空池状态，并展示全部文章候选", () => {
  assert.match(html, /id="editorial-loading"[^>]*role="status"/);
  assert.match(html, /id="editorial-empty" class="empty-state" hidden/);
  assert.match(source, /当前批次还没有文章候选/);
  assert.match(source, /const visibleCandidates = state\.candidates/);
  assert.doesNotMatch(source, /低于成稿线|DRAFT_SCORE_THRESHOLD|editorial-hidden-note/);
  assert.doesNotMatch(topicsSource, /低于成稿线|DRAFT_SCORE_THRESHOLD|data-toggle-hidden-candidates|hiddenItems/);
  assert.match(source, /const requested = visibleCandidates\.find/);
});
