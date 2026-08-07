import { $ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, providerOptions, withLoading } from "../core/ui.js";
import { state } from "../core/state.js";

let bound = false;
let pollTimer = null;

function bindCover() {
  if (bound) return;
  bound = true;
  $("#cover-candidate").addEventListener("change", () => loadCoverState().catch((error) => toast(error.message)));
  $("#generate-cover").addEventListener("click", (event) => withLoading(event.currentTarget, "正在生成…", () => generateCover().catch((error) => toast(error.message))));
}

function currentCandidateId() {
  return $("#cover-candidate")?.value || "";
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
  if (!id) { img.hidden = true; empty.hidden = false; download.hidden = true; return; }
  const status = await request(coverApi(id));
  if (status.exists) {
    const url = `${coverApi(id, "/local")}?v=${encodeURIComponent(status.modifiedAt)}`;
    img.src = url; img.hidden = false; empty.hidden = true;
    download.href = url; download.hidden = false;
    $("#cover-status").textContent = `已生成 · ${new Date(status.modifiedAt).toLocaleString("zh-CN")} · 可重新生成覆盖`;
  } else {
    img.hidden = true; empty.hidden = false; download.hidden = true;
    $("#cover-status").textContent = "尚未生成封面图";
  }
}

async function pollCoverJob(jobId, candidateId) {
  clearTimeout(pollTimer);
  const job = await request(`/api/jobs/${jobId}`);
  if (String(job.candidateId ?? job.candidate_id ?? "") !== String(candidateId) && job.candidateId != null) return;
  if (job.status === "running" || job.status === "queued") {
    $("#cover-status").textContent = job.progress || "正在生成…";
    pollTimer = setTimeout(() => pollCoverJob(jobId, candidateId).catch(() => {}), 1500);
    return;
  }
  if (job.status === "completed") {
    toast("封面图已生成");
    await loadCoverState();
  } else {
    $("#cover-status").textContent = `生成失败：${job.error || "未知错误"}`;
  }
}

async function generateCover() {
  const id = currentCandidateId();
  if (!id) return toast("请先选择文章");
  const job = await request(coverApi(id, "/generate"), {
    method: "POST",
    body: JSON.stringify({ theme: $("#cover-theme").value || "auto", provider: $("#cover-provider").value || undefined }),
  });
  $("#cover-status").textContent = "封面生成任务已入队…";
  await pollCoverJob(job.id, id);
}

export default async function loadCoverView() {
  bindCover();
  const prov = $("#cover-provider");
  if (prov) prov.innerHTML = providerOptions(state.models?.defaultProvider || "");
  await Promise.all([loadCandidates()]);
  await loadCoverState();
}
