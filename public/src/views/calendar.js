import { $ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, formatDate, openArtifactPreview, toast } from "../core/ui.js";
import { openPublicationDialog } from "../core/publication-meta.js";
import { state } from "../core/state.js";

let bound = false;
// batch_date 是本地日期（YYYY-MM-DD），按本地时区解析；直接 new Date("YYYY-MM-DD") 会被当成 UTC 零点，负时区用户的日历落点会偏前一天
function parseLocalDate(value) {
  const [y, m, d] = String(value).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function bindCalendar() {
  if (bound) return;
  bound = true;
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-cal-month-prev]")) {
      let y = state.calYear, m = state.calMonth;
      if (y) { if (m <= 1) { y--; m = 12; } else { m--; } loadCalendar(y, m).catch((e) => toast(e.message, "error")); }
    }
    if (event.target.closest("[data-cal-month-next]")) {
      let y = state.calYear, m = state.calMonth;
      if (y) { if (m >= 12) { y++; m = 1; } else { m++; } loadCalendar(y, m).catch((e) => toast(e.message, "error")); }
    }
    if (event.target.closest("#cal-today-btn")) {
      const n = new Date();
      loadCalendar(n.getFullYear(), n.getMonth() + 1).catch((e) => toast(e.message, "error"));
    }
    const calArticle = event.target.closest("[data-cal-article]");
    if (calArticle) {
      openArtifactPreview("/api/documents/" + calArticle.dataset.calArticle + "/content", {
        originalUrl: "/api/documents/" + calArticle.dataset.calArticle + "/content",
      });
    }
    const calSocial = event.target.closest("[data-cal-social]");
    if (calSocial) {
      openArtifactPreview("/api/artifacts/" + calSocial.dataset.calSocial + "/preview", {
        originalUrl: "/api/artifacts/" + calSocial.dataset.calSocial + "/content",
      });
    }
    const calPlan = event.target.closest("[data-cal-plan]");
    if (calPlan) {
      const item = state.calendarEntries?.find((entry) => Number(entry.id) === Number(calPlan.dataset.calPlan));
      if (item) openPublicationDialog({ planId: item.id, title: item.title, columnId: item.column_id, columnName: item.column_name, onSaved: () => loadCalendar(state.calYear, state.calMonth).catch((error) => toast(error.message, "error")) });
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
  state.calendarEntries = entries;
  const articleCount = entries.filter((item) => item.content_type === "article").length;
  const socialCount = entries.filter((item) => item.content_type === "social_cards").length;
  const planCount = entries.filter((item) => item.content_type === "writing_plan").length;
  document.getElementById("cal-count").textContent = `共 ${entries.length} 项 · 文章 ${articleCount} · 图文 ${socialCount} · 写作计划 ${planCount}`;
  const dayMap = {};
  for (const a of entries) {
    const d = a.batch_date ? parseLocalDate(a.batch_date) : new Date(a.updated_at);
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
            const isPlan = a.content_type === "writing_plan";
            const action = isPlan ? `data-cal-plan="${a.id}"` : isSocial ? `data-cal-social="${a.id}"` : `data-cal-article="${a.id}"`;
            const publicationLabel = isPlan && a.publication_status ? ` · ${a.publication_status === "awaiting_metrics" ? "等待数据" : a.publication_status === "reviewed" ? "已复盘" : "已登记"}` : "";
            const planningLabel = isPlan && a.planning_recommendation ? ` · ${a.planning_recommendation.target_label || "实验"}` : "";
            html += `<div class="cal-article ${isSocial ? "cal-social" : isPlan ? "cal-plan" : "cal-longform"}" title="${escapeHtml(a.batch_date || a.updated_at || "")} · ${escapeHtml(a.pool_role || "")}${planningLabel ? ` · ${escapeHtml(planningLabel.slice(3))}` : ""}"><b class="cal-content-type">${isSocial ? "图文" : isPlan ? "计划" : "文章"}</b><button type="button" class="inline-button" ${action}>${escapeHtml(t)}</button>${planningLabel ? `<small class="cal-planning-label">${escapeHtml(planningLabel.slice(3))}</small>` : ""}${publicationLabel ? `<small class="cal-publication-status">${escapeHtml(publicationLabel.slice(3))}</small>` : ""}</div>`;
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
