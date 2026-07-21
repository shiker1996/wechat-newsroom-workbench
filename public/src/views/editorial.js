import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, providerOptions } from "../core/ui.js";
import { state } from "../core/state.js";

async function loadEditorialRoom(selectedId) {
  const batch = state.batches.find((b) => b.id === state.activeBatchId);
  if (!batch) return;
  state.candidates = await request(`/api/batches/${encodeURIComponent(batch.id)}/candidates`);
  const sidebar = document.getElementById("editorial-candidates");
  if (!sidebar) return;
  sidebar.innerHTML = state.candidates.length
    ? state.candidates.map((item) =>
        `<button class="editorial-candidate ${Number(selectedId) === item.id ? "active" : ""}" data-edit-candidate="${item.id}"><b>${escapeHtml(item.candidate_id)} · ${escapeHtml(item.brief_status || "DISCUSS")}</b><span>${escapeHtml(item.hotspot_title)}</span></button>`
      ).join("")
    : '<div class="empty-state">选题池为空</div>';
  if (state.candidates.length) await openEditorial(selectedId || state.candidates[0].id);
  else {
    const empty = document.getElementById("editorial-empty");
    const fields = document.getElementById("editorial-fields");
    if (empty) empty.hidden = false;
    if (fields) fields.hidden = true;
  }
}

async function openEditorial(id) {
  try { state.models = await request("/api/models"); } catch {}
  const candidate = await request(`/api/candidates/${id}`);
  $$(".editorial-candidate").forEach((item) => item.classList.toggle("active", Number(item.dataset.editCandidate) === Number(id)));
  const empty = document.getElementById("editorial-empty");
  const fields = document.getElementById("editorial-fields");
  if (empty) empty.hidden = true;
  if (fields) fields.hidden = false;
  const form = document.getElementById("editorial-form");
  if (!form) return;
  form.elements.candidateId.value = candidate.id;
  form.elements.angle.value = candidate.angle || "";
  form.elements.thesis.value = candidate.thesis || "";
  const editorial = candidate.editorial || {};
  for (const key of ["editor_question", "confirmed_facts", "author_opinions", "confirmed_experiences", "rejected_angles", "open_questions", "forbidden_claims", "next_action"]) {
    const el = form.elements[key];
    if (el) el.value = editorial[key] || "";
  }
  const expReq = form.elements.experience_required;
  if (expReq) expReq.checked = Boolean(editorial.experience_required);
  const cid = document.getElementById("editorial-candidate-id");
  if (cid) cid.textContent = candidate.candidate_id;
  const title = document.getElementById("editorial-hotspot-title");
  if (title) title.textContent = candidate.hotspot_title;
  const badge = document.getElementById("editorial-composite-badge");
  if (badge) badge.hidden = !candidate.composite;
  const briefState = document.getElementById("brief-state");
  if (briefState) briefState.textContent = editorial.brief_status;
  const provEl = document.getElementById("editorial-provider");
  if (provEl) {
    const preferred = state.models?.providers?.find((p) => p.configured)?.name || state.models?.defaultProvider || "";
    provEl.innerHTML = providerOptions(preferred);
  }
  // Source evidence
  const se = document.getElementById("source-evidence");
  if (se) {
    const source = candidate.source_document;
    const ok = source?.status === "ok";
    const partial = source?.status === "partial";
    se.className = `source-evidence ${ok ? "ready" : partial ? "partial" : source ? "failed" : "missing"}`;
    const titleEl = document.getElementById("source-evidence-title");
    if (titleEl) {
      const method = source?.fetch_method === "firecrawl-mcp" ? "Firecrawl MCP" : source?.fetch_method === "python" ? "Python" : "来源抓取";
      titleEl.textContent = ok ? `${method} · 已抓取 ${source.content_chars} 字` : partial ? `${method} · 仅取得部分内容 ${source.content_chars} 字` : source ? `${method}失败 · ${source.error || "未知原因"}` : "原文尚未抓取";
    }
    const meta = document.getElementById("source-evidence-meta");
    if (meta) meta.textContent = source ? `${source.title || candidate.hotspot_title}${source.author ? ` · ${source.author}` : ""}${source.published_at ? ` · ${source.published_at}` : ""}` : "AI 编辑会开始前会自动获取公开原文。";
    const excerpt = document.getElementById("source-evidence-excerpt");
    if (excerpt) excerpt.innerHTML = source?.content ? `<p>${escapeHtml(source.content.slice(0, 1600))}</p>` : (source?.description ? `<p>${escapeHtml(source.description)}</p>` : "暂无可展示的来源摘录。");
    const details = document.getElementById("source-evidence-details");
    if (details) details.hidden = !source;
  }
  // Messages
  const messages = document.getElementById("editorial-messages");
  if (messages) {
    messages.innerHTML = candidate.messages?.length
      ? candidate.messages.map((m) => `<div class="editorial-message ${escapeHtml(m.role)}"><b>${m.role === "user" ? "你" : "AI 编辑"}</b><p>${escapeHtml(m.content).replaceAll("\n", "<br>")}</p></div>`).join("")
      : '<div class="editorial-chat-empty">尚未开始编辑会。点击"让 AI 提问"。</div>';
    messages.scrollTop = messages.scrollHeight;
  }
  state.editorialCandidate = candidate;
  renderEditorialReadiness();
  loadSimilarArticles(id);
}

async function loadSimilarArticles(id) {
  const container = document.getElementById("similar-articles");
  if (!container) return;
  try {
    const similar = await request(`/api/candidates/${id}/similar`);
    if (similar.length) {
      container.innerHTML = "<b>历史覆盖</b>" + similar.map((s) => `<div><span style="cursor:pointer;color:var(--red)" data-cal-article="${s.id}">${escapeHtml(s.title.slice(0, 30))}</span> <span class="muted">${escapeHtml(s.batchDate)} · ${escapeHtml(s.poolRole || "")}</span></div>`).join("");
      container.hidden = false;
    } else {
      container.hidden = true;
    }
  } catch { container.hidden = true; }
}

function renderEditorialReadiness() {
  const gate = document.getElementById("editorial-production-gate");
  if (!gate) return;
  const form = document.getElementById("editorial-form");
  if (!form) return;
  const text = (name) => form.elements[name]?.value?.trim() || "";
  const checks = [
    { label: "锁定命题", ok: Boolean(text("thesis")) },
    { label: "事实基座", ok: Boolean(text("confirmed_facts")) },
    { label: "未决问题清零", ok: !text("open_questions") },
    { label: "可以立即写作", ok: text("next_action") === "WRITE_NOW" },
    { label: "实践证据", ok: !form.elements.experience_required?.checked || Boolean(text("confirmed_experiences")) },
  ];
  const passed = checks.filter((c) => c.ok).length;
  const ready = passed === checks.length;
  const locked = state.editorialCandidate?.brief_status === "LOCKED" || state.editorialCandidate?.editorial?.brief_status === "LOCKED";
  gate.classList.toggle("ready", ready);
  const count = document.getElementById("editorial-gate-count");
  if (count) count.textContent = `${passed} / ${checks.length}`;
  const list = document.getElementById("editorial-gate-checks");
  if (list) list.innerHTML = checks.map((c) => `<span class="editorial-gate-check ${c.ok ? "done" : ""}">${escapeHtml(c.label)}</span>`).join("");
  const title = document.getElementById("editorial-production-title");
  if (title) title.textContent = ready ? "编辑决策已完整，可以进入成稿" : "尚未达到成稿条件";
  const hint = document.getElementById("editorial-production-hint");
  if (hint) hint.textContent = ready ? "点击后会保存当前决策、锁定文章简报，并运行完整成稿链。" : `还需完成：${checks.filter((c) => !c.ok).map((c) => c.label).join("、")}`;
  const btn = document.getElementById("start-editorial-production");
  if (btn) { btn.hidden = !ready; btn.textContent = locked ? "重新运行完整成稿链" : "确认简报并开始成稿"; }
}

async function sendEditorialAnswer() {
  const form = document.getElementById("editorial-form");
  if (!form) return;
  const candidateId = Number(form.elements.candidateId.value);
  if (!candidateId) return;
  const answer = document.getElementById("editorial-answer")?.value?.trim() || "";
  const button = document.getElementById("send-editorial-answer");
  const messages = document.getElementById("editorial-messages");
  if (!messages || !button) return;
  const empty = messages.querySelector(".editorial-chat-empty");
  if (empty) empty.remove();
  if (answer) messages.insertAdjacentHTML("beforeend", `<div class="editorial-message user"><b>你</b><p>${escapeHtml(answer).replaceAll("\n", "<br>")}</p></div>`);
  const sm = document.createElement("div");
  sm.className = "editorial-message assistant streaming";
  sm.innerHTML = "<b>AI 编辑 · 实时回应</b><p></p>";
  messages.append(sm);
  messages.scrollTop = messages.scrollHeight;
  const st = sm.querySelector("p");
  button.disabled = true;
  button.textContent = "AI 正在回应…";
  try {
    const response = await fetch(`/api/candidates/${candidateId}/ai/editorial/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: document.getElementById("editorial-provider")?.value || "", answer }),
    });
    if (!response.ok) { const d = await response.json().catch(() => ({})); throw new Error(d.error || `HTTP ${response.status}`); }
    if (!response.body) throw new Error("浏览器未收到流式响应");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;
    const consume = (line) => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.type === "delta" && st) st.textContent += event.text || "";
      if (event.type === "error") throw new Error(event.error || "编辑会调用失败");
      if (event.type === "done") completed = true;
      messages.scrollTop = messages.scrollHeight;
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) consume(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!completed) throw new Error("编辑会连接提前结束，请重试");
    const answerEl = document.getElementById("editorial-answer");
    if (answerEl) answerEl.value = "";
    sm.classList.remove("streaming");
    await openEditorial(candidateId);
    toast("编辑会决策已更新");
  } catch (err) {
    sm.classList.remove("streaming");
    sm.classList.add("failed");
    if (st && !st.textContent) st.textContent = `调用失败：${err.message}`;
    throw err;
  } finally {
    button.disabled = false;
    button.textContent = "发送回答 / 让 AI 提问";
  }
}

async function persistEditorialForm(opts) {
  opts = opts || {};
  const form = document.getElementById("editorial-form");
  if (!form) return null;
  const candidateId = Number(form.elements.candidateId.value);
  if (!candidateId) return null;
  await request(`/api/candidates/${candidateId}`, {
    method: "PATCH",
    body: JSON.stringify({ angle: form.elements.angle.value, thesis: form.elements.thesis.value }),
  });
  const fields = ["editor_question", "confirmed_facts", "author_opinions", "confirmed_experiences", "rejected_angles", "open_questions", "forbidden_claims", "next_action"];
  const editorial = Object.fromEntries(fields.map((k) => [k, form.elements[k].value]));
  editorial.experience_required = form.elements.experience_required?.checked ? 1 : 0;
  await request(`/api/candidates/${candidateId}/editorial`, { method: "PUT", body: JSON.stringify(editorial) });
  if (opts.refresh !== false) await openEditorial(candidateId);
  return candidateId;
}

async function saveEditorial(event) {
  event.preventDefault();
  await persistEditorialForm();
  toast("编辑决策已保存");
}

async function fetchEditorialSource() {
  const form = document.getElementById("editorial-form");
  if (!form) return;
  const candidateId = Number(form.elements.candidateId.value);
  if (!candidateId) return;
  const btn = document.getElementById("fetch-source");
  if (btn) { btn.disabled = true; btn.textContent = "正在抓取原文…"; }
  try {
    const source = await request(`/api/candidates/${candidateId}/source`, { method: "POST", body: JSON.stringify({ force: true }) });
    await openEditorial(candidateId);
    toast(source.status === "ok" ? `已抓取 ${source.content_chars} 字原文` : `原文抓取未完整：${source.error}`);
  } finally { if (btn) { btn.disabled = false; btn.textContent = "抓取 / 刷新原文"; } }
}

async function startEditorialProduction() {
  const form = document.getElementById("editorial-form");
  if (!form) return;
  const candidateId = await persistEditorialForm({ refresh: false });
  if (!candidateId) return toast("请先选择候选");
  try {
    await request(`/api/candidates/${candidateId}/lock`, { method: "POST" });
    const result = await request(`/api/candidates/${candidateId}/ai/article`, { method: "POST", body: JSON.stringify({ provider: document.getElementById("editorial-provider")?.value || "" }) });
    toast("完整成稿链已启动");
    if (result?.id) {
      // poll job
      state.jobTimer = setTimeout(async function poll() {
        try {
          const job = await request(`/api/jobs/${result.id}`);
          const console = document.getElementById("production-job-console");
          if (console) {
            const logs = job.logs || [{ at: job.updated_at || new Date().toISOString(), message: job.progress }];
            console.textContent = logs.map((l) => `${l.at.slice(11, 19)}  ${l.message}`).join("\n") || job.progress;
            console.scrollTop = console.scrollHeight;
          }
          if (job.status === "running") {
            state.jobTimer = setTimeout(poll, 1200);
          } else {
            toast(job.status === "completed" ? "完整成稿链已完成" : `任务失败：${job.error || "未取得有效结果"}`);
          }
        } catch (err) { toast(err.message); }
      }, 1200);
    }
  } catch (err) { toast(err.message); }
}

window.saveEditorial = saveEditorial;
window.renderEditorialReadiness = renderEditorialReadiness;
window.sendEditorialAnswer = sendEditorialAnswer;
window.fetchEditorialSource = fetchEditorialSource;
window.persistEditorialForm = persistEditorialForm;
window.startEditorialProduction = startEditorialProduction;

export default loadEditorialRoom;