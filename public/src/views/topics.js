import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, confirmAction } from "../core/ui.js";
import { state } from "../core/state.js";
import { DRAFT_SCORE_THRESHOLD } from "../core/constants.js";
import { dimensionLabels } from "../core/dimensions.js";

function activeTrack() {
  return document.querySelector(".nav-item.active")?.dataset.view === "social-topics" ? "social_cards" : "article";
}

function trackElements(track) {
  return track === "social_cards"
    ? { count: "social-candidate-count", list: "social-candidate-list" }
    : { count: "candidate-count", list: "candidate-list" };
}

function isDraftEligible(item) { return item.f_score == null || Number(item.f_score) >= DRAFT_SCORE_THRESHOLD; }
const articleScoreLabels = { h: "历史 H", b: "潜力 B", p: "匹配 P", s: "饱和 S", d: "修正 D", f: "总分 F" };
const editorialStatusLabels = {
  DISCUSS: "讨论中", WRITE_NOW: "可成稿", TEST_FIRST: "待实践验证", RESEARCH_FIRST: "待补事实",
  DROP: "暂不推进", LOCKED: "简报已锁定", pooled: "已入池", scored: "已评分", analyzed: "已研判",
};
function statusLabel(value) { return editorialStatusLabels[String(value || "")] || String(value || "待处理"); }

function renderCandidates(candidates, track = activeTrack()) {
  const elements = trackElements(track);
  const articleType=state.topicArticleType||"all";
  const typeFiltered=track!=="article"||articleType==="all"?candidates:candidates.filter((item)=>{
    const independent=["wechat-experience","wechat-tutorial"].includes(String(item.output_mode||""));
    return articleType==="independent"?independent:!independent;
  });
  // 成稿硬门槛 F≥55：低于门槛的候选即使完成编辑会也无法成稿，默认隐藏，可点开查看
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
        // 自定义/事件图文候选不走 Social Fit 评分，编辑入口分别跳转到对应图文页
        const isCustom = track === "social_cards" && String(item.output_mode||"").includes("custom-cards");
        const isEvent = track === "social_cards" && String(item.output_mode||"").includes("event-cards");
        const socialTarget = isCustom ? "social-custom" : isEvent ? "social-event" : "social-editor";
        const socialLabel = isCustom ? "自定义" : isEvent ? "事件" : "工具";
        const isIndependentWriting = track === "article" && ["wechat-experience","wechat-tutorial"].includes(String(item.output_mode||""));
        const primaryAction = track === "article"
          ? isIndependentWriting
            ? `<button class="ink-button candidate-primary-action" data-go="tutorial">查看自主写作 →</button>`
            : `<button class="ink-button candidate-primary-action" data-editorial-id="${item.id}">进入热点事件创作 →</button>`
          : `<button class="ink-button candidate-primary-action" data-social-editor-id="${item.id}" data-social-target="${socialTarget}">进入${socialLabel}图文编辑室 →</button>`;
        const social=item.social_score?.score||{};
        const socialParts=[['工具',social.toolClarity],['场景',social.scenarioValue],['演示',social.demonstrability],['拆页',social.visualPotential],['收藏',social.saveSearchValue],['来源',social.sourceCompleteness],['事实扣',social.factGapPenalty],['权限扣',social.permissionRiskPenalty],['FIT',social.finalScore]];
        const socialChannel = String(item.output_mode||"").startsWith("xiaohongshu") ? "小红书" : "公众号";
        const customChannel = item.output_mode === "wechat-custom-cards" ? "公众号" : "小红书";
        const scoreStrip=track==='social_cards'
          ? (isCustom
            ? `<div class="score-strip"><span>类型<b>自定义图文</b></span><span>渠道<b>${customChannel}</b></span></div>`
            : isEvent
              ? `<div class="score-strip"><span>类型<b>事件图文</b></span><span>渠道<b>${socialChannel}</b></span></div>`
              : `<div class="score-strip social-fit-strip">${socialParts.map(([label,value])=>`<span>${label}<b>${value==null?'—':Number(value).toFixed(Number(value)%1?1:0)}</b></span>`).join('')}</div>`)
          : `<div class="score-strip article-score-strip">${["h", "b", "p", "s", "d", "f"].map((k) => `<span title="${articleScoreLabels[k]}">${articleScoreLabels[k]}<b>${item[k + "_score"] == null ? "—" : Number(item[k + "_score"]).toFixed(item[k + "_score"] % 1 ? 1 : 0)}</b></span>`).join("")}</div>`;
        // 综合候选（维度组）展示组标题（如"腾讯近期动态"），单热点候选优先展示事件摘要，与编辑室口径一致
        const headline = track === "article" && !item.composite && item.event_conclusion ? item.event_conclusion : item.hotspot_title;
        const dimensionLabel = dimensionLabels[item.dimension] || "";
        const articleTypeLabel=isIndependentWriting?(item.output_mode==="wechat-experience"?"心得经验":"使用教程"):"热点事件";
        const card = `<article class="candidate-card ${item.composite ? "composite" : ""}" data-id="${escapeHtml(item.candidate_id)}">
          <h4>${escapeHtml(headline)}${track==="article"?` <span class="dimension-tag">${articleTypeLabel}</span>`:""}${dimensionLabel ? ` <span class="dimension-tag dimension-${escapeHtml(item.dimension)}">${dimensionLabel}</span>` : ""}${item.composite ? ' <span class="composite-tag">综合</span>' : ""}</h4>
          ${track==='article'&&!item.composite&&item.event_conclusion?`<p class="candidate-description">代表报道：${escapeHtml(item.hotspot_title)}</p>`:''}
          ${track==='social_cards'&&item.repository_description?`<p class="candidate-description">${escapeHtml(item.repository_description)}</p>`:''}
          ${track==='social_cards'&&item.social_selection_reason?`<p class="candidate-selection-reason"><b>入选理由</b>${escapeHtml(item.social_selection_reason)}</p>`:''}
          <div class="candidate-meta"><span>${escapeHtml(item.track_pool_role || item.pool_role)}</span><span>${item.composite ? `多源综合${item.hotspot_count ? ` · ${item.hotspot_count}条报道` : ""}` : escapeHtml(item.source_name || item.source_group || item.source)}</span><span>风险 ${escapeHtml(item.risk_level)}</span></div>
          ${overlapByCandidate.has(item.id) ? `<p class="candidate-overlap">与「${overlapByCandidate.get(item.id).map((name) => escapeHtml(name)).join("」「")}」共享事件素材</p>` : ""}
          ${scoreStrip}
          <div class="candidate-actions"><span class="status-pill">${escapeHtml(statusLabel(track === "article" ? (item.brief_status || item.track_status || item.status) : (item.track_status || "pooled")))}</span><div class="candidate-action-cluster">${primaryAction}<details class="candidate-more"><summary aria-label="更多选题操作">更多</summary><button class="text-button muted" data-remove-track="${track}" data-candidate-id="${item.id}">移出本池</button></details></div></div>
        </article>`;
        return card;
      }).join("")
    : `<div class="empty-state">${track === "article" ? (hiddenItems.length ? "当前没有高于成稿线的选题。" : "暂无文章候选。在热点全景创建选题后会进入这里。") : "暂无图文候选。完成事件研判后，Social Fit 前十会自动进入这里。"}</div>`);
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
    const toggle = document.getElementById("toggle-ranking");
    const list = document.getElementById("ranking-list");
    if (!toggle || !list) return;
    // 文案从实际 display 状态推导，避免重载后脱节
    const syncToggleText = () => { toggle.textContent = list.style.display === "block" ? "收起" : `展开(${items.length}条)`; };
    if (list.style.display === "block") renderRankingList(items, list);
    syncToggleText();
    toggle.onclick = function () {
      const expanded = list.style.display !== "block";
      list.style.display = expanded ? "block" : "none";
      syncToggleText();
      if (expanded) renderRankingList(items, list);
    };
    state.rankingItems = items;
  } catch (error) { toast("排行榜加载失败：" + error.message, "error"); }
}

function renderRankingList(items, container) {
  container.innerHTML = items.map(function (item) {
    const reason = item.eliminationReason
      ? `<span class="muted" style="font-size:11px">${escapeHtml(item.eliminationReason)}</span>`
      : '<span class="muted" style="font-size:11px">已入池</span>';
    const cls = item.inPool ? "ranking-row in-pool" : "ranking-row";
    const btn = item.inPool
      ? ""
      : `<button class="text-button" data-ranking-add="${item.hotspotId}" style="font-size:11px">加入候选</button>`;
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
    const toggle=document.getElementById('toggle-social-ranking'),list=document.getElementById('social-ranking-list');
    const syncToggleText=()=>{toggle.textContent=list.style.display==='block'?'收起':`展开(${items.length}条)`;};
    if(list.style.display==='block')renderSocialRankingList(items,list);
    syncToggleText();
    toggle.onclick=()=>{
      const expanded=list.style.display!=='block';
      list.style.display=expanded?'block':'none';
      syncToggleText();
      if(expanded)renderSocialRankingList(items,list);
    };
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
      } catch (error) { toast(error.message); }
    }
    const editor = event.target.closest("[data-social-editor-id]");
    if (editor) {
      await window.go?.(editor.dataset.socialTarget || "social-editor");
      await window.openSocialEditor?.(Number(editor.dataset.socialEditorId));
    }
    const socialAdd=event.target.closest('[data-social-ranking-add]');
    if(socialAdd){
      if(!await confirmAction("将该热点写入图文池？",{confirmText:"加入图文池"}))return;
      const hotspotId=Number(socialAdd.dataset.socialRankingAdd),ranked=(state.socialRankingItems||[]).find((item)=>Number(item.hotspotId)===hotspotId);try{await request(`/api/batches/${encodeURIComponent(state.activeBatchId)}/candidates`,{method:'POST',body:JSON.stringify({hotspotIds:[hotspotId],tracks:['social_cards'],track:'social_cards',socialScoreDetails:ranked?.socialScoreDetails})});toast('已加入图文池');await loadTopicPool();}catch(error){toast(error.message);}
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
        } catch (error) { toast(error.message); }
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
      } catch (error) { toast(error.message); }
    }
  });
}

export default loadTopicPool;
