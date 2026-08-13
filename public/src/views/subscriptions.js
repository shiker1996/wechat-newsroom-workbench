import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, confirmAction } from "../core/ui.js";
import { state } from "../core/state.js";

const LEGACY_KINDS = new Set(["direct", "twitter", "rsshub", "github"]);
const CREATABLE_PLUGINS = new Set(["reddit-collector", "feed-collector", "rsshub-collector", "declarative-web-page", "browser-web-page"]);
const LABELS = { direct: "DIRECT", twitter: "X / TWITTER", rsshub: "RSSHUB", github: "GITHUB", reddit: "REDDIT" };
const TYPE_LABELS = { direct: "直连 RSS / Atom", twitter: "X", rsshub: "RSSHub", reddit: "Reddit", github: "GitHub", "web-page": "静态网页", "browser-page": "动态网页" };
const WEB_PLUGINS = new Set(["declarative-web-page", "browser-web-page"]);
const BASIC_WEB_FIELDS = new Set(["url", "itemSelector", "titleSelector", "linkSelector"]);
const FIELD_HELP = {
  url: ["要采集的列表页地址", "https://example.com/news"], itemSelector: ["每条内容最外层的重复元素", "article.news-item"],
  titleSelector: ["条目内部的标题元素；留空时读取整个条目文本", "h2, h3"], linkSelector: ["条目内部指向详情页的链接；留空时使用条目自身", "h2 a"],
  linkAttribute: ["链接所在的 HTML 属性，通常保持 href", "href"], summarySelector: ["条目内部的摘要元素，可不填", ".summary"],
  authorSelector: ["条目内部的作者元素，可不填", ".author"], dateSelector: ["条目内部的发布时间元素，可不填", "time"],
  dateAttribute: ["时间所在属性；time 元素通常使用 datetime", "datetime"], nextPageSelector: ["下一页按钮或链接，用于有限分页", "a.next"],
  maxPages: ["单次最多翻页数，建议先用 1 测试", "1"], limit: ["单次最多保留的有效条目数", "30"],
  profileId: ["保存该网站登录状态的隔离浏览器身份", "example-news"], waitForSelector: ["等待这个元素出现后再采集", "main article"],
  clickSelector: ["采集前需要点击一次的元素，例如“加载更多”", "button.load-more"], typeSelector: ["采集前需要填写的输入框；多数页面无需配置", "input[type=search]"],
  typeValue: ["输入框中填写的固定内容，不要填写密码", "AI"], waitMilliseconds: ["点击或输入后额外等待时间，单位毫秒", "1000"],
  loginSelector: ["登录页特有元素；匹配时会报告需要登录", "form[action*=login]"],
};
const WEB_GUIDANCE = {
  "declarative-web-page": ["静态网页采集", "适合在网页源码中直接包含文章列表的页面。若测试为 0 条，但浏览器里能看到内容，请改用动态网页采集。"],
  "browser-web-page": ["动态网页采集", "适合内容由 JavaScript 加载、需要登录、等待或点击后才出现的页面。每个 Profile 独立保存登录状态。"],
};

function pluginById(id) { return (state.collectorPlugins || []).find((item) => item.id === id); }
function unifiedValue(item) { return item.config?.subreddit ? `r/${item.config.subreddit}` : item.config?.url || item.config?.route || item.source_key; }
function unifiedItems() {
  return (state.collectionSources || []).map((item) => ({
    id: item.id, kind: item.source_type, value: unifiedValue(item), label: item.label,
    enabled: Boolean(item.enabled), managed: item.origin === "managed", pluginId: item.plugin_id,
    unified: true, pluginAvailable: pluginById(item.plugin_id)?.available !== false, health: item.health || (item.last_test_status ? { status: item.last_test_status, error: item.last_test_error } : null),
  }));
}
function allItems() {
  const unified = unifiedItems();
  const keys = new Set(unified.map((item) => `${item.kind}:${item.value}`));
  return [...unified, ...(state.subscriptions?.items || []).filter((item) => !keys.has(`${item.kind}:${item.value}`))];
}
function currentPluginId() {
  const kind = $("#subscription-kind").value;
  if (kind === "reddit") return "reddit-collector";
  if (kind === "more") return $("#subscription-plugin").value;
  return null;
}
function renderAutoWebFields() {
  return `<aside class="web-auto-guidance"><span class="web-auto-mark">AUTO</span><div><b>网页自动采集</b><p>只需填写列表页地址。系统先尝试静态采集，必要时自动启动隔离浏览器，不需要你判断网页类型。</p></div></aside><div class="source-field-group"><label><span class="source-field-title">页面地址<em>必填</em></span><input data-auto-web-field="url" type="url" required placeholder="https://example.com/news"><small>填写新闻、公告、博客或榜单的列表页，不要填写单篇详情页。</small></label><label><span class="source-field-title">采集意图<i>可选</i></span><input data-auto-web-field="intent" type="text" maxlength="160" placeholder="例如：采集页面中的主新闻列表"><small>页面有多个列表时，用一句话说明你想采集哪一部分。</small></label></div><button type="button" class="source-assist-button" id="assist-static-source">识别并预览采集规则</button><div id="source-assist-result" class="source-assist-result" hidden></div><details class="web-auto-technical-note"><summary>系统会怎么判断？</summary><p>静态方式真实提取成功就优先使用；否则自动渲染动态页面再次验证。AI 后续只用于判断哪个列表符合你的意图。</p></details>`;
}
function schemaField(name, schema, required) {
  const title = schema.title || { subreddit: "分区名称", sort: "排序", limit: "数量", route: "RSSHub 路由", url: "订阅地址" }[name] || name;
  const requiredMark = required ? " required" : "";
  const [help, placeholder] = FIELD_HELP[name] || ["", ""];
  const heading = `<span class="source-field-title">${escapeHtml(title)}${required ? '<em>必填</em>' : '<i>可选</i>'}</span>`;
  if (schema.enum) return `<label>${heading}<select data-plugin-field="${escapeHtml(name)}"${requiredMark}>${schema.enum.map((value) => `<option value="${escapeHtml(value)}" ${value === schema.default ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select>${help ? `<small>${escapeHtml(help)}</small>` : ""}</label>`;
  const type = schema.type === "integer" ? "number" : schema.format === "url" ? "url" : "text";
  const bounds = `${schema.minimum != null ? ` min="${schema.minimum}"` : ""}${schema.maximum != null ? ` max="${schema.maximum}"` : ""}`;
  return `<label>${heading}<input data-plugin-field="${escapeHtml(name)}" type="${type}"${bounds}${requiredMark} value="${escapeHtml(schema.default ?? "")}"${placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : ""}>${help ? `<small>${escapeHtml(help)}</small>` : ""}</label>`;
}
function renderPluginFields() {
  const box = $("#source-plugin-fields");
  if (currentPluginId() === "web-auto") { box.innerHTML = renderAutoWebFields(); box.hidden = false; $("#test-subscription").disabled = true; return; }
  const plugin = pluginById(currentPluginId());
  if (!plugin) { box.hidden = true; box.innerHTML = ""; return; }
  const schema = plugin.collector?.sourceConfigSchema || plugin.inputSchema || { properties: {} };
  const fields = Object.entries(schema.properties || {}), required = schema.required || [];
  if (WEB_PLUGINS.has(plugin.id)) {
    const [name, guidance] = WEB_GUIDANCE[plugin.id];
    const basic = fields.filter(([field]) => BASIC_WEB_FIELDS.has(field));
    const advanced = fields.filter(([field]) => !BASIC_WEB_FIELDS.has(field));
    const assistant = plugin.id === "declarative-web-page" ? '<button type="button" class="source-assist-button" id="assist-static-source">自动识别采集规则</button><div id="source-assist-result" class="source-assist-result" hidden></div>' : '';
    box.innerHTML = `<aside class="web-collector-guidance"><b>${escapeHtml(name)}</b><span>${escapeHtml(guidance)}</span></aside><div class="source-field-group"><span class="source-field-group-title">基础配置</span>${basic.map(([field, definition]) => schemaField(field, definition, required.includes(field))).join("")}</div>${assistant}<details class="source-advanced-fields"><summary><span>高级配置</span><small>摘要、日期、分页、登录与页面交互</small></summary><div class="source-field-group">${advanced.map(([field, definition]) => schemaField(field, definition, required.includes(field))).join("")}</div></details>`;
  } else box.innerHTML = fields.map(([name, field]) => schemaField(name, field, required.includes(name))).join("");
  box.hidden = false;
  $("#test-subscription").disabled = false;
}
function resetTestResult() {
  const output = $("#subscription-test-result");
  output.className = "subscription-test-result";
  output.textContent = "尚未测试。测试只验证当前填写内容，不会保存配置。";
}
function applyCandidate(config, pluginId = currentPluginId()) {
  if (pluginId !== currentPluginId()) { $("#subscription-plugin").value = pluginId; renderPluginFields(); }
  for (const [name, value] of Object.entries(config || {})) { const field = $(`[data-plugin-field="${name}"]`); if (field) field.value = value ?? ""; }
  resetTestResult(); toast(pluginId === "browser-web-page" ? "已切换为动态网页采集并回填规则，请先测试" : "识别规则已回填，请先测试预览再保存");
}
async function assistStaticSource(button) {
  const url = ($('[data-auto-web-field="url"]') || $('[data-plugin-field="url"]'))?.value.trim(); if (!url) throw new Error("请先填写页面地址");
  const intent = $('[data-auto-web-field="intent"]')?.value.trim() || "";
  const output = $("#source-assist-result"); button.disabled = true; output.hidden = false; output.className = "source-assist-result testing"; output.textContent = "正在分析页面结构并验证候选规则…";
  try {
    const result = await request("/api/collection-sources/assist", { method: "POST", body: JSON.stringify({ pluginId: "declarative-web-page", url, intent }) });
    output.className = "source-assist-result ok"; output._candidates = result.candidates; output._targetPluginId = result.targetPluginId;
    const aiNotes = [result.aiApplied ? `已按采集意图排序${result.aiReason ? `：${result.aiReason}` : ""}` : "", result.aiFieldsApplied ? result.aiFieldsReason : ""].filter(Boolean);
    const modeNote = aiNotes.length ? `AI ${aiNotes.join("；")}` : result.page.mode === "dynamic" ? "静态页面没有列表，已通过隔离浏览器识别" : "请选择最接近页面主列表的一组";
    output.innerHTML = `<header><b>识别到 ${result.candidates.length} 组可用规则</b><small>${escapeHtml(modeNote)}</small></header>${result.candidates.map((candidate, index) => { const fields = Object.keys(candidate.fieldEnrichment || {}).map((field) => ({ summary: "摘要", author: "作者", publishedAt: "日期" })[field] || field); return `<article><div><strong>${escapeHtml(candidate.name)}</strong><em>${Math.round(candidate.confidence * 100)}% 置信度</em></div><p>${escapeHtml(candidate.reason)}</p><code>${escapeHtml(candidate.config.itemSelector)} → ${escapeHtml(candidate.config.titleSelector)} / ${escapeHtml(candidate.config.linkSelector)}</code>${fields.length ? `<small class="source-enriched-fields">已复验补齐：${escapeHtml(fields.join("、"))}</small>` : ""}<ol>${candidate.preview.slice(0, 3).map((item) => `<li>${escapeHtml(item.title)}</li>`).join("")}</ol><button type="button" class="outline-button" data-apply-source-candidate="${index}">使用这组规则</button></article>`; }).join("")}`;
  } catch (error) { output.className = "source-assist-result bad"; output.textContent = `识别失败：${error.message}`; throw error; }
  finally { button.disabled = false; }
}
function updateComposer() {
  const kind = $("#subscription-kind").value;
  const dynamic = kind === "more" || kind === "reddit";
  $("#subscription-plugin-wrap").hidden = kind !== "more";
  $("#subscription-value-label").hidden = dynamic;
  $("#subscription-value").disabled = dynamic;
  $("#subscription-value").required = !dynamic;
  $("#subscription-label-wrap").hidden = kind === "twitter" || kind === "rsshub";
  if (!dynamic) {
    const input = $("#subscription-value");
    const settings = kind === "twitter" ? ["X 用户名", "text", "@OpenAI 或 OpenAI"] : kind === "rsshub" ? ["RSSHub 路由", "text", "/twitter/user/OpenAI"] : ["订阅地址", "url", "https://example.com/feed.xml"];
    $("#subscription-value-label-text").textContent = settings[0]; input.type = settings[1]; input.placeholder = settings[2];
  }
  renderPluginFields(); resetTestResult();
}
function dynamicPayload() {
  if (currentPluginId() === "web-auto") throw new Error("请先识别并选择一组采集规则");
  const config = {};
  $$('[data-plugin-field]').forEach((field) => { config[field.dataset.pluginField] = field.type === "number" ? Number(field.value) : field.value.trim(); });
  return { pluginId: currentPluginId(), label: $("#subscription-label").value.trim(), config };
}
function legacyPayload() { return { kind: $("#subscription-kind").value, value: $("#subscription-value").value.trim(), label: $("#subscription-label").value.trim() }; }
function formPayload() { return currentPluginId() ? dynamicPayload() : legacyPayload(); }
function itemStatus(item) { if (item.pluginAvailable === false) return "failed"; if (!item.enabled) return "disabled"; return item.health?.status === "success" ? "success" : item.health ? "failed" : "idle"; }

function renderSubscriptions() {
  const all = allItems();
  const summary = { total: all.length, success: 0, failed: 0, disabled: 0 };
  all.forEach((item) => { const status = itemStatus(item); if (status in summary) summary[status]++; });
  $("#subscription-summary").innerHTML = [["ALL SOURCES", summary.total, "全部来源", "total"], ["HEALTHY", summary.success, "运行正常", "success"], ["ATTENTION", summary.failed, "需要处理", "failed"], ["PAUSED", summary.disabled, "已暂停", "disabled"]].map(([name, value, note, tone]) => `<article class="summary-${tone}"><small>${name}</small><strong>${value}</strong><span>${note}</span></article>`).join("");
  const counts = { success: 0, failed: 0, idle: 0 }; all.forEach((item) => { const status = itemStatus(item); if (status !== "disabled") counts[status]++; });
  $("#subscription-health").innerHTML = `<div class="health-dots">${Object.entries(counts).flatMap(([status, count]) => Array.from({ length: Math.min(count, 50) }, () => `<i class="health-dot ${status === "success" ? "ok" : status === "failed" ? "bad" : "idle"}" title="${count} 个来源：${status}"></i>`)).join("")}</div>`;
  const typeFilter = $("#source-type-filter").value || "all";
  const statusFilter = $("#source-status-filter").value || "all";
  const query = $("#source-search").value.trim().toLocaleLowerCase("zh-CN");
  const items = all.filter((item) => (typeFilter === "all" || item.kind === typeFilter) && (statusFilter === "all" || itemStatus(item) === statusFilter) && (!query || `${item.label} ${item.value} ${TYPE_LABELS[item.kind] || item.kind}`.toLocaleLowerCase("zh-CN").includes(query)));
  const filtered = Boolean(query || typeFilter !== "all" || statusFilter !== "all");
  $("#source-filter-clear").hidden = !filtered;
  $("#source-filter-count").textContent = filtered ? `显示 ${items.length} / ${all.length}` : `共 ${all.length} 个来源`;
  $("#subscription-list").innerHTML = items.length ? items.map((item, index) => {
    const status = itemStatus(item), hc = status === "success" ? "ok" : status === "failed" ? "bad" : "idle";
    const healthText = item.pluginAvailable === false ? "插件不可用 · 来源配置已保留" : status === "disabled" ? "已暂停" : status === "success" ? `最近成功 · ${item.health?.item_count || 0} 条` : status === "failed" ? `最近失败 · ${item.health?.error || "未返回详情"}` : "尚无采集记录";
    const identity = item.unified ? `data-source-id="${item.id}"` : `data-kind="${escapeHtml(item.kind)}" data-value="${escapeHtml(item.value)}"`;
    return `<article class="subscription-row health-${hc} ${item.enabled ? "" : "disabled"}" style="--row:${index}"><span class="subscription-kind ${escapeHtml(item.kind)}">${escapeHtml(LABELS[item.kind] || item.kind)}</span><div class="subscription-identity"><b>${escapeHtml(item.label)}</b><code>${escapeHtml(item.value)}</code><small>${escapeHtml(pluginById(item.pluginId)?.name || (item.unified ? item.pluginId : "内置兼容来源"))}</small><small class="source-health ${hc}">${escapeHtml(healthText)}</small></div>${item.managed ? '<span class="story-meta">系统采集入口</span>' : `<label class="source-switch"><input type="checkbox" data-source-toggle ${identity} ${item.enabled ? "checked" : ""}><i></i><span>${item.enabled ? "启用" : "暂停"}</span></label>`}<div class="subscription-actions">${item.managed ? '<span class="story-meta">随系统任务执行</span>' : `<button class="text-button" data-source-test ${identity}>测试</button><button class="source-remove" data-source-remove ${identity} aria-label="删除订阅源：${escapeHtml(item.label)}">×</button>`}</div></article>`;
  }).join("") : `<div class="empty-state source-empty"><b>${all.length ? "没有匹配的订阅源" : "还没有订阅源"}</b><span>${all.length ? "换个关键词，或清除当前筛选条件。" : "从左侧选择一种来源并完成首次添加。"}</span>${filtered ? '<button type="button" class="text-button" data-clear-source-filters>清除筛选</button>' : ""}</div>`;
}
async function loadSubscriptions() {
  const [subscriptions, plugins, sources] = await Promise.all([request("/api/subscriptions"), request("/api/collector-plugins"), request("/api/collection-sources")]);
  state.subscriptions = subscriptions; state.collectorPlugins = plugins.items || []; state.collectionSources = sources.items || [];
  const creatable = state.collectorPlugins.filter((item) => item.available && (item.builtin ? CREATABLE_PLUGINS.has(item.id) : true));
  const ordinary = creatable.filter((item) => !WEB_PLUGINS.has(item.id));
  const advancedWeb = creatable.filter((item) => WEB_PLUGINS.has(item.id));
  $("#subscription-plugin").innerHTML = `<optgroup label="推荐"><option value="web-auto">网页自动采集</option>${ordinary.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}</optgroup>${advancedWeb.length ? `<optgroup label="高级手动配置">${advancedWeb.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}</optgroup>` : ""}`;
  const kinds = [...new Set(allItems().map((item) => item.kind))].sort((a, b) => (TYPE_LABELS[a] || a).localeCompare(TYPE_LABELS[b] || b, "zh-CN"));
  $("#source-type-filter").innerHTML = '<option value="all">全部类型</option>' + kinds.map((kind) => `<option value="${escapeHtml(kind)}">${escapeHtml(TYPE_LABELS[kind] || kind)}</option>`).join("");
  updateComposer(); renderSubscriptions();
}
async function reloadSources() { const result = await request("/api/collection-sources"); state.collectionSources = result.items || []; renderSubscriptions(); }
async function testSource(payload, button, id = null) {
  const output = $("#subscription-test-result"); button.disabled = true; output.className = "subscription-test-result testing"; output.textContent = "正在连接并解析采集源…";
  try { const result = await request(id ? `/api/collection-sources/${id}/test` : payload.pluginId ? "/api/collection-sources/test" : "/api/subscriptions/test", { method: "POST", body: JSON.stringify(payload) }); const items = Array.isArray(result.items) ? result.items.slice(0, 5) : []; output.className = "subscription-test-result ok"; output.innerHTML = `<strong>连接成功 · ${escapeHtml(result.title || result.sourceLabel || "采集源可用")} · ${result.itemCount ?? items.length} 条</strong>${result.matched != null ? `<small>页面匹配到 ${Number(result.matched)} 个候选元素</small>` : ""}${items.length ? `<ol>${items.map((item) => `<li><a href="${escapeHtml(item.url || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title || "未命名条目")}</a><code>${escapeHtml(item.url || "未返回链接")}</code></li>`).join("")}</ol>` : '<small>该采集器未返回条目预览，请结合条目数量判断。</small>'}`; return result; }
  catch (error) { output.className = "subscription-test-result bad"; output.textContent = `测试失败：${error.message}`; throw error; } finally { button.disabled = false; }
}
async function addSource(event) {
  event.preventDefault(); const form = event.currentTarget; const payload = formPayload();
  if (payload.pluginId) await request("/api/collection-sources", { method: "POST", body: JSON.stringify(payload) });
  else { if (!payload.value) throw new Error("订阅内容不能为空"); state.subscriptions = await request("/api/subscriptions", { method: "POST", body: JSON.stringify(payload) }); }
  form.reset(); $("#source-search").value = ""; $("#source-type-filter").value = "all"; $("#source-status-filter").value = "all";
  await reloadSources(); updateComposer(); toast("采集源已添加");
}
async function toggleSource(input) {
  input.disabled = true;
  try { if (input.dataset.sourceId) await request(`/api/collection-sources/${input.dataset.sourceId}`, { method: "PATCH", body: JSON.stringify({ enabled: input.checked }) }); else state.subscriptions = await request("/api/subscriptions", { method: "PATCH", body: JSON.stringify({ kind: input.dataset.kind, value: input.dataset.value, enabled: input.checked }) }); await reloadSources(); }
  finally { input.disabled = false; }
}
async function removeSource(button) {
  if (!await confirmAction("确定删除这个采集源吗？", { confirmText: "删除" })) return;
  if (button.dataset.sourceId) await request(`/api/collection-sources/${button.dataset.sourceId}`, { method: "DELETE" }); else state.subscriptions = await request("/api/subscriptions", { method: "DELETE", body: JSON.stringify({ kind: button.dataset.kind, value: button.dataset.value }) });
  await reloadSources(); toast("采集源已删除");
}

let bound = false;
function bindSubscriptions() {
  if (bound) return; bound = true;
  $("#subscription-kind").addEventListener("change", updateComposer); $("#subscription-plugin").addEventListener("change", () => { renderPluginFields(); resetTestResult(); });
  $("#source-plugin-fields").addEventListener("input", resetTestResult);
  $("#subscription-form").addEventListener("submit", (event) => addSource(event).catch((error) => toast(error.message, "error")));
  $("#test-subscription").addEventListener("click", (event) => testSource(formPayload(), event.currentTarget).catch(() => {}));
  const clearFilters = () => { $("#source-search").value = ""; $("#source-type-filter").value = "all"; $("#source-status-filter").value = "all"; renderSubscriptions(); };
  $("#source-search").addEventListener("input", renderSubscriptions); $("#source-type-filter").addEventListener("change", renderSubscriptions); $("#source-status-filter").addEventListener("change", renderSubscriptions); $("#source-filter-clear").addEventListener("click", clearFilters);
  document.addEventListener("change", (event) => { if (event.target.closest("#view-sources") && event.target.matches("[data-source-toggle]")) toggleSource(event.target).catch((error) => toast(error.message, "error")); });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#view-sources")) return;
    if (event.target.closest("[data-clear-source-filters]")) clearFilters();
    const assist = event.target.closest("#assist-static-source"); if (assist) assistStaticSource(assist).catch((error) => toast(error.message, "error"));
    const apply = event.target.closest("[data-apply-source-candidate]"); if (apply) { const output = $("#source-assist-result"); applyCandidate(output?._candidates?.[Number(apply.dataset.applySourceCandidate)]?.config, output?._targetPluginId); }
    const test = event.target.closest("[data-source-test]"); if (test) testSource(test.dataset.sourceId ? {} : { kind: test.dataset.kind, value: test.dataset.value }, test, test.dataset.sourceId || null).then(reloadSources).catch(() => {});
    const remove = event.target.closest("[data-source-remove]"); if (remove) removeSource(remove).catch((error) => toast(error.message, "error"));
  });
}

export default async function loadSubscriptionsView() { bindSubscriptions(); return loadSubscriptions(); }
