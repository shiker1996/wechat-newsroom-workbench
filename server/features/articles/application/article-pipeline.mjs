import fs from 'node:fs';
import path from 'node:path';
import { illustrateArticle } from './article-illustration.mjs';
import { scoreKeywords } from './seo-score.mjs';
import { formatAccountContext } from '../../../shared/domain/account-context.mjs';
import { normalizeDistributionLane } from '../../../shared/domain/distribution-strategy.mjs';
import { parseModelJson } from '../../../platform/llm/model-json.mjs';
import { evaluateEditorialReadiness } from '../domain/editorial-readiness.mjs';
import { loadArticleSkillBundle, loadSkillBundle } from '../../../platform/llm/skill-runtime.mjs';
import { bindGenerationSnapshot, prepareSkillRun } from '../../../platform/skills/pipeline-runtime.mjs';
import { configuredRepairAttempts, evaluateConfiguredGates } from '../../../platform/skills/configuration.mjs';
import { batchTopicsDir, candidateArticleDir } from '../../../platform/core/workspace-paths.mjs';
import { resolveArticleLength } from '../../../platform/core/config.mjs';
import {
  ARTICLE_LENGTH_RANGE, articleLengthStatus, articleStageOutputIssue, authorizedWritingBrief,
  buildDraftUserPrompt, compositeSourceText, normalizePlanningResult, selectWriterSkill,
  sourceCacheIssue, unverifiedFactBaseIssue,
} from './article-pipeline-contract.mjs';
export {
  ARTICLE_LENGTH_RANGE, articleLengthStatus, articleStageOutputIssue, authorizedWritingBrief,
  buildDraftUserPrompt, compositeSourceText, normalizePlanningResult, selectWriterSkill,
  sourceCacheIssue, unverifiedFactBaseIssue,
} from './article-pipeline-contract.mjs';

function writeFile(filePath,content) { fs.mkdirSync(path.dirname(filePath),{recursive:true}); const temp=`${filePath}.tmp`; fs.writeFileSync(temp,String(content).trimEnd()+'\n','utf8'); fs.renameSync(temp,filePath); return fs.statSync(filePath); }
function cleanMarkdown(value) { return String(value||'').trim().replace(/^```(?:markdown)?\s*/i,'').replace(/\s*```$/,''); }
function outputExcerpt(value,max=180) { return String(value||'').replace(/\s+/g,' ').trim().slice(0,max); }
function visibleChars(markdown) { return articleLengthStatus(markdown,{min:0,max:Number.MAX_SAFE_INTEGER}).count; }
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
function issueList(value) { return asArray(value).map((item)=>typeof item==='string'?item:(item?.message||JSON.stringify(item))); }
function parseJsonResult(result,store) {
  return parseModelJson(result,{store,label:'文章流水线'});
}

function artifact(store,batchId,kind,name,filePath) { const stat=fs.statSync(filePath); store.upsertArtifact({batchId,kind,name,path:filePath,size:stat.size,modifiedAt:stat.mtime.toISOString()}); }
function writerSkill(candidate) {
  return selectWriterSkill(candidate).skill;
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
  { id:'visual-planning', skill:'article-visual-planner' },
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
    {role:'user',protected:true,content:`事实基座：${JSON.stringify(factBase)}\n\n判定口径：正文事实只能来自事实基座中的 verified 项；来源标题、URL、模型常识和未进入事实基座的来源原文不能补充授权。第一人称作者判断或阅读动作（如“我看”“我读完后的判断”）不是亲测；只有声称本人测试、部署、使用并得到结果，且没有已确认实践证据时，才按未经核实的亲测处理。\n\n待检查文章：\n${article}`},
  ]});
  return parseJsonResult(result,store);
}


async function fitArticleLength({gateway,provider,batchId,candidateId,article,factBase,systemPrompt,purpose,maxOutputTokens=5000,onProgress=()=>{},maxAttempts=3,range=ARTICLE_LENGTH_RANGE}) {
  let current=article;
  let best=article;
  const distance=(value)=>{
    const {count}=articleLengthStatus(value,range);
    if(count<range.min)return range.min-count;
    if(count>range.max)return count-range.max;
    return 0;
  };
  for(let attempt=1;attempt<=maxAttempts;attempt+=1){
    const status=articleLengthStatus(current,range);
    if(status.valid)return current;
    const tooShort=status.count<range.min;
    const direction=tooShort
      ? `补充必要的事实解释、因果链、反方边界和读者可执行信息；当前至少还差 ${status.shortfall} 个可见字符`
      : `压缩重复背景、次要案例和同义结论；当前至少需要减少 ${status.overflow} 个可见字符`;
    onProgress(`长度修复 ${attempt}/${maxAttempts}：当前 ${status.count} 字`);
    const result=await textCall(gateway,{provider,purpose:`${purpose}-${attempt}`,batchId,candidateId},systemPrompt,
      `将下文调整到 ${range.min}–${range.max} 个可见字符，当前为 ${status.count}。请${direction}。

这是第 ${attempt}/${maxAttempts} 次长度修复。必须输出完整文章，不能只输出新增段落或修改说明。只能使用给定事实基座支持的信息；不得新增事实、数字、引语、案例或作者亲历；保留唯一 H1 标题、核心立场、关键来源、风险边界和原有 3–5 个 H2 结构。只输出调整后的完整 Markdown 正文。

事实基座：${JSON.stringify(factBase)}

待调整文章：
${current}`,maxOutputTokens);
    const repaired=cleanMarkdown(result.content).replace(/<!--\s*REVIEW[\s\S]*?-->/gi,'').trim();
    if(!repaired)continue;
    current=repaired;
    if(distance(current)<distance(best))best=current;
  }
  return articleLengthStatus(current,range).valid?current:best;
}

export async function runArticlePipeline({gateway,store,batchId,candidateId,provider,workspaceRoot,snapshotId=null,skillSelection=null,stageSelections=null,articleLength=null,onProgress=()=>{}}) {
  const candidate=store.getCandidate(candidateId); if(!candidate||candidate.batch_id!==batchId)throw new Error('候选不存在或不属于当前批次');
  const editorial=candidate.editorial;
  if(editorial.brief_status!=='LOCKED')throw new Error('必须先完成编辑会并锁定 article-brief.md');
  const editorialReadiness=evaluateEditorialReadiness({candidate,editorial});
  if(!editorialReadiness.ready)throw new Error(`编辑底稿未就绪,仍缺：${editorialReadiness.missing.join('、')}`);
  // F 分数只决定自动入池；能完成编辑会并锁定简报，表示作者已人工确认该选题，
  // 手动确认的低分选题也应允许进入成稿链。
  const batch=store.getBatch(batchId); const workdir=candidateArticleDir(workspaceRoot,batch,candidate);
  fs.mkdirSync(workdir,{recursive:true}); let providerConfig=gateway.config.providers[provider||gateway.config.defaultProvider];
  const sourceUrls=candidate.composite?(candidate.hotspots||[]).map((h)=>h.url).filter(Boolean).join(String.fromCharCode(10)):
    (candidate.materials?.length?candidate.materials.map((item)=>item.url).join(String.fromCharCode(10)):candidate.url);
  const readerStake=String(candidate.reader_stake||'').trim();
  const requestedDistributionLane=normalizeDistributionLane(candidate.distribution_lane);
  const distributionLane=requestedDistributionLane==='通知池'&&!readerStake?'实验池':requestedDistributionLane;
  const brief={candidateId:candidate.candidate_id,topic:candidate.hotspot_title,sourceUrl:sourceUrls,category:candidate.category,score:candidate.f_score,
    angle:candidate.angle,thesis:candidate.thesis,confirmedFacts:editorial.confirmed_facts,authorOpinions:editorial.author_opinions,
    confirmedExperiences:editorial.confirmed_experiences,rejectedAngles:editorial.rejected_angles,forbiddenClaims:editorial.forbidden_claims,
    experienceRequired:Boolean(editorial.experience_required),distributionLane,readerStake,composite:Boolean(candidate.composite)};
  // 将已抓取的原始来源一并交给规划器，禁止模型凭常识补写日期、任职经历和合同细节。
  try {
    if(candidate.composite){
      brief.sourceText=compositeSourceText(candidate);
    }else{
      const cacheFile = path.join(workspaceRoot, 'data', 'source-cache', `${candidate.hotspot_id}.json`);
      if (fs.existsSync(cacheFile)) {
        const sourceDoc = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (sourceDoc?.content) {
          const mismatch=sourceCacheIssue(candidate,sourceDoc);
          if(mismatch)throw Object.assign(new Error(mismatch),{fatalSourceCache:true});
          brief.sourceText = String(sourceDoc.content).slice(0, 18000);
        }
      }
    }
  } catch (error) { if(error?.fatalSourceCache)throw error; }
  const historicalSnapshot=snapshotId?store.getGenerationSnapshot?.(snapshotId):null;
  const historicalWriter=historicalSnapshot?.snapshot?.selection?.selectedSkill
    ||historicalSnapshot?.snapshot?.skills?.[0]?.id;
  const writerDecision=skillSelection || selectWriterSkill(candidate);
  const chosenWriterSkill = historicalWriter || skillSelection?.selectedSkill || writerDecision.skill;
  const orchestratorSkill = loadSkillBundle({ workspaceRoot, skillName:'wechat-mp-topic-to-article' });
  const writerSkillBundle = loadSkillBundle({ workspaceRoot, skillName:chosenWriterSkill });
  const skillBundle = loadArticleSkillBundle({ workspaceRoot, writerSkill: chosenWriterSkill });
  const historicalStages=historicalSnapshot?.snapshot?.selection?.stages||{};
  const selectedStageIds={
    title:historicalStages.title?.selectedSkill||stageSelections?.title?.selectedSkill||'title-generator',
    reviewer:historicalStages.reviewer?.selectedSkill||stageSelections?.reviewer?.selectedSkill||'article-reviewer',
    humanizer:historicalStages.humanizer?.selectedSkill||stageSelections?.humanizer?.selectedSkill||'humanizer-zh',
    seo:historicalStages.seo?.selectedSkill||stageSelections?.seo?.selectedSkill||'seo-content-optimizer',
  };
  const stageSkills={
    'title-generator':loadSkillBundle({workspaceRoot,skillName:selectedStageIds.title}),
    'humanizer-zh':loadSkillBundle({workspaceRoot,skillName:selectedStageIds.humanizer}),
    'article-reviewer':loadSkillBundle({workspaceRoot,skillName:selectedStageIds.reviewer}),
    'seo-keyword-scoring':loadSkillBundle({workspaceRoot,skillName:'seo-keyword-scoring'}),
    'seo-content-optimizer':loadSkillBundle({workspaceRoot,skillName:selectedStageIds.seo}),
    'article-image-placeholders':loadSkillBundle({workspaceRoot,skillName:'article-image-placeholders'}),
    'article-visual-planner':loadSkillBundle({workspaceRoot,skillName:'article-visual-planner'}),
  };
  const runtime=await prepareSkillRun({gateway,store,batchId,candidateId,purpose:'article',bundles:[writerSkillBundle,orchestratorSkill,...Object.values(stageSkills)],provider,snapshotId,
    selection:(skillSelection||stageSelections)?{...(skillSelection||{requestedSkill:'',selectedSkill:chosenWriterSkill,selectionSource:'builtin-recommendation'}),entryPoint:'hotspot-article',stages:stageSelections||{}}:null});
  gateway=bindGenerationSnapshot(gateway,runtime.snapshotId);
  provider=runtime.provider;providerConfig=runtime.providerConfig;
  const configuredLength=writerSkillBundle.config?.gates?.length;
  // 优先级：技能覆盖层 gates.length > config.local.json articleLength（含 pipelines.article 差异覆盖）> 默认 1300–2000
  const articleLengthRange=configuredLength
    ? {min:Number(configuredLength.minVisibleChars),max:Number(configuredLength.maxVisibleChars)}
    : resolveArticleLength({articleLength},'article');
  const repairAttempts=configuredRepairAttempts(writerSkillBundle.config,3);
  const stageExecutions=[];
  const recordStage=(stage,bundle,inputArtifacts,outputArtifact,gate='passed')=>{
    const expected=ARTICLE_STAGE_CONTRACT[stageExecutions.length];
    const actualSkill=bundle.skillName||bundle.writerSkill;
    const expectedSkill=expected?.skill==='$writer'?chosenWriterSkill
      : expected?.skill==='article-reviewer'?selectedStageIds.reviewer
        : expected?.skill==='title-generator'?selectedStageIds.title
          : expected?.skill==='humanizer-zh'?selectedStageIds.humanizer
            : expected?.skill==='seo-content-optimizer'?selectedStageIds.seo:expected?.skill;
    if(!expected||expected.id!==stage||expectedSkill!==actualSkill)throw new Error(`成稿契约阶段不一致：期望 ${expected?.id||'结束'}/${expectedSkill||'-'}，实际 ${stage}/${actualSkill}`);
    stageExecutions.push({stage,skill:actualSkill,skillHash:bundle.hash,skillFiles:bundle.files,inputArtifacts,outputArtifact,gate,fallback:bundle.fallback});
  };
  onProgress('Step 0/1 校验锁定简报并建立作者素材');
  const briefPath=path.join(workdir,'00-article-brief.md'); const sourceBrief=path.join(batchTopicsDir(workspaceRoot,batch),candidate.candidate_id,'article-brief.md');
  writeFile(briefPath,fs.existsSync(sourceBrief)?fs.readFileSync(sourceBrief,'utf8'):`---\nbrief_status: LOCKED\ncandidate_id: ${candidate.candidate_id}\ndistribution_lane: ${brief.distributionLane}\nreader_stake: ${brief.readerStake}\nexperience_required: ${brief.experienceRequired}\ndecision_source: explicit-user\nfinal_readiness: WRITE_NOW\n---\n\n# ${brief.topic}\n\n## 锁定命题\n${brief.thesis}\n`);
  const skillManifestPath=path.join(workdir,'00-skill-manifest.json');
  writeFile(skillManifestPath,JSON.stringify({orchestrator:{skill:'wechat-mp-topic-to-article',hash:orchestratorSkill.hash,files:orchestratorSkill.files,fallback:orchestratorSkill.fallback},writerSkill:chosenWriterSkill,writerSkillSelection:skillSelection||{requestedSkill:'',selectedSkill:chosenWriterSkill,selectionSource:'builtin-recommendation'},stageSkillSelections:stageSelections||historicalStages,hash:skillBundle.hash,files:skillBundle.files,fallback:skillBundle.fallback,stageSkills:Object.fromEntries(Object.entries(stageSkills).map(([name,bundle])=>[name,{skill:bundle.skillName,hash:bundle.hash,files:bundle.files,fallback:bundle.fallback}])),loadedAt:new Date().toISOString()},null,2));
  recordStage('brief',orchestratorSkill,['editorial','article-brief.md'],'00-article-brief.md');
  onProgress('Step 1.5 基于来源建立结构化事实基座');
  const factBaseResult=await gateway.complete({provider,purpose:'article-fact-base',batchId,candidateId,jsonMode:true,maxOutputTokens:Math.min(5000,providerConfig.maxOutputTokens),messages:[
    {role:'system',protected:true,content:buildArticleStageSystem(orchestratorSkill,'fact-base')},
    {role:'user',protected:true,content:JSON.stringify({topic:brief.topic,confirmedFacts:brief.confirmedFacts,authorOpinions:brief.authorOpinions,forbiddenClaims:brief.forbiddenClaims,sourceUrl:brief.sourceUrl,sourceText:brief.sourceText||''})},
  ]});
  const factBase=parseJsonResult(factBaseResult,store);
  brief.factBase=factBase;
  const writingBrief=authorizedWritingBrief(brief);
  const factBasePath=path.join(workdir,'02-fact-base.json');writeFile(factBasePath,JSON.stringify(factBase,null,2));
  recordStage('fact-base',orchestratorSkill,['00-article-brief.md','source-cache'],'02-fact-base.json');
  const factIssue=unverifiedFactBaseIssue(factBase);
  if(factIssue)throw new Error(factIssue);
  onProgress('Step 2 建立事实基座、大纲与标题候选');
  const PLAN_SYSTEM = `${buildArticleStageSystem(orchestratorSkill,'planning')}\n\n## 账号上下文\n${formatAccountContext({workspaceRoot})}`;
  const planningResult=await gateway.complete({provider,purpose:'article-planning',batchId,candidateId,jsonMode:true,maxOutputTokens:Math.min(5000,providerConfig.maxOutputTokens),
    messages:[{role:'system',content:PLAN_SYSTEM,protected:true},{role:'user',content:JSON.stringify(writingBrief),protected:true}]});
  const plan=normalizePlanningResult(parseJsonResult(planningResult,store)); const selectedTitle=String(plan.selectedTitle||candidate.hotspot_title).trim();
  const materials=`# 作者素材\n\n- topic:${brief.topic}\n- angle:${brief.angle}\n- article_brief_path:${briefPath}\n- brief_status:LOCKED\n- distribution_lane:${brief.distributionLane}\n- reader_stake:${brief.readerStake||'待明确'}\n- experience_required:${brief.experienceRequired}\n- experience:${brief.confirmedExperiences||'无;公共资料分析,不得使用第一人称亲测'}\n- author_opinion:${brief.authorOpinions||'未提供'}\n- avoid:${brief.forbiddenClaims||'不得虚构事实与经历'}\n- writer_skill:${chosenWriterSkill}\n- writer_skill_reason:${writerDecision.reason}\n- content_role:${plan.contentRole}\n- expected_action:${(plan.expectedAction||[]).join('、')}\n- practical_increment:${plan.practicalIncrement||'观察框架'}\n\n${plan.materialsMarkdown||''}`;
  const outline=`# 文章大纲\n\n## 分发与读者利益\n- 分发池：${brief.distributionLane}\n- 读者利益：${brief.readerStake||'待明确'}\n\n${plan.outlineMarkdown||''}\n\n## 来源\n- [原始热点来源](${brief.sourceUrl||''})\n\n## 剩余风险\n${plan.remainingRisks.map((x)=>`- ${typeof x==='string'?x:(x?.message||JSON.stringify(x))}`).join('\n')||'- 无'}`;
  const titles=`# 标题候选\n\ndistribution_lane: ${brief.distributionLane}\nreader_stake: ${brief.readerStake||'待明确'}\ncore_keywords: ${(plan.coreKeywords||[]).join('、')}\n\n${(plan.titleCandidates||[]).map((x,i)=>`${i+1}. ${x.title} - ${x.reason}`).join('\n')}\n\nSELECTED_TITLE: ${selectedTitle}\nwriter_skill: ${chosenWriterSkill}`;
  const p01=path.join(workdir,'01-personal-materials.md'),p02=path.join(workdir,'02-outline.md'),p03=path.join(workdir,'03-titles.md'); writeFile(p01,materials);writeFile(p02,outline);writeFile(p03,titles);
  recordStage('planning',orchestratorSkill,['00-article-brief.md','02-fact-base.json'],['01-personal-materials.md','02-outline.md','03-titles.md']);
  onProgress(`Step 4 使用 ${chosenWriterSkill} 完整技能生成初稿`);
  const skillPrompt = buildArticleStageSystem(orchestratorSkill,'drafting',writerSkillBundle);
  const draftResult=await textCall(gateway,{provider,purpose:'article-drafting-pipeline',batchId,candidateId},skillPrompt,buildDraftUserPrompt(selectedTitle, writingBrief, outline),Math.min(6500,providerConfig.maxOutputTokens));
  let draft=cleanMarkdown(draftResult.content);
  const draftGateSystem=buildArticleStageSystem(orchestratorSkill,'draft-quality-gate',writerSkillBundle,stageSkills['article-reviewer']);
  let draftQuality=await aiQualityGate({gateway,store,provider,batchId,candidateId,article:draft,factBase,sourceText:brief.sourceText||'',systemPrompt:draftGateSystem,stage:'draft',maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens)});
  if(!draftQuality.pass){
    onProgress(`Step 4.2 AI 质量门禁未通过，自动返工：${issueList(draftQuality.issues).join('；')}`);
    const repairResult=await textCall(gateway,{provider,purpose:'article-structure-repair',batchId,candidateId},skillPrompt,`${buildDraftUserPrompt(selectedTitle,writingBrief,outline)}\n\n门禁问题：${JSON.stringify(draftQuality.issues||[])}\n\n返工要求：删除或降格所有没有 verified 事实支持的主张，不得用新的数字、案例、榜单、硬件配置或模型常识替换被删除内容；保留有依据的作者判断。\n\n待返工初稿：\n${draft}`,Math.min(6500,providerConfig.maxOutputTokens));
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
    messages:[{role:'system',content:titleGenSystem,protected:true},{role:'user',content:JSON.stringify({topic:candidate.hotspot_title,
      distribution_lane:brief.distributionLane,reader_stake:brief.readerStake,draft}),protected:true}]});
  let titleGen; try { titleGen=parseJsonResult(titleGenResult,store); } catch { titleGen={}; }
  const finalSelectedTitle=String(titleGen.selectedTitle||selectedTitle).trim();
  titleGen=normalizePlanningResult(titleGen);
  const finalTitleCandidates=titleGen.titleCandidates; const finalCoreKeywords=titleGen.coreKeywords.length?titleGen.coreKeywords:plan.coreKeywords;
  const updatedTitles='# 标题候选\n\ndistribution_lane: '+brief.distributionLane+'\nreader_stake: '+(brief.readerStake||'待明确')+'\ncore_keywords: '+finalCoreKeywords.join('、')+'\n\n'+finalTitleCandidates.map((x,i)=>(i+1)+'. '+x.title+' - '+x.reason+(x.score!=null?' (得分:'+x.score+'/12)':'')).join('\n')+'\n\nSELECTED_TITLE: '+finalSelectedTitle+'; // 初稿正文重生成\nwriter_skill: '+chosenWriterSkill;
  writeFile(p03,updatedTitles);
  recordStage('title-generation',stageSkills['title-generator'],['04-draft.md','02-fact-base.json'],'03-titles.md');
  const humanSystem=buildArticleStageSystem(orchestratorSkill,'humanize',stageSkills['humanizer-zh']);
  let humanResult=await textCall(gateway,{provider,purpose:'article-humanize',batchId,candidateId},humanSystem,draft,Math.min(5000,providerConfig.maxOutputTokens));
  let human=cleanMarkdown(humanResult.content); let humanIssue=articleStageOutputIssue(human,{requireArticle:true});
  if(humanIssue){
    store.updateModelCall(humanResult.callId,{status:'invalid_output',error:humanIssue});
    onProgress(`Step 4 自然化输出异常，自动重试：${humanIssue}`);
    humanResult=await textCall(gateway,{provider,purpose:'article-humanize-repair',batchId,candidateId},humanSystem,
      `上一次输出无效：${humanIssue}。不要读取文件、调用工具、解释过程或复述任务。请直接输出润色后的完整 Markdown 文章，保留一级标题、正文结构、事实、来源和链接。\n\n原始文章：\n${draft}`,Math.min(5000,providerConfig.maxOutputTokens));
    human=cleanMarkdown(humanResult.content);humanIssue=articleStageOutputIssue(human,{requireArticle:true});
  }
  const p05=path.join(workdir,'05-humanized.md');writeFile(p05,human);
  if(humanIssue){
    const reason=`自然化输出无效：${humanIssue}；返回摘要：${outputExcerpt(human)}`;
    store.updateModelCall(humanResult.callId,{status:'invalid_output',error:reason});
    throw new Error(reason);
  }
  recordStage('humanize',stageSkills['humanizer-zh'],['04-draft.md','02-fact-base.json'],'05-humanized.md');
  onProgress('Step 5 审稿与事实/逻辑/风险门禁');
  const reviewSystem=buildArticleStageSystem(orchestratorSkill,'review',stageSkills['article-reviewer']);
  const reviewResult=await textCall(gateway,{provider,purpose:'article-review',batchId,candidateId},reviewSystem,`事实基座:${JSON.stringify(factBase)}\n\n文章:\n${human}`,Math.min(6500,providerConfig.maxOutputTokens));
  let reviewed=cleanMarkdown(reviewResult.content);
  const reviewLogPath=path.join(workdir,'06-review-gate.md');
  let reviewLog=`# 首次审稿响应\n\n${reviewed}`;writeFile(reviewLogPath,reviewLog);
  let finalReviewResult=reviewResult;
  if(/result:\s*needs-revision/i.test(reviewed)) {
    onProgress('Step 5 审稿未通过,执行一次定向修订复审');
    const repairResult=await textCall(gateway,{provider,purpose:'article-review-repair',batchId,candidateId},reviewSystem,reviewed,Math.min(6500,providerConfig.maxOutputTokens));
    reviewed=cleanMarkdown(repairResult.content);
    finalReviewResult=repairResult;reviewLog+=`\n\n# 定向修订复审响应\n\n${reviewed}`;writeFile(reviewLogPath,reviewLog);
  }
  if(!/result:\s*pass/i.test(reviewed)){
    const reason=`审稿响应不符合门禁契约：未返回 result: pass 或 result: needs-revision；原始响应已保存到 06-review-gate.md；返回摘要：${outputExcerpt(reviewed)}`;
    store.updateModelCall(finalReviewResult.callId,{status:'invalid_output',error:reason});
    throw new Error(reason);
  }
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
  if(visibleChars(final)<articleLengthRange.min||visibleChars(final)>articleLengthRange.max){onProgress(`终稿当前 ${visibleChars(final)} 字，调整到 ${articleLengthRange.min}–${articleLengthRange.max} 字`);final=await fitArticleLength({gateway,provider,batchId,candidateId,article:final,factBase,systemPrompt:buildArticleStageSystem(orchestratorSkill,'length-repair',writerSkillBundle),purpose:'article-length-gate',maxOutputTokens:Math.min(6500,providerConfig.maxOutputTokens),onProgress,maxAttempts:repairAttempts,range:articleLengthRange});}
  if(visibleChars(final)<articleLengthRange.min||visibleChars(final)>articleLengthRange.max)onProgress(`字数警告：终稿有 ${visibleChars(final)} 个可见字符，不在 ${articleLengthRange.min}–${articleLengthRange.max} 字区间，可稍后在编辑器手动删减，流程继续`);
  const configuredGate=evaluateConfiguredGates(writerSkillBundle.config,{factBase,output:final,visibleChars:visibleChars(final)});
  if(!configuredGate.pass)throw new Error(`技能配置门禁未通过：${configuredGate.issues.map((item)=>item.message).join('；')}`);
  const finalGateSystem=buildArticleStageSystem(orchestratorSkill,'final-quality-gate',writerSkillBundle,stageSkills['article-reviewer']);
  let finalQuality=await aiQualityGate({gateway,store,provider,batchId,candidateId,article:final,factBase,sourceText:brief.sourceText||'',systemPrompt:finalGateSystem,stage:'final',maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens)});
  if(!finalQuality.pass){
    onProgress(`Step 6.3 AI 终稿门禁未通过，执行保真返工：${issueList(finalQuality.issues).join('；')}`);
    const finalRepair=await textCall(gateway,{provider,purpose:'article-final-repair',batchId,candidateId},buildArticleStageSystem(orchestratorSkill,'drafting',writerSkillBundle),`事实基座：${JSON.stringify(factBase)}\n\n门禁问题：${JSON.stringify(finalQuality.issues||[])}\n\n待返工终稿：\n${final}`,Math.min(6500,providerConfig.maxOutputTokens));
    final=cleanMarkdown(finalRepair.content).replace(/<!--\s*REVIEW[\s\S]*?-->/gi,'').trim();
    if(visibleChars(final)<articleLengthRange.min||visibleChars(final)>articleLengthRange.max)final=await fitArticleLength({gateway,provider,batchId,candidateId,article:final,factBase,systemPrompt:buildArticleStageSystem(orchestratorSkill,'length-repair',writerSkillBundle),purpose:'article-final-repair-length',maxOutputTokens:Math.min(6500,providerConfig.maxOutputTokens),onProgress,maxAttempts:repairAttempts,range:articleLengthRange});
    finalQuality=await aiQualityGate({gateway,store,provider,batchId,candidateId,article:final,factBase,sourceText:brief.sourceText||'',systemPrompt:finalGateSystem,stage:'final-recheck',maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens)});
  }
  if(visibleChars(final)<articleLengthRange.min||visibleChars(final)>articleLengthRange.max)onProgress(`字数警告：终稿有 ${visibleChars(final)} 个可见字符，不在 ${articleLengthRange.min}–${articleLengthRange.max} 字区间，可稍后在编辑器手动删减，流程继续`);
  if(!finalQuality.pass)throw new Error(`AI 终稿质量门禁未通过：${issueList(finalQuality.issues).join('；')}`);
  const finalGatePath=path.join(workdir,'08-quality-gate.json');writeFile(finalGatePath,JSON.stringify(finalQuality,null,2));
  const seoFinal=final;
  const p08=path.join(workdir,'08-seo-optimized.md'),p09=path.join(workdir,'09-FINAL.md');writeFile(p08,seoFinal);
  recordStage('seo-optimization',stageSkills['seo-content-optimizer'],['06-reviewed.md','07-seo-keywords.md'],'08-seo-optimized.md');
  recordStage('final-quality-gate',stageSkills['article-reviewer'],['08-seo-optimized.md','02-fact-base.json'],'08-quality-gate.json');
  onProgress('Step 7 自动配图：先插入 Mermaid/ECharts 图表，再规划手动供图占位');
  const illustration=await illustrateArticle({
    gateway,store,provider,batchId,candidateId,markdown:final,factBase:JSON.stringify(factBase),
    workspaceRoot,maxOutputTokens:Math.min(5000,providerConfig.maxOutputTokens),
    imageSkillPrompt:buildArticleStageSystem(orchestratorSkill,'image-planning',stageSkills['article-image-placeholders']),
    onProgress,
  });
  final=illustration.markdown;
  const visualPlanPath=path.join(workdir,'09-visual-plan.json');writeFile(visualPlanPath,JSON.stringify(illustration.visualPlan,null,2));
  recordStage('visual-planning',stageSkills['article-visual-planner'],['08-seo-optimized.md','02-fact-base.json'],'09-visual-plan.json');
  writeFile(p09,final);
  recordStage('image-planning',stageSkills['article-image-placeholders'],['08-seo-optimized.md','09-visual-plan.json'],'09-FINAL.md');
  if(stageExecutions.length!==ARTICLE_STAGE_CONTRACT.length)throw new Error('成稿契约未完整执行');
  const stageManifestPath=path.join(workdir,'00-stage-executions.json');writeFile(stageManifestPath,JSON.stringify({generatedAt:new Date().toISOString(),stages:stageExecutions},null,2));
  // title 字段以正文 H1 为准（与 daily/tutorial 链路口径一致）：规划阶段 SELECTED_TITLE 仅供参考，写手实际定的 H1 才是发布标题
  const draftTitle=draft.match(/^#\s+(.+)$/m)?.[1]?.trim()||selectedTitle;
  const finalTitle=final.match(/^#\s+(.+)$/m)?.[1]?.trim()||finalSelectedTitle;
  store.saveDocument({batchId,candidateId,kind:'draft',title:draftTitle,content:draft,filePath:p04,status:'draft'});
  store.saveDocument({batchId,candidateId,kind:'final',title:finalTitle,content:final,filePath:p09,status:'finalized'});
  for(const [kind,name,file] of [['技能清单','00-skill-manifest.json',skillManifestPath],['阶段执行清单','00-stage-executions.json',stageManifestPath],['锁定简报','00-article-brief.md',briefPath],['事实基座','02-fact-base.json',factBasePath],['作者素材','01-personal-materials.md',p01],['文章大纲','02-outline.md',p02],['标题候选','03-titles.md',p03],['文章初稿','04-draft.md',p04],['初稿AI门禁','04-quality-gate.json',draftGatePath],['去AI稿','05-humanized.md',p05],['审稿门禁原始响应','06-review-gate.md',reviewLogPath],['审稿稿','06-reviewed.md',p06],['SEO关键词','07-seo-keywords.md',p07],['SEO优化稿','08-seo-optimized.md',p08],['终稿AI门禁','08-quality-gate.json',finalGatePath],['图表规划','09-visual-plan.json',visualPlanPath],['文章终稿','09-FINAL.md',p09]])artifact(store,batchId,kind,name,file);
  store.updateBatch(batchId,{stage:'typeset',status:'review'}); onProgress(`成稿完成:${visibleChars(final)} 个可见字符`);
  return {workdir,finalPath:p09,visibleChars:visibleChars(final),writerSkill:chosenWriterSkill,skillHash:skillBundle.hash,skillFallback:skillBundle.fallback,title:finalTitle};
}
