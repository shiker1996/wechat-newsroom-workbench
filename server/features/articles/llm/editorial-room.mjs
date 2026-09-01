import { formatAccountContext } from '../../../shared/domain/account-context.mjs';
import { evaluateEditorialReadiness, substantiveDecision, confirmedFactsDecision, researchBasisDecision, EDITORIAL_FIELDS } from '../domain/editorial-readiness.mjs';
import { selectionPrompt } from '../../research/llm/selection-prompts.mjs';
import { delimitUntrusted, trimConversation, truncateAtBoundary } from '../../../platform/llm/context-safety.mjs';
import { parseModelJson } from '../../../platform/llm/model-json.mjs';
import { hasEditorialPatch, mergeAppendEditorialField, mergeSingleEditorialField } from '../domain/editorial-patch.mjs';

export { substantiveDecision };

const FIRSTHAND_EXPERIENCE=/(?:我|本人|自己)?(?:已经|已|实际|亲自)?[^。！？\n]{0,20}(?:安装|部署|运行|使用|试用|跑通|跑过|实测|亲测)[^。！？\n]{0,24}(?:过|了|体验|感受|结果)/;

// briefUpdates 中归属候选选题的字段（其余归属编辑底稿会话）
const CANDIDATE_FIELDS=['angle','thesis'];
// 文本类底稿字段：占位符值（"待定/暂无"等）不视为实质更新
const BRIEF_TEXT_FIELDS=['research_basis','author_opinions','rejected_angles'];
const BRIEF_KEEP_ON_EMPTY_FIELDS=['confirmed_facts','confirmed_experiences','forbidden_claims'];

// 编辑室不做"决策补写"兜底：逐字段状态回显由代码给出，
// 沉淀职责完全归模型，代码侧只保留占位符/空串过滤与体验确定性沉淀。

function redactLocalPaths(value){return String(value||'').replace(/[A-Za-z]:\\[^\s，。；、)）\]]+/g,'【本地项目材料】').replace(/(?:^|\s)\/(?:[^/\s]+\/)*[^/\s，。；、)）\]]+/g,' 【本地项目材料】');}

const DECISION_META_SUFFIX=/(?:。|；|;|\s)*(?:命题与角度|依赖链上|依赖链|编辑底稿).{0,160}?(?:合格|已对齐|可成稿)[^。！？]*[。！？]?\s*$/u;

// 模型有时会把“已合格/可成稿”等流程播报粘进 angle/thesis，落表前剥离，
// 保证文章字段只保存作者决策，不保存编辑室运行状态。
function cleanDecisionText(field,value){
  const text=String(value??'').trim();
  return (field==='angle'||field==='thesis')?text.replace(DECISION_META_SUFFIX,'').trim():text;
}

// 用户明确陈述亲身实践时，确定性沉淀进 confirmed_experiences（不依赖模型自觉）
export function reconcileEditorialAnswer({parsed,current,answer=''}){
  const result=structuredClone(parsed||{}),updates=result.briefUpdates&&typeof result.briefUpdates==='object'?result.briefUpdates:(result.briefUpdates={});
  const explicit=FIRSTHAND_EXPERIENCE.test(String(answer||''));
  if(explicit){
    const claim=redactLocalPaths(String(answer).trim()).slice(0,800);
    const existingUpdate=updates.confirmed_experiences;
    if(existingUpdate&&typeof existingUpdate==='object'&&!Array.isArray(existingUpdate)){
      const append=Array.isArray(existingUpdate.append)?existingUpdate.append:[existingUpdate.append].filter(Boolean);
      updates.confirmed_experiences={...existingUpdate,append:[...append,claim]};
    }else{
      updates.confirmed_experiences=[existingUpdate,claim].filter(Boolean).join('\n');
    }
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

// 编辑室不需要评分，只需要能把研判转成作者可回答的写作决策。
// 这里从完整研判报告中提取候选命题、事件内信号、事件间关系和证据边界，
// 避免模型在一大段原始 JSON 中自行寻找重点，也避免把 T/J/A/C/F 带入编辑会。
function editorialResearchBrief(context) {
  if (!context || typeof context !== 'object') return null;
  const list = (value) => Array.isArray(value) ? value : [];
  const internal = list(context.internal_research || context.internal_signals).map((item) => ({
    event_id: item.event_id,
    title: item.title,
    anomalies: list(item.internal_research?.anomalies || item.anomaly_points),
    interest_conflicts: list(item.internal_research?.interest_conflicts || item.interest_conflicts),
    divergence_directions: list(item.internal_research?.divergence_directions || item.divergence_directions),
  })).filter((item) => item.anomalies.length || item.interest_conflicts.length || item.divergence_directions.length);
  const relations = list(context.inter_event_research || context.relations).map((item) => ({
    relation_id: item.relation_id,
    relation_kind: item.relation_kind,
    relation_label: item.relation_label,
    event_ids: list(item.event_ids),
    relationship_statement: item.relationship_statement,
    evidence_boundary: item.evidence_boundary,
  })).filter((item) => item.relationship_statement || item.relation_kind);
  const topics = list(context.topic_candidates || (context.topic_candidate ? [context.topic_candidate] : [])).map((item) => ({
    candidate_id: item.candidate_id,
    topic_type: item.topic_type,
    candidate_title: item.candidate_title || item.title,
    core_question: item.core_question || item.discussion_question,
    angle: item.angle,
    thesis_seed: item.thesis_seed,
    internal_signal_refs: list(item.internal_signal_refs || item.signal_refs),
    relation_ids: list(item.relation_ids),
  })).filter((item) => item.candidate_title || item.core_question || item.angle || item.thesis_seed);
  return {
    focus_topic: topics[0] || null,
    topic_candidates: topics,
    internal_research: internal,
    inter_event_research: relations,
    evidence_boundary: context.evidence_boundary || null,
    scope: { events: list(context.scope?.events).map((event) => ({ event_id: event.event_id, title: event.title })) },
  };
}

function researchDrivenInstruction(researchBrief) {
  if (!researchBrief) return '当前没有可用的模型研判内容；按事件卡和来源事实推进，但不要自行编造反常、利益冲突或事件关系。';
  const topic = researchBrief.focus_topic;
  const basisCount = researchBrief.internal_research.length + researchBrief.inter_event_research.length;
  if (!topic && !basisCount) return '当前没有可用的模型研判内容；按事件卡和来源事实推进，但不要自行编造反常、利益冲突或事件关系。';
  return `本轮必须以模型研判为提问主线（当前有 ${basisCount} 组研判依据）。${topic ? `优先围绕候选命题「${topic.candidate_title || topic.core_question || topic.angle}」确认作者是否接受、如何修改，不要让作者从空白开始泛泛回答。` : '先从下面的反常、利益冲突、发散或事件关系中选择一条最适合作者的主线。'} 每个问题都要明确引用对应的反常点、利益冲突、发散方向或前后/回应/对比/趋势关系：事实阶段问这条研判由哪些事实支撑，观点阶段问作者如何解释和站在哪一边，角度阶段问准备从哪一个矛盾或变化切入，命题阶段问文章要证明什么。不得退回“你想写什么”“你的看法是什么”这类脱离研判的泛问。`;
}

export async function buildEditorialMessages(current,answer,events=[],retrieve=null,workspaceRoot,researchContext=null) {
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
  const researchBrief = editorialResearchBrief(researchContext);
  // 逐字段状态由代码从底稿推导并完整回显（所见即所判），模型只围绕不合格项提问
  const {ready,fields}=evaluateEditorialReadiness({candidate:current,editorial:current.editorial||{}});
  const fieldStatus=fields.map((field)=>`- ${field.label}（${field.required?'必填':'选填'}）：${field.value?`当前值「${field.value.slice(0,200)}」${field.ok?'，合格':'，不合格（占位符不算实质表态）'}`:'未填写'}`).join('\n');
  const researchInstruction = researchDrivenInstruction(researchBrief);
  const instruction=answer.trim()?`处理用户刚才的回答并更新 briefUpdates；${researchInstruction} 若仍有不合格的必填项，围绕依赖链（事实→研判主线→观点→角度→命题→边界）上最靠前的一个不合格必填项提出下一个问题。`: (current.messages?.length?`用户本轮未输入新内容，不是重新开始。基于当前底稿继续推进：${researchInstruction} 有不合格必填项则按依赖链顺序提问最靠前的一个；全部合格则说明底稿已可成稿，直接告知作者。`:`编辑会刚开始。先用一两句话概括事件卡与来源已给出的事实基座，再用具体研判依据建立写作主线。${researchInstruction} 按依赖链顺序（先确认事实，再确认研判主线，再观点、角度、命题、边界）提出第一个关键问题。${current.editorial?.editor_question?`选题编排阶段预置的首问供参考：${current.editorial.editor_question}`:''}`);
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
      researchBrief,
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
  // 候选字段是单值决策：只有模型明确返回 set/replace（或兼容旧字符串）才替换。
  const candidatePatch={};
  for(const field of CANDIDATE_FIELDS){
    if(!hasEditorialPatch(updates[field]))continue;
    const value=cleanDecisionText(field,mergeSingleEditorialField(current[field],updates[field],substantiveDecision));
    if(value!==String(current[field]||'').trim()||((updates[field]?.clear===true)&&!value))candidatePatch[field]=value;
  }
  const mergedCandidate={...current,...candidatePatch};
  if(Object.keys(candidatePatch).length)store.updateCandidate(candidateId,{angle:mergedCandidate.angle,thesis:mergedCandidate.thesis});
  // 多值底稿字段默认追加并去重；删除/清空/整段替换都必须通过显式操作表达。
  const mergeText=(field,validator=substantiveDecision)=>{
    const next=updates[field];
    if(!hasEditorialPatch(next))return current.editorial[field]||'';
    return mergeAppendEditorialField(current.editorial[field]||'',next,validator);
  };
  const mergeSingle=(field,validator)=>{
    const next=updates[field];
    if(!hasEditorialPatch(next))return current.editorial[field]||'';
    return mergeSingleEditorialField(current.editorial[field]||'',next,validator);
  };
  const mergedEditorial={...current.editorial,
    confirmed_facts:mergeText('confirmed_facts',confirmedFactsDecision),research_basis:mergeSingle('research_basis',researchBasisDecision),author_opinions:mergeText('author_opinions',substantiveDecision),
    confirmed_experiences:mergeText('confirmed_experiences',substantiveDecision),rejected_angles:mergeText('rejected_angles',substantiveDecision),
    forbidden_claims:mergeText('forbidden_claims')};
  // 就绪由代码推导：必填表单项填好即可成稿，不再由模型声明
  const readiness=evaluateEditorialReadiness({candidate:mergedCandidate,editorial:mergedEditorial});
  const editorial=store.saveEditorial(candidateId,{...mergedEditorial,
    editor_question:'',open_questions:readiness.missing.join('；'),
    next_action:readiness.ready?'WRITE_NOW':'DISCUSS',brief_status:readiness.ready?'WRITE_NOW':'DISCUSS'});
  if(reply)store.addEditorialMessage(candidateId,'assistant',reply);
  return {candidate:store.getCandidate(candidateId),editorial,readiness,usage:result.usage,model:result.model,reply};
}
