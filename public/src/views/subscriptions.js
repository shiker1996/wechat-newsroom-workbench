import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, confirmAction } from "../core/ui.js";
import { state } from "../core/state.js";

const LEGACY_KINDS = new Set(["direct", "twitter", "rsshub", "github"]);
const CREATABLE_PLUGINS = new Set(["reddit-collector", "feed-collector", "rsshub-collector", "declarative-web-page", "browser-web-page"]);
const LABELS = { direct: "DIRECT", twitter: "X / TWITTER", rsshub: "RSSHUB", github: "GITHUB", reddit: "REDDIT" };

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
function schemaField(name, schema, required) {
  const title = schema.title || { subreddit: "分区名称", sort: "排序", limit: "数量", route: "RSSHub 路由", url: "订阅地址" }[name] || name;
  const requiredMark = required ? " required" : "";
  if (schema.enum) return `<label>${escapeHtml(title)}<select data-plugin-field="${escapeHtml(name)}"${requiredMark}>${schema.enum.map((value) => `<option value="${escapeHtml(value)}" ${value === schema.default ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select></label>`;
  const type = schema.type === "integer" ? "number" : schema.format === "url" ? "url" : "text";
  const bounds = `${schema.minimum != null ? ` min="${schema.minimum}"` : ""}${schema.maximum != null ? ` max="${schema.maximum}"` : ""}`;
  return `<label>${escapeHtml(title)}<input data-plugin-field="${escapeHtml(name)}" type="${type}"${bounds}${requiredMark} value="${escapeHtml(schema.default ?? "")}"></label>`;
}
function renderPluginFields() {
  const plugin = pluginById(currentPluginId());
  const box = $("#source-plugin-fields");
  if (!plugin) { box.hidden = true; box.innerHTML = ""; return; }
  const schema = plugin.collector?.sourceConfigSchema || plugin.inputSchema || { properties: {} };
  box.innerHTML = Object.entries(schema.properties || {}).map(([name, field]) => schemaField(name, field, (schema.required || []).includes(name))).join("");
  box.hidden = false;
}
function updateComposer() {
  const kind = $("#subscription-kind").value;
  const dynamic = kind === "more" || kind === "reddit";
  $("#subscription-plugin-wrap").hidden = kind !== "more";
  $("#subscription-value-label").hidden = dynamic;
  $("#subscription-label-wrap").hidden = kind === "twitter" || kind === "rsshub";
  if (!dynamic) {
    const input = $("#subscription-value");
    const settings = kind === "twitter" ? ["X 用户名", "text", "@OpenAI 或 OpenAI"] : kind === "rsshub" ? ["RSSHub 路由", "text", "/twitter/user/OpenAI"] : ["订阅地址", "url", "https://example.com/feed.xml"];
    $("#subscription-value-label-text").textContent = settings[0]; input.type = settings[1]; input.placeholder = settings[2];
  }
  renderPluginFields();
  $("#subscription-test-result").className = "subscription-test-result";
  $("#subscription-test-result").textContent = "尚未测试。测试只验证当前采集源，不会写入配置。";
}
function dynamicPayload() {
  const config = {};
  $$('[data-plugin-field]').forEach((field) => { config[field.dataset.pluginField] = field.type === "number" ? Number(field.value) : field.value.trim(); });
  return { pluginId: currentPluginId(), label: $("#subscription-label").value.trim(), config };
}
function legacyPayload() { return { kind: $("#subscription-kind").value, value: $("#subscription-value").value.trim(), label: $("#subscription-label").value.trim() }; }
function formPayload() { return currentPluginId() ? dynamicPayload() : legacyPayload(); }
function itemStatus(item) { if (item.pluginAvailable === false) return "failed"; if (!item.enabled) return "disabled"; return item.health?.status === "success" ? "success" : item.health ? "failed" : "idle"; }

function renderSubscriptions() {
  const all = allItems();
  const summary = { total: all.length, enabled: all.filter((i) => i.enabled).length, direct: all.filter((i) => i.kind === "direct").length, github: all.filter((i) => i.kind === "github").length };
  $("#subscription-summary").innerHTML = [["TOTAL", summary.total, "全部入口"], ["ON DESK", summary.enabled, "当前启用"], ["DIRECT", summary.direct, "直连 Feed"], ["GITHUB", summary.github, "Trending / Search"]].map(([name, value, note]) => `<article><small>${name}</small><strong>${value}</strong><span>${note}</span></article>`).join("");
  const counts = { success: 0, failed: 0, idle: 0 }; all.forEach((item) => { const status = itemStatus(item); if (status !== "disabled") counts[status]++; });
  $("#subscription-health").innerHTML = `<div class="health-dots">${Object.entries(counts).flatMap(([status, count]) => Array.from({ length: Math.min(count, 50) }, () => `<i class="health-dot ${status === "success" ? "ok" : status === "failed" ? "bad" : "idle"}" title="${count} 个来源：${status}"></i>`)).join("")}</div>`;
  const pluginFilter = $("#source-plugin-filter").value || "all";
  const statusFilter = $("#source-status-filter").value || "all";
  const items = all.filter((item) => (state.subscriptionFilter === "all" || item.kind === state.subscriptionFilter) && (pluginFilter === "all" || item.pluginId === pluginFilter) && (statusFilter === "all" || itemStatus(item) === statusFilter));
  $("#subscription-list").innerHTML = items.length ? items.map((item, index) => {
    const status = itemStatus(item), hc = status === "success" ? "ok" : status === "failed" ? "bad" : "idle";
    const healthText = item.pluginAvailable === false ? "插件不可用 · 来源配置已保留" : status === "disabled" ? "已暂停" : status === "success" ? `最近成功 · ${item.health?.item_count || 0} 条` : status === "failed" ? `最近失败 · ${item.health?.error || "未返回详情"}` : "尚无采集记录";
    const identity = item.unified ? `data-source-id="${item.id}"` : `data-kind="${escapeHtml(item.kind)}" data-value="${escapeHtml(item.value)}"`;
    return `<article class="subscription-row health-${hc} ${item.enabled ? "" : "disabled"}" style="--row:${index}"><span class="subscription-kind ${escapeHtml(item.kind)}">${escapeHtml(LABELS[item.kind] || item.kind)}</span><div class="subscription-identity"><b>${escapeHtml(item.label)}</b><code>${escapeHtml(item.value)}</code><small>${escapeHtml(pluginById(item.pluginId)?.name || (item.unified ? item.pluginId : "内置兼容来源"))}</small><small class="source-health ${hc}">${escapeHtml(healthText)}</small></div>${item.managed ? '<span class="story-meta">系统采集入口</span>' : `<label class="source-switch"><input type="checkbox" data-source-toggle ${identity} ${item.enabled ? "checked" : ""}><i></i><span>${item.enabled ? "启用" : "暂停"}</span></label>`}<div class="subscription-actions">${item.managed ? '<span class="story-meta">随系统任务执行</span>' : `<button class="text-button" data-source-test ${identity}>测试</button><button class="source-remove" data-source-remove ${identity} aria-label="删除订阅源：${escapeHtml(item.label)}">×</button>`}</div></article>`;
  }).join("") : '<div class="empty-state">当前筛选条件下没有采集源。</div>';
}
async function loadSubscriptions() {
  const [subscriptions, plugins, sources] = await Promise.all([request("/api/subscriptions"), request("/api/collector-plugins"), request("/api/collection-sources")]);
  state.subscriptions = subscriptions; state.collectorPlugins = plugins.items || []; state.collectionSources = sources.items || [];
  const creatable = state.collectorPlugins.filter((item) => item.available && (item.builtin ? CREATABLE_PLUGINS.has(item.id) : true));
  $("#subscription-plugin").innerHTML = creatable.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  $("#source-plugin-filter").innerHTML = '<option value="all">全部采集器</option>' + state.collectorPlugins.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${item.available ? "" : "（不可用）"}</option>`).join("");
  updateComposer(); renderSubscriptions();
}
async function reloadSources() { const result = await request("/api/collection-sources"); state.collectionSources = result.items || []; renderSubscriptions(); }
async function testSource(payload, button, id = null) {
  const output = $("#subscription-test-result"); button.disabled = true; output.className = "subscription-test-result testing"; output.textContent = "正在连接并解析采集源…";
  try { const result = await request(id ? `/api/collection-sources/${id}/test` : payload.pluginId ? "/api/collection-sources/test" : "/api/subscriptions/test", { method: "POST", body: JSON.stringify(payload) }); output.className = "subscription-test-result ok"; output.textContent = `连接成功 · ${result.title || result.sourceLabel || "采集源可用"} · ${result.itemCount ?? result.items?.length ?? 0} 条`; return result; }
  catch (error) { output.className = "subscription-test-result bad"; output.textContent = `测试失败：${error.message}`; throw error; } finally { button.disabled = false; }
}
async function addSource(event) {
  event.preventDefault(); const payload = formPayload();
  if (payload.pluginId) await request("/api/collection-sources", { method: "POST", body: JSON.stringify(payload) });
  else { if (!payload.value) throw new Error("订阅内容不能为空"); state.subscriptions = await request("/api/subscriptions", { method: "POST", body: JSON.stringify(payload) }); }
  event.currentTarget.reset(); await reloadSources(); updateComposer(); toast("采集源已添加");
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
  $("#subscription-kind").addEventListener("change", updateComposer); $("#subscription-plugin").addEventListener("change", renderPluginFields);
  $("#subscription-form").addEventListener("submit", (event) => addSource(event).catch((error) => toast(error.message, "error")));
  $("#test-subscription").addEventListener("click", (event) => testSource(formPayload(), event.currentTarget).catch(() => {}));
  $("#source-plugin-filter").addEventListener("change", renderSubscriptions); $("#source-status-filter").addEventListener("change", renderSubscriptions);
  document.addEventListener("change", (event) => { if (event.target.closest("#view-sources") && event.target.matches("[data-source-toggle]")) toggleSource(event.target).catch((error) => toast(error.message, "error")); });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#view-sources")) return;
    const test = event.target.closest("[data-source-test]"); if (test) testSource(test.dataset.sourceId ? {} : { kind: test.dataset.kind, value: test.dataset.value }, test, test.dataset.sourceId || null).then(reloadSources).catch(() => {});
    const remove = event.target.closest("[data-source-remove]"); if (remove) removeSource(remove).catch((error) => toast(error.message, "error"));
    const filter = event.target.closest("[data-source-filter]"); if (filter) { state.subscriptionFilter = filter.dataset.sourceFilter; $$('[data-source-filter]').forEach((item) => { item.classList.toggle("active", item === filter); item.setAttribute("aria-selected", String(item === filter)); }); renderSubscriptions(); }
  });
}

export default async function loadSubscriptionsView() { bindSubscriptions(); return loadSubscriptions(); }
