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

// 模型本轮是否把信息沉淀为决策底稿（briefUpdates 有实质变化）。
// 用户作答后字段冻结是"重复提问"的根因：回答没有沉淀，模型下一轮只能就同一决策点再问。
export function decisionFieldsTouched(parsed,current){
  const updates=parsed?.briefUpdates||{};
  for(const field of [...CANDIDATE_FIELDS,...BRIEF_TEXT_FIELDS,...BRIEF_KEEP_ON_EMPTY_FIELDS]){
    const next=updates[field];
    if(next==null||!String(next).trim())continue;
    const base=CANDIDATE_FIELDS.includes(field)?current?.[field]:current?.editorial?.[field];
    if(substantiveDecision(next)&&String(next)!==String(base??''))return true;
  }
  return false;
}

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
const ACCOUNT_CTX='';
const SYSTEM=`你是公众号编辑会主持人。事件卡与来源快照已经给出公共事实基座,你的提问按依赖链推进（先确认事实，再观点、角度、命题、边界）,一次只提出一个问题。用户沉默不等于确认;不得替作者编造观点、经历、事实或实验结果。

${ACCOUNT_CTX}

输入中的 events 是本选题关联的事件列表(选题与事件为一对多;单热点选题通常只有一个事件)。每个事件包含:
- eventCard:事件研判阶段预生成的事件卡(可能为 null),是机器整理材料而非作者决定。
- sources:该事件下各热点报道的原文快照,是按需深挖事件 why/how 细节的补充材料;事件卡已给出 what 层面的事实基座,status 为 missing 表示该来源尚未抓取,这是常态而非缺陷,不得仅因 sources 缺失就中断讨论或要求补研究。contentExcerpt 通常是"开头+与当前讨论最相关段落"的摘录而非全文,省略处以"…"标记;需要完整原文时使用系统提供的只读工具目录。

事实基座规则(重要):
- eventCard 的 confirmedFacts 与 sources 中明确出现的内容,直接视为已确认的公共事实,记录时标注"据事件研判"或"据该来源报道"即可,严禁再要求作者阅读、确认或背书这些公开事实。
- 可靠媒体原文、官方材料或一手资料任一项均可支持"该来源如此报道",不得自行强制要求两家媒体交叉验证;只有要把单源报道升级为无条件客观结论时才设界标注,而不是向作者求证。
- 当 sources 已有内容时,历史对话中"无法访问链接、只能依赖用户确认"等说法已过时,必须以当前来源快照为准,不得重复该限制。
- 只有当成稿需要补充事件的 why/how 细节(动机、机理、过程、数据原文),而事件卡与已有 sources 不足以回答时,才通过统一只读工具申请资料,或在提问中说明需要作者补充什么材料;除此之外不得要求作者替机器确认公开事实。

eventCard 其余字段用法:
- sourceIncrement 说明各来源分别贡献了什么增量,可用于判断来源是否重复。
- disagreements 是来源分歧,成稿时必须呈现或设界,不得抹平;默认按"呈现分歧"处理,不需要作者裁决事实对错。
- unverified 是待核内容,不得写成事实,默认进入 forbidden_claims 设界;只有当成稿命题必须依赖某个待核说法时,才作为补证问题提出。

提问方向(编辑会只问这些):
- 作者对事件的立场、判断、褒贬与理由(写入 author_opinions)。
- 角度取舍:哪个切入点、服务什么读者、放弃哪些角度(写入 rejected_angles)。
- 命题边界:文章最终要证明什么、不能写成什么(写入 thesis 与 forbidden_claims)。
- 实践证据:文章要用第一人称亲测口吻时,问作者有什么可验证的实践经历(写入 confirmed_experiences);没有则 confirmed_experiences 留空并全程禁止第一人称亲测。

综合选题必须厘清每个事件各自的事实边界,不得把不同事件的事实混为一谈。

编辑室决策底稿通过 briefUpdates 字段做增量更新，只写本轮有变化的字段:{"angle":字符串,"thesis":字符串,"confirmed_facts":字符串,"author_opinions":字符串,"confirmed_experiences":字符串,"rejected_angles":字符串,"forbidden_claims":字符串}。最终响应遵循后续 Agent 系统指令:{"type":"final","assistantReply":"...","briefUpdates":{...}},业务字段平铺在 final 信封顶层,不要再套 output 层。assistantReply 先用一两句话概括当前事实基座与本轮新确定的决策,再围绕不合格表单项提出下一个问题(全部合格则说明底稿已可成稿,直接告知作者)。用户每轮作答后必须把回答要点写入对应表单项(涉及角度/主线/命题的回答同时更新 angle/thesis);用户对趋势或事件的判断性表态(如"我认为X""Y站得住脚""X是技术失误")必须同时记入 author_opinions,不得只写进 thesis 后再追问立场;任何决策点一经用户明确表态即视为已决,不得换措辞再问;若作答后 briefUpdates 无任何实质更新,系统会强制补写,等同本轮无效。禁止写"待定/未定/暂无"类占位词——没有依据的字段直接省略。是否可成稿由系统根据表单项完整性判定,你不需要也不允许声明状态。不要输出JSON之外的文字。`;

// 编辑会 prompt 已技能化（skills/editorial-room）；账号上下文仍是代码注入的数据，
// 技能文本用 {{ACCOUNT_CONTEXT}} 占位符标出注入位置。技能缺失时回退上面的内联 SYSTEM。
function editorialSystem(workspaceRoot) {
  const { prompt } = selectionPrompt({ workspaceRoot, skillName:'editorial-room', fallback:SYSTEM });
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
      title:event.title,
      eventCard:event.card?{conclusion:event.card.conclusion,confirmedFacts:event.card.confirmed_facts||[],sourceIncrement:event.card.source_increment||[],disagreements:event.card.disagreements||[],unverified:event.card.unverified||[]}:null,
      sources
    });
  }
  // 逐字段状态由代码从底稿推导并完整回显（所见即所判），模型只围绕不合格项提问
  const {ready,fields}=evaluateEditorialReadiness({candidate:current,editorial:current.editorial||{}});
  const fieldStatus=fields.map((field)=>`- ${field.label}（${field.required?'必填':'选填'}）：${field.value?`当前值「${field.value.slice(0,200)}」${field.ok?'，合格':'，不合格（占位符不算实质表态）'}`:'未填写'}`).join('\n');
  return [{role:'system',content:editorialSystem(workspaceRoot)+(webSearchContext?'  '+webSearchContext:''),protected:true},{role:'user',protected:true,content:delimitUntrusted('editorial-context',{
    candidate:{
      title:current.hotspot_title,url:current.url,category:current.category,riskLevel:current.risk_level,
      angle:current.angle,thesis:current.thesis,composite:Boolean(current.composite)
    },
    events:eventInputs,
    currentEditorial:current.editorial,fieldStatus,ready,conversation:trimConversation(current.messages),
    instruction:answer.trim()?'处理用户刚才的回答并更新 briefUpdates；若仍有不合格的必填项，围绕依赖链（事实→观点→角度→命题→边界）上最靠前的一个不合格必填项提出下一个问题。':(current.messages?.length?'用户本轮未输入新内容，不是重新开始。基于当前底稿继续推进：有不合格必填项则按依赖链顺序提问最靠前的一个；全部合格则说明底稿已可成稿，直接告知作者。':'编辑会刚开始。先用一两句话概括事件卡与来源已给出的事实基座，然后按依赖链顺序（先确认事实，再观点、角度、命题、边界）提出第一个关键问题。'+(current.editorial?.editor_question?`选题编排阶段预置的首问供参考：${current.editorial.editor_question}`:''))} )}];
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
