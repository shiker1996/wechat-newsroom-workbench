import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, confirmAction } from "../core/ui.js";
import { state } from "../core/state.js";
import { DRAFT_SCORE_THRESHOLD } from "../core/constants.js";
import { dimensionLabels } from "../core/dimensions.js";
import { distributionLane, distributionLaneClass, readerStakeText } from "../core/distribution-view.js";

function activeTrack() {
  return document.querySelector(".nav-item.active")?.dataset.view === "social-topics" ? "social_cards" : "article";
}

function trackElements(track) {
  return track === "social_cards"
    ? { count: "social-candidate-count", list: "social-candidate-list" }
    : { count: "candidate-count", list: "candidate-list" };
}

function isDraftEligible(item) { return item.f_score == null || Number(item.f_score) >= DRAFT_SCORE_THRESHOLD; }
const articleScoreFields = [
  ["event_value", "事件 T"], ["research_value", "研判 J"], ["article_value", "文章 A"],
  ["competition_penalty", "竞争 C"], ["f_score", "最终 F"],
];
const editorialStatusLabels = {
  DISCUSS: "讨论中", WRITE_NOW: "可成稿", TEST_FIRST: "待实践验证", RESEARCH_FIRST: "待补事实",
  DROP: "暂不推进", LOCKED: "简报已锁定", pooled: "已入池", scored: "已评分", analyzed: "已研判", needs_source_data: "待补评分资料",
};
const contentClassLabels = {
  news_event: "新闻事件",
  open_source_technology: "开源技术",
  open_source_trend: "开源趋势",
  github_project: "纯项目",
};
function statusLabel(value) { return editorialStatusLabels[String(value || "")] || String(value || "待处理"); }

const researchSignalLabels = {
  timeline_change: "时间线出现变化",
  new_source_evidence: "出现新增信息",
  source_disagreement: "来源之间有分歧",
  unverified_boundary: "仍有信息待确认",
  anomaly: "反常点",
  interest_conflict: "利益冲突",
  divergence: "可发散方向",
};
const researchRelationLabels = {
  same_subject_sequence: "同一主体的连续动作",
  shared_object_comparison: "围绕同一对象的对比",
  action_comparison: "同类动作的对比",
  context_comparison: "同一场合下的不同反应",
  shared_dimension: "共享维度关系",
  trend_sequence: "趋势关系",
  sequence: "前后变化",
  response: "回应关系",
  comparison: "对比关系",
};

function uniqueBy(items, keyOf) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function researchSignalGroups(items = []) {
  const groups = new Map();
  for (const event of items || []) {
    const eventTitle = event.title || event.event_id || "相关事件";
    const semantic = event.internal_research || {};
    for (const signal of [...(semantic.anomalies || event.anomaly_points || []), ...(semantic.interest_conflicts || event.interest_conflicts || []), ...(semantic.divergence_directions || event.divergence_directions || [])]) {
      const key = `${signal.kind || "observation"}|${signal.statement || ""}`;
      const current = groups.get(key) || { ...signal, eventTitles: [] };
      if (!current.eventTitles.includes(eventTitle)) current.eventTitles.push(eventTitle);
      groups.set(key, current);
    }
  }
  return [...groups.values()];
}

function researchSignalList(items = []) {
  if (!items.length) return '<p class="muted">暂无可由现有事件卡直接确认的信号。</p>';
  return `<div class="candidate-research-signal-grid">${items.map((item) => `<article class="candidate-research-signal"><span class="research-signal-label">${escapeHtml(researchSignalLabels[item.kind] || "观察点")}</span><p>${escapeHtml(item.statement || "暂无说明")}</p>${item.eventTitles?.length ? `<small>涉及：${escapeHtml(item.eventTitles.join("、"))}</small>` : ""}</article>`).join("")}</div>`;
}

function relationView(item, titleById) {
  const names = (item.event_ids || []).map((id) => titleById.get(String(id)) || `事件 ${String(id).slice(0, 8)}`).filter(Boolean);
  const temporal = String(item.temporal_order || "");
  const temporalText = item.relation_label || researchRelationLabels[item.relation_kind] || (temporal.includes("_before_") ? "时间上前后相接" : "时间先后仍待确认");
  const dimensions = (item.shared_dimensions || []).filter(Boolean).join("、");
  return { ...item, names, label: researchRelationLabels[item.relation_kind] || researchRelationLabels[item.relation_type] || "事件关系", temporalText, dimensions };
}

function researchContextHtml(context) {
  if (!context) return '<p class="muted">本批次尚未生成阶段 0 讨论研判产物。</p>';
  const scope = context.scope?.events || [];
  const signals = context.internal_research || context.internal_signals || [];
  const relations = context.inter_event_research || context.relations || [];
  const topicCandidates = context.topic_candidates || (context.topic_candidate?.candidate_title ? [context.topic_candidate] : []);
  const titleById = new Map(scope.map((item) => [String(item.event_id), item.title || `事件 ${String(item.event_id).slice(0, 8)}`]));
  const signalGroups = researchSignalGroups(signals);
  const relationGroups = uniqueBy(relations, (item) => `${item.relation_kind || item.relation_type || "relation"}|${[...(item.event_ids || [])].map(String).sort().join(",")}`).map((item) => relationView(item, titleById));
  const relationItemHtml = (item) => `<article class="candidate-research-relation"><div><span class="research-relation-label">${escapeHtml(item.label)}</span><span class="research-confidence">${escapeHtml(item.confidence === "high" ? "较强依据" : item.confidence === "medium" ? "有一定依据" : "待进一步确认")}</span></div><p>${escapeHtml(item.relationship_statement || item.names.join(" 与 "))}</p><small>涉及：${escapeHtml(item.names.join("、"))}${item.dimensions ? ` · 研判依据：${escapeHtml(item.dimensions)}` : ""}</small></article>`;
  const relationHtml = relationGroups.length ? relationGroups.map(relationItemHtml).join("") : '<p class="muted">目前没有足够证据形成前后、回应、对比或趋势关系；不会因为关键词相同强行拼题。</p>';
  const openQuestions = uniqueBy([
    ...(context.evidence_boundary?.open_questions || []),
    ...signals.flatMap((item) => (item.internal_research?.divergence_directions || item.divergence_directions || []).map((signal) => signal.question || signal.statement)),
  ], (item) => item).filter(Boolean);
  const eventNames = uniqueBy(scope.map((item) => item.title).filter(Boolean), (item) => item);
  const stageLabel = topicCandidates.length ? "已形成候选选题" : "研判中";
  const signalCard = (item) => `<article class="candidate-research-signal"><span class="research-signal-label">${escapeHtml(researchSignalLabels[item.kind] || item.label || "研判点")}</span><p>${escapeHtml(item.statement || item.question || "暂无说明")}</p>${item.expected ? `<small>预期：${escapeHtml(item.expected)}</small>` : ""}${item.question && item.statement !== item.question ? `<small>可继续追问：${escapeHtml(item.question)}</small>` : ""}${item.eventTitles?.length ? `<small>涉及：${escapeHtml(item.eventTitles.join("、"))}</small>` : ""}</article>`;
  const signalSection = (title, kind, empty) => { const values = signalGroups.filter((item) => item.kind === kind); return `<section class="research-subsection"><div class="research-section-head"><h4>${title}</h4><span>${values.length} 条</span></div>${values.length ? `<div class="candidate-research-signal-grid">${values.map(signalCard).join("")}</div>` : `<p class="muted">${empty}</p>`}</section>`; };
  const topicHtml = topicCandidates.length ? topicCandidates.map((topic) => `<article class="research-topic-seed"><span class="research-signal-label">候选选题 · ${escapeHtml(topic.topic_type || "讨论命题")}</span><h4>${escapeHtml(topic.candidate_title || topic.title || "未命名候选")}</h4><p><b>核心问题：</b>${escapeHtml(topic.core_question || topic.discussion_question || "待编辑确认")}</p><p><b>切入角度：</b>${escapeHtml(topic.angle || "待编辑确认")}</p><p><b>命题种子：</b>${escapeHtml(topic.thesis_seed || "待编辑确认")}</p><small>仅供编辑会确认，不代表作者最终立场。</small></article>`).join("") : '<p class="muted">当前研判还没有形成候选选题，不展示泛化的新闻复述。</p>';
  return `<div class="candidate-research-summary"><div class="candidate-research-badges"><span>${stageLabel}</span><span>T 榜前 ${escapeHtml(context.scope?.top_k ?? "—")}</span><span>涉及 ${scope.length} 个事件</span>${context.event_value == null ? "" : `<span>事件价值 T ${escapeHtml(context.event_value)}</span>`}</div>
    <p class="muted">先看研判如何形成选题，再回看事件事实。这里不是新闻摘要，也不是作者最终观点。</p>
    <section class="candidate-research-topic-section"><div class="research-section-head"><h3>由研判形成的候选选题</h3><span>${topicCandidates.length} 条</span></div>${topicHtml}</section>
    ${eventNames.length ? `<section class="candidate-research-involved"><h3>涉及哪些事件</h3><div class="research-event-chips">${eventNames.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div></section>` : ""}
    <section class="candidate-research-internal"><div class="research-section-head"><h3>事件内部的研判</h3><span>反常 / 利益冲突 / 可发散</span></div>${signalSection("反常点", "anomaly", "暂无可确认的反常点")}${signalSection("利益冲突", "interest_conflict", "事件卡没有提供可确认的参与方利益冲突；来源分歧不直接等同于利益冲突")}${signalSection("可发散方向", "divergence", "暂无可发散方向")}</section>
    <section class="candidate-research-inter-event"><div class="research-section-head"><h3>事件之间的研判</h3><span>前后 / 回应 / 对比 / 趋势</span></div>${relationHtml}</section>
    <section class="candidate-research-boundary"><div class="research-section-head"><h3>写作前还要确认</h3><span>不是已确认事实</span></div>${openQuestions.length ? `<ul>${openQuestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : '<p class="muted">当前没有额外的待确认问题。</p>'}</section>
    <details class="candidate-research-raw"><summary>查看原始证据字段（高级）</summary><pre>${escapeHtml(JSON.stringify({ scope: context.scope, internal_research: signals, inter_event_research: relations }, null, 2))}</pre></details>
  </div>`;
}

async function openCandidateResearch(candidateId) {
  const dialog = document.getElementById("candidate-research-dialog");
  const title = document.getElementById("candidate-research-title");
  const content = document.getElementById("candidate-research-content");
  if (!dialog || !title || !content) return;
  title.textContent = "正在读取选题研判…";
  content.innerHTML = '<p class="muted">正在读取事件信息与研判内容…</p>';
  dialog.showModal();
  try {
    const candidate = await request(`/api/candidates/${Number(candidateId)}`);
    title.textContent = candidate.event_card?.conclusion || candidate.hotspot_title || "选题研判";
    content.innerHTML = `<section class="candidate-research-candidate"><span class="kicker">${escapeHtml(candidate.candidate_id || "候选选题")}</span><p>${escapeHtml(candidate.angle || "研判角度尚未锁定")}</p><p>${escapeHtml(candidate.thesis || "作者命题尚未锁定")}</p></section>${researchContextHtml(candidate.research_context)}<section class="candidate-research-events"><h3>关联事件信息</h3>${(candidate.events || []).map((event) => `<article><b>${escapeHtml(event.title || "事件")}</b><p>${escapeHtml(event.card?.conclusion || "事件卡暂无结论")}</p>${event.card?.confirmed_facts?.length ? `<ul>${event.card.confirmed_facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>` : ""}</article>`).join("") || '<p class="muted">暂无关联事件信息。</p>'}</section>`;
  } catch (error) {
    title.textContent = "选题研判读取失败";
    content.innerHTML = `<p class="pipeline-error">${escapeHtml(error.message)}</p>`;
  }
}

function renderCandidates(candidates, track = activeTrack()) {
  const elements = trackElements(track);
  const articleType=state.topicArticleType||"all";
  const typeFiltered=track!=="article"||articleType==="all"?candidates:candidates.filter((item)=>{
    const independent=["wechat-experience","wechat-tutorial"].includes(String(item.output_mode||""));
    return articleType==="independent"?independent:!independent;
  });
  // 自动入池筛选线 F≥55：低于评分线的候选默认隐藏；展开后经人工锁定简报仍可成稿
  const hiddenItems = track === "article" && !state.topicShowAll ? typeFiltered.filter((item) => !isDraftEligible(item)) : [];
  const visible = track === "article" && !state.topicShowAll ? typeFiltered.filter(isDraftEligible) : typeFiltered;
  const count = document.getElementById(elements.count);
  if (count) count.textContent = visible.length + " 条";
  const list = document.getElementById(elements.list);
  if (!list) return;
  // 重叠标注：候选之间共享热点（同一事件被多个维度候选覆盖）时给出提示
  const overlapByCandidate = new Map();
  for (const item of visible) {
    const ids = new Set(item.member_hotspot_ids || []);
    if (!ids.size) continue;
    const shared = candidates
      .filter((other) => other.id !== item.id && (other.member_hotspot_ids || []).some((id) => ids.has(id)))
      .map((other) => other.hotspot_title || other.candidate_id)
      .slice(0, 2);
    if (shared.length) overlapByCandidate.set(item.id, shared);
  }
  const hiddenNotice = hiddenItems.length
    ? `<button type="button" class="candidate-hidden-toggle" data-toggle-hidden-candidates>${state.topicShowAll ? "收起低于成稿线的选题" : `已隐藏 ${hiddenItems.length} 条低于成稿线（F<${DRAFT_SCORE_THRESHOLD}）的选题，点击显示`}</button>`
    : "";
  list.innerHTML = hiddenNotice + (visible.length
    ? visible.map((item) => {
        // 图文候选统一展示图文评分；编辑入口只按工具图文/事件图文分流。
        const isCustom = track === "social_cards" && String(item.output_mode||"").includes("custom-cards");
        const isEvent = track === "social_cards" && !isCustom && (String(item.output_mode||"").includes("event-cards") || ["news_event", "open_source_technology", "open_source_trend"].includes(String(item.content_class||"")));
        const socialTarget = isCustom ? "social-custom" : isEvent ? "social-event" : "social-editor";
        const socialLabel = isCustom ? "自定义" : isEvent ? "事件" : "工具";
        const isIndependentWriting = track === "article" && ["wechat-experience","wechat-tutorial"].includes(String(item.output_mode||""));
        const primaryAction = track === "article"
          ? isIndependentWriting
            ? `<button class="ink-button candidate-primary-action" data-go="tutorial">查看自主写作 →</button>`
            : `<button class="ink-button candidate-primary-action" data-editorial-id="${item.id}">进入热点事件创作 →</button>`
          : `<button class="ink-button candidate-primary-action" data-social-editor-id="${item.id}" data-social-target="${socialTarget}">进入${socialLabel}图文编辑室 →</button>`;
        const social=item.social_score?.score||{};
        const socialParts=social.scoreModel==='g_social-v1'
          ? [['事实',social.factSupport],['视觉',social.visualPotential],['读者',social.readerValue],['清晰',social.contentClarity],['就绪',social.productionReadiness],['扣分',Number(social.saturationPenalty||0)+Number(social.riskPenalty||0)+Number(social.missingEvidencePenalty||0)],['G',social.finalScore]]
          : isEvent
            ? [['信息',social.informationDensity],['叙事',social.visualNarrative],['冲突',social.conflictEmotion],['时效',social.timeliness],['受众',social.audienceRelevance],['证据',social.evidenceCompleteness],['评分',social.finalScore ?? item.track_score]]
            : [['工具',social.toolClarity],['场景',social.scenarioValue],['演示',social.demonstrability],['拆页',social.visualPotential],['收藏',social.saveSearchValue],['来源',social.sourceCompleteness],['事实扣',social.factGapPenalty],['权限扣',social.permissionRiskPenalty],['FIT',social.finalScore ?? item.track_score]];
        const socialChannel = String(item.output_mode||"").startsWith("xiaohongshu") ? "小红书" : "公众号";
        const customChannel = item.output_mode === "wechat-custom-cards" ? "公众号" : "小红书";
        const contentClass = String(item.content_class || social.contentClass || "");
        const contentClassLabel = contentClassLabels[contentClass] || "";
        const scoreStrip=track==='social_cards'
          ? (isCustom
            ? `<div class="score-strip"><span>类型<b>自定义图文</b></span><span>评分<b>${social.finalScore ?? item.track_score ?? '—'}</b></span><span>渠道<b>${customChannel}</b></span></div>`
            : `<div class="score-strip social-fit-strip">${socialParts.map(([label,value])=>`<span>${label}<b>${value==null?'—':Number(value).toFixed(Number(value)%1?1:0)}</b></span>`).join('')}</div>`)
          : `<div class="score-strip article-score-strip">${articleScoreFields.map(([field,label]) => `<span title="${label}">${label}<b>${item[field] == null ? "—" : Number(item[field]).toFixed(item[field] % 1 ? 1 : 0)}</b></span>`).join("")}</div>`;
        // 综合候选（维度组）展示组标题（如"腾讯近期动态"），单热点候选优先展示事件摘要，与编辑室口径一致
        const headline = track === "article" && !item.composite && item.event_conclusion ? item.event_conclusion : item.hotspot_title;
        const dimensionLabel = dimensionLabels[item.dimension] || "";
        const articleTypeLabel=isIndependentWriting?(item.output_mode==="wechat-experience"?"心得经验":"使用教程"):contentClassLabel||"热点事件";
        const articleTypeTagClass=isIndependentWriting
          ? "dimension-tag"
          : `dimension-tag content-class-tag content-class-${escapeHtml(contentClass)}`;
        const contentClassTag=track==='social_cards'&&!isCustom&&contentClassLabel
          ? ` <span class="dimension-tag content-class-tag content-class-${escapeHtml(contentClass)}">${contentClassLabel}</span>`
          : "";
        const lane=distributionLane(item.distribution_lane);
        const distributionSummary=track==="article"?`<div class="candidate-distribution" aria-label="分发判断"><span class="distribution-lane distribution-lane-${distributionLaneClass(lane)}">${escapeHtml(lane)}</span><p><b>读者利益</b>${escapeHtml(readerStakeText(item.reader_stake))}${item.reader_stake_score==null?'':` <small>（B 受众 ${Number(item.reader_stake_score).toFixed(1)}/5）</small>`}</p></div>`:"";
        const routeSummary = track === "article" && item.content_route === "social_only"
          ? `<p class="candidate-selection-reason"><b>内容路线</b>默认图文，不自动进入文章池</p>`
          : item.score_status === "needs_source_data"
            ? `<p class="candidate-selection-reason"><b>评分状态</b>${escapeHtml(item.score_warning || "缺少事件价值或事实资料，补齐后再评分")}</p>`
            : "";
        const card = `<article class="candidate-card ${item.composite ? "composite" : ""}" data-id="${escapeHtml(item.candidate_id)}">
          <h4>${escapeHtml(headline)}${track==="article"?` <span class="${articleTypeTagClass}">${articleTypeLabel}</span>`:""}${contentClassTag}${dimensionLabel ? ` <span class="dimension-tag dimension-${escapeHtml(item.dimension)}">${dimensionLabel}</span>` : ""}${item.composite ? ' <span class="composite-tag">综合</span>' : ""}</h4>
          ${track==='article'&&!item.composite&&item.event_conclusion?`<p class="candidate-description">代表报道：${escapeHtml(item.hotspot_title)}</p>`:''}
          ${track==='social_cards'&&item.repository_description?`<p class="candidate-description">${escapeHtml(item.repository_description)}</p>`:''}
          ${track==='social_cards'&&item.social_selection_reason?`<p class="candidate-selection-reason"><b>入选理由</b>${escapeHtml(item.social_selection_reason)}</p>`:''}
          ${distributionSummary}
          ${routeSummary}
          <div class="candidate-meta"><span>${escapeHtml(item.track_pool_role || item.pool_role)}</span><span>${item.composite ? `多源综合${item.hotspot_count ? ` · ${item.hotspot_count}条报道` : ""}` : escapeHtml(item.source_name || item.source_group || item.source)}</span><span>风险 ${escapeHtml(item.risk_level)}</span></div>
          ${overlapByCandidate.has(item.id) ? `<p class="candidate-overlap">与「${overlapByCandidate.get(item.id).map((name) => escapeHtml(name)).join("」「")}」共享事件素材</p>` : ""}
          ${scoreStrip}
          <div class="candidate-actions"><span class="status-pill">${escapeHtml(statusLabel(track === "article" && item.score_status === "needs_source_data" ? "needs_source_data" : track === "article" ? (item.brief_status || item.track_status || item.status) : (item.track_status || "pooled")))}</span><div class="candidate-action-cluster"><button type="button" class="text-button" data-topic-research="${item.id}">查看研判</button>${primaryAction}<details class="candidate-more"><summary aria-label="更多选题操作">更多</summary><button class="text-button muted" data-remove-track="${track}" data-candidate-id="${item.id}">移出本池</button></details></div></div>
        </article>`;
        return card;
      }).join("")
    : `<div class="empty-state">${track === "article" ? (hiddenItems.length ? "当前没有高于成稿线的选题。" : "暂无文章候选。在热点全景创建选题后会进入这里。") : "暂无图文候选。完成事件研判后，达到 G_social 入池线的候选会自动进入这里。"}</div>`);
}

// 文章/图文预选排行榜共用的展开收起：状态用 class 表达，按钮同步 aria-expanded
function bindRankingToggle(toggle, list, items, render) {
  if (!toggle || !list) return;
  // 文案从 class 状态推导，避免重载后脱节
  const sync = () => {
    const expanded = list.classList.contains("expanded");
    toggle.textContent = expanded ? "收起" : `展开(${items.length}条)`;
    toggle.setAttribute("aria-expanded", String(expanded));
  };
  if (list.classList.contains("expanded")) render(items, list);
  sync();
  toggle.onclick = () => {
    const expanded = list.classList.toggle("expanded");
    sync();
    if (expanded) render(items, list);
  };
}

async function loadRanking() {
  const batch = state.batches.find((b) => b.id === state.activeBatchId);
  if (!batch) return;
  try {
    const items = await request(`/api/batches/${encodeURIComponent(batch.id)}/ranking`);
    if (!items.length) return;
    const panel = document.getElementById("ranking-panel");
    if (!panel) return;
    panel.hidden = false;
    bindRankingToggle(document.getElementById("toggle-ranking"), document.getElementById("ranking-list"), items, renderRankingList);
    state.rankingItems = items;
  } catch (error) { toast("排行榜加载失败：" + error.message, "error"); }
}

function renderRankingList(items, container) {
  container.innerHTML = items.map(function (item) {
    const reason = item.eliminationReason
      ? `<span class="muted">${escapeHtml(item.eliminationReason)}</span>`
      : '<span class="muted">已入池</span>';
    const cls = item.inPool ? "ranking-row in-pool" : "ranking-row";
    const btn = item.inPool
      ? ""
      : `<button class="text-button" data-ranking-add="${item.hotspotId}">加入候选</button>`;
    return `<div class="${cls}"><span class="ranking-rank">#${item.rank}</span><span class="ranking-score">${item.score}</span><div class="ranking-title"><b>${escapeHtml(item.title)}</b>${reason}</div><div class="ranking-actions">${btn}</div></div>`;
  }).join("");
}

async function loadSocialRanking() {
  const batch=state.batches.find((item)=>item.id===state.activeBatchId);if(!batch)return;
  try{
    const items=await request(`/api/batches/${encodeURIComponent(batch.id)}/social-ranking`);
    const panel=document.getElementById('social-ranking-panel');
    if(!panel||!items.length){if(panel)panel.hidden=true;return;}
    panel.hidden=false;
    bindRankingToggle(document.getElementById('toggle-social-ranking'),document.getElementById('social-ranking-list'),items,renderSocialRankingList);
    state.socialRankingItems=items;
  }catch(error){toast('图文排行榜加载失败：'+error.message,'error');}
}

function renderSocialRankingList(items,container){
  container.innerHTML=items.map((item)=>{
    const opinion=item.rejectionReason||((item.reasons||[]).join(' · ')||'适合进入图文池');
    const cls=item.inPool?'ranking-row in-pool':'ranking-row';
    const button=item.inPool?'':`<button class="text-button" data-social-ranking-add="${item.hotspotId}">加入图文池</button>`;
    return `<div class="${cls}"><span class="ranking-rank">#${item.socialRank}</span><span class="ranking-score">${item.socialScore}</span><div class="ranking-title"><b>${escapeHtml(item.title)}</b><span class="muted">${escapeHtml(opinion)}</span></div><div class="ranking-actions">${button}</div></div>`;
  }).join('');
}

async function loadTopicPool() {
  const batch = state.batches.find((b) => b.id === state.activeBatchId);
  if (!batch) return;
  const track = activeTrack();
  const list = document.getElementById(trackElements(track).list);
  if (list) {
    list.setAttribute("aria-busy", "true");
    list.innerHTML = '<div class="empty-state">正在加载候选选题…</div>';
  }
  try {
    const [detail, candidates] = await Promise.all([
      request(`/api/batches/${encodeURIComponent(batch.id)}`),
      request(`/api/batches/${encodeURIComponent(batch.id)}/candidates?track=${encodeURIComponent(track)}`),
    ]);
    state.currentBatch = detail;
    state.candidates = candidates;
    renderCandidates(candidates, track);
    if (track === "article") loadRanking(); else loadSocialRanking();
  } finally {
    list?.setAttribute("aria-busy", "false");
  }
}

if (!window.__candidateTrackActionsBound) {
  window.__candidateTrackActionsBound = true;
  document.addEventListener("click", async (event) => {
    const researchDialog = document.getElementById("candidate-research-dialog");
    if (event.target.closest("[data-close-candidate-research]") || event.target === researchDialog) {
      researchDialog?.close();
      return;
    }
    const research = event.target.closest("[data-topic-research]");
    if (research) {
      await openCandidateResearch(research.dataset.topicResearch);
      return;
    }
    const toggleHidden = event.target.closest("[data-toggle-hidden-candidates]");
    if (toggleHidden) {
      state.topicShowAll = !state.topicShowAll;
      renderCandidates(state.candidates || [], activeTrack());
      return;
    }
    const articleType=event.target.closest("[data-article-type]");
    if(articleType){
      state.topicArticleType=articleType.dataset.articleType;
      document.querySelectorAll("[data-article-type]").forEach((button)=>button.classList.toggle("active",button===articleType));
      renderCandidates(state.candidates||[],"article");
      return;
    }
    const remove = event.target.closest("[data-remove-track]");
    if (remove) {
      const label = remove.dataset.removeTrack === "social_cards" ? "图文池" : "文章池";
      if (!await confirmAction(`确认只从${label}移出？另一个池及候选主体不会删除。`, { confirmText: "移出" })) return;
      try {
        await request(`/api/candidates/${Number(remove.dataset.candidateId)}/tracks/${encodeURIComponent(remove.dataset.removeTrack)}`, { method: "DELETE" });
        toast(`已移出${label}`);
        await loadTopicPool();
      } catch (error) { toast(error.message, "error"); }
    }
    const editor = event.target.closest("[data-social-editor-id]");
    if (editor) {
      await window.go?.(editor.dataset.socialTarget || "social-editor");
      await window.openSocialEditor?.(Number(editor.dataset.socialEditorId));
    }
    const socialAdd=event.target.closest('[data-social-ranking-add]');
    if(socialAdd){
      if(!await confirmAction("将该热点写入图文池？",{confirmText:"加入图文池"}))return;
      const hotspotId=Number(socialAdd.dataset.socialRankingAdd),ranked=(state.socialRankingItems||[]).find((item)=>Number(item.hotspotId)===hotspotId);try{await request(`/api/batches/${encodeURIComponent(state.activeBatchId)}/candidates`,{method:'POST',body:JSON.stringify({hotspotIds:[hotspotId],tracks:['social_cards'],track:'social_cards',socialScoreDetails:ranked?.socialScoreDetails})});toast('已加入图文池');await loadTopicPool();}catch(error){toast(error.message, "error");}
    }
    const rankingAdd = event.target.closest("[data-ranking-add]");
    if (rankingAdd) {
      const hid = Number(rankingAdd.dataset.rankingAdd);
      if (hid && state.activeBatchId) {
        if (!await confirmAction("将该热点写入文章候选池？", { confirmText: "加入候选" })) return;
        try {
          await request(`/api/batches/${encodeURIComponent(state.activeBatchId)}/candidates`, { method: "POST", body: JSON.stringify({ hotspotIds: [hid] }) });
          toast("已加入候选池");
          await loadTopicPool();
        } catch (error) { toast(error.message, "error"); }
      }
    }
    const removeCandidate = event.target.closest("[data-remove-candidate]");
    if (removeCandidate) {
      const id = Number(removeCandidate.dataset.removeCandidate);
      if (!await confirmAction("确认移除此候选？", { confirmText: "移除" })) return;
      try {
        await request(`/api/candidates/${id}`, { method: "DELETE" });
        toast("已移除");
        await loadTopicPool();
        await window.loadEditorialRoom?.();
      } catch (error) { toast(error.message, "error"); }
    }
  });
}

export default loadTopicPool;
