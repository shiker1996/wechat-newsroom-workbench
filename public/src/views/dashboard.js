import { state } from "../core/state.js";
import { $ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, formatDate } from "../core/ui.js";

export const stages = {
  collect: ["采集", 12], synthesis: ["研判", 32], editorial: ["编辑会", 48],
  drafting: ["成稿", 68], review: ["审稿", 82], typeset: ["排版", 92], preview: ["预览完成", 100],
};

export function activeBatch() {
  return state.batches.find((batch) => batch.id === state.activeBatchId) ?? null;
}

export function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function renderBatchSwitcher() {
  const switcher = $("#batch-switcher");
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const recent = state.batches.filter((b) => b.batch_date >= weekAgo.toISOString().slice(0, 10));
  switcher.innerHTML = recent.length
    ? recent.map((batch) => `<option value="${escapeHtml(batch.id)}" ${batch.id === state.activeBatchId ? "selected" : ""}>${escapeHtml(batch.batch_date)} · ${escapeHtml(batch.title)}</option>`).join("")
    : state.batches.length ? '<option value="">选择批次</option>' : '<option value="">暂无批次</option>';
}

function renderLatest(batch) {
  const node = $("#latest-batch");
  if (!batch) { node.className = "empty-state"; node.textContent = "还没有批次，先建立今天的编辑任务。"; return; }
  const [stageName, progress] = stages[batch.stage] ?? [batch.stage, 5];
  node.className = "";
  node.innerHTML = `<article class="latest-row" data-batch="${escapeHtml(batch.id)}">
    <div class="date-block">${formatDate(batch.batch_date)}<small>${escapeHtml(batch.batch_date)}</small></div>
    <div><h4>${escapeHtml(batch.title)}</h4><p>${stageName} · ${batch.hotspot_count} 条热点 · ${batch.artifact_count} 份产物</p><div class="progress-line"><i style="width:${progress}%"></i></div></div>
    <button class="outline-button">打开批次</button>
  </article>`;
}

function renderSources(sources) {
  const defaults = ["reddit", "rsshub", "github"];
  const byName = new Map(sources.map((item) => [item.source, item]));
  $("#source-health").innerHTML = defaults.map((source) => {
    const item = byName.get(source) ?? { status: "unknown", item_count: 0 };
    const note = item.status === "unknown" ? "尚未执行" : item.error || `${formatDate(item.ended_at, { hour: "2-digit", minute: "2-digit" })} 更新`;
    const labels = { reddit: "Reddit", rsshub: "RSSHub", github: "GitHub" };
    return `<div class="source-row ${item.status}"><i></i><div><strong>${labels[source]}</strong><small>${escapeHtml(note)}</small></div><b>${item.item_count ?? 0}</b></div>`;
  }).join("");
}

export default async function loadOverview() {
  const [overview, batches] = await Promise.all([request("/api/overview"), request("/api/batches?limit=20")]);
  state.overview = overview;
  state.batches = batches;
  if (!state.activeBatchId && batches.length) state.activeBatchId = batches[0].id;
  renderBatchSwitcher();
  $("#edition-number").textContent = String(overview.hotspots).padStart(3, "0");
  $("#metrics").innerHTML = [
    ["HOTSPOTS", overview.hotspots, "热点进入档案"],
    ["ARTICLE POOL", overview.articleCandidates, "文章候选"],
    ["SOCIAL POOL", overview.socialCandidates, "图文候选"],
    ["ARTICLE ACTIVE", overview.articleInProgress, "文章生产中"],
    ["SOCIAL ACTIVE", overview.socialInProgress, "图文生产中"],
    ["ARTIFACTS", overview.artifacts, "待审核与可追溯产物"],
  ].map(([label, value, note]) => `<article class="metric"><small>${label}</small><strong>${value}</strong><span>${note}</span></article>`).join("");
  renderLatest(overview.latest);
  renderSources(overview.sourceHealth);
}
