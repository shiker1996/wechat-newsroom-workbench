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
    const id = event.target.value;
    renderProductionCandidate(id);
    loadImageWorkspace(id).catch((error) => toast(error.message));
  });
  // 「生成文章封面图」引导：带着当前选中的文章跳转到封面页（state.coverCandidateId 由封面页消费）
  document.getElementById("goto-cover").addEventListener("click", () => {
    state.coverCandidateId = document.getElementById("typeset-candidate")?.value || null;
    window.go("cover");
  });
  document.getElementById("refresh-preview").addEventListener("click", () => loadProductionPreview().catch((error) => toast(error.message)));
  document.addEventListener("typeset:completed", () => {
    loadProductionPreview().catch((error) => toast(error.message));
  });
  document.getElementById("preview-reindex").addEventListener("click", async (event) => {
    await withLoading(event.currentTarget, "正在扫描…", () => reindex().catch((error) => toast(error.message)));
    await loadProductionPreview().catch((error) => toast(error.message));
  });
  document.getElementById("plan-article-images").addEventListener("click", (event) => withLoading(event.currentTarget, "正在分析…", () => planArticleImages().catch((error) => toast(error.message))));
  document.getElementById("run-local-typeset").addEventListener("click", (event) => {
    const blocked = typesetBlockReason();
    if (blocked) { toast(blocked); return; }
    withLoading(event.currentTarget, "正在排版…", () => runTypeset("local").catch((error) => toast(error.message)));
  });
  document.getElementById("copy-typeset-html").addEventListener("click", (event) => withLoading(event.currentTarget, "正在复制…", () => copyTypesetHtml().catch((error) => toast(error.message))));
  document.addEventListener("click", (event) => {
    // 显式「上传 CDN」按钮：本地图片已就位时点击才产生外部写入
    const uploadCdnButton = event.target.closest("[data-upload-cdn]");
    if (uploadCdnButton) {
      uploadImageAsset(uploadCdnButton.dataset.uploadCdn).catch((error) => toast(error.message));
      return;
    }
    // 「生成图片」：可生成占位调用确定性生成链，仅产出本地 PNG，不自动上传
    const generateButton = event.target.closest("[data-generate-image]");
    if (generateButton) {
      const card = generateButton.closest("[data-image-id]");
      card?.classList.add("generating");
      withLoading(generateButton, "正在生成…", () => generateImageAsset(generateButton.dataset.generateImage).catch((error) => {
        card?.classList.remove("generating");
        toast(error.message);
      }));
      return;
    }
    // 点击图片区域只打开文件选择器，选中后仅保存到本地
    const manualPick = event.target.closest("[data-manual-pick]");
    if (manualPick) {
      const card = manualPick.closest("[data-image-id]");
      card?.querySelector("[data-image-file]")?.click();
      return;
    }
    // 可生成空态：点击占位区直接触发生成（生成中禁用，防止重复点击）
    const generateTrigger = event.target.closest("[data-generate-trigger]");
    if (generateTrigger) {
      const card = generateTrigger.closest("[data-image-id]");
      card?.classList.add("generating");
      generateImageAsset(generateTrigger.dataset.generateTrigger).catch((error) => {
        card?.classList.remove("generating");
        toast(error.message);
      });
      return;
    }
    // 已生成的图片点击放大查看，替换图片仍可拖拽到卡片上
    const zoomImage = event.target.closest("[data-zoom-image]");
    if (zoomImage) {
      openImageZoom(zoomImage.src, zoomImage.alt);
      return;
    }
    const pickArea = event.target.closest("[data-upload-image]");
    if (pickArea && !event.target.matches("[data-image-file]") && !event.target.closest("[data-generate-trigger],[data-zoom-image]")) {
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
  document.addEventListener("dragover", (event) => {
    const dropZone = event.target.closest("[data-upload-image]");
    if (!dropZone) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    dropZone.classList.add("drag-active");
  });
  document.addEventListener("dragleave", (event) => {
    const dropZone = event.target.closest("[data-upload-image]");
    if (dropZone && !dropZone.contains(event.relatedTarget)) dropZone.classList.remove("drag-active");
  });
  document.addEventListener("drop", (event) => {
    const dropZone = event.target.closest("[data-upload-image]");
    if (!dropZone) return;
    event.preventDefault();
    dropZone.classList.remove("drag-active");
    const card = dropZone.closest("[data-image-id]");
    const file = event.dataTransfer?.files?.[0];
    if (!card || !file) return;
    saveLocalImageAsset(card.dataset.imageId, file).catch((error) => toast(error.message));
  });
}

function imageSlot(id) { return document.querySelector(`[data-image-id="${CSS.escape(id)}"]`); }
function imageApiBase() {
  return state.imageWorkspace?.daily
    ? `/api/batches/${encodeURIComponent(state.activeBatchId)}/daily/images`
    : `/api/candidates/${state.imageWorkspace.candidateId}/images`;
}

function imageCard(item) {
  const encoded = encodeURIComponent(item.id);
  const generatable = Boolean(item.generate);
  const hasImage = !!item.localPath;
  const statusLabel = item.status === "cdn" ? "CDN 已就绪" : item.generated && !generatable ? "排版时自动上传" : hasImage ? "本地待上传" : generatable ? "等待生成" : "等待供图";
  const fileInput = item.generated && !generatable ? '' : '<input class="image-slot-file" data-image-file type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>';
  let preview;
  if (hasImage) {
    preview = `<img src="${imageApiBase()}/${encoded}/local?v=${encodeURIComponent(item.updatedAt || "")}" alt="${escapeHtml(item.content)}" data-zoom-image title="点击放大查看；拖拽图片到此处可替换">`;
  } else if (generatable) {
    // 可生成空态：占位区本身是主行动按钮，手动供图降级为次级文字入口
    preview = `<div class="generate-empty" data-generate-trigger="${escapeHtml(item.id)}" role="button" tabindex="0" title="点击生成，或把图片拖到这里手动供图">
      <span class="generate-empty-mark">✦</span>
      <span class="generate-empty-label">生成图片</span>
      <span class="generate-empty-hint">${escapeHtml(item.ratio)} · <span class="generate-empty-manual" data-manual-pick>手动供图</span></span>
    </div>`;
  } else {
    preview = `<span>${escapeHtml(item.ratio)}<br>点击选择图片</span>`;
  }
  const cdnAllowed = !item.generated || generatable;
  const uploadTarget = item.generated && !generatable ? '' : ` data-upload-image="${escapeHtml(item.id)}"`;
  const cardClass = item.status === "cdn" ? "ready" : hasImage ? "local" : generatable ? "generatable" : "";
  return `<article class="image-slot ${cardClass}" data-image-id="${escapeHtml(item.id)}">
    <div class="image-slot-top"><span class="image-slot-tags"><span class="image-slot-id">${escapeHtml(item.id)} · ${escapeHtml(item.type)}</span>${generatable ? '<span class="image-slot-kind">✦ 可生成</span>' : ""}</span><span class="image-slot-status">${statusLabel}</span></div>
    <h4>${escapeHtml(item.content)}</h4>
    <div class="image-slot-body"><div class="image-contact-sheet"${uploadTarget}>${preview}
      ${fileInput}
    </div></div>
    <div class="image-slot-meta"><span>位置：${escapeHtml(item.position)}</span><span>比例：${escapeHtml(item.ratio)}</span><span>建议来源：${escapeHtml(item.suggestedSource)}</span></div>
    <div class="image-slot-actions">${generatable && item.status !== "cdn" && hasImage ? `<button class="outline-button" data-generate-image="${escapeHtml(item.id)}">重新生成图片</button>` : ""}${hasImage ? `<span class="muted">${item.status === "cdn" ? "已上传 CDN" : item.generated && !generatable ? "排版任务将自动上传" : "本地已保存"}</span>` : ""}${cdnAllowed && item.status === "local" ? `<button class="ghost-button" data-upload-cdn="${escapeHtml(item.id)}">上传 CDN</button>` : ""}${cdnAllowed && item.status === "cdn" ? `<button class="ghost-button" data-upload-cdn="${escapeHtml(item.id)}">重新上传 CDN</button>` : ""}</div>
    ${item.url ? `<a class="image-cdn-url" href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.url)}</a>` : ""}
  </article>`;
}

// 生成图放大查看：轻量遮罩，点击任意处关闭
function openImageZoom(src, alt) {
  document.querySelector(".image-zoom-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "image-zoom-overlay";
  overlay.innerHTML = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt || "")}">`;
  overlay.addEventListener("click", () => overlay.remove());
  document.addEventListener("keydown", function onKey(event) {
    if (event.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onKey); }
  });
  document.body.appendChild(overlay);
}

// 排版前预检：返回空字符串表示可排版，否则为阻断原因（配图必须全部上传 CDN，公众号要求图片可公开访问）
function typesetBlockReason() {
  const data = state.imageWorkspace;
  const hasCandidate = Boolean(state.productionPreview?.candidates?.length);
  if (!hasCandidate) return "请先运行完整成稿链";
  if (!data?.planned) return "请先点击「AI 规划必要配图」，确认本文需要哪些配图";
  const manual = data.manualUnresolved || (data.unresolved || []).filter((id) => !(data.generatedPending || []).includes(id));
  if (manual.length) return `还有 ${manual.length} 张人工配图未上传 CDN：${manual.join("、")}，请先在配图工作台处理`;
  return "";
}

function renderImageWorkspace() {
  const data = state.imageWorkspace;
  if (!data) return;
  const status = document.getElementById('image-stage-status');
  const button = document.getElementById('plan-article-images');
  if (button) button.hidden = Boolean(data.daily);
  if (button) button.textContent = data.planned ? '重新检查必要配图' : 'AI 规划必要配图';
  if (status) {
    if (!data.planned) status.textContent = '尚未执行配图规划；正式排版前需要先确认是否存在必要图片。';
    else if (!data.total) status.textContent = '配图规划完成：本文没有必须人工提供的来源图或资料图。';
    else {
      const manual = data.manualUnresolved || (data.unresolved || []).filter((id) => !(data.generatedPending || []).includes(id));
      const automatic = data.generatedPending || [];
      status.textContent = manual.length
        ? `人工配图待处理 ${manual.length} 张：${manual.join('、')}`
        : automatic.length
          ? `人工配图已就绪；${automatic.length} 张 Mermaid/ECharts 图片将在排版时自动生成并上传 CDN`
          : `配图已就绪 ${data.ready||0} / ${data.total} · 可以进入正式排版`;
    }
  }
  const list = document.getElementById('image-slot-list');
  if (list) {
    list.innerHTML = data.items && data.items.length
      ? data.items.map(imageCard).join('')
      : '<div class="image-stage-empty">' + (data.planned ? '没有必要的人工配图，文章可直接排版。' : '点击“AI 规划必要配图”，系统只会为有证据或阅读价值的图片留位。') + '</div>';
  }
  var hasCandidate = Boolean(state.productionPreview?.candidates?.length);
  const manualPending = data.manualUnresolved || (data.unresolved || []).filter((id) => !(data.generatedPending || []).includes(id));
  var btn = document.getElementById('run-local-typeset');
  if (btn) {
    // 不再因配图未就绪 disable（禁用按钮点击无任何反馈）；保持可点，由点击预检 toast 说明原因
    btn.disabled = !hasCandidate;
    btn.title = typesetBlockReason() || '生成公众号排版 HTML；自动图表将在任务中上传';
  }
  const copyButton = document.getElementById('copy-typeset-html');
  if (copyButton) {
    const proofReady = !document.getElementById("proof-frame")?.hidden;
    copyButton.disabled = manualPending.length > 0 || !proofReady;
    copyButton.title = manualPending.length
      ? '请先将全部人工配图上传 CDN 并重新生成排版 HTML'
      : proofReady ? '复制当前排版 HTML' : '请先生成排版 HTML';
  }
}

function candidateArtifacts(candidate) {
  if (!state.productionPreview) return [];
  if(candidate.daily){
    return state.productionPreview.artifacts.filter((item)=>String(item.file_path||"").replaceAll("\\","/").toLowerCase().includes("/daily/"));
  }
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
  const candidate = pp.candidates.find((c) => String(c.id) === String(candidateId));
  if (!candidate) return;
  // 与后端 defaultTypesetTheme 同一映射：八卦吃瓜类默认卡片风，其余按分类映射
  const themeSelect = document.getElementById('typeset-theme');
  const autoOption = themeSelect?.querySelector('option[value="auto"]');
  if (autoOption) {
    const suggested = candidate.category === '🏢 大厂战略' && /趣|离谱|八卦/.test(candidate.angle || '') ? '卡片吃瓜风'
      : candidate.composite ? '财经印刷'
      : { '🤖 AI/技术动态': '暗色终端', '📈 行业趋势': '财经印刷', '🏢 大厂战略': '财经印刷', '💼 职场生态': '书信手账', '📰 综合资讯': '黑白快讯' }[candidate.category] || '暖纸杂志风';
    autoOption.textContent = `自动（${suggested}）`;
  }
  const artifacts = candidateArtifacts(candidate);
  const names = new Set(artifacts.map((a) => a.name));
  const steps = candidate.daily
    ? [['01-news-items.json','早报事实清单'],['03-FINAL.md','早报终稿'],['magazine-design-tokens.json','杂志设计'],['article.ai.draft.html','HTML 初稿'],['article.ai.html','门禁后 HTML']]
    : [['article-brief.md','锁定文章简报'],['09-FINAL.md','文章终稿'],['magazine-design-tokens.json','杂志设计'],['article.ai.draft.html','HTML 初稿'],['article.ai.html','门禁后 HTML']];
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
  const gotoCoverBtn = document.getElementById('goto-cover');
  if (gotoCoverBtn) gotoCoverBtn.disabled = false;
  const status = document.getElementById('typeset-status');
  if (status) {
    status.classList.toggle('ready', Boolean(htmlArtifact));
    status.textContent = htmlArtifact ? candidate.candidate_id + ' 的排版 HTML 已就绪，可以直接复制到公众号编辑器。' : (candidate.candidate_id || '当前文章') + ' 尚未生成排版 HTML。';
  }
  const deliveries = artifacts.filter((a) => [candidate.daily?'03-FINAL.md':'09-FINAL.md','article.ai.html'].includes(a.name));
  const dl = document.getElementById('delivery-links');
  if (dl) dl.innerHTML = deliveries.length ? deliveries.map((item) => '<div class="delivery-item"><small>' + escapeHtml(item.kind) + '</small><a href="/api/artifacts/' + item.id + '/content" target="_blank">' + escapeHtml(item.name) + '</a></div>').join('') : '<div class="empty-state">尚无可交付文件</div>';
}

async function loadProductionPreview() {
  const batch = state.batches.find((b) => b.id === state.activeBatchId);
  if (!batch) return;
  const prevId = document.getElementById("typeset-candidate")?.value;
  const [allArtifacts, candidates, documents] = await Promise.all([
    request("/api/artifacts?limit=500"),
    request(`/api/batches/${encodeURIComponent(batch.id)}/candidates`),
    request(`/api/batches/${encodeURIComponent(batch.id)}/documents`),
  ]);
  const artifacts = allArtifacts.filter((item) => item.batch_id === batch.id);
  const finalIds = new Set(documents.filter((d) => d.kind === "final").map((d) => d.candidate_row_id));
  const ready = candidates.filter((c) => finalIds.has(c.id));
  const dailyFinal=documents.find((d)=>d.kind==="daily-final"&&d.candidate_row_id==null);
  if(dailyFinal)ready.unshift({id:"daily",candidate_id:"早报",hotspot_title:dailyFinal.title||"批次早报",category:"📰 综合资讯",daily:true});
  const select = document.getElementById("typeset-candidate");
  if (select) {
    select.innerHTML = ready.length
      ? ready.map((item) => `<option value="${item.id}">${escapeHtml(item.candidate_id)} · ${escapeHtml(item.hotspot_title)}</option>`).join("")
      : '<option value="">缺少 09-FINAL.md</option>';
    const selected = ready.find((c) => String(c.id) === String(prevId)) || ready[0] || null;
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
  const selectedId = select?.value || ready[0]?.id;
  if (ready.length) {
    renderProductionCandidate(selectedId);
    loadImageWorkspace(selectedId);
  }
}

async function loadImageWorkspace(candidateId) {
  const stage = document.getElementById('image-stage');
  if(candidateId==="daily"){
    if(stage)stage.hidden=false;
    const ws=await request(`/api/batches/${encodeURIComponent(state.activeBatchId)}/daily/images`);
    state.imageWorkspace=Object.assign({},ws,{candidateId:"daily",daily:true});
    renderImageWorkspace();
    return;
  }
  if (!candidateId) { state.imageWorkspace = null; if(stage)stage.hidden = true; document.getElementById('run-local-typeset') && (document.getElementById('run-local-typeset').disabled = true); return; }
  if (stage) stage.hidden = false;
  try {
    const ws = await request('/api/candidates/' + candidateId + '/images');
    state.imageWorkspace = Object.assign({}, ws, {candidateId:candidateId});
    renderImageWorkspace();
  } catch (error) {
    state.imageWorkspace = null;
    const status = document.getElementById('image-stage-status');
    if (status) status.textContent = '配图信息读取失败（网络或服务异常）：' + error.message;
    toast('配图信息读取失败：' + error.message, 'error');
  }
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
async function saveLocalImageAsset(id, droppedFile = null) {
  const card = imageSlot(id);
  if (!card) return;
  const file = droppedFile || card.querySelector("[data-image-file]")?.files?.[0];
  if (!file) return;
  const supported = /^(?:image\/png|image\/jpeg|image\/gif|image\/webp)$/i.test(file.type)
    || /\.(?:png|jpe?g|gif|webp)$/i.test(file.name);
  if (!supported) throw new Error("仅支持 PNG、JPEG、GIF 或 WebP 图片");
  if (file.size > 8 * 1024 * 1024) throw new Error("单张图片不能超过 8MB");
  const status = card.querySelector(".image-slot-status");
  if (status) status.textContent = "正在保存到本地…";
  try {
    const payload = { fileName: file.name, mimeType: file.type, base64: await fileAsDataUrl(file) };
    await request(`${imageApiBase()}/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(payload) });
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
    await request(`${imageApiBase()}/${encodeURIComponent(id)}/cdn`, { method: "POST", body: "{}" });
    await loadImageWorkspace(state.imageWorkspace.candidateId);
    toast(`${id} 已上传 CDN`);
  } catch (error) {
    if (status?.isConnected) status.textContent = "本地待上传";
    toast(error.message);
  }
}

// 可生成占位：调用确定性生成链产出本地 PNG（数据来自占位结构化清单，仅本地写入）
async function generateImageAsset(id) {
  await request(`${imageApiBase()}/${encodeURIComponent(id)}/generate`, { method: "POST", body: "{}" });
  await loadImageWorkspace(state.imageWorkspace.candidateId);
  toast(`${id} 已生成，确认后可上传 CDN`);
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
