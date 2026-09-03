import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { poll } from "../core/poll.js";
import { streamChat } from "../core/stream-chat.js";
import { escapeHtml, toast, providerOptions, withLoading, confirmAction, ensureModelOptions } from "../core/ui.js";
import { state } from "../core/state.js";
import { JOB_POLL_INTERVAL_MS } from "../core/constants.js";
import { loadSkillSelect, loadStageSkillControls, selectedStageSkills } from "../core/skill-selection.js";
import { distributionLane, distributionLaneClass, readerStakeText } from "../core/distribution-view.js";
import { renderMarkdown } from "../core/markdown.js";

const editorialStatusLabels = {
  DISCUSS: "讨论中", WRITE_NOW: "可成稿", TEST_FIRST: "待实践验证", RESEARCH_FIRST: "待补事实",
  DROP: "暂不推进", LOCKED: "简报已锁定", pooled: "已入池", scored: "已评分", analyzed: "已研判",
};
function statusLabel(value) { return editorialStatusLabels[String(value || "")] || String(value || "待处理"); }

let bound = false;
let editorialDirty = false;
let editorialRequestPending = false;
function bindEditorial() {
  if (bound) return;
  bound = true;
  const form = document.getElementById("editorial-form");
  form.addEventListener("submit", (event) => saveEditorial(event).catch((error) => toast(error.message, "error")));
  form.addEventListener("input", () => { editorialDirty = true; renderEditorialReadiness(); });
  // 与 editor.js 一致：决策底稿有未保存修改时拦截关闭/刷新（bindEditorial 仅执行一次，无监听泄漏）
  window.addEventListener("beforeunload", (event) => { if (!editorialDirty) return; event.preventDefault(); event.returnValue = ""; });
  form.addEventListener("change", () => {
    renderEditorialReadiness();
    updateEditorialSkillSummary();
  });
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
  document.getElementById("send-editorial-answer").addEventListener("click", () => sendEditorialAnswer().catch((error) => toast(error.message, "error")));
  document.getElementById("run-editorial-prepare")?.addEventListener("click", () => prepareEditorialSources().catch((error) => {
    toast(error.message, "error");
    if (state.editorialCandidate) updateEditorialPrepareGate(state.editorialCandidate);
  }));
  document.getElementById("skip-editorial-prepare")?.addEventListener("click", () => {
    editorialPrepareState.skipped = true;
    if (state.editorialCandidate) updateEditorialPrepareGate(state.editorialCandidate);
  });
  document.getElementById("start-editorial-production").addEventListener("click", (event) => withLoading(event.currentTarget, "正在发布任务…", () => startEditorialProduction().catch((error) => toast(error.message, "error"))));
  document.addEventListener("click", async (event) => {
    const openTarget = event.target.closest("[data-editorial-open]");
    if (openTarget) {
      event.preventDefault();
      const target = openTarget.dataset.editorialOpen === "research"
        ? document.getElementById("editorial-research-panel")
        : document.getElementById("editorial-decision-details");
      if (target) {
        target.open = true;
        requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
      return;
    }
    const editCandidate = event.target.closest("[data-edit-candidate]");
    if (editCandidate) {
      const nextId = Number(editCandidate.dataset.editCandidate);
      const currentId = Number(document.getElementById("editorial-form")?.elements.candidateId?.value);
      // 切换候选前保护未保存的决策底稿手改内容
      if (editorialDirty && nextId !== currentId && !await confirmAction("当前候选的决策底稿有未保存的修改，切换后将丢失。仍要切换吗？", { confirmText: "放弃修改并切换" })) return;
      openEditorial(nextId).catch((error) => toast(error.message, "error"));
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
  // 编辑室与选题池保持一致：所有已生成候选都可进入编辑，不按 F 再做页面隐藏。
  const visibleCandidates = state.candidates;
  sidebar.innerHTML = visibleCandidates.length
      ? visibleCandidates.map((item) => {
        // 与选题池口径一致：综合候选展示组标题，单热点候选优先展示事件摘要
        const label = !item.composite && item.event_conclusion ? item.event_conclusion : item.hotspot_title;
        const lane=distributionLane(item.distribution_lane);
        return `<button class="editorial-candidate ${Number(selectedId) === item.id ? "active" : ""}" data-edit-candidate="${item.id}"><b>${escapeHtml(item.candidate_id)} · ${escapeHtml(statusLabel(item.brief_status || "DISCUSS"))}</b><span class="editorial-candidate-lane distribution-lane-${distributionLaneClass(lane)}">${escapeHtml(lane)}</span><span class="editorial-candidate-title">${escapeHtml(label)}</span></button>`;
      }).join("")
    : '<div class="empty-state">选题池为空</div>';
  requestAnimationFrame(updateCandidateTabControls);
  if (visibleCandidates.length) {
    const requested = visibleCandidates.find((item) => Number(item.id) === Number(selectedId));
    await openEditorial(requested?.id || visibleCandidates[0].id);
    if (loading) loading.hidden = true;
  }
  else {
    if (loading) loading.hidden = true;
    if (empty) empty.innerHTML = '当前批次还没有文章候选。<a href="#overview">前往热点全景创建选题</a>';
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
    if (target.dataset.gateField === "adopted_research_points") {
      const researchPanel = document.getElementById("editorial-research-panel");
      if (researchPanel) {
        researchPanel.open = true;
        requestAnimationFrame(() => researchPanel.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
      return;
    }
    const field = document.getElementById("editorial-form")?.elements[target.dataset.gateField];
    if (!field) return;
    requestAnimationFrame(() => {
      field.scrollIntoView({ behavior: "smooth", block: "center" });
      field.focus({ preventScroll: true });
    });
  });
}

function researchPointText(point) {
  return String(point?.statement || point?.question || point?.relationship_statement || point?.label || "").trim();
}

function parseResearchPoints(value) {
  if (Array.isArray(value)) return value.filter((item) => item && researchPointText(item));
  if (typeof value === "string") {
    try { return parseResearchPoints(JSON.parse(value)); } catch { return value.trim() ? [{ statement: value.trim() }] : []; }
  }
  return value && typeof value === "object" ? [value] : [];
}

function buildResearchPointOptions(context) {
  if (!context || typeof context !== "object") return [];
  const options = [];
  const signals = Array.isArray(context.internal_research || context.internal_signals) ? (context.internal_research || context.internal_signals) : [];
  const relations = Array.isArray(context.inter_event_research || context.relations) ? (context.inter_event_research || context.relations) : [];
  const names = new Map((context.scope?.events || []).map((event) => [String(event.event_id), event.title || "相关事件"]));
  const add = (point) => {
    if (!point.statement || options.some((item) => item.point_id === point.point_id)) return;
    options.push(point);
  };
  signals.forEach((event) => {
    const research = event.internal_research || {};
    const groups = [
      ["anomaly", "反常点", research.anomalies || event.anomaly_points || []],
      ["interest_conflict", "利益冲突", research.interest_conflicts || event.interest_conflicts || []],
      ["divergence", "可发散方向", research.divergence_directions || event.divergence_directions || []],
    ];
    groups.forEach(([kind, label, items]) => (Array.isArray(items) ? items : []).forEach((item, index) => {
      const statement = researchPointText(item);
      if (!statement) return;
      const eventId = String(event.event_id || "");
      add({
        point_id: String(item.signal_id || item.internal_signal_id || `internal:${kind}:${eventId}:${index}`),
        scope: "internal", kind, label, statement,
        expected: item.expected || item.baseline || "", observed: item.observed || "", gap: item.gap || "", baseline: item.baseline || "", impact: item.impact || "", why_it_matters: item.why_it_matters || "", issue: item.issue || "", difference: item.difference || "", parties: item.parties || [], supporting_facts: item.supporting_facts || item.confirmed_facts || [], evidence_boundary: item.evidence_boundary || "", confidence: item.confidence || "", question: item.question || "",
        event_id: eventId, event_ids: eventId ? [eventId] : [], event_title: event.title || names.get(eventId) || "相关事件",
        signal_id: item.signal_id || item.internal_signal_id || "", signal_refs: item.signal_refs || [], material_ids: item.material_ids || [], material_refs: item.material_refs || [],
        evidence_source_ids: item.evidence_source_ids || [], evidence_source_refs: item.evidence_source_refs || [], evidence_levels: item.evidence_levels || [], writing_role: kind === "anomaly" ? "opening_conflict" : kind === "interest_conflict" ? "mechanism" : "reader_impact",
      });
    }));
  });
  relations.forEach((item, index) => {
    const statement = researchPointText(item);
    if (!statement) return;
    const kind = item.relation_kind || "comparison";
    add({
      point_id: String(item.relation_id || `inter_event:${kind}:${index}`),
      scope: "inter_event", kind, label: item.relation_label || ({ sequence: "前后关系", response: "回应关系", comparison: "对比关系", trend: "趋势关系", counterexample: "反例关系" }[kind] || "事件间关系"), statement,
      expected: Array.isArray(item.differences) ? item.differences.join("；") : "", difference: Array.isArray(item.differences) ? item.differences.join("；") : "", impact: item.insight || "", why_it_matters: item.insight || "", comparison_basis: item.comparison_basis || [], evidence_boundary: item.evidence_boundary || "", confidence: item.confidence || "",
      event_ids: item.event_ids || [], reference_event_ids: item.reference_event_ids || [],
      event_title: (item.event_ids || []).map((id) => names.get(String(id))).filter(Boolean).join("、"),
      relation_id: item.relation_id || "", relation_refs: item.relation_refs || [], evidence_source_ids: item.evidence_source_ids || [], evidence_source_refs: item.evidence_source_refs || [], evidence_levels: item.evidence_levels || [], writing_role: kind === "counterexample" ? "counterexample" : kind === "comparison" ? "mechanism" : "reader_impact",
    });
  });
  return options;
}

function selectedResearchPoints() {
  const form = document.getElementById("editorial-form");
  return parseResearchPoints(form?.elements.adopted_research_points?.value || "[]");
}

function renderSelectedResearchSummary(points = selectedResearchPoints()) {
  const summary = document.getElementById("editorial-research-selection-summary");
  const focusSummary = document.getElementById("editorial-focus-research-summary");
  const labels = points.map((point) => `<span class="editorial-research-selection-chip"><b>${escapeHtml(point.label || (point.scope === "inter_event" ? "事件间关系" : "事件内研判"))}</b><span class="editorial-research-selection-chip-text">${escapeHtml(researchPointText(point))}</span></span>`).join("");
  if (summary) {
    summary.innerHTML = points.length
      ? `<span class="editorial-research-selection-count">编辑室 Agent 已采用 ${points.length} 条研判拓展点</span><button type="button" class="text-button" data-editorial-open="research">查看研判</button>`
      : '<span class="muted">等待编辑室 Agent 根据本篇角度和命题选择研判拓展点</span><button type="button" class="text-button" data-editorial-open="research">查看研判</button>';
  }
  if (focusSummary) focusSummary.innerHTML = points.length ? labels : '<span class="muted">等待编辑室 Agent 自动选择研判拓展点</span>';
}

function renderResearchPointSelection(options, selected) {
  const selectedKeys = new Set(selected.map((point) => String(point.point_id || "")));
  if (!options.length) return '<section class="editorial-research-selection"><div class="research-section-head"><h4>研判拓展点</h4><span>0 条</span></div><p class="muted">当前研判没有可供编辑室 Agent 采用的反常、利益冲突、发散方向或事件间关系。</p></section>';
  const groups = [
    ["事件内研判", options.filter((item) => item.scope === "internal")],
    ["事件间关系", options.filter((item) => item.scope === "inter_event")],
  ];
  return `<section class="editorial-research-selection"><div class="research-section-head"><div><h4>研判拓展点</h4><small>由编辑室 Agent 根据已经确认的角度和命题自动选择；本页只读展示，不需要手动勾选。</small></div><span>${selected.length} / ${options.length} 已采用</span></div>${groups.filter(([, items]) => items.length).map(([title, items]) => `<div class="editorial-research-selection-group"><b>${title}</b><div class="editorial-research-selection-grid">${items.map((item) => `<article class="editorial-research-selection-card-wrap ${selectedKeys.has(String(item.point_id)) ? "is-adopted" : ""}"><div class="editorial-research-selection-card"><span class="editorial-research-selection-status">${selectedKeys.has(String(item.point_id)) ? "已采用" : "未采用"}</span><span><strong>${escapeHtml(item.label || "研判点")}</strong><em>${escapeHtml(item.event_title || "相关事件")}</em><span>${escapeHtml(item.statement)}</span>${item.expected ? `<small>基线 / 预期：${escapeHtml(item.expected)}</small>` : ""}${item.observed ? `<small>观察：${escapeHtml(item.observed)}</small>` : ""}${item.gap ? `<small>落差：${escapeHtml(item.gap)}</small>` : ""}${item.difference ? `<small>比较差异：${escapeHtml(item.difference)}</small>` : ""}${item.impact ? `<small>影响：${escapeHtml(item.impact)}</small>` : ""}</span></div></article>`).join("")}</div></div>`).join("")}</section>`;
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
  for (const key of ["editor_question", "confirmed_facts", "research_basis", "author_opinions", "confirmed_experiences", "rejected_angles", "open_questions", "forbidden_claims"]) {
    const el = form.elements[key];
    if (el) el.value = editorial[key] || "";
  }
  const adoptedResearchInput = form.elements.adopted_research_points;
  const adoptedResearchPoints = parseResearchPoints(editorial.adopted_research_points);
  if (adoptedResearchInput) adoptedResearchInput.value = JSON.stringify(adoptedResearchPoints);
  const cid = document.getElementById("editorial-candidate-id");
  if (cid) cid.textContent = candidate.candidate_id;
  const title = document.getElementById("editorial-hotspot-title");
  if (title) title.textContent = !candidate.composite && candidate.event_card?.conclusion ? candidate.event_card.conclusion : candidate.hotspot_title;
  const badge = document.getElementById("editorial-composite-badge");
  if (badge) badge.hidden = !candidate.composite;
  const lane=distributionLane(candidate.distribution_lane);
  const laneEl=document.getElementById("editorial-distribution-lane");
  if(laneEl){laneEl.textContent=lane;laneEl.className=`distribution-lane distribution-lane-${distributionLaneClass(lane)}`;}
  const stakeEl=document.getElementById("editorial-reader-stake");
  if(stakeEl)stakeEl.textContent=readerStakeText(candidate.reader_stake);
  const briefState = document.getElementById("brief-state");
  if (briefState) briefState.textContent = statusLabel(editorial.brief_status);
  const provEl = document.getElementById("editorial-provider");
  if (provEl) {
    const preferred = state.models?.defaultProvider || state.models?.providers?.find((p) => p.configured)?.name || "";
    provEl.innerHTML = providerOptions(preferred);
  }
  // 事件卡与原文：选题与事件一对多，原文绑定在事件下，逐事件渲染
  const events = candidate.events || [];
  renderEventCards(events);
  renderEditorialResearch(candidate.research_context, adoptedResearchPoints);
  // Messages
  const messages = document.getElementById("editorial-messages");
  if (messages) {
    messages.innerHTML = candidate.messages?.length
      ? candidate.messages.map((m) => `<div class="editorial-message ${escapeHtml(m.role)}"><b>${m.role === "user" ? "你" : "AI 编辑"}</b>${m.role === "user" ? `<p>${escapeHtml(m.content).replaceAll("\n", "<br>")}</p>` : `<div class="reply-text markdown-body">${renderMarkdown(m.content)}</div>`}</div>`).join("")
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

function renderEditorialResearch(context, selected = []) {
  const panel = document.getElementById("editorial-research-panel");
  const content = document.getElementById("editorial-research-content");
  if (!panel || !content) return;
  if (!context) { renderSelectedResearchSummary(selected); panel.hidden = true; return selected; }
  const signals = context.internal_research || context.internal_signals || [];
  const relations = context.inter_event_research || context.relations || [];
  const materials = context.verified_research_materials || context.research_materials || [];
  const reports = context.research_reports || [];
  const topics = context.topic_candidates || (context.topic_candidate?.candidate_title ? [context.topic_candidate] : []);
  const names = new Map((context.scope?.events || []).map((event) => [String(event.event_id), event.title || "相关事件"]));
  const referenceNames = new Map((context.reference_events || []).map((item) => [String(item.reference_id), item.title || "外部参考"]));
  const relationById = new Map(relations.map((item) => [String(item.relation_id || ""), item]));
  const topicRelationHtml = (topic) => {
    const linked = [...new Set((topic.relation_ids || []).map(String))].map((id) => relationById.get(id)).filter(Boolean);
    if (!linked.length) return "";
    return `<p><b>关系来源：</b>${linked.map((item) => `${escapeHtml(item.relation_id || "关系")} · ${escapeHtml(item.relation_label || "事件间关系")}：${escapeHtml(item.relationship_statement || "已验证事件间关系")}`).join("；")}</p>`;
  };
  const semanticSignals = (kind) => signals.flatMap((event) => {
    const research = event.internal_research || {};
    const values = kind === "anomaly" ? (research.anomalies || event.anomaly_points || []) : kind === "interest_conflict" ? (research.interest_conflicts || event.interest_conflicts || []) : (research.divergence_directions || event.divergence_directions || []);
    return values.map((item) => ({ ...item, eventTitle: event.title || event.event_id || "相关事件" }));
  });
  const signalList = (kind, title, empty) => {
    const items = semanticSignals(kind);
    return `<section class="editorial-research-subsection"><div class="research-section-head"><h5>${title}</h5><span>${items.length} 条</span></div>${items.length ? `<ul>${items.map((item) => `<li><b>${escapeHtml(item.statement || item.question || "")}</b>${item.expected ? `<small>预期：${escapeHtml(item.expected)}</small>` : ""}${item.question && item.statement !== item.question ? `<small>可继续追问：${escapeHtml(item.question)}</small>` : ""}${item.evidence_count > 1 ? `<small>已合并 ${item.evidence_count} 条证据</small>` : ""}<small>涉及：${escapeHtml(item.eventTitle)}</small></li>`).join("")}</ul>` : `<p class="muted">${empty}</p>`}</section>`;
  };
  const topicHtml = topics.length ? topics.map((topic) => `<article class="editorial-research-topic"><span class="research-signal-label">候选选题 · ${escapeHtml(topic.topic_type || "讨论命题")}</span><h5>${escapeHtml(topic.candidate_title || topic.title || "未命名候选")}</h5><p><b>核心问题：</b>${escapeHtml(topic.core_question || topic.discussion_question || "待编辑确认")}</p><p><b>切入角度：</b>${escapeHtml(topic.angle || "待编辑确认")}</p><p><b>命题种子：</b>${escapeHtml(topic.thesis_seed || "待编辑确认")}</p>${topicRelationHtml(topic)}<small>仅供本轮编辑会确认，不代表作者最终立场。</small></article>`).join("") : '<p class="muted">当前研判还没有形成候选命题，请先补充事实或关系依据。</p>';
  const materialHtml = materials.length ? `<section class="editorial-research-materials"><div class="research-section-head"><h4>已验证写作素材</h4><span>${materials.length} 条</span></div><ul>${materials.map((item) => `<li><b>${escapeHtml(item.statement || item.interpretation || "暂无说明")}</b>${item.expected ? `<small>预期：${escapeHtml(item.expected)}</small>` : ""}${item.observed ? `<small>观察：${escapeHtml(item.observed)}</small>` : ""}${item.gap ? `<small>落差：${escapeHtml(item.gap)}</small>` : ""}${item.interpretation ? `<small>写作解释：${escapeHtml(item.interpretation)}</small>` : ""}${item.writing_angles?.length ? `<small>可写角度：${escapeHtml(item.writing_angles.join("；"))}</small>` : ""}${item.thesis_seeds?.length ? `<small>观点种子：${escapeHtml(item.thesis_seeds.join("；"))}</small>` : ""}</li>`).join("")}</ul></section>` : '<section class="editorial-research-materials"><p class="muted">当前没有经过证据验证的写作素材。</p></section>';
  const reportHtml = reports.length ? `<section class="editorial-research-reports"><div class="research-section-head"><h4>模型原始研判报告</h4><span>${reports.length} 个事件 · 默认收起</span></div>${reports.map((item) => `<details><summary>${escapeHtml(item.title || item.event_id || "事件研判")}</summary><pre>${escapeHtml(item.report_markdown || "模型未返回报告")}</pre></details>`).join("")}</section>` : "";
  const relationHtml = relations.length ? relations.map((item) => {
    const eventNames = [
      ...(item.event_ids || []).map((id) => names.get(String(id)) || "相关事件"),
      ...(item.reference_event_ids || []).map((id) => referenceNames.get(String(id)) || "外部参考"),
    ];
    return `<article class="editorial-research-relation"><span class="research-relation-label">${escapeHtml(item.relation_label || ({ sequence: "前后变化", response: "回应关系", comparison: "对比关系", trend: "趋势关系", counterexample: "反例关系" }[item.relation_kind] || "事件间研判"))}</span><p>${escapeHtml(item.relationship_statement || "这组事件存在可继续验证的变化关系。")}</p>${item.differences?.length ? `<small>具体差异：${escapeHtml(item.differences.join("；"))}</small>` : ""}<small>涉及：${escapeHtml(eventNames.join("、"))}${item.reference_event_ids?.length ? ` · 外部参考：${escapeHtml(item.reference_event_ids.join("、"))}` : ""}</small></article>`;
  }).join("") : '<p class="muted">暂无足够证据形成前后、回应、对比或趋势关系。</p>';
  const referenceEvents = context.reference_events || [];
  const referenceHtml = referenceEvents.length ? `<section class="editorial-research-references"><div class="research-section-head"><h4>外部参考材料</h4><span>仅作辅助证据</span></div><p class="muted">参考事件只用于验证趋势、对比或反例，不能直接写入文章事实。</p><ul>${referenceEvents.map((item) => `<li>${escapeHtml(item.title || item.reference_id || "未命名参考")}${item.evidence_level ? `（${escapeHtml(item.evidence_level)}）` : ""}</li>`).join("")}</ul></section>` : "";
  panel.hidden = false;
  const options = buildResearchPointOptions(context);
  // 没有作者或编辑室 Agent 的明确选择时保持全空；研判点要在角度和命题明确后再决定。
  const effectiveSelected = selected;
  content.innerHTML = `<div class="candidate-research-badges"><span>候选研判输入</span><span>T 榜前 ${escapeHtml(context.scope?.top_k ?? "—")}</span><span>事件价值 T ${escapeHtml(context.event_value ?? "—")}</span></div><p class="muted">下面的内容用于编辑会确认角度和命题，不是事实结论，也不能替代原文核验。</p>${renderResearchPointSelection(options, effectiveSelected)}<section class="editorial-research-topic-section"><div class="research-section-head"><h4>由研判形成的候选选题</h4><span>${topics.length} 条</span></div>${topicHtml}</section>${reportHtml}${materialHtml}<section class="editorial-research-internal"><div class="research-section-head"><h4>事件内部的研判</h4><span>反常 / 利益冲突 / 可发散</span></div>${signalList("anomaly", "反常点", "暂无可确认的反常点")}${signalList("interest_conflict", "利益冲突", "暂无可确认的参与方利益冲突；来源分歧不直接等同于利益冲突")}${signalList("divergence", "可发散方向", "暂无可发散方向")}</section><section class="editorial-research-inter-event"><div class="research-section-head"><h4>事件之间的研判</h4><span>前后 / 回应 / 对比 / 趋势 / 反例</span></div>${relationHtml}</section>${referenceHtml}`;
  renderSelectedResearchSummary(effectiveSelected);
  return effectiveSelected;
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
       <details><summary>已确认事实</summary><ul>${fill(card.confirmed_facts, (fact) => `<li>${escapeHtml(fact)}</li>`)}</ul></details>
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
      container.innerHTML = "<b>历史覆盖</b>" + similar.map((s) => `<div><button type="button" class="inline-button danger" data-cal-article="${s.id}">${escapeHtml(s.title.slice(0, 30))}</button> <span class="muted">${escapeHtml(s.batchDate)} · ${escapeHtml(s.poolRole || "")}</span></div>`).join("");
      container.hidden = false;
    } else {
      container.hidden = true;
    }
  } catch { container.hidden = true; }
}

function renderEditorialReadiness() {
  // 与 server/features/articles/domain/editorial-readiness.mjs 的 evaluateEditorialReadiness 保持一致：
  // 7 个必填表单项填好，加上“禁止写入”无内容时的明确留空，即可成稿；2 个选填项只展示不阻塞。
  const PLACEHOLDER = /(?:待定|未定|待确认|待锁定|暂无|尚未|需作者|待作者|待主线|未明确|TBD)/i;
  // 与 server/features/articles/domain/editorial-readiness.mjs 保持一致：
  // 长文本里的“未明确/待核”等可能是具体事实边界，只有短占位回复才判为不合格。
  const substantive = (value) => {
    const text = String(value || "").trim();
    return Boolean(text) && !(text.length <= 30 && PLACEHOLDER.test(text));
  };
  const researchBasisComplete = (value) => substantive(value)
    && /(?:反常|异常|矛盾|冲突|利益|成本|责任|发散|前后|回应|对比|趋势|连续|变化|差异|突变|越界|失效|配置错误|奖励破解)/u.test(String(value || ""))
    && /(?:事件|报道|来源|两起|多起|同一|[0-9]{1,4}\s*[年月日./-]|[0-9]+\s*[·.]\s*[0-9]+)/u.test(String(value || ""));
  const confirmedFactsComplete = (value) => substantive(value)
    && !/^(?:已确认(?:该事件)?的?(?:事实|事实链条)|事实链条|已确认事实|见上文|同上)[。；：:\s]*$/u.test(String(value || "").trim());
  const forbiddenClaimsComplete = (value) => !String(value || "").trim() || substantive(value);
  const gate = document.getElementById("editorial-production-gate");
  if (!gate) return;
  const form = document.getElementById("editorial-form");
  if (!form) return;
  const text = (name) => form.elements[name]?.value?.trim() || "";
  const adoptedPoints = parseResearchPoints(form.elements.adopted_research_points?.value || "[]");
  const checks = [
    { label: "已确认事实", field: "confirmed_facts", ok: confirmedFactsComplete(text("confirmed_facts")) },
    { label: "明确观点", field: "author_opinions", ok: substantive(text("author_opinions")) },
    { label: "写作角度", field: "angle", ok: substantive(text("angle")) },
    { label: "锁定命题", field: "thesis", ok: substantive(text("thesis")) },
    { label: "采用的研判拓展点", field: "adopted_research_points", ok: adoptedPoints.length > 0 },
    { label: "采用的研判主线", field: "research_basis", ok: researchBasisComplete(text("research_basis")) },
    { label: "禁止写入", field: "forbidden_claims", ok: forbiddenClaimsComplete(text("forbidden_claims")) },
    { label: "已确认实践（选填）", field: "confirmed_experiences", ok: substantive(text("confirmed_experiences")), optional: true },
    { label: "否定角度/反证边界（选填）", field: "rejected_angles", ok: substantive(text("rejected_angles")), optional: true },
  ];
  const required = checks.filter((c) => !c.optional);
  const passed = required.filter((c) => c.ok).length;
  const ready = passed === required.length;
  const locked = state.editorialCandidate?.brief_status === "LOCKED" || state.editorialCandidate?.editorial?.brief_status === "LOCKED";
  gate.classList.toggle("ready", ready);
  document.querySelector(".editorial-focus-grid")?.classList.toggle("is-ready", ready);
  const replyButton = document.getElementById("send-editorial-answer");
  if (replyButton) {
    replyButton.classList.toggle("ink-button", !ready);
    replyButton.classList.toggle("ghost-button", ready);
  }
  const count = document.getElementById("editorial-gate-count");
  if (count) count.textContent = `${passed} / ${required.length}`;
  const list = document.getElementById("editorial-gate-checks");
  if (list) list.innerHTML = checks.map((c) => `<button type="button" class="editorial-gate-check ${c.ok ? "done" : ""}"${c.field ? ` data-gate-field="${c.field}"` : ""}${c.ok || !c.field ? " disabled" : ""}>${escapeHtml(c.label)}</button>`).join("");
  const title = document.getElementById("editorial-production-title");
  if (title) title.textContent = ready ? "编辑决策已完整，可以进入成稿" : "尚未达到成稿条件";
  const hint = document.getElementById("editorial-production-hint");
  if (hint) hint.textContent = ready ? "点击后会保存当前决策、锁定文章简报，并运行完整成稿链。" : `还需完成：${required.filter((c) => !c.ok).map((c) => c.label).join("、")}`;
  const btn = document.getElementById("start-editorial-production");
  if (btn) {
    btn.hidden = !ready;
    btn.disabled = editorialRequestPending;
    btn.textContent = editorialRequestPending ? "等待 AI 编辑回应…" : (locked ? "重新运行完整成稿链" : "确认简报并开始成稿");
  }
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
  if (editorialRequestPending) return;
  const form = document.getElementById("editorial-form");
  if (!form) return;
  const candidateId = Number(form.elements.candidateId.value);
  if (!candidateId) return;
  const answerEl = document.getElementById("editorial-answer");
  const answer = answerEl?.value?.trim() || "";
  const button = document.getElementById("send-editorial-answer");
  const messages = document.getElementById("editorial-messages");
  if (!messages || !button) return;
  const empty = messages.querySelector(".editorial-chat-empty");
  if (empty) empty.remove();
  if (answer) messages.insertAdjacentHTML("beforeend", `<div class="editorial-message user"><b>你</b><p>${escapeHtml(answer).replaceAll("\n", "<br>")}</p></div>`);
  // 先消费本轮输入，再等待流式回复，避免回复完成后的刷新/重渲染把旧答案再次带入下一轮。
  if (answerEl) answerEl.value = "";
  editorialRequestPending = true;
  renderEditorialReadiness();
  try {
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
      confirmation: /[A-Za-z]:\\|(?:^|\s)\//.test(answer) ? "local-project-read" : "",
      onDone: async (data) => {
        await openEditorial(candidateId);
        toast(data?.ignoredBecauseLocked ? "简报已锁定，本次 AI 回复未覆盖成稿决策" : "编辑会决策已更新");
      },
    });
  } finally {
    editorialRequestPending = false;
    renderEditorialReadiness();
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
  const fields = ["editor_question", "confirmed_facts", "research_basis", "author_opinions", "confirmed_experiences", "rejected_angles", "forbidden_claims"];
  const editorial = Object.fromEntries(fields.map((k) => [k, form.elements[k].value]));
  editorial.adopted_research_points = selectedResearchPoints();
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
  if (editorialRequestPending) return toast("请等待 AI 编辑回应完成后再开始成稿");
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
