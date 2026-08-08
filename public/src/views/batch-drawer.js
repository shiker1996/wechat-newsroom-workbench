import { state } from "../core/state.js";
import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, providerOptions, confirmAction, formatTime } from "../core/ui.js";
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
  const form = event.currentTarget;
  const input = Object.fromEntries(new FormData(form));
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true; submit.textContent = "正在建立…";
  try {
    const batch = await request("/api/batches", { method: "POST", body: JSON.stringify(input) });
    state.activeBatchId = batch.id;
    $("#batch-dialog").close();
    toast("今日批次已建立");
    await loadOverview();
    openBatch(batch.id);
  } catch (error) {
    toast(error.message);
  } finally {
    submit.disabled = false; submit.textContent = "建立批次";
  }
}

export async function openBatch(id, mode) {
  if (!state.models) state.models = await request("/api/models");
  const batch = await request(`/api/batches/${encodeURIComponent(id)}`);
  state.activeBatchId = id;
  renderBatchSwitcher();
  state.currentBatch = batch;
  const [stage] = stages[batch.stage] ?? [batch.stage];
  const lifecycle=batch.lifecycle_status||"active";
  const statusLabel = { active:"进行中", completed:"已完成", archived:"已归档" }[lifecycle];
  const ai = batch.ai_status || { tagged: 0, total: batch.hotspots.length, latestResearch: null };
  const preferred = state.models.providers.find((item) => item.configured)?.name || state.models.defaultProvider;
  const researchDone = ai.latestResearch?.status === "completed";
  const cards = batch.event_cards || { count: 0, total: 0 };
  const cardsReady = cards.total > 0 && cards.count >= cards.total;
  const pipeline = batch.pipeline_status?.steps || {};
  const stepClass = (name) => ({ completed:"done", active:"active", pending:"" })[pipeline[name]?.status] || "";
  const latestAiRun = batch.ai_runs?.[0];
  const pipelinePrimaryAction = researchDone
    ? `<button class="primary-button" data-view-research>查看研判结果 →</button>`
    : ai.tagged < ai.total || !ai.total
      ? `<button class="primary-button" data-ai-tag ${!batch.hotspots.length ? "disabled" : ""}>${ai.tagged ? `继续打标（还差 ${ai.total - ai.tagged} 条）` : "开始打标"}</button>`
      : !cardsReady
        ? `<button class="primary-button" data-ai-event-cards>${cards.count ? "继续生成事件卡" : "生成事件卡"}</button>`
        : `<button class="primary-button" data-ai-research>开始事件研判</button>`;
  const isBreaking = batch.batch_type === "breaking";
  let breakingAnalysis = null;
  if (isBreaking) { try { breakingAnalysis = await request(`/api/batches/${encodeURIComponent(id)}/breaking-analysis`); } catch { toast("突发分析结果加载失败，本次仅展示基础信息", "error"); } }
  const materialLinks = (batch.hotspots || []).flatMap((item) => item.materials || []);
  const intakeSection = isBreaking
    ? `<section class="drawer-section breaking-intake-section"><div class="pipeline-heading"><div><span class="kicker">BREAKING INTAKE</span><h3>突发专题素材</h3></div><span class="composite-badge">独立批次</span></div><p>该事件不参与每日热点的“核心 8 条 + 黑马 2 条”竞争；研判后按创建时选择的方向进入文章池或图文池。</p><div class="breaking-material-list">${materialLinks.map((item, index) => `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer"><b>${String(index + 1).padStart(2, "0")}</b><span>${escapeHtml(item.title || item.url)}</span><em class="material-status ${escapeHtml(item.status || "pending")}">${item.status === "ok" ? "已抓取" : item.status === "error" ? "抓取失败" : "待抓取"}</em></a>`).join("")}</div><details class="breaking-add-material"><summary>补充更多素材链接</summary><textarea id="breaking-more-materials" rows="3" placeholder="每行一个链接"></textarea><button class="outline-button" data-breaking-add-material>添加素材</button></details></section>`
    : `<section class="drawer-section" data-section="intake"><h3>采集今日热点</h3><p>按业务来源独立执行与记账；GitHub 包含 Trending、增长发现及热点提及仓库。采集完成后将自动进入语义打标与事件研判，无需逐节点击。</p><div class="check-row"><label><input type="checkbox" name="source" value="reddit" checked> Reddit</label><label><input type="checkbox" name="source" value="rsshub" checked> RSSHub</label><label><input type="checkbox" name="source" value="github" checked> GitHub</label></div><div class="check-row"><label>时间范围 <select id="collect-max-age">${[24, 48, 72, 120, 168].map((hours) => `<option value="${hours}"${(Number(batch.max_age_hours) || 24) === hours ? " selected" : ""}>${hours / 24} 天</option>`).join("")}</select></label></div><div style="display:flex;gap:8px"><button class="primary-button" data-collect>一键采集并研判</button></div></section>`;
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
  const regularAiSection = !isBreaking ? `<section class="drawer-section ai-pipeline-section" data-section="ai-pipeline"><div class="pipeline-heading"><div><span class="kicker">AI NEWSROOM FLOW</span><h3>打标与事件研判</h3></div><select id="batch-ai-provider" aria-label="批次模型">${providerOptions(preferred)}</select></div>
      <div class="pipeline-steps"><div data-pipeline-step="collect" class="${stepClass("collect")}"><b>01</b><span>采集<small>${batch.freshness?.fresh ?? batch.hotspots.length} 条有效${batch.freshness?.stale ? ` · ${batch.freshness.stale} 条旧闻归档` : ""}</small></span></div><i>→</i><div data-pipeline-step="tag" class="${stepClass("tag")}"><b>02</b><span>语义打标<small>${ai.tagged} / ${ai.total}</small></span></div><i>→</i><div data-pipeline-step="event-cards" class="${stepClass("eventCards")}"><b>03</b><span>事件卡<small>${cards.count} / ${cards.total}</small></span></div><i>→</i><div data-pipeline-step="research" class="${stepClass("research")}"><b>04</b><span>事件研判<small>${researchDone ? "已完成" : "核心 / 黑马筛选 · 六维评分"}</small></span></div></div>
      <p>打标覆盖全量热点，生成事件语义指纹、地区、风险和预评估证据；研判随后完成全量聚类、核心 8 + 黑马 2、探索脑暴与临时复排。</p>
      <p class="muted action-hint">打标、事件卡与研判均调用 LLM（按所选服务商计费）；研判可能使用联网搜索，会向搜索服务商发送查询词。</p>
      <div class="pipeline-actions"><div class="pipeline-next"><small>当前下一步</small>${pipelinePrimaryAction}</div><details class="pipeline-retry-menu"><summary>高级操作</summary><div><button class="ghost-button" data-ai-retag ${!batch.hotspots.length ? "disabled" : ""}>重新打标全部</button><button class="ghost-button" data-ai-event-cards-force ${!ai.tagged ? "disabled" : ""}>重新生成全部事件卡</button><button class="ghost-button" data-ai-research ${ai.tagged < ai.total || !ai.total ? "disabled" : ""}>重新执行事件研判</button></div></details></div>
      ${ai.tagged < ai.total && ai.total ? `<small class="pipeline-gate">还差 ${ai.total - ai.tagged} 条完整语义标注，完成后才能进入事件研判。</small>` : ""}
      ${latestAiRun?.status === "failed" ? `<div class="pipeline-error"><b>最近任务失败 · ${escapeHtml(latestAiRun.type)}</b><span>${escapeHtml(latestAiRun.error || latestAiRun.progress)}</span></div>` : ""}
    </section>` : "";
  const lifecycleActions = lifecycle === "archived"
    ? '<button class="outline-button" data-batch-lifecycle="active">重新打开批次</button><button class="ghost-button danger" data-batch-delete>彻底删除</button>'
    : lifecycle === "completed"
      ? '<button class="ghost-button" data-batch-lifecycle="active">重新打开</button><button class="primary-button" data-batch-lifecycle="archived">归档批次</button>'
      : '<button class="primary-button" data-batch-lifecycle="completed">标记完成</button>';
  $("#batch-detail").innerHTML = `<div class="drawer-inner">
    <header class="drawer-head"><div><span class="kicker">${escapeHtml(batch.batch_date)} · ${escapeHtml(stage)}</span><h2>${escapeHtml(batch.title)}</h2><p>${escapeHtml(batch.note || "暂无值班备注")}</p></div><button class="close-button" data-close-drawer aria-label="关闭批次详情">×</button></header>
    <section class="drawer-section batch-lifecycle"><div><span class="kicker">BATCH STATUS</span><h3>批次状态 · ${escapeHtml(statusLabel)}</h3><p>${lifecycle === "archived" ? "该批次已归档，仅保留历史查询与产物追溯。" : lifecycle === "completed" ? "生产工作已结束，可确认归档或重新打开。" : "完成当天生产后标记完成，确认无后续修改再归档。"}</p></div><div class="batch-lifecycle-actions">${lifecycleActions}</div></section>
    ${intakeSection}
    <section class="drawer-section"><h3>来源记录</h3>${batch.sources.length ? batch.sources.map((item) => `<div class="source-row ${item.status}"><i></i><div><strong>${escapeHtml(item.source)}</strong><small>${escapeHtml(item.error || item.ended_at || "执行中")}</small></div><b>${item.item_count}</b></div>`).join("") : '<p class="story-meta">尚未运行采集。</p>'}</section>
    ${breakingAnalysisSection}${regularAiSection}
    <section class="drawer-section"><h3>本批产物</h3><p>${batch.artifacts.length} 份已索引产物 · ${batch.hotspots.length} 条热点</p></section>
    <section class="drawer-section" data-section="logs"><h3>执行日志</h3><div class="job-console" id="job-console">等待任务…</div></section>
  </div>`;
  // 轮询刷新会重复调用 openBatch；对话框已打开时不能再次 showModal（会抛 InvalidStateError）
  const drawer = $("#batch-drawer");
  if (!drawer.open) drawer.showModal();
  if (mode === "archive") {
    const secs = document.getElementById("batch-detail").querySelectorAll(".drawer-section");
    secs.forEach((s) => {
      const section = s.dataset.section;
      if (section === "intake" || section === "logs") { s.style.display = "none"; }
      else if (section === "ai-pipeline") {
        s.querySelectorAll(".pipeline-actions,.pipeline-gate,.pipeline-error,#batch-ai-provider").forEach((b) => { b.style.display = "none"; });
      }
    });
  }
}

async function updateBatchLifecycle(lifecycleStatus) {
  const batch=state.currentBatch;
  if(!batch)return;
  const actionLabel={completed:"标记完成",archived:"归档",active:"重新打开"}[lifecycleStatus]||"更新";
  if(lifecycleStatus==="archived"&&!await confirmAction("归档后，该批次将不再出现在当前批次选择器中，但数据和产物仍可在批次管理中查询。",{confirmText:"确认归档"}))return;
  const updated=await request(`/api/batches/${encodeURIComponent(batch.id)}`,{method:"PATCH",body:JSON.stringify({lifecycleStatus})});
  state.currentBatch=updated;
  if(["completed","archived"].includes(lifecycleStatus)&&state.activeBatchId===batch.id)state.activeBatchId="";
  $("#batch-drawer").close();
  toast(`批次已${actionLabel}`);
  const currentView=document.querySelector(".nav-item.active")?.dataset.view;
  if(currentView==="batches")await window.go("batches");
  else await loadOverview();
}

// 彻底删除已归档批次：先拉取影响范围（数据库计数 + 产物目录）展示，确认后带确认头删除。
// 不可恢复；可恢复的删除请用「归档」。
async function deleteBatchPermanently() {
  const batch=state.currentBatch;
  if(!batch)return;
  const impact=await request(`/api/batches/${encodeURIComponent(batch.id)}/delete-impact`);
  const counts=impact.counts||{};
  const dirs=(impact.directories||[]).filter((item)=>item.exists&&!item.skipped);
  const skippedDirs=(impact.directories||[]).filter((item)=>item.skipped);
  const lines=[
    `热点 ${counts.hotspots??0} 条 · 候选 ${counts.candidates??0} 个 · 文档 ${counts.documents??0} 篇`,
    `采集记录 ${(counts.sourceRuns??0)+(counts.subscriptionRuns??0)} 条 · 模型调用审计 ${counts.modelCalls??0} 条（审计脱钩保留）`,
    dirs.length?`产物目录 ${dirs.length} 个（${dirs.reduce((sum,item)=>sum+item.files,0)} 个文件）将一并删除`:"无产物目录需要删除",
  ];
  if(skippedDirs.length)lines.push(`另有 ${skippedDirs.length} 个与其他批次共享的遗留目录将保留`);
  if(!await confirmAction(`彻底删除批次「${batch.title}」？此操作不可恢复，建议先在「设置与数据」导出备份。\n${lines.join("\n")}`,{confirmText:"彻底删除"}))return;
  await request(`/api/batches/${encodeURIComponent(batch.id)}`,{method:"DELETE",headers:{"x-admin-confirm":"DELETE-BATCH"}});
  if(state.activeBatchId===batch.id)state.activeBatchId="";
  state.currentBatch=null;
  $("#batch-drawer").close();
  toast("批次已彻底删除");
  const currentView=document.querySelector(".nav-item.active")?.dataset.view;
  if(currentView==="batches")await window.go("batches");
  else await loadOverview();
}

// 任务启动后把控制台滚动到可见位置，避免日志输出在抽屉最底部被埋
function showJobConsole(message) {
  const consoleNode = $("#job-console");
  if (!consoleNode) return;
  consoleNode.textContent = message;
  consoleNode.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setPipelineStep(name, status, detail) {
  const step = document.querySelector(`[data-pipeline-step="${name}"]`);
  if (!step) return;
  step.classList.remove("active", "done");
  if (status) step.classList.add(status);
  const small = step.querySelector("small");
  if (small && detail != null) small.textContent = detail;
}

async function refreshPipelineSteps(job) {
  const batchId = job.batchId || job.batch_id;
  if (!batchId || !document.querySelector(".pipeline-steps")) return;
  const batch = await request(`/api/batches/${encodeURIComponent(batchId)}`);
  state.currentBatch = batch;
  const ai = batch.ai_status || { tagged: 0, total: batch.hotspots.length, latestResearch: null };
  const cards = batch.event_cards || { count: 0, total: 0 };
  const collectRunning = job.type === "collect" && job.status === "running";
  const autoRunning = job.type === "auto" && job.status === "running";
  const autoPhase = autoRunning ? job.phase : "";
  const collected = !collectRunning && batch.hotspots.length > 0;
  const tagged = ai.total > 0 && ai.tagged >= ai.total;
  const cardsReady = cards.total > 0 && cards.count >= cards.total;
  const researchDone = ai.latestResearch?.status === "completed";

  setPipelineStep("collect", collectRunning ? "active" : collected ? "done" : "",
    `${batch.freshness?.fresh ?? batch.hotspots.length} 条有效${batch.freshness?.stale ? ` · ${batch.freshness.stale} 条旧闻归档` : ""}`);
  setPipelineStep("tag", autoPhase === "tag" ? "active" : tagged ? "done" : ai.tagged > 0 ? "active" : "", `${ai.tagged} / ${ai.total}`);
  setPipelineStep("event-cards", autoPhase === "event-cards" ? "active" : autoPhase === "tag" ? "" : cardsReady ? "done" : cards.count > 0 ? "active" : "", `${cards.count} / ${cards.total}`);
  setPipelineStep("research", autoPhase === "research" ? "active" : autoPhase ? "" : researchDone ? "done" : ai.latestResearch?.status === "running" ? "active" : "",
    researchDone && !autoPhase ? "已完成" : "核心 / 黑马筛选 · 六维评分");
}

export async function startCollection() {
  const sources = $$("input[name=source]:checked", $("#batch-detail")).map((item) => item.value);
  if (!sources.length) return toast("至少选择一个数据源");
  const job = await request(`/api/batches/${encodeURIComponent(state.currentBatch.id)}/collect`, { method: "POST", body: JSON.stringify({ sources, maxAgeHours: Number($("#collect-max-age")?.value) || undefined }) });
  showJobConsole("任务已入队…");
  pollJob(job.id);
}

export async function startBatchAi(type) {
  const provider = $("#batch-ai-provider")?.value;
  if (!provider) return toast("请先在运行与配置 → 模型接入中配置服务商");
  // 重打会覆盖全部已有语义标注，因此在批次工作流中统一执行二次确认。
  if (type === "retag" && !await confirmAction("重新打标将覆盖本批次全部已有语义标注，是否继续？", { confirmText: "重新打标" })) return;
  if (type === "event-cards-force" && !await confirmAction("这会覆盖本批次全部已有事件卡并重新调用模型，是否继续？", { confirmText: "重新生成全部" })) return;
  const path = type === "research" ? "research" : type === "event-cards" || type === "event-cards-force" ? "event-cards" : "tag";
  const payload = { provider, background: true, force: type === "retag" || type === "event-cards-force" };
  const job = await request(`/api/batches/${encodeURIComponent(state.currentBatch.id)}/ai/${path}`, { method: "POST", body: JSON.stringify(payload) });
  showJobConsole(type === "research" ? "事件研判任务已入队…" : type === "event-cards-force" ? "全量事件卡重建任务已入队…" : type === "event-cards" ? "事件卡增量生成任务已入队…" : "语义打标任务已入队…");
  pollJob(job.id);
}

export async function startBreakingAnalysis() {
  const provider = $("#batch-ai-provider")?.value;
  if (!provider) return toast("请先在运行与配置 → 模型接入中配置服务商");
  const job = await request(`/api/batches/${encodeURIComponent(state.currentBatch.id)}/ai/breaking-analysis`, { method: "POST", body: JSON.stringify({ provider }) });
  showJobConsole("突发素材分析任务已入队…");
  pollJob(job.id);
}

export async function confirmBreakingRoute() {
  const tracks = $$("input[name=breakingRoute]:checked", $("#batch-detail")).map((item) => item.value);
  if (!tracks.length) return toast("请至少选择一个进入方向");
  const trackLabel = tracks.map((track) => track === "article" ? "文章池" : "图文池").join("与");
  // 分流会把突发专题写入选题池，属于不可逆写入，统一走二次确认
  if (!await confirmAction(`确认将突发专题写入${trackLabel}？写入后不可撤销。`, { confirmText: "确认分流" })) return;
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
    const output = logs.map((line) => `${formatTime(line.at)}  ${line.message}`).join("\n") || job.progress;
    ["#job-console", "#production-job-console"].forEach((selector) => {
      const consoleNode = $(selector); if (!consoleNode) return;
      consoleNode.textContent = output; consoleNode.scrollTop = consoleNode.scrollHeight;
    });
    await refreshPipelineSteps(job).catch(() => {});
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
    if (event.target.closest("[data-ai-event-cards-force]")) startBatchAi("event-cards-force").catch((error) => toast(error.message));
    if (event.target.closest("[data-ai-event-cards]")) startBatchAi("event-cards").catch((error) => toast(error.message));
    if (event.target.closest("[data-ai-research]")) startBatchAi("research").catch((error) => toast(error.message));
    if (event.target.closest("[data-view-research]")) {
      $("#batch-drawer").close();
      window.go("topics");
    }
    if (event.target.closest("[data-breaking-analyze]")) startBreakingAnalysis().catch((error) => toast(error.message));
    if (event.target.closest("[data-breaking-route]")) confirmBreakingRoute().catch((error) => toast(error.message));
    if (event.target.closest("[data-breaking-add-material]")) addBreakingMaterials().catch((error) => toast(error.message));
    const lifecycleButton=event.target.closest("[data-batch-lifecycle]");
    if(lifecycleButton)updateBatchLifecycle(lifecycleButton.dataset.batchLifecycle).catch((error)=>toast(error.message));
    if (event.target.closest("[data-batch-delete]")) deleteBatchPermanently().catch((error) => toast(error.message));
  });
  $("#new-batch-button").addEventListener("click", openNewBatch);
  $("#dashboard-new").addEventListener("click", openNewBatch);
  $("#dashboard-primary-action").addEventListener("click", () => {
    if (state.overview?.latest) openBatch(state.overview.latest.id);
    else openNewBatch();
  });
  $("#new-breaking-button").addEventListener("click", openBreakingBatch);
  $("#breaking-batch-form").addEventListener("submit", createBreakingBatch);
  $("#batch-form").addEventListener("submit", createBatch);
}
