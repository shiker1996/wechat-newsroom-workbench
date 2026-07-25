import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast } from "../core/ui.js";
import { state } from "../core/state.js";

function subscriptionTypeLabel(kind) {
  return { direct: "DIRECT", twitter: "X / TWITTER", rsshub: "RSSHUB", github:"GITHUB" }[kind] || kind;
}
function updateSubscriptionComposer() {
  const kind = document.getElementById("subscription-kind").value;
  const input = document.getElementById("subscription-value");
  const label = document.getElementById("subscription-value-label");
  const labelWrap = document.getElementById("subscription-label-wrap");
  if (kind === "twitter") {
    label.firstChild.textContent = "X 用户名 ";
    input.type = "text"; input.placeholder = "@OpenAI 或 OpenAI";
    labelWrap.hidden = true;
  } else if (kind === "rsshub") {
    label.firstChild.textContent = "RSSHub 路由 ";
    input.type = "text"; input.placeholder = "/twitter/user/OpenAI 或 /readhub";
    labelWrap.hidden = true;
  } else {
    label.firstChild.textContent = "订阅地址 ";
    input.type = "url"; input.placeholder = "https://example.com/feed.xml";
    labelWrap.hidden = false;
  }
  const result = document.getElementById("subscription-test-result");
  result.className = "subscription-test-result";
  result.textContent = "尚未测试。直连 RSS 不调用大模型，也不产生模型费用。";
}
function subscriptionFormPayload() {
  return {
    kind: document.getElementById("subscription-kind").value,
    value: document.getElementById("subscription-value").value.trim(),
    label: document.getElementById("subscription-label").value.trim(),
  };
}
function renderSubscriptions() {
  if (!state.subscriptions) return;
  const summary = state.subscriptions.summary;
  const s = document.getElementById("subscription-summary");
  s.innerHTML = [
    ["TOTAL", summary.total, "全部入口"], ["ON DESK", summary.enabled, "当前启用"],
    ["DIRECT", summary.direct, "直连 Feed"], ["GITHUB", summary.github||0, "Trending / Search"],
  ].map(([name, value, note]) => `<article><small>${name}</small><strong>${value}</strong><span>${note}</span></article>`).join("");
  renderHealthTimeline(state.subscriptions.history || []);
          // 健康状态点阵（固定50个竖椭圆，按比例采样）
  var allItems = state.subscriptions.items;
  var oks = allItems.filter(function(i){return i.health && i.health.status === "success";}).length;
  var bads = allItems.filter(function(i){return i.health && i.health.status !== "success";}).length;
  var idles = allItems.filter(function(i){return !i.health;}).length;
  var total = oks + bads + idles;
  var maxDots = 100;
  if(total > 0){
    var dotHtml = "<div class=\"health-dots\">";
    var addDots=function(cnt, cls, label){for(var d=0; d<cnt; d++){dotHtml += "<i class=\"health-dot " + cls + "\" title=\"" + label + "\"></i>";}}
    var ratio = maxDots / total;
    var okDots = Math.round(oks * ratio) || (oks > 0 ? 1 : 0);
    var badDots = Math.round(bads * ratio) || (bads > 0 ? 1 : 0);
    var idleDots = Math.round(idles * ratio) || (idles > 0 ? 1 : 0);
    var sum = okDots + badDots + idleDots;
    while(sum > maxDots){if(okDots > badDots && okDots > idleDots)okDots--;else if(badDots > idleDots)badDots--;else idleDots--;sum--;}
    while(sum < maxDots){if(oks > bads && oks > idles)okDots++;else if(bads > idles)badDots++;else idleDots++;sum++;}
    addDots(okDots, "ok", oks + "个来源正常");
    if(bads > 0) addDots(badDots, "bad", bads + "个来源异常");
    if(idles > 0) addDots(idleDots, "idle", idles + "个未采集");
    dotHtml += "</div>";
    var hc=document.getElementById("subscription-health");if(hc)hc.innerHTML=dotHtml;
  }
  const items = state.subscriptions.items.filter(
    (item) => state.subscriptionFilter === "all" || item.kind === state.subscriptionFilter
  );
  const list = document.getElementById("subscription-list");
  list.innerHTML = items.length
    ? items.map((item, index) => {
        const health = item.health;
        const hc = health?.status === "success" ? "ok" : health ? "bad" : "idle";
        const ht = health?.status === "success"
          ? `最近成功 · ${health.item_count} 条 · ${((Number(health.duration_ms) || 0) / 1000).toFixed(1)}s`
          : health ? `最近${health.status === "interrupted" ? "中断" : "失败"} · ${health.error || "未返回内容"}`
          : "尚无采集记录";
        return `<article class="subscription-row health-${hc} ${item.enabled ? "" : "disabled"}" style="--row:${index}">
          <span class="subscription-kind ${escapeHtml(item.kind)}">${subscriptionTypeLabel(item.kind)}</span>
          <div class="subscription-identity"><b>${escapeHtml(item.label)}</b><code>${escapeHtml(item.value)}</code><small class="source-health ${hc}" title="${escapeHtml(health?.error || "")}">${escapeHtml(ht)}</small></div>
          ${item.managed?'<span class="story-meta">系统采集入口</span>':`<label class="source-switch"><input type="checkbox" data-source-toggle ${item.enabled ? "checked" : ""} data-kind="${escapeHtml(item.kind)}" data-value="${escapeHtml(item.value)}"><i></i><span>${item.enabled ? "启用" : "暂停"}</span></label>`}
          <div class="subscription-actions">${item.managed?'<span class="story-meta">随 GitHub 采集执行</span>':`<button class="text-button" data-source-test data-kind="${escapeHtml(item.kind)}" data-value="${escapeHtml(item.value)}">测试</button><button class="source-remove" data-source-remove data-kind="${escapeHtml(item.kind)}" data-value="${escapeHtml(item.value)}">×</button>`}</div>
        </article>`;
      }).join("")
    : '<div class="empty-state">这个分类下还没有订阅源。</div>';
}
function renderHealthTimeline(rows) {
  const node = document.getElementById("subscription-health");
  if (!node) return;
  const days = [...new Set(rows.map((r) => String(r.ended_at || r.started_at || "").slice(0, 10)).filter(Boolean))].sort().slice(-14);
  if (!days.length) { node.innerHTML = '<div class="empty-state">尚无来源历史记录。</div>'; return; }
  const groups = new Map();
  for (const row of rows) {
    const key = row.source_name || row.source_key;
    if (!groups.has(key)) groups.set(key, new Map());
    const day = String(row.ended_at || row.started_at || "").slice(0, 10);
    if (!groups.get(key).has(day)) groups.get(key).set(day, row);
  }
  const dayHead = days.map((d) => `<span title="${d}">${escapeHtml(d.slice(5))}</span>`).join("");
  const body = [...groups.entries()].map(([name, byDay]) => {
    const cells = days.map((day) => {
      const item = byDay.get(day);
      const cls = !item ? "idle" : item.status === "success" ? "ok" : "bad";
      const title = item ? `${item.status} · ${item.item_count || 0} 条${item.error ? ` · ${item.error}` : ""}` : "未采集";
      return `<i class="health-history-cell ${cls}" title="${escapeHtml(`${day} · ${title}`)}"></i>`;
    }).join("");
    return `<div class="health-history-row"><b title="${escapeHtml(name)}">${escapeHtml(name)}</b><span>${cells}</span></div>`;
  }).join("");
  node.innerHTML = `<div class="health-history"><div class="health-history-head"><b>来源健康 · 最近 ${days.length} 天</b><span>${dayHead}</span></div>${body}</div>`;
}
async function loadSubscriptions() {
  const [subscriptions, history] = await Promise.all([
    request("/api/subscriptions"),
    request("/api/subscriptions/health-history?days=14").catch(() => []),
  ]);
  state.subscriptions = { ...subscriptions, history };
  renderSubscriptions();
}
async function testSubscription(payload, button) {
  const output = document.getElementById("subscription-test-result");
  if (button) button.disabled = true;
  output.className = "subscription-test-result testing";
  output.textContent = "正在连接并解析 Feed…";
  try {
    const result = await request("/api/subscriptions/test", { method: "POST", body: JSON.stringify(payload) });
    output.className = "subscription-test-result ok";
    output.textContent = `连接成功 · ${result.title} · 识别到 ${result.itemCount} 条内容`;
    return result;
  } catch (err) {
    output.className = "subscription-test-result bad";
    output.textContent = `测试失败：${err.message}`;
    throw err;
  } finally { if (button) button.disabled = false; }
}
async function addSubscriptionFromForm(event) {
  event.preventDefault();
  const payload = subscriptionFormPayload();
  state.subscriptions = await request("/api/subscriptions", { method: "POST", body: JSON.stringify(payload) });
  if (event.currentTarget) event.currentTarget.reset();
  updateSubscriptionComposer();
  renderSubscriptions();
  toast("订阅已写入本地配置，下一次采集生效");
}
async function toggleSubscription(input) {
  state.subscriptions = await request("/api/subscriptions", {
    method: "PATCH", body: JSON.stringify({ kind: input.dataset.kind, value: input.dataset.value, enabled: input.checked }),
  });
  renderSubscriptions();
  toast(input.checked ? "订阅已启用" : "订阅已暂停");
}
async function removeSubscription(button) {
  if (!confirm(`确定删除订阅"${button.dataset.value}"吗？`)) return;
  state.subscriptions = await request("/api/subscriptions", {
    method: "DELETE", body: JSON.stringify({ kind: button.dataset.kind, value: button.dataset.value }),
  });
  renderSubscriptions();
  toast("订阅已删除");
}


let bound = false;
function bindSubscriptions() {
  if (bound) return;
  bound = true;
  document.getElementById("subscription-kind").addEventListener("change", updateSubscriptionComposer);
  document.getElementById("subscription-form").addEventListener("submit", (event) => addSubscriptionFromForm(event).catch((error) => toast(error.message)));
  document.getElementById("test-subscription").addEventListener("click", (event) => testSubscription(subscriptionFormPayload(), event.currentTarget).catch((error) => toast(error.message)));
  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-source-toggle]")) {
      toggleSubscription(event.target).catch((error) => { event.target.checked = !event.target.checked; toast(error.message); });
    }
  });
  document.addEventListener("click", (event) => {
    const sourceTest = event.target.closest("[data-source-test]");
    if (sourceTest) testSubscription({ kind: sourceTest.dataset.kind, value: sourceTest.dataset.value }, sourceTest).catch((error) => toast(error.message));
    const sourceRemove = event.target.closest("[data-source-remove]");
    if (sourceRemove) removeSubscription(sourceRemove).catch((error) => toast(error.message));
    const sourceFilter = event.target.closest("[data-source-filter]");
    if (sourceFilter) {
      state.subscriptionFilter = sourceFilter.dataset.sourceFilter;
      $$("[data-source-filter]").forEach((item) => item.classList.toggle("active", item === sourceFilter));
      renderSubscriptions();
    }
  });
}

export default async function loadSubscriptionsView() {
  bindSubscriptions();
  return loadSubscriptions();
}
