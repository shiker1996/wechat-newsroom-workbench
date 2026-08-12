import { request } from "../core/http.js";
import { state } from "../core/state.js";
import { escapeHtml, toast, confirmAction } from "../core/ui.js";

let bound = false;
let validatedBackup = null;
let runtimeModels = null;
let runtimeSettings = null;
let extensionConfigurations = [];
let selectedExtension = null;
let extensionQuery = "";
let extensionType = "";

function bindSystem() {
  if (bound) return;
  bound = true;
  document.getElementById("health-button").addEventListener("click", () => window.go("system"));
  document.getElementById("system-health").addEventListener("click", () => {
    loadSystem().catch((error) => toast(error.message));
  });
  document.querySelectorAll("[data-health-target]").forEach((button) => button.addEventListener("click", () => {
    loadSystem(button.dataset.healthTarget, button).catch((error) => toast(error.message));
  }));
  document.querySelectorAll("[data-runtime-service]").forEach((button) => button.addEventListener("click", () => {
    controlRuntime(button).catch((error) => toast(error.message));
  }));
  document.getElementById("add-rsshub-env")?.addEventListener("click", () => addRsshubKvRow());
  document.getElementById("new-model-config")?.addEventListener("click", () => resetModelForm());
  document.getElementById("add-model-provider")?.addEventListener("click", () => openModelProviderManager());
  document.getElementById("model-config-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveModelConfig(event.submitter).catch((error) => toast(error.message));
  });
  document.getElementById("delete-model-config")?.addEventListener("click", (event) => {
    deleteModelConfig(event.currentTarget).catch((error) => toast(error.message));
  });
  document.getElementById("runtime-model-list")?.addEventListener("click", (event) => {
    const item = event.target.closest("[data-model-edit]");
    if (item) editModelConfig(item.dataset.modelEdit);
  });
  document.querySelector(".config-tabbar")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-config-tab]");
    if (button) selectConfigTab(button.dataset.configTab);
  });
  document.getElementById("system-extension-list")?.addEventListener("click",(event)=>{const button=event.target.closest("[data-system-extension]");if(button)selectSystemExtension(button.dataset.systemExtension);});
  document.getElementById("system-extension-search")?.addEventListener("input",(event)=>{extensionQuery=event.target.value.trim().toLowerCase();renderSystemExtensionList();});
  document.getElementById("system-extension-type")?.addEventListener("change",(event)=>{extensionType=event.target.value;renderSystemExtensionList();});
  document.getElementById("system-extension-editor")?.addEventListener("click",(event)=>{const remove=event.target.closest("[data-rsshub-remove]");if(!remove)return;const row=remove.closest(".rsshub-kv-row");if(row.dataset.existing==="true"){row.classList.toggle("pending-delete");row.querySelector("[data-rsshub-clear]").checked=row.classList.contains("pending-delete");remove.textContent=row.classList.contains("pending-delete")?"撤销":"删除";}else row.remove();updateRsshubPendingHint();});
  document.getElementById("rsshub-env-fields")?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-rsshub-remove]");
    if (!remove) return;
    const row = remove.closest(".rsshub-kv-row");
    if (row.dataset.existing === "true") {
      row.classList.toggle("pending-delete");
      row.querySelector("[data-rsshub-clear]").checked = row.classList.contains("pending-delete");
      remove.textContent = row.classList.contains("pending-delete") ? "撤销" : "删除";
    } else {
      row.remove();
    }
    updateRsshubPendingHint();
  });
  bindBackupActions();
}

function bindBackupActions() {
  document.getElementById("download-backup")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "正在生成…";
    try {
      const response = await fetch("/api/system/backup");
      if (!response.ok) throw new Error((await response.json()).error || "备份失败");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] || "write-assistant-backup.zip";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("备份已通过完整性校验并开始下载");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
  document.getElementById("clear-cache")?.addEventListener("click", async (event) => {
    if (!await confirmAction("清理 GitHub API 与来源正文缓存？缓存会随下次采集自动重建，数据库与产物不受影响。", { confirmText: "清理缓存" })) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await request("/api/system/cache/clear", { method: "POST", body: JSON.stringify({ kind: "all" }) });
      const total = (result.cleared || []).reduce((sum, item) => sum + item.removed, 0);
      toast("缓存已清理（" + total + " 项）");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById("backup-file")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    const status = document.getElementById("backup-validation");
    const restore = document.getElementById("restore-backup");
    validatedBackup = null;
    restore.disabled = true;
    if (!file) {
      status.textContent = "尚未选择备份包";
      status.className = "backup-validation";
      return;
    }
    status.textContent = "正在校验备份包…";
    status.className = "backup-validation checking";
    try {
      const result = await request("/api/system/backup/validate", { method: "POST", headers: { "content-type": "application/zip" }, body: file });
      validatedBackup = file;
      restore.disabled = false;
      status.textContent = `校验通过 · ${result.fileCount} 个文件 · ${(result.totalBytes / 1024 / 1024).toFixed(1)} MB · ${new Date(result.createdAt).toLocaleString("zh-CN")}`;
      status.className = "backup-validation valid";
    } catch (error) {
      status.textContent = `校验失败 · ${error.message}`;
      status.className = "backup-validation invalid";
    }
  });
  document.getElementById("restore-backup")?.addEventListener("click", async (event) => {
    if (!validatedBackup) return;
    if (!await confirmAction("恢复将用备份数据替换当前工作台数据。系统会先自动保存一份恢复前快照，是否继续？", { confirmText: "确认恢复" })) return;
    const button = event.currentTarget;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "正在恢复…";
    try {
      const result = await request("/api/system/backup/restore", { method: "POST", headers: { "content-type": "application/zip", "x-restore-confirm": "RESTORE" }, body: validatedBackup });
      toast(`恢复完成，已保留恢复前快照 ${result.safetyBackup}，即将刷新页面`);
      setTimeout(() => location.reload(), 800);
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = !validatedBackup;
      button.textContent = original;
    }
  });
}

function selectConfigTab(name) {
  document.querySelectorAll("[data-config-tab]").forEach((button) => {
    const active = button.dataset.configTab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-config-panel]").forEach((panel) => {
    const active = panel.dataset.configPanel === name;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
  try { sessionStorage.setItem("runtime-config-tab", name); } catch {}
}

function extensionRoute(item,suffix=""){return `/api/system/configuration/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}${suffix}`;}
function renderSystemExtensionList(){const node=document.getElementById("system-extension-list");if(!node)return;const labels={system:"系统",'model-provider':"模型",skill:"技能",tool:"工具",collector:"采集器"};const marks={system:"SYS",'model-provider':"AI",skill:"SK",tool:"TL",collector:"CL"};const items=extensionConfigurations.filter((item)=>(!extensionType||item.type===extensionType)&&(!extensionQuery||`${item.name||''} ${item.id}`.toLowerCase().includes(extensionQuery)));const count=document.getElementById("configuration-filter-count");if(count)count.textContent=`${items.length} / ${extensionConfigurations.length}`;node.innerHTML=items.length?items.map((item)=>`<button type="button" class="${selectedExtension===`${item.type}:${item.id}`?'active':''}" data-system-extension="${escapeHtml(`${item.type}:${item.id}`)}"><span class="configuration-resource-mark">${marks[item.type]||'EX'}</span><span class="configuration-resource-copy"><b>${escapeHtml(item.name||item.id)}</b><small>${labels[item.type]||item.type} · ${escapeHtml(item.id)}</small></span><i class="configuration-resource-state ${item.state.configured?'ready':'attention'}" title="${item.state.configured?'已就绪':'需要配置'}"></i></button>`).join(""):'<div class="configuration-empty"><b>没有匹配项</b><span>试试清空搜索或切换能力类型。</span></div>';}function systemSchemaField(name,rule,value){const id=`system-extension-${name}`,common=`id="${id}" data-system-extension-field="${escapeHtml(name)}" data-value-type="${escapeHtml(rule.type||'string')}"`;const heading=`${escapeHtml(rule.title||name)}${rule.description?`<small>${escapeHtml(rule.description)}</small>`:''}`;if(rule.enum)return `<label>${heading}<select ${common}>${rule.enum.map((item,index)=>`<option value="${escapeHtml(item)}" ${item===value?'selected':''}>${escapeHtml(rule.enumNames?.[index]||item)}</option>`).join("")}</select></label>`;if(rule.type==='boolean')return `<label><span>${heading}</span><input ${common} type="checkbox" ${value?'checked':''}></label>`;if(rule.type==='array'){const text=Array.isArray(value)?value.join("\n"):"";return `<label>${heading}<textarea ${common} rows="4" placeholder="每行一项">${escapeHtml(text)}</textarea></label>`;}const configured=value==='__configured__';if(rule.format==='textarea')return `<label>${heading}<textarea ${common} rows="5" ${configured?'placeholder="已配置；留空保持不变"':''}>${configured?'':escapeHtml(value??'')}</textarea></label>`;const type=rule.secret||rule.format==='password'?'password':rule.type==='integer'||rule.type==='number'?'number':rule.format==='url'?'url':'text';return `<label>${heading}<input ${common} type="${type}" value="${configured?'':escapeHtml(value??'')}" ${configured?'placeholder="已配置；留空保持不变"':''}></label>`;}
function parkModelProviderManager(){const legacy=document.getElementById("config-panel-models"),list=document.getElementById("runtime-model-list"),panel=document.querySelector(".model-config-panel");if(legacy&&list&&panel&&list.parentElement!==legacy)legacy.append(list,panel);}
function renderSystemExtensionEditor(item){parkModelProviderManager();const node=document.getElementById("system-extension-editor");if(!node)return;if(!item){node.innerHTML='<div class="configuration-empty"><b>选择一项能力</b><span>查看配置字段、凭据状态与运行诊断。</span></div>';return;}const state=item.state,schema=state.schema||{properties:{}};const issues=state.issues||[];const advanced=item.renderer==='key-value-secret'?`<section class="resource-advanced"><div class="config-panel-heading"><div><span class="kicker">KEY-VALUE SECRET</span><h4>RSSHub 扩展变量</h4></div><p>键名受控校验，秘密值只显示配置状态。</p></div><div class="kv-file-head"><span>KEY</span><span>VALUE</span><button type="button" class="text-button" data-add-rsshub-kv>＋ 新增变量</button></div><div id="rsshub-env-fields" class="rsshub-kv-list"></div><div id="rsshub-pending-hint" class="kv-pending-hint" hidden></div><button type="button" class="outline-button" data-save-rsshub-kv>保存扩展变量</button></section>`:'';node.innerHTML=`<header class="configuration-editor-head"><div><span class="kicker">${escapeHtml(item.type.toUpperCase())} / ${escapeHtml(item.id)}</span><h4>${escapeHtml(item.name||item.id)}</h4><p>${state.configured?'该能力已通过配置校验，可以投入运行。':'完成以下配置后，能力才会进入运行队列。'}</p></div><span class="configuration-status-badge ${state.configured?'ready':'attention'}"><i></i>${state.configured?'已就绪':'需要配置'}</span></header>${issues.length?`<div class="configuration-issues"><b>需要处理</b>${issues.map((issue)=>`<span>${escapeHtml(issue.message||issue.field)}</span>`).join('')}</div>`:''}<form id="system-extension-form"><div class="configuration-fields">${Object.entries(schema.properties||{}).map(([name,rule])=>systemSchemaField(name,rule,state.values?.[name])).join("")}</div><div class="configuration-form-actions"><small>保存前会校验字段格式；密钥不会在页面回显。</small><div><button type="button" class="ghost-button" data-system-extension-test>测试配置</button><button type="submit" class="primary-button">保存并应用</button></div></div></form>${advanced}`;const form=node.querySelector("form");form.onsubmit=(event)=>{event.preventDefault();saveSystemExtension(item,form).catch((error)=>toast(error.message));};form.querySelector("[data-system-extension-test]").onclick=()=>testSystemExtension(item).catch((error)=>toast(error.message));if(advanced){renderRsshubKv(runtimeSettings?.rsshub||[]);node.querySelector('[data-add-rsshub-kv]').onclick=addRsshubKvRow;node.querySelector('[data-save-rsshub-kv]').onclick=(event)=>saveRsshubConfiguration(event.currentTarget);}}function selectSystemExtension(key){selectedExtension=key;try{sessionStorage.setItem("system-extension-selection",key);const [type,id]=key.split(':');history.replaceState(null,"",`#system/configuration/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);}catch{}renderSystemExtensionList();renderSystemExtensionEditor(extensionConfigurations.find((item)=>`${item.type}:${item.id}`===key));}
function readSystemExtensionForm(form){return Object.fromEntries([...form.querySelectorAll("[data-system-extension-field]")].map((field)=>{let value=field.type==='checkbox'?field.checked:field.value;const type=field.dataset.valueType;if(type==='array')value=String(value).split(/\r?\n/).map((item)=>item.trim()).filter(Boolean);if((type==='integer'||type==='number')&&value!=='')value=Number(value);return [field.dataset.systemExtensionField,value];}));}
async function loadExtensionConfigurations(){const result=await request("/api/system/configuration/catalog");extensionConfigurations=result.items||[];const ready=extensionConfigurations.filter((item)=>item.state.configured).length,attention=extensionConfigurations.length-ready;const summary=document.getElementById("configuration-readiness");if(summary)summary.innerHTML=`<strong>${ready}/${extensionConfigurations.length}</strong><span>${attention?`${attention} 项需要处理`:'全部能力已就绪'}</span>`;const match=location.hash.match(/^#system\/configuration\/([^/]+)\/(.+)$/);if(match)selectedExtension=`${decodeURIComponent(match[1])}:${decodeURIComponent(match[2])}`;else if(!selectedExtension)try{selectedExtension=sessionStorage.getItem("system-extension-selection")||"";}catch{}const current=extensionConfigurations.find((item)=>`${item.type}:${item.id}`===selectedExtension);if(!current)selectedExtension=extensionConfigurations[0]?`${extensionConfigurations[0].type}:${extensionConfigurations[0].id}`:null;renderSystemExtensionList();renderSystemExtensionEditor(extensionConfigurations.find((item)=>`${item.type}:${item.id}`===selectedExtension));}
async function saveSystemExtension(item,form){const state=await request(extensionRoute(item),{method:"PUT",body:JSON.stringify(readSystemExtensionForm(form))});item.state=state;toast("扩展配置已保存");renderSystemExtensionList();renderSystemExtensionEditor(item);}
async function testSystemExtension(item){const result=await request(extensionRoute(item,"/test"),{method:"POST",body:"{}"});toast(result.pass?"扩展配置测试通过":"扩展配置尚未就绪");}

function rsshubKvMarkup(field = { key: "", configured: false }, existing = false) {
  return `<div class="rsshub-kv-row" data-existing="${existing}">
    <input class="kv-key" data-rsshub-key value="${escapeHtml(field.key)}" placeholder="PLATFORM_TOKEN" ${existing ? "readonly" : ""} aria-label="环境变量名">
    <input class="kv-value" data-rsshub-value type="password" value="" placeholder="${field.configured ? "•••••••• · 留空保持原值" : "输入配置值"}" autocomplete="off" aria-label="${escapeHtml(field.key || "新环境变量")}的值">
    <span class="env-state ${field.configured ? "configured" : ""}">${field.configured ? "已配置" : "新增"}</span>
    <input type="checkbox" data-rsshub-clear hidden>
    <button type="button" class="kv-remove" data-rsshub-remove aria-label="删除 ${escapeHtml(field.key || "新环境变量")}">删除</button>
  </div>`;
}

function updateRsshubPendingHint() {
  const hint = document.getElementById("rsshub-pending-hint");
  if (!hint) return;
  const count = document.querySelectorAll("#rsshub-env-fields .rsshub-kv-row.pending-delete").length;
  hint.hidden = count === 0;
  hint.textContent = count ? `有 ${count} 项待删除，保存后生效` : "";
}

function renderRsshubKv(fields) {
  const node = document.getElementById("rsshub-env-fields");
  node.innerHTML = fields.length ? fields.map((field) => rsshubKvMarkup(field, true)).join("") : '<div class="kv-empty">尚无 RSSHub 环境变量，按需新增即可。</div>';
  updateRsshubPendingHint();
}

function addRsshubKvRow() {
  const node = document.getElementById("rsshub-env-fields");
  node.querySelector(".kv-empty")?.remove();
  node.insertAdjacentHTML("beforeend", rsshubKvMarkup());
  node.querySelector(".rsshub-kv-row:last-child .kv-key")?.focus();
}

function renderModelSettings() {
  const node = document.getElementById("runtime-model-list");
  if (!node) return;
  const providers = runtimeModels?.providers || [];
  node.innerHTML = providers.length ? providers.map((provider) => `<button type="button" class="runtime-model-item ${provider.enabled === false ? "disabled" : ""}" data-model-edit="${escapeHtml(provider.name)}"><b>${escapeHtml(provider.label)}</b><small>${escapeHtml(provider.model)} · ${escapeHtml(provider.baseUrl)}</small><em>${provider.enabled === false ? "已停用" : provider.configured ? "已配置" : "缺少 Key"}${provider.name === runtimeModels.defaultProvider ? " · 默认" : ""}</em></button>`).join("") : '<div class="kv-empty">暂无模型配置。</div>';
}

function openModelProviderManager(editId = "") {
  const editor=document.getElementById("system-extension-editor");
  const legacy=document.getElementById("config-panel-models");
  const list=document.getElementById("runtime-model-list");
  const panel=legacy?.querySelector(".model-config-panel");
  if(!editor||!list||!panel)return;
  editor.innerHTML='<div class="config-panel-heading"><div><span class="kicker">OPENAI-COMPATIBLE</span><h4>模型接入</h4></div><p>添加兼容 OpenAI Chat Completions API 的模型渠道；保存后即时进入模型网关。</p></div><div id="model-provider-manager"></div>';
  const manager=document.getElementById("model-provider-manager");
  manager.append(list,panel);
  if(editId)editModelConfig(editId);else resetModelForm();
  document.getElementById("model-label")?.focus();
}

async function loadModelSettings() {
  runtimeModels = await request("/api/models");
  // 与 models.js / main.js 共用一份模型快照，避免模型配置改动后其他视图拿到旧数据
  state.models = runtimeModels;
  window.__models = runtimeModels;
  renderModelSettings();
}

function resetModelForm() {
  document.getElementById("model-config-form")?.reset();
  document.getElementById("model-existing-id").value = "";
  document.getElementById("model-id").disabled = false;
  document.getElementById("model-context-window").value = "128000";
  document.getElementById("model-max-output").value = "";
  document.getElementById("model-tagging-chunk").value = "6";
  document.getElementById("model-tagging-concurrency").value = "4";
  document.getElementById("model-json-mode").checked = true;
  document.getElementById("model-enabled").checked = true;
  document.getElementById("model-config-title").textContent = "新增模型配置";
  document.getElementById("delete-model-config").hidden = true;
}

function editModelConfig(id) {
  const provider = runtimeModels?.providers?.find((item) => item.name === id);
  if (!provider) return;
  document.getElementById("model-existing-id").value = provider.name;
  document.getElementById("model-id").value = provider.name;
  document.getElementById("model-id").disabled = true;
  document.getElementById("model-label").value = provider.label || provider.name;
  document.getElementById("model-base-url").value = provider.baseUrl || "";
  document.getElementById("model-name").value = provider.model || "";
  document.getElementById("model-api-key").value = "";
  document.getElementById("model-context-window").value = provider.contextWindow || 128000;
  document.getElementById("model-max-output").value = provider.maxOutputTokens || "";
  document.getElementById("model-max-token-field").value = provider.maxTokensField || "max_tokens";
  document.getElementById("model-tagging-chunk").value = provider.taggingChunkSize || 6;
  document.getElementById("model-tagging-concurrency").value = provider.taggingConcurrency || 4;
  document.getElementById("model-json-mode").checked = provider.supportsJsonMode !== false;
  document.getElementById("model-enabled").checked = provider.enabled !== false;
  document.getElementById("model-default").checked = provider.name === runtimeModels.defaultProvider;
  document.getElementById("model-config-title").textContent = `编辑 · ${provider.label}`;
  document.getElementById("delete-model-config").hidden = false;
}

function modelFormPayload() {
  return {
    existingId: document.getElementById("model-existing-id").value,
    id: document.getElementById("model-id").value,
    label: document.getElementById("model-label").value,
    baseUrl: document.getElementById("model-base-url").value,
    model: document.getElementById("model-name").value,
    apiKey: document.getElementById("model-api-key").value,
    contextWindow: Number(document.getElementById("model-context-window").value),
    maxOutputTokens: Number(document.getElementById("model-max-output").value) || undefined,
    maxTokensField: document.getElementById("model-max-token-field").value,
    taggingChunkSize: Number(document.getElementById("model-tagging-chunk").value),
    taggingConcurrency: Number(document.getElementById("model-tagging-concurrency").value),
    supportsJsonMode: document.getElementById("model-json-mode").checked,
    enabled: document.getElementById("model-enabled").checked,
    makeDefault: document.getElementById("model-default").checked,
  };
}

async function saveModelConfig(button) {
  const original = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "正在保存…";
  }
  try {
    const result = await request("/api/models/config", { method: "POST", body: JSON.stringify(modelFormPayload()) });
    toast("模型配置已保存并即时生效");
    await loadModelSettings();
    await loadExtensionConfigurations();
    openModelProviderManager(result.id);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

async function deleteModelConfig(button) {
  const id = document.getElementById("model-existing-id").value;
  if (!id) return;
  const isDefault = id === runtimeModels?.defaultProvider;
  const fallback = runtimeModels?.providers?.find((item) => item.name !== id && item.enabled !== false);
  let impact = `删除后，该模型将不能再被新任务选用；已指定「${id}」的任务会在运行时失败，需改选其他模型。`;
  if (isDefault) {
    impact = fallback
      ? `「${id}」是当前默认模型，删除后默认模型将回退为「${fallback.label || fallback.name}」，新任务将改用它。`
      : `「${id}」是当前默认模型，且没有其他启用的模型可回退，删除会被服务端拒绝。`;
  }
  if (!await confirmAction(`${impact} API Key 会保留在本机环境文件中，是否继续？`, { confirmText: "删除配置" })) return;
  button.disabled = true;
  try {
    await request(`/api/models/config/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("模型配置已删除");
    resetModelForm();
    await loadModelSettings();
  } finally {
    button.disabled = false;
  }
}

async function loadRuntimeSettings() {
  const data = await request("/api/system/settings");
  runtimeSettings = data;
  renderRsshubKv(data.rsshub);
  document.getElementById("runtime-paths").innerHTML = `<span><b>工作区</b>${escapeHtml(data.paths.workspaceRoot)}</span><span><b>RSSHub</b>${escapeHtml(data.paths.rsshubRoot)}</span><span><b>服务</b>${escapeHtml(data.paths.rsshubUrl)} · ${escapeHtml(data.paths.redditCdpUrl)}</span>`;
}

async function saveRsshubConfiguration(button) {
  const original=button.textContent;button.disabled=true;button.textContent="保存中…";
  try{await request("/api/system/settings",{method:"PUT",body:JSON.stringify({app:[],rsshub:collectRsshubFields()})});await loadRuntimeSettings();const item=extensionConfigurations.find((entry)=>entry.id==='rsshub-collector');if(item)renderSystemExtensionEditor(item);toast("RSSHub 扩展变量已保存");}
  finally{button.disabled=false;button.textContent=original;}
}

function collectRsshubFields() {
  return [...document.querySelectorAll("#rsshub-env-fields .rsshub-kv-row")].map((row) => ({
    key: row.querySelector("[data-rsshub-key]").value,
    value: row.querySelector("[data-rsshub-value]").value,
    clear: row.querySelector("[data-rsshub-clear]").checked,
  }));
}

async function controlRuntime(button) {
  const service = button.dataset.runtimeService;
  const action = button.dataset.runtimeAction;
  const labels = { start: "启动中…", stop: "停止中…", restart: "重启中…" };
  const original = button.textContent;
  button.disabled = true;
  button.textContent = labels[action];
  try {
    const result = await request(`/api/system/runtime/${service}/${action}`, { method: "POST", body: "{}" });
    toast(result.message || "操作完成");
    await loadSystem(service);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function loadSystem(target = "all", button = null) {
  const original = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "检查中…";
  }
  // 结果 toast 统一在检查完成后给出，过程不再弹"检查中"
  let health;
  try {
    health = await request(`/api/system/health${target === "all" ? "" : `?target=${encodeURIComponent(target)}`}`);
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
    throw error;
  }
  const reddit = document.getElementById("reddit-status");
  const rss = document.getElementById("rsshub-status");
  const github = document.getElementById("github-status");
  if (reddit && health.reddit) {
    reddit.textContent = health.reddit.ok ? `已连接 · ${health.reddit.tabs} 个标签页` : "未连接";
    reddit.className = `status-pill ${health.reddit.ok ? "ok" : "bad"}`;
  }
  if (rss && health.rsshub) {
    rss.textContent = health.rsshub.ok ? "已连接" : "未连接";
    rss.className = `status-pill ${health.rsshub.ok ? "ok" : "bad"}`;
  }
  if (github && health.github) {
    const gh = health.github;
    github.textContent = gh.status === "idle" ? "尚未请求" : gh.status === "ok" ? "已连接" : gh.status === "degraded" ? "缓存降级" : "请求失败";
    github.className = `status-pill ${gh.status === "ok" ? "ok" : gh.status === "idle" ? "unknown" : "bad"}`;
    const quota = document.getElementById("github-quota");
    if (quota) {
      quota.textContent = gh.limit
        ? `REST ${gh.resource || "core"} · 剩余 ${gh.remaining}/${gh.limit} · 重置 ${gh.resetAt ? new Date(gh.resetAt).toLocaleString() : "未知"} · 缓存命中 ${gh.cacheHits || 0}`
        : `${gh.tokenConfigured ? "Token 已配置，等待首次请求" : "未配置 Token"} · 缓存命中 ${gh.cacheHits || 0}${gh.lastError ? ` · ${gh.lastError}` : ""}`;
    }
  }
  const checked = document.getElementById("system-last-checked");
  if (checked) checked.textContent = `最后检查：${new Date(health.now).toLocaleString("zh-CN")}${target === "all" ? "" : ` · ${target.toUpperCase()}`}`;
  const indicator = document.getElementById("nav-runtime-indicator");
  if (indicator && target === "all") {
    const allOk = health.reddit?.ok && health.rsshub?.ok;
    indicator.className = allOk ? "ok" : "attention";
    indicator.title = allOk ? "采集依赖运行正常" : "有采集依赖需要处理";
  }
  if (button) {
    button.disabled = false;
    button.textContent = original;
  }
  toast(target === "all" ? "采集环境检查完成" : "当前卡片检查完成");
}

export default async function loadSystemView() {
  bindSystem();
  await Promise.all([loadSystem(), loadRuntimeSettings(), loadModelSettings(), loadExtensionConfigurations()]);
}
