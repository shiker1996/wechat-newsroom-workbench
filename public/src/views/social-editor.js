import { state } from "../core/state.js";
import { request } from "../core/http.js";
import { streamChat } from "../core/stream-chat.js";
import { escapeHtml, toast, providerOptions, confirmAction } from "../core/ui.js";
import { loadStageSkillControls, selectedStageSkills } from "../core/skill-selection.js";
import { candidateMode, cardBlockEditorHtml, cardBlockTypeOptions, isCustomOutput, isEventOutput, isStructuredCardBlockType, socialFactsHtml, socialScoreView } from "./social-editor-model.js";

let selectedId = null;
let delivery=null;let deliveryIndex=0;let proofTab='copy';
let selectedContentType='repository';
let selectedChannelMode='wechat';
let selectedCompositionMode='smart';
let currentGroupLayout='auto';
let currentCardPlan=[];
let currentLayoutDecisions=[];
let currentLayoutReportPages=[];
let socialSkillSlots=null;
let storyboardThemeState=null;
let storyboardReflowPreview=null;
let storyboardRenderState=null;
let currentContentPlanAdjustments=null;
let currentFactIndex=null;
// 故事板 <details> 编辑器存在未保存修改时置位；任何 renderCardPlan 重建都会丢失这些修改，
// 触发重建的操作（整组/逐页版式、构图模式、渠道）需先 confirmAction 警告
let storyboardDirty=false;

const STORYBOARD_AI_TIMEOUT_MS=180000;
async function requestStoryboardAi(url, options={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),STORYBOARD_AI_TIMEOUT_MS);
  try{return await request(url,{...options,signal:controller.signal});}
  catch(error){if(error?.name==='AbortError')throw new Error('单页 AI 修复超过 180 秒，未修改故事板；请稍后重试。');throw error;}
  finally{clearTimeout(timer);}
}

const CARD_LAYOUT_LABELS={auto:'自动推荐',poster:'海报大字',editorial:'杂志分栏',data:'数据报告',checklist:'卡片清单',steps:'教程步骤',minimal:'极简留白'};
const CARD_LAYOUT_STATUS={recommended:'自动推荐',storyboard:'故事板指定',manual:'手动指定',group:'整组指定',fallback:'自动降级'};
const CARD_ROLE_LABELS={cover:'封面',concept:'概念',feature:'功能',steps:'步骤',data:'数据',compare:'对比',evidence:'证据',timeline:'时间线',risk:'风险',ending:'结尾'};
const CARD_COMPOSITION_LABELS={'hero-stack':'主视觉堆叠','hero-frame':'主视觉框景','concept-split':'概念分栏','concept-offset':'概念错位','feature-ledger':'功能账本','feature-stack':'功能纵列','sequence-rail':'步骤轨道','sequence-offset':'步骤错列','metric-board':'数据面板','metric-split':'数据分栏','comparison-board':'对比面板','comparison-split':'对比分栏','evidence-ledger':'证据账本','evidence-frame':'证据框景','timeline-rail':'时间轨道','timeline-offset':'时间错列','risk-sidebar':'风险侧栏','risk-frame':'风险框景','closing-focus':'收束聚焦','closing-note':'收束便笺'};
const CARD_DECORATION_LABELS={none:'无装饰',orbit:'轨道圆环','index-line':'索引线',stamp:'编辑戳记'};
const CARD_OVERLAP_LABELS={none:'标准层级','title-card':'标题叠卡','accent-edge':'边缘错位'};
const CARD_AUDIT_ISSUE_LABELS={underfilled:'内容偏少',overfilled:'内容过满',overflow:'内容溢出',clipped:'内容被裁切',horizontal_overflow:'横向溢出'};

function renderStoryboardThemeState(state) {
  storyboardThemeState=state||null;
  const status=document.getElementById('social-storyboard-theme-status');
  if(!status)return;
  if(!state||state.status==='empty'){status.hidden=true;status.textContent='';status.className='storyboard-theme-status';return;}
  const copy={
    current:'当前故事板与所选主题模板一致，可直接生成图文。',
    'render-only':'已切换同模板主题，故事板内容可复用，生成图文时会直接换肤渲染。',
    legacy:'这是历史故事板，未记录主题快照，可直接按当前主题渲染。',
    'needs-storyboard':'当前主题或渠道改变了模板能力，请先重新生成故事板，再生成图文。',
  }[state.status]||state.reason||'';
  status.hidden=!copy;
  status.className=`storyboard-theme-status ${state.status}`;
  status.textContent=copy;
  const regenerate=document.getElementById('analyze-card-editorial');
  if(regenerate&&state.status==='needs-storyboard')regenerate.textContent='重新生成故事板（必需）';
  else if(regenerate)regenerate.textContent=currentCardPlan.length?'重新生成故事板':'生成故事板';
}

function syncStoryboardActionLabels() {
  const inspect=document.getElementById('inspect-repository');
  const generate=document.getElementById('analyze-card-editorial');
  if(inspect){
    inspect.hidden=selectedContentType!=='repository';
    inspect.textContent='分析仓库';
  }
  if(generate&&storyboardThemeState?.status!=='needs-storyboard')generate.textContent=currentCardPlan.length?'重新生成故事板':'生成故事板';
}

function syncCompositionControls(){
  const picker=document.getElementById('social-template-picker');
  if(picker)picker.hidden=selectedCompositionMode==='smart';
}

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
  const recommendedSkillId=selectedContentType==='event'?(data.candidate?.content_class==='open_source_technology'?'open-source-technology-storyboard':data.candidate?.content_class==='open_source_trend'?'open-source-trend-storyboard':'event-card-storyboard'):'';
  socialSkillSlots=await loadStageSkillControls(
    document.getElementById('social-stage-skills'),
    `/api/creation-entry-points/${encodeURIComponent(entryPoint)}/social-card-stage-skills?contentType=${encodeURIComponent(contentType)}&recommendedSkillId=${encodeURIComponent(recommendedSkillId)}`,
  );
  updateSocialSkillSummary();
}

// 工具图文 / 自定义图文 / 事件图文三个导航入口共用本模块，以 currentMode 区分
let currentMode='tools';
const MODE_LAYOUT={
  tools:{empty:'当前批次没有工具图文候选。<a href="#overview">前往热点全景，将合适事件加入图文池</a>'},
  custom:{empty:'当前批次没有自定义图文，请点击上方「创建自定义图文」添加。'},
  event:{empty:'当前批次没有事件图文候选。<a href="#overview">前往热点全景，将合适事件加入图文池</a>'},
};
function applyModeLayout(){
  const layout=MODE_LAYOUT[currentMode]||MODE_LAYOUT.tools;
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

function factCandidateLabel(factId){
  const candidate=(currentFactIndex?.candidates||[]).find((item)=>String(item?.id)===String(factId));
  if(!candidate)return String(factId||'未知事实');
  const raw=candidate.label&&candidate.text?`${candidate.label}：${candidate.text}`:candidate.text||candidate.label||candidate.id;
  const label=String(raw).replace(/!?(?:\[[^\]]*\])\([^)]*\)/g,'').replace(/`+/g,'').replace(/\s+/g,' ').trim();
  return label.slice(0,96);
}
function adjustmentSourceLabel(source){
  if(source==='deterministic-fact-supplement')return '程序自动补充';
  if(source==='ai-content-planner')return 'AI 内容计划';
  if(source==='programmatic-repair')return '程序结构修复';
  return source?'程序调整':'调整';
}
function adjustmentOperationLabel(operation){
  if(operation?.op==='add_fact_block'){
    const facts=(operation.fact_ids||operation.block?.fact_ids||[]).map(factCandidateLabel).slice(0,2);
    const slot=operation.slot_id||operation.block?.supplement_slot_id||'未命名槽位';
    const sources=(operation.source_refs||operation.block?.source_refs||[]).length;
    return `P${operation.page||operation.target_page||'?'} · 补充 ${slot}${facts.length?` · ${facts.join('；')}`:''}${sources?` · ${sources} 个来源`:''}`;
  }
  if(operation?.op==='move_block')return `移动内容块 P${operation.from_page||'?'}→P${operation.to_page||'?'}`;
  if(operation?.op==='merge_pages')return `合并页面 ${(operation.pages||[]).join(' / ')}`;
  if(operation?.op==='split_page')return `拆分 P${operation.page||'?'}`;
  return operation?.op||'调整';
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
  currentFactIndex=data.factIndex||currentFactIndex;
  const panel=document.getElementById('social-delivery');
  panel.hidden=!data.ready;
  if(!data.ready)return;
  deliveryIndex=0;
  const metricRate=(value)=>Number.isFinite(Number(value))?`${Math.round(Number(value)*100)}%`:'—';
  const metricLabel=data.templateMetrics?.renderedTemplate?.id?` · 模板 ${data.templateMetrics.renderedTemplate.id}${data.templateMetrics.fallback?'（回退）':''}`:'';
  const metricSummary=data.templateStats?.usageCount?` · 通过率 ${metricRate(data.templateStats.layoutPassRate)} · 过空 ${metricRate(data.templateStats.underfilledRate)} · 溢出 ${metricRate(data.templateStats.overflowRate)}`:'';
  const planSummary=data.contentPlanAdjustments?.rounds?.length?` · 内容计划调整 ${data.contentPlanAdjustments.rounds.length} 轮`:'';
  document.getElementById('social-delivery-meta').textContent=`${data.images.length} 张 · 布局审计${data.layout?.valid?'通过':'待确认'} · 交付门禁${data.delivery?.valid?'通过':'待确认'}${metricLabel}${metricSummary}${planSummary}`;
  document.getElementById('social-open-html').href=data.htmlUrl;
  document.getElementById('social-download-all').href=data.bundleUrl;
  document.getElementById('social-gallery-film').innerHTML=data.images.map((image,index)=>`<button type="button" data-social-image="${index}" aria-label="查看第 ${index+1} 张图文"><img src="${image.url}?s=${image.size}" alt="第 ${index+1} 张缩略图"><span>${String(index+1).padStart(2,'0')}</span></button>`).join('');
  renderDeliveryImage();
  renderProof();
}

let lastGate=null;
function renderGate(gate) {
  lastGate=gate;  const themeBlocked=storyboardThemeState?.status==='needs-storyboard';document.getElementById("card-ready-title").textContent=themeBlocked?"请先重新生成故事板":gate.ready?"故事板已就绪":selectedContentType==='event'?"请先生成事件故事板":selectedContentType==='custom'?"请先完善自定义事实基座":"请先分析仓库，再生成故事板";
  const generate=document.getElementById("generate-social-card");
  generate.disabled=!gate.ready||themeBlocked;generate.dataset.ready=String(gate.ready);
  generate.title=themeBlocked?(storyboardThemeState.reason||'当前主题模板能力与故事板不一致'):gate.ready?"根据当前卡片故事板开始生成":selectedContentType==='event'?"请先根据事实基座生成事件故事板":selectedContentType==='custom'?"门禁项全部通过后才能生成图文":"请先分析仓库，再生成故事板";
  syncGenerateButton();
}

function renderFacts(facts,eventAnalysis) {
  document.getElementById("repository-facts").innerHTML=socialFactsHtml({contentType:selectedContentType,channelMode:selectedChannelMode,facts,eventAnalysis});
}

function renderScore(score) {
  const view=socialScoreView(score,selectedContentType);
  document.getElementById("social-fit-score").textContent=view.finalScore;
  document.getElementById("social-score-parts").innerHTML=view.partsHtml;
}

async function loadSimilarSocialCards(candidateId){const container=document.getElementById('similar-social-cards');if(!container)return;container.hidden=true;container.innerHTML='';try{const items=await request(`/api/candidates/${candidateId}/similar-social`);if(candidateId!==selectedId||!items.length)return;container.innerHTML=`<b>历史图文覆盖</b>${items.map((item)=>`<div><button type="button" class="inline-button" data-cal-social="${item.candidateRowId}" title="打开历史图文">${escapeHtml(item.title||item.candidateId)}</button> <small>${escapeHtml(item.batchDate||'')} · ${escapeHtml(item.reason||'相似内容')}</small></div>`).join('')}`;container.hidden=false;}catch{container.hidden=true;}}

function renderCardPlan(value,decisions=currentLayoutDecisions,layoutReportPages=currentLayoutReportPages,reflowPreview=undefined,renderState=undefined) {
  let plan=[];try{plan=Array.isArray(value)?value:JSON.parse(value||'[]');}catch{}
  currentCardPlan=plan;currentLayoutDecisions=Array.isArray(decisions)?decisions:[];currentLayoutReportPages=Array.isArray(layoutReportPages)?layoutReportPages:currentLayoutReportPages;storyboardDirty=false;
  if(reflowPreview!==undefined)storyboardReflowPreview=reflowPreview;
  if(renderState!==undefined)storyboardRenderState=renderState;
  const options=(selected)=>Object.entries(CARD_LAYOUT_LABELS).map(([value,label])=>`<option value="${value}"${value===selected?' selected':''}>${label}</option>`).join('');
  const blockEditor=(block,blockIndex)=>cardBlockEditorHtml(block,blockIndex);
  const preview=storyboardReflowPreview?.type==='storyboard-restructure'?`<div class="storyboard-reflow-preview" role="status"><div><b>故事板已调整，等待整组重渲染</b><span>页面 ${storyboardReflowPreview.beforePageCount} → ${storyboardReflowPreview.afterPageCount}${storyboardReflowPreview.pageDelta>0?` · 新增 ${storyboardReflowPreview.pageDelta} 个续页`:''}。HTML 与 PNG 尚未更新。</span></div><div class="storyboard-reflow-preview-pages">${(storyboardReflowPreview.addedPages||[]).map((item)=>`<span>P${item.page} · ${escapeHtml(item.title||'续页')}</span>`).join('')}</div><button type="button" class="text-button" data-dismiss-storyboard-preview>知道了</button></div>`:'';
  const adjustmentSummary=currentContentPlanAdjustments?.rounds?.length?`<div class="storyboard-reflow-preview" role="status"><div><b>内容计划调整记录</b><span>已执行 ${currentContentPlanAdjustments.rounds.length} 轮；每轮最多 4 个受控操作，结果已重新编译并审计。</span></div><div class="storyboard-reflow-preview-pages">${currentContentPlanAdjustments.rounds.flatMap((round)=>(round.operations||[]).map((operation)=>({operation,source:round.source,round:round.round}))).slice(0,8).map(({operation,source,round})=>{const label=`${adjustmentSourceLabel(source)} · 第${round||'?'}轮 · ${adjustmentOperationLabel(operation)}`;return `<span title="${escapeHtml(label)}">${escapeHtml(label)}</span>`;}).join('')}</div></div>`:'';
  document.getElementById("card-plan-preview").innerHTML=adjustmentSummary+preview+(plan.length?plan.map((page,index)=>{
    const decision=currentLayoutDecisions[index]||{layout:page.layout_style||'auto',source:page.layout_style&&page.layout_style!=='auto'?'manual':'recommended',reason:''};
    const layoutReport=currentLayoutReportPages[index]||null;
    const issues=Array.isArray(layoutReport?.issues)?layoutReport.issues:[];
    const hasSplittableBlock=(page.content_blocks||[]).some((block)=>['list','steps','timeline','scenes','stats','compare'].includes(block?.type)&&((Array.isArray(block?.items)&&block.items.length>=2)||(Array.isArray(block?.rows)&&block.rows.length>=2)||block?.type==='list'));
    const structuralProblem=issues.some((issue)=>['overflow','clipped','horizontal_overflow','invalid_page_grid_structure','missing_content_stack','empty_page_body'].includes(issue));
    const structuralIssue=structuralProblem&&hasSplittableBlock;
    const editMode=structuralIssue?'restructure':issues.includes('overfilled')||structuralProblem?'compress':issues.includes('underfilled')?'expand':issues.includes('text_too_small')?'compress':null;
    const editLabel=editMode==='restructure'?'调整故事板 / 拆分本页':editMode==='compress'?'AI 缩写本页':'AI 扩写本页';
    const auditMeta=layoutReport?`布局审计 · 利用率 ${Math.round(Number(layoutReport.utilization)||0)}%${issues.length?` · ${issues.map((issue)=>CARD_AUDIT_ISSUE_LABELS[issue]||issue).join('、')}`:' · 正常'}`:'尚无布局审计 · 生成后按结果提供扩写或缩写';
    const aiEditButton=editMode?`<button type="button" class="outline-button storyboard-ai-edit storyboard-ai-${editMode}" data-regenerate-storyboard-page="${index+1}" data-regenerate-mode="${editMode}">${editLabel}</button>`:'';
    const groupId=page.page_group_id?String(page.page_group_id):'';
    const groupPages=groupId?plan.filter((item)=>String(item?.page_group_id||'')===groupId):[];
    const continuationIndex=Number(page.continuation_index)||0;
    const continuationOf=Number(page.continuation_of)||0;
    const continuationBadge=groupPages.length>1?`<span class="storyboard-continuation-badge">${continuationIndex>1?`P${continuationOf||index+1} 续页 ${continuationIndex}/${groupPages.length}`:`内容组 ${continuationIndex||1}/${groupPages.length}`}</span>`:'';
    const aiEditAction=editMode?`<div class="storyboard-page-ai-action"><span data-storyboard-ai-status>${editMode==='restructure'?'本页存在结构性溢出，建议按完整条目拆页':editMode==='compress'?'本页内容过满，建议先缩短文字':'本页内容偏少，建议结合素材扩写'}</span>${aiEditButton}</div>`:'';
    const selected=page.layout_style||'auto';
    const control=decision.mode==='smart'
      ? `<span class="layout-status ${escapeHtml(decision.source||'recommended')}">智能构图 · ${escapeHtml(CARD_ROLE_LABELS[decision.role]||decision.role||'内容')} · ${escapeHtml(CARD_COMPOSITION_LABELS[decision.composition?.id]||decision.composition?.id||'默认构图')} · 变体 ${(decision.variantIndex??0)+1}/${decision.variantCount||1}</span><small>${escapeHtml(CARD_DECORATION_LABELS[decision.composition?.decoration]||'无装饰')} · ${escapeHtml(CARD_OVERLAP_LABELS[decision.composition?.overlap]||'标准层级')}</small>`
      : `<label>页面版式<select data-card-page-layout="${index+1}">${options(selected)}</select></label><span class="layout-status ${escapeHtml(decision.source||'recommended')}">${escapeHtml(CARD_LAYOUT_STATUS[decision.source]||'自动推荐')} · ${escapeHtml(CARD_LAYOUT_LABELS[decision.layout]||decision.layout||'')}</span>`;
    return `<article data-card-page="${index+1}"><b>${index+1}</b><div class="storyboard-page-copy"><small>${escapeHtml(page.kind||'content')} ${continuationBadge}</small><h4>${escapeHtml(page.title||'未命名页面')}</h4><p>${escapeHtml(page.goal||'')}</p>${aiEditAction}<details class="storyboard-page-editor"><summary>编辑本页内容</summary><div class="storyboard-page-editor-fields"><label>页面标题<input data-storyboard-title value="${escapeHtml(page.title||'')}"></label><label>内部说明<textarea data-storyboard-goal rows="2">${escapeHtml(page.goal||'')}</textarea></label>${(page.content_blocks||[]).map(blockEditor).join('')}<div class="storyboard-block-add"><select data-add-storyboard-block-type>${cardBlockTypeOptions('text')}</select><button type="button" class="outline-button" data-add-storyboard-block>＋ 添加内容块</button></div><div class="storyboard-block-add"><button type="button" class="outline-button" data-save-storyboard-page="${index+1}">保存本页修改</button></div><small>${auditMeta} · 会读取完整事实基座和原始素材；不会改动其他页。</small></div></details></div><div class="storyboard-layout-control">${control}${decision.reason?`<small>${escapeHtml(decision.reason)}</small>`:''}</div></article>`;
  }).join(''):`<div class="empty-state">${selectedContentType==='event'?'根据事实基座生成 4～10 页事件卡片。':selectedContentType==='custom'?'根据自定义事实基座生成 4～10 页卡片。':'核验仓库后，AI 会自动规划 4～7 页卡片。'}</div>`);
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
  document.getElementById('social-facts-title').textContent=selectedContentType==='event'?'事件事实基座':selectedContentType==='custom'?`自定义事实基座（${selectedChannelMode==='xiaohongshu'?'小红书':'公众号'}）`:'仓库事实基座';
  const channelPicker=document.getElementById('social-channel')?.closest('label');
  const factsActions=document.getElementById('social-facts-title')?.closest('.workspace-head')?.querySelector(':scope>div:last-child');
  if(channelPicker&&factsActions&&!factsActions.contains(channelPicker))factsActions.prepend(channelPicker);
  const inspect=document.getElementById('inspect-repository'),reanalyze=document.getElementById('analyze-card-editorial');
  inspect.textContent='分析仓库';
  reanalyze.textContent=data.editorial?.card_plan_json?.length?'重新生成故事板':'生成故事板';
  reanalyze.hidden=false;
  renderFacts(data.facts,data.eventAnalysis);renderScore(data.score);currentFactIndex=data.factIndex||null;currentContentPlanAdjustments=data.contentPlanAdjustments||null;currentLayoutReportPages=Array.isArray(data.layoutReport?.pages)?data.layoutReport.pages:[];renderCardPlan(data.editorial?.card_plan_json,data.layoutDecisions,currentLayoutReportPages,null,null);renderStoryboardThemeState(data.themeState);renderGate(data.gate);
  syncStoryboardActionLabels();
  document.getElementById('social-channel').value=selectedChannelMode;document.getElementById('social-composition-mode').value=selectedCompositionMode;document.getElementById('social-layout-style').value=data.editorial?.layout_style||'auto';currentGroupLayout=data.editorial?.layout_style||'auto';document.getElementById('social-visual-style').value=data.editorial?.visual_style||'ice-blue';document.getElementById('social-visual-style').dataset.previousValue=document.getElementById('social-visual-style').value;document.getElementById('social-visual-style').dispatchEvent(new Event('theme-ui-sync'));syncCompositionControls();await Promise.all([loadSocialSkillControls(data),loadDelivery(selectedId),loadSimilarSocialCards(selectedId)]);
}

async function analyzeEditorial(candidateId=selectedId) {
  if(!candidateId)return; const data=await request(`/api/candidates/${candidateId}/ai/card-editorial`,{method:'POST',body:JSON.stringify({
    stageSkills:selectedStageSkills(document.getElementById('social-stage-skills')),
  })});
  if(candidateId===selectedId){
    // 新故事板建立新的计划基线；旧的布局审计、重排预览和内容计划调整记录必须失效。
    currentContentPlanAdjustments=null;
    currentLayoutReportPages=[];
    storyboardReflowPreview=null;
    storyboardRenderState={status:'storyboard-updated',pendingRender:true,htmlUpdated:false,pngUpdated:false};
    renderCardPlan(data.editorial?.card_plan_json,data.layoutDecisions,[],null,storyboardRenderState);
    const preview=document.getElementById('card-plan-preview');
    const plan=Array.isArray(data.cardPlan)?data.cardPlan:[];
    const summary=[
      data.editorial?.target_reader?`目标读者：${data.editorial.target_reader}`:'',
      data.editorial?.pain_point?`核心问题：${data.editorial.pain_point}`:'',
      data.editorial?.tool_positioning?`工具定位：${data.editorial.tool_positioning}`:'',
      plan.length?`页面规划：${plan.length} 页（${plan.map((page)=>page.title||page.kind).filter(Boolean).join(' → ')}）`:''
    ].filter(Boolean).join('\n');
    if(preview&&summary)preview.insertAdjacentHTML('afterbegin',`<details class="thinking-box"><summary>故事板规划摘要</summary><div class="thinking-text">${escapeHtml(summary)}</div></details>`);
    renderStoryboardThemeState(data.themeState);renderGate(data.gate);if(data.eventAnalysis)renderFacts(null,data.eventAnalysis);toast(selectedContentType==='event'?'AI 已根据突发事实基座生成事件故事板':selectedContentType==='custom'?'AI 已根据自定义事实基座生成故事板':'AI 已根据仓库事实生成卡片故事板');}return data;
}

let storyboardProgressTimer=null;
function stopStoryboardProgress(){if(storyboardProgressTimer){clearInterval(storyboardProgressTimer);storyboardProgressTimer=null;}}
function renderStoryboardLoading(message){
  stopStoryboardProgress();
  const preview=document.getElementById("card-plan-preview");
  const eventMode=selectedContentType==='event',customMode=selectedContentType==='custom';
  const phases=eventMode
    ? ['整理事件事实与来源','提炼传播问题与证据边界','规划逐页故事线','等待模型返回完整故事板']
    : customMode
      ? ['整理主题、读者与素材','提炼核心命题与来源等级','规划逐页故事线','等待模型返回完整故事板']
      : ['整理 README 与仓库事实','提炼读者任务与工具定位','规划能力、上手与边界页面','等待模型返回完整故事板'];
  const startedAt=Date.now();
  preview.innerHTML=`<div class="storyboard-loading" role="status" aria-live="polite"><span class="storyboard-spinner"></span><div class="storyboard-progress-copy"><b>${escapeHtml(message)}</b><small data-storyboard-progress>正在提交事实基座…</small><ol>${phases.map((phase,index)=>`<li data-storyboard-phase="${index}">${escapeHtml(phase)}</li>`).join('')}</ol><small class="storyboard-elapsed" data-storyboard-elapsed>已等待 0 秒</small></div></div>`;
  const update=()=>{
    const elapsed=Math.max(0,Math.floor((Date.now()-startedAt)/1000));
    const phaseIndex=elapsed<3?0:elapsed<12?1:elapsed<25?2:3;
    preview.querySelectorAll('[data-storyboard-phase]').forEach((item,index)=>{item.classList.toggle('done',index<phaseIndex);item.classList.toggle('active',index===phaseIndex);});
    const status=preview.querySelector('[data-storyboard-progress]');
    if(status)status.textContent=phaseIndex===3?`模型仍在处理，接口请求保持等待（${elapsed} 秒）`:`当前：${phases[phaseIndex]}`;
    const timer=preview.querySelector('[data-storyboard-elapsed]');if(timer)timer.textContent=`已等待 ${elapsed} 秒 · 完整 JSON 返回后自动展示`;
  };
  update();storyboardProgressTimer=setInterval(update,1000);
}

async function inspectRepository(){
  if(!selectedId||selectedContentType!=='repository')return;
  const candidateId=selectedId;const inspectButton=document.getElementById('inspect-repository');const analyzeButton=document.getElementById('analyze-card-editorial');
  const factsPanel=document.getElementById('repository-facts');const original=inspectButton.textContent;
  inspectButton.disabled=true;analyzeButton.disabled=true;inspectButton.textContent='正在分析 README…';
  if(factsPanel)factsPanel.innerHTML='<div class="storyboard-loading" role="status">正在分析仓库并刷新事实基座…</div>';
  try{
    const data=await request(`/api/candidates/${candidateId}/repository/inspect`,{method:'POST',body:'{}'});
    if(candidateId===selectedId){
      renderFacts(data.facts);renderScore(data.score);renderGate(data.gate);
      toast('仓库事实已更新，请点击“生成故事板”');
    }
  }catch(error){toast(error.message,'error');}
  finally{inspectButton.disabled=false;analyzeButton.disabled=false;inspectButton.textContent=original;syncStoryboardActionLabels();}
}

async function runStoryboard(){
  if(!selectedId)return;const candidateId=selectedId;const inspectButton=document.getElementById('inspect-repository');const analyzeButton=document.getElementById('analyze-card-editorial');
  const eventMode=selectedContentType==='event';const customMode=selectedContentType==='custom';const original=analyzeButton.textContent;
  inspectButton.disabled=true;analyzeButton.disabled=true;analyzeButton.textContent=currentCardPlan.length?'正在重新规划…':'正在生成故事板…';
  renderStoryboardLoading(eventMode?'正在根据事件事实基座生成对应故事板':customMode?'正在根据自定义事实基座生成故事板':currentCardPlan.length?'正在根据已有事实重新生成故事板':'正在根据仓库事实生成故事板');
  try{await analyzeEditorial(candidateId);}
  catch(error){toast(error.message,'error');if(candidateId===selectedId)renderCardPlan(currentCardPlan,currentLayoutDecisions);}
  finally{stopStoryboardProgress();inspectButton.disabled=false;analyzeButton.disabled=false;analyzeButton.textContent=original;syncStoryboardActionLabels();}
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
      badge.textContent = '布局审计未通过 · 可修改或 AI 重生成本页';
      summary.appendChild(badge);
    }
  }
  articles[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// 生成任务按候选追踪，按钮按当前选中候选渲染——页面级单按钮不再被多个候选的任务进度交替覆盖
const socialJobs = new Map();
function socialGenerationProgressLabel(progress='') {
  const text=String(progress||'');
  const planner=text.match(/内容计划调整第\s*(\d+)\s*(?:次尝试|轮)/);
  if(planner)return `调整内容计划（第${planner[1]}次）…`;
  if(/逐页生成高清 PNG/.test(text))return '生成卡片图片…';
  if(/浏览器布局审计/.test(text))return '检查卡片布局…';
  if(/生成配套文案/.test(text))return '生成配套文案…';
  if(/布局契约组装/.test(text))return '组装卡片页面…';
  if(/读取|事实基座/.test(text))return '读取项目事实…';
  if(/封面标题/.test(text))return '处理封面标题…';
  if(/文字修复|AI 改写/.test(text))return '优化页面文字…';
  return '正在生成图文…';
}
function syncGenerateButton() {
  const generate = document.getElementById("generate-social-card"); if (!generate) return;
  const job = selectedId ? socialJobs.get(Number(selectedId)) : null;
  const active = job && (job.status === 'running' || job.status === 'queued');
  if (active) {
    // 任务进度可能包含页码、校验原因和来源 URL，不能直接塞进按钮文本，
    // 否则会把底部操作栏撑成一条很长的灰色提示条。完整进度仍保留在任务日志，
    // 并通过 title 给需要快速查看的用户提供悬浮提示。
    generate.disabled = true;
    generate.textContent = job.status === 'queued' ? '排队等待执行…' : socialGenerationProgressLabel(job.progress);
    generate.title = '图文任务执行中，详细进度请查看任务日志';
    return;
  }
  const ready=generate.dataset.ready!=='false';
  if (storyboardThemeState?.status==='needs-storyboard') { generate.disabled=true;generate.textContent='请先重新生成故事板';generate.title=storyboardThemeState.reason||'当前主题模板能力与故事板不一致';return; }
  generate.disabled=!ready;
  if (job && job.status === 'completed') { generate.textContent = '重新生成整组图文'; return; }
  if(generate.dataset.pendingRender==='true'){generate.textContent='重新生成整组图文';generate.title='故事板已更新，确认页面关系后重新生成整组 HTML/PNG';return;}
  generate.textContent = '生成整组图文';
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
  const candidates=all.filter((item)=>candidateMode(item.output_mode,item.content_class)===currentMode);
  const layout=MODE_LAYOUT[currentMode]||MODE_LAYOUT.tools;
  const nav=document.getElementById("social-editor-candidates");
  nav.innerHTML=candidates.length?candidates.map((item)=>{const modeLabel=isCustomOutput(item.output_mode)?(item.output_mode==='xiaohongshu-custom-cards'?'自定义 · 小红书':'自定义 · 公众号'):item.content_class==='open_source_technology'?'事件图文 · 开源技术':item.content_class==='open_source_trend'?'事件图文 · 开源趋势':isEventOutput(item.output_mode)?'事件图文':'';return `<button type="button" class="social-editor-candidate" data-social-candidate="${item.id}"><b>${escapeHtml(item.candidate_id)}</b><span>${escapeHtml(item.hotspot_title)}</span><em>${escapeHtml(modeLabel||item.repository_description||item.social_selection_reason||'暂无仓库描述')}</em><small>${escapeHtml(item.track_status||'pooled')}${item.social_selection_reason?` · ${escapeHtml(item.social_selection_reason)}`:''}</small></button>`;}).join(''):`<div class="empty-state">${layout.empty}</div>`;
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
      const nextLayoutReportPages=[...currentLayoutReportPages];nextLayoutReportPages[page-1]=null;renderCardPlan(data.cardPlan,data.layoutDecisions,nextLayoutReportPages);
    }catch(error){toast(error.message, "error");renderCardPlan(currentCardPlan,currentLayoutDecisions);}
  });
}
if(!window.__socialPageEditorBound){window.__socialPageEditorBound=true;
  document.addEventListener('input',(event)=>{
    if(event.target.closest('.storyboard-page-editor'))storyboardDirty=true;
  });
  document.addEventListener('click',async(event)=>{
    const dismissPreview=event.target.closest('[data-dismiss-storyboard-preview]');
    if(dismissPreview){storyboardReflowPreview=null;renderCardPlan(currentCardPlan,currentLayoutDecisions,currentLayoutReportPages,null,storyboardRenderState);return;}
    const regenerate=event.target.closest('[data-regenerate-storyboard-page]');
    if(regenerate&&selectedId){
      const pageNumber=Number(regenerate.dataset.regenerateStoryboardPage);
      if(!await confirmDiscardStoryboardEdits())return;
      const originalText=regenerate.textContent;regenerate.disabled=true;regenerate.textContent='AI 正在结合素材重生成…';
      try{
        const status=regenerate.closest('.storyboard-page-ai-action')?.querySelector('[data-storyboard-ai-status]');
        if(status)status.textContent=regenerate.dataset.regenerateMode==='restructure'?'正在读取布局报告并规划续页…':'正在结合完整素材改写本页…';
        const data=await requestStoryboardAi(`/api/candidates/${selectedId}/card-pages/${pageNumber}/ai`,{method:'POST',body:JSON.stringify({mode:regenerate.dataset.regenerateMode,stageSkills:selectedStageSkills(document.getElementById('social-stage-skills'))})});
        const nextLayoutReportPages=regenerate.dataset.regenerateMode==='restructure'?new Array(Array.isArray(data.cardPlan)?data.cardPlan.length:0).fill(null):[...currentLayoutReportPages];
        if(regenerate.dataset.regenerateMode!=='restructure')nextLayoutReportPages[pageNumber-1]=null;
        storyboardRenderState=data.renderState||{status:'storyboard-updated',pendingRender:true,htmlUpdated:false,pngUpdated:false};
        const preview=data.restructure?.preview||null;
        renderCardPlan(data.cardPlan,data.layoutDecisions,nextLayoutReportPages,preview,storyboardRenderState);renderGate(data.gate);
        const generate=document.getElementById('generate-social-card');if(generate){generate.dataset.ready='true';generate.dataset.pendingRender='true';syncGenerateButton();}
        toast(regenerate.dataset.regenerateMode==='restructure'?'本页已按结构修复拆分；已展示续页关系，请确认后重新生成整组图文。':`本页已按 AI ${regenerate.dataset.regenerateMode==='expand'?'扩写':'缩写'} 更新；确认后请重新生成整组图文。`);
      }catch(error){const status=regenerate.closest('.storyboard-page-ai-action')?.querySelector('[data-storyboard-ai-status]');if(status)status.textContent='修复失败，故事板未修改';toast(error.message,'error');regenerate.disabled=false;regenerate.textContent=originalText;}
      return;
    }
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
        const supplementSlot=String(node.dataset.supplementSlotId||'').trim();
        let factIds=[];let sourceRefs=[];
        try{factIds=JSON.parse(node.dataset.factIds||'[]');}catch{}
        try{sourceRefs=JSON.parse(node.dataset.sourceRefs||'[]');}catch{}
        if(supplementSlot)block.supplement_slot_id=supplementSlot;
        if(Array.isArray(factIds)&&factIds.length)block.fact_ids=factIds.map(String);
        if(Array.isArray(sourceRefs)&&sourceRefs.length)block.source_refs=sourceRefs.map(String);
        const field=node.querySelector('[data-storyboard-block-content]');
        if(isStructuredCardBlockType(type))Object.assign(block,JSON.parse(field.value||'{}'),{content:''});
        else block.content=field?.value.trim()||'';
        contentBlocks.push(block);
      });
    }catch(error){toast(error instanceof SyntaxError?'结构化内容必须是有效 JSON':`内容块读取失败：${error.message}`,'error');return;}
    const originalText=button.textContent;button.disabled=true;button.textContent='保存中…';
    try{
      const data=await request(`/api/candidates/${selectedId}/card-pages/${pageNumber}`,{method:'PUT',body:JSON.stringify({
        title:article.querySelector('[data-storyboard-title]')?.value||'',
        goal:article.querySelector('[data-storyboard-goal]')?.value||'',
        content_blocks:contentBlocks,
      })});
      const nextLayoutReportPages=[...currentLayoutReportPages];nextLayoutReportPages[pageNumber-1]=null;renderCardPlan(data.cardPlan,data.layoutDecisions,nextLayoutReportPages);renderGate(data.gate);const generate=document.getElementById('generate-social-card');if(generate){generate.dataset.ready='true';generate.dataset.pendingRender='true';syncGenerateButton();}
      toast('本页故事板已保存；生成图文时会整组重新渲染');
    }catch(error){toast(error.message, "error");button.disabled=false;button.textContent=originalText;}
  });
  // 切换内容块类型：重渲染该块编辑器，保留标题；结构化/正文内容按新类型转换
  document.addEventListener('change',(event)=>{
    const select=event.target.closest('[data-storyboard-block-type]');if(!select)return;
    const fieldset=select.closest('[data-storyboard-block]');if(!fieldset)return;
    const type=select.value;
    const title=fieldset.querySelector('[data-storyboard-block-title]')?.value||'';
    const currentValue=fieldset.querySelector('[data-storyboard-block-content]')?.value||'';
    let block={type,title};
    const supplementSlot=String(fieldset.dataset.supplementSlotId||'').trim();
    if(supplementSlot)block.supplement_slot_id=supplementSlot;
    try{const factIds=JSON.parse(fieldset.dataset.factIds||'[]');if(Array.isArray(factIds)&&factIds.length)block.fact_ids=factIds;}catch{}
    try{const sourceRefs=JSON.parse(fieldset.dataset.sourceRefs||'[]');if(Array.isArray(sourceRefs)&&sourceRefs.length)block.source_refs=sourceRefs;}catch{}
    if(isStructuredCardBlockType(type)){
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
    const previous=storyboardThemeState?.current?.themeId||document.getElementById('social-visual-style').dataset.previousValue||event.target.value;
    if(!await confirmDiscardStoryboardEdits()){event.target.value=previous;event.target.dispatchEvent(new Event('theme-ui-sync'));return;}
    event.target.disabled=true;
    try{
      const data=await request(`/api/candidates/${selectedId}/card-editorial`,{method:'PUT',body:JSON.stringify({visual_style:event.target.value})});
      renderStoryboardThemeState(data.themeState);renderGate(data.gate);
      toast(data.themeState?.status==='needs-storyboard'?'已切换主题；该主题需要重新生成故事板':'已切换主题；当前故事板可直接重新渲染');
      event.target.dataset.previousValue=event.target.value;
    }catch(error){event.target.value=previous;event.target.dispatchEvent(new Event('theme-ui-sync'));toast(error.message, "error");}
    finally{event.target.disabled=false;}
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
      toast(error.message, "error");
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
    }catch(error){event.target.value=currentGroupLayout;toast(error.message, "error");}
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
      renderCardPlan(currentCardPlan,data.layoutDecisions);renderStoryboardThemeState(data.themeState);renderGate(data.themeState?.status==='needs-storyboard'?{...(lastGate||{}),ready:false}:lastGate||{ready:false});
      if(selectedContentType==='custom')document.getElementById('social-facts-title').textContent=`自定义事实基座（${selectedChannelMode==='xiaohongshu'?'小红书':'公众号'}）`;
    }catch(error){event.target.value=selectedChannelMode;toast(error.message, "error");}
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
inspectButton?.addEventListener("click",inspectRepository);
const analyzeButton=freshButton("analyze-card-editorial");
analyzeButton?.addEventListener("click",()=>runStoryboard());
const generateButton=freshButton("generate-social-card");
generateButton?.addEventListener("click", async () => { if (!selectedId) return; const candidateId = Number(selectedId); if (delivery?.ready && !await confirmAction("重新生成图文将覆盖当前已生成的整组交付物（HTML 与逐页 PNG），是否继续？", { confirmText: "重新生成" })) return; socialJobs.set(candidateId, { status: 'running', progress: '正在启动…' }); syncGenerateButton(); try { const job = await request(`/api/candidates/${candidateId}/ai/social-card`, { method: 'POST', body: '{}' }); socialJobs.set(candidateId, { status: 'running', progress: '图文任务执行中…' }); syncGenerateButton(); toast("图文生成任务已启动，可在任务日志查看进度"); watchSocialJob(job.id, candidateId).catch((error) => { socialJobs.set(candidateId, { status: 'failed', error: error.message }); syncGenerateButton(); toast(error.message, "error"); }); } catch (error) { socialJobs.delete(candidateId); syncGenerateButton(); renderGate(lastGate); toast(error.message, "error"); } });

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
      if(prov)prov.innerHTML=providerOptions(state.models?.defaultProvider||state.models?.providers?.find((p)=>p.configured)?.name||'');
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
    }catch(error){toast(error.message, "error");}
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
      toast(error.message, "error");
    }
    finally{submit.disabled=!parseRepo(input.value.trim());submit.textContent='添加';}
  });
}
bindRepositorySocialForm();

export default loadSocialEditor;
