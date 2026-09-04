import { formatAccountContext } from '../../../shared/domain/account-context.mjs';
import { evaluateEditorialReadiness, substantiveDecision, EDITORIAL_FIELDS } from '../domain/editorial-readiness.mjs';
import { selectionPrompt } from '../../research/llm/selection-prompts.mjs';
import { delimitUntrusted, trimConversation, truncateAtBoundary } from '../../../platform/llm/context-safety.mjs';

export { substantiveDecision };

// 编辑会 prompt 的唯一事实源是技能 skills/editorial-room-chat；账号上下文仍是代码注入的数据，
// 技能文本用 {{ACCOUNT_CONTEXT}} 占位符标出注入位置。技能缺失或被禁用时 selectionPrompt 直接抛错（fail-fast）。
function editorialSystem(workspaceRoot) {
  const { prompt } = selectionPrompt({ workspaceRoot, skillName:'editorial-room-chat' });
  return prompt.replaceAll('{{ACCOUNT_CONTEXT}}', formatAccountContext({workspaceRoot}));
}

// 单源摘录预算：长正文经由 cap_content_passage_retrieve 检索压缩（头部+相关段落），
// 检索不可用或失败时回退为头部截断。
const EXCERPT_BUDGET=8000;
const EXCERPT_OPTIONS={k:6,headChars:1500,chunkChars:500,maxCharsPerDoc:EXCERPT_BUDGET};
const RESEARCH_SELECTION_CATALOG_BUDGET=40000;

function researchPointText(point){
  return String(point?.statement||point?.question||point?.relationship_statement||point?.label||'').trim();
}

// 编辑室业务工具使用的唯一研判点目录。point_id 优先复用研判产物中的 ID，
// 缺失时按事件、类型和顺序生成稳定回退 ID，禁止 Agent 自行构造跨选题引用。
export function buildEditorialResearchPointOptions(context){
  if(!context||typeof context!=='object')return [];
  const options=[],signals=Array.isArray(context.internal_research||context.internal_signals)?(context.internal_research||context.internal_signals):[],relations=Array.isArray(context.inter_event_research||context.relations)?(context.inter_event_research||context.relations):[];
  const names=new Map((context.scope?.events||[]).map((event)=>[String(event.event_id),event.title||'相关事件']));
  const add=(point)=>{if(!point.statement||options.some((item)=>item.point_id===point.point_id))return;options.push(point);};
  signals.forEach((event)=>{
    const research=event.internal_research||{},eventId=String(event.event_id||'');
    const groups=[
      ['anomaly','反常点',research.anomalies||event.anomaly_points||[]],
      ['interest_conflict','利益冲突',research.interest_conflicts||event.interest_conflicts||[]],
      ['divergence','可发散方向',research.divergence_directions||event.divergence_directions||[]],
    ];
    groups.forEach(([kind,label,items])=>(Array.isArray(items)?items:[]).forEach((item,index)=>{
      const statement=researchPointText(item);if(!statement)return;
      add({
        point_id:String(item.signal_id||item.internal_signal_id||`internal:${kind}:${eventId}:${index}`),scope:'internal',kind,label,statement,
        expected:item.expected||item.baseline||'',observed:item.observed||'',gap:item.gap||'',baseline:item.baseline||'',impact:item.impact||'',why_it_matters:item.why_it_matters||'',issue:item.issue||'',difference:item.difference||'',parties:item.parties||[],supporting_facts:item.supporting_facts||item.confirmed_facts||[],evidence_boundary:item.evidence_boundary||'',confidence:item.confidence||'',question:item.question||'',
        event_id:eventId,event_ids:eventId?[eventId]:[],event_title:event.title||names.get(eventId)||'相关事件',signal_id:item.signal_id||item.internal_signal_id||'',signal_refs:item.signal_refs||[],material_ids:item.material_ids||[],material_refs:item.material_refs||[],evidence_source_ids:item.evidence_source_ids||[],evidence_source_refs:item.evidence_source_refs||[],evidence_levels:item.evidence_levels||[],writing_role:kind==='anomaly'?'opening_conflict':kind==='interest_conflict'?'mechanism':'reader_impact',
      });
    }));
  });
  relations.forEach((item,index)=>{
    const statement=researchPointText(item);if(!statement)return;
    const kind=item.relation_kind||'comparison';
    add({
      point_id:String(item.relation_id||`inter_event:${kind}:${index}`),scope:'inter_event',kind,label:item.relation_label||({sequence:'前后关系',response:'回应关系',comparison:'对比关系',trend:'趋势关系',counterexample:'反例关系'}[kind]||'事件间关系'),statement,
      expected:Array.isArray(item.differences)?item.differences.join('；'):'',difference:Array.isArray(item.differences)?item.differences.join('；'):'',impact:item.insight||'',why_it_matters:item.insight||'',comparison_basis:item.comparison_basis||[],evidence_boundary:item.evidence_boundary||'',confidence:item.confidence||'',event_ids:item.event_ids||[],reference_event_ids:item.reference_event_ids||[],event_title:(item.event_ids||[]).map((id)=>names.get(String(id))).filter(Boolean).join('、'),relation_id:item.relation_id||'',relation_refs:item.relation_refs||[],evidence_source_ids:item.evidence_source_ids||[],evidence_source_refs:item.evidence_source_refs||[],evidence_levels:item.evidence_levels||[],writing_role:kind==='counterexample'?'counterexample':kind==='comparison'?'mechanism':'reader_impact',
    });
  });
  return options;
}

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
    reference_event_ids: list(item.reference_event_ids),
    relationship_statement: item.relationship_statement,
    differences: list(item.differences),
    confidence: item.confidence,
    evidence_source_ids: list(item.evidence_source_ids),
    evidence_levels: list(item.evidence_levels),
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
    evidence_source_ids: list(item.evidence_source_ids),
    evidence_levels: list(item.evidence_levels),
  })).filter((item) => item.candidate_title || item.core_question || item.angle || item.thesis_seed);
  const materials = list(context.verified_research_materials || context.research_materials).map((item) => ({
    material_id: item.material_id,
    material_type: item.material_type,
    status: item.status,
    anchor_event_ids: list(item.anchor_event_ids || item.event_ids),
    reference_event_ids: list(item.reference_event_ids),
    statement: item.statement,
    expected: item.expected,
    observed: item.observed,
    gap: item.gap,
    parties: list(item.parties),
    difference: item.difference,
    comparison_basis: list(item.comparison_basis),
    interpretation: item.interpretation,
    writing_angles: list(item.writing_angles),
    thesis_seeds: list(item.thesis_seeds),
    question: item.question,
    evidence_source_ids: list(item.evidence_source_ids),
    evidence_levels: list(item.evidence_levels),
    confidence: item.confidence,
    report_markdown: item.report_markdown,
  })).filter((item) => item.material_id && ['verified', 'needs_review', 'model_reported'].includes(item.status));
  const reports = list(context.research_reports).map((item) => ({
    report_id: item.report_id || item.material_id,
    event_id: item.event_id,
    title: item.title,
    report_markdown: item.report_markdown,
  })).filter((item) => item.report_markdown);
  return {
    focus_topic: topics[0] || null,
    topic_candidates: topics,
    verified_research_materials: materials,
    internal_research: internal,
    inter_event_research: relations,
    selectable_research_points: buildEditorialResearchPointOptions(context),
    research_reports: reports,
    reference_events: list(context.reference_events).map((item) => ({
      reference_id: item.reference_id,
      reference_only: item.reference_only === true,
      anchor_event_ids: list(item.anchor_event_ids),
      target_relation_ids: list(item.target_relation_ids),
      target_signal: item.target_signal,
      title: item.title,
      url: item.url,
      summary: item.summary,
      content: item.content,
      source_id: item.source_id,
      evidence_level: item.evidence_level,
    })),
    evidence_boundary: context.evidence_boundary || null,
    scope: { events: list(context.scope?.events).map((event) => ({ event_id: event.event_id, title: event.title })) },
  };
}

function researchDrivenInstruction(researchBrief) {
  if (!researchBrief) return '当前没有可用的模型研判内容；按事件卡和来源事实推进，但不要自行编造反常、利益冲突或事件关系。';
  const topic = researchBrief.focus_topic;
  const basisCount = researchBrief.internal_research.length + researchBrief.inter_event_research.length;
  const reportCount = researchBrief.research_reports?.length || 0;
  if (!topic && !basisCount && !reportCount) return '当前没有可用的模型研判内容；按事件卡和来源事实推进，但不要自行编造反常、利益冲突或事件关系。';
  const materialCount = researchBrief.verified_research_materials?.length || 0;
  const pointCount = researchBrief.selectable_research_points?.length || 0;
  return `本轮必须以模型研判为提问主线（当前有 ${basisCount} 组结构化研判、${reportCount} 份单事件模型研判报告、${materialCount} 条模型研判素材）。${topic ? `优先围绕候选命题「${topic.candidate_title || topic.core_question || topic.angle}」确认作者是否接受、如何修改，不要让作者从空白开始泛泛回答。` : '先从单事件模型研判报告中的事件内或事件外素材中帮助作者形成写作判断。'} 研判点现在只作为事实、观点、角度和命题的讨论依据，页面默认不选，也不要在作者尚未明确角度和命题前选择研判点。先具体追问作者想解释哪一个反常、利益/成本/责任冲突、发散方向或事件间关系，并据此协助作者明确观点、角度和命题。角度和命题明确后，直接从 researchBrief 的 selectable_research_points 中挑选 1～3 条最能支撑当前命题的研判拓展点，调用 cap_editorial_research_select 工具写入当前选题；完整可选目录单独位于 research-selection-catalog（共 ${pointCount} 条），只能使用目录中的原样 point_id。工具会校验 point_id 是否属于当前研判，不需要再询问作者确认。工具返回后，说明每条点承担的写作作用，再用 research_basis 总结已选择的素材及其如何服务于文章。不能把所有素材自动选入，也不能自行构造研判点 ID；如果目录标记为截断或找不到合适点，不要猜 ID，也不要调用选择工具。每个问题都要明确引用对应素材中的事实落差、利益差异、影响、前后变化、回应、对比、趋势或反例。外部参考事件只能作为关系研判的参考材料，不能直接写成本文已确认事实。不得退回“你想写什么”“你的看法是什么”这类脱离研判的泛问。`;
}

function researchSelectionCatalog(points = []) {
  const compact = (statementLimit) => points.map((point) => ({
    point_id: point.point_id,
    scope: point.scope,
    kind: point.kind,
    label: point.label,
    event_id: point.event_id,
    event_ids: point.event_ids,
    event_title: point.event_title,
    relation_id: point.relation_id,
    statement: truncateAtBoundary(point.statement, statementLimit).text,
  }));
  let pointsForPrompt = compact(360);
  let serialized = JSON.stringify({ point_count: points.length, points: pointsForPrompt });
  if (serialized.length > RESEARCH_SELECTION_CATALOG_BUDGET) {
    pointsForPrompt = compact(180);
    serialized = JSON.stringify({ point_count: points.length, points: pointsForPrompt });
  }
  if (serialized.length > RESEARCH_SELECTION_CATALOG_BUDGET) {
    pointsForPrompt = points.map((point) => ({
      point_id: point.point_id,
      scope: point.scope,
      kind: point.kind,
      label: point.label,
      event_id: point.event_id,
      event_ids: point.event_ids,
      relation_id: point.relation_id,
    }));
    serialized = JSON.stringify({ point_count: points.length, points: pointsForPrompt });
  }
  return serialized;
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
  const selectableResearchPoints = researchBrief?.selectable_research_points || [];
  const researchBriefContext = researchBrief ? { ...researchBrief, selectable_research_points: undefined } : null;
  // 逐字段状态由代码从底稿推导并完整回显（所见即所判），模型只围绕不合格项提问
  const {ready,fields}=evaluateEditorialReadiness({candidate:current,editorial:current.editorial||{}});
  const fieldStatus=fields.map((field)=>`- ${field.label}（${field.required?'必填':'选填'}）：${field.value?`当前值「${field.value.slice(0,200)}」${field.ok?'，合格':'，不合格（占位符不算实质表态）'}`:'未填写'}`).join('\n');
  const researchInstruction = researchDrivenInstruction(researchBrief);
  const instruction=answer.trim()?`处理用户刚才的回答；需要更新底稿字段时调用 cap_agent_form_update，使用 operations:[{field,op,value/values}]；${researchInstruction} 若仍有不合格的必填项，围绕依赖链（事实→观点→角度→命题→采用研判拓展点→研判主线→边界）上最靠前的一个不合格必填项提出下一个问题。`: (current.messages?.length?`用户本轮未输入新内容，不是重新开始。基于当前底稿继续推进：${researchInstruction} 需要更新底稿字段时调用 cap_agent_form_update，使用 operations:[{field,op,value/values}]；有不合格必填项则按依赖链顺序提问最靠前的一个；全部合格则说明底稿已可成稿，直接告知作者。`:`编辑会刚开始。先用一两句话概括事件卡与来源已给出的事实基座，再用具体研判依据帮助作者形成观点、角度和命题。${researchInstruction} 按依赖链（事实→观点→角度→命题→采用研判拓展点→研判主线→边界）提出第一个关键问题。${current.editorial?.editor_question?`选题编排阶段预置的首问供参考：${current.editorial.editor_question}`:''}`);
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
      researchBrief: researchBriefContext,
      currentEditorial:current.editorial,fieldStatus,ready})},
    {role:'user',protected:true,content:delimitUntrusted('research-selection-catalog',researchSelectionCatalog(selectableResearchPoints),RESEARCH_SELECTION_CATALOG_BUDGET)},
    ...trimConversation(current.messages),
    {role:'user',protected:true,content:instruction},
  ];
}

export function finalizeEditorialResult({store,candidateId,current,reply='',result={}}) {
  const assistantReply=String(reply||'').trim();
  const latest=store.getCandidate(candidateId);
  if(latest?.status==='locked'||latest?.editorial?.brief_status==='LOCKED'){
    if(assistantReply)store.addEditorialMessage(candidateId,'assistant',assistantReply);
    return {candidate:store.getCandidate(candidateId),editorial:latest.editorial,usage:result.usage,model:result.model,reply:assistantReply,ignoredBecauseLocked:true};
  }
  // 表单和研判采用点已经由业务工具直接写入；这里只刷新状态和保存最终回复。
  const base=latest||current;
  const mergedCandidate=store.getCandidate(candidateId)||base;
  // 就绪由代码推导：必填表单项填好即可成稿，不由模型声明。
  const readiness=evaluateEditorialReadiness({candidate:mergedCandidate,editorial:mergedCandidate.editorial||{}});
  const editorial=store.saveEditorial(candidateId,{...(mergedCandidate.editorial||{}),
    editor_question:'',open_questions:readiness.missing.join('；'),
    next_action:readiness.ready?'WRITE_NOW':'DISCUSS',brief_status:readiness.ready?'WRITE_NOW':'DISCUSS'});
  if(assistantReply)store.addEditorialMessage(candidateId,'assistant',assistantReply);
  return {candidate:store.getCandidate(candidateId),editorial,readiness,usage:result.usage,model:result.model,reply:assistantReply};
}
