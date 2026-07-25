import { $ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, formatDate, toast } from "../core/ui.js";
import { state } from "../core/state.js";
import loadOverview from "./dashboard.js";

export async function reindex() {
  const result = await request("/api/artifacts/reindex", { method: "POST" });
  toast(`扫描完成，发现 ${result.indexed} 份产物`);
  await Promise.all([loadArtifacts(), loadOverview()]);
}

let bound = false;
function bindArtifacts() {
  if (bound) return;
  bound = true;
  document.getElementById("reindex-button").addEventListener("click", () => {
    reindex().catch((error) => toast(error.message));
  });
  document.addEventListener("click", (event) => {
    const artifact = event.target.closest("[data-artifact]");
    if (!artifact) return;
    const dialog = document.getElementById("artifact-dialog");
    dialog.querySelector("iframe").src = `/api/artifacts/${artifact.dataset.artifact}/preview`;
    dialog.showModal();
  });
}

async function loadArtifacts() {
  const batchId = state.activeBatchId || "";
  const qs = batchId ? "?limit=300&batch_id=" + encodeURIComponent(batchId) : "?limit=300";
  const [items, stats] = await Promise.all([
    request("/api/artifacts" + qs),
    request("/api/articles/stats").catch(() => null),
  ]);
  const statsEl = document.getElementById("article-stats");
  if (stats && statsEl) {
    statsEl.innerHTML = [
      ["累计", stats.totalFinal, "篇已完结文章"],
      ["本月", stats.thisMonth, "篇"],
      ["本周", stats.thisWeek, "篇"],
    ].map(([label, value, note]) => `<div class="article-stat"><strong>${value}</strong><span>${label}<br><small>${note}</small></span></div>`).join("");
  }
  const batchLabel = state.batches.find((b) => b.id === state.activeBatchId)?.batch_date || "全部批次";
  const list = document.getElementById("artifact-list");
  list.innerHTML = items.length
    ? items.map((item) => {
        const ext = item.name.split(".").pop().toUpperCase();
        return `<article class="artifact-card" data-artifact="${item.id}"><div class="artifact-card-flags"><span class="file-tab">${escapeHtml(ext)}</span>${item.track?`<span class="artifact-track">${item.track==='social_cards'?'图文':'文章'} · ${escapeHtml(item.candidate_id||'')}</span>`:''}</div><h3>${escapeHtml(item.kind)}</h3><p>${escapeHtml(item.name)}</p>${item.hotspot_title?`<small class="artifact-topic">${escapeHtml(item.hotspot_title)}</small>`:''}<footer><span>${Math.max(1, Math.round(item.size / 1024))} KB</span><time>${formatDate(item.modified_at)}</time></footer></article>`;
      }).join("")
    : `<div class="empty-state"><strong>${escapeHtml(batchLabel)}</strong> 下没有产物。尝试切换到其他批次或重新扫描工作区。</div>`;
}
export default async function loadArtifactsView() {
  bindArtifacts();
  return loadArtifacts();
}
