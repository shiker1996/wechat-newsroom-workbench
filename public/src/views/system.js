import { request } from "../core/http.js";
import { escapeHtml, toast, confirmAction } from "../core/ui.js";

let bound = false;
let validatedBackup = null;
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
  {id:"models",label:"模型服务",hint:"DeepSeek、MiniMax、Kimi 与搜索增强",keys:["DEEPSEEK_API_KEY","MINIMAX_API_KEY","MOONSHOT_API_KEY","TAVILY_API_KEY"]},
  {id:"fetch",label:"原文抓取",hint:"Python、Firecrawl 与抓取策略",keys:["WRITE_ASSISTANT_PYTHON","SOURCE_FETCH_PROVIDER","FIRECRAWL_MCP_URL","FIRECRAWL_API_KEY","GITHUB_TOKEN"]},
  {id:"storage",label:"图片存储",hint:"又拍云上传与访问地址",keys:["UPYUN_BUCKET","UPYUN_OPERATOR","UPYUN_PASSWORD","UPYUN_DOMAIN","UPYUN_PREFIX"]},
  {id:"runtime",label:"工作台运行",hint:"本机 Web 服务参数",keys:["WORKBENCH_PORT"]},
];

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
  const assigned=new Set(APP_ENV_GROUPS.flatMap((group)=>group.keys));
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

async function loadRuntimeSettings(){
  const data=await request("/api/system/settings");
  renderAppEnvGroups(data.app);
  renderRsshubKv(data.rsshub);
  const paths=document.getElementById("runtime-paths");
  paths.innerHTML=`<span><b>工作区</b>${escapeHtml(data.paths.workspaceRoot)}</span><span><b>RSSHub</b>${escapeHtml(data.paths.rsshubRoot)}</span><span><b>服务</b>${escapeHtml(data.paths.rsshubUrl)} · ${escapeHtml(data.paths.redditCdpUrl)}</span>`;
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
export default async function loadSystemView() {
  bindSystem();
  try{selectConfigTab(sessionStorage.getItem("runtime-config-tab")||"app");}catch{selectConfigTab("app");}
  await Promise.all([loadSystem(),loadRuntimeSettings()]);
}
