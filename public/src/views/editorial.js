import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, providerOptions, withLoading } from "../core/ui.js";
import { state } from "../core/state.js";

let bound = false;
function bindEditorial() {
  if (bound) return;
  bound = true;
  const form = document.getElementById("editorial-form");
  form.addEventListener("submit", (event) => saveEditorial(event).catch((error) => toast(error.message)));
  form.addEventListener("input", renderEditorialReadiness);
  form.addEventListener("change", renderEditorialReadiness);
  document.getElementById("send-editorial-answer").addEventListener("click", () => sendEditorialAnswer().catch((error) => toast(error.message)));
  document.getElementById("start-editorial-production").addEventListener("click", (event) => withLoading(event.currentTarget, "正在发布任务…", () => startEditorialProduction().catch((error) => toast(error.message))));
  document.addEventListener("click", (event) => {
    const editCandidate = event.target.closest("[data-edit-candidate]");
    if (editCandidate) {
      openEditorial(Number(editCandidate.dataset.editCandidate)).catch((error) => toast(error.message));
    }
  });
}

async function loadEditorialRoom(selectedId) {
  setupEditorialGateNavigation();
  setupCandidateTabNavigation();
  const batch = state.batches.find((b) => b.id === state.activeBatchId);
  if (!batch) return;
  state.candidates = await request(`/api/batches/${encodeURIComponent(batch.id)}/candidates`);
  const sidebar = document.getElementById("editorial-candidates");
  if (!sidebar) return;
  // 与选题池同一成稿线：默认只展示 F≥55 的候选，选题池的"显示全部"开关同样生效
  const hiddenCount = state.topicShowAll ? 0 : state.candidates.filter((item) => item.f_score != null && Number(item.f_score) < 55).length;
  const visibleCandidates = state.topicShowAll ? state.candidates : state.candidates.filter((item) => item.f_score == null || Number(item.f_score) >= 55);
  sidebar.innerHTML = visibleCandidates.length
    ? visibleCandidates.map((item) => {
        // 与选题池口径一致：综合候选展示组标题，单热点候选优先展示事件摘要
        const label = !item.composite && item.event_conclusion ? item.event_conclusion : item.hotspot_title;
        return `<button class="editorial-candidate ${Number(selectedId) === item.id ? "active" : ""}" data-edit-candidate="${item.id}"><b>${escapeHtml(item.candidate_id)} · ${escapeHtml(item.brief_status || "DISCUSS")}</b><span>${escapeHtml(label)}</span></button>`;
      }).join("")
    : '<div class="empty-state">选题池为空</div>';
  if (hiddenCount) sidebar.innerHTML += `<div class="editorial-hidden-note">已隐藏 ${hiddenCount} 条低于成稿线（F<55）的候选，可在选题池打开"显示全部"</div>`;
  requestAnimationFrame(updateCandidateTabControls);
  if (visibleCandidates.length) await openEditorial(selectedId || visibleCandidates[0].id);
  else {
    const empty = document.getElementById("editorial-empty");
    const fields = document.getElementById("editorial-fields");
    if (empty) empty.hidden = false;
    if (fields) fields.hidden = true;
  }
}

function updateCandidateTabControls() {
  const sidebar = document.getElementById("editorial-candidates");
  const previous = document.getElementById("candidate-tabs-previous");
  const next = document.getElementById("candidate-tabs-next");
  if (!sidebar || !previous || !next) return;
  const maxScroll = Math.max(0, sidebar.scrollWidth - sidebar.clientWidth);
  previous.disabled = sidebar.scrollLeft <= 1;
  next.disabled = sidebar.scrollLeft >= maxScroll - 1;
}

function setupCandidateTabNavigation() {
  const sidebar = document.getElementById("editorial-candidates");
  const strip = sidebar?.closest(".candidate-tab-strip");
  if (!sidebar || !strip || strip.dataset.navigationBound === "true") return;
  strip.dataset.navigationBound = "true";
  strip.addEventListener("click", (event) => {
    const arrow = event.target.closest(".candidate-tab-arrow");
    if (!arrow) return;
    const direction = arrow.classList.contains("previous") ? -1 : 1;
    sidebar.scrollBy({ left: direction * Math.max(220, sidebar.clientWidth * 0.72), behavior: "smooth" });
  });
  sidebar.addEventListener("scroll", updateCandidateTabControls, { passive: true });
  window.addEventListener("resize", updateCandidateTabControls, { passive: true });
  updateCandidateTabControls();
}

function setupEditorialGateNavigation() {
  const checks = document.getElementById("editorial-gate-checks");
  if (!checks || checks.dataset.navigationBound === "true") return;
  checks.dataset.navigationBound = "true";
  checks.addEventListener("click", (event) => {
    const target = event.target.closest("[data-gate-field]");
    if (!target || target.classList.contains("done")) return;
    const details = document.getElementById("editorial-decision-details");
    if (details) details.open = true;
    const field = document.getElementById("editorial-form")?.elements[target.dataset.gateField];
    if (!field) return;
    requestAnimationFrame(() => {
      field.scrollIntoView({ behavior: "smooth", block: "center" });
      field.focus({ preventScroll: true });
    });
  });
}

async function openEditorial(id) {
  try { state.models = await request("/api/models"); } catch {}
  const candidate = await request(`/api/candidates/${id}`);
  let activeCandidateTab = null;
  $$(".editorial-candidate").forEach((item) => {
    const active = Number(item.dataset.editCandidate) === Number(id);
    item.classList.toggle("active", active);
    if (active) activeCandidateTab = item;
  });
  activeCandidateTab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  requestAnimationFrame(updateCandidateTabControls);
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
  if (title) title.textContent = !candidate.composite && candidate.event_card?.conclusion ? candidate.event_card.conclusion : candidate.hotspot_title;
  const badge = document.getElementById("editorial-composite-badge");
  if (badge) badge.hidden = !candidate.composite;
  const briefState = document.getElementById("brief-state");
  if (briefState) briefState.textContent = editorial.brief_status;
  const provEl = document.getElementById("editorial-provider");
  if (provEl) {
    const preferred = state.models?.providers?.find((p) => p.configured)?.name || state.models?.defaultProvider || "";
    provEl.innerHTML = providerOptions(preferred);
  }
  // 事件卡与原文：选题与事件一对多，原文绑定在事件下，逐事件渲染
  const events = candidate.events || [];
  renderEventCards(events);
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

function renderEventCards(events) {
  const panel = document.getElementById("event-card-panel");
  const list = document.getElementById("event-cards-list");
  if (!panel || !list) return;
  if (!events.length) { panel.hidden = true; return; }
  panel.hidden = false;
  const heading = document.getElementById("event-cards-heading");
  if (heading) heading.textContent = `${events.length} 个关联事件`;
  const fill = (items, renderItem) => Array.isArray(items) && items.length
    ? items.map(renderItem).join("")
    : '<li class="muted">暂无</li>';
  list.innerHTML = events.map((event, index) => {
    const card = event.card;
    const sources = (event.hotspots || []).map((h) => {
      const doc = h.sourceDoc;
      const status = doc ? doc.status : "missing";
      const label = status === "ok" ? `已抓取 ${doc.content_chars} 字` : status === "partial" ? `部分内容 ${doc.content_chars} 字` : doc ? `失败：${doc.error || "未知原因"}` : "未抓取";
      return `<li class="event-source ${escapeHtml(status)}"><div class="event-source-row"><span>${escapeHtml(h.title || "来源")}</span><small>${escapeHtml(h.source || "")} · ${escapeHtml(label)}</small></div>${doc?.content ? `<details class="event-source-excerpt"><summary>查看摘录</summary><p>${escapeHtml(String(doc.content).slice(0, 800))}</p></details>` : ""}</li>`;
    }).join("");
    return `<div class="event-card-item">
      <div class="event-card-item-head"><h4>${escapeHtml(event.title || "")}</h4></div>
      ${card ? `<p class="event-card-conclusion">${escapeHtml(card.conclusion || "")}</p>
      <details open><summary>已确认事实</summary><ul>${fill(card.confirmed_facts, (fact) => `<li>${escapeHtml(fact)}</li>`)}</ul></details>
      <details><summary>来源增量</summary><ul>${fill(card.source_increment, (item) => `<li><b>${escapeHtml(item.source || "来源")}</b>${escapeHtml(item.adds || "")}</li>`)}</ul></details>
      <details><summary>来源分歧</summary><ul>${fill(card.disagreements, (item) => `<li>${escapeHtml(typeof item === "string" ? item : JSON.stringify(item))}</li>`)}</ul></details>
      <details><summary>待核内容</summary><ul>${fill(card.unverified, (item) => `<li>${escapeHtml(item)}</li>`)}</ul></details>`
      : '<p class="muted">事件卡尚未生成，可在批次中执行打标后自动生成。</p>'}
      <details><summary>事件来源（${(event.hotspots || []).length}）</summary><ul class="event-source-list">${sources}</ul></details>
    </div>`;
  }).join("");
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
    { label: "锁定命题", field: "thesis", ok: Boolean(text("thesis")) },
    { label: "事实基座", field: "confirmed_facts", ok: Boolean(text("confirmed_facts")) },
    { label: "未决问题清零", field: "open_questions", ok: !text("open_questions") },
    { label: "可以立即写作", field: "next_action", ok: text("next_action") === "WRITE_NOW" },
    { label: "实践证据", field: "confirmed_experiences", ok: !form.elements.experience_required?.checked || Boolean(text("confirmed_experiences")) },
  ];
  const passed = checks.filter((c) => c.ok).length;
  const ready = passed === checks.length;
  const locked = state.editorialCandidate?.brief_status === "LOCKED" || state.editorialCandidate?.editorial?.brief_status === "LOCKED";
  gate.classList.toggle("ready", ready);
  const count = document.getElementById("editorial-gate-count");
  if (count) count.textContent = `${passed} / ${checks.length}`;
  const list = document.getElementById("editorial-gate-checks");
  if (list) list.innerHTML = checks.map((c) => `<button type="button" class="editorial-gate-check ${c.ok ? "done" : ""}" data-gate-field="${c.field}"${c.ok ? " disabled" : ""}>${escapeHtml(c.label)}</button>`).join("");
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

// main.js 与 topics.js 的跨视图跳转依赖该桥接
window.loadEditorialRoom = loadEditorialRoom;

export default async function loadEditorialRoomView(selectedId) {
  bindEditorial();
  return loadEditorialRoom(selectedId);
}
