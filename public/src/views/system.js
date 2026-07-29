import { request } from "../core/http.js";
import { escapeHtml, toast, confirmAction } from "../core/ui.js";

let bound = false;
let validatedBackup = null;
let runtimeModels = null;
let skillRegistryData = null;
let selectedSkillId = "";
let credentialPluginId = "";
function bindSystem() {
  if (bound) return;
  bound = true;
  document.getElementById("health-button").addEventListener("click", () => {
    // go('system') 会触发本模块 default 重新检查一次，无需重复调用
    window.go("system");
  });
  document.getElementById("system-health").addEventListener("click", () => {
    loadSystem().catch((error) => toast(error.message));
  });
  document.querySelectorAll("[data-health-target]").forEach((button)=>button.addEventListener("click",()=>{
    loadSystem(button.dataset.healthTarget,button).catch((error)=>toast(error.message));
  }));
  document.querySelectorAll("[data-runtime-service]").forEach((button)=>button.addEventListener("click",()=>{
    controlRuntime(button).catch((error)=>toast(error.message));
  }));
  document.getElementById("save-runtime-settings")?.addEventListener("click",(event)=>{
    saveRuntimeSettings(event.currentTarget).catch((error)=>toast(error.message));
  });
  document.getElementById("add-rsshub-env")?.addEventListener("click",()=>addRsshubKvRow());
  document.getElementById("new-model-config")?.addEventListener("click",()=>resetModelForm());
  document.getElementById("model-config-form")?.addEventListener("submit",(event)=>{
    event.preventDefault();saveModelConfig(event.submitter).catch((error)=>toast(error.message));
  });
  document.getElementById("delete-model-config")?.addEventListener("click",(event)=>{
    deleteModelConfig(event.currentTarget).catch((error)=>toast(error.message));
  });
  document.getElementById("runtime-model-list")?.addEventListener("click",(event)=>{
    const item=event.target.closest("[data-model-edit]");if(item)editModelConfig(item.dataset.modelEdit);
  });
  document.getElementById("skill-registry-list")?.addEventListener("click",(event)=>{
    const item=event.target.closest("[data-skill-edit]");if(item)openSkillConfig(item.dataset.skillEdit).catch((error)=>toast(error.message));
  });
  document.getElementById("tool-capability-list")?.addEventListener("click",(event)=>{
    const testButton=event.target.closest("[data-tool-test]");
    const historyButton=event.target.closest("[data-tool-history]");
    const versionsButton=event.target.closest("[data-tool-versions]");
    const uninstallButton=event.target.closest("[data-tool-uninstall]");
    const credentialButton=event.target.closest("[data-tool-credential]");
    if(testButton)testToolPlugin(testButton.dataset.toolTest,testButton).catch((error)=>toast(error.message));
    if(historyButton)loadToolHistory(historyButton.dataset.toolHistory).catch((error)=>toast(error.message));
    if(versionsButton)manageToolPluginVersions(versionsButton.dataset.toolVersions).catch((error)=>toast(error.message));
    if(uninstallButton)uninstallManagedToolPlugin(uninstallButton.dataset.toolUninstall).catch((error)=>toast(error.message));
    if(credentialButton)openRemoteCredential(credentialButton.dataset.toolCredential);
  });
  document.getElementById("tool-capability-list")?.addEventListener("change",(event)=>{
    const toggle=event.target.closest("[data-tool-enabled]");
    const priority=event.target.closest("[data-tool-priority]");
    if(toggle)updateToolPlugin(toggle.dataset.toolEnabled,{enabled:toggle.checked},toggle).catch((error)=>{toggle.checked=!toggle.checked;toast(error.message);});
    if(priority)updateToolPlugin(priority.dataset.toolPriority,{priority:Number(priority.value)},priority).catch((error)=>toast(error.message));
  });
  document.getElementById("information-slot-list")?.addEventListener("change",(event)=>{
    const select=event.target.closest("[data-information-slot]");
    if(select)updateInformationSlot(select.dataset.informationSlot,select.value,select).catch((error)=>toast(error.message));
  });
  document.getElementById("information-slot-list")?.addEventListener("click",(event)=>{
    if(event.target.closest("[data-connect-information-tool]"))selectCapabilityTab("extensions");
  });
  document.getElementById("tool-execution-close")?.addEventListener("click",()=>{
    document.getElementById("tool-execution-panel").hidden=true;
  });
  document.getElementById("skill-search")?.addEventListener("input",()=>renderSkillList());
  document.getElementById("skill-status-filter")?.addEventListener("change",()=>renderSkillList());
  const skillStatusFilter=document.getElementById("skill-status-filter");
  if(skillStatusFilter&&!skillStatusFilter.querySelector('[value="installed"]'))skillStatusFilter.insertAdjacentHTML("beforeend",'<option value="installed">第三方</option>');
  document.getElementById("validate-skill-package")?.addEventListener("click",()=>submitSkillDirectory(false).catch((error)=>toast(error.message)));
  document.getElementById("install-skill-package")?.addEventListener("click",()=>submitSkillDirectory(true).catch((error)=>toast(error.message)));
  document.getElementById("skill-package-zip")?.addEventListener("change",(event)=>submitSkillZip(event.target.files?.[0],event.target).catch((error)=>toast(error.message)));
  document.getElementById("skill-package-actions")?.addEventListener("click",(event)=>{
    const button=event.target.closest("[data-skill-package-action]");if(button)manageSkillPackage(button).catch((error)=>toast(error.message));
  });
  document.getElementById("validate-tool-package")?.addEventListener("click",()=>submitToolPackage(false).catch((error)=>toast(error.message)));
  document.getElementById("install-tool-package")?.addEventListener("click",()=>submitToolPackage(true).catch((error)=>toast(error.message)));
  document.getElementById("validate-remote-plugin")?.addEventListener("click",()=>submitRemotePlugin(false).catch((error)=>toast(error.message)));
  document.getElementById("install-remote-plugin")?.addEventListener("click",()=>submitRemotePlugin(true).catch((error)=>toast(error.message)));
  document.getElementById("save-remote-credential")?.addEventListener("click",()=>saveRemoteCredential().catch((error)=>toast(error.message)));
  document.getElementById("cancel-remote-credential")?.addEventListener("click",()=>closeRemoteCredential());
  document.querySelector(".capability-section-tabs")?.addEventListener("click",(event)=>{
    const button=event.target.closest("[data-capability-tab]");if(button)selectCapabilityTab(button.dataset.capabilityTab);
  });
  document.querySelector(".config-tabbar")?.addEventListener("click",(event)=>{
    const button=event.target.closest("[data-config-tab]");if(button)selectConfigTab(button.dataset.configTab);
  });
  document.getElementById("rsshub-env-fields")?.addEventListener("click",(event)=>{
    const remove=event.target.closest("[data-rsshub-remove]");if(!remove)return;
    const row=remove.closest(".rsshub-kv-row");
    if(row.dataset.existing==="true"){row.classList.toggle("pending-delete");row.querySelector("[data-rsshub-clear]").checked=row.classList.contains("pending-delete");remove.textContent=row.classList.contains("pending-delete")?"撤销":"删除";}
    else row.remove();
  });
  document.getElementById("download-backup")?.addEventListener("click", async (event) => {
    const button=event.currentTarget,original=button.textContent;
    button.disabled=true;button.textContent="正在生成…";
    try {
      const response=await fetch("/api/system/backup");
      if(!response.ok)throw new Error((await response.json()).error||"备份失败");
      const blob=await response.blob(),url=URL.createObjectURL(blob);
      const link=document.createElement("a");link.href=url;
      link.download=response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1]||"write-assistant-backup.zip";
      link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      toast("备份已通过完整性校验并开始下载");
    } catch(error){toast(error.message);}
    finally{button.disabled=false;button.textContent=original;}
  });
  document.getElementById("backup-file")?.addEventListener("change",async(event)=>{
    const file=event.target.files?.[0],status=document.getElementById("backup-validation"),restore=document.getElementById("restore-backup");
    validatedBackup=null;restore.disabled=true;
    if(!file){status.textContent="尚未选择备份包";status.className="backup-validation";return;}
    status.textContent="正在校验备份包…";status.className="backup-validation checking";
    try{
      const response=await fetch("/api/system/backup/validate",{method:"POST",headers:{"content-type":"application/zip"},body:file});
      const result=await response.json();if(!response.ok)throw new Error(result.error);
      validatedBackup=file;restore.disabled=false;
      status.textContent=`校验通过 · ${result.fileCount} 个文件 · ${(result.totalBytes/1024/1024).toFixed(1)} MB · ${new Date(result.createdAt).toLocaleString("zh-CN")}`;
      status.className="backup-validation valid";
    }catch(error){status.textContent=`校验失败 · ${error.message}`;status.className="backup-validation invalid";}
  });
  document.getElementById("restore-backup")?.addEventListener("click",async(event)=>{
    if(!validatedBackup)return;
    if(!await confirmAction("恢复将用备份数据替换当前工作台数据。系统会先自动保存一份恢复前快照，是否继续？",{confirmText:"确认恢复"}))return;
    const button=event.currentTarget,original=button.textContent;button.disabled=true;button.textContent="正在恢复…";
    try{
      const response=await fetch("/api/system/backup/restore",{method:"POST",headers:{"content-type":"application/zip","x-restore-confirm":"RESTORE"},body:validatedBackup});
      const result=await response.json();if(!response.ok)throw new Error(result.error);
      toast(`恢复完成，已保留恢复前快照 ${result.safetyBackup}`);
      validatedBackup=null;document.getElementById("backup-file").value="";
      document.getElementById("backup-validation").textContent=`恢复完成 · ${result.batches} 个批次`;
      document.getElementById("backup-validation").className="backup-validation valid";
    }catch(error){toast(error.message);}
    finally{button.disabled=!validatedBackup;button.textContent=original;}
  });
}

function selectConfigTab(name){
  document.querySelectorAll("[data-config-tab]").forEach((button)=>{
    const active=button.dataset.configTab===name;button.classList.toggle("active",active);button.setAttribute("aria-selected",String(active));
  });
  document.querySelectorAll("[data-config-panel]").forEach((panel)=>{
    const active=panel.dataset.configPanel===name;panel.classList.toggle("active",active);panel.hidden=!active;
  });
  try{sessionStorage.setItem("runtime-config-tab",name);}catch{}
}

function renderEnvFields(target, fields) {
  const node=document.getElementById(target);
  node.innerHTML=fields.map((field)=>`<label class="env-field">
    <span><b>${escapeHtml(field.label)}</b><code>${escapeHtml(field.key)}</code></span>
    <span class="env-state ${field.configured?"configured":""}">${field.configured?"已配置":"未配置"}</span>
    <input data-env-key="${escapeHtml(field.key)}" data-env-secret="${field.secret}" type="${field.secret?"password":"text"}" value="${escapeHtml(field.value||"")}" placeholder="${field.secret&&field.configured?"留空保持现值":"输入配置值"}" autocomplete="off">
    <label class="env-clear"><input type="checkbox" data-env-clear="${escapeHtml(field.key)}"> 清除</label>
  </label>`).join("");
}

const APP_ENV_GROUPS=[
  {id:"fetch",label:"原文抓取",hint:"Python、Firecrawl、搜索增强与抓取策略",keys:["WRITE_ASSISTANT_PYTHON","SOURCE_FETCH_PROVIDER","FIRECRAWL_MCP_URL","FIRECRAWL_API_KEY","GITHUB_TOKEN","TAVILY_API_KEY"]},
  {id:"storage",label:"图片存储",hint:"又拍云上传与访问地址",keys:["UPYUN_BUCKET","UPYUN_OPERATOR","UPYUN_PASSWORD","UPYUN_DOMAIN","UPYUN_PREFIX"]},
  {id:"runtime",label:"工作台运行",hint:"本机 Web 服务参数",keys:["WORKBENCH_PORT"]},
];
const LEGACY_MODEL_ENV_KEYS=["DEEPSEEK_API_KEY","MINIMAX_API_KEY","MOONSHOT_API_KEY"];

function envFieldMarkup(field){
  return `<label class="env-field">
    <span><b>${escapeHtml(field.label)}</b><code>${escapeHtml(field.key)}</code></span>
    <span class="env-state ${field.configured?"configured":""}">${field.configured?"已配置":"未配置"}</span>
    <input data-env-key="${escapeHtml(field.key)}" data-env-secret="${field.secret}" type="${field.secret?"password":"text"}" value="${escapeHtml(field.value||"")}" placeholder="${field.secret&&field.configured?"留空保持现值":"输入配置值"}" autocomplete="off">
    <label class="env-clear"><input type="checkbox" data-env-clear="${escapeHtml(field.key)}"> 清除</label>
  </label>`;
}

function renderAppEnvGroups(fields){
  const byKey=new Map(fields.map((field)=>[field.key,field]));
  const assigned=new Set([...APP_ENV_GROUPS.flatMap((group)=>group.keys),...LEGACY_MODEL_ENV_KEYS]);
  const groups=[...APP_ENV_GROUPS];
  const other=fields.filter((field)=>!assigned.has(field.key));
  if(other.length)groups.push({id:"other",label:"其他服务",hint:"其他可选运行参数",keys:other.map((field)=>field.key)});
  document.getElementById("app-env-fields").innerHTML=groups.map((group)=>{
    const items=group.keys.map((key)=>byKey.get(key)).filter(Boolean);
    const configured=items.filter((item)=>item.configured).length;
    return `<details class="env-group" data-env-group="${group.id}">
      <summary><span><b>${escapeHtml(group.label)}</b><small>${escapeHtml(group.hint)}</small></span><em>${configured} / ${items.length} 已配置</em></summary>
      <div class="env-group-fields">${items.map(envFieldMarkup).join("")}</div>
    </details>`;
  }).join("");
}

function rsshubKvMarkup(field={key:"",configured:false},existing=false){
  return `<div class="rsshub-kv-row" data-existing="${existing}">
    <input class="kv-key" data-rsshub-key value="${escapeHtml(field.key)}" placeholder="PLATFORM_TOKEN" ${existing?"readonly":""} aria-label="环境变量名">
    <input class="kv-value" data-rsshub-value type="password" value="" placeholder="${field.configured?"•••••••• · 留空保持原值":"输入配置值"}" autocomplete="off" aria-label="${escapeHtml(field.key||"新环境变量")}的值">
    <span class="env-state ${field.configured?"configured":""}">${field.configured?"已配置":"新增"}</span>
    <input type="checkbox" data-rsshub-clear hidden>
    <button type="button" class="kv-remove" data-rsshub-remove aria-label="${existing?"删除":"移除"} ${escapeHtml(field.key||"新环境变量")}">${existing?"删除":"×"}</button>
  </div>`;
}
function renderRsshubKv(fields){
  const node=document.getElementById("rsshub-env-fields");
  node.innerHTML=fields.length?fields.map((field)=>rsshubKvMarkup(field,true)).join(""):'<div class="kv-empty">尚无 RSSHub 环境变量，按需新增即可。</div>';
}
function addRsshubKvRow(){
  const node=document.getElementById("rsshub-env-fields");node.querySelector(".kv-empty")?.remove();
  node.insertAdjacentHTML("beforeend",rsshubKvMarkup());node.querySelector(".rsshub-kv-row:last-child .kv-key")?.focus();
}

function renderModelSettings(){
  const node=document.getElementById("runtime-model-list");if(!node)return;
  const providers=runtimeModels?.providers||[];
  node.innerHTML=providers.length?providers.map((provider)=>`<button type="button" class="runtime-model-item ${provider.enabled===false?"disabled":""}" data-model-edit="${escapeHtml(provider.name)}"><b>${escapeHtml(provider.label)}</b><small>${escapeHtml(provider.model)} · ${escapeHtml(provider.baseUrl)}</small><em>${provider.enabled===false?"已停用":provider.configured?"已配置":"缺少 Key"}${provider.name===runtimeModels.defaultProvider?" · 默认":""}</em></button>`).join(""):'<div class="kv-empty">暂无模型配置。</div>';
}

async function loadModelSettings(){
  runtimeModels=await request("/api/models");
  renderModelSettings();
}

function resetModelForm(){
  document.getElementById("model-config-form")?.reset();
  document.getElementById("model-existing-id").value="";
  document.getElementById("model-id").disabled=false;
  document.getElementById("model-context-window").value="128000";
  document.getElementById("model-max-output").value="8192";
  document.getElementById("model-tagging-chunk").value="6";
  document.getElementById("model-tagging-concurrency").value="4";
  document.getElementById("model-json-mode").checked=true;
  document.getElementById("model-enabled").checked=true;
  document.getElementById("model-config-title").textContent="新增模型配置";
  document.getElementById("delete-model-config").hidden=true;
}

function editModelConfig(id){
  const provider=runtimeModels?.providers?.find((item)=>item.name===id);if(!provider)return;
  document.getElementById("model-existing-id").value=provider.name;
  document.getElementById("model-id").value=provider.name;
  document.getElementById("model-id").disabled=true;
  document.getElementById("model-label").value=provider.label||provider.name;
  document.getElementById("model-base-url").value=provider.baseUrl||"";
  document.getElementById("model-name").value=provider.model||"";
  document.getElementById("model-api-key").value="";
  document.getElementById("model-context-window").value=provider.contextWindow||128000;
  document.getElementById("model-max-output").value=provider.maxOutputTokens||8192;
  document.getElementById("model-max-token-field").value=provider.maxTokensField||"max_tokens";
  document.getElementById("model-tagging-chunk").value=provider.taggingChunkSize||6;
  document.getElementById("model-tagging-concurrency").value=provider.taggingConcurrency||4;
  document.getElementById("model-json-mode").checked=provider.supportsJsonMode!==false;
  document.getElementById("model-enabled").checked=provider.enabled!==false;
  document.getElementById("model-default").checked=provider.name===runtimeModels.defaultProvider;
  document.getElementById("model-config-title").textContent=`编辑 · ${provider.label}`;
  document.getElementById("delete-model-config").hidden=false;
}

function modelFormPayload(){
  return {
    existingId:document.getElementById("model-existing-id").value,id:document.getElementById("model-id").value,
    label:document.getElementById("model-label").value,baseUrl:document.getElementById("model-base-url").value,
    model:document.getElementById("model-name").value,apiKey:document.getElementById("model-api-key").value,
    contextWindow:Number(document.getElementById("model-context-window").value),maxOutputTokens:Number(document.getElementById("model-max-output").value),
    maxTokensField:document.getElementById("model-max-token-field").value,taggingChunkSize:Number(document.getElementById("model-tagging-chunk").value),
    taggingConcurrency:Number(document.getElementById("model-tagging-concurrency").value),supportsJsonMode:document.getElementById("model-json-mode").checked,
    enabled:document.getElementById("model-enabled").checked,makeDefault:document.getElementById("model-default").checked,
  };
}

async function saveModelConfig(button){
  const original=button?.textContent;if(button){button.disabled=true;button.textContent="正在保存…";}
  try{
    const result=await request("/api/models/config",{method:"POST",body:JSON.stringify(modelFormPayload())});
    toast("模型配置已保存并即时生效");await loadModelSettings();editModelConfig(result.id);
  }finally{if(button){button.disabled=false;button.textContent=original;}}
}

async function deleteModelConfig(button){
  const id=document.getElementById("model-existing-id").value;if(!id)return;
  if(!await confirmAction("删除后，该模型将不能再被新任务选用。API Key 会保留在本机环境文件中，是否继续？",{confirmText:"删除配置"}))return;
  button.disabled=true;
  try{await request(`/api/models/config/${encodeURIComponent(id)}`,{method:"DELETE"});toast("模型配置已删除");resetModelForm();await loadModelSettings();}
  finally{button.disabled=false;}
}

async function loadRuntimeSettings(){
  const data=await request("/api/system/settings");
  renderAppEnvGroups(data.app);
  renderRsshubKv(data.rsshub);
  const paths=document.getElementById("runtime-paths");
  paths.innerHTML=`<span><b>工作区</b>${escapeHtml(data.paths.workspaceRoot)}</span><span><b>RSSHub</b>${escapeHtml(data.paths.rsshubRoot)}</span><span><b>服务</b>${escapeHtml(data.paths.rsshubUrl)} · ${escapeHtml(data.paths.redditCdpUrl)}</span>`;
}

async function loadSkillRegistry(){
  const [data,slotData]=await Promise.all([
    request("/api/system/skills"),
    request("/api/system/information-capability-slots"),
  ]);
  skillRegistryData=data;
  const summary=document.getElementById("skill-registry-summary");
  const availableTools=data.tools.filter((tool)=>tool.health?.status==="ok"&&tool.health.data?.available!==false).length;
  const configuredSkills=data.skills.filter((skill)=>skill.configured).length;
  const thirdPartySkills=data.skills.filter((skill)=>skill.thirdParty).length;
  const remoteTools=data.tools.filter((tool)=>tool.remote).length;
  const connectedSlots=(slotData.items||[]).filter((slot)=>slot.available).length;
  if(summary)summary.innerHTML=`<span><b>${data.total}</b><small>创作技能</small><em>${thirdPartySkills?`${thirdPartySkills} 个已安装`:"全部为内置"}</em></span><span><b>${connectedSlots}/${slotData.items.length}</b><small>信息能力就绪</small><em>${connectedSlots===slotData.items.length?"写作资料能力完整":`${slotData.items.length-connectedSlots} 项可继续连接`}</em></span><span><b>${configuredSkills}</b><small>自定义配置</small><em>任务启动后冻结</em></span>`;
  const toolSummary=document.getElementById("tool-capability-summary");
  if(toolSummary)toolSummary.textContent=availableTools===data.tools.length?`${data.tools.length} 个插件运行正常`:`${data.tools.length-availableTools} 个插件需要处理`;
  const disclosure=document.querySelector(".tool-capability-disclosure");
  if(disclosure&&availableTools<data.tools.length)disclosure.open=true;
  const toolList=document.getElementById("tool-capability-list");
  if(toolList)toolList.innerHTML=data.tools.length?data.tools.map((tool)=>{
    const checked=Boolean(tool.health);
    const healthy=checked&&tool.health.status==="ok"&&tool.health.data?.available!==false;
    const status=!tool.enabled?"已停用":checked?(healthy?"可用":"不可用"):"待检查";
    const detail=!tool.enabled?"不会参与新任务的能力解析":checked?(healthy?"依赖正常":(tool.health.error?.message||"依赖不可用")):"服务尚未返回健康检查结果，请重启工作台服务后刷新";
    const recent=tool.recentExecution;
    const audit=recent?`最近执行：${recent.status} · ${new Date(recent.finished_at||recent.started_at).toLocaleString("zh-CN")}${recent.error_code?` · ${recent.error_code}`:""}`:"尚无执行记录";
    const permissionSummary=tool.thirdParty?`来源：${tool.source?.type||"未声明"} ${tool.source?.url||""} · 兼容 ${tool.compatibleApp||"未声明"} · 完整性 ${tool.contentHash||"未记录"} · 网络域名 ${(tool.permissions?.networkDomains||[]).join("、")||"无"} · 路径 ${(tool.permissions?.pathAccess||[]).join("、")||"无"} · 外部写入 ${tool.permissions?.externalWrite?"是":"否"}`:"内置受信实现";
    return `<article class="runtime-model-item tool-plugin-item ${tool.enabled?"":"disabled"}">
      <div class="tool-plugin-title"><div><b>${escapeHtml(tool.capability)}</b><small>${escapeHtml(tool.plugin)} @ ${escapeHtml(tool.version)} · ${escapeHtml(tool.riskLevel)}</small></div><em class="${tool.enabled?(checked?(healthy?"ok":"bad"):"unknown"):"unknown"}">${status}</em></div>
      <small>${escapeHtml(detail)}</small><small>${escapeHtml(audit)}</small>
      <small>${escapeHtml(permissionSummary)}${tool.restartRequired?" · 需要重启":""}</small>
      <div class="tool-plugin-controls">
        <label class="tool-plugin-toggle"><input type="checkbox" data-tool-enabled="${escapeHtml(tool.plugin)}" ${tool.enabled?"checked":""}><span>启用插件</span></label>
        ${tool.thirdParty?"":`<label>优先级 <input type="number" min="-100" max="100" value="${Number(tool.priority)||0}" data-tool-priority="${escapeHtml(tool.plugin)}"></label>`}
        <button type="button" class="ghost-button" data-tool-test="${escapeHtml(tool.plugin)}">检查依赖</button>
        <button type="button" class="text-button" data-tool-history="${escapeHtml(tool.capability)}">执行历史</button>
        ${tool.remote?`<button type="button" class="text-button" data-tool-credential="${escapeHtml(tool.plugin)}">配置凭据</button><button type="button" class="text-button" data-tool-uninstall="${escapeHtml(tool.plugin)}">删除连接</button>`:tool.thirdParty?`<button type="button" class="text-button" data-tool-versions="${escapeHtml(tool.plugin)}">版本与回滚</button><button type="button" class="text-button" data-tool-uninstall="${escapeHtml(tool.plugin)}">卸载</button>`:""}
      </div>
    </article>`;
  }).join(""):'<div class="kv-empty">没有已注册的工具能力。</div>';
  renderInformationSlots(slotData.items||[]);
  renderSkillList();
}

function renderInformationSlots(items){
  const node=document.getElementById("information-slot-list");if(!node)return;
  const connected=items.filter((slot)=>slot.available).length;
  const summary=document.getElementById("information-slot-summary");
  if(summary)summary.innerHTML=`<b>${connected}/${items.length}</b><span>已就绪</span>`;
  const ordered=[...items].sort((a,b)=>Number(b.available)-Number(a.available));
  node.innerHTML=ordered.map((slot)=>{
    const enabled=slot.implementations.filter((item)=>item.enabled);
    const status=slot.available?"已就绪":"待连接";
    return `<article class="information-slot-card ${slot.available?"available":"missing"}">
      <div><span>${escapeHtml(slot.stage)}</span><b>${escapeHtml(slot.name)}</b><small>${escapeHtml(slot.description)}</small></div>
      <em>${escapeHtml(status)}</em>
      ${slot.available?`<label>使用的服务<select data-information-slot="${escapeHtml(slot.id)}">
        <option value="">系统自动选择</option>
        ${enabled.map((item)=>`<option value="${escapeHtml(item.plugin)}" ${slot.preferredPlugin===item.plugin?"selected":""}>${escapeHtml(item.plugin)} @ ${escapeHtml(item.version)}</option>`).join("")}
      </select></label>`:`<button type="button" class="outline-button information-slot-connect" data-connect-information-tool>连接可用工具</button>`}
      <details class="information-slot-technical"><summary>技术标识</summary><code>${escapeHtml(slot.capability)}</code></details>
    </article>`;
  }).join("");
}

async function updateInformationSlot(slotId,pluginId,control){
  control.disabled=true;
  try{
    const result=await request(`/api/system/information-capability-slots/${encodeURIComponent(slotId)}`,{
      method:"PUT",body:JSON.stringify({pluginId}),
    });
    toast(result.available?`${result.name} 已使用 ${result.selectedPlugin}`:`${result.name} 当前没有可用实现`);
    await loadSkillRegistry();
  }finally{control.disabled=false;}
}

function selectCapabilityTab(tab){
  const selected=["skills","tools","extensions"].includes(tab)?tab:"skills";
  document.querySelectorAll("[data-capability-tab]").forEach((button)=>{
    const active=button.dataset.capabilityTab===selected;button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));
  });
  document.querySelectorAll("[data-capability-section]").forEach((section)=>{section.hidden=section.dataset.capabilitySection!==selected;});
  try{sessionStorage.setItem("capability-section",selected);}catch{}
}

async function submitSkillDirectory(install){
  const directory=document.getElementById("skill-package-directory").value.trim();
  if(!directory)throw new Error("请输入技能包目录");
  const result=await request(`/api/system/skill-packages/${install?"install":"validate"}`,{method:"POST",body:JSON.stringify({directory})});
  toast(install?`已安装 ${result.name||result.id}`:`校验通过：${result.manifest?.name||result.manifest?.id}`);
  if(install)await loadSkillRegistry();
}

async function submitToolPackage(install){
  const directory=document.getElementById("tool-package-directory").value.trim();
  if(!directory)throw new Error("请输入插件包目录");
  if(install&&!await confirmAction("仅管理员可以安装本地 adapter。确认该插件已完成代码审查，并接受页面展示的权限范围？",{confirmText:"受信安装"}))return;
  const result=await request(`/api/system/tool-plugin-packages/${install?"install":"validate"}`,{
    method:"POST",headers:install?{"x-admin-confirm":"TRUSTED-LOCAL-PLUGIN"}:{},
    body:JSON.stringify({directory}),
  });
  const manifest=result.manifest||result;
  const permissions=manifest.permissions||{};
  toast(install?`已安装 ${manifest.name||manifest.id}，重启后可加载`:
    `校验通过：${manifest.name}；网络域名 ${(permissions.networkDomains||[]).length}，路径权限 ${(permissions.pathAccess||[]).length}，外部写入 ${permissions.externalWrite?"是":"否"}`);
  if(install)await loadSkillRegistry();
}

function remoteManifestInput(){
  const text=document.getElementById("remote-plugin-manifest").value.trim();
  if(!text)throw new Error("请输入远程插件 Manifest");
  try{return JSON.parse(text);}catch{throw new Error("远程插件 Manifest 不是有效 JSON");}
}
async function submitRemotePlugin(install){
  const manifest=remoteManifestInput();
  const result=await request(`/api/system/remote-tool-plugins${install?"":"/validate"}`,{method:"POST",body:JSON.stringify({manifest})});
  toast(install?`已保存 ${result.name||result.id}，请配置凭据并启用`:`校验通过：${result.name} · ${new URL(result.endpoint).hostname}`);
  if(install)await loadSkillRegistry();
}
function openRemoteCredential(pluginId){
  credentialPluginId=pluginId;document.getElementById("remote-credential-panel").hidden=false;
  const input=document.getElementById("remote-credential-token");input.value="";input.focus();
}
function closeRemoteCredential(){
  credentialPluginId="";document.getElementById("remote-credential-token").value="";
  document.getElementById("remote-credential-panel").hidden=true;
}
async function saveRemoteCredential(){
  const token=document.getElementById("remote-credential-token").value;
  if(!credentialPluginId||!token.trim())throw new Error("请输入凭据");
  await request(`/api/system/remote-tool-plugins/${encodeURIComponent(credentialPluginId)}/credentials`,{method:"PUT",body:JSON.stringify({token})});
  closeRemoteCredential();toast("凭据已安全保存，页面不会回读原文");await loadSkillRegistry();
}

async function submitSkillZip(file,input){
  if(!file)return;
  const response=await fetch("/api/system/skill-packages/install",{method:"POST",headers:{"content-type":"application/zip"},body:file});
  const result=await response.json();if(!response.ok)throw new Error(result.error||"安装失败");
  toast(`已安装 ${result.name||result.id}`);input.value="";await loadSkillRegistry();
}

async function manageSkillPackage(button){
  const id=button.dataset.skillId,action=button.dataset.skillPackageAction;
  if(action==="uninstall"){
    if(!await confirmAction(`卸载 ${id}？历史版本和审计记录会保留。`,{confirmText:"卸载"}))return;
    await request(`/api/system/skills/${encodeURIComponent(id)}`,{method:"DELETE"});
  }else await request(`/api/system/skills/${encodeURIComponent(id)}/status`,{method:"PATCH",body:JSON.stringify({status:action})});
  toast(action==="enabled"?"技能已启用":action==="disabled"?"技能已停用":"技能已卸载");
  selectedSkillId="";await loadSkillRegistry();
}

async function manageToolPluginVersions(pluginId){
  const result=await request(`/api/system/tool-plugins/${encodeURIComponent(pluginId)}/versions`);
  if(!result.items.length){toast("暂无可回滚的历史版本");return;}
  const version=result.items[0];
  if(!await confirmAction(`将 ${pluginId} 回滚到 ${version}？回滚后保持停用，并需重启加载。`,{confirmText:"回滚"}))return;
  await request(`/api/system/tool-plugins/${encodeURIComponent(pluginId)}/rollback`,{method:"POST",headers:{"x-admin-confirm":"TRUSTED-LOCAL-PLUGIN"},body:JSON.stringify({version})});
  toast(`已回滚到 ${version}，请重启工作台`);await loadSkillRegistry();
}

async function uninstallManagedToolPlugin(pluginId){
  const remote=skillRegistryData?.tools.some((tool)=>tool.plugin===pluginId&&tool.remote);
  if(!await confirmAction(`卸载 ${pluginId}？依赖其能力的技能将无法启动，历史归档和审计记录会保留。`,{confirmText:"确认卸载"}))return;
  await request(remote?`/api/system/remote-tool-plugins/${encodeURIComponent(pluginId)}`:`/api/system/tool-plugins/${encodeURIComponent(pluginId)}`,{method:"DELETE",headers:remote?{}:{"x-admin-confirm":"TRUSTED-LOCAL-PLUGIN"},body:JSON.stringify({confirmImpact:true})});
  toast(remote?"远程连接已删除":"插件已卸载，重启工作台后完成卸载");await loadSkillRegistry();
}

async function updateToolPlugin(pluginId,changes,control){
  const pluginView=skillRegistryData?.tools.find((tool)=>tool.plugin===pluginId);
  const installed=pluginView?.thirdParty;
  if(installed){
    if(changes.enabled===false&&!await confirmAction(`停用 ${pluginId} 后，依赖能力的新任务将被阻断。是否继续？`,{confirmText:"停用插件"})){if(control?.matches("[type=checkbox]"))control.checked=true;return;}
    if(control)control.disabled=true;
    try{
      const endpoint=pluginView.remote?`/api/system/remote-tool-plugins/${encodeURIComponent(pluginId)}/status`:`/api/system/tool-plugins/${encodeURIComponent(pluginId)}/status`;
      await request(endpoint,{method:"PATCH",headers:pluginView.remote?{}:{"x-admin-confirm":"TRUSTED-LOCAL-PLUGIN"},body:JSON.stringify({status:changes.enabled===false?"disabled":"enabled"})});
      toast(pluginView.remote?"远程连接状态已即时生效":"插件状态已保存，重启工作台后生效");await loadSkillRegistry();
    }finally{if(control)control.disabled=false;}
    return;
  }
  if(changes.enabled===false){
    const confirmed=await confirmAction(`停用 ${pluginId} 后，依赖其能力的技能将无法启动。是否继续？`,{confirmText:"停用插件"});
    if(!confirmed){if(control?.matches("[type=checkbox]"))control.checked=true;return;}
    changes.confirmDisable=true;
  }
  if(control)control.disabled=true;
  try{
    await request(`/api/system/tool-plugins/${encodeURIComponent(pluginId)}`,{method:"PATCH",body:JSON.stringify(changes)});
    toast(changes.enabled===false?"插件已停用":changes.enabled===true?"插件已启用":"插件优先级已更新");
    await loadSkillRegistry();
  }finally{if(control)control.disabled=false;}
}

async function testToolPlugin(pluginId,button){
  const original=button.textContent;button.disabled=true;button.textContent="检查中…";
  try{
    const remote=skillRegistryData?.tools.some((tool)=>tool.plugin===pluginId&&tool.remote);
    const result=await request(remote?`/api/system/remote-tool-plugins/${encodeURIComponent(pluginId)}/test`:`/api/system/tool-plugins/${encodeURIComponent(pluginId)}/test`,{method:"POST",body:"{}"});
    toast(result.pass?`${pluginId} 依赖检查通过`:`${pluginId} 当前不可用`);
    await loadSkillRegistry();
  }finally{button.disabled=false;button.textContent=original;}
}

async function loadToolHistory(capability){
  const result=await request(`/api/system/tool-executions?capability=${encodeURIComponent(capability)}&limit=50`);
  const panel=document.getElementById("tool-execution-panel"),list=document.getElementById("tool-execution-list");
  document.getElementById("tool-execution-title").textContent=`${capability} · 执行历史`;
  list.innerHTML=result.items.length?result.items.map((item)=>`<article class="runtime-model-item">
    <b>${escapeHtml(item.status)}${item.error_code?` · ${escapeHtml(item.error_code)}`:""}</b>
    <small>${new Date(item.finished_at||item.started_at).toLocaleString("zh-CN")} · ${item.duration_ms} ms</small>
    <small>${escapeHtml(item.plugin||"未解析实现")} @ ${escapeHtml(item.plugin_version||"—")} · 技能 ${escapeHtml(item.skill_id||"未关联")}</small>
    <small>参数：${escapeHtml((item.input_keys||[]).join("、")||"无")}</small>
  </article>`).join(""):'<div class="kv-empty">尚无执行记录。</div>';
  panel.hidden=false;
  panel.scrollIntoView({behavior:"smooth",block:"nearest"});
}

function renderSkillList(){
  const list=document.getElementById("skill-registry-list");if(!list||!skillRegistryData)return;
  const query=String(document.getElementById("skill-search")?.value||"").trim().toLowerCase();
  const status=document.getElementById("skill-status-filter")?.value||"all";
  const skills=skillRegistryData.skills.filter((skill)=>{
    const matchesStatus=status==="all"||(status==="configured"&&skill.configured)||(status==="builtin"&&!skill.thirdParty)||(status==="installed"&&skill.thirdParty);
    const haystack=`${skill.name||""} ${skill.id} ${skill.description||""}`.toLowerCase();
    return matchesStatus&&(!query||haystack.includes(query));
  });
  const count=document.getElementById("skill-filter-count");if(count)count.textContent=`${skills.length} / ${skillRegistryData.total}`;
  list.innerHTML=skills.length?skills.map((skill)=>`<button type="button" class="skill-list-item ${skill.id===selectedSkillId?"active":""}" data-skill-edit="${escapeHtml(skill.id)}" aria-pressed="${skill.id===selectedSkillId}">
    <span class="skill-list-item-top"><b>${escapeHtml(skill.name||skill.id)}</b><em>${skill.manifestStatus==="invalid"?"清单无效":skill.kind||"stage"}</em></span>
    <small>${escapeHtml(skill.id)} · 包 v${escapeHtml(skill.packageVersion||"legacy")} · ${skill.fileCount} 文件</small>
    ${skill.description?`<span>${escapeHtml(skill.description)}</span>`:""}
    <code title="${escapeHtml(skill.promptHash)}">${escapeHtml(skill.promptHash.slice(0,20))}…</code>
  </button>`).join(""):'<div class="skill-list-empty">没有匹配的技能。试试更短的关键词或切换状态筛选。</div>';
}

async function openSkillConfig(id){
  const data=await request(`/api/system/skills/${encodeURIComponent(id)}`);
  const ownsRuntimePolicy=data.runtimePolicyOwner!==false;
  selectedSkillId=id;renderSkillList();
  document.getElementById("skill-detail-empty").hidden=true;
  document.getElementById("skill-config-editor").hidden=false;
  document.getElementById("skill-config-title").textContent=data.name||id;
  document.getElementById("skill-config-meta").textContent=`${id} · v${data.version} · ${data.fileCount} 个规则文件${data.configured?" · 存在历史覆盖配置":""}`;
  const packageActions=document.getElementById("skill-package-actions");
  packageActions.hidden=!data.thirdParty;
  packageActions.innerHTML=data.thirdParty?`<button class="outline-button" data-skill-package-action="${data.status==="enabled"?"disabled":"enabled"}" data-skill-id="${escapeHtml(id)}">${data.status==="enabled"?"停用":"启用"}</button><button class="text-button" data-skill-package-action="uninstall" data-skill-id="${escapeHtml(id)}">卸载</button><small>入口默认配置将在 P1 路由能力启用后生效。</small>`:"";
  const policyNote=document.getElementById("skill-runtime-policy-note");
  policyNote.textContent=ownsRuntimePolicy
    ?"主技能：这里展示仓库内置契约；运行策略由程序和已发布历史配置共同决定。"
    :"子技能：这里展示阶段契约；模型、工具权限和质量门禁由调用它的主技能统一控制。";
  policyNote.classList.toggle("prompt-only",!ownsRuntimePolicy);
  document.getElementById("skill-source-path").textContent=data.sourcePath||"—";
  document.getElementById("skill-prompt-hash").textContent=data.promptHash||"—";
  const kindLabels={writer:"主写作",reviewer:"审稿",title:"标题",humanizer:"表达优化",seo:"SEO",
    "image-planner":"配图规划",typesetter:"排版主技能",stage:"阶段子技能"};
  const entryLabels={"hotspot-article":"热点文章","independent-writing":"自主写作","batch-daily":"批次早报",
    "social-tool":"工具图文","social-custom":"自定义图文","social-event":"事件图文","wechat-typeset":"公众号排版"};
  const capabilityState=(capability)=>{
    const tool=skillRegistryData.tools.find((item)=>item.capability===capability&&item.enabled);
    return tool&&tool.health?.status==="ok"&&tool.health.data?.available!==false?"可用":"不可用";
  };
  const capabilityList=(items,type)=>items.length?items.map((capability)=>`<span class="skill-capability-chip ${capabilityState(capability)==="可用"?"ok":"bad"}">${escapeHtml(capability)} · ${capabilityState(capability)} · ${type}</span>`).join(""):"<span class=\"muted\">无</span>";
  document.getElementById("skill-contract-grid").innerHTML=`
    <article><b>角色</b><span>${escapeHtml(kindLabels[data.kind]||data.kind||"旧版")}</span></article>
    <article><b>技能包版本</b><span>${escapeHtml(data.packageVersion||"legacy")} · ${escapeHtml(data.manifestStatus||"missing")}</span></article>
    <article><b>适用入口</b><span>${(data.entryPoints||[]).map((item)=>escapeHtml(entryLabels[item]||item)).join("、")||"未声明"}</span></article>
    <article><b>内容类型</b><span>${(data.contentTypes||[]).map((item)=>escapeHtml(item)).join("、")||"未声明"}</span></article>
    <article><b>输入契约</b><code>${escapeHtml(data.inputContract||"未声明")}</code></article>
    <article><b>输出契约</b><code>${escapeHtml(data.outputContract||"未声明")}</code></article>
    <article class="wide"><b>必需工具</b><div>${capabilityList(data.requiredCapabilities||[],"必需")}</div></article>
    <article class="wide"><b>可选工具</b><div>${capabilityList(data.optionalCapabilities||[],"可选")}</div></article>
    <article><b>工作台兼容</b><code>${escapeHtml(data.compatibleApp||"未声明")}</code></article>
    <article><b>清单文件</b><code>${escapeHtml(data.manifestPath||"未提供")}</code></article>`;
  document.getElementById("skill-markdown-view").textContent=data.skillMarkdown||"未读取到 SKILL.md";
  document.getElementById("skill-file-list").innerHTML=(data.files||[]).map((file,index)=>`<article class="runtime-model-item">
    <b>${index===0?"主契约":"关联规则"}</b><code>${escapeHtml(file)}</code>
  </article>`).join("")||'<div class="kv-empty">没有关联规则文件。</div>';
}

function collectEnvFields(target){
  return [...document.querySelectorAll(`#${target} [data-env-key]`)].map((input)=>({
    key:input.dataset.envKey,value:input.value,
    clear:document.querySelector(`#${target} [data-env-clear="${CSS.escape(input.dataset.envKey)}"]`)?.checked===true,
  }));
}
function collectRsshubFields(){
  return [...document.querySelectorAll("#rsshub-env-fields .rsshub-kv-row")].map((row)=>({
    key:row.querySelector("[data-rsshub-key]").value,value:row.querySelector("[data-rsshub-value]").value,
    clear:row.querySelector("[data-rsshub-clear]").checked,
  }));
}

async function saveRuntimeSettings(button){
  const original=button.textContent;button.disabled=true;button.textContent="保存中…";
  try{
    await request("/api/system/settings",{method:"PUT",body:JSON.stringify({
      app:collectEnvFields("app-env-fields"),rsshub:collectRsshubFields(),
    })});
    document.getElementById("runtime-config-status").textContent="已保存 · 密钥供后续任务立即使用；端口、进程路径与 RSSHub 配置重启对应服务后生效";
    await loadRuntimeSettings();toast("本机配置已安全保存");
  }finally{button.disabled=false;button.textContent=original;}
}

async function controlRuntime(button){
  const service=button.dataset.runtimeService,action=button.dataset.runtimeAction;
  const labels={start:"启动中…",stop:"停止中…",restart:"重启中…"};
  const original=button.textContent;button.disabled=true;button.textContent=labels[action];
  try{
    const result=await request(`/api/system/runtime/${service}/${action}`,{method:"POST",body:"{}"});
    toast(result.message||"操作完成");await loadSystem(service);
  }finally{button.disabled=false;button.textContent=original;}
}

async function loadSystem(target="all",button=null) {
  const original=button?.textContent;
  if(button){button.disabled=true;button.textContent="检查中…";}
  toast(target==="all"?"正在检查采集环境…":"正在重新检查当前卡片…");
  let health;
  try{health=await request(`/api/system/health${target==="all"?"":`?target=${encodeURIComponent(target)}`}`);}
  catch(error){if(button){button.disabled=false;button.textContent=original;}throw error;}
  const reddit = document.getElementById("reddit-status");
  const rss = document.getElementById("rsshub-status");
  const github = document.getElementById("github-status");
  if (reddit&&health.reddit) {
    reddit.textContent = health.reddit.ok ? `已连接 · ${health.reddit.tabs} 个标签页` : "未连接";
    reddit.className = "status-pill " + (health.reddit.ok ? "ok" : "bad");
  }
  if (rss&&health.rsshub) {
    rss.textContent = health.rsshub.ok ? "已连接" : "未连接";
    rss.className = "status-pill " + (health.rsshub.ok ? "ok" : "bad");
  }
  if(github&&health.github){const gh=health.github;github.textContent=gh.status==='idle'?'尚未请求':gh.status==='ok'?'已连接':gh.status==='degraded'?'缓存降级':'请求失败';github.className='status-pill '+(gh.status==='ok'?'ok':gh.status==='idle'?'unknown':'bad');const quota=document.getElementById('github-quota');if(quota)quota.textContent=gh.limit?`REST ${gh.resource||'core'} · 剩余 ${gh.remaining}/${gh.limit} · 重置 ${gh.resetAt?new Date(gh.resetAt).toLocaleString():'未知'} · 缓存命中 ${gh.cacheHits||0}`:`${gh.authenticated?'Token 已配置':'未配置 Token'} · 缓存命中 ${gh.cacheHits||0}${gh.lastError?` · ${gh.lastError}`:''}`;}
  const checked=document.getElementById("system-last-checked");
  if(checked)checked.textContent=`最后检查：${new Date(health.now).toLocaleString("zh-CN")}${target==="all"?"":` · ${target.toUpperCase()}`}`;
  const indicator=document.getElementById("nav-runtime-indicator");
  if(indicator&&target==="all"){
    const allOk=health.reddit?.ok&&health.rsshub?.ok;
    indicator.className=allOk?"ok":"attention";
    indicator.title=allOk?"采集依赖运行正常":"有采集依赖需要处理";
  }
  if(button){button.disabled=false;button.textContent=original;}
  toast(target==="all"?"采集环境检查完成":"当前卡片检查完成");
}
export default async function loadSystemView(view="system") {
  bindSystem();
  if(view==="skills"){
    let capabilitySection="skills";try{capabilitySection=sessionStorage.getItem("capability-section")||"skills";}catch{}
    selectCapabilityTab(capabilitySection);
    await loadSkillRegistry();
    return;
  }
  try{
    const saved=sessionStorage.getItem("runtime-config-tab");
    selectConfigTab(["app","rsshub","models"].includes(saved)?saved:"app");
  }catch{selectConfigTab("app");}
  await Promise.all([loadSystem(),loadRuntimeSettings(),loadModelSettings()]);
}
