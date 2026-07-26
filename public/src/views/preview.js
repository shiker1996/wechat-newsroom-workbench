import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, providerOptions, withLoading } from "../core/ui.js";
import { state } from "../core/state.js";
import { reindex } from "./artifacts.js";
import { pollJob } from "./batch-drawer.js";
import { runTypeset } from "./editor.js";

let bound = false;
function bindPreview() {
  if (bound) return;
  bound = true;
  document.getElementById("typeset-candidate").addEventListener("change", (event) => {
    const id = Number(event.target.value);
    renderProductionCandidate(id);
    loadImageWorkspace(id).catch((error) => toast(error.message));
  });
  document.getElementById("refresh-preview").addEventListener("click", () => loadProductionPreview().catch((error) => toast(error.message)));
  document.getElementById("preview-reindex").addEventListener("click", async (event) => {
    await withLoading(event.currentTarget, "正在扫描…", () => reindex().catch((error) => toast(error.message)));
    await loadProductionPreview().catch((error) => toast(error.message));
  });
  document.getElementById("plan-article-images").addEventListener("click", (event) => withLoading(event.currentTarget, "正在分析…", () => planArticleImages().catch((error) => toast(error.message))));
  document.getElementById("run-local-typeset").addEventListener("click", (event) => withLoading(event.currentTarget, "正在排版…", () => runTypeset("local").catch((error) => toast(error.message))));
  document.getElementById("copy-typeset-html").addEventListener("click", (event) => withLoading(event.currentTarget, "正在复制…", () => copyTypesetHtml().catch((error) => toast(error.message))));
  document.addEventListener("click", (event) => {
    // 显式「上传 CDN」按钮：本地图片已就位时点击才产生外部写入
    const uploadCdnButton = event.target.closest("[data-upload-cdn]");
    if (uploadCdnButton) {
      uploadImageAsset(uploadCdnButton.dataset.uploadCdn).catch((error) => toast(error.message));
      return;
    }
    // 点击图片区域只打开文件选择器，选中后仅保存到本地
    const pickArea = event.target.closest("[data-upload-image]");
    if (pickArea && !event.target.matches("[data-image-file]")) {
      const card = pickArea.closest("[data-image-id]");
      card?.querySelector("[data-image-file]")?.click();
    }
  });
  // 图片文件选择后仅保存到本地，不自动上传 CDN（与页面文案承诺一致）
  document.addEventListener("change", (event) => {
    if (!event.target.matches("[data-image-file]")) return;
    const card = event.target.closest("[data-image-id]");
    if (!card) return;
    saveLocalImageAsset(card.dataset.imageId).catch((error) => toast(error.message));
  });
}

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
    <div class="image-slot-actions">${hasImage ? `<span class="muted">${item.status === "cdn" ? "已上传 CDN" : "本地已保存"}</span>` : ""}${item.status === "local" ? `<button class="ghost-button" data-upload-cdn="${escapeHtml(item.id)}">上传 CDN</button>` : ""}${item.status === "cdn" ? `<button class="ghost-button" data-upload-cdn="${escapeHtml(item.id)}">重新上传 CDN</button>` : ""}</div>
    ${item.url ? `<a class="image-cdn-url" href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.url)}</a>` : ""}
  </article>`;
}

function renderImageWorkspace() {
  const data = state.imageWorkspace;
  if (!data) return;
  const status = document.getElementById('image-stage-status');
  const button = document.getElementById('plan-article-images');
  if (button) button.textContent = data.planned ? '重新检查必要配图' : 'AI 规划必要配图';
  if (status) {
    if (!data.planned) status.textContent = '尚未执行配图规划；正式排版前需要先确认是否存在必要图片。';
    else if (!data.total) status.textContent = '配图规划完成：本文没有必须人工提供的来源图或资料图。';
    else status.textContent = '配图就绪 ' + (data.ready||0) + ' / ' + data.total + ((data.unresolved||[]).length ? ' · 待处理 ' + (data.unresolved||[]).join('、') : ' · 可以进入正式排版');
  }
  const list = document.getElementById('image-slot-list');
  if (list) {
    list.innerHTML = data.items && data.items.length
      ? data.items.map(imageCard).join('')
      : '<div class="image-stage-empty">' + (data.planned ? '没有必要的人工配图，文章可直接排版。' : '点击“AI 规划必要配图”，系统只会为有证据或阅读价值的图片留位。') + '</div>';
  }
  var hasCandidate = Boolean(state.productionPreview?.candidates?.length);
  var btn = document.getElementById('run-local-typeset');
  if (btn) {
    btn.disabled = !hasCandidate || !data.planned || (data.unresolved||[]).length > 0;
    btn.title = !hasCandidate ? '请先运行完整成稿链' : !data.planned ? '请先点击「AI 规划必要配图」' : (data.unresolved||[]).length ? '以下图片待上传：' + (data.unresolved||[]).join('、') : '生成公众号排版 HTML';
  }
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
  const names = new Set(artifacts.map((a) => a.name));
  const steps = [['article-brief.md','锁定文章简报'],['09-FINAL.md','文章终稿'],['magazine-design-tokens.json','杂志设计'],['article.ai.draft.html','HTML 初稿'],['article.ai.html','门禁后 HTML']];
  const cl = document.getElementById('production-checklist');
  if (cl) cl.innerHTML = '<span class="kicker">PIPELINE GATES</span><h3>生产门禁</h3>' + steps.map(([name,label]) => '<div class="production-step ' + (names.has(name)?'done':'') + '"><i></i><div><b>' + label + '</b><small>' + (names.has(name)?'已生成':'缺少 ' + name) + '</small></div></div>').join('');
  const htmlArtifact = artifacts.find((a) => a.name === 'article.ai.html');
  const proofEmpty = document.getElementById('proof-empty');
  const proofFrame = document.getElementById('proof-frame');
  if (proofEmpty) proofEmpty.hidden = Boolean(htmlArtifact);
  if (proofFrame) proofFrame.hidden = !htmlArtifact;
  if (proofFrame) proofFrame.src = htmlArtifact ? '/api/artifacts/' + htmlArtifact.id + '/content?preview=phone&v=' + encodeURIComponent(htmlArtifact.modified_at) : 'about:blank';
  const copyBtn = document.getElementById('copy-typeset-html');
  if (copyBtn) copyBtn.disabled = !htmlArtifact;
  const status = document.getElementById('typeset-status');
  if (status) {
    status.classList.toggle('ready', Boolean(htmlArtifact));
    status.textContent = htmlArtifact ? candidate.candidate_id + ' 的排版 HTML 已就绪，可以直接复制到公众号编辑器。' : (candidate.candidate_id || '当前文章') + ' 尚未生成排版 HTML。';
  }
  const deliveries = artifacts.filter((a) => ['09-FINAL.md','article.ai.html'].includes(a.name));
  const dl = document.getElementById('delivery-links');
  if (dl) dl.innerHTML = deliveries.length ? deliveries.map((item) => '<div class="delivery-item"><small>' + escapeHtml(item.kind) + '</small><a href="/api/artifacts/' + item.id + '/content" target="_blank">' + escapeHtml(item.name) + '</a></div>').join('') : '<div class="empty-state">尚无可交付文件</div>';
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
  const statusEl = document.getElementById("typeset-status");
  if (statusEl && !ready.length) statusEl.innerHTML = '还没有终稿（09-FINAL.md），请先到 <a href="#editor">文章编辑器</a> 保存终稿。';
  const btn = document.getElementById("run-local-typeset");
  if (btn) btn.disabled = !ready.length;
  state.productionPreview = { batch, artifacts, candidates: ready };
  // 渲染对象必须与下拉选中项一致（此前写死 ready[0]，下拉显示 B、内容却是 A）
  const selectedId = Number(select?.value) || ready[0]?.id;
  if (ready.length) {
    renderProductionCandidate(selectedId);
    loadImageWorkspace(selectedId);
  }
}

async function loadImageWorkspace(candidateId) {
  const stage = document.getElementById('image-stage');
  if (!candidateId) { state.imageWorkspace = null; if(stage)stage.hidden = true; document.getElementById('run-local-typeset') && (document.getElementById('run-local-typeset').disabled = true); return; }
  if (stage) stage.hidden = false;
  try {
    const ws = await request('/api/candidates/' + candidateId + '/images');
    state.imageWorkspace = Object.assign({}, ws, {candidateId:candidateId});
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

// 选中图片后仅保存到本地，不产生外部写入；上传 CDN 由「上传 CDN」按钮显式触发
async function saveLocalImageAsset(id) {
  const card = imageSlot(id);
  if (!card) return;
  const file = card.querySelector("[data-image-file]")?.files?.[0];
  if (!file) return;
  const status = card.querySelector(".image-slot-status");
  if (status) status.textContent = "正在保存到本地…";
  try {
    const payload = { fileName: file.name, mimeType: file.type, base64: await fileAsDataUrl(file) };
    await request(`/api/candidates/${state.imageWorkspace.candidateId}/images/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(payload) });
    await loadImageWorkspace(state.imageWorkspace.candidateId);
    toast(`${id} 已保存到本地，点击「上传 CDN」才会同步到图床`);
  } catch (error) {
    if (status?.isConnected) status.textContent = "本地待上传";
    toast(error.message);
  }
}

// 显式上传 CDN：服务端从已保存的本地图片读取，无需前端再传文件
async function uploadImageAsset(id) {
  const card = imageSlot(id);
  if (!card) return;
  const status = card.querySelector(".image-slot-status");
  if (status) status.textContent = "正在上传 CDN…";
  try {
    await request(`/api/candidates/${state.imageWorkspace.candidateId}/images/${encodeURIComponent(id)}/cdn`, { method: "POST", body: "{}" });
    await loadImageWorkspace(state.imageWorkspace.candidateId);
    toast(`${id} 已上传 CDN`);
  } catch (error) {
    if (status?.isConnected) status.textContent = "本地待上传";
    toast(error.message);
  }
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
  const frame = document.getElementById("proof-frame");
  if (!frame || frame.hidden || !frame.src || frame.src === "about:blank") return toast("没有可复制的排版 HTML");
  try {
    const response = await fetch(frame.src, { credentials:"same-origin", cache:"no-store" });
    if (!response.ok) throw new Error(`读取排版 HTML 失败：HTTP ${response.status}`);
    const html = await response.text();
    if (!html.trim()) throw new Error("排版 HTML 为空");
    const plain = new DOMParser().parseFromString(html, "text/html").body?.innerText || "";
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type:"text/html" }),
        "text/plain": new Blob([plain], { type:"text/plain" }),
      })]);
    } else {
      const body = frame.contentDocument?.body;
      if (!body) throw new Error("浏览器不支持富文本剪贴板");
      const range = document.createRange();
      range.selectNodeContents(body);
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand("copy")) throw new Error("浏览器拒绝复制");
      selection.removeAllRanges();
    }
    toast("公众号富文本已复制，直接粘贴到公众号编辑器即可");
  } catch (error) { toast(`复制失败：${error.message}`); }
}

async function openProductionJob(id) {
  const dialog = document.getElementById("production-job-dialog");
  if (!dialog) return;
  dialog.showModal();
  pollJob(id);
}

// batch-drawer 的排版完成跳转依赖这两个桥接
window.renderProductionCandidate = renderProductionCandidate;
window.loadImageWorkspace = loadImageWorkspace;

export default async function loadProductionPreviewView() {
  bindPreview();
  return loadProductionPreview();
}
