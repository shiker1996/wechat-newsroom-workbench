import { state } from "../core/state.js";
import { $ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml } from "../core/ui.js";
import { stages } from "./dashboard.js";

export default async function loadBatches() {
  state.batches = await request("/api/batches?limit=100");
  $("#batch-list").innerHTML = state.batches.length ? state.batches.map((batch) => {
    const [stage] = stages[batch.stage] ?? [batch.stage];
    return `<article class="ledger-row" data-batch="${escapeHtml(batch.id)}">
      <div class="ledger-date">${escapeHtml(batch.batch_date.slice(5).replace("-", " / "))}</div>
      <div class="ledger-title"><b>${escapeHtml(batch.title)}</b><small>${escapeHtml(batch.note || "暂无值班备注")}</small></div>
      <span class="stage-badge">${escapeHtml(stage)}</span>
      <div class="ledger-count">${batch.hotspot_count}<small>热点</small></div>
      <div class="ledger-count">${batch.artifact_count}<small>产物</small></div>
    </article>`;
  }).join("") : '<div class="empty-state">还没有历史批次。</div>';
}
