import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, providerOptions, withLoading } from "../core/ui.js";
import { state } from "../core/state.js";

let bound = false;
function bindModels() {
  if (bound) return;
  bound = true;
  document.getElementById("test-model").addEventListener("click", () => testModel().catch((error) => toast(error.message)));
  document.getElementById("ai-tag-batch").addEventListener("click", (event) => {
    withLoading(event.currentTarget, "正在打标…", () => aiTagBatch().catch((error) => toast(error.message)));
  });
}

async function loadModels() {
  const data = await request("/api/models");
  state.models = data;
  window.__models = data;
  const providerSelect = document.getElementById("model-provider");
  if (providerSelect) providerSelect.innerHTML = providerOptions(data.providers?.find((p) => p.configured)?.name || data.defaultProvider);
  if (!data.providers?.length) {
    document.getElementById("model-cards").innerHTML = '<div class="empty-state">暂无已配置的模型服务商。请编辑 .env 文件后重启工作台。</div>';
    return;
  }
  const grid = document.getElementById("model-cards");
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
  const provider = document.getElementById("model-provider")?.value;
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

// AI 打标当前批次（自 editor.js 迁入，读取 #tag-limit；后台任务经 main.js 轮询通知结果）
async function aiTagBatch() {
  const provider = document.getElementById("model-provider")?.value || state.models?.defaultProvider;
  if (!provider) return toast("请先在模型中心配置至少一个服务商");
  if (!state.activeBatchId) return toast("请先选择一个批次");
  const force = confirm("重新打标将覆盖本批次全部已有语义标注，是否继续？");
  const limit = Number(document.getElementById("tag-limit")?.value) || undefined;
  try {
    await request(`/api/batches/${encodeURIComponent(state.activeBatchId)}/ai/tag`, {
      method: "POST", body: JSON.stringify({ provider, background: true, force, limit }),
    });
    toast(force ? "重新打标已启动" : "打标任务已启动");
  } catch (err) { toast(err.message); }
}
export default async function loadModelsView() {
  bindModels();
  return loadModels();
}
