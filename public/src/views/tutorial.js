import { request } from "../core/http.js";
import { poll as pollTask } from "../core/poll.js";
import { JOB_POLL_INTERVAL_MS } from "../core/constants.js";
import { state } from "../core/state.js";
import { escapeHtml, providerOptions, toast, withLoading } from "../core/ui.js";
import { loadSkillSelect, loadStageSkillControls, selectedStageSkills } from "../core/skill-selection.js";
import { consumeAgentEvent } from "../core/agent-events.js";
// Unified stream contract consumed here: tool.requested, assistant.delta.

let bound = false;
let candidateId = null;
let history = [];
let writingGenerating = false;
let writingCompleted = false;
let writingFailed = false;
let customProjects = [];
let loadedSkillMode = "";

const form = () => document.getElementById("tutorial-form");
const field = (name) => form().elements.namedItem(name);
const lines = (value) => String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

function projectStatus(item) {
  if(item.project_status==="draft_ready"||item.document_id)return {label:"草稿完成",tone:"completed"};
  if(item.project_status==="generating"||item.job_status==="running")return {label:"生成中",tone:"running"};
  if(item.project_status==="failed"||item.job_status==="failed"||item.job_status==="interrupted")return {label:"生成失败",tone:"failed"};
  return {label:"待生成",tone:"pending"};
}

function renderProjects() {
  const count=document.getElementById("custom-writing-project-count");
  const list=document.getElementById("custom-writing-project-list");
  if(!list)return;
  list.setAttribute("aria-busy","false");
  if(count)count.textContent=`${customProjects.length} 篇`;
  list.innerHTML=customProjects.length?customProjects.map((item)=>{
    const status=projectStatus(item);
    const mode=item.output_mode==="wechat-experience"?"心得经验":"使用教程";
    const action=status.tone==="completed"
      ? `<button type="button" class="ink-button" data-custom-writing-open="${item.id}">进入文章编辑器 →</button>`
      : status.tone==="running"
        ? `<button type="button" class="outline-button" data-custom-writing-resume="${item.latest_job_id}" data-candidate-id="${item.id}">查看生成进度</button>`
        : `<button type="button" class="outline-button" data-custom-writing-retry="${item.id}">重新执行</button>`;
    return `<article class="custom-writing-project">
      <div><span class="custom-writing-mode">${mode}</span><h4>${escapeHtml(item.title||item.candidate_id)}</h4><p>${escapeHtml(String(item.job_error||item.job_progress||"事实基座已保存，可继续生成").slice(0,180))}</p></div>
      <div class="custom-writing-project-meta"><span class="status-pill ${status.tone}">${status.label}</span><small>${new Date(item.document_updated_at||item.updated_at).toLocaleString("zh-CN")}</small>${action}</div>
    </article>`;
  }).join(""):'<div class="empty-state">当前批次还没有自主文章。选择下方文章类型后开始创建。</div>';
}

async function loadProjects() {
  const batch=state.batches.find((item)=>item.id===state.activeBatchId);
  if(!batch){customProjects=[];renderProjects();return;}
  const list=document.getElementById("custom-writing-project-list");
  list?.setAttribute("aria-busy","true");
  try{
    customProjects=await request(`/api/batches/${encodeURIComponent(batch.id)}/custom-articles`);
    renderProjects();
  }catch(error){
    customProjects=[];
    if(list){
      list.setAttribute("aria-busy","false");
      list.innerHTML=`<div class="empty-state">自主文章读取失败：${escapeHtml(error.message)}<br><button type="button" class="outline-button" data-reload-custom-writing>重新加载</button></div>`;
    }
  }
}

function updateWritingSteps(stage) {
  document.querySelectorAll("#tutorial-creation-steps [data-step]").forEach((item) => {
    const step = Number(item.dataset.step);
    item.classList.toggle("completed", step < stage || (stage === 3 && writingCompleted && step === 3));
    item.classList.toggle("active", step === stage);
  });
}

function payload() {
  return Object.fromEntries([...new FormData(form()).entries()].map(([key, value]) => [key, String(value)]));
}

function selectedMaterials() {
  return Array.isArray(state.pendingIndependentWritingMaterials) ? state.pendingIndependentWritingMaterials.filter((item) => item && Number(item.id) > 0) : [];
}

function selectedMaterialPointLines(items) {
  return items.flatMap((item) => {
    const title = String(item.title || "未命名素材").trim();
    const chunks = String(item.raw_text || "").split(/\r?\n|(?<=[。！？])/).map((value) => value.trim()).filter(Boolean).slice(0, 8);
    return chunks.map((value) => `【素材】${title}：${value.slice(0, 900)}`);
  }).slice(0, 24);
}

function renderSelectedMaterials() {
  const section = document.getElementById("tutorial-selected-materials");
  const list = document.getElementById("tutorial-selected-material-list");
  const items = selectedMaterials();
  if (!section || !list) return;
  section.hidden = !items.length;
  if (!items.length) { list.innerHTML = ""; return; }
  list.innerHTML = items.map((item) => `<article><span>${escapeHtml(item.source_type || "text")}</span><div><b>${escapeHtml(item.title || "未命名素材")}</b><small>${escapeHtml(String(item.raw_text || "").replace(/\s+/g, " ").slice(0, 180))}${String(item.raw_text || "").length > 180 ? "…" : ""}</small></div></article>`).join("");
}

function hydrateSelectedMaterials() {
  const items = selectedMaterials();
  renderSelectedMaterials();
  if (!items.length) return;
  const topic = field("topic");
  if (topic && !topic.value.trim()) topic.value = String(items[0].title || "").trim();
  const points = field("points");
  if (points) {
    const additions = selectedMaterialPointLines(items);
    const existing = new Set(lines(points.value));
    points.value = [...lines(points.value), ...additions.filter((item) => !existing.has(item))].join("\n");
  }
  updateProgress();
}

function draft() {
  const value = payload();
  for (const key of ["points", "steps", "prerequisites", "expected_results", "common_errors", "materialUrls"]) value[key] = lines(value[key]);
  value.selectedMaterialIds = selectedMaterials().map((item) => Number(item.id));
  return value;
}

function applyUpdates(updates = {}) {
  for (const [key, value] of Object.entries(updates)) {
    const control = field(key);
    if (!control) continue;
    control.value = Array.isArray(value) ? value.join("\n") : String(value ?? "");
  }
  syncMode();
}

function syncMode() {
  const mode = field("articleMode")?.value || "";
  const workspace = document.getElementById("tutorial-writing-workspace");
  workspace.hidden = !mode;
  document.querySelectorAll("[data-mode-field='tutorial']").forEach((item) => { item.hidden = mode !== "tutorial"; });
  document.getElementById("tutorial-project-reader").hidden = !mode || mode !== "tutorial";
  document.querySelectorAll("[data-writing-mode]").forEach((item) => {
    const active = item.dataset.writingMode === mode;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  if (!mode) {
    document.getElementById("generate-tutorial").disabled = true;
    updateWritingSteps(1);
    return;
  }
  if (loadedSkillMode !== mode) {
    loadedSkillMode = mode;
    Promise.all([
      loadSkillSelect(document.getElementById("tutorial-writer-skill"),
        `/api/creation-entry-points/independent-writing/skills?contentType=${encodeURIComponent(mode)}`),
      loadStageSkillControls(document.getElementById("tutorial-stage-skills"),
        "/api/creation-entry-points/independent-writing/stage-skills"),
    ])
      .catch((error)=>toast(error.message, "error"));
  }
  const title = document.getElementById("tutorial-empty-title");
  const copy = document.getElementById("tutorial-empty-copy");
  if (title) title.textContent = mode === "tutorial" ? "先说清楚要完成什么" : "从一段真实经历开始";
  if (copy) copy.textContent = mode === "tutorial" ? "告诉 AI 目标任务、使用环境；有本地项目时可以直接提供目录。" : "不必先想好结构，说清楚发生了什么、你的感受或判断即可。";
  const starters = [...document.querySelectorAll("[data-tutorial-starter]")];
  if (starters.length === 2) {
    starters[0].textContent = mode === "tutorial" ? "从零完成任务" : "复盘一次经历";
    starters[0].dataset.tutorialStarter = mode === "tutorial" ? "我想写一篇从零完成某项任务的教程，请先帮我确认目标和实际环境。" : "我想复盘一次真实经历，帮我梳理其中最值得分享的经验。";
    starters[1].textContent = mode === "tutorial" ? "读取本地项目" : "分享使用心得";
    starters[1].dataset.tutorialStarter = mode === "tutorial" ? "我想基于一个本地项目编写使用教程，请提醒我提供项目目录和目标读者。" : "我使用一个工具或方法一段时间了，想整理真实感受和适用边界。";
  }
  updateProgress();
}

function updateProgress() {
  const mode = field("articleMode")?.value || "";
  if (!mode) {
    document.getElementById("generate-tutorial").disabled = true;
    updateWritingSteps(1);
    return;
  }
  const value = draft();
  const checks = mode === "tutorial"
    ? [value.topic, value.audience, value.environment, value.points.length >= 3, value.steps.length >= 2]
    : [value.topic, value.audience, value.thesis, value.points.length >= 3 && value.points.some((item) => item.startsWith("【体验】"))];
  const done = checks.filter(Boolean).length;
  const ready = done === checks.length;
  document.getElementById("tutorial-form-progress").textContent = done === checks.length
    ? "事实基座已齐备 · 建议展开复核后生成"
    : `已完成 ${done}/${checks.length} 项 · AI 会继续追问缺失信息`;
  document.getElementById("generate-tutorial").disabled = !ready || writingGenerating;
  updateWritingSteps(writingGenerating || writingCompleted || ready ? 3 : 2);
}

function setProjectStatus(message, tone = "idle") {
  const output = document.getElementById("tutorial-project-status");
  const symbols = { idle: "○", loading: "↻", success: "✓", error: "!" };
  output.className = `tutorial-project-status ${tone}`;
  output.innerHTML = `<i aria-hidden="true">${symbols[tone] || symbols.idle}</i><span>${escapeHtml(message)}</span>`;
}

function updateTutorialSkillSummary(){
  const summary=document.getElementById("tutorial-skill-summary");
  if(!summary)return;
  const writer=document.getElementById("tutorial-writer-skill");
  const writerLabel=writer?.value?writer.selectedOptions[0]?.textContent?.split(" · ")[0]:"系统推荐主写";
  const stages=[...document.querySelectorAll("#tutorial-stage-skills [data-stage-skill]")];
  const overridden=stages.filter((select)=>select.value).length;
  summary.textContent=`${writerLabel} · ${overridden?`${overridden} 个加工阶段已调整`:`${stages.length||4} 个加工阶段使用默认配置`}`;
}

function appendMessage(role, content, pending = false) {
  const messages = document.getElementById("tutorial-chat-messages");
  messages.querySelector(".editorial-chat-empty")?.remove();
  const item = document.createElement("div");
  item.className = `editorial-message ${role}${pending ? " pending" : ""}`;
  item.textContent = content;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
  return item;
}

async function sendChat() {
  const batch = state.batches.find((item) => item.id === state.activeBatchId);
  if (!batch) throw new Error("请先选择批次");
  const input = document.getElementById("tutorial-chat-input");
  const answer = input.value.trim();
  if (!answer && history.length) return;
  if (answer) appendMessage("user", answer);
  if (/[A-Za-z]:\\|(?:^|\s)\//.test(answer)) document.getElementById("tutorial-project-status").textContent = "正在自动读取本地项目并建立素材摘要…";
  input.value = "";
  const assistant = appendMessage("assistant", "", true);
  const replyText = document.createElement("div");
  replyText.className = "reply-text";
  assistant.appendChild(replyText);
  const thinkingBox=document.createElement("details");thinkingBox.className="thinking-box";thinkingBox.hidden=true;thinkingBox.innerHTML='<summary>思考过程</summary><div class="thinking-text"></div>';const thinkingText=thinkingBox.querySelector(".thinking-text");assistant.insertBefore(thinkingBox,replyText);
  const toolCards=document.createElement("div");toolCards.className="agent-tool-cards";assistant.insertBefore(toolCards,replyText);
  const { securityHeaders } = await import("../core/http.js");
  const projectReadRequested = /[A-Za-z]:\\|(?:^|\s)\//.test(answer) || Boolean(draft().localProjectPath);
  const response = await fetch(`/api/batches/${encodeURIComponent(batch.id)}/tutorial-chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await securityHeaders({ confirmation: projectReadRequested ? "local-project-read" : "" })) },
    body: JSON.stringify({ provider: field("provider").value, draft: draft(), history, answer }),
  });
  if (!response.ok || !response.body) throw new Error(`教程策划请求失败（${response.status}）`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const records = buffer.split("\n"); buffer = records.pop() || "";
    for (const record of records) {
      if (!record.trim()) continue;
      const event = JSON.parse(record);
      const completed=consumeAgentEvent(event,{toolCards,replyText,thinkingBox,thinkingText,errorLabel:'自主写作'});
      if(completed)result=completed;
    }
    if (done) break;
  }
  assistant.classList.remove("pending");
  if (!result) throw new Error("教程策划未返回完整结果");
  replyText.textContent = result.reply || replyText.textContent;
  applyUpdates(result.formUpdates);
  if (result.project) {
    field("localProjectPath").value = result.project.root;
    setProjectStatus(`${result.project.summary}${result.project.truncated ? "（内容较多，已截断）" : ""}`, "success");
  } else if (result.projectReadError) {
    setProjectStatus(`读取失败：${result.projectReadError}`, "error");
  }
  if (answer) history.push({ role: "user", content: answer });
  history.push({ role: "assistant", content: result.reply });
  if (result.ready) document.getElementById("tutorial-form-details").open = true;
}

async function inspectProject() {
  const projectPath = field("localProjectPath").value.trim();
  if (!projectPath) { setProjectStatus("请先填写项目文件夹的绝对路径。", "error"); field("localProjectPath").focus(); return; }
  setProjectStatus("正在读取项目结构与支持的文本文件…", "loading");
  try {
    const result = await request("/api/tools/local-project/read", { method: "POST", confirmation: "local-project-read", body: JSON.stringify({ path: projectPath }) });
    setProjectStatus(`${result.summary}${result.truncated ? "（内容较多，已截断）" : ""}`, "success");
    toast("项目素材已就绪，AI 将在后续对话中使用");
  } catch (error) {
    setProjectStatus(`读取失败：${error.message}`, "error");
    throw error;
  }
}

async function poll(id) {
  await pollTask(async () => {
    const status = document.getElementById("tutorial-job-status");
    if (!status) return true; // 已离开自主写作视图，静默结束轮询
    const job = await request(`/api/jobs/${id}`);
    status.textContent = job.progress || "教程任务执行中…";
    if (job.status === "running" || job.status === "queued") return false;
    if (job.status !== "completed") throw new Error(job.error || "教程生成失败");
    writingGenerating = false;
    writingCompleted = true;
    updateWritingSteps(3);
    document.getElementById("tutorial-result").hidden = false;
    document.getElementById("tutorial-result-copy").textContent = `${job.result?.title || "文章终稿"}已生成，可继续编辑、查看版本历史和公众号排版。`;
    toast("自主写作已生成并进入文章编辑器", "success");
    await loadProjects();
    return true;
  }, { interval: JOB_POLL_INTERVAL_MS }).promise;
}

async function submit() {
  if (writingGenerating) return;
  const batch = state.batches.find((item) => item.id === state.activeBatchId);
  if (!batch) throw new Error("请先选择批次");
  writingGenerating = true;
  const retrying = Boolean(candidateId && writingFailed);
  writingFailed = false;
  // 新建写作先清空模块级 candidateId（打开/重试旧项目会残留），避免后续失败重试指向旧候选
  if (!retrying) candidateId = null;
  updateWritingSteps(3);
  try {
    const input=payload();
    input.selectedMaterialIds = selectedMaterials().map((item) => Number(item.id));
    input.stageSkills=selectedStageSkills(document.getElementById("tutorial-stage-skills"));
    input.creationRequestId=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url=retrying
      ? `/api/candidates/${candidateId}/custom-article-runs`
      : `/api/batches/${encodeURIComponent(batch.id)}/custom-articles`;
    const result = await request(url, { method: "POST", confirmation: input.articleMode === "tutorial" && input.localProjectPath ? "local-project-read" : "", body: JSON.stringify(input) });
    candidateId = result.candidate?.id || candidateId;
    document.getElementById("tutorial-job-status").textContent = result.reused
      ? "已恢复当前自主写作任务，正在继续等待结果…"
      : retrying ? "正在原自主写作项目上重新成稿…" : "自主写作项目已创建，正在成稿…";
    await poll(result.id);
  } catch(error) {
    writingGenerating=false;
    writingFailed=Boolean(candidateId);
    updateProgress();
    throw error;
  }
}

async function openEditor(selectedCandidateId=candidateId) {
  if (!selectedCandidateId) return;
  candidateId=Number(selectedCandidateId);
  await window.go("editor");
  const select = document.getElementById("writing-candidate");
  if (select?.querySelector(`option[value="${candidateId}"]`)) {
    select.value = String(candidateId);
    await window.loadSelectedDocument?.();
  }
}

async function retryProject(projectId) {
  if(writingGenerating)return;
  candidateId=Number(projectId);
  writingGenerating=true;
  writingFailed=false;
  try{
    const result=await request(`/api/candidates/${candidateId}/custom-article-runs`,{
      method:"POST",body:JSON.stringify({
        provider:field("provider").value,
        skillId:document.getElementById("tutorial-writer-skill")?.value||"",
        stageSkills:selectedStageSkills(document.getElementById("tutorial-stage-skills")),
      }),
    });
    await loadProjects();
    await poll(result.id);
  }catch(error){
    writingGenerating=false;writingFailed=true;await loadProjects();throw error;
  }
}

function bind() {
  if (bound) return;
  bound = true;
  form().addEventListener("submit", async (event) => {
    event.preventDefault();
    const button=document.getElementById("generate-tutorial");
    try {
      await withLoading(button, writingFailed ? "重新执行中…" : "生成中…", () => submit());
    } catch(error) {
      toast(error.message, "error");
    } finally {
      if(writingFailed)button.textContent="重新执行";
    }
  });
  document.getElementById("tutorial-chat-send").addEventListener("click", () => withLoading(document.getElementById("tutorial-chat-send"), "思考中…", () => sendChat().catch((error) => { toast(error.message, "error"); throw error; })));
  document.getElementById("tutorial-chat-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); document.getElementById("tutorial-chat-send").click(); }
  });
  document.getElementById("tutorial-read-project").addEventListener("click", () => withLoading(document.getElementById("tutorial-read-project"), "读取中…", () => inspectProject().catch((error) => { toast(error.message, "error"); throw error; })));
  document.getElementById("tutorial-local-project").addEventListener("input", (event) => { if (!event.currentTarget.value.trim()) setProjectStatus("尚未读取，不影响继续对话或填写表单。", "idle"); });
  document.getElementById("clear-tutorial-materials")?.addEventListener("click", () => {
    state.pendingIndependentWritingMaterials = [];
    renderSelectedMaterials();
    updateProgress();
  });
  document.querySelectorAll("[data-writing-mode]").forEach((button) => button.addEventListener("click", () => {
    field("articleMode").value = button.dataset.writingMode;
    syncMode();
    document.getElementById("tutorial-writing-workspace").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  document.querySelectorAll("[data-tutorial-starter]").forEach((button) => button.addEventListener("click", () => {
    document.getElementById("tutorial-chat-input").value = button.dataset.tutorialStarter;
    document.getElementById("tutorial-chat-input").focus();
  }));
  form().addEventListener("input", updateProgress);
  form().addEventListener("change",updateTutorialSkillSummary);
  form().addEventListener("stage-skills-loaded",updateTutorialSkillSummary);
  document.getElementById("reset-tutorial-skills").addEventListener("click",()=>{
    const writer=document.getElementById("tutorial-writer-skill");if(writer)writer.value="";
    document.querySelectorAll("#tutorial-stage-skills [data-stage-skill]").forEach((select)=>{select.value="";});
    updateTutorialSkillSummary();
  });
  document.getElementById("close-tutorial-skills").addEventListener("click",()=>{
    document.getElementById("tutorial-creation-skill-settings")?.removeAttribute("open");
  });
  document.getElementById("open-tutorial-editor").addEventListener("click", () => openEditor().catch((error) => toast(error.message, "error")));
  document.getElementById("custom-writing-project-list").addEventListener("click",(event)=>{
    const open=event.target.closest("[data-custom-writing-open]");
    if(open)return openEditor(Number(open.dataset.customWritingOpen)).catch((error)=>toast(error.message, "error"));
    const resume=event.target.closest("[data-custom-writing-resume]");
    if(resume){
      candidateId=Number(resume.dataset.candidateId);
      writingGenerating=true;
      return withLoading(resume,"等待生成…",()=>poll(resume.dataset.customWritingResume))
        .catch((error)=>{writingGenerating=false;writingFailed=true;toast(error.message,"error");})
        .finally(()=>loadProjects().catch(()=>{}));
    }
    const retry=event.target.closest("[data-custom-writing-retry]");
    if(retry)return withLoading(retry,"重新执行中…",()=>retryProject(Number(retry.dataset.customWritingRetry)))
      .catch((error)=>toast(error.message, "error"));
    if(event.target.closest("[data-reload-custom-writing]"))loadProjects();
  });
}

export default async function loadTutorial() {
  bind();
  document.getElementById("tutorial-provider").innerHTML = providerOptions(state.models?.defaultProvider || "");
  hydrateSelectedMaterials();
  syncMode();
  await loadProjects();
}
