import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast } from "../core/ui.js";
import { state } from "../core/state.js";

function renderCandidates(candidates) {
  const count = document.getElementById("candidate-count");
  if (count) count.textContent = candidates.length + " 条";
  const list = document.getElementById("candidate-list");
  list.innerHTML = candidates.length
    ? candidates.map((item) => {
        const card = `<article class="candidate-card ${item.composite ? "composite" : ""}" data-id="${escapeHtml(item.candidate_id)}">
          <h4>${escapeHtml(item.hotspot_title)}${item.composite ? ' <span class="composite-tag">综合</span>' : ""}</h4>
          <div class="candidate-meta"><span>${escapeHtml(item.pool_role)}</span><span>${item.composite ? "多源综合" : escapeHtml(item.source_name || item.source_group || item.source)}</span><span>风险 ${escapeHtml(item.risk_level)}</span></div>
          <div class="score-strip">${["h", "b", "p", "s", "d", "f"].map((k) => `<span>${k.toUpperCase()}<b>${item[k + "_score"] == null ? "—" : Number(item[k + "_score"]).toFixed(item[k + "_score"] % 1 ? 1 : 0)}</b></span>`).join("")}</div>
          <div class="candidate-actions"><span class="status-pill">${escapeHtml(item.brief_status || item.status)}</span><button class="text-button" data-editorial-id="${item.id}">进入编辑室 →</button>${item.status !== "locked" && item.status !== "drafting" && item.status !== "review" && item.status !== "preview" && item.status !== "published" ? `<button class="text-button muted" data-remove-candidate="${item.id}">移除</button>` : ""}</div>
        </article>`;
        return card;
      }).join("")
    : '<div class="empty-state">暂无候选。在热点全景中通过事件归纳卡片创建综合选题，AI 研判后自动填充评分。</div>';
}

async function loadRanking() {
  const batch = state.batches.find((b) => b.id === state.activeBatchId);
  if (!batch) return;
  try {
    const items = await request(`/api/batches/${encodeURIComponent(batch.id)}/ranking`);
    if (!items.length) return;
    const panel = document.getElementById("ranking-panel");
    if (!panel) return;
    panel.hidden = false;
    const toggle = document.getElementById("toggle-ranking");
    const list = document.getElementById("ranking-list");
    if (!toggle || !list) return;
    toggle.textContent = `展开(${items.length}条)`;
    toggle.onclick = function () {
      const expanded = list.style.display !== "block";
      list.style.display = expanded ? "block" : "none";
      toggle.textContent = expanded ? "收起" : `展开(${items.length}条)`;
      if (expanded) renderRankingList(items, list);
    };
    state.rankingItems = items;
  } catch {}
}

function renderRankingList(items, container) {
  container.innerHTML = items.map(function (item) {
    const reason = item.eliminationReason
      ? `<span class="muted" style="font-size:9px">${escapeHtml(item.eliminationReason)}</span>`
      : '<span class="muted" style="font-size:9px">已入池</span>';
    const cls = item.inPool ? "ranking-row in-pool" : "ranking-row";
    const btn = item.inPool
      ? ""
      : `<button class="text-button" data-ranking-add="${item.hotspotId}" style="font-size:9px">加入候选</button>`;
    return `<div class="${cls}"><span class="ranking-rank">#${item.rank}</span><span class="ranking-score">${item.score}</span><div class="ranking-title"><b>${escapeHtml(item.title)}</b>${reason}</div><div class="ranking-actions">${btn}</div></div>`;
  }).join("");
}

async function loadTopicPool() {
  const batch = state.batches.find((b) => b.id === state.activeBatchId);
  if (!batch) return;
  const [detail, candidates] = await Promise.all([
    request(`/api/batches/${encodeURIComponent(batch.id)}`),
    request(`/api/batches/${encodeURIComponent(batch.id)}/candidates`),
  ]);
  state.currentBatch = detail;
  state.candidates = candidates;
  renderCandidates(candidates);
  loadRanking();
}

window.renderCandidates = renderCandidates;

export default loadTopicPool;