import { request } from "../core/http.js";
import { state } from "../core/state.js";
import { providerOptions, toast, withLoading } from "../core/ui.js";

let bound = false;
let candidateId = null;
let history = [];
let writingGenerating = false;
let writingCompleted = false;

const form = () => document.getElementById("tutorial-form");
const field = (name) => form().elements.namedItem(name);
const lines = (value) => String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

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

function draft() {
  const value = payload();
  for (const key of ["points", "steps", "prerequisites", "expected_results", "common_errors", "materialUrls"]) value[key] = lines(value[key]);
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
  document.getElementById("generate-tutorial").disabled = !ready;
  updateWritingSteps(writingGenerating || writingCompleted || ready ? 3 : 2);
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
  const response = await fetch(`/api/batches/${encodeURIComponent(batch.id)}/tutorial-chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
      if (event.type === "delta") assistant.textContent += event.text;
      if (event.type === "error") throw new Error(event.error);
      if (event.type === "done") result = event.data;
    }
    if (done) break;
  }
  assistant.classList.remove("pending");
  if (!result) throw new Error("教程策划未返回完整结果");
  assistant.textContent = result.reply || assistant.textContent;
  applyUpdates(result.formUpdates);
  if (result.project) {
    field("localProjectPath").value = result.project.root;
    document.getElementById("tutorial-project-status").textContent = `${result.project.summary}${result.project.truncated ? "（已截断）" : ""}`;
  } else if (result.projectReadError) {
    document.getElementById("tutorial-project-status").textContent = `读取失败：${result.projectReadError}`;
  }
  if (answer) history.push({ role: "user", content: answer });
  history.push({ role: "assistant", content: result.reply });
  if (result.ready) document.getElementById("tutorial-form-details").open = true;
}

async function inspectProject() {
  const projectPath = field("localProjectPath").value.trim();
  const result = await request("/api/tools/local-project/read", { method: "POST", body: JSON.stringify({ path: projectPath }) });
  document.getElementById("tutorial-project-status").textContent = `${result.summary}${result.truncated ? "（已截断）" : ""}`;
  toast("本地项目已读取，发送消息后 AI 会据此填写教程表单");
}

async function poll(id) {
  const status = document.getElementById("tutorial-job-status");
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1800));
    const job = await request(`/api/jobs/${id}`);
    status.textContent = job.progress || "教程任务执行中…";
    if (job.status === "running") continue;
    if (job.status !== "completed") throw new Error(job.error || "教程生成失败");
    writingGenerating = false;
    writingCompleted = true;
    updateWritingSteps(3);
    document.getElementById("tutorial-result").hidden = false;
    document.getElementById("tutorial-result-copy").textContent = `${job.result?.title || "文章终稿"}已生成，可继续编辑、查看版本历史和公众号排版。`;
    toast("自主写作已生成并进入文章编辑器");
    return;
  }
}

async function submit() {
  const batch = state.batches.find((item) => item.id === state.activeBatchId);
  if (!batch) throw new Error("请先选择批次");
  const result = await request(`/api/batches/${encodeURIComponent(batch.id)}/custom-articles`, { method: "POST", body: JSON.stringify(payload()) });
  candidateId = result.candidate?.id || null;
  writingGenerating = true;
  updateWritingSteps(3);
  document.getElementById("tutorial-job-status").textContent = "自主写作项目已创建，正在成稿…";
  try{await poll(result.id);}catch(error){writingGenerating=false;updateProgress();throw error;}
}

async function openEditor() {
  if (!candidateId) return;
  await window.go("editor");
  const select = document.getElementById("writing-candidate");
  if (select?.querySelector(`option[value="${candidateId}"]`)) {
    select.value = String(candidateId);
    await window.loadSelectedDocument?.();
  }
}

function bind() {
  if (bound) return;
  bound = true;
  form().addEventListener("submit", (event) => {
    event.preventDefault();
    withLoading(document.getElementById("generate-tutorial"), "生成中…", () => submit().catch((error) => { toast(error.message); throw error; }));
  });
  document.getElementById("tutorial-chat-send").addEventListener("click", () => withLoading(document.getElementById("tutorial-chat-send"), "思考中…", () => sendChat().catch((error) => { toast(error.message); throw error; })));
  document.getElementById("tutorial-chat-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); document.getElementById("tutorial-chat-send").click(); }
  });
  document.getElementById("tutorial-read-project").addEventListener("click", () => withLoading(document.getElementById("tutorial-read-project"), "读取中…", () => inspectProject().catch((error) => { toast(error.message); throw error; })));
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
  document.getElementById("open-tutorial-editor").addEventListener("click", () => openEditor().catch((error) => toast(error.message)));
}

export default async function loadTutorial() {
  bind();
  document.getElementById("tutorial-provider").innerHTML = providerOptions(state.models?.defaultProvider || "");
  syncMode();
}
