import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, providerOptions, withLoading } from "../core/ui.js";
import { state } from "../core/state.js";

let markdownRenderer;
let ignoredScrollTarget = null;

function getMarkdownRenderer() {
  if (markdownRenderer) return markdownRenderer;
  if (typeof window.markdownit !== "function") return null;

  markdownRenderer = window.markdownit({
    html: false,
    linkify: true,
    breaks: false,
    typographer: false,
  });
  const defaultLinkOpen = markdownRenderer.renderer.rules.link_open
    || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  markdownRenderer.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noopener noreferrer");
    return defaultLinkOpen(tokens, idx, options, env, self);
  };
  return markdownRenderer;
}

function markdownHtml(text) {
  if (!text.trim()) return '<p class="markdown-empty">在左侧输入 Markdown，预览会实时显示在这里。</p>';
  const renderer = getMarkdownRenderer();
  if (renderer) return renderer.render(text);
  return `<pre><code>${escapeHtml(text)}</code></pre>`;
}

function scrollProgress(element) {
  const distance = element.scrollHeight - element.clientHeight;
  return distance > 0 ? element.scrollTop / distance : 0;
}

function syncScroll(source, target) {
  if (ignoredScrollTarget === source) return;
  const targetDistance = target.scrollHeight - target.clientHeight;
  ignoredScrollTarget = target;
  target.scrollTop = scrollProgress(source) * Math.max(0, targetDistance);
  requestAnimationFrame(() => {
    if (ignoredScrollTarget === target) ignoredScrollTarget = null;
  });
}

function setupSynchronizedScrolling() {
  const editor = document.getElementById("markdown-editor");
  const preview = document.getElementById("markdown-preview");
  if (!editor || !preview || editor.dataset.scrollSyncBound === "true") return;
  editor.dataset.scrollSyncBound = "true";
  editor.addEventListener("scroll", () => syncScroll(editor, preview), { passive: true });
  preview.addEventListener("scroll", () => syncScroll(preview, editor), { passive: true });
}

function visibleChars(markdown) {
  return markdown.replace(/^#.*$/gm, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`>#-]/g, "").replace(/\s/g, "").length;
}

function renderMarkdown() {
  const editor = document.getElementById("markdown-editor");
  const preview = document.getElementById("markdown-preview");
  if (!editor || !preview) return;
  preview.innerHTML = markdownHtml(editor.value);
  requestAnimationFrame(() => syncScroll(editor, preview));
  const count = visibleChars(editor.value);
  const cc = document.getElementById("char-count");
  if (cc) cc.textContent = count + " / 2000";
}

function selectedDocKind() {
  const el = document.querySelector("input[name=doc-kind]:checked");
  return el?.value || "draft";
}

async function loadWritingDesk() {
  setupSynchronizedScrolling();
  await ensureModelOptions();
  const draftProv = document.getElementById("draft-provider");
  if (draftProv && state.models) draftProv.innerHTML = providerOptions(state.models.providers.find((p) => p.configured)?.name || state.models.defaultProvider);
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

async function runTypeset() {
  const candidateId = Number(document.getElementById("typeset-candidate")?.value);
  if (!candidateId) return toast("请先选择一个候选");
  const provider = document.getElementById("typeset-provider")?.value || state.models?.defaultProvider;
  try {
    const result = await request(`/api/batches/${encodeURIComponent(state.activeBatchId)}/ai/typeset`, {
      method: "POST", body: JSON.stringify({ provider, candidateId }),
    });
    toast("排版任务已启动");
    if (result?.id) pollJob(result.id);
  } catch (err) { toast(err.message); }
}

// batch-drawer 的成稿完成跳转依赖该桥接
window.loadSelectedDocument = loadSelectedDocument;

let bound = false;
function bindEditor() {
  if (bound) return;
  bound = true;
  document.getElementById("writing-candidate").addEventListener("change", () => loadSelectedDocument().catch((error) => toast(error.message)));
  $$("input[name=doc-kind]").forEach((item) => item.addEventListener("change", () => loadSelectedDocument().catch((error) => toast(error.message))));
  document.getElementById("markdown-editor").addEventListener("input", renderMarkdown);
  document.getElementById("article-title").addEventListener("input", () => {
    const content = document.getElementById("markdown-editor").value;
    if (content.startsWith("# ")) {
      const sep = content.indexOf("\n");
      document.getElementById("markdown-editor").value = "# " + document.getElementById("article-title").value + (sep >= 0 ? content.slice(sep) : "\n\n");
    }
    renderMarkdown();
  });
  document.getElementById("save-document").addEventListener("click", () => saveDocument().catch((error) => toast(error.message)));
  document.getElementById("ai-draft").addEventListener("click", (event) => withLoading(event.currentTarget, "正在生成…", () => aiDraft().catch((error) => toast(error.message))));
}

export default async function loadWritingDeskView() {
  bindEditor();
  return loadWritingDesk();
}
export { runTypeset };
