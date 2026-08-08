import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, confirmAction } from "../core/ui.js";
import { state } from "../core/state.js";

function subscriptionTypeLabel(kind) {
  return { direct: "DIRECT", twitter: "X / TWITTER", rsshub: "RSSHUB", github:"GITHUB" }[kind] || kind;
}
function updateSubscriptionComposer() {
  const kind = document.getElementById("subscription-kind").value;
  const input = document.getElementById("subscription-value");
  const labelText = document.getElementById("subscription-value-label-text");
  const labelWrap = document.getElementById("subscription-label-wrap");
  if (kind === "twitter") {
    labelText.textContent = "X 用户名";
    input.type = "text"; input.placeholder = "@OpenAI 或 OpenAI";
    labelWrap.hidden = true;
  } else if (kind === "rsshub") {
    labelText.textContent = "RSSHub 路由";
    input.type = "text"; input.placeholder = "/twitter/user/OpenAI 或 /readhub";
    labelWrap.hidden = true;
  } else {
    labelText.textContent = "订阅地址";
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
          // 健康状态点阵（最多 50 个竖椭圆：来源不超过 50 时一源一点，超过 50 按比例采样）
  const allItems = state.subscriptions.items;
  const oks = allItems.filter((i) => i.health && i.health.status === "success").length;
  const bads = allItems.filter((i) => i.health && i.health.status !== "success").length;
  const idles = allItems.filter((i) => !i.health).length;
  const total = oks + bads + idles;
  const maxDots = Math.min(total, 50);
  if(total > 0){
    let dotHtml = "<div class=\"health-dots\">";
    const addDots = (cnt, cls, label) => { for(let d = 0; d < cnt; d++){ dotHtml += "<i class=\"health-dot " + cls + "\" title=\"" + label + "\"></i>"; } };
    const ratio = maxDots / total;
    let okDots = Math.round(oks * ratio) || (oks > 0 ? 1 : 0);
    let badDots = Math.round(bads * ratio) || (bads > 0 ? 1 : 0);
    let idleDots = Math.round(idles * ratio) || (idles > 0 ? 1 : 0);
    let sum = okDots + badDots + idleDots;
    while(sum > maxDots){ if(okDots > badDots && okDots > idleDots) okDots--; else if(badDots > idleDots) badDots--; else idleDots--; sum--; }
    while(sum < maxDots){ if(oks > bads && oks > idles) okDots++; else if(bads > idles) badDots++; else idleDots++; sum++; }
    addDots(okDots, "ok", oks + "个来源正常");
    if(bads > 0) addDots(badDots, "bad", bads + "个来源异常");
    if(idles > 0) addDots(idleDots, "idle", idles + "个未采集");
    dotHtml += "</div>";
    const hc = document.getElementById("subscription-health");
    if(hc) hc.innerHTML = dotHtml;
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
          <div class="subscription-actions">${item.managed?'<span class="story-meta">随 GitHub 采集执行</span>':`<button class="text-button" data-source-test data-kind="${escapeHtml(item.kind)}" data-value="${escapeHtml(item.value)}">测试</button><button class="source-remove" data-source-remove data-kind="${escapeHtml(item.kind)}" data-value="${escapeHtml(item.value)}" aria-label="删除订阅源：${escapeHtml(item.label)}">×</button>`}</div>
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
  if (!payload.value) return toast("订阅内容不能为空", "error");
  if (payload.kind === "direct") {
    try { new URL(payload.value); } catch { return toast("订阅地址不是有效的 URL，请检查格式", "error"); }
  }
  const duplicate = (state.subscriptions?.items || []).some((item) => item.kind === payload.kind && item.value === payload.value);
  if (duplicate) return toast("该订阅已存在，请勿重复添加", "error");
  state.subscriptions = await request("/api/subscriptions", { method: "POST", body: JSON.stringify(payload) });
  if (event.currentTarget) event.currentTarget.reset();
  updateSubscriptionComposer();
  renderSubscriptions();
  toast("订阅已写入本地配置，下一次采集生效");
}
async function toggleSubscription(input) {
  // 请求期间禁用开关，避免连续点击产生并发 PATCH（响应顺序不保证）
  input.disabled = true;
  state.subscriptions = await request("/api/subscriptions", {
    method: "PATCH", body: JSON.stringify({ kind: input.dataset.kind, value: input.dataset.value, enabled: input.checked }),
  });
  renderSubscriptions();
  toast(input.checked ? "订阅已启用" : "订阅已暂停");
  input.disabled = false;
}
async function removeSubscription(button) {
  if (!await confirmAction(`确定删除订阅"${button.dataset.value}"吗？`, { confirmText: "删除" })) return;
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
    if (!event.target.closest("#view-sources")) return;
    if (event.target.matches("[data-source-toggle]")) {
      toggleSubscription(event.target).catch((error) => { event.target.disabled = false; event.target.checked = !event.target.checked; toast(error.message); });
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#view-sources")) return;
    const sourceTest = event.target.closest("[data-source-test]");
    if (sourceTest) testSubscription({ kind: sourceTest.dataset.kind, value: sourceTest.dataset.value }, sourceTest).catch((error) => toast(error.message));
    const sourceRemove = event.target.closest("[data-source-remove]");
    if (sourceRemove) removeSubscription(sourceRemove).catch((error) => toast(error.message));
    const sourceFilter = event.target.closest("[data-source-filter]");
    if (sourceFilter) {
      state.subscriptionFilter = sourceFilter.dataset.sourceFilter;
      $$("[data-source-filter]").forEach((item) => {
        item.classList.toggle("active", item === sourceFilter);
        item.setAttribute("aria-selected", String(item === sourceFilter));
      });
      renderSubscriptions();
    }
  });
}

export default async function loadSubscriptionsView() {
  bindSubscriptions();
  return loadSubscriptions();
}
