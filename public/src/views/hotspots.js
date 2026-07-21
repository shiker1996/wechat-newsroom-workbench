import { $ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, formatDate } from "../core/ui.js";

async function loadHotspots(params) {
  if (!params) params = new URLSearchParams();
  const data = await request("/api/hotspots?" + params.toString());
  const total = data.length;
  document.getElementById("archive-summary").textContent = `共 ${total} 条热点`;
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
export default loadHotspots;