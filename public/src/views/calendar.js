import { $ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, formatDate, toast } from "../core/ui.js";
import { state } from "../core/state.js";

async function loadCalendar(y, m) {
  const now = new Date();
  if (y == null) { y = now.getFullYear(); m = now.getMonth() + 1; }
  state.calYear = y; state.calMonth = m;
  const ms = y + "-" + String(m).padStart(2, "0");
  document.getElementById("cal-month-label").textContent = ms;
  const articles = await request("/api/articles?month=" + encodeURIComponent(ms));
  document.getElementById("cal-count").textContent = articles.length + " 篇";
  const dayMap = {};
  for (const a of articles) {
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
            html += `<div class="cal-article" title="${escapeHtml(a.batch_date)} · ${escapeHtml(a.pool_role || "")}"><span style="cursor:pointer" data-cal-article="${a.id}">${escapeHtml(t)}</span></div>`;
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
export default loadCalendar;