import { $ } from "../core/dom.js";
import { request } from "../core/http.js";
import { poll } from "../core/poll.js";
import { JOB_POLL_INTERVAL_MS } from "../core/constants.js";
import { escapeHtml, toast, providerOptions, withLoading, confirmAction } from "../core/ui.js";
import { state } from "../core/state.js";

let bound = false;
let coverPoller = null;
let coverExists = false;

function bindCover() {
  if (bound) return;
  bound = true;
  $("#cover-candidate").addEventListener("change", () => loadCoverState().catch((error) => toast(error.message, "error")));
  $("#cover-mode").addEventListener("change", () => renderModeHelp());
  $("#generate-cover").addEventListener("click", (event) => withLoading(event.currentTarget, "正在生成…", () => generateCover().catch((error) => {
    $("#cover-status").textContent = `生成失败：${error.message}`;
    toast(error.message, "error");
  })));
}

function currentCandidateId() {
  return $("#cover-candidate")?.value || "";
}

function currentMode() {
  return $("#cover-mode")?.value || "standard";
}

function renderModeHelp() {
  const mode = currentMode();
  const help = $("#cover-mode-help");
  if (!help) return;
  help.textContent = mode === "ai-visual"
    ? "AI 视觉封面：AI 生成 HTML/CSS 后直接截图，不调用文生图；生成或截图失败时任务直接失败。"
    : "标准封面：AI 只做主题与构图决策，图片由本地确定性模板渲染。";
}

function renderAiStatus(status) {
  const target = $("#cover-ai-status");
  const link = $("#cover-ai-html");
  if (!target) return;
  target.hidden = true;
  target.textContent = "";
  if (link) { link.hidden = true; link.removeAttribute("href"); }
  if (!status?.exists) return;
  if (status.aiVisualFallback) {
    target.textContent = `AI 视觉生成失败，已回退标准封面${status.aiVisualError ? `：${status.aiVisualError}` : ""}`;
    target.hidden = false;
    target.className = "cover-ai-status warning";
  } else if (status.mode === "ai-visual") {
    target.textContent = "AI 视觉封面已生成（HTML/CSS 截图，不调用文生图模型）";
    target.hidden = false;
    target.className = "cover-ai-status success";
  }
  if (link && status.aiVisualHtmlAvailable) {
    link.href = coverApi(currentCandidateId(), "/ai-html");
    link.hidden = false;
  }
}

async function loadCandidates() {
  const batch = state.batches.find((b) => b.id === state.activeBatchId);
  const select = $("#cover-candidate");
  if (!batch) { select.innerHTML = '<option value="">暂无批次</option>'; select.disabled = true; return; }
  const [candidates, documents] = await Promise.all([
    request(`/api/batches/${encodeURIComponent(batch.id)}/candidates`),
    request(`/api/batches/${encodeURIComponent(batch.id)}/documents`),
  ]);
  const finalIds = new Set(documents.filter((d) => d.kind === "final").map((d) => d.candidate_row_id));
  const ready = candidates.filter((c) => finalIds.has(c.id));
  // 早报与排版页同一约定：批次级 daily-final 文档拼成伪候选 daily（参考 editor.js/preview.js）
  const dailyFinal = documents.find((d) => d.kind === "daily-final" && d.candidate_row_id == null);
  if (dailyFinal) ready.unshift({ id: "daily", candidate_id: "早报", hotspot_title: dailyFinal.title || "批次早报", category: "📰 综合资讯", daily: true });
  const preferredId = state.coverCandidateId;
  const preferred = ready.find((c) => String(c.id) === String(preferredId)) || (preferredId ? null : ready[0]) || null;
  if (preferredId && !preferred) toast("该文章没有可生成封面的终稿，请先在成稿链产出 09-FINAL.md");
  state.coverCandidateId = null;
  select.innerHTML = ready.length
    ? ready.map((item) => `<option value="${item.id}">${escapeHtml(item.candidate_id)} · ${escapeHtml(item.hotspot_title)}</option>`).join("")
    : '<option value="">缺少成稿终稿，请先完成成稿链</option>';
  select.value = preferred ? String(preferred.id) : "";
  select.disabled = !ready.length;
  $("#generate-cover").disabled = !ready.length;
  state.coverCandidates = ready;
}

function renderArticleInfo() {
  const candidate = (state.coverCandidates || []).find((c) => String(c.id) === currentCandidateId());
  const info = $("#cover-article-info");
  if (!candidate) { info.innerHTML = '<div class="empty-state">没有可生成封面的文章</div>'; return; }
  info.innerHTML = `<div class="delivery-item"><small>标题</small><b>${escapeHtml(candidate.hotspot_title)}</b></div>`
    + `<div class="delivery-item"><small>分类 / 角度</small>${escapeHtml(candidate.category || "未分类")}${candidate.angle ? ` · ${escapeHtml(candidate.angle)}` : ""}</div>`;
}

function coverApi(id, suffix = "") {
  return id === "daily"
    ? `/api/batches/${encodeURIComponent(state.activeBatchId)}/daily/cover${suffix}`
    : `/api/candidates/${id}/cover${suffix}`;
}

async function loadCoverState() {
  renderArticleInfo();
  const id = currentCandidateId();
  const img = $("#cover-image"), empty = $("#cover-empty"), download = $("#download-cover");
  if (!id) { img.hidden = true; empty.hidden = false; download.hidden = true; renderAiStatus({ exists: false }); return; }
  const status = await request(coverApi(id));
  coverExists = status.exists;
  renderAiStatus(status);
  if (status.exists) {
    const url = `${coverApi(id, "/local")}?v=${encodeURIComponent(status.modifiedAt)}`;
    img.src = url; img.hidden = false; empty.hidden = true;
    download.href = url; download.hidden = false;
    const modeLabel = status.aiVisualFallback ? "标准封面（AI 视觉失败后回退）" : status.mode === "ai-visual" ? "AI 视觉封面" : "标准封面";
    $("#cover-status").textContent = `${modeLabel} · ${new Date(status.modifiedAt).toLocaleString("zh-CN")} · 可重新生成覆盖`;
  } else {
    img.hidden = true; empty.hidden = false; download.hidden = true;
    $("#cover-status").textContent = "尚未生成封面图";
  }
}

async function pollCoverJob(jobId, candidateId) {
  coverPoller?.cancel();
  coverPoller = poll(async () => {
    const job = await request(`/api/jobs/${jobId}`);
    if (String(job.candidateId ?? job.candidate_id ?? "") !== String(candidateId) && job.candidateId != null) return true;
    if (job.status === "running" || job.status === "queued") {
      $("#cover-status").textContent = job.progress || (currentMode() === "ai-visual" ? "正在生成 AI 视觉封面…" : "正在生成标准封面…");
      return false;
    }
    if (job.status === "completed") {
      toast("封面图已生成", "success");
      await loadCoverState();
    } else {
      $("#cover-status").textContent = `生成失败：${job.error || "未知错误"}`;
    }
    return true;
  }, { interval: JOB_POLL_INTERVAL_MS });
  await coverPoller.promise;
}

async function generateCover() {
  const id = currentCandidateId();
  if (!id) return toast("请先选择文章");
  if (coverExists && !await confirmAction("重新生成将覆盖当前已生成的封面图，是否继续？", { confirmText: "重新生成" })) return;
  const job = await request(coverApi(id, "/generate"), {
    method: "POST",
    body: JSON.stringify({ theme: $("#cover-theme").value || "auto", provider: $("#cover-provider").value || undefined, mode: currentMode() }),
  });
  $("#cover-status").textContent = currentMode() === "ai-visual" ? "AI 视觉封面任务已入队…" : "标准封面任务已入队…";
  await pollCoverJob(job.id, id);
}

export default async function loadCoverView() {
  bindCover();
  renderModeHelp();
  const prov = $("#cover-provider");
  if (prov) prov.innerHTML = providerOptions(state.models?.defaultProvider || "");
  await Promise.all([loadCandidates()]);
  await loadCoverState();
}
