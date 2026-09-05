import { request } from "../core/http.js";
import { escapeHtml, toast, providerOptions } from "../core/ui.js";
import { state } from "../core/state.js";

let bound = false;
let modelCalls = [];
let modelCallQuery = "";
let modelCallStatus = "";

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return fallback; }
}

function modelCallDetails(call) {
  const toolCalls = parseJson(call.tool_calls_json, []);
  const budget = parseJson(call.output_budget_json, null);
  const meta = [
    call.provider && `供应商：${call.provider}`,
    call.model && `模型：${call.model}`,
    call.stage_id && `阶段：${call.stage_id}`,
    call.root_run_id && `运行 ID：${call.root_run_id}`,
    call.prompt_tokens != null && `prompt ${call.prompt_tokens}`,
    call.completion_tokens != null && `completion ${call.completion_tokens}`,
    call.reasoning_tokens != null && `reasoning ${call.reasoning_tokens}`,
    call.latency_ms != null && `耗时 ${call.latency_ms}ms`,
    `压缩：${call.compressed ? "是" : "否"}`,
  ].filter(Boolean).map((item) => `<span>${escapeHtml(item)}</span>`).join("");
  const output = String(call.output_text || "").trim();
  const reasoning = String(call.reasoning_text || "").trim();
  return `<details class="model-call-details"><summary>调用详情</summary><div class="log-meta log-model-meta">${meta}</div>${output ? `<h4 class="model-call-detail-title">文本输出</h4><pre class="log-output">${escapeHtml(output)}</pre>` : ""}${reasoning ? `<details class="log-reasoning"><summary>推理过程</summary><pre class="log-output">${escapeHtml(reasoning)}</pre></details>` : ""}${Array.isArray(toolCalls) && toolCalls.length ? `<details class="log-tool-calls"><summary>原生工具调用（${toolCalls.length}）</summary><pre class="log-output">${escapeHtml(JSON.stringify(toolCalls, null, 2))}</pre></details>` : ""}${budget ? `<details class="log-budget"><summary>输出预算</summary><pre class="log-output">${escapeHtml(JSON.stringify(budget, null, 2))}</pre></details>` : ""}</details>`;
}

function renderModelCalls() {
  const list = document.getElementById("model-call-list");
  if (!list) return;
  const query = modelCallQuery.toLowerCase();
  const filtered = modelCalls.filter((call) => {
    if (modelCallStatus && String(call.status || "") !== modelCallStatus) return false;
    if (!query) return true;
    return [call.provider, call.model, call.purpose, call.stage_id, call.root_run_id, call.workflow_run_id, call.output_text, call.error]
      .filter(Boolean).join(" ").toLowerCase().includes(query);
  });
  const summary = document.getElementById("call-summary");
  if (summary) summary.textContent = filtered.length === modelCalls.length ? `最近 ${modelCalls.length} 次调用` : `${filtered.length} / ${modelCalls.length} 次调用`;
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">${modelCalls.length ? "没有符合当前筛选条件的模型调用。" : "尚无模型调用记录。"}</div>`;
    return;
  }
  list.innerHTML = filtered.map((call) => {
    const status = String(call.status || "unknown");
    const sc = status === "completed" ? "ok" : status === "failed" || status === "error" ? "bad" : "";
    const time = String(call.created_at || "").replace("T", " ").replace(/\.\d{3}Z$/, "").replace(/Z$/, "");
    const tokenSummary = `${call.prompt_tokens ?? "—"} / ${call.completion_tokens ?? "—"} tok`;
    return `<article class="model-call-entry ${sc}"><div class="call-row"><b>${escapeHtml(call.provider || "模型")}</b><span>${escapeHtml(call.purpose || call.stage_id || "未命名调用")}</span><span class="${sc}">${escapeHtml(status)}</span><span>${escapeHtml(tokenSummary)}</span><time>${escapeHtml(time)}</time></div>${modelCallDetails(call)}</article>`;
  }).join("");
}

function bindModels() {
  if (bound) return;
  bound = true;
  document.getElementById("test-model").addEventListener("click", () => testModel().catch((error) => toast(error.message, "error")));
  document.getElementById("model-call-query")?.addEventListener("input", (event) => { modelCallQuery = String(event.target.value || "").trim(); renderModelCalls(); });
  document.getElementById("model-call-status")?.addEventListener("change", (event) => { modelCallStatus = String(event.target.value || ""); renderModelCalls(); });
  document.getElementById("model-call-refresh")?.addEventListener("click", () => loadModels().then(() => toast("模型调用记录已刷新")).catch((error) => toast(error.message, "error")));
}

async function loadModels() {
  const data = await request("/api/models");
  state.models = data;
  window.__models = data;
  const providerSelect = document.getElementById("model-provider");
  if (providerSelect) providerSelect.innerHTML = providerOptions(data.defaultProvider || data.providers?.find((p) => p.configured)?.name);
  const available=(data.providers||[]).filter((provider)=>provider.enabled!==false&&provider.configured);
  modelCalls = Array.isArray(data.calls) ? data.calls : [];
  renderModelCalls();
  if (!available.length) {
    document.getElementById("model-cards").innerHTML = '<div class="empty-state">暂无可用模型。请前往“运行与配置 → 模型接入”完成配置。</div>';
    return;
  }
  const grid = document.getElementById("model-cards");
  grid.innerHTML = available
    .map((p) => {
      const ok = p.configured;
      return `<article class="model-card configured ${p.name===data.defaultProvider?"default":""}">
        <span class="status-pill ${ok ? "ok" : "bad"}">${p.enabled===false?"已停用":ok ? "已配置" : "缺少 Key"}</span>
        <h3>${escapeHtml(p.label)}</h3>
        <code>${escapeHtml(p.model)}</code>
        <dl><dt>Base URL</dt><dd>${escapeHtml(p.baseUrl)}</dd><dt>上下文窗口</dt><dd>${Math.round(p.contextWindow / 1024)}K</dd><dt>最大输出</dt><dd>${p.maxOutputTokens ?? "默认"}</dd></dl>
      </article>`;
    }).join("");
}
async function testModel() {
  const provider = document.getElementById("model-provider")?.value;
  if (!provider) return toast("请选择要测试的服务商");
  const btn = document.getElementById("test-model");
  if (btn) { btn.disabled = true; btn.textContent = "测试中…"; }
  try {
    const result = await request("/api/models/test", { method: "POST", body: JSON.stringify({ provider }) });
    toast(`${result.provider} · ${result.model} · 连接成功 (${result.latencyTokens?.completion_tokens || 0} tokens)`);
  } catch (err) {
    toast(`测试失败：${err.message}`, "error");
  } finally { if (btn) { btn.disabled = false; btn.textContent = "测试连接"; } }
}

export default async function loadModelsView() {
  bindModels();
  return loadModels();
}
