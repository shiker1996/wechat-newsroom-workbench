import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, providerOptions, withLoading, confirmAction } from "../core/ui.js";
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
  const available=(data.providers||[]).filter((provider)=>provider.enabled!==false&&provider.configured);
  if (!available.length) {
    document.getElementById("model-cards").innerHTML = '<div class="empty-state">暂无可用模型。请前往“运行配置 → 模型服务”完成配置。</div>';
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
        <dl><dt>Base URL</dt><dd>${escapeHtml(p.baseUrl)}</dd><dt>上下文窗口</dt><dd>${Math.round(p.contextWindow / 1024)}K</dd><dt>最大输出</dt><dd>${p.maxOutputTokens}</dd></dl>
      </article>`;
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
  // 确认=强制覆盖重打；取消=中止操作（此前取消会变成"非强制继续"，语义被篡改）
  if (!await confirmAction("重新打标将覆盖本批次全部已有语义标注，是否继续？", { confirmText: "重新打标" })) return;
  const limit = Number(document.getElementById("tag-limit")?.value) || undefined;
  try {
    await request(`/api/batches/${encodeURIComponent(state.activeBatchId)}/ai/tag`, {
      method: "POST", body: JSON.stringify({ provider, background: true, force: true, limit }),
    });
    toast("重新打标已启动");
  } catch (err) { toast(err.message); }
}
export default async function loadModelsView() {
  bindModels();
  return loadModels();
}
