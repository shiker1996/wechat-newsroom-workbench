import { state } from "../core/state.js";
import { request } from "../core/http.js";
import { escapeHtml, toast } from "../core/ui.js";

let selectedId = null;
let delivery=null;let deliveryIndex=0;let proofTab='copy';
let selectedContentType='repository';
let selectedChannelMode='wechat';

const CUSTOM_TYPE_LABELS={tutorial:'教程',list:'清单',opinion:'观点'};
const CUSTOM_LEVEL_LABELS={author_experience:'作者体验',user_material:'用户素材',model_suggestion:'模型建议'};

function updateSocialTabControls(){const tabs=document.getElementById('social-editor-candidates');const previous=document.getElementById('social-tabs-previous');const next=document.getElementById('social-tabs-next');if(!tabs||!previous||!next)return;const max=Math.max(0,tabs.scrollWidth-tabs.clientWidth);previous.disabled=tabs.scrollLeft<=1;next.disabled=tabs.scrollLeft>=max-1;}
function setupSocialTabNavigation(){const tabs=document.getElementById('social-editor-candidates');const strip=tabs?.closest('.social-candidate-tab-strip');if(!tabs||!strip||strip.dataset.navigationBound==='true')return;strip.dataset.navigationBound='true';strip.addEventListener('click',(event)=>{const arrow=event.target.closest('.candidate-tab-arrow');if(!arrow)return;tabs.scrollBy({left:(arrow.classList.contains('previous')?-1:1)*Math.max(220,tabs.clientWidth*.72),behavior:'smooth'});});tabs.addEventListener('scroll',updateSocialTabControls,{passive:true});window.addEventListener('resize',updateSocialTabControls,{passive:true});updateSocialTabControls();}

function renderDeliveryImage(){if(!delivery?.images?.length)return;deliveryIndex=(deliveryIndex+delivery.images.length)%delivery.images.length;const image=delivery.images[deliveryIndex];document.getElementById('social-gallery-image').src=`${image.url}?s=${image.size}`;document.getElementById('social-gallery-counter').textContent=`${deliveryIndex+1} / ${delivery.images.length}`;document.getElementById('social-download-image').href=image.downloadUrl;document.getElementById('social-gallery-film').querySelectorAll('button').forEach((button,index)=>button.classList.toggle('active',index===deliveryIndex));}
function renderProof(){if(!delivery)return;const values={copy:delivery.copy||'暂无发布文案',facts:delivery.facts||'暂无事实清单',layout:JSON.stringify(delivery.layout||{},null,2)};document.getElementById('social-proof-content').textContent=values[proofTab];document.querySelectorAll('[data-social-proof]').forEach((button)=>button.classList.toggle('active',button.dataset.socialProof===proofTab));}
async function loadDelivery(candidateId=selectedId){if(!candidateId)return;const data=await request(`/api/candidates/${candidateId}/social-cards`);if(candidateId!==selectedId)return;delivery=data;const panel=document.getElementById('social-delivery');panel.hidden=!data.ready;if(!data.ready)return;deliveryIndex=0;document.getElementById('social-delivery-meta').textContent=`${data.images.length} 张 · 布局审计${data.layout?.valid?'通过':'待确认'} · 交付门禁${data.delivery?.valid?'通过':'待确认'}`;document.getElementById('social-open-html').href=data.htmlUrl;document.getElementById('social-download-all').href=data.bundleUrl;document.getElementById('social-gallery-film').innerHTML=data.images.map((image,index)=>`<button type="button" data-social-image="${index}"><img src="${image.url}?s=${image.size}" alt="第 ${index+1} 张缩略图"><span>${String(index+1).padStart(2,'0')}</span></button>`).join('');renderDeliveryImage();renderProof();}

function renderGate(gate) {
  document.getElementById("card-ready-title").textContent=gate.ready?"故事板已就绪":selectedContentType==='event'?"请先生成事件故事板":selectedContentType==='custom'?"请先完善自定义事实基座":"请先分析仓库生成故事板";
  const generate=document.getElementById("generate-social-card");
  generate.disabled=!gate.ready;
  generate.title=gate.ready?"根据当前卡片故事板开始生成":selectedContentType==='event'?"请先根据事实基座生成事件故事板":selectedContentType==='custom'?"门禁项全部通过后才能生成图文":"请先分析仓库并生成卡片故事板";
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

function renderCardPlan(value) {
  let plan=[];try{plan=Array.isArray(value)?value:JSON.parse(value||'[]');}catch{}
  document.getElementById("card-plan-preview").innerHTML=plan.length?plan.map((page,index)=>`<article><b>${index+1}</b><div><small>${escapeHtml(page.kind||'content')}</small><h4>${escapeHtml(page.title||'未命名页面')}</h4><p>${escapeHtml(page.goal||'')}</p></div></article>`).join(''):`<div class="empty-state">${selectedContentType==='event'?'根据事实基座生成 4～10 页事件卡片。':selectedContentType==='custom'?'根据自定义事实基座生成 4～10 页卡片。':'核验仓库后，AI 会自动规划 4～7 页卡片。'}</div>`;
}

export async function openSocialEditor(id) {
  selectedId=Number(id); const data=await request(`/api/candidates/${selectedId}/card-editorial`);
  selectedContentType=data.contentType||'repository';
  selectedChannelMode=data.channelMode||'wechat';
  document.getElementById("social-editor-empty").hidden=true; document.getElementById("social-editor-fields").hidden=false;
  document.getElementById("social-editor-code").textContent=data.candidate.candidate_id; document.getElementById("social-editor-title").textContent=data.candidate.hotspot_title;
  const link=document.getElementById("social-repository-link"); const url=data.candidate.url||data.facts?.source_url||''; link.href=url;link.textContent=url||(selectedContentType==='event'?'尚无事件来源':selectedContentType==='custom'?'自定义图文 · 无外部来源':'尚无仓库地址');
  document.querySelectorAll(".social-editor-candidate").forEach((item)=>item.classList.toggle("active",Number(item.dataset.socialCandidate)===selectedId));
  document.querySelector('.social-editor-candidate.active')?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'nearest'});updateSocialTabControls();
  document.getElementById('social-facts-kicker').textContent=selectedContentType==='event'?'EVENT FACT BASE':selectedContentType==='custom'?'CUSTOM FACT BASE':'REPOSITORY FACTS';
  document.getElementById('social-facts-title').textContent=selectedContentType==='event'?'突发事件事实基座':selectedContentType==='custom'?`自定义事实基座（${selectedChannelMode==='xiaohongshu'?'小红书':'公众号'}）`:'仓库事实基座';
  const inspect=document.getElementById('inspect-repository'),reanalyze=document.getElementById('analyze-card-editorial');
  inspect.textContent=selectedContentType==='event'?'根据事实基座生成故事板':selectedContentType==='custom'?'根据事实基座生成故事板':'分析仓库并生成故事板';
  reanalyze.textContent='重新生成故事板';reanalyze.hidden=selectedContentType==='event'&&!data.editorial?.card_plan_json?.length;
  renderFacts(data.facts,data.eventAnalysis);renderScore(data.score);renderCardPlan(data.editorial?.card_plan_json);renderGate(data.gate);
  document.getElementById('social-visual-style').value=data.editorial?.visual_style||'ice-blue';await Promise.all([loadDelivery(selectedId),loadSimilarSocialCards(selectedId)]);
}

async function analyzeEditorial(candidateId=selectedId) {
  if(!candidateId)return; const data=await request(`/api/candidates/${candidateId}/ai/card-editorial`,{method:'POST',body:'{}'});
  if(candidateId===selectedId){renderCardPlan(data.editorial?.card_plan_json);renderGate(data.gate);toast(selectedContentType==='event'?'AI 已根据突发事实基座生成事件故事板':selectedContentType==='custom'?'AI 已根据自定义事实基座生成故事板':'AI 已根据仓库事实生成卡片故事板');}return data;
}

function renderStoryboardLoading(message){document.getElementById("card-plan-preview").innerHTML=`<div class="storyboard-loading"><span class="storyboard-spinner"></span><div><b>${escapeHtml(message)}</b><small>${selectedContentType==='event'?'正在读取事实、主张、时间线和来源风险，请勿重复点击。':'正在读取 README、提取能力并规划逐页内容，请勿重复点击。'}</small></div></div>`;}

async function runStoryboard({inspect=false}={}){
  if(!selectedId)return;const candidateId=selectedId;const inspectButton=document.getElementById("inspect-repository");const analyzeButton=document.getElementById("analyze-card-editorial");
  const eventMode=selectedContentType==='event';const customMode=selectedContentType==='custom';const sourceButton=inspect?inspectButton:analyzeButton;const original=sourceButton.textContent;inspectButton.disabled=true;analyzeButton.disabled=true;sourceButton.textContent=eventMode?"正在规划事件故事板…":customMode?"正在规划故事板…":inspect?"正在分析 README…":"正在重新规划…";renderStoryboardLoading(eventMode?"正在根据事实基座生成事件故事板":customMode?"正在根据自定义事实基座生成故事板":inspect?"正在核验仓库并生成故事板":"正在根据已有事实重新生成故事板");
  try{if(inspect&&selectedContentType==='repository'){const data=await request(`/api/candidates/${candidateId}/repository/inspect`,{method:'POST',body:'{}'});if(candidateId===selectedId){renderFacts(data.facts);renderScore(data.score);renderGate(data.gate);}}await analyzeEditorial(candidateId);}catch(error){toast(error.message);if(candidateId===selectedId)renderCardPlan([]);}finally{inspectButton.disabled=false;analyzeButton.disabled=false;sourceButton.textContent=original;}
}

async function watchSocialJob(jobId,candidateId,button){
  while(true){await new Promise((resolve)=>setTimeout(resolve,2000));const job=await request(`/api/jobs/${jobId}`);if(candidateId===selectedId)button.textContent=job.status==='running'?(job.progress||'图文任务执行中…'):'生成图文';if(job.status==='running')continue;
    if(candidateId===selectedId){button.disabled=false;button.textContent=job.status==='completed'?'重新生成图文':'生成图文';}
    if(job.status==='completed'){toast('图文生成完成，已输出 HTML 和逐页 PNG');await loadDelivery(candidateId);}else toast(`图文生成失败${job.error?`：${job.error}`:''}`);return;
  }
}

async function loadSocialEditor() {
  setupSocialTabNavigation();
  const batch=state.batches.find((item)=>item.id===state.activeBatchId); if(!batch)return;
  const candidates=await request(`/api/batches/${encodeURIComponent(batch.id)}/candidates?track=social_cards`); const nav=document.getElementById("social-editor-candidates");
  nav.innerHTML=candidates.length?candidates.map((item)=>`<button type="button" class="social-editor-candidate" data-social-candidate="${item.id}"><b>${escapeHtml(item.candidate_id)}</b><span>${escapeHtml(item.hotspot_title)}</span><em>${escapeHtml(item.repository_description||item.social_selection_reason||'暂无仓库描述')}</em><small>${escapeHtml(item.track_status||'pooled')}${item.social_selection_reason?` · ${escapeHtml(item.social_selection_reason)}`:''}</small></button>`).join(''):'<div class="empty-state">图文选题池为空</div>';
  requestAnimationFrame(updateSocialTabControls);
  if(candidates.length)await openSocialEditor(selectedId&&candidates.some((x)=>x.id===selectedId)?selectedId:candidates[0].id);
}

function freshButton(id){const current=document.getElementById(id);if(!current)return null;const fresh=current.cloneNode(true);current.replaceWith(fresh);return fresh;}

if(!window.__socialEditorCandidateBound){window.__socialEditorCandidateBound=true;
  document.addEventListener("click",async(event)=>{const candidate=event.target.closest("[data-social-candidate]");if(candidate)await openSocialEditor(Number(candidate.dataset.socialCandidate));});
}
if(!window.__socialDeliveryBound){window.__socialDeliveryBound=true;document.addEventListener('click',(event)=>{const image=event.target.closest('[data-social-image]');if(image){deliveryIndex=Number(image.dataset.socialImage);renderDeliveryImage();}const tab=event.target.closest('[data-social-proof]');if(tab){proofTab=tab.dataset.socialProof;renderProof();}});document.getElementById('social-gallery-prev')?.addEventListener('click',()=>{deliveryIndex-=1;renderDeliveryImage();});document.getElementById('social-gallery-next')?.addEventListener('click',()=>{deliveryIndex+=1;renderDeliveryImage();});}
if(!window.__socialThemeBound){window.__socialThemeBound=true;document.getElementById('social-visual-style')?.addEventListener('change',async(event)=>{if(!selectedId)return;try{await request(`/api/candidates/${selectedId}/card-editorial`,{method:'PUT',body:JSON.stringify({visual_style:event.target.value})});toast('视觉主题已保存，生成图文时生效');}catch(error){toast(error.message);}});}
const inspectButton=freshButton("inspect-repository");
inspectButton?.addEventListener("click",()=>runStoryboard({inspect:true}));
const analyzeButton=freshButton("analyze-card-editorial");
analyzeButton?.addEventListener("click",()=>runStoryboard());
const generateButton=freshButton("generate-social-card");
generateButton?.addEventListener("click",async()=>{if(!selectedId)return;const candidateId=selectedId;generateButton.disabled=true;generateButton.textContent="正在启动…";try{const job=await request(`/api/candidates/${candidateId}/ai/social-card`,{method:'POST',body:'{}'});generateButton.textContent="图文任务执行中…";toast("图文生成任务已启动，可在任务日志查看进度");watchSocialJob(job.id,candidateId,generateButton).catch((error)=>{if(candidateId===selectedId){generateButton.disabled=false;generateButton.textContent="生成图文";}toast(error.message);});}catch(error){toast(error.message);generateButton.disabled=false;generateButton.textContent="生成图文";}});

window.openSocialEditor=openSocialEditor;

// 创建自定义图文（待办 1+6：教程/清单/观点 × 公众号/小红书）
function bindCustomSocialForm(){
  const toggle=document.getElementById('create-custom-social'),panel=document.getElementById('custom-social-panel');
  if(!toggle||!panel||toggle.dataset.bound==='true')return;toggle.dataset.bound='true';
  const typeSelect=document.getElementById('custom-content-type');
  const syncTypeFields=()=>{const type=typeSelect.value;panel.querySelectorAll('[data-custom-only]').forEach((node)=>{node.hidden=node.dataset.customOnly!==type;});};
  toggle.addEventListener('click',()=>{panel.hidden=!panel.hidden;syncTypeFields();});
  typeSelect.addEventListener('change',syncTypeFields);
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
      panel.hidden=true;toast('自定义图文已创建');
      await loadSocialEditor();
      if(data.candidate?.id)await openSocialEditor(data.candidate.id);
    }catch(error){toast(error.message);}
    finally{submit.disabled=false;submit.textContent='创建并进入图文编辑室';}
  });
}
bindCustomSocialForm();

export default loadSocialEditor;
