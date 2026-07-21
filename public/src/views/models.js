import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, providerOptions } from "../core/ui.js";
import { state } from "../core/state.js";

async function loadModels() {
  const data = await request("/api/models");
  state.models = data;
  window.__models = data;
  if (!data.providers?.length) {
    document.getElementById("model-grid").innerHTML = '<div class="empty-state">暂无已配置的模型服务商。请编辑 .env 文件后重启工作台。</div>';
    return;
  }
  const grid = document.getElementById("model-grid");
  grid.innerHTML = data.providers
    .map((p) => {
      const ok = p.configured;
      return `<div class="model-card ${ok ? "configured" : "missing"}">
        <span class="status-pill ${ok ? "ok" : "bad"}">${ok ? "已配置" : "未配置"}</span>
        <h3>${escapeHtml(p.label)}</h3>
        <code>${escapeHtml(p.model)}</code>
        <dl><dt>上下文窗口</dt><dd>${(p.contextWindow / 1024).toFixed(0)}K</dd><dt>最大输出</dt><dd>${p.maxOutputTokens}</dd></dl>
      </div>`;
    }).join("");
  document.getElementById("call-summary").textContent = `最近 ${data.calls?.length || 0} 次调用`;
  const list = document.getElementById("model-call-list");
  if (data.calls?.length) {
    list.innerHTML = data.calls.map((c) => {
      const sc = c.status === "completed" ? "ok" : c.status === "failed" ? "bad" : "";
      return `<div class="call-row"><b>${escapeHtml(c.provider)}</b><span>${escapeHtml(c.purpose || "")}</span><span class="${sc}">${escapeHtml(c.status)}</span><span>${c.completion_tokens ?? "-"} tok</span><time>${(c.created_at || "").slice(11, 19)}</time></div>`;
    }).join("");
  } else {
    list.innerHTML = '<div class="empty-state">尚无模型调用记录。</div>';
  }
}
async function testModel() {
  const provider = document.getElementById("model-test-provider")?.value;
  if (!provider) return toast("请选择要测试的服务商");
  const btn = document.getElementById("test-model");
  if (btn) { btn.disabled = true; btn.textContent = "测试中…"; }
  try {
    const result = await request("/api/models/test", { method: "POST", body: JSON.stringify({ provider }) });
    toast(`${result.provider} · ${result.model} · 连接成功 (${result.latencyTokens?.completion_tokens || 0} tokens)`);
  } catch (err) {
    toast(`测试失败：${err.message}`);
  } finally { if (btn) { btn.disabled = false; btn.textContent = "测试连接"; } }
}
window.testModel = testModel;
export default loadModels;