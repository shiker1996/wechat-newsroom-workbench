import { formatAccountContext } from '../domain/account-context.mjs';
import { evaluateEditorialReadiness, substantiveDecision, EDITORIAL_FIELDS } from '../domain/editorial-readiness.mjs';
import { selectionPrompt } from './selection-prompts.mjs';
import { delimitUntrusted, trimConversation, truncateAtBoundary } from './context-safety.mjs';
import { parseModelJson } from './model-json.mjs';

export { substantiveDecision };

const FIRSTHAND_EXPERIENCE=/(?:我|本人|自己)?(?:已经|已|实际|亲自)?[^。！？\n]{0,20}(?:安装|部署|运行|使用|试用|跑通|跑过|实测|亲测)[^。！？\n]{0,24}(?:过|了|体验|感受|结果)/;

// briefUpdates 中归属候选选题的字段（其余归属编辑底稿会话）
const CANDIDATE_FIELDS=['angle','thesis'];
// 文本类底稿字段：占位符值（"待定/暂无"等）不视为实质更新
const BRIEF_TEXT_FIELDS=['author_opinions','rejected_angles'];
const BRIEF_KEEP_ON_EMPTY_FIELDS=['confirmed_facts','confirmed_experiences','forbidden_claims'];

// 编辑室不做"决策补写"兜底：逐字段状态回显由代码给出，
// 沉淀职责完全归模型，代码侧只保留占位符/空串过滤与体验确定性沉淀。

function redactLocalPaths(value){return String(value||'').replace(/[A-Za-z]:\\[^\s，。；、)）\]]+/g,'【本地项目材料】').replace(/(?:^|\s)\/(?:[^/\s]+\/)*[^/\s，。；、)）\]]+/g,' 【本地项目材料】');}

// 用户明确陈述亲身实践时，确定性沉淀进 confirmed_experiences（不依赖模型自觉）
export function reconcileEditorialAnswer({parsed,current,answer=''}){
  const result=structuredClone(parsed||{}),updates=result.briefUpdates&&typeof result.briefUpdates==='object'?result.briefUpdates:(result.briefUpdates={});
  const explicit=FIRSTHAND_EXPERIENCE.test(String(answer||'')),existing=[current?.editorial?.confirmed_experiences,updates.confirmed_experiences].filter(Boolean).join('\n');
  if(explicit){
    const claim=redactLocalPaths(String(answer).trim()).slice(0,800);
    updates.confirmed_experiences=[existing,claim].filter(Boolean).filter((value,index,all)=>all.indexOf(value)===index).join('\n');
  }
  return result;
}

export function parseEditorialResult(result,store) {
  return parseModelJson(result,{store,label:'编辑会'});
}

// 编辑会 prompt 的唯一事实源是技能 skills/editorial-room-chat；账号上下文仍是代码注入的数据，
// 技能文本用 {{ACCOUNT_CONTEXT}} 占位符标出注入位置。技能缺失或被禁用时 selectionPrompt 直接抛错（fail-fast）。
function editorialSystem(workspaceRoot) {
  const { prompt } = selectionPrompt({ workspaceRoot, skillName:'editorial-room-chat' });
  return prompt.replaceAll('{{ACCOUNT_CONTEXT}}', formatAccountContext({workspaceRoot}));
}

// 单源摘录预算：长正文经由 content.passage.retrieve 检索压缩（头部+相关段落），
// 检索不可用或失败时回退为头部截断。
const EXCERPT_BUDGET=8000;
const EXCERPT_OPTIONS={k:6,headChars:1500,chunkChars:500,maxCharsPerDoc:EXCERPT_BUDGET};

async function sourceExcerpt(hotspot,retrieve,query) {
  const content=String(hotspot.sourceDoc?.content||'');
  if(!retrieve||content.length<=EXCERPT_BUDGET)return truncateAtBoundary(content,EXCERPT_BUDGET).text;
  try{
    const selections=await retrieve({documents:[{id:String(hotspot.id),content}],query,...EXCERPT_OPTIONS});
    const found=Array.isArray(selections)?selections.find((s)=>s.id===String(hotspot.id)):null;
    if(found?.excerpt)return found.excerpt;
  }catch{/* 检索失败回退截断 */}
  return content.slice(0,EXCERPT_BUDGET);
}

export async function buildEditorialMessages(current,answer,events=[],retrieve=null,workspaceRoot) {
  const webSearchContext = '如有联网搜索信息已在对话开头提供。联网搜索结果为当前实时公开资料，视为额外的 sources。';
  const query=String(answer||'').trim();
  const eventInputs=[];
  for(const event of events||[]){
    const sources=[];
    for(const hotspot of event.hotspots||[]){
      const doc=hotspot.sourceDoc;
      sources.push(doc?{ status:doc.status, url:doc.final_url||doc.url||hotspot.url, title:doc.title||hotspot.title,
        description:doc.description, author:doc.author, publishedAt:doc.published_at,
        fetchedAt:doc.fetched_at, error:doc.error,
        contentExcerpt:await sourceExcerpt(hotspot,retrieve,query)
      }:{ status:'missing', error:'尚未抓取原文', url:hotspot.url, title:hotspot.title });
    }
    eventInputs.push({
      eventId:event.event_id?String(event.event_id):undefined,
      title:event.title,
      eventCard:event.card?{conclusion:event.card.conclusion,confirmedFacts:event.card.confirmed_facts||[],sourceIncrement:event.card.source_increment||[],disagreements:event.card.disagreements||[],unverified:event.card.unverified||[]}:null,
      sources
    });
  }
  // 逐字段状态由代码从底稿推导并完整回显（所见即所判），模型只围绕不合格项提问
  const {ready,fields}=evaluateEditorialReadiness({candidate:current,editorial:current.editorial||{}});
  const fieldStatus=fields.map((field)=>`- ${field.label}（${field.required?'必填':'选填'}）：${field.value?`当前值「${field.value.slice(0,200)}」${field.ok?'，合格':'，不合格（占位符不算实质表态）'}`:'未填写'}`).join('\n');
  const instruction=answer.trim()?'处理用户刚才的回答并更新 briefUpdates；若仍有不合格的必填项，围绕依赖链（事实→观点→角度→命题→边界）上最靠前的一个不合格必填项提出下一个问题。':(current.messages?.length?'用户本轮未输入新内容，不是重新开始。基于当前底稿继续推进：有不合格必填项则按依赖链顺序提问最靠前的一个；全部合格则说明底稿已可成稿，直接告知作者。':'编辑会刚开始。先用一两句话概括事件卡与来源已给出的事实基座，然后按依赖链顺序（先确认事实，再观点、角度、命题、边界）提出第一个关键问题。'+(current.editorial?.editor_question?`选题编排阶段预置的首问供参考：${current.editorial.editor_question}`:''));
  // 装配结构：不可信块只放纯数据（候选/事件/底稿/字段状态）；对话历史展开为真实 user/assistant 回合，
  // 作者回答（已在 current.messages 末尾）保有 user 回合权重，指令作为最后一条 user 消息收尾。
  return [
    {role:'system',content:editorialSystem(workspaceRoot)+(webSearchContext?'  '+webSearchContext:''),protected:true},
    {role:'user',protected:true,content:delimitUntrusted('editorial-context',{
      candidate:{
        title:current.hotspot_title,url:current.url,category:current.category,riskLevel:current.risk_level,
        angle:current.angle,thesis:current.thesis,composite:Boolean(current.composite)
      },
      events:eventInputs,
      currentEditorial:current.editorial,fieldStatus,ready})},
    ...trimConversation(current.messages),
    {role:'user',protected:true,content:instruction},
  ];
}

export function applyEditorialResult({store,candidateId,current,parsed,result}) {
  const reply=String(parsed.assistantReply||'').trim();
  const latest=store.getCandidate(candidateId);
  if(latest?.status==='locked'||latest?.editorial?.brief_status==='LOCKED'){
    if(reply)store.addEditorialMessage(candidateId,'assistant',reply);
    return {candidate:store.getCandidate(candidateId),editorial:latest.editorial,usage:result.usage,model:result.model,reply,ignoredBecauseLocked:true};
  }
  const updates=parsed.briefUpdates||{};
  // 合并候选字段：占位符值不写入（既不覆盖已有实质值，也不把搪塞值沉淀为下一轮 baseline）
  const candidatePatch={};
  for(const field of CANDIDATE_FIELDS)
    if(updates[field]!=null&&substantiveDecision(updates[field]))candidatePatch[field]=String(updates[field]);
  const mergedCandidate={...current,...candidatePatch};
  store.updateCandidate(candidateId,{angle:mergedCandidate.angle,thesis:mergedCandidate.thesis});
  // 合并底稿会话字段：空串视为无更新，观点/舍弃角度另要求非占位符
  const mergeText=(field,substantiveOnly=false)=>{
    const next=updates[field];
    if(next==null||!String(next).trim())return current.editorial[field];
    if(substantiveOnly&&!substantiveDecision(next))return current.editorial[field];
    return String(next);
  };
  const mergedEditorial={...current.editorial,
    confirmed_facts:mergeText('confirmed_facts'),author_opinions:mergeText('author_opinions',true),
    confirmed_experiences:mergeText('confirmed_experiences'),rejected_angles:mergeText('rejected_angles',true),
    forbidden_claims:mergeText('forbidden_claims')};
  // 就绪由代码推导：必填表单项填好即可成稿，不再由模型声明
  const readiness=evaluateEditorialReadiness({candidate:mergedCandidate,editorial:mergedEditorial});
  const editorial=store.saveEditorial(candidateId,{...mergedEditorial,
    editor_question:'',open_questions:readiness.missing.join('；'),
    next_action:readiness.ready?'WRITE_NOW':'DISCUSS',brief_status:readiness.ready?'WRITE_NOW':'DISCUSS'});
  if(reply)store.addEditorialMessage(candidateId,'assistant',reply);
  return {candidate:store.getCandidate(candidateId),editorial,readiness,usage:result.usage,model:result.model,reply};
}
