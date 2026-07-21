import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, providerOptions } from "../core/ui.js";
import { state } from "../core/state.js";

function imageSlot(id) { return document.querySelector(`[data-image-id="${CSS.escape(id)}"]`); }

function imageCard(item) {
  const encoded = encodeURIComponent(item.id);
  const statusLabel = item.status === "cdn" ? "CDN 已就绪" : item.status === "local" ? "本地待上传" : "等待供图";
  const preview = item.localPath
    ? `<img src="/api/candidates/${state.imageWorkspace.candidateId}/images/${encoded}/local?v=${encodeURIComponent(item.updatedAt || "")}" alt="${escapeHtml(item.content)}">`
    : `<span>${escapeHtml(item.ratio)}<br>点击选择图片</span>`;
  const hasImage = !!item.localPath;
  return `<article class="image-slot ${item.status === "cdn" ? "ready" : item.status === "local" ? "local" : ""}" data-image-id="${escapeHtml(item.id)}">
    <div class="image-slot-top"><span class="image-slot-id">${escapeHtml(item.id)} · ${escapeHtml(item.type)}</span><span class="image-slot-status">${statusLabel}</span></div>
    <h4>${escapeHtml(item.content)}</h4>
    <div class="image-slot-body"><div class="image-contact-sheet" data-upload-image="${escapeHtml(item.id)}" style="cursor:pointer">${preview}
      <input class="image-slot-file" data-image-file type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
    </div></div>
    <div class="image-slot-meta"><span>位置：${escapeHtml(item.position)}</span><span>比例：${escapeHtml(item.ratio)}</span><span>建议来源：${escapeHtml(item.suggestedSource)}</span></div>
    <div class="image-slot-actions">${hasImage ? `<span class="muted">${item.status === "cdn" ? "已上传 CDN" : "本地已保存"}</span>` : ""}${item.status === "cdn" ? `<button class="ghost-button" data-upload-image="${escapeHtml(item.id)}">重新上传</button>` : ""}</div>
    ${item.url ? `<a class="image-cdn-url" href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.url)}</a>` : ""}
  </article>`;
}

function renderImageWorkspace() {
  const ws = state.imageWorkspace;
  if (!ws) { document.getElementById("image-stage").innerHTML = '<div class="empty-state">尚未规划配图。</div>'; return; }
  const stage = document.getElementById("image-stage");
  if (!stage) return;
  const planned = ws.images?.planned || [];
  stage.innerHTML = planned.length
    ? planned.map(imageCard).join("")
    : '<div class="image-stage-empty">暂无配图规划。点击「AI 规划配图」生成占位。</div>';
  const note = document.getElementById("image-stage-note");
  if (note) note.textContent = "点击图片区域选择本地文件，选图后自动保存并上传 CDN。";
}

function candidateArtifacts(candidate) {
  if (!state.productionPreview) return [];
  const cid = candidate.candidate_id.toLowerCase();
  const bd = state.productionPreview.batch.batch_date.toLowerCase();
  return state.productionPreview.artifacts.filter((item) => {
    const fp = String(item.file_path || "").replaceAll("\\", "/").toLowerCase();
    return fp.includes(bd) && fp.includes(cid);
  });
}

function renderProductionCandidate(candidateId) {
  const pp = state.productionPreview;
  if (!pp) return;
  const candidate = pp.candidates.find((c) => c.id === Number(candidateId));
  if (!candidate) return;
  const artifacts = candidateArtifacts(candidate);
  const htmlArtifact = artifacts.find((a) => a.name === "article.ai.html");
  const finalArtifact = artifacts.find((a) => a.name === "09-FINAL.md");
  const status = document.getElementById("typeset-status");
  if (status) status.textContent = htmlArtifact ? `${candidate.candidate_id} 的排版 HTML 已就绪，可以直接复制到公众号编辑器。` : `${candidate.candidate_id || "当前文章"} 尚未生成排版 HTML。`;
  const deliveries = artifacts.filter((a) => ["09-FINAL.md", "article.ai.html"].includes(a.name));
  const dl = document.getElementById("delivery-links");
  if (dl) dl.innerHTML = deliveries.length
    ? deliveries.map((item) => `<div class="delivery-item"><small>${escapeHtml(item.kind)}</small><a href="/api/artifacts/${item.id}/content" target="_blank">${escapeHtml(item.name)}</a></div>`).join("")
    : '<div class="empty-state">尚无可交付文件</div>';
}

async function loadProductionPreview() {
  const batch = state.batches.find((b) => b.id === state.activeBatchId);
  if (!batch) return;
  const prevId = Number(document.getElementById("typeset-candidate")?.value);
  const [allArtifacts, candidates, documents] = await Promise.all([
    request("/api/artifacts?limit=500"),
    request(`/api/batches/${encodeURIComponent(batch.id)}/candidates`),
    request(`/api/batches/${encodeURIComponent(batch.id)}/documents`),
  ]);
  const artifacts = allArtifacts.filter((item) => item.batch_id === batch.id);
  const finalIds = new Set(documents.filter((d) => d.kind === "final").map((d) => d.candidate_row_id));
  const ready = candidates.filter((c) => finalIds.has(c.id));
  const select = document.getElementById("typeset-candidate");
  if (select) {
    select.innerHTML = ready.length
      ? ready.map((item) => `<option value="${item.id}">${escapeHtml(item.candidate_id)} · ${escapeHtml(item.hotspot_title)}</option>`).join("")
      : '<option value="">缺少 09-FINAL.md</option>';
    const selected = ready.find((c) => c.id === prevId) || ready[0] || null;
    select.value = selected ? String(selected.id) : "";
    select.disabled = !ready.length;
  }
  const prov = document.getElementById("typeset-provider");
  if (prov) prov.innerHTML = providerOptions(state.models?.defaultProvider || "");
  const btn = document.getElementById("run-local-typeset");
  if (btn) btn.disabled = !ready.length;
  state.productionPreview = { batch, artifacts, candidates: ready };
  if (ready.length) {
    renderProductionCandidate(ready[0].id);
    loadImageWorkspace(ready[0].id);
  }
}

async function loadImageWorkspace(candidateId) {
  try {
    const ws = await request(`/api/candidates/${candidateId}/images`);
    state.imageWorkspace = ws;
    renderImageWorkspace();
  } catch { state.imageWorkspace = null; }
}

async function planArticleImages() {
  const candidateId = Number(document.getElementById("typeset-candidate")?.value);
  if (!candidateId) return toast("请先选择一个候选");
  const provider = document.getElementById("typeset-provider")?.value || state.models?.defaultProvider;
  try {
    const result = await request(`/api/candidates/${candidateId}/images/plan`, { method: "POST", body: JSON.stringify({ provider }) });
    toast("配图占位已生成");
    await loadImageWorkspace(candidateId);
  } catch (err) { toast(err.message); }
}

async function saveImageAsset(id) {
  const card = imageSlot(id);
  if (!card) return;
  const file = card.querySelector("[data-image-file]")?.files?.[0];
  if (!file) return toast("请先选择图片文件");
  const payload = { fileName: file.name, mimeType: file.type, base64: await fileAsDataUrl(file) };
  await request(`/api/candidates/${state.imageWorkspace.candidateId}/images/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(payload) });
  await loadImageWorkspace(state.imageWorkspace.candidateId);
  await uploadImageAsset(id);
}

async function uploadImageAsset(id) {
  const card = imageSlot(id);
  if (!card) return;
  const fileInput = card.querySelector("[data-image-file]");
  const file = fileInput?.files?.[0];
  if (!file) { fileInput?.click(); return; }
  const btn = card.querySelector("[data-upload-image]");
  if (btn) { btn.disabled = true; btn.textContent = "正在上传…"; }
  try {
    const payload = { fileName: file.name, mimeType: file.type, base64: await fileAsDataUrl(file) };
    await request(`/api/candidates/${state.imageWorkspace.candidateId}/images/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(payload) });
    await request(`/api/candidates/${state.imageWorkspace.candidateId}/images/${encodeURIComponent(id)}/cdn`, { method: "POST", body: "{}" });
    await loadImageWorkspace(state.imageWorkspace.candidateId);
    toast(`${id} 已上传 CDN`);
  } finally { if (btn) btn.disabled = false; }
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function copyTypesetHtml() {
  const html = document.getElementById("typeset-html")?.textContent;
  if (!html) return toast("没有可复制的排版 HTML");
  try {
    await navigator.clipboard.writeText(html);
    toast("公众号富文本已复制，直接粘贴到公众号编辑器即可");
  } catch { toast("复制失败，请手动选中内容后复制"); }
}

async function openProductionJob(id) {
  const dialog = document.getElementById("production-job-dialog");
  if (!dialog) return;
  dialog.showModal();
  pollJob(id);
}

window.loadProductionPreview = loadProductionPreview;
window.renderProductionCandidate = renderProductionCandidate;
window.loadImageWorkspace = loadImageWorkspace;
window.planArticleImages = planArticleImages;
window.copyTypesetHtml = copyTypesetHtml;
window.openProductionJob = openProductionJob;

export default loadProductionPreview;