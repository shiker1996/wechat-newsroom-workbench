import { state } from "../core/state.js";
import { request } from "../core/http.js";
import { streamChat } from "../core/stream-chat.js";
import { escapeHtml, toast, providerOptions, confirmAction } from "../core/ui.js";
import { loadStageSkillControls, selectedStageSkills } from "../core/skill-selection.js";

let selectedId = null;
let delivery=null;let deliveryIndex=0;let proofTab='copy';
let selectedContentType='repository';
let selectedChannelMode='wechat';
let selectedCompositionMode='smart';
let currentGroupLayout='auto';
let currentCardPlan=[];
let currentLayoutDecisions=[];
let socialSkillSlots=null;
// 故事板 <details> 编辑器存在未保存修改时置位；任何 renderCardPlan 重建都会丢失这些修改，
// 触发重建的操作（整组/逐页版式、构图模式、渠道）需先 confirmAction 警告
let storyboardDirty=false;

const CARD_LAYOUT_LABELS={auto:'自动推荐',poster:'海报大字',editorial:'杂志分栏',data:'数据报告',checklist:'卡片清单',steps:'教程步骤',minimal:'极简留白'};
const CARD_LAYOUT_STATUS={recommended:'自动推荐',storyboard:'故事板指定',manual:'手动指定',group:'整组指定',fallback:'自动降级'};
const CARD_ROLE_LABELS={cover:'封面',concept:'概念',feature:'功能',steps:'步骤',data:'数据',compare:'对比',evidence:'证据',timeline:'时间线',risk:'风险',ending:'结尾'};
const CARD_COMPOSITION_LABELS={'hero-stack':'主视觉堆叠','hero-frame':'主视觉框景','concept-split':'概念分栏','concept-offset':'概念错位','feature-ledger':'功能账本','feature-stack':'功能纵列','sequence-rail':'步骤轨道','sequence-offset':'步骤错列','metric-board':'数据面板','metric-split':'数据分栏','comparison-board':'对比面板','comparison-split':'对比分栏','evidence-ledger':'证据账本','evidence-frame':'证据框景','timeline-rail':'时间轨道','timeline-offset':'时间错列','risk-sidebar':'风险侧栏','risk-frame':'风险框景','closing-focus':'收束聚焦','closing-note':'收束便笺'};
const CARD_DECORATION_LABELS={none:'无装饰',orbit:'轨道圆环','index-line':'索引线',stamp:'编辑戳记'};
const CARD_OVERLAP_LABELS={none:'标准层级','title-card':'标题叠卡','accent-edge':'边缘错位'};
const CARD_ALLOWED_BLOCK_TYPES=['text','list','code','note','stats','compare','steps','timeline','scenes','highlight'];
const CARD_STRUCTURED_BLOCK_TYPES=new Set(['stats','compare','steps','timeline','scenes']);
const CARD_BLOCK_TYPE_LABELS={text:'正文',list:'列表',code:'代码',note:'提示',stats:'数据卡',compare:'对比卡',steps:'步骤卡',timeline:'时间线',scenes:'场景卡',highlight:'亮点'};
function cardBlockTypeOptions(selected){
  return CARD_ALLOWED_BLOCK_TYPES.map((type)=>`<option value="${type}"${type===selected?' selected':''}>${CARD_BLOCK_TYPE_LABELS[type]||type}</option>`).join('');
}
function cardBlockEditorHtml(block,index){
  const type=CARD_ALLOWED_BLOCK_TYPES.includes(block?.type)?block.type:'text';
  const structured=CARD_STRUCTURED_BLOCK_TYPES.has(type);
  const payload=structured?JSON.stringify({items:block.items||[],headers:block.headers||[],rows:block.rows||[]},null,2):String(block.content||'');
  return `<fieldset class="storyboard-block-editor" data-storyboard-block="${index}"><legend>内容块 ${index+1}<select data-storyboard-block-type>${cardBlockTypeOptions(type)}</select></legend><label>小标题<input data-storyboard-block-title value="${escapeHtml(block.title||'')}"></label><label>${structured?'结构化内容（JSON）':'正文'}<textarea data-storyboard-block-content rows="${structured?6:3}">${escapeHtml(payload)}</textarea></label><button type="button" class="text-button" data-remove-storyboard-block>删除此块</button></fieldset>`;
}

function syncCompositionControls(){
  const picker=document.getElementById('social-template-picker');
  if(picker)picker.hidden=selectedCompositionMode==='smart';
}

const CUSTOM_TYPE_LABELS={tutorial:'教程',list:'清单',opinion:'观点'};
const CUSTOM_LEVEL_LABELS={author_experience:'作者体验',user_material:'用户素材',model_suggestion:'模型建议'};
const SOCIAL_ENTRY_POINTS={repository:'social-tool',event:'social-event',custom:'social-custom'};

function socialRoutingContentType(data){
  return selectedContentType==='custom'?String(data?.facts?.data?.content_type||''):selectedContentType;
}
function updateSocialSkillSummary(){
  const summary=document.getElementById('social-skill-summary');
  const select=document.querySelector('#social-stage-skills [data-stage-skill="storyboard"]');
  const slot=socialSkillSlots?.slots?.find((item)=>item.id==='storyboard');
  if(!summary||!slot){if(summary)summary.textContent='未读取到兼容故事板技能';return;}
  const explicit=select?.value||'';
  const selected=slot.items.find((item)=>item.id===(explicit||slot.defaultSkillId));
  const source=explicit?'本次指定':slot.configuredDefaultSkillId?'工作区默认':'内置默认';
  summary.textContent=`${selected?.name||slot.defaultSkillId} · ${source}`;
}
async function loadSocialSkillControls(data){
  const entryPoint=SOCIAL_ENTRY_POINTS[selectedContentType];
  const contentType=socialRoutingContentType(data);
  socialSkillSlots=await loadStageSkillControls(
    document.getElementById('social-stage-skills'),
    `/api/creation-entry-points/${encodeURIComponent(entryPoint)}/social-card-stage-skills?contentType=${encodeURIComponent(contentType)}`,
  );
  updateSocialSkillSummary();
}

// 工具图文 / 自定义图文 / 事件图文三个导航入口共用本模块，以 currentMode 区分
let currentMode='tools';
function isCustomOutput(mode){return String(mode||'').includes('custom-cards');}
function isEventOutput(mode){return String(mode||'').includes('event-cards');}
function candidateMode(outputMode){return isCustomOutput(outputMode)?'custom':isEventOutput(outputMode)?'event':'tools';}
const MODE_LAYOUT={
  tools:{heading:'工具图文',intro:'AI 根据仓库事实直接规划卡片故事板，确认故事线后即可生成整组图文。',empty:'当前批次没有工具图文候选。<a href="#overview">前往热点全景，将合适事件加入图文池</a>'},
  custom:{heading:'自定义图文',intro:'从主题、要点和素材直接立项，AI 按来源等级规划卡片故事板。',empty:'当前批次没有自定义图文，请点击上方「创建自定义图文」添加。'},
  event:{heading:'事件图文',intro:'AI 根据事件卡与来源快照整理事实基座，规划事件卡片故事板。',empty:'当前批次没有事件图文候选。<a href="#overview">前往热点全景，将合适事件加入图文池</a>'},
};
function applyModeLayout(){
  const layout=MODE_LAYOUT[currentMode]||MODE_LAYOUT.tools;
  document.getElementById('social-editor-heading').textContent=layout.heading;
  document.getElementById('social-editor-intro').textContent=layout.intro;
  document.getElementById('create-custom-social').hidden=currentMode!=='custom';
  document.getElementById('create-repository-social').hidden=currentMode!=='tools';
  if(currentMode!=='tools')document.getElementById('repository-social-panel').hidden=true;
  if(currentMode!=='custom')document.getElementById('custom-social-panel').hidden=true;
  const empty=document.getElementById('social-editor-empty');
  if(empty)empty.innerHTML=layout.empty;
  const scorePanel=document.querySelector('.social-score-panel');if(scorePanel)scorePanel.hidden=currentMode!=='tools';
}

function updateSocialTabControls(){const tabs=document.getElementById('social-editor-candidates');const previous=document.getElementById('social-tabs-previous');const next=document.getElementById('social-tabs-next');if(!tabs||!previous||!next)return;const max=Math.max(0,tabs.scrollWidth-tabs.clientWidth);previous.disabled=tabs.scrollLeft<=1;next.disabled=tabs.scrollLeft>=max-1;}
function setupSocialTabNavigation(){const tabs=document.getElementById('social-editor-candidates');const strip=tabs?.closest('.social-candidate-tab-strip');if(!tabs||!strip||strip.dataset.navigationBound==='true')return;strip.dataset.navigationBound='true';strip.addEventListener('click',(event)=>{const arrow=event.target.closest('.candidate-tab-arrow');if(!arrow)return;tabs.scrollBy({left:(arrow.classList.contains('previous')?-1:1)*Math.max(220,tabs.clientWidth*.72),behavior:'smooth'});});tabs.addEventListener('scroll',updateSocialTabControls,{passive:true});window.addEventListener('resize',updateSocialTabControls,{passive:true});updateSocialTabControls();}

function renderDeliveryImage(){
  if(!delivery?.images?.length)return;
  deliveryIndex=(deliveryIndex+delivery.images.length)%delivery.images.length;
  const image=delivery.images[deliveryIndex];
  document.getElementById('social-gallery-image').src=`${image.url}?s=${image.size}`;
  document.getElementById('social-gallery-counter').textContent=`${deliveryIndex+1} / ${delivery.images.length}`;
  document.getElementById('social-download-image').href=image.downloadUrl;
  document.getElementById('social-gallery-film').querySelectorAll('button').forEach((button,index)=>button.classList.toggle('active',index===deliveryIndex));
}
function renderProof(){
  if(!delivery)return;
  const values={copy:delivery.copy||'暂无发布文案',facts:delivery.facts||'暂无事实清单',layout:JSON.stringify(delivery.layout||{},null,2)};
  document.getElementById('social-proof-content').textContent=values[proofTab];
  document.querySelectorAll('[data-social-proof]').forEach((button)=>button.classList.toggle('active',button.dataset.socialProof===proofTab));
}
async function loadDelivery(candidateId=selectedId){
  if(!candidateId)return;
  const data=await request(`/api/candidates/${candidateId}/social-cards`);
  if(candidateId!==selectedId)return;
  delivery=data;
  const panel=document.getElementById('social-delivery');
  panel.hidden=!data.ready;
  if(!data.ready)return;
  deliveryIndex=0;
  document.getElementById('social-delivery-meta').textContent=`${data.images.length} 张 · 布局审计${data.layout?.valid?'通过':'待确认'} · 交付门禁${data.delivery?.valid?'通过':'待确认'}`;
  document.getElementById('social-open-html').href=data.htmlUrl;
  document.getElementById('social-download-all').href=data.bundleUrl;
  document.getElementById('social-gallery-film').innerHTML=data.images.map((image,index)=>`<button type="button" data-social-image="${index}" aria-label="查看第 ${index+1} 张图文"><img src="${image.url}?s=${image.size}" alt="第 ${index+1} 张缩略图"><span>${String(index+1).padStart(2,'0')}</span></button>`).join('');
  renderDeliveryImage();
  renderProof();
}

let lastGate=null;
function renderGate(gate) {
  lastGate=gate;  document.getElementById("card-ready-title").textContent=gate.ready?"故事板已就绪":selectedContentType==='event'?"请先生成事件故事板":selectedContentType==='custom'?"请先完善自定义事实基座":"请先分析仓库生成故事板";
  const generate=document.getElementById("generate-social-card");
  generate.disabled=!gate.ready;
  generate.title=gate.ready?"根据当前卡片故事板开始生成":selectedContentType==='event'?"请先根据事实基座生成事件故事板":selectedContentType==='custom'?"门禁项全部通过后才能生成图文":"请先分析仓库并生成卡片故事板";
  syncGenerateButton();
}

function renderFacts(facts,eventAnalysis) {
  const node=document.getElementById("repository-facts"); const fact=facts?.data;
  if(selectedContentType==='event'){
    const analysis=eventAnalysis?.analysis;
    if(!analysis){node.innerHTML='<div class="empty-state">突发事实基座尚未生成。</div>';return;}
    const confirmed=analysis.factBase?.confirmedFacts||[],claims=analysis.factBase?.claims||[],sources=analysis.sources||[];
    node.innerHTML=`<div class="repository-fact-grid"><span><b>${sources.filter((item)=>item.status==='ok').length}</b>可用来源</span><span><b>${confirmed.length}</b>确认事实</span><span><b>${claims.length}</b>待核主张</span><span><b>${analysis.sourceAudit?.independentSourceCount||0}</b>独立来源</span></div><p>${escapeHtml(analysis.eventSummary||'')}</p>${(analysis.sourceAudit?.issues||[]).length?`<ul>${analysis.sourceAudit.issues.map((item)=>`<li>${escapeHtml(item)}</li>`).join('')}</ul>`:''}`;
    return;
  }
  if(selectedContentType==='custom'){
    if(!fact||fact.kind!=='custom'){node.innerHTML='<div class="empty-state">自定义事实基座尚未生成，请重新创建自定义图文。</div>';return;}
    const points=fact.points||[],materials=fact.materials||[];
    const materialsHtml=materials.length?`<ul>${materials.map((item)=>`<li>${escapeHtml(item.url)}（${item.status==='ok'?`抓取成功 ${item.content_chars} 字`:`抓取失败：${escapeHtml(item.error||'未知原因')}`}）</li>`).join('')}</ul>`:'';
    node.innerHTML=`<div class="repository-fact-grid"><span><b>${escapeHtml(CUSTOM_TYPE_LABELS[fact.content_type]||fact.content_type)}</b>内容类型</span><span><b>${points.length}</b>核心要点</span><span><b>${materials.filter((item)=>item.status==='ok').length}/${materials.length}</b>素材抓取</span><span><b>${selectedChannelMode==='xiaohongshu'?'小红书':'公众号'}</b>渠道</span></div><p>${escapeHtml(fact.topic||'')}</p><ul>${points.map((item)=>`<li>[${escapeHtml(CUSTOM_LEVEL_LABELS[item.source_level]||item.source_level)}] ${escapeHtml(item.text)}</li>`).join('')}</ul>${materialsHtml}${fact.limitations?`<small>限制：${escapeHtml(fact.limitations)}</small>`:''}`;
    return;
  }
  if(!fact){node.innerHTML=facts?.error?`<div class="pipeline-error">${escapeHtml(facts.error)}</div>`:'<div class="empty-state">尚未核验仓库。点击“核验 / 刷新仓库”。</div>';return;}
  node.innerHTML=`<div class="repository-fact-grid"><span><b>${Number(fact.stars?.value||0).toLocaleString()}</b>Stars</span><span><b>${escapeHtml(fact.license?.type||'UNKNOWN')}</b>License</span><span><b>${escapeHtml(fact.latestRelease?.version||'未发现')}</b>Release</span><span><b>${escapeHtml(fact.maturity||'unknown')}</b>成熟度</span></div><p>${escapeHtml(fact.description||'仓库未提供简介')}</p><small>核验时间：${escapeHtml(fact.stars?.checkedAt||facts.checked_at||'')}</small>${(fact.warnings||[]).length?`<ul>${fact.warnings.map((x)=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>`:''}`;
}

function renderScore(score) {
  const data=score?.score||{}; document.getElementById("social-fit-score").textContent=data.finalScore??"—";
  const labels=selectedContentType==='event'
    ? {informationDensity:'信息密度',visualNarrative:'视觉叙事',conflictEmotion:'冲突情绪',timeliness:'时效性',audienceRelevance:'受众相关',evidenceCompleteness:'证据完整',singleSource:'单源扣分',unverifiedAllegation:'未核实扣分'}
    : selectedContentType==='custom'
      ? {}
      : {toolClarity:'工具明确',scenarioValue:'场景价值',demonstrability:'可演示',visualPotential:'拆页潜力',saveSearchValue:'收藏搜索',sourceCompleteness:'来源完整',factGapPenalty:'事实扣分',permissionRiskPenalty:'权限扣分'};
  document.getElementById("social-score-parts").innerHTML=Object.entries(labels).map(([key,label])=>`<span>${label}<b>${data[key]??'—'}</b></span>`).join('')||'<span>自定义图文不参与选题评分</span>';
}

async function loadSimilarSocialCards(candidateId){const container=document.getElementById('similar-social-cards');if(!container)return;container.hidden=true;container.innerHTML='';try{const items=await request(`/api/candidates/${candidateId}/similar-social`);if(candidateId!==selectedId||!items.length)return;container.innerHTML=`<b>历史图文覆盖</b>${items.map((item)=>`<div><span data-cal-social="${item.candidateRowId}" title="打开历史图文">${escapeHtml(item.title||item.candidateId)}</span> <small>${escapeHtml(item.batchDate||'')} · ${escapeHtml(item.reason||'相似内容')}</small></div>`).join('')}`;container.hidden=false;}catch{container.hidden=true;}}

function renderCardPlan(value,decisions=currentLayoutDecisions) {
  let plan=[];try{plan=Array.isArray(value)?value:JSON.parse(value||'[]');}catch{}
  currentCardPlan=plan;currentLayoutDecisions=Array.isArray(decisions)?decisions:[];storyboardDirty=false;
  const options=(selected)=>Object.entries(CARD_LAYOUT_LABELS).map(([value,label])=>`<option value="${value}"${value===selected?' selected':''}>${label}</option>`).join('');
  const blockEditor=(block,blockIndex)=>cardBlockEditorHtml(block,blockIndex);
  document.getElementById("card-plan-preview").innerHTML=plan.length?plan.map((page,index)=>{
    const decision=currentLayoutDecisions[index]||{layout:page.layout_style||'auto',source:page.layout_style&&page.layout_style!=='auto'?'manual':'recommended',reason:''};
    const selected=page.layout_style||'auto';
    const control=decision.mode==='smart'
      ? `<span class="layout-status ${escapeHtml(decision.source||'recommended')}">智能构图 · ${escapeHtml(CARD_ROLE_LABELS[decision.role]||decision.role||'内容')} · ${escapeHtml(CARD_COMPOSITION_LABELS[decision.composition?.id]||decision.composition?.id||'默认构图')} · 变体 ${(decision.variantIndex??0)+1}/${decision.variantCount||1}</span><small>${escapeHtml(CARD_DECORATION_LABELS[decision.composition?.decoration]||'无装饰')} · ${escapeHtml(CARD_OVERLAP_LABELS[decision.composition?.overlap]||'标准层级')}</small>`
      : `<label>页面版式<select data-card-page-layout="${index+1}">${options(selected)}</select></label><span class="layout-status ${escapeHtml(decision.source||'recommended')}">${escapeHtml(CARD_LAYOUT_STATUS[decision.source]||'自动推荐')} · ${escapeHtml(CARD_LAYOUT_LABELS[decision.layout]||decision.layout||'')}</span>`;
    return `<article data-card-page="${index+1}"><b>${index+1}</b><div class="storyboard-page-copy"><small>${escapeHtml(page.kind||'content')}</small><h4>${escapeHtml(page.title||'未命名页面')}</h4><p>${escapeHtml(page.goal||'')}</p><details class="storyboard-page-editor"><summary>编辑本页内容</summary><div class="storyboard-page-editor-fields"><label>页面标题<input data-storyboard-title value="${escapeHtml(page.title||'')}"></label><label>内部说明<textarea data-storyboard-goal rows="2">${escapeHtml(page.goal||'')}</textarea></label>${(page.content_blocks||[]).map(blockEditor).join('')}<div class="storyboard-block-add"><select data-add-storyboard-block-type>${cardBlockTypeOptions('text')}</select><button type="button" class="outline-button" data-add-storyboard-block>＋ 添加内容块</button></div><button type="button" class="outline-button" data-save-storyboard-page="${index+1}">保存本页修改</button></div></details></div><div class="storyboard-layout-control">${control}${decision.reason?`<small>${escapeHtml(decision.reason)}</small>`:''}</div></article>`;
  }).join(''):`<div class="empty-state">${selectedContentType==='event'?'根据事实基座生成 4～10 页事件卡片。':selectedContentType==='custom'?'根据自定义事实基座生成 4～10 页卡片。':'核验仓库后，AI 会自动规划 4～7 页卡片。'}</div>`;
}

async function confirmDiscardStoryboardEdits(){
  if(!storyboardDirty)return true;
  return confirmAction('故事板编辑器中有未保存的修改，继续操作将丢弃这些修改。是否继续？',{confirmText:'放弃修改'});
}

export async function openSocialEditor(id) {
  selectedId=Number(id); const data=await request(`/api/candidates/${selectedId}/card-editorial`);
  selectedContentType=data.contentType||'repository';
  selectedChannelMode=data.channelMode||'wechat';
  selectedCompositionMode=data.editorial?.composition_mode||'template';
  document.getElementById("social-editor-empty").hidden=true; document.getElementById("social-editor-fields").hidden=false;
  document.getElementById("social-editor-code").textContent=data.candidate.candidate_id; document.getElementById("social-editor-title").textContent=data.candidate.hotspot_title;
  const link=document.getElementById("social-repository-link"); const url=data.candidate.url||data.facts?.source_url||''; link.href=url;link.textContent=url||(selectedContentType==='event'?'尚无事件来源':selectedContentType==='custom'?'自定义图文 · 无外部来源':'尚无仓库地址');
  document.querySelectorAll(".social-editor-candidate").forEach((item)=>item.classList.toggle("active",Number(item.dataset.socialCandidate)===selectedId));
  document.querySelector('.social-editor-candidate.active')?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'nearest'});updateSocialTabControls();
  document.getElementById('social-facts-kicker').textContent=selectedContentType==='event'?'EVENT FACT BASE':selectedContentType==='custom'?'CUSTOM FACT BASE':'REPOSITORY FACTS';
  document.getElementById('social-facts-title').textContent=selectedContentType==='event'?'突发事件事实基座':selectedContentType==='custom'?`自定义事实基座（${selectedChannelMode==='xiaohongshu'?'小红书':'公众号'}）`:'仓库事实基座';
  const channelPicker=document.getElementById('social-channel')?.closest('label');
  const factsActions=document.getElementById('social-facts-title')?.closest('.workspace-head')?.querySelector(':scope>div:last-child');
  if(channelPicker&&factsActions&&!factsActions.contains(channelPicker))factsActions.prepend(channelPicker);
  const inspect=document.getElementById('inspect-repository'),reanalyze=document.getElementById('analyze-card-editorial');
  inspect.textContent=selectedContentType==='event'?'根据事实基座生成故事板':selectedContentType==='custom'?'根据事实基座生成故事板':'分析仓库并生成故事板';
  reanalyze.textContent='重新生成故事板';reanalyze.hidden=selectedContentType==='event'&&!data.editorial?.card_plan_json?.length;
  renderFacts(data.facts,data.eventAnalysis);renderScore(data.score);renderCardPlan(data.editorial?.card_plan_json,data.layoutDecisions);renderGate(data.gate);
  document.getElementById('social-channel').value=selectedChannelMode;document.getElementById('social-composition-mode').value=selectedCompositionMode;document.getElementById('social-layout-style').value=data.editorial?.layout_style||'auto';currentGroupLayout=data.editorial?.layout_style||'auto';document.getElementById('social-visual-style').value=data.editorial?.visual_style||'ice-blue';document.getElementById('social-visual-style').dispatchEvent(new Event('theme-ui-sync'));syncCompositionControls();await Promise.all([loadSocialSkillControls(data),loadDelivery(selectedId),loadSimilarSocialCards(selectedId)]);
}

async function analyzeEditorial(candidateId=selectedId) {
  if(!candidateId)return; const data=await request(`/api/candidates/${candidateId}/ai/card-editorial`,{method:'POST',body:JSON.stringify({
    stageSkills:selectedStageSkills(document.getElementById('social-stage-skills')),
  })});
  if(candidateId===selectedId){
    const reasoning=typeof data.reasoning==='string'&&data.reasoning.trim()?data.reasoning:'';
    renderCardPlan(data.editorial?.card_plan_json,data.layoutDecisions);
    const preview=document.getElementById('card-plan-preview');
    if(preview&&reasoning)preview.insertAdjacentHTML('afterbegin',`<details class="thinking-box"><summary>思考过程</summary><div class="thinking-text">${escapeHtml(reasoning)}</div></details>`);
    renderGate(data.gate);if(data.eventAnalysis)renderFacts(null,data.eventAnalysis);toast(selectedContentType==='event'?'AI 已根据突发事实基座生成事件故事板':selectedContentType==='custom'?'AI 已根据自定义事实基座生成故事板':'AI 已根据仓库事实生成卡片故事板');}return data;
}

function renderStoryboardLoading(message){document.getElementById("card-plan-preview").innerHTML=`<div class="storyboard-loading"><span class="storyboard-spinner"></span><div><b>${escapeHtml(message)}</b><small>${selectedContentType==='event'?'正在读取事实、主张、时间线和来源风险，请勿重复点击。':'正在读取 README、提取能力并规划逐页内容，请勿重复点击。'}</small></div></div>`;}

async function runStoryboard({inspect=false}={}){
  if(!selectedId)return;const candidateId=selectedId;const inspectButton=document.getElementById("inspect-repository");const analyzeButton=document.getElementById("analyze-card-editorial");
  const eventMode=selectedContentType==='event';const customMode=selectedContentType==='custom';const sourceButton=inspect?inspectButton:analyzeButton;const original=sourceButton.textContent;inspectButton.disabled=true;analyzeButton.disabled=true;sourceButton.textContent=eventMode?"正在规划事件故事板…":customMode?"正在规划故事板…":inspect?"正在分析 README…":"正在重新规划…";renderStoryboardLoading(eventMode?"正在根据事实基座生成事件故事板":customMode?"正在根据自定义事实基座生成故事板":inspect?"正在核验仓库并生成故事板":"正在根据已有事实重新生成故事板");
  try{if(inspect&&selectedContentType==='repository'){const data=await request(`/api/candidates/${candidateId}/repository/inspect`,{method:'POST',body:'{}'});if(candidateId===selectedId){renderFacts(data.facts);renderScore(data.score);renderGate(data.gate);}}await analyzeEditorial(candidateId);}catch(error){toast(error.message,'error');if(candidateId===selectedId)renderCardPlan(currentCardPlan,currentLayoutDecisions);}finally{inspectButton.disabled=false;analyzeButton.disabled=false;sourceButton.textContent=original;}
}

// 布局审计失败时定位到对应故事板页：解析「P\d+」页码，展开该页编辑器并滚动高亮，
// 让用户直接在「02 卡片故事板」中修改，而不是只看到一段报错文案。
function locateStoryboardPages(error) {
  const pages = [...String(error || '').matchAll(/P(\d+)/g)].map((match) => Number(match[1]));
  if (!pages.length) return;
  const container = document.getElementById('card-plan-preview');
  if (!container) return;
  const articles = pages.map((number) => container.querySelector(`[data-card-page="${number}"]`)).filter(Boolean);
  if (!articles.length) return;
  for (const article of articles) {
    const details = article.querySelector('details.storyboard-page-editor');
    if (details) details.open = true;
    article.classList.add('layout-failed-page');
    const summary = article.querySelector('details.storyboard-page-editor summary');
    if (summary && !summary.querySelector('.layout-failed-badge')) {
      const badge = document.createElement('em');
      badge.className = 'layout-failed-badge';
      badge.textContent = '布局审计未通过 · 修改本页后重新生成';
      summary.appendChild(badge);
    }
  }
  articles[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// 生成任务按候选追踪，按钮按当前选中候选渲染——页面级单按钮不再被多个候选的任务进度交替覆盖
const socialJobs = new Map();
function syncGenerateButton() {
  const generate = document.getElementById("generate-social-card"); if (!generate) return;
  const job = selectedId ? socialJobs.get(Number(selectedId)) : null;
  const active = job && (job.status === 'running' || job.status === 'queued');
  if (active) { generate.disabled = true; generate.textContent = job.status === 'queued' ? '排队等待执行…' : (job.progress || '图文任务执行中…'); return; }
  if (job && job.status === 'completed') { generate.textContent = '重新生成整组图文'; return; }
  if (!job) generate.textContent = '生成整组图文';
}
async function watchSocialJob(jobId, candidateId) {
  while (true) { await new Promise((resolve) => setTimeout(resolve, 2000)); const job = await request(`/api/jobs/${jobId}`);
    socialJobs.set(Number(candidateId), { status: job.status, progress: job.progress || '', error: job.error || '' });
    syncGenerateButton();
    const active = job.status === 'running' || job.status === 'queued'; if (active) continue;
    // 完成/失败提示只对当前选中的候选弹出；其余候选的任务安静落状态，切回时按钮自会反映
    if (Number(candidateId) === Number(selectedId)) { if (job.status === 'completed') { toast('图文生成完成，已输出 HTML 和逐页 PNG'); await loadDelivery(candidateId); } else { toast(`图文生成失败${job.error ? `：${job.error}` : ''}`); locateStoryboardPages(job.error); } }
    return;
  }
}

async function loadSocialEditor(view) {
  // 无参调用（如创建成功后刷新）保持当前模式，避免自定义/事件页被切回工具图文
  if(view)currentMode=view==='social-custom'?'custom':view==='social-event'?'event':'tools';
  applyModeLayout();
  setupSocialTabNavigation();
  const batch=state.batches.find((item)=>item.id===state.activeBatchId); if(!batch)return;
  const all=await request(`/api/batches/${encodeURIComponent(batch.id)}/candidates?track=social_cards`);
  const candidates=all.filter((item)=>candidateMode(item.output_mode)===currentMode);
  const layout=MODE_LAYOUT[currentMode]||MODE_LAYOUT.tools;
  const nav=document.getElementById("social-editor-candidates");
  nav.innerHTML=candidates.length?candidates.map((item)=>{const modeLabel=isCustomOutput(item.output_mode)?(item.output_mode==='xiaohongshu-custom-cards'?'自定义 · 小红书':'自定义 · 公众号'):isEventOutput(item.output_mode)?'事件图文':'';return `<button type="button" class="social-editor-candidate" data-social-candidate="${item.id}"><b>${escapeHtml(item.candidate_id)}</b><span>${escapeHtml(item.hotspot_title)}</span><em>${escapeHtml(modeLabel||item.repository_description||item.social_selection_reason||'暂无仓库描述')}</em><small>${escapeHtml(item.track_status||'pooled')}${item.social_selection_reason?` · ${escapeHtml(item.social_selection_reason)}`:''}</small></button>`;}).join(''):`<div class="empty-state">${layout.empty}</div>`;
  requestAnimationFrame(updateSocialTabControls);
  if(candidates.length){await openSocialEditor(selectedId&&candidates.some((x)=>x.id===selectedId)?selectedId:candidates[0].id);}
  else{selectedId=null;document.getElementById("social-editor-fields").hidden=true;const empty=document.getElementById("social-editor-empty");empty.innerHTML=layout.empty;empty.hidden=false;}
}

function freshButton(id){const current=document.getElementById(id);if(!current)return null;const fresh=current.cloneNode(true);current.replaceWith(fresh);return fresh;}

if(!window.__socialEditorCandidateBound){window.__socialEditorCandidateBound=true;
  document.addEventListener("click",async(event)=>{const candidate=event.target.closest("[data-social-candidate]");if(candidate)await openSocialEditor(Number(candidate.dataset.socialCandidate));});
}
if(!window.__socialPageLayoutBound){window.__socialPageLayoutBound=true;
  document.addEventListener('change',async(event)=>{
    const select=event.target.closest('[data-card-page-layout]');if(!select||!selectedId)return;
    const page=Number(select.dataset.cardPageLayout);
    if(!await confirmDiscardStoryboardEdits()){select.value=currentCardPlan[page-1]?.layout_style||'auto';return;}
    select.disabled=true;
    try{
      const data=await request(`/api/candidates/${selectedId}/card-pages/${page}/layout`,{method:'PUT',body:JSON.stringify({layout_style:select.value})});
      renderCardPlan(data.cardPlan,data.layoutDecisions);
    }catch(error){toast(error.message);renderCardPlan(currentCardPlan,currentLayoutDecisions);}
  });
}
if(!window.__socialPageEditorBound){window.__socialPageEditorBound=true;
  document.addEventListener('input',(event)=>{
    if(event.target.closest('.storyboard-page-editor'))storyboardDirty=true;
  });
  document.addEventListener('click',async(event)=>{
    const remove=event.target.closest('[data-remove-storyboard-block]');
    if(remove){remove.closest('[data-storyboard-block]')?.remove();storyboardDirty=true;return;}
    const add=event.target.closest('[data-add-storyboard-block]');
    if(add){
      const fields=add.closest('.storyboard-page-editor-fields');if(!fields)return;
      const type=fields.querySelector('[data-add-storyboard-block-type]')?.value||'text';
      const index=fields.querySelectorAll('[data-storyboard-block]').length;
      const div=document.createElement('div');div.innerHTML=cardBlockEditorHtml({type},index);
      fields.querySelector('[data-save-storyboard-page]')?.before(div.firstElementChild);
      storyboardDirty=true;
      return;
    }
    const button=event.target.closest('[data-save-storyboard-page]');if(!button||!selectedId)return;
    const pageNumber=Number(button.dataset.saveStoryboardPage),article=button.closest('[data-card-page]');
    const source=currentCardPlan[pageNumber-1];if(!source||!article)return;
    const contentBlocks=[];
    try{
      article.querySelectorAll('[data-storyboard-block]').forEach((node)=>{
        const type=node.querySelector('[data-storyboard-block-type]')?.value||'text';
        const block={type,title:node.querySelector('[data-storyboard-block-title]')?.value.trim()||''};
        const field=node.querySelector('[data-storyboard-block-content]');
        if(CARD_STRUCTURED_BLOCK_TYPES.has(type))Object.assign(block,JSON.parse(field.value||'{}'),{content:''});
        else block.content=field?.value.trim()||'';
        contentBlocks.push(block);
      });
    }catch{toast('结构化内容必须是有效 JSON');return;}
    const originalText=button.textContent;button.disabled=true;button.textContent='保存中…';
    try{
      const data=await request(`/api/candidates/${selectedId}/card-pages/${pageNumber}`,{method:'PUT',body:JSON.stringify({
        title:article.querySelector('[data-storyboard-title]')?.value||'',
        goal:article.querySelector('[data-storyboard-goal]')?.value||'',
        content_blocks:contentBlocks,
      })});
      renderCardPlan(data.cardPlan,data.layoutDecisions);renderGate(data.gate);
      toast('本页故事板已保存；生成图文时会整组重新渲染');
    }catch(error){toast(error.message);button.disabled=false;button.textContent=originalText;}
  });
  // 切换内容块类型：重渲染该块编辑器，保留标题；结构化/正文内容按新类型转换
  document.addEventListener('change',(event)=>{
    const select=event.target.closest('[data-storyboard-block-type]');if(!select)return;
    const fieldset=select.closest('[data-storyboard-block]');if(!fieldset)return;
    const type=select.value;
    const title=fieldset.querySelector('[data-storyboard-block-title]')?.value||'';
    const currentValue=fieldset.querySelector('[data-storyboard-block-content]')?.value||'';
    let block={type,title};
    if(CARD_STRUCTURED_BLOCK_TYPES.has(type)){
      try{Object.assign(block,JSON.parse(currentValue||'{}'));}catch{block.items=[];block.headers=[];block.rows=[];}
    }else{block.content=currentValue;}
    const div=document.createElement('div');div.innerHTML=cardBlockEditorHtml(block,Number(fieldset.dataset.storyboardBlock));
    fieldset.replaceWith(div.firstElementChild);
    storyboardDirty=true;
  });
}
if(!window.__socialDeliveryBound){
  window.__socialDeliveryBound=true;
  document.addEventListener('click',(event)=>{
    const image=event.target.closest('[data-social-image]');
    if(image){deliveryIndex=Number(image.dataset.socialImage);renderDeliveryImage();}
    const tab=event.target.closest('[data-social-proof]');
    if(tab){proofTab=tab.dataset.socialProof;renderProof();}
    // 翻页按钮在视图加载前可能尚未渲染，顶层 ?. 绑定会变成死按钮，统一走 document 委托
    if(event.target.closest('#social-gallery-prev')){deliveryIndex-=1;renderDeliveryImage();}
    if(event.target.closest('#social-gallery-next')){deliveryIndex+=1;renderDeliveryImage();}
  });
}
if(!window.__socialThemeBound){
  window.__socialThemeBound=true;
  document.getElementById('social-visual-style')?.addEventListener('change',async(event)=>{
    if(!selectedId)return;
    try{
      await request(`/api/candidates/${selectedId}/card-editorial`,{method:'PUT',body:JSON.stringify({visual_style:event.target.value})});
    }catch(error){toast(error.message);}
  });
}
if(!window.__socialCompositionBound){
  window.__socialCompositionBound=true;
  document.getElementById('social-composition-mode')?.addEventListener('change',async(event)=>{
    if(!selectedId)return;
    const previous=selectedCompositionMode;
    if(!await confirmDiscardStoryboardEdits()){event.target.value=previous;return;}
    selectedCompositionMode=event.target.value;
    syncCompositionControls();
    try{
      const data=await request(`/api/candidates/${selectedId}/card-editorial`,{method:'PUT',body:JSON.stringify({composition_mode:selectedCompositionMode})});
      renderCardPlan(data.cardPlan,data.layoutDecisions);
    }catch(error){
      selectedCompositionMode=previous;
      event.target.value=previous;
      syncCompositionControls();
      toast(error.message);
    }
  });
}
if(!window.__socialLayoutBound){
  window.__socialLayoutBound=true;
  document.getElementById('social-layout-style')?.addEventListener('change',async(event)=>{
    if(!selectedId)return;
    if(!await confirmDiscardStoryboardEdits()){event.target.value=currentGroupLayout;return;}
    try{
      const data=await request(`/api/candidates/${selectedId}/card-editorial`,{method:'PUT',body:JSON.stringify({layout_style:event.target.value})});
      currentGroupLayout=event.target.value;
      renderCardPlan(data.cardPlan,data.layoutDecisions);
    }catch(error){event.target.value=currentGroupLayout;toast(error.message);}
  });
}
if(!window.__socialChannelBound){
  window.__socialChannelBound=true;
  document.getElementById('social-channel')?.addEventListener('change',async(event)=>{
    if(!selectedId)return;
    const channel=event.target.value;
    if(!await confirmDiscardStoryboardEdits()){event.target.value=selectedChannelMode;return;}
    try{
      const data=await request(`/api/candidates/${selectedId}/card-channel`,{method:'POST',body:JSON.stringify({channel})});
      selectedChannelMode=data.channelMode;
      renderCardPlan(currentCardPlan,data.layoutDecisions);
      if(selectedContentType==='custom')document.getElementById('social-facts-title').textContent=`自定义事实基座（${selectedChannelMode==='xiaohongshu'?'小红书':'公众号'}）`;
    }catch(error){event.target.value=selectedChannelMode;toast(error.message);}
  });
}
if(!window.__socialSkillSelectionBound){window.__socialSkillSelectionBound=true;
  document.getElementById('social-stage-skills')?.addEventListener('change',(event)=>{
    if(!event.target.closest('[data-stage-skill]'))return;
    updateSocialSkillSummary();
    if(currentCardPlan.length)toast('故事板技能已切换；点击“重新生成故事板”后生效，现有逐页编辑将被替换');
  });
  document.getElementById('reset-social-skills')?.addEventListener('click',()=>{
    document.querySelectorAll('#social-stage-skills [data-stage-skill]').forEach((select)=>{select.value='';});
    updateSocialSkillSummary();toast('已恢复当前图文入口的默认技能');
  });
  document.getElementById('close-social-skills')?.addEventListener('click',()=>{
    document.querySelector('.social-skill-settings')?.removeAttribute('open');
  });
}
const inspectButton=freshButton("inspect-repository");
inspectButton?.addEventListener("click",()=>runStoryboard({inspect:true}));
const analyzeButton=freshButton("analyze-card-editorial");
analyzeButton?.addEventListener("click",()=>runStoryboard());
const generateButton=freshButton("generate-social-card");
generateButton?.addEventListener("click", async () => { if (!selectedId) return; const candidateId = Number(selectedId); if (delivery?.ready && !await confirmAction("重新生成图文将覆盖当前已生成的整组交付物（HTML 与逐页 PNG），是否继续？", { confirmText: "重新生成" })) return; socialJobs.set(candidateId, { status: 'running', progress: '正在启动…' }); syncGenerateButton(); try { const job = await request(`/api/candidates/${candidateId}/ai/social-card`, { method: 'POST', body: '{}' }); socialJobs.set(candidateId, { status: 'running', progress: '图文任务执行中…' }); syncGenerateButton(); toast("图文生成任务已启动，可在任务日志查看进度"); watchSocialJob(job.id, candidateId).catch((error) => { socialJobs.set(candidateId, { status: 'failed', error: error.message }); syncGenerateButton(); toast(error.message); }); } catch (error) { socialJobs.delete(candidateId); syncGenerateButton(); renderGate(lastGate); toast(error.message); } });

window.openSocialEditor=openSocialEditor;

// 创建自定义图文（待办 1+6：教程/清单/观点 × 公众号/小红书）
// 对话式策划：AI 通过多轮对话把方案填进下方表单，表单始终可手改，创建仍走原有路由与门禁
function bindCustomSocialForm(){
  const toggle=document.getElementById('create-custom-social'),panel=document.getElementById('custom-social-panel');
  if(!toggle||!panel||toggle.dataset.bound==='true')return;toggle.dataset.bound='true';
  const typeSelect=document.getElementById('custom-content-type');
  const syncTypeFields=()=>{const type=typeSelect.value;panel.querySelectorAll('[data-custom-only]').forEach((node)=>{node.hidden=node.dataset.customOnly!==type;});};
  const chat={history:[]};
  const lines=(id)=>document.getElementById(id).value.split(/\r?\n/).map((item)=>item.trim()).filter(Boolean);
  const collectDraft=()=>({
    content_type:typeSelect.value,channel:document.getElementById('custom-channel').value,
    topic:document.getElementById('custom-topic').value.trim(),audience:document.getElementById('custom-audience').value.trim(),
    scenario:document.getElementById('custom-scenario').value.trim(),thesis:document.getElementById('custom-thesis').value.trim(),
    points:lines('custom-points'),steps:lines('custom-steps'),items:lines('custom-items'),materialUrls:lines('custom-materials'),
    limitations:document.getElementById('custom-limitations').value.trim(),expected_pages:Number(document.getElementById('custom-expected-pages').value)||6,
  });
  const applyFormUpdates=(updates)=>{
    if(!updates||typeof updates!=='object')return;
    const set=(id,value)=>{if(value==null||value==='')return;const el=document.getElementById(id);if(el)el.value=value;};
    const setLines=(id,value)=>{const text=Array.isArray(value)?value.join('\n'):String(value||'');if(text.trim())set(id,text);};
    if(updates.content_type){set('custom-content-type',updates.content_type);syncTypeFields();}
    set('custom-channel',updates.channel);
    set('custom-topic',updates.topic);set('custom-audience',updates.audience);set('custom-scenario',updates.scenario);
    set('custom-thesis',updates.thesis);set('custom-limitations',updates.limitations);
    setLines('custom-points',updates.points);setLines('custom-steps',updates.steps);
    setLines('custom-items',updates.items);setLines('custom-materials',updates.materialUrls);
    if(updates.expected_pages)set('custom-expected-pages',updates.expected_pages);
  };
  async function sendCustomChat(){
    const batch=state.batches.find((item)=>item.id===state.activeBatchId);
    if(!batch){toast('请先选择批次');return;}
    const input=document.getElementById('custom-chat-input');
    const answer=input?.value?.trim()||'';
    const button=document.getElementById('custom-chat-send');
    const messages=document.getElementById('custom-chat-messages');
    if(!messages||!button)return;
    messages.querySelector('.editorial-chat-empty')?.remove();
    if(answer)messages.insertAdjacentHTML('beforeend',`<div class="editorial-message user"><b>你</b><p>${escapeHtml(answer).replaceAll('\n','<br>')}</p></div>`);
    await streamChat({
      url:`/api/batches/${encodeURIComponent(batch.id)}/custom-social-chat/stream`,
      body:{provider:document.getElementById('custom-chat-provider')?.value||'',answer,draft:collectDraft(),history:chat.history},
      messages,
      button,
      busyLabel:'AI 正在回应…',
      doneLabel:'发送',
      title:'AI 策划',
      errorLabel:'策划助手',
      onDone:(done)=>{
        if(input)input.value='';
        if(answer)chat.history.push({role:'user',content:answer});
        if(done.reply)chat.history.push({role:'assistant',content:done.reply});
        applyFormUpdates(done.formUpdates);
        if(done.ready){const details=document.getElementById('custom-social-form-details');if(details)details.open=true;toast('方案已齐备，请检查下方表单后点击创建');}
      },
    });
  }
  // 创建成功后重置面板：清空表单与对话，折叠表单区，下次打开是全新状态
  const resetCustomPanel=()=>{
    chat.history=[];
    typeSelect.value='tutorial';syncTypeFields();
    document.getElementById('custom-channel').value='wechat';
    for(const id of ['custom-topic','custom-audience','custom-scenario','custom-thesis','custom-points','custom-steps','custom-items','custom-materials','custom-limitations','custom-chat-input']){const el=document.getElementById(id);if(el)el.value='';}
    document.getElementById('custom-expected-pages').value='6';
    const details=document.getElementById('custom-social-form-details');if(details)details.open=false;
    const messages=document.getElementById('custom-chat-messages');
    if(messages)messages.innerHTML='<div class="editorial-chat-empty">说说你想做的图文主题，AI 会逐个问题帮你补齐方案并填入下方表单。</div>';
  };
  toggle.addEventListener('click',()=>{
    panel.hidden=!panel.hidden;syncTypeFields();
    if(!panel.hidden){
      const prov=document.getElementById('custom-chat-provider');
      if(prov)prov.innerHTML=providerOptions(state.models?.providers?.find((p)=>p.configured)?.name||state.models?.defaultProvider||'');
      chat.history=[];
      const messages=document.getElementById('custom-chat-messages');
      if(messages)messages.innerHTML='<div class="editorial-chat-empty">说说你想做的图文主题，AI 会逐个问题帮你补齐方案并填入下方表单。</div>';
      sendCustomChat();
    }
  });
  typeSelect.addEventListener('change',syncTypeFields);
  document.getElementById('custom-chat-send')?.addEventListener('click',sendCustomChat);
  document.getElementById('custom-social-cancel')?.addEventListener('click',()=>{panel.hidden=true;});
  document.getElementById('custom-social-submit')?.addEventListener('click',async()=>{
    const batch=state.batches.find((item)=>item.id===state.activeBatchId);
    if(!batch){toast('请先选择批次');return;}
    const submit=document.getElementById('custom-social-submit');submit.disabled=true;submit.textContent='正在创建并抓取素材…';
    try{
      const data=await request(`/api/batches/${encodeURIComponent(batch.id)}/custom-social-candidates`,{method:'POST',body:JSON.stringify({
        content_type:typeSelect.value,channel:document.getElementById('custom-channel').value,
        topic:document.getElementById('custom-topic').value,audience:document.getElementById('custom-audience').value,
        scenario:document.getElementById('custom-scenario').value,thesis:document.getElementById('custom-thesis').value,
        points:document.getElementById('custom-points').value,steps:document.getElementById('custom-steps').value,
        items:document.getElementById('custom-items').value,materialUrls:document.getElementById('custom-materials').value,
        limitations:document.getElementById('custom-limitations').value,expected_pages:Number(document.getElementById('custom-expected-pages').value)||6,
      })});
      panel.hidden=true;resetCustomPanel();toast('自定义图文已创建');
      await loadSocialEditor();
      if(data.candidate?.id)await openSocialEditor(data.candidate.id);
    }catch(error){toast(error.message);}
    finally{submit.disabled=false;submit.textContent='创建并进入图文编辑室';}
  });
}
bindCustomSocialForm();

function bindRepositorySocialForm(){
  const toggle=document.getElementById('create-repository-social');
  const panel=document.getElementById('repository-social-panel');
  const input=document.getElementById('repository-social-url');
  const hint=document.getElementById('repository-social-hint');
  const submit=document.getElementById('repository-social-submit');
  if(!toggle||!panel||!input||!hint||!submit)return;
  const DEFAULT_HINT='粘贴 GitHub 仓库地址，核验与故事板流程与自动候选一致';
  let channel='wechat';
  const parseRepo=(value)=>{
    try{
      const url=new URL(String(value||'').trim());
      if(url.hostname.toLowerCase()!=='github.com')return null;
      const [owner,repo]=url.pathname.split('/').filter(Boolean);
      if(!owner||!repo)return null;
      return `${owner}/${repo.replace(/\.git$/i,'')}`;
    }catch{return null;}
  };
  const validate=()=>{
    const raw=input.value.trim();
    const repo=parseRepo(raw);
    input.classList.toggle('invalid',Boolean(raw)&&!repo);
    submit.disabled=!repo;
    hint.className='repository-quickadd-hint';
    if(!raw)hint.textContent=DEFAULT_HINT;
    else if(repo){hint.textContent=`✓ 将添加仓库 ${repo}`;hint.classList.add('ok');}
    else{hint.textContent='地址格式应为 https://github.com/owner/repo';hint.classList.add('error');}
    return repo;
  };
  const close=()=>{panel.hidden=true;input.value='';validate();toggle.focus();};
  toggle.addEventListener('click',()=>{
    panel.hidden=!panel.hidden;
    if(!panel.hidden){validate();input.focus();}
  });
  panel.querySelectorAll('.repository-channel-segment button').forEach((button)=>{
    button.addEventListener('click',()=>{
      channel=button.dataset.channel;
      panel.querySelectorAll('.repository-channel-segment button').forEach((item)=>item.classList.toggle('active',item===button));
    });
  });
  input.addEventListener('input',validate);
  panel.addEventListener('keydown',(event)=>{
    if(event.key==='Escape'){event.preventDefault();close();}
    if(event.key==='Enter'&&!submit.disabled){event.preventDefault();submit.click();}
  });
  document.getElementById('repository-social-cancel')?.addEventListener('click',close);
  submit.addEventListener('click',async()=>{
    const batch=state.batches.find((item)=>item.id===state.activeBatchId);
    if(!batch){toast('请先选择批次');return;}
    const repo=validate();if(!repo)return;
    submit.disabled=true;submit.textContent='正在添加…';
    try{
      const data=await request(`/api/batches/${encodeURIComponent(batch.id)}/repository-candidates`,{method:'POST',body:JSON.stringify({url:input.value.trim(),channel})});
      panel.hidden=true;input.value='';validate();
      toast('仓库图文已添加，请执行仓库核验后规划故事板');
      await loadSocialEditor();
      if(data.candidate?.id)await openSocialEditor(data.candidate.id);
    }catch(error){
      hint.textContent=error.message;hint.className='repository-quickadd-hint error';
      toast(error.message);
    }
    finally{submit.disabled=!parseRepo(input.value.trim());submit.textContent='添加';}
  });
}
bindRepositorySocialForm();

export default loadSocialEditor;
