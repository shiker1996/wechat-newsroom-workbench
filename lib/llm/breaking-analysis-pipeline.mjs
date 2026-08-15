import fs from 'node:fs';
import path from 'node:path';
import { fetchMaterialSource } from '../integrations/source-fetcher.mjs';
import { batchTopicsDir } from '../core/workspace-paths.mjs';
import { delimitUntrusted, markdownInlineData } from './context-safety.mjs';
import { parseJsonText } from './model-json.mjs';

const ARTICLE_MAX={conflict:20,audienceRelevance:20,informationGain:15,emotionalTension:15,timeliness:15,impact:10,sourceReliability:5};
const ARTICLE_PENALTY_MAX={factGap:15,unverifiedAllegation:20,saturation:10,accountMismatch:10};
const SOCIAL_MAX={informationDensity:20,visualNarrative:20,conflictEmotion:15,timeliness:15,audienceRelevance:15,evidenceCompleteness:15};
const SOCIAL_PENALTY_MAX={singleSource:10,unverifiedAllegation:20,visualMaterialGap:10,copyrightRisk:10,saturation:10};

const SYSTEM=`你是突发事件事实编辑与内容适配评估器。只能依据输入素材，不得把社交媒体指控、匿名爆料、媒体转述或作者观点升级为事实。
评分字段是“直接相加的分值”，不是 1～5 星等级，必须充分使用以下区间：
- 文章：conflict 0～20，audienceRelevance 0～20，informationGain 0～15，emotionalTension 0～15，timeliness 0～15，impact 0～10，sourceReliability 0～5。
- 文章扣分：factGap 0～15，unverifiedAllegation 0～20，saturation 0～10，accountMismatch 0～10。
- 图文：informationDensity 0～20，visualNarrative 0～20，conflictEmotion 0～15，timeliness 0～15，audienceRelevance 0～15，evidenceCompleteness 0～15。
- 图文扣分：singleSource 0～10，unverifiedAllegation 0～20，visualMaterialGap 0～10，copyrightRisk 0～10，saturation 0～10。
例如某维度表现为上限的 80%，应给 16/20 或 12/15，不能统一写成 4。推荐生产时，维度总和通常不应低于 50；若确实低于 30，应将推荐类型设为“暂不生产”并解释原因。
返回严格 JSON：
{
 "eventSummary":"不超过120字",
 "factBase":{
   "confirmedFacts":[{"claim":"...","sourceIds":[1],"confidence":"high|medium|low"}],
   "claims":[{"claim":"...","speaker":"...","sourceIds":[1],"status":"unverified|disputed|partially_supported"}],
   "timeline":[{"time":"...","event":"...","sourceIds":[1]}],
   "parties":["..."],"responses":[{"party":"...","response":"...","sourceIds":[1]}],
   "authorContext":"...","openQuestions":["..."],"sourceConflicts":["..."]
 },
 "sourceAudit":{"originalSourceAvailable":true,"officialSourceAvailable":false,"independentSourceCount":0,"issues":["..."],"neededMaterials":["..."]},
 "article":{
   "dimensions":{"conflict":0,"audienceRelevance":0,"informationGain":0,"emotionalTension":0,"timeliness":0,"impact":0,"sourceReliability":0},
   "penalties":{"factGap":0,"unverifiedAllegation":0,"saturation":0,"accountMismatch":0},
   "recommendedType":"技术热点快评|行业深度|职场观察|暂不生产","angle":"...","thesis":"...","reasons":["..."],"risks":["..."]
 },
 "social":{
   "dimensions":{"informationDensity":0,"visualNarrative":0,"conflictEmotion":0,"timeliness":0,"audienceRelevance":0,"evidenceCompleteness":0},
   "penalties":{"singleSource":0,"unverifiedAllegation":0,"visualMaterialGap":0,"copyrightRisk":0,"saturation":0},
   "recommendedFormat":"事件时间线|观点对比|证据拆解|人物关系|暂不生产","recommendedPages":6,"reasons":["..."],"risks":["..."],"storyOutline":["..."]
 }
}
各维度不得超过字段允许上限。sourceIds 只能引用输入中的素材编号。没有证据时放入 openQuestions 或 claims，不得放入 confirmedFacts。`;

function clamp(value,max){const number=Number(value);return Number.isFinite(number)?Math.max(0,Math.min(max,number)):0;}
function object(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
function array(value){return Array.isArray(value)?value.filter(Boolean):value?String(value).split(/\r?\n|；/).map((item)=>item.trim()).filter(Boolean):[];}
function parseJson(content){return parseJsonText(content);}
export function normalizeScore(raw,maxima,penaltyMaxima){
  const dimensions={};for(const [key,max] of Object.entries(maxima))dimensions[key]=clamp(object(raw.dimensions)[key],max);
  const penalties={};for(const [key,max] of Object.entries(penaltyMaxima))penalties[key]=clamp(object(raw.penalties)[key],max);
  const baseScore=Object.values(dimensions).reduce((sum,value)=>sum+value,0);
  const penalty=Object.values(penalties).reduce((sum,value)=>sum+value,0);
  return {dimensions,penalties,baseScore:Number(baseScore.toFixed(1)),penalty:Number(penalty.toFixed(1)),finalScore:Number(Math.max(0,baseScore-penalty).toFixed(1))};
}
export function mapBreakingArticleScore(article){
  const dimensions=article?.dimensions||{},penalties=article?.penalties||{};
  const h=Number((((Number(dimensions.conflict)||0)+(Number(dimensions.emotionalTension)||0)+(Number(dimensions.timeliness)||0))/50*100).toFixed(1));
  const b=Number((((Number(dimensions.informationGain)||0)+(Number(dimensions.audienceRelevance)||0)+(Number(dimensions.sourceReliability)||0))/40*100).toFixed(1));
  const p=Number((((Number(dimensions.impact)||0)+(Number(dimensions.audienceRelevance)||0))/30*100).toFixed(1));
  const s=Number(Number(penalties.saturation||0).toFixed(1));
  const weighted=h*.6+b*.25+p*.15-s;
  const f=Number(article?.finalScore||0);
  const d=Number((f-weighted).toFixed(1));
  return {h,b,p,s,d,f};
}
function recommendation(score){return score>=70?'recommend':score>=55?'conditional':'hold';}
export function hasScoreScaleContradiction(score,recommendationValue,holdValue='暂不生产'){return Number(score?.baseScore)<30&&String(recommendationValue||'')!==holdValue;}
function markdown(analysis,sources){
  const facts=analysis.factBase;
  const lines=['# 突发事件事实基座','',analysis.eventSummary,'','## 来源审计','',
    `- 原始信源：${analysis.sourceAudit.originalSourceAvailable?'有':'无'}`,
    `- 官方来源：${analysis.sourceAudit.officialSourceAvailable?'有':'无'}`,
    `- 独立来源数：${analysis.sourceAudit.independentSourceCount}`,'','## 已确认事实',''];
  for(const item of facts.confirmedFacts)lines.push(`- ${markdownInlineData(item.claim)}（来源 ${item.sourceIds.join('、')||'待补'}；置信度 ${markdownInlineData(item.confidence)}）`);
  lines.push('','## 尚未核实的主张','');for(const item of facts.claims)lines.push(`- ${item.speaker?`${markdownInlineData(item.speaker)}：`:''}${markdownInlineData(item.claim)}（${markdownInlineData(item.status)}；来源 ${item.sourceIds.join('、')||'待补'}）`);
  lines.push('','## 时间线','');for(const item of facts.timeline)lines.push(`- ${markdownInlineData(item.time)||'时间待核'}：${markdownInlineData(item.event)}（来源 ${item.sourceIds.join('、')||'待补'}）`);
  lines.push('','## 未决问题','',...facts.openQuestions.map((item)=>`- ${item}`),'','## 素材清单','');
  for(const source of sources)lines.push(`- [${source.id}] ${source.title||source.url} · ${source.status}${source.error?` · ${source.error}`:''}`);
  return lines.join('\n').trim()+'\n';
}

export async function runBreakingAnalysisPipeline({gateway,store,batchId,provider,workspaceRoot,onProgress=()=>{}}){
  const batch=store.getBatch(batchId);if(!batch)throw new Error('批次不存在');
  if(batch.batch_type!=='breaking')throw new Error('只有突发专题批次可以执行突发分析');
  const hotspot=batch.hotspots[0];if(!hotspot)throw new Error('突发专题没有投递事件');
  const existingCandidate=store.getCandidateByHotspot(batchId,hotspot.id);
  if(existingCandidate){
    const messageUrls=store.listEditorialMessages(existingCandidate.id).flatMap((message)=>[...String(message.content||'').matchAll(/https?:\/\/[^\s<>"']+/g)].map((match)=>match[0].replace(/[),.;，。；]+$/,'')));
    if(messageUrls.length)store.addBreakingMaterials(batchId,messageUrls);
  }
  const materials=store.listHotspotMaterials(hotspot.id);if(!materials.length)throw new Error('突发专题没有素材链接');
  onProgress(`开始抓取 ${materials.length} 条突发素材`);
  const fetched=[];let cursor=0;
  async function worker(){while(cursor<materials.length){const material=materials[cursor++];onProgress(`正在抓取素材 ${material.position+1}/${materials.length}`);try{fetched.push(await fetchMaterialSource({store,material,root:workspaceRoot,force:true}));}catch(error){fetched.push(store.saveHotspotMaterialResult(material.id,{status:'error',error:error.message,fetched_at:new Date().toISOString()}));}}}
  await Promise.all(Array.from({length:Math.min(3,materials.length)},()=>worker()));
  fetched.sort((a,b)=>a.position-b.position);
  const usable=fetched.filter((item)=>item.status==='ok'&&(item.content||item.description));
  if(!usable.length)throw new Error('全部素材均抓取失败，请补充可访问链接或正文');
  onProgress(`素材抓取完成：${usable.length}/${materials.length} 条可用于分析`);
  const sourceInput=fetched.map((item,index)=>({id:index+1,url:item.url,finalUrl:item.final_url,title:item.title,author:item.author,publishedAt:item.published_at,
    status:item.status,error:item.error,description:String(item.description||'').slice(0,1200),content:String(item.content||'').slice(0,10000)}));
  const providerConfig=gateway.config.providers[provider||gateway.config.defaultProvider];
  onProgress('正在建立事实基座并计算文章 / 图文双评分');
  let result,raw;
  for(let attempt=0;attempt<2;attempt+=1){
    result=await gateway.complete({provider,purpose:'breaking-analysis',batchId,jsonMode:true,maxOutputTokens:Math.min(7000,providerConfig.maxOutputTokens),messages:[
      {role:'system',content:SYSTEM,protected:true},
      {role:'user',content:`${attempt?'上次输出疑似误用了 1～5 分制。请严格使用各字段完整分值区间重新评估；推荐生产与极低维度总分不能同时出现。\n\n':''}${delimitUntrusted('breaking-materials',{eventTitle:hotspot.title,authorContext:batch.note,requestedTracks:batch.requested_tracks_list,sources:sourceInput},30000)}`,protected:true},
    ]});
    try{raw=parseJson(result.content);}catch(error){store.updateModelCall(result.callId,{status:'invalid_output',error:`突发分析返回无效 JSON：${error.message}`});if(!attempt){onProgress('突发分析 JSON 无效，正在自动重试');continue;}throw new Error(`突发分析返回无效 JSON：${error.message}`);}
    const articlePreview=normalizeScore(object(raw.article),ARTICLE_MAX,ARTICLE_PENALTY_MAX);
    const socialPreview=normalizeScore(object(raw.social),SOCIAL_MAX,SOCIAL_PENALTY_MAX);
    const articleContradiction=hasScoreScaleContradiction(articlePreview,raw.article?.recommendedType);
    const socialContradiction=hasScoreScaleContradiction(socialPreview,raw.social?.recommendedFormat);
    if((articleContradiction||socialContradiction)&&!attempt){store.updateModelCall(result.callId,{status:'invalid_output',error:'评分疑似误用 1～5 分制且与生产建议矛盾'});onProgress('检测到评分量纲与生产建议矛盾，正在按完整分值区间重试');continue;}
    if(articleContradiction||socialContradiction)throw new Error('突发分析评分连续两次与生产建议矛盾，请更换模型重试');
    break;
  }
  const factRaw=object(raw.factBase),auditRaw=object(raw.sourceAudit);
  const factBase={
    confirmedFacts:array(factRaw.confirmedFacts).map((item)=>typeof item==='string'?{claim:item,sourceIds:[],confidence:'low'}:{claim:String(item.claim||''),sourceIds:array(item.sourceIds).map(Number).filter(Boolean),confidence:String(item.confidence||'low')}).filter((item)=>item.claim),
    claims:array(factRaw.claims).map((item)=>typeof item==='string'?{claim:item,speaker:'',sourceIds:[],status:'unverified'}:{claim:String(item.claim||''),speaker:String(item.speaker||''),sourceIds:array(item.sourceIds).map(Number).filter(Boolean),status:String(item.status||'unverified')}).filter((item)=>item.claim),
    timeline:array(factRaw.timeline).map((item)=>typeof item==='string'?{time:'',event:item,sourceIds:[]}:{time:String(item.time||''),event:String(item.event||''),sourceIds:array(item.sourceIds).map(Number).filter(Boolean)}).filter((item)=>item.event),
    parties:array(factRaw.parties),responses:array(factRaw.responses),authorContext:String(factRaw.authorContext||batch.note||''),
    openQuestions:array(factRaw.openQuestions),sourceConflicts:array(factRaw.sourceConflicts),
  };
  const articleRaw=object(raw.article),socialRaw=object(raw.social);
  const article={...normalizeScore(articleRaw,ARTICLE_MAX,ARTICLE_PENALTY_MAX),recommendedType:String(articleRaw.recommendedType||'暂不生产'),angle:String(articleRaw.angle||''),thesis:String(articleRaw.thesis||''),reasons:array(articleRaw.reasons),risks:array(articleRaw.risks)};
  const social={...normalizeScore(socialRaw,SOCIAL_MAX,SOCIAL_PENALTY_MAX),recommendedFormat:String(socialRaw.recommendedFormat||'暂不生产'),recommendedPages:Math.max(4,Math.min(10,Number(socialRaw.recommendedPages)||6)),reasons:array(socialRaw.reasons),risks:array(socialRaw.risks),storyOutline:array(socialRaw.storyOutline)};
  const analysis={version:1,generatedAt:new Date().toISOString(),eventTitle:hotspot.title,eventSummary:String(raw.eventSummary||''),sources:sourceInput.map(({content,...item})=>({...item,contentChars:content.length})),factBase,
    sourceAudit:{originalSourceAvailable:Boolean(auditRaw.originalSourceAvailable),officialSourceAvailable:Boolean(auditRaw.officialSourceAvailable),independentSourceCount:Math.max(0,Number(auditRaw.independentSourceCount)||0),issues:array(auditRaw.issues),neededMaterials:array(auditRaw.neededMaterials)},
    article:{...article,recommendation:recommendation(article.finalScore)},social:{...social,recommendation:recommendation(social.finalScore)},requestedTracks:batch.requested_tracks_list};
  store.saveBreakingAnalysis(batchId,analysis);
  const dir=batchTopicsDir(workspaceRoot,batch),sourcesDir=path.join(dir,'sources');fs.mkdirSync(sourcesDir,{recursive:true});
  const jsonPath=path.join(sourcesDir,'breaking-analysis.json'),mdPath=path.join(sourcesDir,'breaking-fact-base.md');
  fs.writeFileSync(jsonPath,JSON.stringify(analysis,null,2),'utf8');fs.writeFileSync(mdPath,markdown(analysis,sourceInput),'utf8');
  for(const [kind,name,file] of [['突发事件分析','breaking-analysis.json',jsonPath],['突发事件事实基座','breaking-fact-base.md',mdPath]]){const stat=fs.statSync(file);store.upsertArtifact({batchId,kind,name,path:file,size:stat.size,modifiedAt:stat.mtime.toISOString()});}
  store.updateBatch(batchId,{stage:'editorial',status:'review'});
  onProgress(`双评分完成：文章 ${article.finalScore}，图文 ${social.finalScore}；等待确认分流`);
  return analysis;
}

export function routeBreakingAnalysis({store,batchId,tracks}){
  const batch=store.getBatch(batchId);if(!batch||batch.batch_type!=='breaking')throw new Error('突发专题不存在');
  const saved=store.getBreakingAnalysis(batchId);if(!saved?.analysis)throw new Error('请先完成突发分析');
  const selected=[...new Set((tracks||[]).filter((value)=>['article','social_cards'].includes(value)))];if(!selected.length)throw new Error('请至少选择一个进入方向');
  const hotspot=batch.hotspots[0];store.addCandidates(batchId,[hotspot.id],{tracks:selected});
  const candidate=store.getCandidateByHotspot(batchId,hotspot.id);
  const {article,social}=saved.analysis;
  const mapped=mapBreakingArticleScore(article);
  store.updateCandidate(candidate.id,{pool_role:'突发专题',risk_level:(saved.analysis.sourceAudit.issues.length||article.risks.length)?'需核验':'低',angle:article.angle||hotspot.title,thesis:article.thesis||saved.analysis.eventSummary,
    h_score:mapped.h,b_score:mapped.b,p_score:mapped.p,s_score:mapped.s,d_score:mapped.d,f_score:mapped.f,status:'analyzed'});
  if(selected.includes('article')){
    store.addCandidateTracks(candidate.id,['article'],{status:'analyzed',score:mapped.f,pool_role:'突发专题'});
    store.updateCandidateTrack(candidate.id,'article',{status:'analyzed',score:mapped.f,pool_role:'突发专题'});
  }
  else store.removeCandidateTrack(candidate.id,'article');
  if(selected.includes('social_cards')){
    store.addCandidateTracks(candidate.id,['social_cards'],{status:'pooled',score:social.finalScore,pool_role:'突发专题',output_mode:'wechat-event-cards'});
    store.updateCandidateTrack(candidate.id,'social_cards',{status:'pooled',score:social.finalScore,pool_role:'突发专题',output_mode:'wechat-event-cards'});
    store.saveSocialScore(candidate.id,{...social.dimensions,...social.penalties,finalScore:social.finalScore,scoreProfile:'event',recommendation:social.recommendation});
    store.saveCardEditorial(candidate.id,{...store.getCardEditorial(candidate.id),output_mode:'wechat-event-cards',visual_style:'charcoal',recommended_pages:social.recommendedPages||6,status:'DISCUSS'});
  } else if(candidate.tracks.some((item)=>item.track==='social_cards'))store.removeCandidateTrack(candidate.id,'social_cards');
  return {candidate:store.getCandidate(candidate.id),tracks:selected};
}
