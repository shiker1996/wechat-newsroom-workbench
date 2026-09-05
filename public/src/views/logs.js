import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { poll } from "../core/poll.js";
import { LOG_LIST_LIMIT, LOG_POLL_INTERVAL_MS } from "../core/constants.js";
import { escapeHtml, formatDate, toast } from "../core/ui.js";

let bound = false;
let currentLogType;
let currentLogQuery = "";
let currentLogStatus = "";
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
  document.getElementById("log-query")?.addEventListener("input", (event) => {
    currentLogQuery = String(event.target.value || "").trim().toLowerCase();
    loadLogs(currentLogType).catch((error) => toast(error.message, "error"));
  });
  document.getElementById("log-status")?.addEventListener("change", (event) => {
    currentLogStatus = String(event.target.value || "");
    loadLogs(currentLogType).catch((error) => toast(error.message, "error"));
  });
  document.getElementById("log-governance-save")?.addEventListener("click", () => saveLogGovernance().catch((error) => toast(error.message, "error")));
  document.getElementById("log-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-run-trace]");
    if (!button) return;
    event.preventDefault();
    openRunTrace(button.dataset.openRunTrace);
  });
  document.getElementById("close-run-trace")?.addEventListener("click", () => document.getElementById("run-trace-dialog")?.close());
  document.getElementById("run-trace-dialog")?.addEventListener("close", () => document.getElementById("run-trace-actions")?.replaceChildren());
}

async function loadLogGovernance() {
  const result = await request("/api/system/log-governance");
  const config = result.governance || {};
  const values = [["log-governance-model-limit", config.modelCallsLimit], ["log-governance-model-days", config.modelCallsDays], ["log-governance-tool-days", config.toolExecutionsDays]];
  values.forEach(([id, value]) => { const input = document.getElementById(id); if (input && value != null) input.value = value; });
  const archive = document.getElementById("log-governance-archive");
  if (archive && config.archiveEnabled != null) archive.checked = config.archiveEnabled !== false;
}

async function saveLogGovernance() {
  const read = (id) => Number(document.getElementById(id)?.value || 0);
  const status = document.getElementById("log-governance-status");
  const button = document.getElementById("log-governance-save");
  button.disabled = true;
  if (status) status.textContent = "正在保存并清理…";
  try {
    const result = await request("/api/system/log-governance", { method: "PUT", confirmation: "plugin-admin", body: JSON.stringify({ modelCallsLimit: read("log-governance-model-limit"), modelCallsDays: read("log-governance-model-days"), toolExecutionsDays: read("log-governance-tool-days"), archiveEnabled: Boolean(document.getElementById("log-governance-archive")?.checked), cleanup: true }) });
    if (status) status.textContent = `已保存；清理模型 ${result.cleanup?.modelCalls ?? 0} 条、工具 ${result.cleanup?.toolExecutions ?? 0} 条${result.cleanup?.archived ? `，归档 ${result.cleanup.archived} 条` : ""}`;
    toast("日志治理配置已保存");
  } finally { button.disabled = false; }
}

function traceRows(items, render, empty = "暂无记录") {
  if (!Array.isArray(items) || !items.length) return `<div class="run-trace-empty">${empty}</div>`;
  return items.map(render).join("");
}

function renderTraceOverview(trace, metrics, runs) {
  const overview = document.getElementById("run-trace-overview");
  if (!overview) return;
  const parts = [
    ["system", "运行", runs.length],
    ["context", "事件", trace.events?.length || 0],
    ["model", "模型", trace.modelCalls?.length || 0],
    ["tool", "工具", (trace.toolCalls?.length || 0) + (trace.toolExecutions?.length || 0)],
    ["checkpoint", "检查点", trace.checkpoints?.length || 0],
  ];
  const total = Math.max(1, parts.reduce((sum, [, , count]) => sum + count, 0));
  const segments = parts.map(([kind, label, count]) => `<span class="run-trace-segment ${kind}" style="--segment:${Math.max(3, Math.round(count / total * 100))}%" title="${escapeHtml(label)} ${escapeHtml(String(count))}"></span>`).join("");
  const firstRun = runs[0] || {};
  const status = String(firstRun.status || trace.status || "idle");
  const statusLabel = status === "completed" ? "COMPLETED" : status === "running" || status === "testing" ? "RUNNING" : status.toUpperCase();
  overview.innerHTML = `<div class="run-trace-overview-labels"><span>输入<br><b>TRACE</b></span><span>时间轴<br><b>${escapeHtml(statusLabel)}</b></span><span>输出<br><b>${escapeHtml(String(metrics.durationMs ?? 0))} ms</b></span></div><div class="run-trace-overview-main"><div class="run-trace-overview-bar">${segments}</div><div class="run-trace-overview-scale"><span>0 ms</span><span>${escapeHtml(String(metrics.durationMs ?? 0))} ms</span></div></div><div class="run-trace-overview-legend">${parts.map(([kind, label, count]) => `<span><i class="${kind}"></i>${escapeHtml(label)} ${escapeHtml(String(count))}</span>`).join("")}</div>`;
}

function renderRunTrace(trace, metrics, rootRunId) {
  const summary = document.getElementById("run-trace-summary");
  const content = document.getElementById("run-trace-content");
  const runs = trace.runs || (trace.run ? [trace.run] : []);
  renderTraceOverview(trace, metrics, runs);
  const metricItems = [
    ["Runs", metrics.runCount ?? runs.length], ["成功率", `${metrics.successRate ?? 0}%`],
    ["耗时", `${metrics.durationMs ?? 0} ms`], ["模型调用", metrics.modelCalls ?? trace.modelCalls?.length ?? 0],
    ["工具调用", metrics.toolCalls ?? trace.toolCalls?.length ?? 0], ["重试", `${metrics.retryRate ?? 0}%`],
    ["门禁失败", metrics.gateFailures ?? 0],
  ];
  summary.innerHTML = metricItems.map(([label, value]) => `<span><b>${escapeHtml(String(value))}</b><small>${escapeHtml(label)}</small></span>`).join("");
  document.getElementById("run-trace-title").textContent = `运行详情 · ${rootRunId}`;
  document.getElementById("run-trace-subtitle").textContent = "按 Workflow → Stage → Skill → Model / Tool 展开持久化链路。";
  const runSection = `<section class="run-trace-section trace-kind-system"><h3><i>SYS</i> Workflow / Agent Run <small>${runs.length}</small></h3><div class="run-trace-list">${traceRows(runs, (run) => `<article class="trace-row"><span class="trace-row-marker">SYS</span><div><b>${escapeHtml(run.entry_point || run.entryPoint || run.skill_id || run.skillId || run.id || "运行")}</b><span>${escapeHtml(run.status || "未知")} · ${escapeHtml(run.stage_id || run.stageId || "未分阶段")}</span></div><small>${escapeHtml(run.started_at || run.startedAt || "")}${run.finished_at ? ` → ${escapeHtml(run.finished_at)}` : ""}</small></article>`)}</div></section>`;
  const eventSection = `<section class="run-trace-section trace-kind-context"><h3><i>CTX</i> 阶段事件 <small>${trace.events?.length || 0}</small></h3><div class="run-trace-list">${traceRows(trace.events, (item) => { const event = item.event || item; return `<article class="trace-row"><span class="trace-row-marker">CTX</span><div><b>${escapeHtml(event.type || "event")}</b><span>${escapeHtml(event.stageId || event.stage_id || "")}</span><small>${escapeHtml(event.message || event.error || item.created_at || "")}</small></div><time>${escapeHtml(item.created_at || event.created_at || "")}</time></article>`; })}</div></section>`;
  const modelSection = `<section class="run-trace-section trace-kind-model"><h3><i>LLM</i> Model Call <small>${trace.modelCalls?.length || 0}</small></h3><div class="run-trace-list">${traceRows(trace.modelCalls, (call) => `<article class="trace-row"><span class="trace-row-marker">LLM</span><div><b>${escapeHtml(call.purpose || call.model || "模型调用")}</b><span>${escapeHtml([call.provider, call.model].filter(Boolean).join(" · "))} · ${escapeHtml(call.status || "")}</span><small>${call.latency_ms ?? 0} ms · prompt ${call.prompt_tokens ?? "—"} · completion ${call.completion_tokens ?? "—"}</small></div><time>${escapeHtml(call.created_at || "")}</time></article>`)}</div></section>`;
  const toolSection = `<section class="run-trace-section trace-kind-tool"><h3><i>TOOL</i> Tool Call / Audit <small>${(trace.toolCalls?.length || 0) + (trace.toolExecutions?.length || 0)}</small></h3><div class="run-trace-list">${traceRows([...(trace.toolCalls || []), ...(trace.toolExecutions || [])], (call) => `<article class="trace-row"><span class="trace-row-marker">TOOL</span><div><b>${escapeHtml(call.capability || "工具调用")}</b><span>${escapeHtml(call.status || "")} · ${escapeHtml(call.plugin || call.plugin_version || "")}</span><small>${escapeHtml(call.side_effect || call.sideEffect || "none")} · ${escapeHtml(call.replay_policy || call.replayPolicy || "never")}</small></div><time>${escapeHtml(call.created_at || "")}</time></article>`)}</div></section>`;
  const checkpointSection = `<section class="run-trace-section trace-kind-checkpoint"><h3><i>CKPT</i> Checkpoint <small>${trace.checkpoints?.length || 0}</small></h3><div class="run-trace-list">${traceRows(trace.checkpoints, (checkpoint) => `<article class="trace-row"><span class="trace-row-marker">SAVE</span><div><b>序号 ${escapeHtml(String(checkpoint.sequence ?? "—"))}</b><span>${checkpoint.state?.resumable ? "可恢复" : "不可恢复"}</span></div><time>${escapeHtml(checkpoint.created_at || "")}</time></article>`)}</div></section>`;
  content.innerHTML = `${runSection}${eventSection}${modelSection}${toolSection}${checkpointSection}`;
  const actions = document.getElementById("run-trace-actions");
  if (actions) {
    const active = (trace.runs || []).some((run) => ["running", "testing"].includes(run.status));
    const resumable = Boolean(trace.resumable);
    actions.innerHTML = `${active ? `<button type="button" class="ghost-button" data-run-action="cancel" data-run-id="${escapeHtml(rootRunId)}">取消运行</button>` : ""}${resumable ? `<button type="button" class="outline-button" data-run-action="resume" data-run-id="${escapeHtml(rootRunId)}">从 checkpoint 恢复</button>` : ""}${(trace.runs || []).some((run) => ["failed", "aborted", "limit"].includes(run.status)) ? `<button type="button" class="outline-button" data-run-action="retry" data-run-id="${escapeHtml(rootRunId)}">重试失败阶段</button>` : ""}<button type="button" class="text-button" data-trace-extra="replay" data-run-id="${escapeHtml(rootRunId)}">查看 Replay</button><button type="button" class="text-button" data-trace-extra="compare" data-run-id="${escapeHtml(rootRunId)}">对比另一次运行</button><span class="run-trace-action-note">恢复和重试会再次校验能力、权限与快照。</span>`;
    actions.querySelectorAll("[data-run-action]").forEach((button) => button.addEventListener("click", () => runTraceAction(button.dataset.runAction, button.dataset.runId).catch((error) => toast(error.message, "error"))));
    actions.querySelectorAll("[data-trace-extra]").forEach((button) => button.addEventListener("click", () => runTraceExtra(button.dataset.traceExtra, button.dataset.runId).catch((error) => toast(error.message, "error"))));
  }
}

async function runTraceExtra(action, rootRunId) {
  if (action === "replay") {
    const fixture = await request(`/api/runs/${encodeURIComponent(rootRunId)}/replay`);
    const section = document.createElement("section");
    section.className = "run-trace-section run-trace-extra";
    section.innerHTML = `<h3>Replay Fixture</h3><pre class="log-output">${escapeHtml(JSON.stringify(fixture, null, 2))}</pre>`;
    document.getElementById("run-trace-content")?.prepend(section);
    return;
  }
  const other = String(window.prompt("输入要对比的另一个 root Run ID", "") || "").trim();
  if (!other) return;
  const result = await request("/api/runs/compare", { method: "POST", body: JSON.stringify({ rootRunIds: [rootRunId, other] }) });
  const comparison = result.comparison || {};
  const section = document.createElement("section");
  section.className = "run-trace-section run-trace-extra";
  section.innerHTML = `<h3>运行对比 <small>${escapeHtml(other)}</small></h3><pre class="log-output">${escapeHtml(JSON.stringify(comparison, null, 2))}</pre>`;
  document.getElementById("run-trace-content")?.prepend(section);
}

async function runTraceAction(action, rootRunId) {
  if (action === "cancel" && !window.confirm("确认取消当前运行？已完成的步骤不会回滚。")) return;
  const actions = document.getElementById("run-trace-actions");
  actions?.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  try {
    const result = await request(`/api/runs/${encodeURIComponent(rootRunId)}/${action}`, { method: "POST", body: "{}" });
    if (result?.code === "RUN_ENTRY_CONTEXT_REQUIRED") toast(`请从「${result.entryPoint || "原业务入口"}」提交恢复请求（resumeFrom=${result.resumeFrom}）`, "error");
    else { toast(action === "cancel" ? "取消请求已提交" : `${action === "resume" ? "恢复" : "重试"}预检完成`); await openRunTrace(rootRunId); }
  } catch (error) {
    if (error.data?.code === "RUN_ENTRY_CONTEXT_REQUIRED") toast(`请从「${error.data.entryPoint || "原业务入口"}」提交恢复请求（resumeFrom=${error.data.resumeFrom}）`, "error");
    else throw error;
  } finally { actions?.querySelectorAll("button").forEach((button) => { button.disabled = false; }); }
}

async function openRunTrace(rootRunId) {
  const id = String(rootRunId || "").trim();
  if (!id) return;
  const dialog = document.getElementById("run-trace-dialog");
  document.getElementById("run-trace-title").textContent = `运行详情 · ${id}`;
  document.getElementById("run-trace-subtitle").textContent = "正在加载持久化 Trace…";
  document.getElementById("run-trace-overview")?.replaceChildren();
  document.getElementById("run-trace-summary").replaceChildren();
  document.getElementById("run-trace-actions")?.replaceChildren();
  document.getElementById("run-trace-content").innerHTML = '<div class="empty-state">正在加载运行链路…</div>';
  if (!dialog.open) dialog.showModal();
  try {
    const encoded = encodeURIComponent(id);
    const [trace, metrics] = await Promise.all([request(`/api/runs/${encoded}`), request(`/api/runs/${encoded}/metrics`)]);
    renderRunTrace(trace, metrics, id);
  } catch (error) {
    document.getElementById("run-trace-content").innerHTML = `<div class="empty-state">运行 Trace 加载失败：${escapeHtml(error.message || String(error))}</div>`;
  }
}

function discussionOutputForDisplay(item) {
  const raw = String(item.output_text || '').trim();
  if (item.subtype !== 'discussion-research' || !raw) return { text: raw, raw: '' };
  const heading = raw.match(/^[ \t]*#[ \t]+事件研判报告[ \t]*$/mu);
  if (!heading) return { text: raw, raw: '' };
  const text = raw.slice(heading.index).trim();
  return { text, raw: text === raw ? '' : raw };
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
  const displayOutput = discussionOutputForDisplay(item);
  const rawOutputBlock = displayOutput.raw
    ? `<details class="log-raw-output"><summary>原始输出（已隐藏前置进度文本）</summary><pre class="log-output">${escapeHtml(displayOutput.raw)}</pre></details>`
    : "";
  const outputBlock = displayOutput.text
    ? `<pre class="log-output">${escapeHtml(displayOutput.text)}</pre>${rawOutputBlock}`
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
  const filteredLogs = logs.filter((item) => {
    if (currentLogStatus && String(item.status || "") !== currentLogStatus) return false;
    if (!currentLogQuery) return true;
    return `${item.id || ""} ${item.root_run_id || ""} ${item.workflow_run_id || ""} ${item.stage_id || ""} ${item.subtype || ""} ${item.message || ""}`.toLowerCase().includes(currentLogQuery);
  });
  document.getElementById("log-count").textContent = filteredLogs.length === logs.length ? `${logs.length} 条` : `${filteredLogs.length} / ${logs.length} 条`;
  const list = document.getElementById("log-list");
  const expandedDetails = new Set([...list.querySelectorAll("details[data-log-detail][open]")].map((detail) => detail.dataset.logDetail));
  list.innerHTML = filteredLogs.length
    ? filteredLogs.map((item) => {
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
        const providerDisplay=item.log_type === "model" ? (item.provider_display || [item.provider,item.model].filter(Boolean).join(" · ")) : item.provider;
        const traceButton = item.root_run_id ? `<button type="button" class="inline-button log-trace-button" data-open-run-trace="${escapeHtml(item.root_run_id)}">查看 Run Trace</button>` : "";
        return `<article class="log-entry ${sc}"><div class="log-head"><span class="log-type-badge">${tl}</span><time>${escapeHtml(ts)}</time>${item.batch_id ? `<span class="log-batch">${escapeHtml(item.batch_id)}</span>` : ""}<span class="log-status status-pill ${sc}">${escapeHtml(item.status)}</span></div><div class="log-body"><code>${escapeHtml(item.subtype || "")}</code>${body}</div>${providerDisplay ? `<div class="log-meta"><span>${item.log_type === "model" ? "供应商 / 模型" : "服务商"}：${escapeHtml(providerDisplay)}</span></div>` : ""}${traceButton ? `<div class="log-actions">${traceButton}</div>` : ""}${item.log_type === "model" ? renderModelDetail(item, logKey) : ""}</article>`;
      }).join("")
    : `<div class="empty-state">${logs.length ? "没有符合当前筛选条件的日志。" : "暂无日志记录。"}</div>`;
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
  loadLogGovernance().catch(() => {});
  return loadLogs(currentLogType);
}

export { openRunTrace };
