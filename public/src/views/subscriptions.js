import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast } from "../core/ui.js";
import { state } from "../core/state.js";

function subscriptionTypeLabel(kind) {
  return { direct: "DIRECT", twitter: "X / TWITTER", rsshub: "RSSHUB" }[kind] || kind;
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
    ["DIRECT", summary.direct, "直连 Feed"], ["X SIGNAL", summary.twitter, "官方与博主"],
  ].map(([name, value, note]) => `<article><small>${name}</small><strong>${value}</strong><span>${note}</span></article>`).join("");
  // 健康状态条
  var subs = state.subscriptions.items;
  var okN = subs.filter(function(i){return i.health && i.health.status === "success";}).length;
  var badN = subs.filter(function(i){return i.health && i.health.status !== "success";}).length;
  var idleN = subs.filter(function(i){return !i.health;}).length;
  var ttl = okN + badN + idleN;
  if (ttl > 0) {
    function hp(n){return (n/ttl*100).toFixed(1)+"%";}
    var bar = document.createElement("div");
    bar.className = "health-bar";
    var track = document.createElement("div");
    track.className = "health-bar-track";
    if (okN){var seg=document.createElement("i");seg.className="health-bar-ok";seg.style.width=hp(okN);seg.title=okN+"个来源最近成功";track.appendChild(seg);}
    if (badN){var seg=document.createElement("i");seg.className="health-bar-bad";seg.style.width=hp(badN);seg.title=badN+"个来源最近失败";track.appendChild(seg);}
    if (idleN){var seg=document.createElement("i");seg.className="health-bar-idle";seg.style.width=hp(idleN);seg.title=idleN+"个来源尚无采集记录";track.appendChild(seg);}
    bar.appendChild(track);
    var labels = document.createElement("div");
    labels.className = "health-bar-labels";
    if(okN){var sOk=document.createElement("span");sOk.className="ok";sOk.textContent=okN+"正常";labels.appendChild(sOk);}
    if(badN){var sBad=document.createElement("span");sBad.className="bad";sBad.textContent=badN+"异常";labels.appendChild(sBad);}
    if(idleN){var sIdle=document.createElement("span");sIdle.className="idle";sIdle.textContent=idleN+"未采集";labels.appendChild(sIdle);}
    bar.appendChild(labels);
    document.getElementById("subscription-summary").appendChild(bar);
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
          <div class="subscription-identity"><span class="health-badge ${hc}"></span><b>${escapeHtml(item.label)}</b><code>${escapeHtml(item.value)}</code><small class="source-health ${hc}" title="${escapeHtml(health?.error || "")}">${escapeHtml(ht)}</small></div>
          <label class="source-switch"><input type="checkbox" data-source-toggle ${item.enabled ? "checked" : ""} data-kind="${escapeHtml(item.kind)}" data-value="${escapeHtml(item.value)}"><i></i><span>${item.enabled ? "启用" : "暂停"}</span></label>
          <div class="subscription-actions"><button class="text-button" data-source-test data-kind="${escapeHtml(item.kind)}" data-value="${escapeHtml(item.value)}">测试</button><button class="source-remove" data-source-remove data-kind="${escapeHtml(item.kind)}" data-value="${escapeHtml(item.value)}">×</button></div>
        </article>`;
      }).join("")
    : '<div class="empty-state">这个分类下还没有订阅源。</div>';
}
async function loadSubscriptions() {
  state.subscriptions = await request("/api/subscriptions");
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

// Expose for event handlers (called from app-bind.js)
window.subscriptionTypeLabel = subscriptionTypeLabel;
window.updateSubscriptionComposer = updateSubscriptionComposer;
window.renderSubscriptions = renderSubscriptions;
window.subscriptionFormPayload = subscriptionFormPayload;
window.testSubscription = testSubscription;
window.addSubscriptionFromForm = addSubscriptionFromForm;
window.toggleSubscription = toggleSubscription;
window.removeSubscription = removeSubscription;

export default loadSubscriptions;
