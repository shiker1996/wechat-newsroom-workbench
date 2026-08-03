import { request } from "../core/http.js";
import { state } from "../core/state.js";
import { escapeHtml, providerOptions, toast, withLoading } from "../core/ui.js";
import { loadStageSkillControls, selectedStageSkills } from "../core/skill-selection.js";

let bound=false;
let dailyData=null;
let activeDimension="who";
let selectedFocuses=new Map();
let dailyGenerating=false;
let dailyHasFinal=false;
let dailyStage=1;

const dimensionLabels={who:"主体",what:"动作",where:"场合"};

function setDailyStage(stage) {
  dailyStage=stage;
  document.querySelectorAll("[data-daily-stage-panel]").forEach((panel)=>{panel.hidden=Number(panel.dataset.dailyStagePanel)!==stage;});
  document.querySelectorAll("#daily-creation-steps [data-step]").forEach((item) => {
    const step=Number(item.dataset.step);
    item.classList.toggle("completed",step<stage||(stage===3&&dailyHasFinal&&step===3));
    item.classList.toggle("active",step===stage);
  });
}

function availableOptions() {
  return (dailyData?.focusOptions||[]).filter((item)=>item.dimension===activeDimension);
}
function focusId(item) { return `${item.dimension}:${item.key}`; }
function updateReadiness() {
  const selected=[...selectedFocuses.values()];
  const eventCount=new Set(selected.flatMap((item)=>item.eventIds||[])).size;
  const button=document.getElementById("generate-daily");
  button.disabled=!selected.length;
  document.getElementById("daily-review-selection").disabled=!selected.length;
  document.getElementById("daily-selection-count").textContent=selected.length?`${selected.length} 个关系 · ${eventCount} 个事件`:"未选择";
  document.getElementById("daily-readiness").textContent=selected.length
    ? `已选择：${selected.map((item)=>item.label).join("、")}。AI 将对 ${eventCount} 个关联事件去重归纳。`
    : `请选择一个或多个主体、动作、场合关系；切换页签不会清空已选项。`;
  const dimensions=new Set(selected.map((item)=>item.dimension)).size;
  document.getElementById("daily-confirmation-summary").innerHTML=`
    <span><b>${selected.length}</b><small>阅读关系</small></span>
    <span><b>${eventCount}</b><small>去重关联事件</small></span>
    <span><b>${dimensions}</b><small>覆盖维度</small></span>`;
  document.getElementById("clear-daily-focus").hidden=!selected.length;
  document.getElementById("daily-selection-summary").innerHTML=selected.length
    ? selected.map((item)=>`<button type="button" class="daily-focus-chip" data-remove-daily-focus="${escapeHtml(focusId(item))}"><span>${dimensionLabels[item.dimension]}</span>${escapeHtml(item.label)}<b aria-hidden="true">×</b></button>`).join("")
    : `<span class="daily-selection-empty">可跨“主体 / 动作 / 场合”多选，切换页签不会丢失选择。</span>`;
}
function renderOptions() {
  const list=document.getElementById("daily-event-list");
  const options=availableOptions();
  if(!options.length){
    list.innerHTML=`<div class="empty-state">当前批次没有可用的${dimensionLabels[activeDimension]}关系。需要至少 2 个共享该维度且已生成事实卡的事件。</div>`;
    updateReadiness();return;
  }
  list.innerHTML=options.map((item)=>`<button type="button" class="daily-event-item ${selectedFocuses.has(focusId(item))?"active":""}" data-daily-focus="${escapeHtml(item.key)}" aria-pressed="${selectedFocuses.has(focusId(item))}">
    <span><b>${escapeHtml(item.label)}</b><small>${escapeHtml((item.leads||[]).join(" · "))}</small></span>
    <em>${item.eventIds.length} 个事件</em>
  </button>`).join("");
  updateReadiness();
}
function renderLatest(documents) {
  const final=documents.find((item)=>item.kind==="daily-final");
  dailyHasFinal=Boolean(final);
  const box=document.getElementById("daily-result");
  box.hidden=!final;
  if(final)setDailyStage(3);
  if(!final)return;
  document.getElementById("daily-result-title").textContent=final.title||"早报终稿";
  document.getElementById("daily-result-content").textContent=final.content||"";
}
function jobStatusLabel(status) {
  return { running: "执行中", completed: "已完成", failed: "失败", interrupted: "已中断" }[status] || status;
}
function renderJobs() {
  const box = document.getElementById("daily-job-history");
  if (!box) return;
  const jobs = (dailyData?.jobs || []).slice(0, 3);
  if (!jobs.length) { box.innerHTML = ""; return; }
  box.innerHTML = jobs.map((job) => {
    const time = String(job.updatedAt || job.createdAt || "").replace("T", " ").slice(5, 16);
    const failed = job.status === "failed" || job.status === "interrupted";
    const detail = failed
      ? `<span class="daily-job-error">${escapeHtml(job.error || job.progress || "生成失败")}</span>`
      : escapeHtml(job.progress || "");
    const retry = failed ? `<button type="button" class="outline-button daily-job-retry" data-daily-retry="${escapeHtml(job.id)}">重试</button>` : "";
    return `<div class="daily-job-item ${escapeHtml(job.status)}"><div><b>${jobStatusLabel(job.status)}</b> · ${escapeHtml(time)}<small>${detail}</small></div>${retry}</div>`;
  }).join("");
}
async function refreshJobs() {
  const batch = state.batches.find((item) => item.id === state.activeBatchId);
  if (!batch) return;
  const data = await request(`/api/batches/${encodeURIComponent(batch.id)}/daily`);
  dailyData = { ...(dailyData || {}), jobs: data.jobs || [] };
  renderJobs();
}
async function pollJob(id) {
  const status=document.getElementById("daily-job-status");
  while(true){
    await new Promise((resolve)=>setTimeout(resolve,1800));
    const job=await request(`/api/jobs/${id}`);
    status.textContent=job.progress||"早报任务执行中…";
    if(job.status==="running")continue;
    if(job.status!=="completed")throw new Error(job.error||"批次早报生成失败");
    dailyGenerating=false;dailyHasFinal=true;setDailyStage(3);
    toast("关系维度早报已生成");
    await loadDaily();
    return;
  }
}
async function generateDaily() {
  const batch=state.batches.find((item)=>item.id===state.activeBatchId);
  if(!batch)throw new Error("请先选择批次");
  const selected=[...selectedFocuses.values()];
  if(!selected.length)throw new Error("请先选择一个或多个主体、动作或场合关系");
  const provider=document.getElementById("daily-provider").value;
  const focuses=selected.map((item)=>({dimension:item.dimension,key:item.key}));
  const stageSkills=selectedStageSkills(document.getElementById("daily-stage-skills"));
  const job=await request(`/api/batches/${encodeURIComponent(batch.id)}/daily`,{method:"POST",body:JSON.stringify({provider,focuses,stageSkills})});
  dailyGenerating=true;setDailyStage(2);
  document.getElementById("daily-job-status").textContent="关系维度早报任务已提交…";
  try{await pollJob(job.id);}catch(error){dailyGenerating=false;setDailyStage(2);await refreshJobs();throw error;}
}
function bind() {
  if(bound)return;bound=true;
  document.getElementById("daily-dimension-tabs").addEventListener("click",(event)=>{
    const button=event.target.closest("[data-daily-dimension]");if(!button)return;
    activeDimension=button.dataset.dailyDimension;
    document.querySelectorAll("[data-daily-dimension]").forEach((item)=>item.classList.toggle("active",item===button));
    renderOptions();
  });
  document.getElementById("daily-event-list").addEventListener("click",(event)=>{
    const button=event.target.closest("[data-daily-focus]");if(!button)return;
    const focus=availableOptions().find((item)=>item.key===button.dataset.dailyFocus);
    if(!focus)return;
    const id=focusId(focus);
    if(selectedFocuses.has(id))selectedFocuses.delete(id);else selectedFocuses.set(id,focus);
    dailyHasFinal=false;
    renderOptions();
  });
  document.getElementById("daily-selection-summary").addEventListener("click",(event)=>{
    const button=event.target.closest("[data-remove-daily-focus]");if(!button)return;
    selectedFocuses.delete(button.dataset.removeDailyFocus);dailyHasFinal=false;renderOptions();
  });
  document.getElementById("clear-daily-focus").addEventListener("click",()=>{selectedFocuses.clear();dailyHasFinal=false;renderOptions();});
  document.getElementById("daily-review-selection").addEventListener("click",()=>{if(selectedFocuses.size)setDailyStage(2);});
  document.getElementById("daily-back-selection").addEventListener("click",()=>setDailyStage(1));
  document.getElementById("daily-revise-selection").addEventListener("click",()=>{dailyHasFinal=false;setDailyStage(1);});
  document.getElementById("daily-creation-steps").addEventListener("click",(event)=>{
    const item=event.target.closest("[data-step]");if(!item)return;
    const target=Number(item.dataset.step);
    if(target===1)setDailyStage(1);
    if(target===2&&selectedFocuses.size)setDailyStage(2);
    if(target===3&&dailyHasFinal)setDailyStage(3);
  });
  document.getElementById("daily-job-history").addEventListener("click", (event) => {
    const retryButton = event.target.closest("[data-daily-retry]");
    if (!retryButton) return;
    if (![...selectedFocuses.values()].length) {
      // 优先用任务记录里的 focuses 恢复选择，避免失败后还要手动重选
      const job = (dailyData?.jobs || []).find((item) => item.id === retryButton.dataset.dailyRetry);
      const restored = (job?.focuses || [])
        .map((focus) => (dailyData?.focusOptions || []).find((item) => item.dimension === focus.dimension && item.key === focus.key))
        .filter(Boolean);
      if (!restored.length) { toast("请先在第 1 步重新选择阅读视角，再重试生成"); setDailyStage(1); return; }
      selectedFocuses = new Map(restored.map((item) => [focusId(item), item]));
      renderOptions();
      toast(`已恢复上次选择：${restored.map((item) => item.label).join("、")}`);
    }
    setDailyStage(2);
    generateDaily().catch((error) => toast(error.message));
  });
  document.getElementById("generate-daily").addEventListener("click",(event)=>withLoading(event.currentTarget,"生成中…",()=>generateDaily().catch((error)=>{toast(error.message);throw error;})));
  document.getElementById("copy-daily-result").addEventListener("click",async()=>{
    await navigator.clipboard.writeText(document.getElementById("daily-result-content").textContent||"");toast("早报 Markdown 已复制");
  });
}
async function loadDaily() {
  bind();
  const batch=state.batches.find((item)=>item.id===state.activeBatchId);
  document.getElementById("daily-provider").innerHTML=providerOptions(state.models?.defaultProvider||"");
  selectedFocuses=new Map();
  if(!batch){dailyData={focusOptions:[],documents:[]};setDailyStage(1);renderOptions();return;}
  dailyData=await request(`/api/batches/${encodeURIComponent(batch.id)}/daily`);
  await loadStageSkillControls(document.getElementById("daily-stage-skills"),
    "/api/creation-entry-points/batch-daily/stage-skills");
  renderLatest(dailyData.documents||[]);
  renderOptions();
  renderJobs();
  if(!dailyHasFinal)setDailyStage(1);
  const runningJob=(dailyData.jobs||[]).find((job)=>job.status==="running");
  if(runningJob&&!dailyGenerating){
    dailyGenerating=true;setDailyStage(2);
    document.getElementById("daily-job-status").textContent=runningJob.progress||"早报任务执行中…";
    pollJob(runningJob.id).catch((error)=>{dailyGenerating=false;toast(error.message);refreshJobs();});
  }
}
export default loadDaily;
