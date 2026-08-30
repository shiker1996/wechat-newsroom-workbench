import { request } from '../core/http.js';
import { escapeHtml, toast, confirmAction } from '../core/ui.js';
import { hydrateThemePickers, invalidateThemeCatalog, loadThemeCatalog } from '../core/theme-catalog.js';
import {
  colorFields, coverColorLabels, coverTokenGroups, labels, optionLabels, socialColorLabels,
  socialTokenLimits, targetLabel, tokenGroups,
} from './theme-manager-fields.js';

let active=null,bound=false,previewTimer=0,previewRequest=0,editorBaseline=null,aiCandidate=null,aiGenerationController=null,templateProposalMode=false,proposalCandidate=null;
async function sources(){
  const [article,social,cover]=await Promise.all([loadThemeCatalog('article'),loadThemeCatalog('social'),loadThemeCatalog('cover')]);
  const select=document.getElementById('theme-clone-source');
  select.innerHTML=[...article.items,...social.items,...cover.items].filter((item)=>item.source==='builtin').map((item)=>`<option value="${item.id}">${escapeHtml(item.label)} · ${targetLabel(item.target)}</option>`).join('');
}
function themeRow(item){
  const status=item.status==='published'?'已发布':item.status==='archived'?'已归档':'草稿';
  return `<button type="button" class="user-theme-row ${active?.id===item.id?'active':''}" data-user-theme="${item.id}"><span><b>${escapeHtml(item.label)}</b><small>${targetLabel(item.target)} · ${status}</small></span><em>${item.activeVersion?`v${item.activeVersion}`:'未发布'}</em></button>`;
}
async function list(){
  const data=await request('/api/themes/manage');
  const node=document.getElementById('user-theme-list');
  if(!data.items.length){
    node.innerHTML='<div class="empty-state">还没有用户主题。先从一个内置主题复制。</div>';
    return;
  }
  const activeItems=data.items.filter((item)=>item.status!=='archived'),archivedItems=data.items.filter((item)=>item.status==='archived'),archivedOpen=archivedItems.some((item)=>active?.id===item.id);
  node.innerHTML=`${activeItems.map(themeRow).join('')}${archivedItems.length?`<details class="user-theme-archived-group" ${archivedOpen?'open':''}><summary><span>已归档</span><em>${archivedItems.length}</em></summary><div class="user-theme-archived-list">${archivedItems.map(themeRow).join('')}</div></details>`:''}`;
}
function fieldControl(group,field){
  const [key,label,type,a,b,step,unit]=field,value=active.draft.tokens[group][key],path=`tokens.${group}.${key}`;
  if(type==='select')return `<label class="theme-token-field"><span>${label}</span><select data-theme-field="${path}">${a.map((option)=>`<option value="${option}" ${option===value?'selected':''}>${optionLabels[option]}</option>`).join('')}</select></label>`;
  const [min,max]=active.target==='social'&&socialTokenLimits[key]?socialTokenLimits[key]:[a,b],pair=`${group}-${key}`;
  return `<label class="theme-token-field"><span>${label}<output data-token-output="${pair}">${value}${unit}</output></span><span class="theme-number-pair"><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-token-pair="${pair}" aria-label="${label}滑杆"><input type="number" min="${min}" max="${max}" step="${step}" value="${value}" data-token-pair="${pair}" data-theme-field="${path}" aria-label="${label}精确值" aria-describedby="${pair}-error"><i>${unit||'×'}</i></span><small class="theme-field-error" id="${pair}-error" aria-live="polite"></small></label>`;
}
function templateEditor(){
  if(active.target!=='social')return '';
  const packs=active.editorCatalog?.templatePacks||[],configured=active.draft.social?.templatePack?.id||'standard-v1',selected=packs.find((pack)=>pack.id===configured)||packs[0],matching=active.draft.social?.templateMatch||active.template?.matching,sourceLabels={'program-recommended':'程序推荐','user-selected':'用户调整','inherited':'复制继承','compatibility':'标准兼容'},sourceLabel=sourceLabels[matching?.source]||'待确认',confidenceLabels={high:'高',medium:'中',low:'低'},confidence=confidenceLabels[matching?.confidence]||'未记录',reasonLabels={NO_DIRECTION_SIGNAL:'没有视觉方向信号',WEAK_DIRECTION_SIGNAL:'视觉方向信号较弱',AMBIGUOUS_DIRECTION_SIGNAL:'多个视觉方向接近',CLEAR_DIRECTION:'视觉方向明确'},reasonLabel=reasonLabels[matching?.reasonCode]||'',lowConfidence=matching?.confidence==='low'||(selected?.id==='standard-v1'&&['compatibility','default','fallback'].includes(matching?.source)),options=packs.map((pack)=>`<option value="${escapeHtml(pack.id)}" ${pack.id===configured?'selected':''}>${escapeHtml(pack.label)} · v${pack.version}</option>`).join('');
  if(!selected)return '';
  const roles=Object.entries(selected.roleTemplates||{}).slice(0,6).map(([role,id])=>`<span><b>${escapeHtml(role)}</b>${escapeHtml(id)}</span>`).join('');
  const descriptions={'standard-v1':'旧故事板兼容、稳定通用版式；不提供专用角色结构。','neon-v1':'指标封面、终端功能卡、步骤轨道和强调结尾。','brutalist-v1':'海报封面、硬边框功能卡、编号步骤和强 CTA。','editorial-v1':'纸张封面、来源账页、编辑栏和纸页结尾。','clean-v1':'清爽封面、工具卡、低装饰步骤和轻量结尾。'};
  const suggestion=lowConfidence?`<div class="theme-template-suggestion" data-template-suggestion><b>当前使用标准兼容模板</b><span>${escapeHtml(matching?.reason||'程序没有识别到足够明确的视觉方向。可以继续使用标准兼容模板，也可以创建模板提案沉淀新的视觉结构。')}</span><div><button type="button" class="outline-button" data-template-continue>继续使用标准兼容模板</button><button type="button" class="ink-button" data-create-template-proposal>创建模板提案</button></div></div>`:'';
  return `<section class="theme-template-config" aria-label="图文模板包"><div><b>图文模板包</b><small>决定页面角色的构图语言；不改变故事板事实与页面顺序</small></div><label><span class="visually-hidden">模板包</span><select data-theme-field="social.templatePack.id" aria-label="图文模板包">${options}</select><input type="hidden" data-theme-field="social.templatePack.version" value="${selected.version}"></label><p>${escapeHtml(descriptions[selected.id]||selected.label)} 专用模板审计失败时不会静默切换到其他模板。</p><p class="theme-template-match" data-template-match-status><b>匹配来源：${escapeHtml(sourceLabel)}</b>${matching?.reason?` · ${escapeHtml(matching.reason)}`:' · 当前主题尚未记录程序匹配理由'}${reasonLabel?` · 原因：${reasonLabel}`:''}</p><p class="theme-template-confidence ${lowConfidence?'low':''}"><b>匹配置信度：${confidence}</b>${matching?.score!==undefined?` · ${matching.score} 分${matching.runnerUpScore!==undefined?`，分差 ${matching.margin}`:''}`:''}</p>${suggestion}<div class="theme-template-roles">${roles}</div></section>`;
}
function recipeEditor(){
  if(active.target==='cover')return '';
  const target=active.target,config=active.draft[target],catalog=active.editorCatalog?.recipes||{},recipeFields=Object.entries(catalog).map(([key,meta])=>{
    const current=config.recipes[key]??(target==='social'&&key==='coverTitle'?'classic':undefined);
    return `<label class="theme-recipe-field"><span><b>${meta.label}</b><small>${key==='coverTitle'?'只影响封面标题 · ':''}样稿：${meta.specimenRole}</small></span><select data-theme-field="${target}.recipes.${key}">${meta.options.map((option)=>`<option value="${option.value}" ${current===option.value?'selected':''}>${option.label}</option>`).join('')}</select></label>`;
  }).join('');
  let extras='';
  if(target==='article')extras=`<div class="theme-behavior-grid"><label><input type="checkbox" data-theme-field="article.behavior.justify" ${config.behavior.justify?'checked':''}> 正文两端对齐</label><label><input type="checkbox" data-theme-field="article.behavior.numberSections" ${config.behavior.numberSections?'checked':''}> 显示章节编号</label><label>重点文字<select data-theme-field="article.behavior.highlightStrong"><option value="accent" ${config.behavior.highlightStrong==='accent'?'selected':''}>强调色</option><option value="ink" ${config.behavior.highlightStrong==='ink'?'selected':''}>正文墨色</option></select></label></div>`;
  else extras=`<div class="theme-token-grid"><label class="theme-token-field"><span>背景纹理</span><select data-theme-field="social.effects.texture">${['none','grid','scanlines','paper-grain'].map((value)=>`<option value="${value}" ${config.effects.texture===value?'selected':''}>${optionLabels[value]}</option>`).join('')}</select></label>${effectNumber('decorationOpacity','装饰透明度',0,1,.05,'')}${effectNumber('contentTiltDeg','内容倾斜',-2,2,.1,'°')}</div>`;
  return `${templateEditor()}<details class="theme-token-section theme-recipe-section"><summary><span><b>${target==='article'?'文章组件配方':'图文组件配方'}</b><small>只改变组件外观，不改变内容、网格或页面顺序</small></span><i>展开设置</i></summary><div class="theme-recipe-grid">${recipeFields}</div>${extras}<button type="button" class="text-button theme-reset-group" data-reset-config="${target}">恢复当前主题的组件配置</button></details>`;
}
function componentEditor(){
  if(!active.editorCatalog?.components)return '';
  const target=active.target,groups=active.editorCatalog.components.groups,components=active.draft[target].components||(active.draft[target].components=structuredClone(active.editorCatalog.components.defaults));
  const cards=Object.entries(groups).map(([component,meta])=>`<fieldset class="theme-component-card" data-component-group="${component}"><legend><b>${meta.label}</b><small>${meta.hint}</small></legend><div>${Object.entries(meta.fields).map(([key,field])=>{
    const numeric=typeof field.options[0]?.value==='number';
    return `<label class="theme-token-field"><span>${field.label}</span><select data-theme-field="${target}.components.${component}.${key}" ${numeric?'data-value-type="number"':''}>${field.options.map((option)=>`<option value="${option.value}" ${components[component][key]===option.value?'selected':''}>${option.label}</option>`).join('')}</select></label>`;
  }).join('')}</div></fieldset>`).join(''),reset='<button type="button" class="text-button theme-reset-group" data-reset-components>恢复配方推荐值</button>';
  return `<details class="theme-token-section theme-component-section"><summary><span><b>组件细节</b><small>${target==='article'?'细调文章标题、引用、表格和代码':'细调页面标题、信息组件和内容卡片'}；颜色只引用当前主题角色</small></span><i>展开设置</i></summary><div class="theme-component-grid">${cards}</div>${reset}</details>`;
}
function effectNumber(key,label,min,max,step,unit){
  const value=active.draft.social.effects[key],pair=`social-${key}`;
  return `<label class="theme-token-field"><span>${label}<output data-token-output="${pair}">${value}${unit}</output></span><span class="theme-number-pair"><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-token-pair="${pair}" aria-label="${label}滑杆"><input type="number" min="${min}" max="${max}" step="${step}" value="${value}" data-token-pair="${pair}" data-theme-field="social.effects.${key}" aria-label="${label}精确值" aria-describedby="${pair}-error"><i>${unit||'×'}</i></span><small class="theme-field-error" id="${pair}-error" aria-live="polite"></small></label>`;
}
function compatibilityReport(report,{legacy=false}={}){
  const checks={schema:'结构',contrast:'对比度',coverage:'编译覆盖',html:'HTML 安全',layout:'布局结构'},items=Object.entries(checks).map(([key,label])=>`<li class="${report.checks?.[key]?'pass':'fail'}"><b>${report.checks?.[key]?'✓':'!'}</b><span>${label}</span></li>`).join(''),issues=(report.issues||[]).map((item)=>`<li><code>${escapeHtml(item.field||'theme')}</code><span>${escapeHtml(item.message)}${item.specimenNode?` · 样稿节点：${escapeHtml(item.specimenNode)}`:''}</span>${item.suggestion?`<small class="theme-issue-suggestion">建议：${escapeHtml(item.suggestion)}</small>`:''}</li>`).join('');
  return `<section class="theme-compat-report ${legacy?'legacy':''}" aria-label="主题兼容报告"><header><span>${legacy?'READ ONLY':'PUBLISH GATE'}</span><b>${legacy?'旧主题只读兼容报告':report.valid?'发布门禁已就绪':'发布前仍需处理'}</b></header><ul class="theme-gate-checks">${items}</ul>${issues?`<ul class="theme-gate-issues">${issues}</ul>`:''}${legacy?'<p>该草稿不会被原地迁移。你仍可导出 JSON、查看历史版本或归档主题。</p>':''}</section>`;
}
function editorContent(){return compatibilityReport(active.compatibility,{legacy:active.editorMode==='read-only'})+(active.editorMode==='read-only'?'':tokenEditor());}
function tokenEditor(){
  const colors=active.draft.tokens.colors,socialNeonSurface=active.target==='social'&&active.draft.social?.recipes?.surface==='neon',visibleColors=colorFields.filter((key)=>colors[key]&&(active.target!=='social'||key!=='background'||socialNeonSurface)),colorLabels=active.target==='cover'?coverColorLabels:active.target==='social'?{...labels,...socialColorLabels,...(socialNeonSurface?{background:'页面底色（neon 表面配方）'}:{})}:labels,colorHtml=visibleColors.map((key)=>`<label class="theme-color-field"><span>${colorLabels[key]}</span><input type="color" name="color-${key}" value="${colors[key]}" data-theme-field="tokens.colors.${key}"><code>${colors[key]}</code></label>`).join('');
  const activeTokenGroups=active.target==='cover'?coverTokenGroups:tokenGroups,groups=Object.entries(activeTokenGroups).map(([group,meta])=>`<details class="theme-token-section"><summary><span><b>${meta.label}</b><small>${meta.hint}</small></span><i>展开设置</i></summary><div class="theme-token-grid">${meta.fields.map((field)=>fieldControl(group,field)).join('')}</div><button type="button" class="text-button theme-reset-group" data-reset-token-group="${group}">恢复当前主题的${meta.label}</button></details>`).join('');
  return `<details class="theme-token-section" open><summary><span><b>颜色系统</b><small>控制背景、内容层级、强调色和代码对比</small></span><i>展开设置</i></summary><div class="theme-color-grid">${colorHtml}</div><button type="button" class="text-button theme-reset-group" data-reset-token-group="colors">恢复当前主题的颜色</button></details>${groups}${recipeEditor()}${componentEditor()}`;
}
function renderEditor(data){
  active=data;
  if(data.target==='social'&&data.editorMode!=='read-only')active.draft[active.target].components=structuredClone(data.draft.social.components||data.editorCatalog.components.defaults);
  editorBaseline=structuredClone(active.draft);
  const form=document.getElementById('user-theme-form'),editor=document.getElementById('user-theme-colors'),readOnly=data.editorMode==='read-only';
  form.hidden=false;
  form.elements.label.value=data.draft.label;
  form.elements.description.value=data.draft.description;
  form.elements.label.disabled=readOnly;
  form.elements.description.disabled=readOnly;
  document.getElementById('validate-user-theme').disabled=readOnly;
  document.getElementById('publish-user-theme').disabled=readOnly;
  document.getElementById('user-theme-editor-title').textContent=data.draft.label;
  document.getElementById('user-theme-editor-meta').textContent=`${targetLabel(data.target)} · ${data.status==='published'?`已发布 v${data.activeVersion}`:data.status==='archived'?'已归档':'草稿'}`;
  editor.className='theme-token-editor';
  editor.innerHTML=editorContent();
  updatePreview();
  loadVersions();
}
function setPath(root,path,value){
  const parts=path.split('.');
  const leaf=parts.pop(),parent=parts.reduce((node,key)=>node[key]||(node[key]={}),root);
  parent[leaf]=value;
}
function definition(){
  const value=structuredClone(active.draft);
  value.label=document.querySelector('#user-theme-form [name="label"]').value.trim();
  value.description=document.querySelector('#user-theme-form [name="description"]').value.trim();
  document.querySelectorAll('#user-theme-form [data-theme-field]').forEach((input)=>setPath(value,input.dataset.themeField,input.type==='checkbox'?input.checked:input.type==='number'||input.dataset.valueType==='number'?Number(input.value):input.type==='color'?input.value.toUpperCase():input.value));
  return value;
}
function previewShell(){
  const node=document.getElementById('user-theme-live-preview');
  if(!node.querySelector('iframe'))node.innerHTML='<div class="theme-preview-status" id="user-theme-preview-status" aria-live="polite">正在生成正式样稿…</div><iframe id="user-theme-preview-frame" title="主题正式编译样稿" sandbox=""></iframe>';
  return node;
}
function updateFieldValues(){
  document.querySelectorAll('#user-theme-form input[type="color"]').forEach((input)=>input.closest('label')?.querySelector('code')?.replaceChildren(input.value.toUpperCase()));
  document.querySelectorAll('#user-theme-form [data-token-output]').forEach((output)=>{
    const input=document.querySelector(`#user-theme-form input[type="number"][data-token-pair="${output.dataset.tokenOutput}"]`),unit=input?.parentElement?.querySelector('i')?.textContent||'';
    if(input)output.textContent=`${input.value}${unit==='×'?'':unit}`;
  });
}
function showFieldValidity(input){
  document.querySelectorAll('#user-theme-form .theme-field-error').forEach((node)=>node.textContent='');
  document.querySelectorAll('#user-theme-form .theme-token-field.invalid').forEach((node)=>node.classList.remove('invalid'));
  if(!input)return;
  const message=input.validity.valueMissing?'请输入数值':input.validity.rangeUnderflow||input.validity.rangeOverflow?`请输入 ${input.min}–${input.max} 范围内的值`:input.validity.stepMismatch?`请按 ${input.step} 的步进输入数值`:'请输入有效数值',field=input.closest('.theme-token-field');
  field?.classList.add('invalid');
  field?.querySelector('.theme-field-error')?.replaceChildren(message);
}
async function updatePreview(highlightField=''){
  if(!active)return;
  previewShell();
  const requestId=++previewRequest,status=document.getElementById('user-theme-preview-status'),frame=document.getElementById('user-theme-preview-frame'),invalid=document.querySelector('#user-theme-form [data-theme-field]:invalid');
  updateFieldValues();
  showFieldValidity(invalid);
  if(invalid){
    status.textContent='请先修正左侧标出的配置项';
    status.classList.remove('error');
    return;
  }
  status.textContent='正在生成正式样稿…';
  status.classList.remove('error');
  try{
    const result=await request('/api/themes/preview',{method:'POST',body:JSON.stringify({target:active.target,definition:definition(),highlightField})});
    if(requestId!==previewRequest)return;
    frame.srcdoc=result.html;
    const templateMeta=active.target==='social'&&result.template?.pack?` · 模板 ${result.template.pack} v${result.template.version}${result.template.compatibility?' · 标准兼容模板':''}`:'';
    status.textContent=highlightField?`正在显示 ${highlightField.split('.').at(-1)} 的影响位置${templateMeta}`:`样稿由正式生产编译器生成${templateMeta}`;
  }catch(error){
    if(requestId!==previewRequest)return;
    status.textContent=`样稿生成失败：${error.message}`;
    status.classList.add('error');
  }
}
function schedulePreview(highlightField='',delay=140){
  clearTimeout(previewTimer);
  previewTimer=setTimeout(()=>updatePreview(highlightField),delay);
}
function showGateIssues(issues=[]){
  if(!issues.length)return;
  active.compatibility={...active.compatibility,valid:false,issues};
  const report=document.querySelector('.theme-compat-report');
  if(report)report.outerHTML=compatibilityReport(active.compatibility);
  const first=issues.find((item)=>item.field),control=first&&document.querySelector(`[data-theme-field="${first.field}"]`);
  control?.closest('details')?.setAttribute('open','');
  control?.focus();
}
async function open(id){
  renderEditor(await request(`/api/themes/${encodeURIComponent(id)}`));
  const usage=await request(`/api/themes/${encodeURIComponent(id)}/usage`);
  document.getElementById('user-theme-usage').textContent=usage.usageCount?`已用于 ${usage.usageCount} 次生产 · ${usage.batchCount} 个批次 · 最近 ${new Date(usage.lastUsedAt).toLocaleString('zh-CN')}`:'尚未用于正式生产';
  await list();
}
async function loadVersions(){
  const data=await request(`/api/themes/${encodeURIComponent(active.id)}/versions`);
  const select=document.getElementById('user-theme-versions');
  select.innerHTML=data.items.length?data.items.map((item)=>`<option value="${item.version}">v${item.version} · ${new Date(item.published_at).toLocaleDateString('zh-CN')}</option>`).join(''):'<option value="">暂无已发布版本</option>';
  document.getElementById('restore-user-theme').disabled=!data.items.length;
}
async function refreshProductionThemes(){
  invalidateThemeCatalog();
  await hydrateThemePickers();
  await sources();
}
function aiThemePreferences(){
  const scene=document.getElementById('ai-theme-scene').value.trim(),tone=[...document.querySelectorAll('[name="ai-theme-tone"]:checked')].map((input)=>input.value),brightness=document.getElementById('ai-theme-brightness').value,readingPriority=document.getElementById('ai-theme-reading').value;
  return Object.fromEntries(Object.entries({scene,tone,brightness,readingPriority}).filter(([,value])=>Array.isArray(value)?value.length:value));
}
function aiThemeInput(){return {target:document.querySelector('[name="ai-theme-target"]:checked').value,prompt:document.getElementById('ai-theme-prompt').value.trim(),preferences:aiThemePreferences()};}
function aiThemeQualityNodes(){
  let issues=document.getElementById('ai-theme-generation-issues');
  if(!issues){
    issues=document.createElement('ul');
    issues.id='ai-theme-generation-issues';
    issues.className='ai-theme-generation-issues';
    issues.hidden=true;
    document.getElementById('ai-theme-generate-status').after(issues);
  }
  let comparison=document.getElementById('ai-theme-comparison');
  if(!comparison){
    comparison=document.createElement('div');
    comparison.id='ai-theme-comparison';
    comparison.className='ai-theme-comparison';
    document.getElementById('ai-theme-design-summary').after(comparison);
  }
  return {issues,comparison};
}
function renderAiGenerationIssues(values=[]){
  const {issues}=aiThemeQualityNodes();
  issues.hidden=!values.length;
  issues.innerHTML=values.map((item)=>`<li><code>${escapeHtml(item.field||'candidate')}</code><span>${escapeHtml(item.message||'候选未通过质量检查')}</span>${item.suggestion?`<small class="theme-issue-suggestion">建议：${escapeHtml(item.suggestion)}</small>`:''}</li>`).join('');
}
function renderAiComparison(value){
  const {comparison}=aiThemeQualityNodes();
  if(!value?.nearestTheme){
    comparison.innerHTML='';
    return;
  }
  const tone=value.recommendRegenerate?'warning':value.verdict==='related'?'related':'distinct',differences=value.differences.map((item)=>`<li><b>${escapeHtml(item.group)}</b><span>${escapeHtml(item.summary)}</span></li>`).join('');
  comparison.innerHTML=`<header><span>ORIGINALITY CHECK</span><b>与“${escapeHtml(value.nearestTheme.label)}”相似度 ${value.similarityPercent}%</b></header><p>${value.recommendRegenerate?'候选与现有主题过于接近，建议重新生成，或确认它正是你需要的方向。':value.verdict==='related'?'视觉方向有关联，但关键配置已形成差异。':'候选与现有主题具有明确差异。'}</p>${differences?`<ul>${differences}</ul>`:''}`;
  comparison.dataset.tone=tone;
}
function mountAiCandidatePreview(html){
  const frame=document.getElementById('ai-theme-candidate-frame'),value=typeof html==='string'?html.trim():'';
  if(!value)return false;
  const mount=()=>{frame.srcdoc=value;};
  if(typeof requestAnimationFrame==='function')requestAnimationFrame(mount);else mount();
  return true;
}
function showAiThemeCandidate(result){
  aiCandidate=result;
  proposalCandidate=null;
  document.getElementById('ai-theme-final-label').closest('label').hidden=false;
  document.getElementById('ai-theme-final-description').closest('label').hidden=false;
  document.getElementById('create-ai-theme-draft').hidden=false;
  document.getElementById('compile-ai-template-proposal').hidden=true;
  document.getElementById('confirm-ai-template-proposal').hidden=true;
  document.querySelector('.ai-theme-candidate-preview>span').textContent='PRODUCTION SPECIMEN';
  const definition=result.definition;
  renderAiGenerationIssues();
  document.getElementById('ai-theme-candidate').hidden=false;
  document.getElementById('ai-theme-candidate-title').textContent=definition.label;
  document.getElementById('ai-theme-candidate-description').textContent=definition.description;
  document.getElementById('ai-theme-final-label').value=definition.label;
  document.getElementById('ai-theme-final-description').value=definition.description;
  document.getElementById('ai-theme-design-summary').innerHTML=result.designSummary.map((item,index)=>`<li><b>${String(index+1).padStart(2,'0')}</b><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.description)}</small></span></li>`).join('');
  renderAiComparison(result.comparison);
  const repairs=document.getElementById('ai-theme-repairs');
  repairs.innerHTML=result.repairs.length?`<details><summary>系统修正了 ${result.repairs.length} 项配置</summary><ul>${result.repairs.map((item)=>`<li><code>${escapeHtml(item.field)}</code><span>${escapeHtml(item.reason)}</span></li>`).join('')}</ul></details>`:'<p>候选无需系统修正，已通过全部发布门禁。</p>';
  if(!mountAiCandidatePreview(result.preview?.html)){
    document.getElementById('ai-theme-generate-status').textContent='候选已生成，但正式样稿为空，请重新生成';
    document.getElementById('ai-theme-generate-status').classList.add('error');
    return;
  }
  const match=result.definition.social?.templateMatch,pack=result.definition.social?.templatePack,confidenceLabels={high:'高',medium:'中',low:'低'},reasonLabels={NO_DIRECTION_SIGNAL:'没有视觉方向信号',WEAK_DIRECTION_SIGNAL:'视觉方向信号较弱',AMBIGUOUS_DIRECTION_SIGNAL:'多个视觉方向接近'},confidence=confidenceLabels[match?.confidence]||'未记录',reason=reasonLabels[match?.reasonCode];
  document.getElementById('ai-theme-generate-status').textContent=`候选已生成 · ${pack?.id?`程序匹配 ${pack.id}（${confidence}置信度${reason?`，${reason}`:''}） · `:''}${new Date(result.expiresAt).toLocaleTimeString('zh-CN')} 前确认有效`;
  document.getElementById('ai-theme-candidate').scrollIntoView({behavior:'smooth',block:'start'});
}
function showTemplateProposalCandidate(result){
  proposalCandidate=result;
  aiCandidate=null;
  const proposal=result.proposal||{};
  document.getElementById('ai-theme-final-label').closest('label').hidden=true;
  document.getElementById('ai-theme-final-description').closest('label').hidden=true;
  document.getElementById('create-ai-theme-draft').hidden=true;
  document.getElementById('compile-ai-template-proposal').hidden=false;
  document.getElementById('confirm-ai-template-proposal').hidden=true;
  document.querySelector('.ai-theme-candidate-preview>span').textContent=proposal.draft?'ISOLATED HTML/CSS DRAFT':'TEMPLATE PROPOSAL JSON';
  document.getElementById('ai-theme-candidate').hidden=false;
  document.getElementById('ai-theme-candidate-title').textContent=proposal.label||'Social 模板提案';
  document.getElementById('ai-theme-candidate-description').textContent=proposal.description||'';
  document.getElementById('ai-theme-final-label').value='';
  document.getElementById('ai-theme-final-description').value='';
  document.getElementById('ai-theme-design-summary').innerHTML=Object.entries(proposal.roles||{}).map(([role,value],index)=>`<li><b>${String(index+1).padStart(2,'0')}</b><span><strong>${escapeHtml(role)} · ${escapeHtml(value.layout||'')}</strong><small>支持 ${(value.supportedBlocks||[]).map(escapeHtml).join('、')}；最多 ${value.maxBlocks||'—'} 个块 / ${value.maxItems||'—'} 项</small></span></li>`).join('');
  const repairs=document.getElementById('ai-theme-repairs');repairs.innerHTML=result.repairs?.length?`<details open><summary>系统清理了 ${result.repairs.length} 项字段</summary><ul>${result.repairs.map((item)=>`<li><code>${escapeHtml(item.field)}</code><span>${escapeHtml(item.reason)}</span></li>`).join('')}</ul></details>`:'<p>提案已通过 JSON 和安全字段门禁。</p>';
  const preview=proposal.draft?.html||`<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:18px;background:#fffdf7;color:#192824;font:12px/1.6 sans-serif}pre{white-space:pre-wrap}</style><pre>${escapeHtml(JSON.stringify(proposal,null,2))}</pre>`;
  document.getElementById('ai-theme-candidate-frame').srcdoc=preview;
  document.getElementById('ai-theme-generate-status').textContent=`模板提案已生成 · ${proposal.status==='preview-only'?'仅隔离预览':'受控 JSON'} · ${new Date(result.expiresAt).toLocaleTimeString('zh-CN')} 前有效`;
  document.getElementById('ai-theme-candidate').scrollIntoView({behavior:'smooth',block:'start'});
}
async function compileTemplateProposal(){
  if(!proposalCandidate)return;
  const button=document.getElementById('compile-ai-template-proposal'),status=document.getElementById('ai-theme-generate-status'),frame=document.getElementById('ai-theme-candidate-frame'),repairs=document.getElementById('ai-theme-repairs');
  button.disabled=true;button.textContent='正在编译与审计…';status.classList.remove('error');status.textContent='程序正在使用正式 Social renderer 生成固定样稿并执行门禁…';
  try{
    const id=proposalCandidate.candidateId||proposalCandidate.proposalId,result=await request(`/api/social/template-proposals/${encodeURIComponent(id)}/compile`,{method:'POST',body:JSON.stringify({themeId:active?.target==='social'?active.id:undefined,channelMode:'xiaohongshu'})});
    frame.srcdoc=result.html;
    document.querySelector('.ai-theme-candidate-preview>span').textContent='FORMAL RENDERER · AUDIT';
    const audit=result.audit||{},issues=audit.issues||[];
    repairs.innerHTML=`<details open><summary>${audit.productionEligible?'正式样稿门禁通过':'正式样稿仅预览'} · ${issues.length?`发现 ${issues.length} 项问题`:'未发现问题'}</summary>${issues.length?`<ul>${issues.map((item)=>`<li><code>${escapeHtml(item.field||'template')}</code><span>${escapeHtml(item.message||item.code||'审计问题')}</span></li>`).join('')}</ul>`:'<p>角色覆盖、内容块、对比度、字体层级、列表伪元素和固定画布均已通过。</p>'}</details>`;
    document.getElementById('confirm-ai-template-proposal').hidden=!audit.productionEligible;
    status.textContent=`正式 renderer 预览已生成 · ${audit.productionEligible?'可进入用户确认':'仅预览，需修复审计问题'} · ${new Date(result.expiresAt).toLocaleTimeString('zh-CN')} 前有效`;
  }catch(error){status.textContent=`正式预览失败：${error.message}`;status.classList.add('error');}
  finally{button.disabled=false;button.textContent='正式 renderer 预览';}
}
async function confirmTemplateProposal(){
  if(!proposalCandidate||active?.target!=='social')return;
  const button=document.getElementById('confirm-ai-template-proposal'),status=document.getElementById('ai-theme-generate-status');
  button.disabled=true;button.textContent='正在绑定…';
  try{
    const id=proposalCandidate.candidateId||proposalCandidate.proposalId,result=await request(`/api/social/template-proposals/${encodeURIComponent(id)}/confirm`,{method:'POST',body:JSON.stringify({themeId:active.id})});
    active.draft=result.theme;toast('模板提案已绑定到主题草稿，请通过发布门禁后发布');
    status.textContent='模板包已写入当前主题草稿；请关闭提案预览并执行“校验草稿”与“发布主题”。';
    button.hidden=true;await open(active.id);
  }catch(error){status.textContent=`模板绑定失败：${error.message}`;status.classList.add('error');}
  finally{button.disabled=false;button.textContent='确认并绑定当前主题';}
}
async function generateTemplateProposal(){
  const prompt=document.getElementById('ai-theme-prompt'),errorNode=document.getElementById('ai-theme-prompt-error'),button=document.getElementById('generate-ai-theme'),status=document.getElementById('ai-theme-generate-status');
  errorNode.textContent='';status.classList.remove('error');
  if(!prompt.checkValidity()){
    errorNode.textContent=prompt.value.trim().length<20?'请至少用 20 个字描述主题效果':'主题描述不能超过 500 字';
    prompt.focus();return;
  }
  aiGenerationController?.abort();const controller=new AbortController();aiGenerationController=controller;button.disabled=true;button.textContent='正在生成提案…';status.textContent='AI 正在组织十个页面角色的版式承载能力，请稍候…';
  try{
    const baseTheme=active?.target==='social'?active.draft:null,baseTemplatePack=baseTheme?.social?.templatePack?.id||'standard-v1',result=await request('/api/social/template-proposals',{method:'POST',signal:controller.signal,body:JSON.stringify({prompt:prompt.value.trim(),baseTemplatePack,baseThemeId:baseTheme?.id||undefined,draftMode:'json'})});
    showTemplateProposalCandidate(result);
  }catch(error){if(error.name==='AbortError')return;status.textContent=`提案生成失败：${error.message}`;renderAiGenerationIssues(error.issues);status.classList.add('error');}
  finally{if(aiGenerationController===controller){button.disabled=false;button.textContent='生成模板提案';aiGenerationController=null;}}
}
async function generateAiTheme(){
  if(templateProposalMode)return generateTemplateProposal();
  const prompt=document.getElementById('ai-theme-prompt'),errorNode=document.getElementById('ai-theme-prompt-error'),button=document.getElementById('generate-ai-theme'),status=document.getElementById('ai-theme-generate-status');
  errorNode.textContent='';
  status.classList.remove('error');
  renderAiGenerationIssues();
  if(!prompt.checkValidity()){
    errorNode.textContent=prompt.value.trim().length<20?'请至少用 20 个字描述主题效果':'主题描述不能超过 500 字';
    prompt.focus();
    return;
  }
  aiGenerationController?.abort();
  const controller=new AbortController();
  aiGenerationController=controller;
  button.disabled=true;
  button.textContent='正在生成…';
  status.textContent='AI 正在组织配色、字阶与组件配方，请稍候…';
  try{
    const result=await request('/api/themes/ai/generate',{method:'POST',signal:controller.signal,body:JSON.stringify(aiThemeInput())});
    showAiThemeCandidate(result);
  }catch(error){
    if(error.name==='AbortError')return;
    status.textContent=error.code==='AI_THEME_MODEL_UNAVAILABLE'?'模型服务当前不可用，请到“运行与配置”检查默认文本模型。':`生成失败：${error.message}`;
    renderAiGenerationIssues(error.issues);
    status.classList.add('error');
  }finally{
    if(aiGenerationController===controller){
      button.disabled=false;
      button.textContent='生成主题候选';
      aiGenerationController=null;
    }
  }
}
function openAiThemeCreator({target='',prompt='',scene=''}={}){
  const node=document.getElementById('ai-theme-creator');
  node.hidden=false;
  document.getElementById('generate-ai-theme').textContent=templateProposalMode?'生成模板提案':'生成主题候选';
  if(!templateProposalMode){document.getElementById('ai-theme-final-label').closest('label').hidden=false;document.getElementById('ai-theme-final-description').closest('label').hidden=false;document.getElementById('create-ai-theme-draft').hidden=false;document.getElementById('compile-ai-template-proposal').hidden=true;document.getElementById('confirm-ai-template-proposal').hidden=true;document.querySelector('.ai-theme-candidate-preview>span').textContent='PRODUCTION SPECIMEN';}
  if(target){
    const targetInput=document.querySelector(`[name="ai-theme-target"][value="${target}"]`);
    if(targetInput)targetInput.checked=true;
  }
  if(prompt)document.getElementById('ai-theme-prompt').value=prompt;
  if(scene)document.getElementById('ai-theme-scene').value=scene;
  document.getElementById('open-ai-theme-creator').setAttribute('aria-expanded','true');
  node.scrollIntoView({behavior:'smooth',block:'start'});
  document.getElementById('ai-theme-prompt').focus();
}
function openTemplateProposalCreator(){
  if(!active?.draft)return;
  templateProposalMode=true;
  const label=active.draft.label||'当前主题',description=active.draft.description||'',tags=(active.draft.tags||[]).join('、');
  const prompt=`请为图文主题「${label}」创建一个新的 Social 模板提案。保留主题已有的颜色、字体和阅读气质，但重新设计 cover、concept、feature、steps、data、compare、evidence、timeline、risk、ending 十个页面角色的版式语言；不要固定卡片数量，优先说明内容承载能力、密度和可复用结构。主题描述：${description}${tags?`；视觉标签：${tags}`:''}`.slice(0,500);
  openAiThemeCreator({target:'social',prompt,scene:label});
  const status=document.getElementById('ai-theme-generate-status');
  if(status)status.textContent='已带入当前主题方向；补充模板结构偏好后可生成 Social 候选。';
}
function closeAiThemeCreator(){
  aiGenerationController?.abort();
  aiCandidate=null;proposalCandidate=null;templateProposalMode=false;
  document.getElementById('ai-theme-candidate').hidden=true;
  document.getElementById('compile-ai-template-proposal').hidden=true;
  document.getElementById('confirm-ai-template-proposal').hidden=true;
  document.getElementById('ai-theme-creator').hidden=true;
  document.getElementById('open-ai-theme-creator').setAttribute('aria-expanded','false');
  document.getElementById('open-ai-theme-creator').focus();
}
export default async function loadThemeManager(){
  await Promise.all([sources(),list()]);
  if(bound)return;
  bound=true;
  document.getElementById('clone-theme').addEventListener('click',async()=>{
    try{
      const sourceId=document.getElementById('theme-clone-source').value,id=document.getElementById('theme-clone-id').value.trim(),label=document.getElementById('theme-clone-label').value.trim();
      const result=await request(`/api/themes/${encodeURIComponent(sourceId)}/clone`,{method:'POST',body:JSON.stringify({id,label})});
      toast('已创建用户主题草稿');
      await open(result.theme.id);
    }catch(error){toast(error.message, "error");}
  });
  document.getElementById('open-ai-theme-creator').addEventListener('click',()=>{templateProposalMode=false;openAiThemeCreator();});
  document.getElementById('close-ai-theme-creator').addEventListener('click',closeAiThemeCreator);
  document.getElementById('generate-ai-theme').addEventListener('click',generateAiTheme);
  document.getElementById('regenerate-ai-theme').addEventListener('click',generateAiTheme);
  document.getElementById('compile-ai-template-proposal').addEventListener('click',compileTemplateProposal);
  document.getElementById('confirm-ai-template-proposal').addEventListener('click',confirmTemplateProposal);
  document.querySelectorAll('[name="ai-theme-tone"]').forEach((input)=>input.addEventListener('change',(event)=>{
    const selected=document.querySelectorAll('[name="ai-theme-tone"]:checked');
    if(selected.length>3){
      event.target.checked=false;
      toast('视觉气质最多选择 3 项');
    }
  }));
  document.getElementById('create-ai-theme-draft').addEventListener('click',async()=>{
    if(!aiCandidate)return;
    const button=document.getElementById('create-ai-theme-draft'),labelInput=document.getElementById('ai-theme-final-label'),descriptionInput=document.getElementById('ai-theme-final-description'),errorNode=document.getElementById('ai-theme-create-error'),label=labelInput.value.trim(),description=descriptionInput.value.trim();
    errorNode.textContent='';
    if(!label||!description){
      errorNode.textContent='草稿名称和描述不能为空';
      (!label?labelInput:descriptionInput).focus();
      return;
    }
    button.disabled=true;
    button.textContent='正在创建…';
    try{
      const result=await request(`/api/themes/ai/candidates/${encodeURIComponent(aiCandidate.candidateId)}/create`,{method:'POST',body:JSON.stringify({label,description})});
      toast('AI 主题已创建为草稿');
      aiCandidate=null;
      document.getElementById('ai-theme-candidate').hidden=true;
      closeAiThemeCreator();
      await open(result.theme.id);
    }catch(error){
      errorNode.textContent=error.code==='AI_THEME_CANDIDATE_EXPIRED'?'候选已过期，请重新生成后再创建草稿。':`创建失败：${error.message}`;
    }finally{
      button.disabled=false;
      button.textContent='创建为草稿';
    }
  });
  document.getElementById('import-theme-file').addEventListener('change',async(event)=>{
    const file=event.target.files?.[0];
    if(!file)return;
    try{
      const definition=JSON.parse(await file.text());
      const result=await request('/api/themes/import',{method:'POST',body:JSON.stringify({definition})});
      toast(result.warnings?.length?`导入成功：${result.warnings.map((item)=>item.message).join('；')}`:'主题已导入为草稿');
      await open(result.theme.id);
    }catch(error){toast(`导入失败：${error.message}`, "error");}finally{event.target.value='';}
  });
  document.getElementById('user-theme-list').addEventListener('click',(event)=>{
    const row=event.target.closest('[data-user-theme]');
    if(row)open(row.dataset.userTheme).catch((error)=>toast(error.message, "error"));
  });
  document.getElementById('user-theme-form').addEventListener('input',(event)=>{
    const pair=event.target?.dataset?.tokenPair;
    if(pair){
      document.querySelectorAll(`#user-theme-form [data-token-pair="${pair}"]`).forEach((input)=>{
        if(input!==event.target)input.value=event.target.value;
      });
    }
    if(event.target?.dataset?.themeField==='social.recipes.coverTitle'){
      const colorRole=document.querySelector('#user-theme-form [data-theme-field="social.components.coverTitle.colorRole"]');
      if(colorRole){
        if(event.target.value==='highlight-block'&&colorRole.value==='text')colorRole.value='inverseText';
        else if(event.target.value!=='highlight-block'&&colorRole.value==='inverseText')colorRole.value='text';
      }
    }
    if(event.target?.dataset?.themeField==='social.templatePack.id'){
      const pack=active.editorCatalog?.templatePacks?.find((item)=>item.id===event.target.value);
      const version=document.querySelector('#user-theme-form [data-theme-field="social.templatePack.version"]');
      if(pack&&version)version.value=pack.version;
    }
    schedulePreview(event.target?.dataset?.themeField||'');
  });
  document.getElementById('user-theme-form').addEventListener('focusin',(event)=>{
    const field=event.target?.dataset?.themeField;
    if(field)schedulePreview(field,0);
  });
  document.getElementById('user-theme-form').addEventListener('focusout',()=>schedulePreview('',80));
  document.getElementById('user-theme-form').addEventListener('click',(event)=>{
    const button=event.target.closest('[data-reset-token-group],[data-reset-config],[data-reset-components]');
    if(!button)return;
    if(button.dataset.resetTokenGroup){
      const group=button.dataset.resetTokenGroup;
      active.draft.tokens[group]=structuredClone(editorBaseline.tokens[group]);
    }else if(button.hasAttribute('data-reset-components'))active.draft[active.target].components=structuredClone(active.editorCatalog.components.defaults);
    else active.draft[button.dataset.resetConfig]=structuredClone(editorBaseline[button.dataset.resetConfig]);
    document.getElementById('user-theme-colors').innerHTML=editorContent();
    schedulePreview('',0);
  });
  document.getElementById('user-theme-form').addEventListener('click',(event)=>{
    if(event.target.closest('[data-create-template-proposal]')){
      openTemplateProposalCreator();
      return;
    }
    const continueButton=event.target.closest('[data-template-continue]');
    if(!continueButton)return;
    const select=document.querySelector('#user-theme-form [data-theme-field="social.templatePack.id"]'),version=document.querySelector('#user-theme-form [data-theme-field="social.templatePack.version"]');
    if(!select)return;
    select.value='standard-v1';
    if(version)version.value='1';
    select.dispatchEvent(new Event('input',{bubbles:true}));
    continueButton.disabled=true;
    continueButton.textContent='已选择标准兼容模板';
    const status=document.querySelector('[data-template-match-status]');
    if(status)status.innerHTML='<b>匹配来源：用户确认</b> · 已选择标准兼容模板，保存草稿后生效';
  });
  document.getElementById('validate-user-theme').addEventListener('click',async()=>{
    try{
      const saved=await request(`/api/themes/${active.id}/draft`,{method:'PUT',body:JSON.stringify({definition:definition()})});
      active.draft=saved.theme;
      const result=await request(`/api/themes/${active.id}/validate`,{method:'POST',body:'{}'});
      if(!result.valid)showGateIssues(result.issues);
      toast(result.valid?'当前草稿校验通过':`校验失败：${result.issues.map((item)=>`${item.field?`${item.field} `:''}${item.message}`).join('；')}`);
      await list();
    }catch(error){
      showGateIssues(error.issues);
      toast(`校验失败：${error.message}`, "error");
    }
  });
  document.getElementById('publish-user-theme').addEventListener('click',async()=>{
    try{
      await request(`/api/themes/${active.id}/draft`,{method:'PUT',body:JSON.stringify({definition:definition()})});
      await request(`/api/themes/${active.id}/publish`,{method:'POST',body:'{}'});
      toast('主题新版本已发布');
      await refreshProductionThemes();
      await open(active.id);
    }catch(error){
      showGateIssues(error.issues);
      toast(error.message, "error");
    }
  });
  document.getElementById('export-user-theme').addEventListener('click',async()=>{
    const definition=await request(`/api/themes/${active.id}/export?draft=1`),blob=new Blob([JSON.stringify(definition,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;
    link.download=`${active.id}.theme.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById('archive-user-theme').addEventListener('click',async()=>{
    const impact=await request(`/api/themes/${active.id}/archive-impact`);
    if(!await confirmAction(`归档后将从生产选择器移除。历史版本 ${impact.historicalVersions} 个，已用于生产 ${impact.usageCount} 次，是否继续？`,{confirmText:'归档主题'}))return;
    await request(`/api/themes/${active.id}/archive`,{method:'POST',body:'{}'});
    toast('主题已归档，历史版本与任务快照仍保留');
    await refreshProductionThemes();
    document.getElementById('user-theme-form').hidden=true;
    active=null;
    await list();
  });
  document.getElementById('restore-user-theme').addEventListener('click',async()=>{
    const version=document.getElementById('user-theme-versions').value;
    if(!version)return;
    await request(`/api/themes/${active.id}/versions/${version}/restore`,{method:'POST',body:'{}'});
    toast(`已从 v${version} 创建草稿`);
    await open(active.id);
  });
}
