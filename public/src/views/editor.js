import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, providerOptions } from "../core/ui.js";
import { state } from "../core/state.js";

function markdownHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\n/g, "<br>");
}

function visibleChars(markdown) {
  return markdown.replace(/^#.*$/gm, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`>#-]/g, "").replace(/\s/g, "").length;
}

function renderMarkdown() {
  const editor = document.getElementById("markdown-editor");
  const preview = document.getElementById("markdown-preview");
  if (!editor || !preview) return;
  preview.innerHTML = markdownHtml(editor.value);
  const count = visibleChars(editor.value);
  const cc = document.getElementById("char-count");
  if (cc) cc.textContent = count + " / 2000";
}

function selectedDocKind() {
  const el = document.querySelector("input[name=doc-kind]:checked");
  return el?.value || "draft";
}

async function loadWritingDesk() {
  const batch = state.batches.find((b) => b.id === state.activeBatchId);
  if (!batch) return;
  const [candidates, documents] = await Promise.all([
    request(`/api/batches/${encodeURIComponent(batch.id)}/candidates`),
    request(`/api/batches/${encodeURIComponent(batch.id)}/documents`),
  ]);
  state.candidates = candidates.filter(
    (item) => item.brief_status === "LOCKED" || (item.brief_status == null && item.status === "locked")
  );
  state.documents = documents;
  const select = document.getElementById("writing-candidate");
  if (!select) return;
  select.innerHTML = state.candidates.length
    ? state.candidates.map((item) => `<option value="${item.id}">${escapeHtml(item.candidate_id)} · ${escapeHtml(item.hotspot_title)}</option>`).join("")
    : '<option value="">没有已锁定候选</option>';
  select.disabled = !state.candidates.length;
  const saveBtn = document.getElementById("save-document");
  if (saveBtn) saveBtn.disabled = !state.candidates.length;
  loadSelectedDocument();
}

async function loadSelectedDocument() {
  const candidateId = Number(document.getElementById("writing-candidate")?.value);
  const kind = selectedDocKind();
  let docResult = null;
  try {
    docResult = await request(`/api/batches/${encodeURIComponent(state.activeBatchId)}/documents?candidateId=${candidateId}&kind=${kind}`);
  } catch {}
  const candidate = state.candidates.find((item) => item.id === candidateId);
  const titleEl = document.getElementById("article-title");
  const editor = document.getElementById("markdown-editor");
  if (titleEl) titleEl.value = docResult?.title || candidate?.hotspot_title || "";
  if (editor) {
    editor.value = docResult?.content || (candidate ? `# ${candidate.hotspot_title}\n\n` : "");
    renderMarkdown();
  }
}

async function saveDocument() {
  const candidateId = Number(document.getElementById("writing-candidate")?.value);
  if (!candidateId) return toast("先锁定一个文章简报");
  const content = document.getElementById("markdown-editor")?.value || "";
  const kind = selectedDocKind();
  if (kind === "final" && visibleChars(content) > 2000) return toast("终稿超过 2000 可见字符，暂不能保存为终稿");
  const title = document.getElementById("article-title")?.value || "";
  const docResult = await request(`/api/batches/${encodeURIComponent(state.activeBatchId)}/documents`, {
    method: "PUT",
    body: JSON.stringify({ candidateId, kind, title, content, status: kind === "final" ? "finalized" : "draft" }),
  });
  toast(`已保存 ${docResult.file_path}`);
  await loadWritingDesk();
}

async function ensureModelOptions() {
  if (!state.models) {
    try { state.models = await request("/api/models"); } catch {}
  }
}

async function aiDraft() {
  const candidateId = Number(document.getElementById("writing-candidate")?.value);
  if (!candidateId) return toast("先在编辑室锁定文章简报");
  const provider = document.getElementById("draft-provider")?.value || state.models?.defaultProvider;
  const button = document.getElementById("ai-draft");
  if (button) { button.disabled = true; button.textContent = "模型创作中…"; }
  try {
    const existing = document.getElementById("markdown-editor")?.value || "";
    const result = await request(`/api/candidates/${candidateId}/ai/draft`, {
      method: "POST",
      body: JSON.stringify({ provider, existingDraft: existing }),
    });
    const editor = document.getElementById("markdown-editor");
    if (editor) editor.value = result.content;
    renderMarkdown();
    const ctx = document.getElementById("draft-context");
    if (ctx) ctx.textContent = `${result.provider} · ${result.model} · 输入约 ${result.context.afterTokens} tokens${result.context.compressed ? " · 已压缩历史上下文" : " · 未触发压缩"} · 尚未保存`;
    toast("模型结果已放入编辑器，请审阅后保存");
  } catch (err) { toast(err.message); }
  finally { if (button) { button.disabled = false; button.textContent = "AI 起草"; } }
}

async function aiTagBatch() {
  const provider = document.getElementById("batch-ai-provider")?.value || document.getElementById("model-provider")?.value || state.models?.defaultProvider;
  if (!provider) return toast("请先在模型中心配置至少一个服务商");
  const force = confirm("重新打标将覆盖本批次全部已有语义标注，是否继续？");
  try {
    const result = await request(`/api/batches/${encodeURIComponent(state.activeBatchId)}/ai/tag`, {
      method: "POST", body: JSON.stringify({ provider, background: true, force }),
    });
    toast(force ? "重新打标已启动" : "打标任务已启动");
    if (result?.id) pollJob(result.id);
  } catch (err) { toast(err.message); }
}

async function pollJob(id) {
  clearTimeout(state.jobTimer);
  try {
    const job = await request(`/api/jobs/${id}`);
    const logs = job.logs ?? [{ at: job.updated_at || new Date().toISOString(), message: job.progress }];
    const output = logs.map((l) => `${l.at.slice(11, 19)}  ${l.message}`).join("\n") || job.progress;
    for (const sel of ["#job-console", "#production-job-console"]) {
      const node = document.querySelector(sel);
      if (node) { node.textContent = output; node.scrollTop = node.scrollHeight; }
    }
    if (job.status === "running") {
      state.jobTimer = setTimeout(() => pollJob(id), 1200);
    } else {
      toast(job.status === "completed" ? (job.type === "article" ? "完整成稿链已完成" : job.type === "typeset" ? "公众号排版 HTML 已完成" : "AI 打标完成") : `任务失败：${job.error || "未取得有效结果"}`);
    }
  } catch (err) { toast(err.message); }
}

async function runTypeset(mode) {
  const candidateId = Number(document.getElementById("typeset-candidate")?.value);
  if (!candidateId) return toast("请先选择一个候选");
  const provider = document.getElementById("typeset-provider")?.value || state.models?.defaultProvider;
  try {
    const result = await request(`/api/batches/${encodeURIComponent(state.activeBatchId)}/ai/typeset`, {
      method: "POST", body: JSON.stringify({ provider, candidateId, mode: mode || "local" }),
    });
    toast("排版任务已启动");
    if (result?.id) pollJob(result.id);
  } catch (err) { toast(err.message); }
}

// Expose for event handlers
window.renderMarkdown = renderMarkdown;
window.loadSelectedDocument = loadSelectedDocument;
window.saveDocument = saveDocument;
window.aiDraft = aiDraft;
window.aiTagBatch = aiTagBatch;
window.runTypeset = runTypeset;

export default loadWritingDesk;
