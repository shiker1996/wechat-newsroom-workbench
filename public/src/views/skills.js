import { request } from "../core/http.js";
import { escapeHtml, toast, confirmAction, debounce } from "../core/ui.js";

let bound = false;
let skillRegistryData = null;
let selectedSkillId = "";
let credentialPluginId = "";
let capabilityGraphData = null;

function implementationDisableState(type,id){
  const blocking=(capabilityGraphData?.capabilities||[]).filter((capability)=>{
    if(!capability.implementations.some((item)=>item.type===type&&item.id===id))return false;
    const remaining=capability.implementations.filter((item)=>!(item.type===type&&item.id===id)&&item.available);
    return remaining.length===0&&capability.consumers.some((consumer)=>consumer.enabled&&consumer.requirement==='required');
  });
  return {canDisable:blocking.length===0,blocking};
}

// 工具列表更新后会整体重渲染，焦点所在的控件被替换；按 data 属性找回等价控件恢复焦点
function restoreToolControlFocus(pluginId, attribute) {
  if (!attribute) return;
  document.querySelector(`#tool-capability-list [${attribute}="${CSS.escape(pluginId)}"]`)?.focus();
}

function bindSkills() {
  if (bound) return;
  bound = true;
  document.getElementById("skill-registry-list")?.addEventListener("click", (event) => {
    const item = event.target.closest("[data-skill-edit]");
    if (item) openSkillConfig(item.dataset.skillEdit).catch((error) => toast(error.message));
  });
  document.getElementById("tool-capability-list")?.addEventListener("click", (event) => {
    const testButton = event.target.closest("[data-tool-test]");
    const historyButton = event.target.closest("[data-tool-history]");
    const versionsButton = event.target.closest("[data-tool-versions]");
    const uninstallButton = event.target.closest("[data-tool-uninstall]");
    const credentialButton = event.target.closest("[data-tool-credential]");
    const firstRunButton = event.target.closest("[data-tool-first-run]");
    const configButton = event.target.closest("[data-tool-config]");
    const impactButton = event.target.closest("[data-tool-impact]");
    if (testButton) testToolPlugin(testButton.dataset.toolTest, testButton).catch((error) => toast(error.message));
    if (historyButton) loadToolHistory(historyButton.dataset.toolHistory).catch((error) => toast(error.message));
    if (versionsButton) manageToolPluginVersions(versionsButton.dataset.toolVersions).catch((error) => toast(error.message));
    if (uninstallButton) uninstallManagedToolPlugin(uninstallButton.dataset.toolUninstall).catch((error) => toast(error.message));
    if (credentialButton) openRemoteCredential(credentialButton.dataset.toolCredential);
    if (firstRunButton) confirmRemoteFirstRun(firstRunButton.dataset.toolFirstRun).catch((error) => toast(error.message));
    if (configButton) openUnifiedExtensionConfiguration("tool", configButton.dataset.toolConfig);
    if (impactButton) openImplementationImpact("tool", impactButton.dataset.toolImpact).catch((error)=>toast(error.message));
  });
  document.getElementById("tool-capability-list")?.addEventListener("change", (event) => {
    const toggle = event.target.closest("[data-tool-enabled]");
    const priority = event.target.closest("[data-tool-priority]");
    if (toggle) updateToolPlugin(toggle.dataset.toolEnabled, { enabled: toggle.checked }, toggle)
      .catch((error) => { toggle.checked = !toggle.checked; toast(error.message); });
    if (priority) updateToolPlugin(priority.dataset.toolPriority, { priority: Number(priority.value) }, priority)
      .catch((error) => toast(error.message));
  });
  document.getElementById("information-slot-list")?.addEventListener("change", (event) => {
    const select = event.target.closest("[data-capability-route]");
    if (select) updateCapabilityRoute(select.dataset.capabilityRoute, select.value, select).catch((error) => toast(error.message));
  });
  document.getElementById("tool-execution-close")?.addEventListener("click", () => {
    document.getElementById("tool-execution-panel").hidden = true;
  });
  document.getElementById("capability-impact-close")?.addEventListener("click",()=>{document.getElementById("capability-impact-panel").hidden=true;});
  document.getElementById("capability-graph-search")?.addEventListener("input",debounce(renderCapabilityGraph));
  document.getElementById("capability-graph-status")?.addEventListener("change",renderCapabilityGraph);
  document.querySelector("[data-extension-config-close]")?.addEventListener("click", () => { document.getElementById("tool-extension-config-panel").hidden = true; });
  document.getElementById("skill-search")?.addEventListener("input", debounce(() => renderSkillList()));
  document.getElementById("skill-status-filter")?.addEventListener("change", () => renderSkillList());
  const skillStatusFilter = document.getElementById("skill-status-filter");
  if (skillStatusFilter && !skillStatusFilter.querySelector('[value="installed"]')) {
    skillStatusFilter.insertAdjacentHTML("beforeend", '<option value="installed">已安装</option>');
  }
  document.getElementById("validate-skill-package")?.addEventListener("click", () => submitSkillDirectory(false).catch((error) => toast(error.message)));
  document.getElementById("install-skill-package")?.addEventListener("click", () => submitSkillDirectory(true).catch((error) => toast(error.message)));
  document.getElementById("skill-package-zip")?.addEventListener("change", (event) => submitSkillZip(event.target.files?.[0], event.target).catch((error) => toast(error.message)));
  document.getElementById("skill-package-actions")?.addEventListener("click", (event) => {
    const defaultButton = event.target.closest("[data-skill-default-entry]");
    if (defaultButton) {
      setSkillDefault(defaultButton).catch((error) => toast(error.message));
      return;
    }
    const button = event.target.closest("[data-skill-package-action]");
    if (button) manageSkillPackage(button).catch((error) => toast(error.message));
  });
  document.getElementById("validate-tool-package")?.addEventListener("click", () => submitToolPackage(false).catch((error) => toast(error.message)));
  document.getElementById("install-tool-package")?.addEventListener("click", () => submitToolPackage(true).catch((error) => toast(error.message)));
  document.getElementById("validate-collector-plugin")?.addEventListener("click", () => submitCollectorPackage(false).catch((error) => toast(error.message)));
  document.getElementById("install-collector-plugin")?.addEventListener("click", () => submitCollectorPackage(true).catch((error) => toast(error.message)));
  document.querySelector("[data-go-extension-studio]")?.addEventListener("click", () => selectCapabilityTab("extensions"));
  document.getElementById("collector-runtime-list")?.addEventListener("click",(event)=>{const check=event.target.closest("[data-collector-check]");if(check)testCollectorTool(check.dataset.collectorCheck,check).catch((error)=>toast(error.message));const configure=event.target.closest("[data-collector-config]");if(configure)openCollectorConfiguration(configure.dataset.collectorConfig);const history=event.target.closest("[data-collector-history]");if(history)loadCollectorHistory(history.dataset.collectorHistory).catch((error)=>toast(error.message));const impact=event.target.closest("[data-collector-impact]");if(impact)openImplementationImpact("collector",impact.dataset.collectorImpact).catch((error)=>toast(error.message));});
  document.getElementById("collector-runtime-list")?.addEventListener("change",(event)=>{const enabled=event.target.closest("[data-collector-enabled]");if(enabled)updateCollectorTool(enabled.dataset.collectorEnabled,{enabled:enabled.checked}).catch((error)=>toast(error.message));const priority=event.target.closest("[data-collector-priority]");if(priority)updateCollectorTool(priority.dataset.collectorPriority,{priority:Number(priority.value)}).catch((error)=>toast(error.message));});
  document.getElementById("validate-remote-plugin")?.addEventListener("click", () => submitRemotePlugin(false).catch((error) => toast(error.message)));
  document.getElementById("install-remote-plugin")?.addEventListener("click", () => submitRemotePlugin(true).catch((error) => toast(error.message)));
  document.getElementById("save-remote-credential")?.addEventListener("click", () => saveRemoteCredential().catch((error) => toast(error.message)));
  document.getElementById("cancel-remote-credential")?.addEventListener("click", () => closeRemoteCredential());
  document.querySelector(".capability-section-tabs")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-capability-tab]");
    if (button) selectCapabilityTab(button.dataset.capabilityTab);
  });
}

async function loadSkillRegistry() {
  const [data, collectorData, graphData] = await Promise.all([
    request("/api/system/skills"),
    request("/api/collector-plugins"),
    request("/api/system/capability-graph"),
  ]);
  skillRegistryData = data;
  capabilityGraphData = graphData;
  const summary = document.getElementById("skill-registry-summary");
  const runtimeTools=[...new Map(data.tools.map((tool)=>[tool.plugin,{...tool,name:tool.name||tool.plugin,capabilities:data.tools.filter((item)=>item.plugin===tool.plugin).map((item)=>item.capability),recentExecution:data.tools.filter((item)=>item.plugin===tool.plugin).map((item)=>item.recentExecution).filter(Boolean).sort((a,b)=>Number(b.id)-Number(a.id))[0]||null}])).values()];
  const availableTools = runtimeTools.filter((tool) => tool.health?.status === "ok" && tool.health.data?.available !== false).length;
  const configuredSkills = data.skills.filter((skill) => skill.configured).length;
  const thirdPartySkills = data.skills.filter((skill) => skill.thirdParty).length;
  const connectedSlots = graphData.capabilities.filter((item)=>!item.id.startsWith('collect.')&&['ready','degraded'].includes(item.status)).length;
  const informationCapabilityCount=graphData.capabilities.filter((item)=>!item.id.startsWith('collect.')&&item.consumers.length).length;
  if (summary) {
    const unavailableTools = runtimeTools.length - availableTools;
    summary.innerHTML = `<span><b>${data.total}</b><small>创作技能</small><em>${thirdPartySkills ? `${thirdPartySkills} 项来自扩展` : "全部来自内置"}</em></span><span><b>${connectedSlots}/${informationCapabilityCount}</b><small>工具能力已连接</small><em>${connectedSlots === informationCapabilityCount ? "能力链路完整" : `${informationCapabilityCount - connectedSlots} 项待处理`}</em></span><span><b>${collectorData.items?.length || 0}</b><small>采集插件</small><em>管理来源接入能力</em></span><span class="${unavailableTools?'attention':'ready'}"><b>${availableTools}/${runtimeTools.length}</b><small>工具运行正常</small><em>${unavailableTools ? `${unavailableTools} 项需要处理` : "全部工具可用"}</em></span>`;
  }
  const toolList = document.getElementById("tool-capability-list");
  if (toolList) {
    toolList.innerHTML = runtimeTools.length ? runtimeTools.map((tool) => {
      const checked = Boolean(tool.health);
      const healthy = checked && tool.health.status === "ok" && tool.health.data?.available !== false;
      const pendingRestart = Boolean(tool.restartRequired);
      const status = pendingRestart ? "待重启" : !tool.enabled ? "已停用" : checked ? (healthy ? "可用" : "不可用") : "待检查";
      const detail = pendingRestart
        ? (tool.enabled ? "重启工作台后启用并加载此工具" : "重启工作台后完成停用或安装状态更新")
        : !tool.enabled ? "不会参与新任务的能力解析" : checked ? (healthy ? "依赖正常" : (tool.health.error?.message || "依赖不可用")) : "服务尚未返回健康检查结果";
      const recent = tool.recentExecution;
      const audit = recent ? `最近执行：${recent.status} · ${new Date(recent.finished_at || recent.started_at).toLocaleString("zh-CN")}${recent.error_code ? ` · ${recent.error_code}` : ""}` : "尚无执行记录";
      const permissionSummary = tool.thirdParty ? `来源：${tool.source?.type || "未声明"} ${tool.source?.url || ""} · 兼容 ${tool.compatibleApp || "未声明"} · 完整性 ${tool.contentHash || "未记录"} · 网络域名 ${(tool.permissions?.networkDomains || []).join("、") || "无"} · 路径 ${(tool.permissions?.pathAccess || []).join("、") || "无"} · 外部写入 ${tool.permissions?.externalWrite ? "是" : "否"}${tool.remote ? ` · 端点 ${tool.endpointHost || "未声明"} · 首次执行 ${tool.firstRunConfirmedAt ? "已确认" : "待确认"}` : ""}` : "内置受信实现";
      const disableState=implementationDisableState('tool',tool.plugin),disableBlocked=tool.enabled&&!disableState.canDisable;
      return `<article class="runtime-model-item tool-plugin-item ${tool.enabled ? "" : "disabled"}">
        <div class="tool-plugin-title"><div><b>${escapeHtml(tool.name||tool.plugin)}</b><small>${tool.thirdParty ? "第三方本地工具" : "内置工具"} · ${escapeHtml(tool.plugin)} · ${escapeHtml(tool.version)} · ${escapeHtml(tool.riskLevel)}</small></div><em class="tool-state-badge ${pendingRestart ? "pending" : healthy ? "ready" : "muted"}">${escapeHtml(status)}</em></div>
        <div class="tool-provided-capabilities"><small>提供能力</small><div>${tool.capabilities.map((capability)=>`<code>${escapeHtml(capability)}</code>`).join('')}</div></div>
        <small>${escapeHtml(detail)}</small><small>${escapeHtml(audit)}</small>
        <small>${escapeHtml(permissionSummary)}</small>
        <div class="tool-plugin-controls">
          <div class="tool-runtime-settings"><label class="tool-plugin-toggle ${disableBlocked?'disable-blocked':''}" title="${disableBlocked?`停用会阻断：${escapeHtml(disableState.blocking.map((item)=>item.id).join('、'))}`:'启用或停用工具'}"><input type="checkbox" data-tool-enabled="${escapeHtml(tool.plugin)}" ${tool.enabled ? "checked" : ""} ${disableBlocked?'disabled':''}><span>${disableBlocked?'必需能力唯一实现':'启用工具'}</span></label><label class="tool-priority-control"><span>优先级</span><input type="number" min="-100" max="100" value="${Number(tool.priority) || 0}" data-tool-priority="${escapeHtml(tool.plugin)}"></label></div>
          <div class="tool-runtime-actions"><button type="button" class="ghost-button" data-tool-test="${escapeHtml(tool.plugin)}">检查依赖</button>${tool.configuration ? `<button type="button" class="ghost-button action-config" data-tool-config="${escapeHtml(tool.plugin)}">${tool.extensionConfiguration?.configured ? "配置" : "完成配置"}</button>` : ""}<button type="button" class="text-button" data-tool-history="${escapeHtml(tool.plugin)}">执行历史</button><button type="button" class="text-button" data-tool-impact="${escapeHtml(tool.plugin)}">影响范围</button>${tool.remote ? `${!tool.firstRunConfirmedAt ? `<button type="button" class="ghost-button" data-tool-first-run="${escapeHtml(tool.plugin)}">确认首次执行</button>` : ""}<button type="button" class="text-button" data-tool-credential="${escapeHtml(tool.plugin)}">配置凭据</button><button type="button" class="text-button danger-action" data-tool-uninstall="${escapeHtml(tool.plugin)}">删除连接</button>` : tool.thirdParty ? `<button type="button" class="text-button" data-tool-versions="${escapeHtml(tool.plugin)}">版本与回滚</button><button type="button" class="text-button danger-action" data-tool-uninstall="${escapeHtml(tool.plugin)}">卸载</button>` : ""}</div>
        </div>
      </article>`;
    }).join("") : '<div class="kv-empty">没有已注册的工具能力。</div>';
  }
  renderCapabilityGraph();
  renderCollectorPlugins(collectorData.items || []);
  renderSkillList();
}

function renderCollectorPlugins(items) {
  const runtime=document.getElementById("collector-runtime-list");if(!runtime)return;
  runtime.innerHTML=items.map((plugin)=>{const disableState=implementationDisableState('collector',plugin.id),disableBlocked=plugin.enabled!==false&&!disableState.canDisable;return `<article class="runtime-model-item tool-plugin-item ${plugin.available?'':'disabled'}"><div class="tool-plugin-title"><div><b>${escapeHtml(plugin.name)}</b><small>${escapeHtml(plugin.id)} · 采集工具 · ${escapeHtml(plugin.version)} · ${escapeHtml(plugin.riskLevel)}</small></div></div><div class="tool-provided-capabilities"><small>提供能力</small><div>${(plugin.capabilities||[]).map((capability)=>`<code>${escapeHtml(capability)}</code>`).join('')}</div></div><small>关联采集源 ${plugin.sourceCount||0}</small><div class="tool-plugin-controls"><div class="tool-runtime-settings"><label class="tool-plugin-toggle ${disableBlocked?'disable-blocked':''}" title="${disableBlocked?`停用会阻断：${escapeHtml(disableState.blocking.map((item)=>item.id).join('、'))}`:'启用或停用工具'}"><input type="checkbox" data-collector-enabled="${escapeHtml(plugin.id)}" ${plugin.enabled!==false?'checked':''} ${disableBlocked?'disabled':''}><span>${disableBlocked?'必需能力唯一实现':'启用工具'}</span></label><label class="tool-priority-control"><span>优先级</span><input type="number" min="-100" max="100" value="${Number(plugin.priority)||0}" data-collector-priority="${escapeHtml(plugin.id)}"></label></div><div class="tool-runtime-actions"><button type="button" class="ghost-button" data-collector-check="${escapeHtml(plugin.id)}">检查依赖</button>${plugin.configuration?`<button type="button" class="ghost-button action-config" data-collector-config="${escapeHtml(plugin.id)}">配置</button>`:''}<button type="button" class="text-button" data-collector-history="${escapeHtml(plugin.id)}">执行历史</button><button type="button" class="text-button" data-collector-impact="${escapeHtml(plugin.id)}">影响范围</button></div></div></article>`;}).join('');
}

const CAPABILITY_STATUS={ready:'就绪',degraded:'降级',blocked:'阻断',unused:'未使用'};
function capabilityRouteControl(item){const selected=item.implementations.find((implementation)=>implementation.id===item.preferredImplementationId);return `<div class="capability-route-control ${selected?'manual':'automatic'}"><div class="capability-route-label"><span>路由策略</span><em>${selected?'指定首选':'自动兜底'}</em></div><div class="capability-route-select"><select aria-label="${escapeHtml(item.id)} 的首选工具" data-capability-route="${escapeHtml(item.id)}"><option value="">按优先级自动选择</option>${item.implementations.map((implementation)=>`<option value="${escapeHtml(implementation.id)}" ${item.preferredImplementationId===implementation.id?'selected':''}>${escapeHtml(implementation.name)} · ${escapeHtml(implementation.id)}</option>`).join('')}</select><span aria-hidden="true">⌄</span></div><small>${selected?`优先调用 ${escapeHtml(selected.name)}，失败后继续尝试候选链`:'根据可用状态和优先级依次尝试候选工具'}</small></div>`;}
function renderCapabilityGraph(){
  const node=document.getElementById('information-slot-list');if(!node||!capabilityGraphData)return;
  const query=(document.getElementById('capability-graph-search')?.value||'').trim().toLowerCase(),status=document.getElementById('capability-graph-status')?.value||'all';
  const items=capabilityGraphData.capabilities.filter((item)=>(status==='all'||item.status===status)&&(!query||`${item.id} ${item.name||''} ${item.description||''} ${item.category||''} ${item.consumers.map((x)=>`${x.consumerName} ${x.consumerId}`).join(' ')} ${item.implementations.map((x)=>`${x.name} ${x.id}`).join(' ')}`.toLowerCase().includes(query)));
  const summary=document.getElementById('information-slot-summary');if(summary)summary.innerHTML=`<b>${capabilityGraphData.summary.ready}</b><span>就绪 · ${capabilityGraphData.summary.degraded} 降级 · ${capabilityGraphData.summary.blocked} 阻断</span>`;
  node.innerHTML=items.map((item)=>`<article class="capability-chain-card status-${item.status}"><header><div><span>${escapeHtml(item.category||'扩展能力')} · ${item.id.startsWith('collect.')?'采集能力':'工具能力'}</span><b>${escapeHtml(item.name||item.id)}</b><small>${escapeHtml(item.id)}</small><p>${escapeHtml(item.description||'暂无能力说明')}</p></div><em>${CAPABILITY_STATUS[item.status]||item.status}</em></header><section><small>消费者 · ${item.consumers.length}</small><div class="capability-consumer-list">${item.consumers.length?item.consumers.map((consumer)=>`<span class="${consumer.requirement}"><b>${escapeHtml(consumer.consumerName)}</b><i>${escapeHtml(consumer.consumerType)} · ${escapeHtml(consumer.requirement)}</i></span>`).join(''):'<span class="empty">当前没有消费者</span>'}</div></section><section>${capabilityRouteControl(item)}<small>候选工具链 · ${item.implementations.length}</small><ol class="capability-fallback-chain">${item.implementations.length?item.implementations.map((implementation,index)=>`<li class="${implementation.available?'available':'missing'}"><b>${index+1}</b><span>${escapeHtml(implementation.name)}<small>${escapeHtml(implementation.type)} · ${escapeHtml(implementation.id)} · 优先级 ${implementation.priority}</small></span><em>${implementation.available?'可用':implementation.enabled?'配置未就绪':'已停用'}</em></li>`).join(''):'<li class="missing"><span>没有实现该能力的工具</span></li>'}</ol></section></article>`).join('')||'<div class="kv-empty">没有匹配的能力。</div>';
}

async function updateCapabilityRoute(capability,preferredImplementationId,control){
  control.disabled=true;
  try{await request(`/api/system/capability-routes/${encodeURIComponent(capability)}`,{method:'PUT',body:JSON.stringify({preferredImplementationId})});toast(preferredImplementationId?'首选工具已更新':'已恢复自动选择');await loadSkillRegistry();document.querySelector(`#information-slot-list [data-capability-route="${CSS.escape(capability)}"]`)?.focus();}
  finally{control.disabled=false;}
}

async function openImplementationImpact(type,id){
  const result=await request(`/api/system/${type==='collector'?'collectors':'tools'}/${encodeURIComponent(id)}/status-impact`),panel=placeRuntimeDetail('capability-impact-panel',type==='collector'?'collector-runtime-list':'tool-capability-list'),content=document.getElementById('capability-impact-content');
  const unavailable=result.capabilities.filter((item)=>!item.wouldBlock&&item.remainingImplementations.length===0),verdict=!result.canDisable?'停用会造成必需能力断链':unavailable.length?'可停用，但部分能力将不可用':'存在可控迁移路径';
  document.getElementById('capability-impact-title').textContent=`${id} · 影响范围`;
  content.innerHTML=`<div class="impact-verdict ${result.canDisable?'safe':'blocked'}"><b>${verdict}</b><span>${result.capabilities.length} 项能力受影响 · ${result.blocking.length} 项阻断 · ${result.degraded.length} 项降级 · ${unavailable.length} 项将不可用</span></div><div class="impact-capability-list">${result.capabilities.map((item)=>`<article><header><b>${escapeHtml(item.name||item.capability)}</b><em class="${item.wouldBlock?'blocked':item.wouldDegrade||!item.remainingImplementations.length?'degraded':'safe'}">${item.wouldBlock?'将阻断':!item.remainingImplementations.length?'将不可用':item.wouldDegrade?'将降级':'可安全切换'}</em></header><small>剩余实现：${item.remainingImplementations.length?item.remainingImplementations.map((entry)=>escapeHtml(entry.name)).join('、'):'无'}</small><div>${item.consumers.map((consumer)=>`<span>${escapeHtml(consumer.consumerName)} · ${escapeHtml(consumer.requirement)}</span>`).join('')}</div></article>`).join('')}</div>`;
  panel.hidden=false;panel.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function openCollectorConfiguration(id){openUnifiedExtensionConfiguration("collector",id);}
function openUnifiedExtensionConfiguration(type,id){const key=`${type}:${id}`,route=`system/configuration/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;try{sessionStorage.setItem("system-extension-selection",key);}catch{}window.go?.(route);}

function placeRuntimeDetail(panelId,afterElementId){
  const panel=document.getElementById(panelId),anchor=document.getElementById(afterElementId);
  if(panel&&anchor&&panel.previousElementSibling!==anchor)anchor.insertAdjacentElement("afterend",panel);
  return panel;
}
function placeExecutionHistory(afterElementId){return placeRuntimeDetail("tool-execution-panel",afterElementId);}

async function submitCollectorPackage(install){const directory=document.getElementById("collector-plugin-directory").value.trim();if(!directory)throw new Error("请输入插件目录");const result=await request(`/api/system/collector-plugin-packages/${install?"install":"validate"}`,{method:"POST",headers:install?{"x-admin-confirm":"TRUSTED-LOCAL-PLUGIN"}:{},body:JSON.stringify({directory})});toast(install?`已安装 ${result.name||result.id}，默认保持停用`:`校验通过：${result.manifest?.name||result.manifest?.id}`);await loadSkillRegistry();}
async function updateCollectorStatus(id,status){const impactVersion=status==='disabled'?await confirmDisableImpact('collector',id):null;if(status==='disabled'&&!impactVersion)return;await request(`/api/system/collector-plugins/${encodeURIComponent(id)}/status`,{method:"PATCH",headers:{"x-admin-confirm":"TRUSTED-LOCAL-PLUGIN"},body:JSON.stringify({status,impactVersion})});await loadSkillRegistry();}
async function confirmDisableImpact(type,id){const impact=await request(`/api/system/${type==='collector'?'collectors':'tools'}/${encodeURIComponent(id)}/status-impact`);if(!impact.canDisable){await openImplementationImpact(type,id);throw new Error('停用会造成必需能力断链，操作已阻止');}const lines=impact.capabilities.map((item)=>`${item.capability}：${!item.remainingImplementations.length?'将不可用':item.wouldDegrade?'将降级':'可切换'}${item.remainingImplementations.length?` → ${item.remainingImplementations.map((entry)=>entry.name).join('、')}`:''}`);const confirmed=await confirmAction(`此操作仅禁止新任务使用该工具，历史记录继续保留。\n${lines.join('\n')}\n是否继续？`,{confirmText:'确认停用'});return confirmed?impact.impactVersion:null;}
async function updateCollectorTool(id,input){if(input.enabled===false){const impactVersion=await confirmDisableImpact('collector',id);if(!impactVersion)return;input={...input,impactVersion};}await request(`/api/system/collector-tools/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify(input)});await loadSkillRegistry();}
async function testCollectorTool(id,button){const original=button.textContent;button.disabled=true;button.textContent="检查中…";try{const result=await request(`/api/system/collector-plugins/${encodeURIComponent(id)}/configuration/test`,{method:"POST",body:"{}"});toast(result.pass?"采集工具依赖正常":"采集工具依赖不可用");}finally{button.disabled=false;button.textContent=original;}}
async function loadCollectorHistory(id){const result=await request("/api/system/collector-plugin-events?limit=100");const panel=placeExecutionHistory("collector-runtime-list"),list=document.getElementById("tool-execution-list");document.getElementById("tool-execution-title").textContent=`${id} · 采集执行历史`;const items=(result.items||[]).filter((item)=>item.pluginId===id);list.innerHTML=items.length?items.map((item)=>`<article class="runtime-model-item"><b>${escapeHtml(item.action||'执行')} · ${escapeHtml(item.result||'记录')}</b><small>${escapeHtml(item.createdAt||'')}</small></article>`).join(''):'<div class="kv-empty">尚无执行记录。</div>';panel.hidden=false;panel.scrollIntoView({behavior:"smooth",block:"nearest"});}
async function confirmCollectorFirstRun(id){await request(`/api/system/collector-plugins/${encodeURIComponent(id)}/first-run-confirm`,{method:"POST",body:"{}"});await loadSkillRegistry();}
async function uninstallCollector(id,sourceCount){const impactVersion=await confirmDisableImpact('collector',id);if(!impactVersion)return;if(!await confirmAction(`卸载后 ${sourceCount} 个关联来源和历史记录会保留，但新任务不再使用该实现。确定继续吗？`,{confirmText:"卸载"}))return;await request(`/api/system/collector-plugins/${encodeURIComponent(id)}`,{method:"DELETE",headers:{"x-admin-confirm":"TRUSTED-LOCAL-PLUGIN"},body:JSON.stringify({impactVersion})});await loadSkillRegistry();}

function selectCapabilityTab(tab) {
  const selected = ["skills", "tools", "collectors", "extensions"].includes(tab) ? tab : "skills";
  document.querySelectorAll("[data-capability-tab]").forEach((button) => {
    const active = button.dataset.capabilityTab === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-capability-section]").forEach((section) => {
    section.hidden = section.dataset.capabilitySection !== selected;
  });
  try { sessionStorage.setItem("capability-section", selected); } catch {}
}

async function submitSkillDirectory(install) {
  const directory = document.getElementById("skill-package-directory").value.trim();
  if (!directory) throw new Error("请输入技能包目录");
  if (install && !await confirmAction("仅管理员可以安装技能包。确认该技能包已完成代码审查？", { confirmText: "受信安装" })) return;
  const result = await request(`/api/system/skill-packages/${install ? "install" : "validate"}`, {
    method: "POST", headers: install ? { "x-admin-confirm": "TRUSTED-LOCAL-PLUGIN" } : {},
    body: JSON.stringify({ directory }),
  });
  toast(install ? `已安装 ${result.name || result.id}` : `校验通过：${result.manifest?.name || result.manifest?.id}`);
  if (install) await loadSkillRegistry();
}

async function submitToolPackage(install) {
  const directory = document.getElementById("tool-package-directory").value.trim();
  if (!directory) throw new Error("请输入工具包目录");
  if (install && !await confirmAction("仅管理员可以安装本地 adapter。确认该工具已完成代码审查，并接受页面展示的权限范围？", { confirmText: "受信安装" })) return;
  const result = await request(`/api/system/tool-plugin-packages/${install ? "install" : "validate"}`, {
    method: "POST", headers: install ? { "x-admin-confirm": "TRUSTED-LOCAL-PLUGIN" } : {},
    body: JSON.stringify({ directory }),
  });
  const manifest = result.manifest || result;
  const permissions = manifest.permissions || {};
  toast(install ? `已安装 ${manifest.name || manifest.id}，重启后可加载`
    : `校验通过：${manifest.name}；网络域名 ${(permissions.networkDomains || []).length}，路径权限 ${(permissions.pathAccess || []).length}，外部写入 ${permissions.externalWrite ? "是" : "否"}`);
  if (install) await loadSkillRegistry();
}

function remoteManifestInput() {
  const text = document.getElementById("remote-plugin-manifest").value.trim();
  if (!text) throw new Error("请输入远程工具连接声明");
  try { return JSON.parse(text); } catch { throw new Error("远程工具连接声明不是有效 JSON"); }
}

async function submitRemotePlugin(install) {
  const manifest = remoteManifestInput();
  const result = await request(`/api/system/remote-tool-plugins${install ? "" : "/validate"}`, { method: "POST", body: JSON.stringify({ manifest }) });
  toast(install ? `已保存 ${result.name || result.id}，请配置凭据并启用` : `校验通过：${result.name} · ${new URL(result.endpoint).hostname}`);
  if (install) await loadSkillRegistry();
}

function openRemoteCredential(pluginId) {
  credentialPluginId = pluginId;
  document.getElementById("remote-credential-panel").hidden = false;
  const input = document.getElementById("remote-credential-token");
  input.value = "";
  input.focus();
}

function closeRemoteCredential() {
  credentialPluginId = "";
  document.getElementById("remote-credential-token").value = "";
  document.getElementById("remote-credential-panel").hidden = true;
}

async function saveRemoteCredential() {
  const token = document.getElementById("remote-credential-token").value;
  if (!credentialPluginId || !token.trim()) throw new Error("请输入凭据");
  await request(`/api/system/remote-tool-plugins/${encodeURIComponent(credentialPluginId)}/credentials`, { method: "PUT", body: JSON.stringify({ token }) });
  closeRemoteCredential();
  toast("凭据已安全保存，页面不会回读原文");
  await loadSkillRegistry();
}

async function submitSkillZip(file, input) {
  if (!file) return;
  if (!await confirmAction("仅管理员可以安装技能包。确认该技能包已完成代码审查？", { confirmText: "受信安装" })) { input.value = ""; return; }
  // 二进制 zip 直接作为 body 上传，request() 支持自定义 content-type，无需绕开
  const result = await request("/api/system/skill-packages/install", { method: "POST", headers: { "content-type": "application/zip", "x-admin-confirm": "TRUSTED-LOCAL-PLUGIN" }, body: file });
  toast(`已安装 ${result.name || result.id}`);
  input.value = "";
  await loadSkillRegistry();
}

async function manageSkillPackage(button) {
  const id = button.dataset.skillId;
  const action = button.dataset.skillPackageAction;
  if (action === "uninstall") {
    if (!await confirmAction(`卸载 ${id}？历史版本和审计记录会保留。`, { confirmText: "卸载" })) return;
    await request(`/api/system/skills/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-admin-confirm": "TRUSTED-LOCAL-PLUGIN" } });
  } else {
    await request(`/api/system/skills/${encodeURIComponent(id)}/status`, { method: "PATCH", headers: { "x-admin-confirm": "TRUSTED-LOCAL-PLUGIN" }, body: JSON.stringify({ status: action }) });
  }
  toast(action === "enabled" ? "技能已启用" : action === "disabled" ? "技能已停用" : "技能已卸载");
  selectedSkillId = "";
  await loadSkillRegistry();
}

async function setSkillDefault(button) {
  const id = button.dataset.skillId;
  const entryPoint = button.dataset.skillDefaultEntry;
  const slot = button.dataset.skillDefaultSlot;
  const isDefault = button.dataset.skillDefaultActive === "true";
  const endpoint = slot === "writer"
    ? `/api/system/skill-entry-defaults/${encodeURIComponent(entryPoint)}`
    : `/api/system/skill-stage-defaults/${encodeURIComponent(entryPoint)}/${encodeURIComponent(slot)}`;
  button.disabled = true;
  try {
    await request(endpoint, { method: "PUT", body: JSON.stringify({ skillId: isDefault ? "" : id }) });
    toast(isDefault ? "已恢复系统默认技能" : "已设为该入口的默认技能");
    await loadSkillRegistry();
    await openSkillConfig(id);
  } finally {
    button.disabled = false;
  }
}

async function manageToolPluginVersions(pluginId) {
  const result = await request(`/api/system/tool-plugins/${encodeURIComponent(pluginId)}/versions`);
  if (!result.items.length) {
    toast("暂无可回滚的历史版本");
    return;
  }
  const version = result.items[0];
  if (!await confirmAction(`将 ${pluginId} 回滚到 ${version}？回滚后保持停用，并需重启加载。`, { confirmText: "回滚" })) return;
  await request(`/api/system/tool-plugins/${encodeURIComponent(pluginId)}/rollback`, { method: "POST", headers: { "x-admin-confirm": "TRUSTED-LOCAL-PLUGIN" }, body: JSON.stringify({ version }) });
  toast(`已回滚到 ${version}，请重启工作台`);
  await loadSkillRegistry();
}

async function uninstallManagedToolPlugin(pluginId) {
  const remote = skillRegistryData?.tools.some((tool) => tool.plugin === pluginId && tool.remote);
  const impactVersion=await confirmDisableImpact('tool',pluginId);if(!impactVersion)return;
  const confirmed = remote
    ? await confirmAction(`删除连接 ${pluginId}？依赖其能力的技能将无法启动，历史归档和审计记录会保留。`, { confirmText: "删除连接" })
    : await confirmAction(`卸载 ${pluginId}？依赖其能力的技能将无法启动，历史归档和审计记录会保留。`, { confirmText: "确认卸载" });
  if (!confirmed) return;
  await request(remote ? `/api/system/remote-tool-plugins/${encodeURIComponent(pluginId)}` : `/api/system/tool-plugins/${encodeURIComponent(pluginId)}`, {
    method: "DELETE", headers: remote ? {} : { "x-admin-confirm": "TRUSTED-LOCAL-PLUGIN" },
    body: JSON.stringify({ impactVersion }),
  });
  toast(remote ? "远程连接已删除" : "工具已卸载，重启工作台后完成卸载");
  await loadSkillRegistry();
}

// 首次执行确认（开源清单 3.3）：展示域名与权限摘要，用户确认后该远程插件才允许真实调用。
async function confirmRemoteFirstRun(pluginId) {
  const tool = skillRegistryData?.tools.find((item) => item.plugin === pluginId && item.remote);
  const summary = tool
    ? `域名：${tool.endpointHost || "未声明"}\n风险等级：${tool.riskLevel}\n外部写入：${tool.permissions?.externalWrite ? "是（会向第三方发送内容）" : "否"}\n凭据：${(tool.permissions?.credentials || []).join("、") || "无"}\n超时：按插件声明（1–30 秒），响应上限 1–2 MB`
    : "";
  if (!await confirmAction(`确认允许远程插件「${pluginId}」首次执行？\n${summary}\n确认后，AI 任务调用该插件时会向上述域名发送请求。`, { confirmText: "确认允许" })) return;
  await request(`/api/system/remote-tool-plugins/${encodeURIComponent(pluginId)}/first-run-confirm`, { method: "POST", body: "{}" });
  toast("首次执行已确认，该插件现在可以被任务调用");
  await loadSkillRegistry();
}

async function updateToolPlugin(pluginId, changes, control) {
  const refocusAttr = control?.dataset.toolEnabled !== undefined ? "data-tool-enabled" : control?.dataset.toolPriority !== undefined ? "data-tool-priority" : null;
  const pluginView = skillRegistryData?.tools.find((tool) => tool.plugin === pluginId);
  if(changes.enabled===false){const impactVersion=await confirmDisableImpact('tool',pluginId);if(!impactVersion){if(control?.matches('[type=checkbox]'))control.checked=true;return;}changes.impactVersion=impactVersion;}
  if (pluginView?.thirdParty) {
    if (control) control.disabled = true;
    try {
      const endpoint = pluginView.remote ? `/api/system/remote-tool-plugins/${encodeURIComponent(pluginId)}/status` : `/api/system/tool-plugins/${encodeURIComponent(pluginId)}/status`;
      await request(endpoint, { method: "PATCH", headers: pluginView.remote ? {} : { "x-admin-confirm": "TRUSTED-LOCAL-PLUGIN" }, body: JSON.stringify({ status: changes.enabled === false ? "disabled" : "enabled",impactVersion:changes.impactVersion }) });
      toast(pluginView.remote ? "远程连接状态已即时生效" : "工具状态已保存，重启工作台后生效");
      await loadSkillRegistry();
      restoreToolControlFocus(pluginId, refocusAttr);
    } finally {
      if (control) control.disabled = false;
    }
    return;
  }
  if (control) control.disabled = true;
  try {
    await request(`/api/system/tool-plugins/${encodeURIComponent(pluginId)}`, { method: "PATCH", body: JSON.stringify(changes) });
    toast(changes.enabled === false ? "工具已停用" : changes.enabled === true ? "工具已启用" : "工具优先级已更新");
    await loadSkillRegistry();
    restoreToolControlFocus(pluginId, refocusAttr);
  } finally {
    if (control) control.disabled = false;
  }
}

async function testToolPlugin(pluginId, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "检查中…";
  try {
    const remote = skillRegistryData?.tools.some((tool) => tool.plugin === pluginId && tool.remote);
    const result = await request(remote ? `/api/system/remote-tool-plugins/${encodeURIComponent(pluginId)}/test` : `/api/system/tool-plugins/${encodeURIComponent(pluginId)}/test`, { method: "POST", body: "{}" });
    toast(result.pass ? `${pluginId} 依赖检查通过` : `${pluginId} 当前不可用`);
    await loadSkillRegistry();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function dynamicField(name, rule, value, required) {
  const id=`extension-field-${name}`;const title=rule.title || name;const marker=required ? " *" : "";
  let control;
  if (Array.isArray(rule.enum)) control=`<select id="${id}" name="${escapeHtml(name)}">${rule.enum.map((item,index)=>`<option value="${escapeHtml(String(item))}" ${String(value ?? rule.default ?? "")===String(item)?"selected":""}>${escapeHtml(rule.enumNames?.[index] || String(item))}</option>`).join("")}</select>`;
  else if (rule.type === "boolean") control=`<input id="${id}" name="${escapeHtml(name)}" type="checkbox" ${value===true?"checked":""}>`;
  else if (rule.format === "textarea") control=`<textarea id="${id}" name="${escapeHtml(name)}" rows="4">${escapeHtml(String(value ?? ""))}</textarea>`;
  else {
    const type=rule.secret || rule.format === "password" ? "password" : rule.type === "number" || rule.type === "integer" ? "number" : rule.format === "url" ? "url" : "text";
    const configured=value === "__configured__";control=`<input id="${id}" name="${escapeHtml(name)}" type="${type}" value="${configured?"":escapeHtml(String(value ?? ""))}" ${configured?'placeholder="已配置；留空保持不变"':""} ${rule.minimum!==undefined?`min="${rule.minimum}"`:""} ${rule.maximum!==undefined?`max="${rule.maximum}"`:""}>`;
  }
  return `<label class="extension-dynamic-field ${rule.format === "textarea" ? "wide" : ""}"><span>${escapeHtml(title)}${marker}</span>${control}${rule.description?`<small>${escapeHtml(rule.description)}</small>`:""}</label>`;
}

function readDynamicForm(form, schema) {
  return Object.fromEntries(Object.entries(schema.properties || {}).map(([name,rule])=>{
    const node=form.elements.namedItem(name);let value;
    if(rule.type === "boolean")value=node.checked;
    else if(rule.type === "integer")value=node.value===""?undefined:Number.parseInt(node.value,10);
    else if(rule.type === "number")value=node.value===""?undefined:Number(node.value);
    else if(rule.type === "array")value=String(node.value||"").split(/[,\n]/).map((item)=>item.trim()).filter(Boolean);
    else value=node.value;
    return [name,value];
  }));
}

function renderExtensionConfigForm(form, type, id, state) {
  if(!state.schema){form.innerHTML='<div class="kv-empty">该扩展没有动态配置。</div>';return;}
  form.innerHTML=`${Object.entries(state.schema.properties || {}).map(([name,rule])=>dynamicField(name,rule,state.values?.[name],(state.schema.required||[]).includes(name))).join("")}
    <div class="extension-dynamic-actions"><button type="submit" class="outline-button">保存配置</button><button type="button" class="ghost-button" data-extension-config-test>测试配置</button><span class="extension-config-status">${state.configured?"配置已就绪":"需要完成配置"}</span></div>`;
  form.onsubmit=async(event)=>{event.preventDefault();const result=await request(`/api/system/${type === "skill" ? "skills" : "tool-plugins"}/${encodeURIComponent(id)}/configuration`,{method:"PUT",body:JSON.stringify(readDynamicForm(form,state.schema))});toast("扩展配置已保存");renderExtensionConfigForm(form,type,id,result);await loadSkillRegistry();};
  form.querySelector("[data-extension-config-test]").onclick=async()=>{const result=await request(`/api/system/${type === "skill" ? "skills" : "tool-plugins"}/${encodeURIComponent(id)}/configuration/test`,{method:"POST",body:"{}"});toast(result.pass?"配置测试通过":"配置测试未通过");};
}

async function openExtensionConfig(type,id,state=null) {
  const result=state || await request(`/api/system/${type === "skill" ? "skills" : "tool-plugins"}/${encodeURIComponent(id)}/configuration`);
  const panel=document.getElementById(type === "skill" ? "skill-extension-config-panel" : "tool-extension-config-panel");
  const form=document.getElementById(type === "skill" ? "skill-extension-config-form" : "tool-extension-config-form");
  if(type === "tool")document.getElementById("tool-extension-config-title").textContent=`${id} · 扩展配置`;
  panel.hidden=!result.schema;if(result.schema){renderExtensionConfigForm(form,type,id,result);panel.scrollIntoView({behavior:"smooth",block:"nearest"});}
}

async function loadToolHistory(plugin) {
  const result = await request(`/api/system/tool-executions?plugin=${encodeURIComponent(plugin)}&limit=50`);
  const panel = placeRuntimeDetail("tool-execution-panel","tool-capability-list");
  const list = document.getElementById("tool-execution-list");
  document.getElementById("tool-execution-title").textContent = `${plugin} · 工具执行历史`;
  list.innerHTML = result.items.length ? result.items.map((item) => `<article class="runtime-model-item">
    <b>${escapeHtml(item.status)}${item.error_code ? ` · ${escapeHtml(item.error_code)}` : ""}${item.attempt>1?` · 第 ${item.attempt} 次尝试`:""}</b>
    <small>${new Date(item.finished_at || item.started_at).toLocaleString("zh-CN")} · ${item.duration_ms} ms</small>
    <small>${escapeHtml(item.plugin || "未解析实现")} @ ${escapeHtml(item.plugin_version || "—")} · 技能 ${escapeHtml(item.skill_id || "未关联")}${item.fallback_from?` · 从 ${escapeHtml(item.fallback_from)} 兜底`:""}</small>
    <small>参数：${escapeHtml((item.input_keys || []).join("、") || "无")}</small>
  </article>`).join("") : '<div class="kv-empty">尚无执行记录。</div>';
  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

const SKILL_KIND_GROUPS = [
  { id: "writer", label: "主写作", hint: "文章正文生成" },
  { id: "storyboard", label: "故事板", hint: "图文逐页结构规划" },
  { id: "title", label: "标题", hint: "标题生成与筛选" },
  { id: "reviewer", label: "审阅", hint: "事实、逻辑与质量门禁" },
  { id: "humanizer", label: "自然化", hint: "表达与语气优化" },
  { id: "seo", label: "SEO", hint: "搜索可发现性优化" },
  { id: "image-planner", label: "配图规划", hint: "文章图片与占位规划" },
  { id: "typesetter", label: "排版", hint: "公众号成稿排版" },
  { id: "stage", label: "阶段技能", hint: "创作流程中的独立处理阶段" },
  { id: "legacy", label: "其他", hint: "旧版或未声明类型" },
];

function skillKindGroup(skill) {
  return SKILL_KIND_GROUPS.some((group) => group.id === skill.kind) ? skill.kind : "legacy";
}

function skillListItem(skill) {
  const state=skill.manifestStatus === "invalid" ? "invalid" : skill.thirdParty ? "installed" : "builtin";
  const label=state === "invalid" ? "清单无效" : state === "installed" ? "已安装" : "内置";
  return `<button type="button" class="skill-list-item ${skill.id === selectedSkillId ? "active" : ""}" data-skill-edit="${escapeHtml(skill.id)}" aria-pressed="${skill.id === selectedSkillId}">
    <span class="skill-list-item-top"><span class="skill-list-symbol">${escapeHtml(String(skill.kind||"SK").slice(0,2).toUpperCase())}</span><span><b>${escapeHtml(skill.name || skill.id)}</b><small>${escapeHtml(skill.description || "创作流程能力")}</small></span><em class="${state}">${label}</em></span>
    <span class="skill-list-meta"><code>${escapeHtml(skill.id)}</code><i>v${escapeHtml(skill.packageVersion || "legacy")}</i><i>${skill.fileCount} 文件</i></span>
  </button>`;
}

function renderSkillList() {
  const list = document.getElementById("skill-registry-list");
  if (!list || !skillRegistryData) return;
  const query = String(document.getElementById("skill-search")?.value || "").trim().toLowerCase();
  const status = document.getElementById("skill-status-filter")?.value || "all";
  const skills = skillRegistryData.skills.filter((skill) => {
    const matchesStatus = status === "all" || (status === "configured" && skill.configured) || (status === "builtin" && !skill.thirdParty) || (status === "installed" && skill.thirdParty);
    const haystack = `${skill.name || ""} ${skill.id} ${skill.description || ""}`.toLowerCase();
    return matchesStatus && (!query || haystack.includes(query));
  });
  const count = document.getElementById("skill-filter-count");
  if (count) count.textContent = `${skills.length} / ${skillRegistryData.total}`;
  const grouped = new Map(SKILL_KIND_GROUPS.map((group) => [group.id, []]));
  for (const skill of skills) grouped.get(skillKindGroup(skill)).push(skill);
  list.innerHTML = skills.length ? SKILL_KIND_GROUPS.map((group) => {
    const items = grouped.get(group.id);
    if (!items.length) return "";
    return `<section class="skill-purpose-group" data-skill-kind="${group.id}">
      <header><span><b>${group.label}</b><small>${group.hint}</small></span><em>${items.length}</em></header>
      <div>${items.map(skillListItem).join("")}</div>
    </section>`;
  }).join("") : '<div class="skill-list-empty">没有匹配的技能。试试更短的关键词或切换状态筛选。</div>';
}

async function openSkillConfig(id) {
  const data = await request(`/api/system/skills/${encodeURIComponent(id)}`);
  const ownsRuntimePolicy = data.runtimePolicyOwner !== false;
  selectedSkillId = id;
  renderSkillList();
  document.getElementById("skill-detail-empty").hidden = true;
  document.getElementById("skill-config-editor").hidden = false;
  document.getElementById("skill-config-title").textContent = data.name || id;
  document.getElementById("skill-config-meta").textContent = `${id} · v${data.version} · ${data.fileCount} 个规则文件${data.configured ? " · 存在历史覆盖配置" : ""}`;
  const packageActions = document.getElementById("skill-package-actions");
  packageActions.hidden = !data.thirdParty;
  const entryLabels = { "hotspot-article": "热点文章", "independent-writing": "自主写作", "batch-daily": "批次早报", "social-tool": "工具图文", "social-custom": "自定义图文", "social-event": "事件图文", "wechat-typeset": "公众号排版" };
  const slotLabels = { writer: "主写作", storyboard: "故事板规划", title: "标题生成", reviewer: "审稿与门禁", humanizer: "表达自然化", seo: "SEO 优化" };
  const defaultActions = (data.defaultScopes || []).map((scope) => `<button class="${scope.isDefault ? "primary-button" : "outline-button"}" data-skill-default-entry="${escapeHtml(scope.entryPoint)}" data-skill-default-slot="${escapeHtml(scope.slot)}" data-skill-default-active="${scope.isDefault}" data-skill-id="${escapeHtml(id)}" ${data.status === "enabled" ? "" : "disabled"}>${scope.isDefault ? "✓ 已设默认" : "设为默认"} · ${escapeHtml(entryLabels[scope.entryPoint] || scope.entryPoint)} / ${escapeHtml(slotLabels[scope.slot] || scope.slot)}</button>`).join("");
  packageActions.innerHTML = data.thirdParty ? `<div class="skill-default-actions">${defaultActions || "<small>该技能没有可设置的创作入口。</small>"}</div><div class="skill-package-control"><button class="outline-button" data-skill-package-action="${data.status === "enabled" ? "disabled" : "enabled"}" data-skill-id="${escapeHtml(id)}">${data.status === "enabled" ? "停用" : "启用"}</button><button class="text-button" data-skill-package-action="uninstall" data-skill-id="${escapeHtml(id)}">卸载</button></div><small>默认技能按创作入口和阶段生效；单次手动选择仍具有更高优先级。</small>` : "";
  const policyNote = document.getElementById("skill-runtime-policy-note");
  policyNote.textContent = ownsRuntimePolicy ? "主技能：这里展示仓库内置契约；运行策略由程序和已发布历史配置共同决定。" : "子技能：这里展示阶段契约；模型、工具权限和质量门禁由调用它的主技能统一控制。";
  policyNote.classList.toggle("prompt-only", !ownsRuntimePolicy);
  document.getElementById("skill-source-path").textContent = data.sourcePath || "—";
  document.getElementById("skill-prompt-hash").textContent = data.promptHash || "—";
  const kindLabels = { writer: "主写作", storyboard: "故事板规划", reviewer: "审稿", title: "标题", humanizer: "表达优化", seo: "SEO", "image-planner": "配图规划", typesetter: "排版主技能", stage: "阶段子技能" };
  const capabilityState = (capability) => {
    const tool = skillRegistryData.tools.find((item) => item.capability === capability && item.enabled);
    return tool && tool.health?.status === "ok" && tool.health.data?.available !== false ? "可用" : "不可用";
  };
  const capabilityList = (items, type) => items.length ? items.map((capability) => `<span class="skill-capability-chip ${capabilityState(capability) === "可用" ? "ok" : "bad"}">${escapeHtml(capability)} · ${capabilityState(capability)} · ${type}</span>`).join("") : '<span class="muted">无</span>';
  document.getElementById("skill-contract-grid").innerHTML = `
    <article><b>角色</b><span>${escapeHtml(kindLabels[data.kind] || data.kind || "旧版")}</span></article>
    <article><b>技能包版本</b><span>${escapeHtml(data.packageVersion || "legacy")} · ${escapeHtml(data.manifestStatus || "missing")}</span></article>
    <article><b>适用入口</b><span>${(data.entryPoints || []).map((item) => escapeHtml(entryLabels[item] || item)).join("、") || "未声明"}</span></article>
    <article><b>内容类型</b><span>${(data.contentTypes || []).map((item) => escapeHtml(item)).join("、") || "未声明"}</span></article>
    <article><b>输入契约</b><code>${escapeHtml(data.inputContract || "未声明")}</code></article>
    <article><b>输出契约</b><code>${escapeHtml(data.outputContract || "未声明")}</code></article>
    <article class="wide"><b>必需工具</b><div>${capabilityList(data.requiredCapabilities || [], "必需")}</div></article>
    <article class="wide"><b>可选工具</b><div>${capabilityList(data.optionalCapabilities || [], "可选")}</div></article>
    <article><b>工作台兼容</b><code>${escapeHtml(data.compatibleApp || "未声明")}</code></article>
    <article><b>清单文件</b><code>${escapeHtml(data.manifestPath || "未提供")}</code></article>`;
  document.getElementById("skill-markdown-view").textContent = data.skillMarkdown || "未读取到 SKILL.md";
  document.getElementById("skill-file-list").innerHTML = (data.files || []).map((file, index) => `<article class="runtime-model-item">
    <b>${index === 0 ? "主契约" : "关联规则"}</b><code>${escapeHtml(file)}</code>
  </article>`).join("") || '<div class="kv-empty">没有关联规则文件。</div>';
  await openExtensionConfig("skill",id,data.extensionConfiguration);
}

export default async function loadSkillsView() {
  bindSkills();
  let capabilitySection = "skills";
  try { capabilitySection = sessionStorage.getItem("capability-section") || "skills"; } catch {}
  selectCapabilityTab(capabilitySection);
  await loadSkillRegistry();
}
