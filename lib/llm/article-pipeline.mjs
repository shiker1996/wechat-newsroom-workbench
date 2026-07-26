import fs from 'node:fs';
import path from 'node:path';
import { planImagePlaceholders } from './image-workflow.mjs';
import { scoreKeywords } from './seo-score.mjs';
import { formatAccountContext } from '../domain/account-context.mjs';
import { loadArticleSkillBundle, loadSkillBundle } from './skill-runtime.mjs';
import { batchTopicsDir, candidateArticleDir } from '../core/workspace-paths.mjs';

function writeFile(filePath,content) { fs.mkdirSync(path.dirname(filePath),{recursive:true}); const temp=`${filePath}.tmp`; fs.writeFileSync(temp,String(content).trimEnd()+'\n','utf8'); fs.renameSync(temp,filePath); return fs.statSync(filePath); }
function cleanMarkdown(value) { return String(value||'').trim().replace(/^```(?:markdown)?\s*/i,'').replace(/\s*```$/,''); }
function visibleChars(markdown) { return markdown.replace(/^#.*$/gm,'').replace(/<!--[^]*?-->/g,'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_`>#-]/g,'').replace(/\s/g,'').length; }
function asArray(value,{emptyWords=false}={}) {
  if(Array.isArray(value))return value.filter((item)=>item!=null&&String(item).trim()!=='');
  if(value==null)return [];
  if(typeof value==='string'){
    const text=value.trim();if(!text)return [];
    if(emptyWords&&/^(?:none|null|无|暂无|没有|无剩余风险|n\/a)$/i.test(text))return [];
    return text.split(/\r?\n|[、；;]+/).map((item)=>item.replace(/^[-*•\d.、)\s]+/,'').trim()).filter(Boolean);
  }
  if(typeof value==='object')return [value];
  return [value];
}
export function normalizePlanningResult(input={}) {
  const plan=input&&typeof input==='object'&&!Array.isArray(input)?{...input}:{};
  plan.expectedAction=asArray(plan.expectedAction);
  plan.coreKeywords=asArray(plan.coreKeywords);
  plan.remainingRisks=asArray(plan.remainingRisks,{emptyWords:true});
  plan.titleCandidates=asArray(plan.titleCandidates).map((item)=>typeof item==='string'?{title:item,reason:''}:item).filter((item)=>item&&item.title);
  return plan;
}
function issueList(value) { return asArray(value).map((item)=>typeof item==='string'?item:(item?.message||JSON.stringify(item))); }
function normalizeUrl(value) { return String(value||'').trim().replace(/\/+$/,'').toLowerCase(); }
// 来源缓存校验：编辑室粘贴的替代来源会写入热点缓存，若与热点原文 URL 不一致则不能带病成稿。
export function sourceCacheIssue(candidate,sourceDoc) {
  if(!sourceDoc?.content||candidate?.composite)return null;
  const expected=normalizeUrl(candidate?.url); const actual=normalizeUrl(sourceDoc.url||sourceDoc.final_url);
  if(!expected||!actual||expected===actual)return null;
  return `来源缓存与热点原文不一致（缓存为 ${sourceDoc.url}，热点为 ${candidate.url}），编辑室粘贴的替代来源可能已覆盖原缓存；请重新抓取热点原文或回编辑室确认来源后再成稿`;
}
// 事实基座确定性检查：全部事实性主张均未核实时，成稿必然被质量门禁拦截，提前报可操作错误。
export function unverifiedFactBaseIssue(factBase) {
  const claims=Array.isArray(factBase?.claims)?factBase.claims:[];
  const factual=claims.filter((item)=>item&&item.status!=='opinion');
  if(!factual.length||!factual.every((item)=>item.status==='unverified'))return null;
  const missing=asArray(factBase?.missingEvidence).join('；');
  return `事实基座中所有事实性主张均未核实${missing?`（待补：${missing}）`:''}，无法成稿；请抓取可核对的原文或回编辑室调整命题后再试`;
}
export const ARTICLE_LENGTH_RANGE=Object.freeze({min:1300,max:1800});
function parseJsonResult(result,store) {
  const raw=result.content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(raw);}catch(error){
    // Try to find a valid JSON block inside the output
    const braceMatch=raw.match(/(\{[\s\S]*\})/);
    if(braceMatch)try{return JSON.parse(braceMatch[1]);}catch{}
    const reason=result.finishReason==='length'?'成稿规划输出达到上限,JSON被截断':`成稿规划返回无效JSON:${error.message}`;
    store.updateModelCall(result.callId,{status:'invalid_output',error:reason});throw new Error(reason);
  }
}

function artifact(store,batchId,kind,name,filePath) { const stat=fs.statSync(filePath); store.upsertArtifact({batchId,kind,name,path:filePath,size:stat.size,modifiedAt:stat.mtime.toISOString()}); }
function writerSkill(candidate) {
  if(candidate.composite)return 'wechat-mp-composite';
  if(candidate.category==='🤖 AI/技术动态')return 'wechat-mp-tech-hotspot';
  if(candidate.category==='🏢 大厂战略'&&/趣|离谱|八卦/.test(candidate.angle||''))return 'wechat-mp-gossip-chill';
  return 'wechat-mp-deep-dive';
}

export const ARTICLE_STAGE_CONTRACT = Object.freeze([
  { id:'brief', skill:'wechat-mp-topic-to-article' },
  { id:'fact-base', skill:'wechat-mp-topic-to-article' },
  { id:'planning', skill:'wechat-mp-topic-to-article' },
  { id:'drafting', skill:'$writer' },
  { id:'draft-quality-gate', skill:'article-reviewer' },
  { id:'title-generation', skill:'title-generator' },
  { id:'humanize', skill:'humanizer-zh' },
  { id:'review', skill:'article-reviewer' },
  { id:'seo-keyword-scoring', skill:'seo-keyword-scoring' },
  { id:'seo-optimization', skill:'seo-content-optimizer' },
  { id:'final-quality-gate', skill:'article-reviewer' },
  { id:'image-planning', skill:'article-image-placeholders' },
]);

export function buildArticleStageSystem(orchestrator, stage, ...children) {
  const total = String(orchestrator?.prompt || '').trim();
  if (!total) throw new Error('项目成稿总技能缺失，无法执行');
  const childPrompts = children.flat().filter((bundle) => bundle?.prompt).map((bundle) => bundle.prompt);
  return [total, ...childPrompts, `## 当前运行阶段\n\n只执行 \`${stage}\` 阶段，严格遵守总契约中该阶段的输入、输出和门禁；不要提前执行其它阶段。`].join('\n\n---\n\n');
}

async function textCall(gateway,input,system,user,maxOutputTokens=5000) {
  const systemContent = String(system || '').trim();
  const userContent = String(user || '').trim();
  if (!systemContent || !userContent) throw new Error('成稿请求消息为空，无法提交模型');
  return gateway.complete({...input,maxOutputTokens,messages:[{role:'system',content:systemContent,protected:true},{role:'user',content:userContent,protected:true}]});
}

async function aiQualityGate({gateway,store,provider,batchId,candidateId,article,factBase,sourceText='',systemPrompt,stage,maxOutputTokens=3500}) {
  const result=await gateway.complete({provider,purpose:`article-quality-gate-${stage}`,batchId,candidateId,jsonMode:true,maxOutputTokens,messages:[
    {role:'system',protected:true,content:systemPrompt},
    {role:'user',protected:true,content:`事实基座：${JSON.stringify(factBase)}\n\n已抓取来源原文（供核对；事实基座可能未穷尽其中数据，文章中能被来源原文直接支持的表述视为有来源）：\n${String(sourceText||'').slice(0,12000)||'（无）'}\n\n待检查文章：\n${article}`},
  ]});
  return parseJsonResult(result,store);
}

export function articleLengthStatus(article) {
  const count=visibleChars(article);
  return {count,valid:count>=ARTICLE_LENGTH_RANGE.min&&count<=ARTICLE_LENGTH_RANGE.max,
    shortfall:Math.max(0,ARTICLE_LENGTH_RANGE.min-count),overflow:Math.max(0,count-ARTICLE_LENGTH_RANGE.max)};
}

async function fitArticleLength({gateway,provider,batchId,candidateId,article,factBase,systemPrompt,purpose,maxOutputTokens=5000,onProgress=()=>{},maxAttempts=3}) {
  let current=article;
  let best=article;
  const distance=(value)=>{
    const {count}=articleLengthStatus(value);
    if(count<ARTICLE_LENGTH_RANGE.min)return ARTICLE_LENGTH_RANGE.min-count;
    if(count>ARTICLE_LENGTH_RANGE.max)return count-ARTICLE_LENGTH_RANGE.max;
    return 0;
  };
  for(let attempt=1;attempt<=maxAttempts;attempt+=1){
    const status=articleLengthStatus(current);
    if(status.valid)return current;
    const tooShort=status.count<ARTICLE_LENGTH_RANGE.min;
    const direction=tooShort
      ? `补充必要的事实解释、因果链、反方边界和读者可执行信息；当前至少还差 ${status.shortfall} 个可见字符`
      : `压缩重复背景、次要案例和同义结论；当前至少需要减少 ${status.overflow} 个可见字符`;
    onProgress(`长度修复 ${attempt}/${maxAttempts}：当前 ${status.count} 字`);
    const result=await textCall(gateway,{provider,purpose:`${purpose}-${attempt}`,batchId,candidateId},systemPrompt,
      `将下文调整到 1450–1650 个可见字符的安全区间（硬门禁为 ${ARTICLE_LENGTH_RANGE.min}–${ARTICLE_LENGTH_RANGE.max}），当前为 ${status.count}。请${direction}。

这是第 ${attempt}/${maxAttempts} 次长度修复。必须输出完整文章，不能只输出新增段落或修改说明。只能使用给定事实基座支持的信息；不得新增事实、数字、引语、案例或作者亲历；保留唯一 H1 标题、核心立场、关键来源、风险边界和原有 3–5 个 H2 结构。只输出调整后的完整 Markdown 正文。

事实基座：${JSON.stringify(factBase)}

待调整文章：
${current}`,maxOutputTokens);
    const repaired=cleanMarkdown(result.content).replace(/<!--\s*REVIEW[\s\S]*?-->/gi,'').trim();
    if(!repaired)continue;
    current=repaired;
    if(distance(current)<distance(best))best=current;
  }
  return articleLengthStatus(current).valid?current:best;
}

export function buildDraftUserPrompt(selectedTitle, brief, outline) {
  return `标题:${selectedTitle}\n\n锁定简报与事实基座:${JSON.stringify(brief)}\n\n大纲:\n${outline}`;
}

export async function runArticlePipeline({gateway,store,batchId,candidateId,provider,workspaceRoot,onProgress=()=>{}}) {
  const candidate=store.getCandidate(candidateId); if(!candidate||candidate.batch_id!==batchId)throw new Error('候选不存在或不属于当前批次');
  const editorial=candidate.editorial;
  if(editorial.brief_status!=='LOCKED'||editorial.next_action!=='WRITE_NOW')throw new Error('必须先完成编辑会并锁定 article-brief.md');
  if(editorial.open_questions.trim())throw new Error('仍有未决问题,不能进入成稿');
  if(editorial.experience_required&&!editorial.confirmed_experiences.trim())throw new Error('本题依赖亲身实践,但尚无已确认经历或证据');
  if(!editorial.confirmed_facts.trim())throw new Error('事实基座为空,请回到编辑室确认可写事实和来源');
  if(candidate.f_score!=null&&candidate.f_score<55)throw new Error(`候选 F=${candidate.f_score},低于成稿硬门槛 55`);
  const batch=store.getBatch(batchId); const workdir=candidateArticleDir(workspaceRoot,batch,candidate);
  fs.mkdirSync(workdir,{recursive:true}); const providerConfig=gateway.config.providers[provider||gateway.config.defaultProvider];
  const sourceUrls=candidate.composite?(candidate.hotspots||[]).map((h)=>h.title+" ("+(h.url||"无 URL")+")").join(String.fromCharCode(10)):
    (candidate.materials?.length?candidate.materials.map((item)=>item.url).join(String.fromCharCode(10)):candidate.url);
  const brief={candidateId:candidate.candidate_id,topic:candidate.hotspot_title,sourceUrl:sourceUrls,category:candidate.category,score:candidate.f_score,
    angle:candidate.angle,thesis:candidate.thesis,confirmedFacts:editorial.confirmed_facts,authorOpinions:editorial.author_opinions,
    confirmedExperiences:editorial.confirmed_experiences,rejectedAngles:editorial.rejected_angles,forbiddenClaims:editorial.forbidden_claims,
    experienceRequired:Boolean(editorial.experience_required),composite:Boolean(candidate.composite)};
  // 将已抓取的原始来源一并交给规划器，禁止模型凭常识补写日期、任职经历和合同细节。
  try {
    const cacheFile = path.join(workspaceRoot, 'data', 'source-cache', `${candidate.hotspot_id}.json`);
    if (fs.existsSync(cacheFile)) {
      const sourceDoc = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (sourceDoc?.content) {
        const mismatch=sourceCacheIssue(candidate,sourceDoc);
        if(mismatch)throw Object.assign(new Error(mismatch),{fatalSourceCache:true});
        brief.sourceText = String(sourceDoc.content).slice(0, 18000);
      }
    }
  } catch (error) { if(error?.fatalSourceCache)throw error; }
  const chosenWriterSkill = writerSkill(candidate);
  const orchestratorSkill = loadSkillBundle({ workspaceRoot, skillName:'wechat-mp-topic-to-article' });
  const writerSkillBundle = loadSkillBundle({ workspaceRoot, skillName:chosenWriterSkill });
  const skillBundle = loadArticleSkillBundle({ workspaceRoot, writerSkill: chosenWriterSkill });
  const stageSkills=Object.fromEntries(['title-generator','humanizer-zh','article-reviewer','seo-keyword-scoring','seo-content-optimizer','article-image-placeholders'].map((name)=>[name,loadSkillBundle({workspaceRoot,skillName:name})]));
  const stageExecutions=[];
  const recordStage=(stage,bundle,inputArtifacts,outputArtifact,gate='passed')=>{
    const expected=ARTICLE_STAGE_CONTRACT[stageExecutions.length];
    const actualSkill=bundle.skillName||bundle.writerSkill;
    const expectedSkill=expected?.skill==='$writer'?chosenWriterSkill:expected?.skill;
    if(!expected||expected.id!==stage||expectedSkill!==actualSkill)throw new Error(`成稿契约阶段不一致：期望 ${expected?.id||'结束'}/${expectedSkill||'-'}，实际 ${stage}/${actualSkill}`);
    stageExecutions.push({stage,skill:actualSkill,skillHash:bundle.hash,skillFiles:bundle.files,inputArtifacts,outputArtifact,gate,fallback:bundle.fallback});
  };
  onProgress('Step 0/1 校验锁定简报并建立作者素材');
  const briefPath=path.join(workdir,'00-article-brief.md'); const sourceBrief=path.join(batchTopicsDir(workspaceRoot,batch),candidate.candidate_id,'article-brief.md');
  writeFile(briefPath,fs.existsSync(sourceBrief)?fs.readFileSync(sourceBrief,'utf8'):`---\nbrief_status: LOCKED\ncandidate_id: ${candidate.candidate_id}\nexperience_required: ${brief.experienceRequired}\ndecision_source: explicit-user\nfinal_readiness: WRITE_NOW\n---\n\n# ${brief.topic}\n\n## 锁定命题\n${brief.thesis}\n`);
  const skillManifestPath=path.join(workdir,'00-skill-manifest.json');
  writeFile(skillManifestPath,JSON.stringify({orchestrator:{skill:'wechat-mp-topic-to-article',hash:orchestratorSkill.hash,files:orchestratorSkill.files,fallback:orchestratorSkill.fallback},writerSkill:chosenWriterSkill,hash:skillBundle.hash,files:skillBundle.files,fallback:skillBundle.fallback,stageSkills:Object.fromEntries(Object.entries(stageSkills).map(([name,bundle])=>[name,{hash:bundle.hash,files:bundle.files,fallback:bundle.fallback}])),loadedAt:new Date().toISOString()},null,2));
  recordStage('brief',orchestratorSkill,['editorial','article-brief.md'],'00-article-brief.md');
  onProgress('Step 1.5 基于来源建立结构化事实基座');
  const factBaseResult=await gateway.complete({provider,purpose:'article-fact-base',batchId,candidateId,jsonMode:true,maxOutputTokens:Math.min(5000,providerConfig.maxOutputTokens),messages:[
    {role:'system',protected:true,content:buildArticleStageSystem(orchestratorSkill,'fact-base')},
    {role:'user',protected:true,content:JSON.stringify({topic:brief.topic,confirmedFacts:brief.confirmedFacts,authorOpinions:brief.authorOpinions,forbiddenClaims:brief.forbiddenClaims,sourceUrl:brief.sourceUrl,sourceText:brief.sourceText||''})},
  ]});
  const factBase=parseJsonResult(factBaseResult,store);
  brief.factBase=factBase;
  const factBasePath=path.join(workdir,'02-fact-base.json');writeFile(factBasePath,JSON.stringify(factBase,null,2));
  recordStage('fact-base',orchestratorSkill,['00-article-brief.md','source-cache'],'02-fact-base.json');
  const factIssue=unverifiedFactBaseIssue(factBase);
  if(factIssue)throw new Error(factIssue);
  onProgress('Step 2 建立事实基座、大纲与标题候选');
  const PLAN_SYSTEM = `${buildArticleStageSystem(orchestratorSkill,'planning')}\n\n## 账号上下文\n${formatAccountContext()}`;
  const planningResult=await gateway.complete({provider,purpose:'article-planning',batchId,candidateId,jsonMode:true,maxOutputTokens:Math.min(5000,providerConfig.maxOutputTokens),
    messages:[{role:'system',content:PLAN_SYSTEM,protected:true},{role:'user',content:JSON.stringify(brief),protected:true}]});
  const plan=normalizePlanningResult(parseJsonResult(planningResult,store)); const selectedTitle=String(plan.selectedTitle||candidate.hotspot_title).trim();
  const materials=`# 作者素材\n\n- topic:${brief.topic}\n- angle:${brief.angle}\n- article_brief_path:${briefPath}\n- brief_status:LOCKED\n- experience_required:${brief.experienceRequired}\n- experience:${brief.confirmedExperiences||'无;公共资料分析,不得使用第一人称亲测'}\n- author_opinion:${brief.authorOpinions||'未提供'}\n- avoid:${brief.forbiddenClaims||'不得虚构事实与经历'}\n- content_role:${plan.contentRole}\n- expected_action:${(plan.expectedAction||[]).join('、')}\n- practical_increment:${plan.practicalIncrement||'观察框架'}\n\n${plan.materialsMarkdown||''}`;
  const outline=`# 文章大纲\n\n${plan.outlineMarkdown||''}\n\n## 来源\n- [原始热点来源](${brief.sourceUrl||''})\n\n## 剩余风险\n${plan.remainingRisks.map((x)=>`- ${typeof x==='string'?x:(x?.message||JSON.stringify(x))}`).join('\n')||'- 无'}`;
  const titles=`# 标题候选\n\ncore_keywords: ${(plan.coreKeywords||[]).join('、')}\n\n${(plan.titleCandidates||[]).map((x,i)=>`${i+1}. ${x.title} - ${x.reason}`).join('\n')}\n\nSELECTED_TITLE: ${selectedTitle}\nwriter_skill: ${writerSkill(candidate)}`;
  const p01=path.join(workdir,'01-personal-materials.md'),p02=path.join(workdir,'02-outline.md'),p03=path.join(workdir,'03-titles.md'); writeFile(p01,materials);writeFile(p02,outline);writeFile(p03,titles);
  recordStage('planning',orchestratorSkill,['00-article-brief.md','02-fact-base.json'],['01-personal-materials.md','02-outline.md','03-titles.md']);
  onProgress(`Step 4 使用 ${chosenWriterSkill} 完整技能生成初稿`);
  const skillPrompt = buildArticleStageSystem(orchestratorSkill,'drafting',writerSkillBundle);
  const draftResult=await textCall(gateway,{provider,purpose:'article-drafting-pipeline',batchId,candidateId},skillPrompt,buildDraftUserPrompt(selectedTitle, brief, outline),Math.min(6500,providerConfig.maxOutputTokens));
  let draft=cleanMarkdown(draftResult.content);
  const draftGateSystem=buildArticleStageSystem(orchestratorSkill,'draft-quality-gate',writerSkillBundle,stageSkills['article-reviewer']);
  let draftQuality=await aiQualityGate({gateway,store,provider,batchId,candidateId,article:draft,factBase,sourceText:brief.sourceText||'',systemPrompt:draftGateSystem,stage:'draft',maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens)});
  if(!draftQuality.pass){
    onProgress(`Step 4.2 AI 质量门禁未通过，自动返工：${issueList(draftQuality.issues).join('；')}`);
    const repairResult=await textCall(gateway,{provider,purpose:'article-structure-repair',batchId,candidateId},skillPrompt,`${buildDraftUserPrompt(selectedTitle,brief,outline)}\n\n门禁问题：${JSON.stringify(draftQuality.issues||[])}\n\n待返工初稿：\n${draft}`,Math.min(6500,providerConfig.maxOutputTokens));
    draft=cleanMarkdown(repairResult.content);draftQuality={pass:false,issues:[]};
  }
  if(!draftQuality.pass)draftQuality=await aiQualityGate({gateway,store,provider,batchId,candidateId,article:draft,factBase,sourceText:brief.sourceText||'',systemPrompt:draftGateSystem,stage:'draft-recheck',maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens)});
  if(!draftQuality.pass)throw new Error(`AI 成稿质量门禁未通过：${issueList(draftQuality.issues).join('；')}`);
  const draftGatePath=path.join(workdir,'04-quality-gate.json');writeFile(draftGatePath,JSON.stringify(draftQuality,null,2));
  const p04=path.join(workdir,'04-draft.md');writeFile(p04,draft);
  recordStage('drafting',writerSkillBundle,['01-personal-materials.md','02-outline.md','03-titles.md','02-fact-base.json'],'04-draft.md');
  recordStage('draft-quality-gate',stageSkills['article-reviewer'],['04-draft.md','02-fact-base.json'],'04-quality-gate.json');
  onProgress('Step 4.5 根据初稿正文生成标题');
  const titleGenSystem = buildArticleStageSystem(orchestratorSkill,'title-generation',stageSkills['title-generator']);
  const titleGenResult=await gateway.complete({provider,purpose:'article-title-generation',batchId,candidateId,jsonMode:true,maxOutputTokens:Math.min(5000,providerConfig.maxOutputTokens),
    messages:[{role:'system',content:titleGenSystem,protected:true},{role:'user',content:JSON.stringify({topic:candidate.hotspot_title,draft:draft}),protected:true}]});
  let titleGen; try { titleGen=parseJsonResult(titleGenResult,store); } catch { titleGen={}; }
  const finalSelectedTitle=String(titleGen.selectedTitle||selectedTitle).trim();
  titleGen=normalizePlanningResult(titleGen);
  const finalTitleCandidates=titleGen.titleCandidates; const finalCoreKeywords=titleGen.coreKeywords.length?titleGen.coreKeywords:plan.coreKeywords;
  const updatedTitles='# 标题候选\n\ncore_keywords: '+finalCoreKeywords.join('、')+'\n\n'+finalTitleCandidates.map((x,i)=>(i+1)+'. '+x.title+' - '+x.reason+(x.score!=null?' (得分:'+x.score+'/12)':'')).join('\n')+'\n\nSELECTED_TITLE: '+finalSelectedTitle+'; // 初稿正文重生成\nwriter_skill: '+writerSkill(candidate);
  writeFile(p03,updatedTitles);
  recordStage('title-generation',stageSkills['title-generator'],['04-draft.md','02-fact-base.json'],'03-titles.md');
  const humanResult=await textCall(gateway,{provider,purpose:'article-humanize',batchId,candidateId},buildArticleStageSystem(orchestratorSkill,'humanize',stageSkills['humanizer-zh']),draft,Math.min(5000,providerConfig.maxOutputTokens));
  const human=cleanMarkdown(humanResult.content); const p05=path.join(workdir,'05-humanized.md');writeFile(p05,human);
  recordStage('humanize',stageSkills['humanizer-zh'],['04-draft.md','02-fact-base.json'],'05-humanized.md');
  onProgress('Step 5 审稿与事实/逻辑/风险门禁');
  const reviewSystem=buildArticleStageSystem(orchestratorSkill,'review',stageSkills['article-reviewer']);
  const reviewResult=await textCall(gateway,{provider,purpose:'article-review',batchId,candidateId},reviewSystem,`事实基座:${JSON.stringify(factBase)}\n\n文章:\n${human}`,Math.min(6500,providerConfig.maxOutputTokens));
  let reviewed=cleanMarkdown(reviewResult.content);
  if(/result:\s*needs-revision/i.test(reviewed)) {
    onProgress('Step 5 审稿未通过,执行一次定向修订复审');
    const repairResult=await textCall(gateway,{provider,purpose:'article-review-repair',batchId,candidateId},reviewSystem,reviewed,Math.min(6500,providerConfig.maxOutputTokens));
    reviewed=cleanMarkdown(repairResult.content);
  }
  if(!/result:\s*pass/i.test(reviewed))throw new Error('审稿门禁未通过;请查看模型调用失败信息并回到编辑器修订');
  const p06=path.join(workdir,'06-reviewed.md');writeFile(p06,reviewed);
  recordStage('review',stageSkills['article-reviewer'],['05-humanized.md','02-fact-base.json'],'06-reviewed.md');
  onProgress('Step 6.1 SEO 关键词评分（百度+360 搜索联想）');
  const coreKw=plan.coreKeywords||[];
  let seoScores=[]; let keywordsMarkdown;
  if (coreKw.length) {
    try { seoScores = await scoreKeywords(coreKw); } catch (e) { /* score silently */ }
    keywordsMarkdown = '# SEO 关键词评分\n\n' +
      '评分方法:百度+360 搜索联想结果数均值(0-10),仅表示相对搜索信号,非微信搜索量。\n\n' +
      seoScores.map(k => {
        const score = k.seo_score == null ? '数据不可用' : `${k.seo_score}/10`;
        const from = k.available_sources ? `（可用来源 ${k.available_sources}/2）` : '';
        return `- ${k.keyword}: ${score}${from}` +
          (k.related_keywords?.length ? `\n  - 相关词: ${k.related_keywords.slice(0,5).join('、')}` : '');
      }).join('\n') + '\n\n' +
      '> 局限:联想数据只用于比较候选关键词的相对热度,不能证明在微信搜一搜中的实际需求。\n';
  } else {
    keywordsMarkdown = '# SEO 关键词\n\n无核心关键词,跳过评分。\n';
  }
  const p07=path.join(workdir,'07-seo-keywords.md');writeFile(p07,keywordsMarkdown);
  recordStage('seo-keyword-scoring',stageSkills['seo-keyword-scoring'],['06-reviewed.md'],'07-seo-keywords.md');
  const seoContext = seoScores.length
    ? `\n\n关键词评分:${seoScores.map(k => `${k.keyword}=${k.seo_score??'N/A'}`).join(', ')}。相关词:${seoScores.flatMap(k=>k.related_keywords||[]).join('、')}`
    : '';
  onProgress('Step 6.2 搜一搜优化');
  const seoResult=await textCall(gateway,{provider,purpose:'article-seo',batchId,candidateId},buildArticleStageSystem(orchestratorSkill,'seo-optimization',stageSkills['seo-content-optimizer']),`核心关键词: ${coreKw.join('、')}${seoContext}\n\n待优化文章：\n${reviewed}`,Math.min(6500,providerConfig.maxOutputTokens));
  let final=cleanMarkdown(seoResult.content).replace(/<!--\s*REVIEW[\s\S]*?-->/gi,'').trim();
  if(visibleChars(final)<ARTICLE_LENGTH_RANGE.min||visibleChars(final)>ARTICLE_LENGTH_RANGE.max){onProgress(`终稿当前 ${visibleChars(final)} 字，调整到 ${ARTICLE_LENGTH_RANGE.min}–${ARTICLE_LENGTH_RANGE.max} 字`);final=await fitArticleLength({gateway,provider,batchId,candidateId,article:final,factBase,systemPrompt:buildArticleStageSystem(orchestratorSkill,'length-repair',writerSkillBundle),purpose:'article-length-gate',maxOutputTokens:Math.min(6500,providerConfig.maxOutputTokens),onProgress});}
  if(visibleChars(final)<ARTICLE_LENGTH_RANGE.min||visibleChars(final)>ARTICLE_LENGTH_RANGE.max)throw new Error(`终稿有 ${visibleChars(final)} 个可见字符，未达到 ${ARTICLE_LENGTH_RANGE.min}–${ARTICLE_LENGTH_RANGE.max} 字门禁`);
  const finalGateSystem=buildArticleStageSystem(orchestratorSkill,'final-quality-gate',writerSkillBundle,stageSkills['article-reviewer']);
  let finalQuality=await aiQualityGate({gateway,store,provider,batchId,candidateId,article:final,factBase,sourceText:brief.sourceText||'',systemPrompt:finalGateSystem,stage:'final',maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens)});
  if(!finalQuality.pass){
    onProgress(`Step 6.3 AI 终稿门禁未通过，执行保真返工：${issueList(finalQuality.issues).join('；')}`);
    const finalRepair=await textCall(gateway,{provider,purpose:'article-final-repair',batchId,candidateId},buildArticleStageSystem(orchestratorSkill,'drafting',writerSkillBundle),`事实基座：${JSON.stringify(factBase)}\n\n门禁问题：${JSON.stringify(finalQuality.issues||[])}\n\n待返工终稿：\n${final}`,Math.min(6500,providerConfig.maxOutputTokens));
    final=cleanMarkdown(finalRepair.content).replace(/<!--\s*REVIEW[\s\S]*?-->/gi,'').trim();
    if(visibleChars(final)<ARTICLE_LENGTH_RANGE.min||visibleChars(final)>ARTICLE_LENGTH_RANGE.max)final=await fitArticleLength({gateway,provider,batchId,candidateId,article:final,factBase,systemPrompt:buildArticleStageSystem(orchestratorSkill,'length-repair',writerSkillBundle),purpose:'article-final-repair-length',maxOutputTokens:Math.min(6500,providerConfig.maxOutputTokens),onProgress});
    finalQuality=await aiQualityGate({gateway,store,provider,batchId,candidateId,article:final,factBase,sourceText:brief.sourceText||'',systemPrompt:finalGateSystem,stage:'final-recheck',maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens)});
  }
  if(visibleChars(final)<ARTICLE_LENGTH_RANGE.min||visibleChars(final)>ARTICLE_LENGTH_RANGE.max)throw new Error(`终稿有 ${visibleChars(final)} 个可见字符，未达到 ${ARTICLE_LENGTH_RANGE.min}–${ARTICLE_LENGTH_RANGE.max} 字门禁`);
  if(!finalQuality.pass)throw new Error(`AI 终稿质量门禁未通过：${issueList(finalQuality.issues).join('；')}`);
  const finalGatePath=path.join(workdir,'08-quality-gate.json');writeFile(finalGatePath,JSON.stringify(finalQuality,null,2));
  const seoFinal=final;
  const p08=path.join(workdir,'08-seo-optimized.md'),p09=path.join(workdir,'09-FINAL.md');writeFile(p08,seoFinal);
  recordStage('seo-optimization',stageSkills['seo-content-optimizer'],['06-reviewed.md','07-seo-keywords.md'],'08-seo-optimized.md');
  recordStage('final-quality-gate',stageSkills['article-reviewer'],['08-seo-optimized.md','02-fact-base.json'],'08-quality-gate.json');
  onProgress('Step 7 规划必须由编辑提供的来源图与资料图');
  final=await planImagePlaceholders({gateway,store,batchId,candidateId,provider,markdown:final,maxOutputTokens:Math.min(3000,providerConfig.maxOutputTokens),skillPrompt:buildArticleStageSystem(orchestratorSkill,'image-planning',stageSkills['article-image-placeholders'])});
  writeFile(p09,final);
  recordStage('image-planning',stageSkills['article-image-placeholders'],['08-seo-optimized.md'],'09-FINAL.md');
  if(stageExecutions.length!==ARTICLE_STAGE_CONTRACT.length)throw new Error('成稿契约未完整执行');
  const stageManifestPath=path.join(workdir,'00-stage-executions.json');writeFile(stageManifestPath,JSON.stringify({generatedAt:new Date().toISOString(),stages:stageExecutions},null,2));
  store.saveDocument({batchId,candidateId,kind:'draft',title:selectedTitle,content:draft,filePath:p04,status:'draft'});
  store.saveDocument({batchId,candidateId,kind:'final',title:finalSelectedTitle,content:final,filePath:p09,status:'finalized'});
  for(const [kind,name,file] of [['技能清单','00-skill-manifest.json',skillManifestPath],['阶段执行清单','00-stage-executions.json',stageManifestPath],['锁定简报','00-article-brief.md',briefPath],['事实基座','02-fact-base.json',factBasePath],['作者素材','01-personal-materials.md',p01],['文章大纲','02-outline.md',p02],['标题候选','03-titles.md',p03],['文章初稿','04-draft.md',p04],['初稿AI门禁','04-quality-gate.json',draftGatePath],['去AI稿','05-humanized.md',p05],['审稿稿','06-reviewed.md',p06],['SEO关键词','07-seo-keywords.md',p07],['SEO优化稿','08-seo-optimized.md',p08],['终稿AI门禁','08-quality-gate.json',finalGatePath],['文章终稿','09-FINAL.md',p09]])artifact(store,batchId,kind,name,file);
  store.updateBatch(batchId,{stage:'typeset',status:'review'}); onProgress(`成稿完成:${visibleChars(final)} 个可见字符`);
  return {workdir,finalPath:p09,visibleChars:visibleChars(final),writerSkill:chosenWriterSkill,skillHash:skillBundle.hash,skillFallback:skillBundle.fallback,title:finalSelectedTitle};
}
