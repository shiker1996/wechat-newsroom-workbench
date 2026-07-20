import { formatAccountContext } from '../account-context.mjs';

const ACTIONS=new Set(['DISCUSS','WRITE_NOW','TEST_FIRST','RESEARCH_FIRST','DROP']);

function parseResult(result,store) {
  try { return JSON.parse(result.content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')); }
  catch(error) {
    const reason=result.finishReason==='length'?'编辑会输出达到上限,JSON 被截断':`编辑会返回无效 JSON:${error.message}`;
    store.updateModelCall(result.callId,{status:'invalid_output',error:reason}); throw new Error(reason);
  }
}

const ACCOUNT_CTX=formatAccountContext();
const SYSTEM=`你是公众号编辑会主持人。一次只提出一个最能改变文章方向、事实边界或实践路线的问题。用户沉默不等于确认;不得替作者编造观点、经历、事实或实验结果。

${ACCOUNT_CTX}

输入中的 sourceEvidence 是服务端从原始 URL 抓取并保留 provenance 的公共资料快照。
- 对于**综合选题**(多个热点合成一篇),sourceEvidence 是一个数组,每项对应一个热点来源。
- 对于**单热点选题**,sourceEvidence 是单一条目。

可以把其中明确出现的内容记录为"据该来源报道"的公共事实,不得再要求用户亲自阅读或确认这些原文事实。可靠媒体原文、官方材料或一手资料任一项均可支持"该来源如此报道",不得自行强制要求两家媒体交叉验证;只有要把单源报道升级为无条件客观结论、或存在冲突与高风险时才提出补证要求。来源事实与作者观点必须分开,来源不能替作者决定立场。

当 sourceEvidence 已存在时,历史对话中"无法访问链接、只能依赖用户确认"等说法已过时,必须以当前来源快照为准,不得重复该限制。
若 sourceEvidence 整体状态为 error/partial 且材料不足,将 next_action 设为 RESEARCH_FIRST,并提出一个具体补研究问题;不要反复要求用户替机器确认公开事实。若来源足以确认表面新闻,但不足以支撑候选的宽泛命题,应直接追问命题边界或调整角度,而不是重新验证标题。

读取当前决策和对话后返回严格JSON:{"assistantReply":字符串,"nextQuestion":字符串,"candidateUpdates":{"angle":字符串,"thesis":字符串},"editorial":{"confirmed_facts":字符串,"author_opinions":字符串,"confirmed_experiences":字符串,"rejected_angles":字符串,"open_questions":字符串,"forbidden_claims":字符串,"next_action":"DISCUSS|WRITE_NOW|TEST_FIRST|RESEARCH_FIRST|DROP","experience_required":布尔}}。
assistantReply先简短复述本轮确认/未确认内容,再说明为何要问下一个问题。nextQuestion只能有一个问题;若next_action为WRITE_NOW或DROP则必须为空。只有用户明确确认且事实/作者材料足够时才能WRITE_NOW。公共资料分析可以experience_required=false,但必须禁止第一人称亲测。不要输出JSON之外的文字。`;

function requestMessages(current,answer) {
  const webSearchContext = '如有联网搜索信息已在对话开头提供。联网搜索结果为当前实时公开资料，视为额外的 sourceEvidence。';
  const sourceEvidence = current.composite ?
    (current.source_documents||[]).map(sd => {
      const doc=sd.source;
      return doc ? { status:doc.status, url:doc.final_url||doc.url||sd.url, title:doc.title||sd.title,
        description:doc.description, author:doc.author, publishedAt:doc.published_at,
        fetchedAt:doc.fetched_at, error:doc.error,
        contentExcerpt:String(doc.content||'').slice(0,18000)
      } : { status:'missing',error:'尚未抓取原文',url:sd.url,title:sd.title };
    }) :
    (current.source_document ? { status:current.source_document.status, url:current.source_document.final_url||current.source_document.url,
      title:current.source_document.title, description:current.source_document.description, author:current.source_document.author,
      publishedAt:current.source_document.published_at, fetchedAt:current.source_document.fetched_at, error:current.source_document.error,
      contentExcerpt:String(current.source_document.content||'').slice(0,18000)
    } : { status:'missing', error:'尚未抓取原文' });
  return [{role:'system',content:SYSTEM+(webSearchContext?'  '+webSearchContext:''),protected:true},{role:'user',protected:true,content:JSON.stringify({
    candidate:{
      title:current.hotspot_title,url:current.url,category:current.category,riskLevel:current.risk_level,
      angle:current.angle,thesis:current.thesis,composite:Boolean(current.composite)
    },
    sourceEvidence,
    currentEditorial:current.editorial,conversation:current.messages.map(({role,content})=>({role,content})),
    instruction:answer.trim()?'处理用户刚才的回答并更新决策；然后只问一个下一问题。':'编辑会刚开始。读取候选后只提出第一个最关键问题。'} )}];
}

function applyResult({store,candidateId,current,parsed,result}) {
  const updates=parsed.editorial||{};
  const nextAction=ACTIONS.has(updates.next_action)?updates.next_action:'DISCUSS';
  const nextQuestion=nextAction==='WRITE_NOW'||nextAction==='DROP'?'':String(parsed.nextQuestion||'').trim();
  const editorial=store.saveEditorial(candidateId,{...current.editorial,
    confirmed_facts:String(updates.confirmed_facts??current.editorial.confirmed_facts),author_opinions:String(updates.author_opinions??current.editorial.author_opinions),
    confirmed_experiences:String(updates.confirmed_experiences??current.editorial.confirmed_experiences),rejected_angles:String(updates.rejected_angles??current.editorial.rejected_angles),
    open_questions:String(updates.open_questions??nextQuestion),forbidden_claims:String(updates.forbidden_claims??current.editorial.forbidden_claims),next_action:nextAction,
    experience_required:updates.experience_required==null?current.editorial.experience_required:(updates.experience_required?1:0),editor_question:nextQuestion,brief_status:nextAction});
  const candidateUpdates=parsed.candidateUpdates||{};
  store.updateCandidate(candidateId,{angle:String(candidateUpdates.angle??current.angle),thesis:String(candidateUpdates.thesis??current.thesis)});
  const reply=[String(parsed.assistantReply||'').trim(),nextQuestion].filter(Boolean).join('\n\n');
  if(reply)store.addEditorialMessage(candidateId,'assistant',reply);
  return {candidate:store.getCandidate(candidateId),editorial,usage:result.usage,model:result.model,reply};
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

export async function runEditorialTurn({gateway,store,candidateId,provider,answer='',webSearch=false}) {
  const candidate=store.getCandidate(candidateId); if(!candidate) throw new Error('候选不存在');
  if(candidate.editorial.brief_status==='LOCKED') throw new Error('简报已经锁定;如需改方向,请先建立新候选而不是暗改锁定决策');
  if(answer.trim()) store.addEditorialMessage(candidateId,'user',answer.trim());
  const current=store.getCandidate(candidateId); const providerConfig=gateway.config.providers[provider||gateway.config.defaultProvider];
  const result=await gateway.complete({provider,purpose:'editorial-room',batchId:candidate.batch_id,candidateId,maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens),jsonMode:true,webSearch,messages:requestMessages(current,answer)});
  return applyResult({store,candidateId,current,parsed:parseResult(result,store),result});
}

export async function runEditorialTurnStream({gateway,store,candidateId,provider,answer='',webSearch=false,onText=()=>{}}) {
  const candidate=store.getCandidate(candidateId);if(!candidate)throw new Error('候选不存在');
  if(candidate.editorial.brief_status==='LOCKED')throw new Error('简报已经锁定;如需改方向,请先建立新候选而不是暗改锁定决策');
  if(answer.trim())store.addEditorialMessage(candidateId,'user',answer.trim());
  const current=store.getCandidate(candidateId);const providerConfig=gateway.config.providers[provider||gateway.config.defaultProvider];let emitted='';
  const result=await gateway.streamComplete({provider,purpose:'editorial-room',batchId:candidate.batch_id,candidateId,maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens),jsonMode:true,webSearch,messages:requestMessages(current,answer)},
    (_delta,total)=>{const visible=visiblePartial(total);if(visible.startsWith(emitted)&&visible.length>emitted.length){onText(visible.slice(emitted.length));emitted=visible;}});
  const parsed=parseResult(result,store);const saved=applyResult({store,candidateId,current,parsed,result});
  if(saved.reply.startsWith(emitted)&&saved.reply.length>emitted.length)onText(saved.reply.slice(emitted.length));
  return saved;
}
