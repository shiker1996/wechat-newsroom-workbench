import { formatAccountContext } from '../domain/account-context.mjs';
import { normalizeOpenQuestions } from '../domain/open-questions.mjs';
import { selectionPrompt } from './selection-prompts.mjs';

const ACTIONS=new Set(['DISCUSS','WRITE_NOW','TEST_FIRST','RESEARCH_FIRST','DROP']);

function parseResult(result,store) {
  try { return JSON.parse(result.content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')); }
  catch(error) {
    const reason=result.finishReason==='length'?'编辑会输出达到上限,JSON 被截断':`编辑会返回无效 JSON:${error.message}`;
    store.updateModelCall(result.callId,{status:'invalid_output',error:reason}); throw new Error(reason);
  }
}

const ACCOUNT_CTX=formatAccountContext();
const SYSTEM=`你是公众号编辑会主持人。事件卡与来源快照已经给出公共事实基座,你的提问只围绕作者观点、角度取舍、实践证据与命题边界,一次只提出一个最能改变文章方向的问题。用户沉默不等于确认;不得替作者编造观点、经历、事实或实验结果。

${ACCOUNT_CTX}

输入中的 events 是本选题关联的事件列表(选题与事件为一对多;单热点选题通常只有一个事件)。每个事件包含:
- eventCard:事件研判阶段预生成的事件卡(可能为 null),是机器整理材料而非作者决定。
- sources:该事件下各热点报道的原文快照,是按需深挖事件 why/how 细节的补充材料;事件卡已给出 what 层面的事实基座,status 为 missing 表示该来源尚未抓取,这是常态而非缺陷,不得仅因 sources 缺失就中断讨论或要求补研究。contentExcerpt 通常是"开头+与当前讨论最相关段落"的摘录而非全文,省略处以"…"标记;需要完整原文时可在 fetchEvents 中点名。

事实基座规则(重要):
- eventCard 的 confirmedFacts 与 sources 中明确出现的内容,直接视为已确认的公共事实,记录时标注"据事件研判"或"据该来源报道"即可,严禁再要求作者阅读、确认或背书这些公开事实。
- 可靠媒体原文、官方材料或一手资料任一项均可支持"该来源如此报道",不得自行强制要求两家媒体交叉验证;只有要把单源报道升级为无条件客观结论时才设界标注,而不是向作者求证。
- 当 sources 已有内容时,历史对话中"无法访问链接、只能依赖用户确认"等说法已过时,必须以当前来源快照为准,不得重复该限制。
- 只有当成稿需要补充事件的 why/how 细节(动机、机理、过程、数据原文),而事件卡与已有 sources 不足以回答时,在 fetchEvents 字段列出需要原文的事件 event_id(系统会自动抓取并在下一轮提供原文),或将 next_action 设为 RESEARCH_FIRST 并提出一个具体补研究问题;除此之外不得要求作者替机器确认公开事实。

eventCard 其余字段用法:
- sourceIncrement 说明各来源分别贡献了什么增量,可用于判断来源是否重复。
- disagreements 是来源分歧,成稿时必须呈现或设界,不得抹平;默认按"呈现分歧"处理,不需要作者裁决事实对错。
- unverified 是待核内容,不得写成事实,默认进入 forbidden_claims 设界;只有当成稿命题必须依赖某个待核说法时,才作为补证问题提出。

提问方向(编辑会只问这些):
- 作者对事件的立场、判断、褒贬与理由(写入 author_opinions)。
- 角度取舍:哪个切入点、服务什么读者、放弃哪些角度(写入 rejected_angles)。
- 命题边界:文章最终要证明什么、不能写成什么(写入 thesis 与 forbidden_claims)。
- 实践证据:题目依赖亲身实践时,问作者有什么可验证的实践经历(写入 confirmed_experiences;没有则 experience_required=false 并禁止第一人称亲测)。

综合选题必须厘清每个事件各自的事实边界,不得把不同事件的事实混为一谈。

读取当前决策和对话后返回严格JSON:{"assistantReply":字符串,"nextQuestion":字符串,"candidateUpdates":{"angle":字符串,"thesis":字符串},"editorial":{"confirmed_facts":字符串,"author_opinions":字符串,"confirmed_experiences":字符串,"rejected_angles":字符串,"open_questions":字符串,"forbidden_claims":字符串,"next_action":"DISCUSS|WRITE_NOW|TEST_FIRST|RESEARCH_FIRST|DROP","experience_required":布尔},"fetchEvents":[需要抓取原文的 event_id 字符串,不需要则为空数组]}。
assistantReply 先用一两句话概括当前事实基座与本轮新确定的决策,再说明为何要问下一个问题;不要把事件卡和来源里已有的事实说成"未确认"。nextQuestion只能有一个问题;若next_action为WRITE_NOW或DROP则必须为空。open_questions 只写真正未决的问题;没有未决问题时必须是空字符串"",不要写"无"或补充说明(系统按空串判定清零)。只有作者观点、角度与命题边界明确且事实基座齐备时才能WRITE_NOW。公共资料分析可以experience_required=false,但必须禁止第一人称亲测。不要输出JSON之外的文字。`;

// 编辑会 prompt 已技能化（skills/editorial-room）；账号上下文仍是代码注入的数据，
// 技能文本用 {{ACCOUNT_CONTEXT}} 占位符标出注入位置。技能缺失时回退上面的内联 SYSTEM。
function editorialSystem(workspaceRoot) {
  const { prompt } = selectionPrompt({ workspaceRoot, skillName:'editorial-room', fallback:SYSTEM });
  return prompt.replaceAll('{{ACCOUNT_CONTEXT}}', ACCOUNT_CTX);
}

// 单源摘录预算：长正文经由 content.passage.retrieve 检索压缩（头部+相关段落），
// 检索不可用或失败时回退为头部截断。
const EXCERPT_BUDGET=8000;
const EXCERPT_OPTIONS={k:6,headChars:1500,chunkChars:500,maxCharsPerDoc:EXCERPT_BUDGET};

async function sourceExcerpt(hotspot,retrieve,query) {
  const content=String(hotspot.sourceDoc?.content||'');
  if(!retrieve||content.length<=EXCERPT_BUDGET)return content.slice(0,18000);
  try{
    const selections=await retrieve({documents:[{id:String(hotspot.id),content}],query,...EXCERPT_OPTIONS});
    const found=Array.isArray(selections)?selections.find((s)=>s.id===String(hotspot.id)):null;
    if(found?.excerpt)return found.excerpt;
  }catch{/* 检索失败回退截断 */}
  return content.slice(0,EXCERPT_BUDGET);
}

async function requestMessages(current,answer,events=[],retrieve=null,workspaceRoot) {
  const webSearchContext = '如有联网搜索信息已在对话开头提供。联网搜索结果为当前实时公开资料，视为额外的 sources。';
  const query=[answer,current.editorial?.editor_question||''].filter(Boolean).join('\n');
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
  return [{role:'system',content:editorialSystem(workspaceRoot)+(webSearchContext?'  '+webSearchContext:''),protected:true},{role:'user',protected:true,content:JSON.stringify({
    candidate:{
      title:current.hotspot_title,url:current.url,category:current.category,riskLevel:current.risk_level,
      angle:current.angle,thesis:current.thesis,composite:Boolean(current.composite)
    },
    events:eventInputs,
    currentEditorial:current.editorial,conversation:current.messages.map(({role,content})=>({role,content})),
    instruction:answer.trim()?'处理用户刚才的回答并更新决策；然后只问一个下一问题。':'编辑会刚开始。先用一两句话概括事件卡与来源已给出的事实基座，然后只问第一个关于作者观点或角度取舍的关键问题。'} )}];
}

function applyResult({store,candidateId,current,parsed,result}) {
  const updates=parsed.editorial||{};
  const nextAction=ACTIONS.has(updates.next_action)?updates.next_action:'DISCUSS';
  const nextQuestion=nextAction==='WRITE_NOW'||nextAction==='DROP'?'':String(parsed.nextQuestion||'').trim();
  const editorial=store.saveEditorial(candidateId,{...current.editorial,
    confirmed_facts:String(updates.confirmed_facts??current.editorial.confirmed_facts),author_opinions:String(updates.author_opinions??current.editorial.author_opinions),
    confirmed_experiences:String(updates.confirmed_experiences??current.editorial.confirmed_experiences),rejected_angles:String(updates.rejected_angles??current.editorial.rejected_angles),
    open_questions:normalizeOpenQuestions(updates.open_questions??nextQuestion),forbidden_claims:String(updates.forbidden_claims??current.editorial.forbidden_claims),next_action:nextAction,
    experience_required:updates.experience_required==null?current.editorial.experience_required:(updates.experience_required?1:0),editor_question:nextQuestion,brief_status:nextAction});
  const candidateUpdates=parsed.candidateUpdates||{};
  store.updateCandidate(candidateId,{angle:String(candidateUpdates.angle??current.angle),thesis:String(candidateUpdates.thesis??current.thesis)});
  const reply=[String(parsed.assistantReply||'').trim(),nextQuestion].filter(Boolean).join('\n\n');
  if(reply)store.addEditorialMessage(candidateId,'assistant',reply);
  const fetchEvents=(Array.isArray(parsed.fetchEvents)?parsed.fetchEvents:[]).map(String).filter(Boolean).slice(0,3);
  return {candidate:store.getCandidate(candidateId),editorial,usage:result.usage,model:result.model,reply,fetchEvents};
}

function partialString(content,key) {
  const match=new RegExp(`"${key}"\\s*:\\s*"`).exec(content);if(!match)return '';
  let raw='';let escaped=false;
  for(let i=match.index+match[0].length;i<content.length;i+=1){const char=content[i];if(!escaped&&char==='"')break;raw+=char;if(escaped)escaped=false;else if(char==='\\')escaped=true;}
  if(raw.endsWith('\\'))raw=raw.slice(0,-1);
  try{return JSON.parse(`"${raw}"`);}catch{return raw.replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/\\\\/g,'\\');}
}

function visiblePartial(content) {
  return [partialString(content,'assistantReply'),partialString(content,'nextQuestion')].filter(Boolean).join('\n\n');
}

export async function runEditorialTurn({gateway,store,candidateId,provider,answer='',webSearch=false,events=[],retrieve=null,workspaceRoot}) {
  const candidate=store.getCandidate(candidateId); if(!candidate) throw new Error('候选不存在');
  if(candidate.editorial.brief_status==='LOCKED') throw new Error('简报已经锁定;如需改方向,请先建立新候选而不是暗改锁定决策');
  if(answer.trim()) store.addEditorialMessage(candidateId,'user',answer.trim());
  const current=store.getCandidate(candidateId); const providerConfig=gateway.config.providers[provider||gateway.config.defaultProvider];
  const result=await gateway.complete({provider,purpose:'editorial-room',batchId:candidate.batch_id,candidateId,maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens),jsonMode:true,webSearch,messages:await requestMessages(current,answer,events,retrieve,workspaceRoot)});
  return applyResult({store,candidateId,current,parsed:parseResult(result,store),result});
}

export async function runEditorialTurnStream({gateway,store,candidateId,provider,answer='',webSearch=false,events=[],retrieve=null,workspaceRoot,onText=()=>{}}) {
  const candidate=store.getCandidate(candidateId);if(!candidate)throw new Error('候选不存在');
  if(candidate.editorial.brief_status==='LOCKED')throw new Error('简报已经锁定;如需改方向,请先建立新候选而不是暗改锁定决策');
  if(answer.trim())store.addEditorialMessage(candidateId,'user',answer.trim());
  const current=store.getCandidate(candidateId);const providerConfig=gateway.config.providers[provider||gateway.config.defaultProvider];let emitted='';
  const result=await gateway.streamComplete({provider,purpose:'editorial-room',batchId:candidate.batch_id,candidateId,maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens),jsonMode:true,webSearch,messages:await requestMessages(current,answer,events,retrieve,workspaceRoot)},
    (_delta,total)=>{const visible=visiblePartial(total);if(visible.startsWith(emitted)&&visible.length>emitted.length){onText(visible.slice(emitted.length));emitted=visible;}});
  const parsed=parseResult(result,store);const saved=applyResult({store,candidateId,current,parsed,result});
  if(saved.reply.startsWith(emitted)&&saved.reply.length>emitted.length)onText(saved.reply.slice(emitted.length));
  return saved;
}
