import { state } from "../core/state.js";
import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, providerOptions } from "../core/ui.js";
import loadOverview, { stages, renderBatchSwitcher, localDate } from "./dashboard.js";

export function openNewBatch() {
  const dialog = $("#batch-dialog");
  $("[name=date]", dialog).value = localDate();
  dialog.showModal();
}

export function openBreakingBatch() {
  const dialog = $("#breaking-batch-dialog");
  const form = $("#breaking-batch-form");
  form.reset();
  $$("input[name=requestedTrack]", form).forEach((item) => (item.checked = true));
  dialog.showModal();
}

export async function createBreakingBatch(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const requestedTracks = data.getAll("requestedTrack");
  if (!requestedTracks.length) return toast("请至少选择文章或图文方向");
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true; submit.textContent = "正在建立…";
  try {
    const batch = await request("/api/batches/breaking", { method: "POST", body: JSON.stringify({
      title: data.get("title"), urls: String(data.get("urls") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
      note: data.get("note"), requestedTracks,
    }) });
    state.activeBatchId = batch.id;
    $("#breaking-batch-dialog").close();
    toast("突发专题已建立，请开始语义打标");
    await loadOverview();
    openBatch(batch.id);
  } catch (error) {
    toast(error.message);
  } finally {
    submit.disabled = false; submit.textContent = "建立突发专题";
  }
}

export async function createBatch(event) {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.currentTarget));
  const batch = await request("/api/batches", { method: "POST", body: JSON.stringify(input) });
  state.activeBatchId = batch.id;
  $("#batch-dialog").close();
  toast("今日批次已建立");
  await loadOverview();
  openBatch(batch.id);
}

export async function openBatch(id, mode) {
  if (!state.models) state.models = await request("/api/models");
  const batch = await request(`/api/batches/${encodeURIComponent(id)}`);
  state.activeBatchId = id;
  renderBatchSwitcher();
  state.currentBatch = batch;
  const [stage] = stages[batch.stage] ?? [batch.stage];
  const ai = batch.ai_status || { tagged: 0, total: batch.hotspots.length, latestResearch: null };
  const preferred = state.models.providers.find((item) => item.configured)?.name || state.models.defaultProvider;
  const researchDone = ai.latestResearch?.status === "completed";
  const cards = batch.event_cards || { count: 0, total: 0 };
  const cardsReady = cards.total > 0 && cards.count >= cards.total;
  const latestAiRun = batch.ai_runs?.[0];
  const isBreaking = batch.batch_type === "breaking";
  let breakingAnalysis = null;
  if (isBreaking) { try { breakingAnalysis = await request(`/api/batches/${encodeURIComponent(id)}/breaking-analysis`); } catch {} }
  const materialLinks = (batch.hotspots || []).flatMap((item) => item.materials || []);
  const intakeSection = isBreaking
    ? `<section class="drawer-section breaking-intake-section"><div class="pipeline-heading"><div><span class="kicker">BREAKING INTAKE</span><h3>突发专题素材</h3></div><span class="composite-badge">独立批次</span></div><p>该事件不参与每日热点的 8+2 竞争；研判后按创建时选择的方向进入文章池或图文池。</p><div class="breaking-material-list">${materialLinks.map((item, index) => `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer"><b>${String(index + 1).padStart(2, "0")}</b><span>${escapeHtml(item.title || item.url)}</span><em class="material-status ${escapeHtml(item.status || "pending")}">${item.status === "ok" ? "已抓取" : item.status === "error" ? "抓取失败" : "待抓取"}</em></a>`).join("")}</div><details class="breaking-add-material"><summary>补充更多素材链接</summary><textarea id="breaking-more-materials" rows="3" placeholder="每行一个链接"></textarea><button class="outline-button" data-breaking-add-material>添加素材</button></details></section>`
    : `<section class="drawer-section"><h3>采集今日热点</h3><p>按业务来源独立执行与记账；GitHub 包含 Trending、增长发现及热点提及仓库。采集完成后将自动进入语义打标与事件研判，无需逐节点击。</p><div class="check-row"><label><input type="checkbox" name="source" value="reddit" checked> Reddit</label><label><input type="checkbox" name="source" value="rsshub" checked> RSSHub</label><label><input type="checkbox" name="source" value="github" checked> GitHub</label></div><div class="check-row"><label>时间范围 <select id="collect-max-age">${[24, 48, 72, 120, 168].map((hours) => `<option value="${hours}"${(Number(batch.max_age_hours) || 24) === hours ? " selected" : ""}>${hours / 24} 天</option>`).join("")}</select></label></div><div style="display:flex;gap:8px"><button class="primary-button" data-collect>一键采集并研判</button></div></section>`;
  const analysis = breakingAnalysis?.analysis;
  const recommendationLabel = { recommend: "建议入池", conditional: "补充材料后可入池", hold: "建议暂缓" };
  const breakingAnalysisSection = isBreaking ? `<section class="drawer-section breaking-analysis-section">
    <div class="pipeline-heading"><div><span class="kicker">BREAKING ANALYSIS</span><h3>事实基座与双评分</h3></div><select id="batch-ai-provider" aria-label="分析模型">${providerOptions(preferred)}</select></div>
    ${analysis ? `<p class="breaking-summary">${escapeHtml(analysis.eventSummary || "")}</p>
      <div class="breaking-score-grid">
        <article><span>ARTICLE FIT</span><strong>${analysis.article.finalScore}</strong><b>${escapeHtml(recommendationLabel[analysis.article.recommendation] || "")}</b><p>${escapeHtml(analysis.article.recommendedType)} · ${escapeHtml(analysis.article.thesis || analysis.article.angle)}</p></article>
        <article><span>SOCIAL FIT</span><strong>${analysis.social.finalScore}</strong><b>${escapeHtml(recommendationLabel[analysis.social.recommendation] || "")}</b><p>${escapeHtml(analysis.social.recommendedFormat)} · 建议 ${analysis.social.recommendedPages} 页</p></article>
      </div>
      <details class="breaking-fact-details"><summary>查看事实边界与来源审计</summary>
        <h4>已确认事实</h4><ul>${(analysis.factBase.confirmedFacts || []).map((item) => `<li>${escapeHtml(item.claim)}</li>`).join("") || "<li>暂无可确认事实</li>"}</ul>
        <h4>尚未核实的主张</h4><ul>${(analysis.factBase.claims || []).map((item) => `<li>${escapeHtml(item.speaker ? item.speaker + "：" + item.claim : item.claim)}</li>`).join("") || "<li>无</li>"}</ul>
        <h4>仍需补充</h4><ul>${[...(analysis.sourceAudit.issues || []), ...(analysis.sourceAudit.neededMaterials || [])].map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>当前没有明确缺口</li>"}</ul>
      </details>
      <div class="breaking-route-box"><b>确认进入选题池</b><label><input type="checkbox" name="breakingRoute" value="article" ${analysis.requestedTracks?.includes("article") ? "checked" : ""}> 文章</label><label><input type="checkbox" name="breakingRoute" value="social_cards" ${analysis.requestedTracks?.includes("social_cards") ? "checked" : ""}> 图文</label><button class="ink-button" data-breaking-route>确认分流</button><button class="ghost-button" data-breaking-analyze>重新分析</button></div>`
      : `<div class="breaking-analysis-empty"><p>系统将抓取全部素材，区分事实、主张与作者观点，并分别计算文章适配度和事件型图文适配度。</p><button class="ink-button" data-breaking-analyze>抓取素材并生成双评分</button></div>`}
    ${latestAiRun?.status === "failed" ? `<div class="pipeline-error"><b>最近任务失败 · ${escapeHtml(latestAiRun.type)}</b><span>${escapeHtml(latestAiRun.error || latestAiRun.progress)}</span></div>` : ""}
  </section>` : "";
  const regularAiSection = !isBreaking ? `<section class="drawer-section ai-pipeline-section"><div class="pipeline-heading"><div><span class="kicker">AI NEWSROOM FLOW</span><h3>打标与事件研判</h3></div><select id="batch-ai-provider" aria-label="批次模型">${providerOptions(preferred)}</select></div>
      <div class="pipeline-steps"><div class="${batch.hotspots.length ? "done" : "active"}"><b>01</b><span>采集<small>${batch.freshness?.fresh ?? batch.hotspots.length} 条有效${batch.freshness?.stale ? ` · ${batch.freshness.stale} 条旧闻归档` : ""}</small></span></div><i>→</i><div class="${ai.tagged === ai.total && ai.total ? "done" : ai.tagged ? "active" : ""}"><b>02</b><span>语义打标<small>${ai.tagged} / ${ai.total}</small></span></div><i>→</i><div class="${cardsReady ? "done" : cards.count ? "active" : ""}"><b>03</b><span>事件卡<small>${cards.count} / ${cards.total}</small></span></div><i>→</i><div class="${researchDone ? "done" : ai.latestResearch?.status === "running" ? "active" : ""}"><b>04</b><span>事件研判<small>${researchDone ? "已完成" : "8+2 / H·B·P·S·D·F"}</small></span></div></div>
      <p>打标覆盖全量热点，生成事件语义指纹、地区、风险和预评估证据；研判随后完成全量聚类、核心 8 + 黑马 2、探索脑暴与临时复排。</p>
      <div class="pipeline-actions"><button class="primary-button" data-ai-tag ${!batch.hotspots.length ? "disabled" : ""}>${ai.tagged ? "继续打标" : "开始打标"}</button><button class="ghost-button" data-ai-retag ${!batch.hotspots.length ? "disabled" : ""}>重新打标全部</button><button class="ghost-button" data-ai-event-cards ${!ai.tagged ? "disabled" : ""}>${cards.count ? "重新生成事件卡" : "生成事件卡"}</button><button class="ink-button" data-ai-research ${ai.tagged < ai.total || !ai.total ? "disabled" : ""}>${researchDone ? "重新执行事件研判" : "生成事件研判"}</button></div>
      ${ai.tagged < ai.total && ai.total ? `<small class="pipeline-gate">还差 ${ai.total - ai.tagged} 条完整语义标注，完成后才能进入事件研判。</small>` : ""}
      ${latestAiRun?.status === "failed" ? `<div class="pipeline-error"><b>最近任务失败 · ${escapeHtml(latestAiRun.type)}</b><span>${escapeHtml(latestAiRun.error || latestAiRun.progress)}</span></div>` : ""}
    </section>` : "";
  $("#batch-detail").innerHTML = `<div class="drawer-inner">
    <header class="drawer-head"><div><span class="kicker">${escapeHtml(batch.batch_date)} · ${escapeHtml(stage)}</span><h2>${escapeHtml(batch.title)}</h2><p>${escapeHtml(batch.note || "暂无值班备注")}</p></div><button class="close-button" data-close-drawer>×</button></header>
    ${intakeSection}
    <section class="drawer-section"><h3>来源记录</h3>${batch.sources.length ? batch.sources.map((item) => `<div class="source-row ${item.status}"><i></i><div><strong>${escapeHtml(item.source)}</strong><small>${escapeHtml(item.error || item.ended_at || "执行中")}</small></div><b>${item.item_count}</b></div>`).join("") : '<p class="story-meta">尚未运行采集。</p>'}</section>
    ${breakingAnalysisSection}${regularAiSection}
    <section class="drawer-section"><h3>本批产物</h3><p>${batch.artifacts.length} 份已索引产物 · ${batch.hotspots.length} 条热点</p></section>
    <section class="drawer-section"><h3>执行日志</h3><div class="job-console" id="job-console">等待任务…</div></section>
  </div>`;
  $("#batch-drawer").showModal();
  if (mode === "archive") {
    const secs = document.getElementById("batch-detail").querySelectorAll(".drawer-section");
    secs.forEach((s) => {
      const h3 = s.querySelector("h3");
      if ((h3 && h3.textContent === "采集今日热点") || (h3 && h3.textContent === "执行日志")) { s.style.display = "none"; }
      else if (h3 && h3.textContent === "打标与事件研判") {
        s.querySelectorAll(".pipeline-actions,.pipeline-gate,.pipeline-error,#batch-ai-provider").forEach((b) => { b.style.display = "none"; });
      }
    });
  }
}

export async function startCollection() {
  const sources = $$("input[name=source]:checked", $("#batch-detail")).map((item) => item.value);
  if (!sources.length) return toast("至少选择一个数据源");
  const job = await request(`/api/batches/${encodeURIComponent(state.currentBatch.id)}/collect`, { method: "POST", body: JSON.stringify({ sources, maxAgeHours: Number($("#collect-max-age")?.value) || undefined }) });
  $("#job-console").textContent = "任务已入队…";
  pollJob(job.id);
}

export async function startBatchAi(type) {
  const provider = $("#batch-ai-provider")?.value;
  if (!provider) return toast("请先在模型中心配置服务商");
  const path = type === "research" ? "research" : type === "event-cards" ? "event-cards" : "tag";
  const payload = { provider, background: true, force: type === "retag" || (type === "event-cards" && state.currentBatch?.event_cards?.count > 0) };
  const job = await request(`/api/batches/${encodeURIComponent(state.currentBatch.id)}/ai/${path}`, { method: "POST", body: JSON.stringify(payload) });
  $("#job-console").textContent = type === "research" ? "事件研判任务已入队…" : type === "event-cards" ? "事件卡任务已入队…" : "语义打标任务已入队…";
  pollJob(job.id);
}

export async function startBreakingAnalysis() {
  const provider = $("#batch-ai-provider")?.value;
  if (!provider) return toast("请先在模型中心配置服务商");
  const job = await request(`/api/batches/${encodeURIComponent(state.currentBatch.id)}/ai/breaking-analysis`, { method: "POST", body: JSON.stringify({ provider }) });
  $("#job-console").textContent = "突发素材分析任务已入队…";
  pollJob(job.id);
}

export async function confirmBreakingRoute() {
  const tracks = $$("input[name=breakingRoute]:checked", $("#batch-detail")).map((item) => item.value);
  if (!tracks.length) return toast("请至少选择一个进入方向");
  await request(`/api/batches/${encodeURIComponent(state.currentBatch.id)}/breaking-analysis/route`, { method: "POST", body: JSON.stringify({ tracks }) });
  toast("已按确认方向进入选题池");
  await openBatch(state.currentBatch.id);
}

export async function addBreakingMaterials() {
  const input = $("#breaking-more-materials");
  const urls = String(input?.value || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (!urls.length) return toast("请输入素材链接");
  await request(`/api/batches/${encodeURIComponent(state.currentBatch.id)}/breaking-materials`, { method: "POST", body: JSON.stringify({ urls }) });
  toast("素材已补充，请重新执行突发分析");
  await openBatch(state.currentBatch.id);
}

export async function pollJob(id) {
  clearTimeout(state.jobTimer);
  try {
    const job = await request(`/api/jobs/${id}`);
    const logs = job.logs ?? [{ at: job.updated_at || new Date().toISOString(), message: job.progress }];
    const output = logs.map((line) => `${line.at.slice(11, 19)}  ${line.message}`).join("\n") || job.progress;
    ["#job-console", "#production-job-console"].forEach((selector) => {
      const consoleNode = $(selector); if (!consoleNode) return;
      consoleNode.textContent = output; consoleNode.scrollTop = consoleNode.scrollHeight;
    });
    if (job.status === "running") {
      state.jobTimer = setTimeout(() => pollJob(id), 1200);
      return;
    }
    if (job.status === "completed" && job.type === "collect" && state.currentBatch?.batch_type !== "breaking") {
      try {
        const provider = $("#batch-ai-provider")?.value;
        const autoJob = await request(`/api/batches/${encodeURIComponent(job.batchId || job.batch_id)}/ai/auto`, { method: "POST", body: JSON.stringify({ provider }) });
        toast("采集完成，已自动进入打标与事件研判");
        $("#job-console").textContent = "自动流程已入队…";
        await loadOverview();
        return pollJob(autoJob.id);
      } catch (error) { toast(`采集完成，但自动流程启动失败：${error.message}`); }
    }
    const successText = job.type === "breaking-analysis" ? "突发事实基座和双评分已生成，请确认分流" : job.type === "research" || job.type === "auto" ? "事件研判完成，已进入选题池" : job.type === "collect" ? "采集完成" : job.type === "event-cards" ? "事件卡已生成" : job.type === "article" ? "完整成稿链已完成" : job.type === "typeset" ? "公众号排版 HTML 已完成" : "AI 打标完成";
    toast(job.status === "completed" ? successText : `任务失败：${job.error || "未取得有效结果"}`);
    await loadOverview();
    if (document.querySelector(".nav-item.active")?.dataset.view === "overview") {
      const { default: loadAtlas } = await import("./atlas.js");
      await loadAtlas();
    }
    if (job.status === "completed" && (job.type === "research" || job.type === "auto")) {
      $("#batch-drawer").close();
      window.go("topics");
    } else if (job.status === "completed" && job.type === "article") {
      await window.go("editor");
      $("#writing-candidate").value = String(job.candidateId);
      $$("input[name=doc-kind]").find((item) => item.value === "final").checked = true;
      window.loadSelectedDocument();
    } else if (job.status === "completed" && job.type === "typeset") {
      await window.go("preview");
      $("#typeset-candidate").value = String(job.candidateId);
      window.renderProductionCandidate(job.candidateId);
      await window.loadImageWorkspace(job.candidateId);
    } else {
      await openBatch(job.batchId || job.batch_id);
    }
  } catch (error) { toast(error.message); }
}

// 批次抽屉与新建批次对话框的事件绑定（原 app-bind.js 对应片段，由 main.js 启动时调用一次）
export function bindBatchDrawer() {
  document.addEventListener("click", (event) => {
    const batch = event.target.closest("[data-batch]");
    if (batch) {
      const mode = document.querySelector(".nav-item.active")?.dataset.view === "batches" ? "archive" : "full";
      openBatch(batch.dataset.batch, mode);
    }
    if (event.target.closest("[data-collect]")) startCollection().catch((error) => toast(error.message));
    if (event.target.closest("[data-ai-tag]")) startBatchAi("tag").catch((error) => toast(error.message));
    if (event.target.closest("[data-ai-retag]")) startBatchAi("retag").catch((error) => toast(error.message));
    if (event.target.closest("[data-ai-event-cards]")) startBatchAi("event-cards").catch((error) => toast(error.message));
    if (event.target.closest("[data-ai-research]")) startBatchAi("research").catch((error) => toast(error.message));
    if (event.target.closest("[data-breaking-analyze]")) startBreakingAnalysis().catch((error) => toast(error.message));
    if (event.target.closest("[data-breaking-route]")) confirmBreakingRoute().catch((error) => toast(error.message));
    if (event.target.closest("[data-breaking-add-material]")) addBreakingMaterials().catch((error) => toast(error.message));
  });
  $("#new-batch-button").addEventListener("click", openNewBatch);
  $("#dashboard-new").addEventListener("click", openNewBatch);
  $("#new-breaking-button").addEventListener("click", openBreakingBatch);
  $("#breaking-batch-form").addEventListener("submit", createBreakingBatch);
  $("#batch-form").addEventListener("submit", createBatch);
}
