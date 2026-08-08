import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { poll } from "../core/poll.js";
import { streamChat } from "../core/stream-chat.js";
import { escapeHtml, toast, providerOptions, withLoading, confirmAction, ensureModelOptions } from "../core/ui.js";
import { state } from "../core/state.js";
import { DRAFT_SCORE_THRESHOLD, JOB_POLL_INTERVAL_MS } from "../core/constants.js";
import { loadSkillSelect, loadStageSkillControls, selectedStageSkills } from "../core/skill-selection.js";

const editorialStatusLabels = {
  DISCUSS: "讨论中", WRITE_NOW: "可成稿", TEST_FIRST: "待实践验证", RESEARCH_FIRST: "待补事实",
  DROP: "暂不推进", LOCKED: "简报已锁定", pooled: "已入池", scored: "已评分", analyzed: "已研判",
};
function statusLabel(value) { return editorialStatusLabels[String(value || "")] || String(value || "待处理"); }

let bound = false;
let editorialDirty = false;
function bindEditorial() {
  if (bound) return;
  bound = true;
  const form = document.getElementById("editorial-form");
  form.addEventListener("submit", (event) => saveEditorial(event).catch((error) => toast(error.message)));
  form.addEventListener("input", () => { editorialDirty = true; renderEditorialReadiness(); });
  // 与 editor.js 一致：决策底稿有未保存修改时拦截关闭/刷新（bindEditorial 仅执行一次，无监听泄漏）
  window.addEventListener("beforeunload", (event) => { if (!editorialDirty) return; event.preventDefault(); event.returnValue = ""; });
  form.addEventListener("change", () => { renderEditorialReadiness(); updateEditorialSkillSummary(); });
  form.addEventListener("stage-skills-loaded", updateEditorialSkillSummary);
  document.getElementById("reset-editorial-skills")?.addEventListener("click",()=>{
    const writer=document.getElementById("editorial-writer-skill");
    if(writer)writer.value="";
    document.querySelectorAll("#editorial-stage-skills [data-stage-skill]").forEach((select)=>{select.value="";});
    updateEditorialSkillSummary();
  });
  document.getElementById("close-editorial-skills")?.addEventListener("click",()=>{
    document.querySelector(".creation-skill-settings")?.removeAttribute("open");
  });
  document.getElementById("send-editorial-answer").addEventListener("click", () => sendEditorialAnswer().catch((error) => toast(error.message)));
  document.getElementById("run-editorial-prepare")?.addEventListener("click", () => prepareEditorialSources().catch((error) => {
    toast(error.message);
    if (state.editorialCandidate) updateEditorialPrepareGate(state.editorialCandidate);
  }));
  document.getElementById("skip-editorial-prepare")?.addEventListener("click", () => {
    editorialPrepareState.skipped = true;
    if (state.editorialCandidate) updateEditorialPrepareGate(state.editorialCandidate);
  });
  document.getElementById("start-editorial-production").addEventListener("click", (event) => withLoading(event.currentTarget, "正在发布任务…", () => startEditorialProduction().catch((error) => toast(error.message))));
  document.addEventListener("click", async (event) => {
    const editCandidate = event.target.closest("[data-edit-candidate]");
    if (editCandidate) {
      const nextId = Number(editCandidate.dataset.editCandidate);
      const currentId = Number(document.getElementById("editorial-form")?.elements.candidateId?.value);
      // 切换候选前保护未保存的决策底稿手改内容
      if (editorialDirty && nextId !== currentId && !await confirmAction("当前候选的决策底稿有未保存的修改，切换后将丢失。仍要切换吗？", { confirmText: "放弃修改并切换" })) return;
      openEditorial(nextId).catch((error) => toast(error.message));
    }
  });
}

function updateEditorialSkillSummary(){
  const summary=document.getElementById("editorial-skill-summary");
  if(!summary)return;
  const writer=document.getElementById("editorial-writer-skill");
  const writerLabel=writer?.value?writer.selectedOptions[0]?.textContent?.split(" · ")[0]:"系统推荐主写";
  const stageSelects=[...document.querySelectorAll("#editorial-stage-skills [data-stage-skill]")];
  const overridden=stageSelects.filter((select)=>select.value).length;
  summary.textContent=`${writerLabel} · ${overridden?`${overridden} 个加工阶段已调整`:`${stageSelects.length||4} 个加工阶段使用默认配置`}`;
}

async function loadEditorialRoom(selectedId) {
  setupEditorialGateNavigation();
  setupCandidateTabNavigation();
  const loading = document.getElementById("editorial-loading");
  const empty = document.getElementById("editorial-empty");
  const fields = document.getElementById("editorial-fields");
  if (loading) loading.hidden = false;
  if (empty) empty.hidden = true;
  if (fields) fields.hidden = true;
  const batch = state.batches.find((b) => b.id === state.activeBatchId);
  if (!batch) {
    if (loading) loading.hidden = true;
    if (empty) {
      empty.innerHTML = '请先选择或建立一个批次。';
      empty.hidden = false;
    }
    return;
  }
  try {
    state.candidates = await request(`/api/batches/${encodeURIComponent(batch.id)}/candidates?kind=hotspot`);
  } catch (error) {
    if (loading) loading.hidden = true;
    if (empty) {
      empty.textContent = `候选加载失败：${error.message}`;
      empty.hidden = false;
    }
    throw error;
  }
  const sidebar = document.getElementById("editorial-candidates");
  if (!sidebar) return;
  // 与选题池同一成稿线：默认只展示 F≥55 的候选，选题池的"显示全部"开关同样生效
  const hiddenCount = state.topicShowAll ? 0 : state.candidates.filter((item) => item.f_score != null && Number(item.f_score) < DRAFT_SCORE_THRESHOLD).length;
  const visibleCandidates = state.topicShowAll ? state.candidates : state.candidates.filter((item) => item.f_score == null || Number(item.f_score) >= DRAFT_SCORE_THRESHOLD);
  sidebar.innerHTML = visibleCandidates.length
    ? visibleCandidates.map((item) => {
        // 与选题池口径一致：综合候选展示组标题，单热点候选优先展示事件摘要
        const label = !item.composite && item.event_conclusion ? item.event_conclusion : item.hotspot_title;
        return `<button class="editorial-candidate ${Number(selectedId) === item.id ? "active" : ""}" data-edit-candidate="${item.id}"><b>${escapeHtml(item.candidate_id)} · ${escapeHtml(statusLabel(item.brief_status || "DISCUSS"))}</b><span>${escapeHtml(label)}</span></button>`;
      }).join("")
    : '<div class="empty-state">选题池为空</div>';
  if (hiddenCount) sidebar.innerHTML += `<div class="editorial-hidden-note">已隐藏 ${hiddenCount} 条低于成稿线（F<55）的候选，可在选题池打开"显示全部"</div>`;
  requestAnimationFrame(updateCandidateTabControls);
  if (visibleCandidates.length) {
    const requested = visibleCandidates.find((item) => Number(item.id) === Number(selectedId));
    await openEditorial(requested?.id || visibleCandidates[0].id);
    if (loading) loading.hidden = true;
  }
  else {
    if (loading) loading.hidden = true;
    if (empty) empty.innerHTML = state.candidates.length
      ? `当前批次有 ${state.candidates.length} 个文章候选，但均低于成稿线（F&lt;55）。<a href="#topics">前往文章选题池查看</a>`
      : '当前批次还没有文章候选。<a href="#overview">前往热点全景创建选题</a>';
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
  await ensureModelOptions();
  const candidate = await request(`/api/candidates/${id}`);
  await Promise.all([
    loadSkillSelect(document.getElementById("editorial-writer-skill"), `/api/candidates/${id}/writer-skills`),
    loadStageSkillControls(document.getElementById("editorial-stage-skills"), `/api/candidates/${id}/stage-skills`),
  ]);
  updateEditorialSkillSummary();
  let activeCandidateTab = null;
  $$(".editorial-candidate").forEach((item) => {
    const active = Number(item.dataset.editCandidate) === Number(id);
    item.classList.toggle("active", active);
    if (active) activeCandidateTab = item;
  });
  activeCandidateTab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  requestAnimationFrame(updateCandidateTabControls);
  const empty = document.getElementById("editorial-empty");
  const loading = document.getElementById("editorial-loading");
  const fields = document.getElementById("editorial-fields");
  if (loading) loading.hidden = true;
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
  if (briefState) briefState.textContent = statusLabel(editorial.brief_status);
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
  if (editorialPrepareState.candidateId !== candidate.id) editorialPrepareState = { candidateId: candidate.id, skipped: false };
  state.editorialCandidate = candidate;
  editorialDirty = false;
  renderEditorialReadiness();
  updateEditorialPrepareGate(candidate);
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
  // 与 lib/domain/open-questions.mjs 保持一致：模型常把"没有未决问题"写成
  // "无"或"无。……（补充说明）"，按清零处理；不误伤"无版权数据能否使用？"这类真问题。
  const isNoneOpenQuestions = (value) => !value || /^(?:无|没有了?|暂无|无未决问题|none|n\/a)(?:[。．.，,、：:；;\s]|$)/i.test(value);
  const gate = document.getElementById("editorial-production-gate");
  if (!gate) return;
  const form = document.getElementById("editorial-form");
  if (!form) return;
  const text = (name) => form.elements[name]?.value?.trim() || "";
  const checks = [
    { label: "锁定命题", field: "thesis", ok: Boolean(text("thesis")) },
    { label: "事实基座", field: "confirmed_facts", ok: Boolean(text("confirmed_facts")) },
    { label: "未决问题清零", field: "open_questions", ok: isNoneOpenQuestions(text("open_questions")) },
    { label: "可以立即写作", field: "next_action", ok: text("next_action") === "WRITE_NOW" },
    { label: "实践证据", field: "confirmed_experiences", ok: !form.elements.experience_required?.checked || Boolean(text("confirmed_experiences")) },
  ];
  const passed = checks.filter((c) => c.ok).length;
  const ready = passed === checks.length;
  const locked = state.editorialCandidate?.brief_status === "LOCKED" || state.editorialCandidate?.editorial?.brief_status === "LOCKED";
  gate.classList.toggle("ready", ready);
  document.querySelector(".editorial-focus-grid")?.classList.toggle("is-ready", ready);
  const replyButton = document.getElementById("send-editorial-answer");
  if (replyButton) {
    replyButton.classList.toggle("ink-button", !ready);
    replyButton.classList.toggle("ghost-button", ready);
  }
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

// 编辑室两步走：先备料（抓取全部事件来源原文），再开始对话。
// 后端 POST /api/candidates/:id/source 默认 force:false，已有快照的来源零成本跳过。
let editorialPrepareState = { candidateId: null, skipped: false };

function editorialSourceGaps(candidate) {
  let missing = 0, failed = 0;
  for (const event of candidate.events || []) {
    for (const h of event.hotspots || []) {
      if (!h.sourceDoc) missing += 1;
      else if (h.sourceDoc.status !== "ok" && h.sourceDoc.status !== "partial") failed += 1;
    }
  }
  return { missing, failed };
}

function updateEditorialPrepareGate(candidate) {
  const gate = document.getElementById("editorial-prepare");
  const answer = document.getElementById("editorial-answer");
  const send = document.getElementById("send-editorial-answer");
  if (!gate || !candidate) return;
  const gaps = editorialSourceGaps(candidate);
  const blocked = gaps.missing > 0 && !editorialPrepareState.skipped;
  gate.hidden = !blocked;
  if (blocked) {
    const text = document.getElementById("editorial-prepare-text");
    if (text) text.textContent = `本选题还有 ${gaps.missing} 个来源未抓取原文${gaps.failed ? `（另有 ${gaps.failed} 个抓取失败，可在对话中补充链接）` : ""}。建议先备料，AI 编辑将基于完整原文提问。`;
  }
  if (answer) {
    answer.disabled = blocked;
    answer.placeholder = blocked ? "备料完成后即可开始对话" : "回答当前问题；首次进入时可以留空，让 AI 先提问。可粘贴报道链接，系统将自动抓取纳入事实基座";
  }
  if (send) send.disabled = blocked;
}

async function prepareEditorialSources() {
  const candidate = state.editorialCandidate;
  if (!candidate) return;
  const button = document.getElementById("run-editorial-prepare");
  const text = document.getElementById("editorial-prepare-text");
  if (text) text.textContent = "正在抓取来源原文，来源较多时需要几十秒…";
  await withLoading(button, "正在抓取…", () =>
    request(`/api/candidates/${candidate.id}/source`, { method: "POST", body: JSON.stringify({ force: false }) }));
  await openEditorial(candidate.id);
  toast("备料完成，可以开始对话");
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
  await streamChat({
    url: `/api/candidates/${candidateId}/ai/editorial/stream`,
    body: { provider: document.getElementById("editorial-provider")?.value || "", answer },
    messages,
    button,
    busyLabel: "AI 正在回应…",
    doneLabel: "发送回答 / 让 AI 提问",
    title: "AI 编辑",
    errorLabel: "编辑会",
    rethrow: true,
    onDone: async () => {
      const answerEl = document.getElementById("editorial-answer");
      if (answerEl) answerEl.value = "";
      await openEditorial(candidateId);
      toast("编辑会决策已更新");
    },
  });
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
  editorialDirty = false;
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
    const result = await request(`/api/candidates/${candidateId}/ai/article`, { method: "POST", body: JSON.stringify({
      provider: document.getElementById("editorial-provider")?.value || "",
      skillId: document.getElementById("editorial-writer-skill")?.value || "",
      stageSkills: selectedStageSkills(document.getElementById("editorial-stage-skills")),
    }) });
    toast("完整成稿链已启动");
    // 成稿链长达数分钟：打开进度弹窗，轮询输出写入 #production-job-console
    document.getElementById("production-job-dialog")?.showModal();
    if (result?.id) {
      // 独立轮询句柄（不用 state.jobTimer，避免与 editor.js 的 clearTimeout 互相清理）
      poll(async () => {
        const job = await request(`/api/jobs/${result.id}`);
        const console = document.getElementById("production-job-console");
        if (!console) return true; // 弹窗已关闭/离开视图，结束轮询
        const logs = job.logs || [{ at: job.updated_at || new Date().toISOString(), message: job.progress }];
        console.textContent = logs.map((l) => `${l.at.slice(11, 19)}  ${l.message}`).join("\n") || job.progress;
        console.scrollTop = console.scrollHeight;
        if (job.status === "running" || job.status === "queued") return false;
        toast(job.status === "completed" ? "完整成稿链已完成" : `任务失败：${job.error || "未取得有效结果"}`, job.status === "completed" ? "success" : "error");
        if (job.status === "completed") {
          document.getElementById("production-job-dialog")?.close();
          window.go?.("editor").then(() => window.loadWritingDeskForCandidate?.(candidateId));
        }
        return true;
      }, { interval: JOB_POLL_INTERVAL_MS }).promise.catch((err) => toast(err.message, "error"));
    }
  } catch (err) { toast(err.message, "error"); }
}

// main.js 与 topics.js 的跨视图跳转依赖该桥接
window.loadEditorialRoom = loadEditorialRoom;

export default async function loadEditorialRoomView(selectedId) {
  bindEditorial();
  return loadEditorialRoom(selectedId);
}
