import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml } from "../core/ui.js";

async function loadLogs(logType) {
  const qs = logType ? `?type=${encodeURIComponent(logType)}&limit=150` : "?limit=150";
  const logs = await request("/api/logs" + qs);
  document.getElementById("log-count").textContent = logs.length + " 条";
  const list = document.getElementById("log-list");
  list.innerHTML = logs.length
    ? logs.map((item) => {
        const ts = (item.ts || "").slice(0, 19).replace("T", " ");
        const sc =
          item.status === "completed" || item.status === "ok" || item.status === "success" ? "ok"
          : item.status === "failed" || item.status === "error" ? "bad"
          : item.status === "running" || item.status === "testing" ? "running" : "idle";
        const tl = item.log_type === "ai" ? "AI" : item.log_type === "source" ? "采集" : item.log_type === "model" ? "模型" : item.log_type;
        return `<article class="log-entry ${sc}"><div class="log-head"><span class="log-type-badge">${tl}</span><time>${escapeHtml(ts)}</time>${item.batch_id ? `<span class="log-batch">${escapeHtml(item.batch_id)}</span>` : ""}<span class="log-status status-pill ${sc}">${escapeHtml(item.status)}</span></div><div class="log-body"><code>${escapeHtml(item.subtype || "")}</code><span>${escapeHtml((item.message || "").slice(0, 200))}</span></div>${item.provider ? `<div class="log-meta"><span>服务商：${escapeHtml(item.provider)}</span></div>` : ""}</article>`;
      }).join("")
    : '<div class="empty-state">暂无日志记录。</div>';
}
export default loadLogs;