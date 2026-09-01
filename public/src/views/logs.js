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
    loadLogs(currentLogType).catch((error) => toast(error.message, "error"));
  });
  document.getElementById("log-refresh").addEventListener("click", () => {
    loadLogs(currentLogType).then(() => toast("日志已刷新")).catch((error) => toast(error.message, "error"));
  });
}

// 模型调用日志：点击展开调用详情（元信息、文本输出、推理过程、原生工具调用）
function renderModelDetail(item, logKey) {
  const detailKey = escapeHtml(`${logKey}:detail`);
  let budget = null;
  if (item.output_budget_json) {
    try { budget = JSON.parse(item.output_budget_json); } catch { budget = null; }
  }
  const meta = [
    item.model ? `模型：${escapeHtml(item.model)}` : "",
    item.estimated_input_tokens != null ? `估算输入 ${item.estimated_input_tokens}` : "",
    item.prompt_tokens != null ? `prompt ${item.prompt_tokens}` : "",
    item.completion_tokens != null ? `completion ${item.completion_tokens}` : "",
    item.reasoning_tokens != null ? `reasoning ${item.reasoning_tokens}` : "",
    item.latency_ms != null ? `耗时 ${item.latency_ms}ms` : "",
    `压缩：${item.compressed ? "是" : "否"}`,
  ].filter(Boolean).map((part) => `<span>${part}</span>`).join("");
  const budgetBlock = budget
    ? `<details class="log-budget" data-log-detail="${escapeHtml(`${logKey}:budget`)}"><summary>输出预算</summary><pre class="log-output">${escapeHtml(JSON.stringify(budget, null, 2))}</pre></details>`
    : "";
  let toolCalls = [];
  if (item.tool_calls_json) {
    try { toolCalls = JSON.parse(item.tool_calls_json); } catch { toolCalls = []; }
  }
  if (!Array.isArray(toolCalls)) toolCalls = [];
  const toolBlock = toolCalls.length
    ? `<details class="log-tool-calls" data-log-detail="${escapeHtml(`${logKey}:tools`)}"><summary>原生工具调用（${toolCalls.length}）</summary><pre class="log-output">${escapeHtml(JSON.stringify(toolCalls, null, 2))}</pre></details>`
    : "";
  const outputBlock = item.output_text
    ? `<pre class="log-output">${escapeHtml(item.output_text)}</pre>`
    : toolCalls.length
      ? '<p class="log-output-empty">（本轮无文本输出，已留档原生工具调用）</p>'
      : item.reasoning_text
        ? '<p class="log-output-empty">（本轮无文本输出，已留档推理过程）</p>'
        : '<p class="log-output-empty">（无输出留档）</p>';
  const reasoningBlock = item.reasoning_text
    ? `<details class="log-reasoning" data-log-detail="${escapeHtml(`${logKey}:reasoning`)}"><summary>推理过程</summary><pre class="log-output">${escapeHtml(item.reasoning_text)}</pre></details>`
    : "";
  return `<details class="log-model-detail" data-log-detail="${detailKey}"><summary>调用详情</summary><div class="log-meta log-model-meta">${meta}</div>${budgetBlock}${outputBlock}${toolBlock}${reasoningBlock}</details>`;
}

async function loadLogs(logType) {
  const qs = logType ? `?type=${encodeURIComponent(logType)}&limit=${LOG_LIST_LIMIT}` : `?limit=${LOG_LIST_LIMIT}`;
  const logs = await request("/api/logs" + qs);
  document.getElementById("log-count").textContent = logs.length + " 条";
  const list = document.getElementById("log-list");
  const expandedDetails = new Set([...list.querySelectorAll("details[data-log-detail][open]")].map((detail) => detail.dataset.logDetail));
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
        const logKey = `${item.log_type}:${item.id}`;
        return `<article class="log-entry ${sc}"><div class="log-head"><span class="log-type-badge">${tl}</span><time>${escapeHtml(ts)}</time>${item.batch_id ? `<span class="log-batch">${escapeHtml(item.batch_id)}</span>` : ""}<span class="log-status status-pill ${sc}">${escapeHtml(item.status)}</span></div><div class="log-body"><code>${escapeHtml(item.subtype || "")}</code>${body}</div>${item.provider ? `<div class="log-meta"><span>服务商：${escapeHtml(item.provider)}</span></div>` : ""}${item.log_type === "model" ? renderModelDetail(item, logKey) : ""}</article>`;
      }).join("")
    : '<div class="empty-state">暂无日志记录。</div>';
  list.querySelectorAll("details[data-log-detail]").forEach((detail) => {
    detail.open = expandedDetails.has(detail.dataset.logDetail);
  });
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
