import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { poll } from "../core/poll.js";
import { LOG_LIST_LIMIT, LOG_POLL_INTERVAL_MS } from "../core/constants.js";
import { escapeHtml, formatDate, toast } from "../core/ui.js";

let bound = false;
let currentLogType;
let logsPoller = null;
function bindLogs() {
  if (bound) return;
  bound = true;
  document.getElementById("log-type-filter").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-log-type]");
    if (!btn) return;
    $$("[data-log-type]", document.getElementById("log-type-filter")).forEach((b) => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-selected", String(b === btn));
    });
    currentLogType = btn.dataset.logType || undefined;
    loadLogs(currentLogType).catch((error) => toast(error.message));
  });
  document.getElementById("log-refresh").addEventListener("click", () => {
    loadLogs(currentLogType).then(() => toast("日志已刷新")).catch((error) => toast(error.message));
  });
}

async function loadLogs(logType) {
  const qs = logType ? `?type=${encodeURIComponent(logType)}&limit=${LOG_LIST_LIMIT}` : `?limit=${LOG_LIST_LIMIT}`;
  const logs = await request("/api/logs" + qs);
  document.getElementById("log-count").textContent = logs.length + " 条";
  const list = document.getElementById("log-list");
  list.innerHTML = logs.length
    ? logs.map((item) => {
        const ts = formatDate(item.ts, { year:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false });
        const sc =
          item.status === "completed" || item.status === "ok" || item.status === "success" ? "ok"
          : item.status === "failed" || item.status === "error" ? "bad"
          : item.status === "running" || item.status === "testing" ? "running" : "idle";
        const tl = item.log_type === "ai" ? "AI" : item.log_type === "source" ? "采集" : item.log_type === "model" ? "模型" : item.log_type;
        const message = item.message || "";
        // 超过 200 字符的消息截断展示，点击可展开完整内容
        const body = message.length > 200
          ? `<details class="log-expand"><summary>${escapeHtml(message.slice(0, 200))}…</summary><span>${escapeHtml(message)}</span></details>`
          : `<span>${escapeHtml(message)}</span>`;
        return `<article class="log-entry ${sc}"><div class="log-head"><span class="log-type-badge">${tl}</span><time>${escapeHtml(ts)}</time>${item.batch_id ? `<span class="log-batch">${escapeHtml(item.batch_id)}</span>` : ""}<span class="log-status status-pill ${sc}">${escapeHtml(item.status)}</span></div><div class="log-body"><code>${escapeHtml(item.subtype || "")}</code>${body}</div>${item.provider ? `<div class="log-meta"><span>服务商：${escapeHtml(item.provider)}</span></div>` : ""}</article>`;
      }).join("")
    : '<div class="empty-state">暂无日志记录。</div>';
}

// 自动刷新：复用 poll.js，离开日志视图时静默结束轮询
function startLogsAutoRefresh() {
  logsPoller?.cancel();
  logsPoller = poll(async () => {
    if (!document.getElementById("view-logs")?.classList.contains("active")) return true;
    await loadLogs(currentLogType).catch(() => {});
    return false;
  }, { interval: LOG_POLL_INTERVAL_MS, maxInterval: LOG_POLL_INTERVAL_MS, timeout: Number.MAX_SAFE_INTEGER });
  logsPoller.promise.catch(() => {});
}
export default async function loadLogsView() {
  bindLogs();
  startLogsAutoRefresh();
  return loadLogs(currentLogType);
}
