import { $ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, formatDate, toast } from "../core/ui.js";
import { state } from "../core/state.js";

let bound = false;
function bindCalendar() {
  if (bound) return;
  bound = true;
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-cal-month-prev]")) {
      let y = state.calYear, m = state.calMonth;
      if (y) { if (m <= 1) { y--; m = 12; } else { m--; } loadCalendar(y, m).catch((e) => toast(e.message)); }
    }
    if (event.target.closest("[data-cal-month-next]")) {
      let y = state.calYear, m = state.calMonth;
      if (y) { if (m >= 12) { y++; m = 1; } else { m++; } loadCalendar(y, m).catch((e) => toast(e.message)); }
    }
    if (event.target.closest("#cal-today-btn")) {
      const n = new Date();
      loadCalendar(n.getFullYear(), n.getMonth() + 1).catch((e) => toast(e.message));
    }
    const calArticle = event.target.closest("[data-cal-article]");
    if (calArticle) {
      document.getElementById("artifact-dialog").showModal();
      document.querySelector("#artifact-dialog iframe").src = "/api/documents/" + calArticle.dataset.calArticle + "/content";
    }
    const calSocial = event.target.closest("[data-cal-social]");
    if (calSocial) {
      document.getElementById("artifact-dialog").showModal();
      document.querySelector("#artifact-dialog iframe").src = "/api/candidates/" + calSocial.dataset.calSocial + "/social-cards/files/my-design.html";
    }
  });
}

async function loadCalendar(y, m) {
  const now = new Date();
  if (y == null) { y = now.getFullYear(); m = now.getMonth() + 1; }
  state.calYear = y; state.calMonth = m;
  const ms = y + "-" + String(m).padStart(2, "0");
  document.getElementById("cal-month-label").textContent = ms;
  const entries = await request("/api/calendar?month=" + encodeURIComponent(ms));
  const articleCount = entries.filter((item) => item.content_type === "article").length;
  const socialCount = entries.filter((item) => item.content_type === "social_cards").length;
  document.getElementById("cal-count").textContent = `共 ${entries.length} 项 · 文章 ${articleCount} · 图文 ${socialCount}`;
  const dayMap = {};
  for (const a of entries) {
    const d = a.batch_date ? new Date(a.batch_date) : new Date(a.updated_at);
    if (!isNaN(d.getTime())) {
      const day = d.getDate();
      if (!dayMap[day]) dayMap[day] = [];
      dayMap[day].push(a);
    }
  }
  const fd = new Date(y, m - 1, 1);
  const ld = new Date(y, m, 0).getDate();
  const sd = (fd.getDay() + 6) % 7;
  let html = '<div class="cal-header-row">';
  for (const n of ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]) html += `<div class="cal-header">${n}</div>`;
  html += "</div>";
  let day = 1;
  let ended = false;
  for (let r = 0; r < 6 && !ended; r++) {
    html += '<div class="cal-week-row">';
    for (let c = 0; c < 7; c++) {
      if ((r === 0 && c < sd) || day > ld) {
        html += '<div class="cal-cell cal-empty-cell"></div>';
      } else {
        const items = dayMap[day] || [];
        const isToday = day === now.getDate() && m === now.getMonth() + 1 && y === now.getFullYear();
        html += `<div class="cal-cell"><div class="cal-date-label">${day}${isToday ? ' <span class="cal-today-dot">●</span>' : ""}</div>`;
        if (items.length) {
          for (const a of items) {
            const t = (a.title || a.hotspot_title || "").slice(0, 22);
            const isSocial = a.content_type === "social_cards";
            const action = isSocial ? `data-cal-social="${a.candidate_row_id}"` : `data-cal-article="${a.id}"`;
            html += `<div class="cal-article ${isSocial ? "cal-social" : "cal-longform"}" title="${escapeHtml(a.batch_date || a.updated_at || "")} · ${escapeHtml(a.pool_role || "")}"><b class="cal-content-type">${isSocial ? "图文" : "文章"}</b><span style="cursor:pointer" ${action}>${escapeHtml(t)}</span></div>`;
          }
        }
        html += "</div>";
        day++;
        if (day > ld) ended = true;
      }
    }
    html += "</div>";
  }
  document.getElementById("cal-grid").innerHTML = html;
}
export default async function loadCalendarView() {
  bindCalendar();
  return loadCalendar();
}
