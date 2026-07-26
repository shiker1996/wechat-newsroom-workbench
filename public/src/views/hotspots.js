import { $ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, formatDate, toast } from "../core/ui.js";

let bound = false;
function bindHotspots() {
  if (bound) return;
  bound = true;
  document.getElementById("hotspot-filter").addEventListener("submit", (event) => {
    event.preventDefault();
    loadHotspots(new URLSearchParams(new FormData(event.currentTarget))).catch((error) => toast(error.message));
  });
}

async function loadHotspots(params) {
  if (!params) params = new URLSearchParams();
  const data = await request("/api/hotspots?" + params.toString());
  const total = data.length;
  document.getElementById("archive-summary").innerHTML = `共 ${total} 条热点 · <a href="#overview">返回热点全景</a>`;
  const list = document.getElementById("hotspot-list");
  list.innerHTML = total
    ? data.map((item) => {
        const raw = (() => { try { return JSON.parse(item.raw_json || "{}"); } catch { return {}; } })();
        const aiTags = raw.aiTags || {};
        return `<article class="story-row">
          <div class="story-source">${escapeHtml(item.source_group || item.source)}</div>
          <h3><a href="${escapeHtml(item.url || "#")}" target="_blank">${escapeHtml(item.title)}</a></h3>
          <div class="story-meta">${escapeHtml(item.category)} · ${aiTags.eventKey ? escapeHtml(aiTags.eventKey) : ""}</div>
          <div class="story-date">${formatDate(item.published_at, { hour: "2-digit", minute: "2-digit" })}</div>
        </article>`;
      }).join("")
    : '<div class="empty-state">没有匹配热点</div>';
}
export default async function loadHotspotsView(params) {
  bindHotspots();
  return loadHotspots(params);
}