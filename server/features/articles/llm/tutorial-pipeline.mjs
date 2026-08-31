import fs from 'node:fs';
import path from 'node:path';
import { loadSkillBundle } from '../../../platform/llm/skill-runtime.mjs';
import { illustrateArticle } from '../application/article-illustration.mjs';
import { candidateArticleDir } from '../../../platform/core/workspace-paths.mjs';
import { resolveArticleLength } from '../../../platform/core/config.mjs';
import { markdownVisibleChars } from '../../../shared/domain/markdown-visible-chars.mjs';
import { bindGenerationSnapshot, prepareSkillRun } from '../../../platform/skills/pipeline-runtime.mjs';
import { configuredRepairAttempts, evaluateConfiguredGates } from '../../../platform/skills/configuration.mjs';
import { resolveArticleStageSkills } from '../../../platform/skills/entry-routing.mjs';
import { parseModelJson } from '../../../platform/llm/model-json.mjs';
import { buildContentFeedbackPromptContext } from '../../content-planning/wechat-content-feedback.mjs';

function writeFile(filePath,content){fs.mkdirSync(path.dirname(filePath),{recursive:true});const temp=`${filePath}.tmp`;fs.writeFileSync(temp,`${String(content).trimEnd()}\n`,'utf8');fs.renameSync(temp,filePath);return fs.statSync(filePath);}
function clean(value){return String(value||'').trim().replace(/^```(?:markdown)?\s*/i,'').replace(/\s*```$/,'');}
export function tutorialVisibleChars(value){return markdownVisibleChars(value);}
function parseJson(result,store){return parseModelJson(result,{store,label:'教程门禁'});}
function artifact(store,batchId,candidateId,kind,name,filePath){const stat=fs.statSync(filePath);store.upsertArtifact({batchId,candidateId,track:'article',kind,name,path:filePath,size:stat.size,modifiedAt:stat.mtime.toISOString()});}
async function textCall(gateway,input,system,user,maxOutputTokens){return gateway.complete({...input,maxOutputTokens,messages:[{role:'system',content:system,protected:true},{role:'user',content:user,protected:true}]});}
function applyTitle(markdown,title){const value=String(markdown||'').trim(),safe=String(title||'').trim();if(!safe)return value;return /^#\s+.+$/m.test(value)?value.replace(/^#\s+.+$/m,`# ${safe}`):`# ${safe}\n\n${value}`;}

export async function runTutorialPipeline({gateway,store,batchId,candidateId,provider,workspaceRoot,snapshotId=null,skillSelection=null,stageSelections=null,articleLength=null,onProgress=()=>{}}){
  const candidate=store.getCandidate(candidateId);if(!candidate||candidate.batch_id!==batchId)throw new Error('教程项目不存在或不属于当前批次');
  const batch=store.getBatch(batchId),workdir=candidateArticleDir(workspaceRoot,batch,candidate);
  const factPath=path.join(workdir,'01-tutorial-fact-base.json');
  if(!fs.existsSync(factPath))throw new Error('缺少教程事实基座');
  const fact=JSON.parse(fs.readFileSync(factPath,'utf8'));
  const articleMode=fact.article_mode==='experience'?'experience':'tutorial';
  if(articleMode==='tutorial'&&(fact.steps||[]).length<2)throw new Error('使用教程至少需要 2 个步骤');
  if(articleMode==='experience'&&!(fact.points||[]).some((item)=>item.source_level==='author_experience'))throw new Error('心得经验文章至少需要一条作者真实体验');
  if((fact.materials||[]).some((item)=>item.status!=='ok'))throw new Error('教程存在抓取失败的素材链接，请修正后重新创建');
  const historicalSnapshot=snapshotId?store.getGenerationSnapshot?.(snapshotId):null;
  const historicalWriter=historicalSnapshot?.snapshot?.selection?.selectedSkill
    ||historicalSnapshot?.snapshot?.skills?.[0]?.id;
  const historicalStages=historicalSnapshot?.snapshot?.selection?.stages||{};
  const resolvedStages=historicalSnapshot?historicalStages:(stageSelections||await resolveArticleStageSkills({workspaceRoot,entryPoint:'independent-writing'}));
  const skill=loadSkillBundle({workspaceRoot,skillName:historicalWriter||skillSelection?.selectedSkill||(articleMode==='experience'?'wechat-mp-personal-writing':'wechat-mp-tutorial')});
  const titleGenerator=loadSkillBundle({workspaceRoot,skillName:resolvedStages.title?.selectedSkill||'title-generator'});
  const reviewer=loadSkillBundle({workspaceRoot,skillName:resolvedStages.reviewer?.selectedSkill||'article-reviewer'});
  const humanizer=loadSkillBundle({workspaceRoot,skillName:resolvedStages.humanizer?.selectedSkill||'humanizer-zh'});
  const seoOptimizer=loadSkillBundle({workspaceRoot,skillName:resolvedStages.seo?.selectedSkill||'seo-content-optimizer'});
  const contentFeedback=store.getLatestContentFeedbackSnapshot?.() || null;
  const writingFeedback=buildContentFeedbackPromptContext(contentFeedback,{target:'writing'});
  const titleFeedback=buildContentFeedbackPromptContext(contentFeedback,{target:'title'});
  const runtime=await prepareSkillRun({gateway,store,batchId,candidateId,purpose:articleMode==='experience'?'personal-writing':'tutorial',bundles:[skill,titleGenerator,humanizer,reviewer,seoOptimizer],provider,snapshotId,
    selection:{...(skillSelection||{requestedSkill:'',selectedSkill:skill.skillName,selectionSource:'builtin-recommendation'}),entryPoint:'independent-writing',contentType:articleMode,stages:resolvedStages}});
  gateway=bindGenerationSnapshot(gateway,runtime.snapshotId);
  provider=runtime.provider;const providerConfig=runtime.providerConfig,maxTokens=Math.min(6500,providerConfig.maxOutputTokens);
  const configuredLength=runtime.config?.gates?.length;
  // 技能覆盖层 > config.local.json articleLength（pipelines.tutorial 差异覆盖）> 默认 1300–2000
  const resolvedLength=resolveArticleLength({articleLength},'tutorial');
  const minChars=Number(configuredLength?.minVisibleChars??resolvedLength.min),maxChars=Number(configuredLength?.maxVisibleChars??resolvedLength.max);
  const repairAttempts=configuredRepairAttempts(runtime.config,1);
  const label=articleMode==='experience'?'心得经验':'使用教程';
  onProgress(`${label} 1/7 根据自主写作事实基座生成初稿`);
  const draftResult=await textCall(gateway,{provider,purpose:'tutorial-drafting',batchId,candidateId},`${skill.prompt}${writingFeedback?`\n\n${writingFeedback}`:''}`,`${articleMode==='experience'?'personal_writing_fact_base':'tutorial_fact_base'}:\n${JSON.stringify(fact)}`,maxTokens);
  const draft=clean(draftResult.content),draftPath=path.join(workdir,'04-draft.md');writeFile(draftPath,draft);
  onProgress(`${label} 2/7 根据初稿生成并锁定标题`);
  const titleResult=await gateway.complete({provider,purpose:'tutorial-title-generation',batchId,candidateId,jsonMode:true,maxOutputTokens:Math.min(3000,providerConfig.maxOutputTokens),messages:[
    {role:'system',content:`${titleGenerator.prompt}${titleFeedback?`\n\n${titleFeedback}`:''}\n\n根据完整初稿生成标题，返回严格 JSON：{"selectedTitle":"最终标题","titleCandidates":["候选1","候选2"],"coreKeywords":["关键词"]}。不得引入初稿没有的事实、数字、人物或结论。`,protected:true},
    {role:'user',content:JSON.stringify({topic:fact.topic,articleMode,draft}),protected:true},
  ]});
  let titlePlan={};try{titlePlan=parseJson(titleResult,store);}catch{}
  const selectedTitle=String(titlePlan.selectedTitle||draft.match(/^#\s+(.+)$/m)?.[1]||fact.topic).trim();
  const titleCandidates=Array.isArray(titlePlan.titleCandidates)?titlePlan.titleCandidates.map(String).filter(Boolean):[selectedTitle];
  const coreKeywords=Array.isArray(titlePlan.coreKeywords)?titlePlan.coreKeywords.map(String).filter(Boolean).slice(0,6):[];
  const titlePath=path.join(workdir,'03-titles.md');
  writeFile(titlePath,`# 标题候选\n\n${titleCandidates.map((item,index)=>`${index+1}. ${item}`).join('\n')}\n\nSELECTED_TITLE: ${selectedTitle}\n\ncore_keywords: ${coreKeywords.join('、')}`);
  onProgress(`${label} 3/7 去除模板腔并保持事实不变`);
  const humanResult=await textCall(gateway,{provider,purpose:'tutorial-humanize',batchId,candidateId},`${humanizer.prompt}\n\n只改表达，不新增步骤、命令、版本、结果、来源或亲测经历。`,draft,maxTokens);
  const human=applyTitle(clean(humanResult.content),selectedTitle),humanPath=path.join(workdir,'05-humanized.md');writeFile(humanPath,human);
  onProgress(`${label} 4/7 审阅并修订事实、逻辑与风险`);
  const reviewResult=await textCall(gateway,{provider,purpose:'tutorial-review',batchId,candidateId},`${reviewer.prompt}\n\n根据事实基座直接返回修订后的完整 Markdown，不要输出审阅报告、评分、result 标记或新增事实。保留来源链接与标题。`,
    `${articleMode==='experience'?'personal_writing_fact_base':'tutorial_fact_base'}:${JSON.stringify(fact)}\n\n待审文章:\n${human}`,maxTokens);
  const reviewed=applyTitle(clean(reviewResult.content),selectedTitle),reviewedPath=path.join(workdir,'06-reviewed.md');writeFile(reviewedPath,reviewed);
  onProgress(`${label} 5/7 执行 SEO 优化并保持事实与作者立场`);
  const seoResult=await textCall(gateway,{provider,purpose:'tutorial-seo',batchId,candidateId},`${seoOptimizer.prompt}\n\n直接返回优化后的完整 Markdown。不得改变步骤、事实、来源、作者经历与观点；不得添加搜索量或效果承诺。`,
    `核心关键词:${coreKeywords.join('、')}\n\n待优化文章:\n${reviewed}`,maxTokens);
  let final=applyTitle(clean(seoResult.content),selectedTitle);
  const seoPath=path.join(workdir,'08-seo-optimized.md');writeFile(seoPath,final);
  const gate=async(stage)=>{
    const system=`你是文章事实与真实性质量门禁。只评估，不修改、不续写、不复述文章。必须仅返回严格 JSON：{"pass":boolean,"issues":[{"message":"..."}]}。禁止返回 Markdown、标题、代码围栏或 JSON 之外的文字。${articleMode==='experience'?'检查第一人称经历只来自 author_experience，观点未超出作者输入，素材事实保留归属，model_suggestion 未伪装亲历或确定结论。':'检查步骤可复现、环境与前置条件明确、所有确定性步骤和结果由 author_experience 或 user_material 支持、model_suggestion 未伪装实测、来源链接可追溯。'}不要估算字符数，长度由程序检查。`;
    const user=`${articleMode==='experience'?'personal_writing_fact_base':'tutorial_fact_base'}:${JSON.stringify(fact)}\n\n${label}文章:\n${final}`;
    for(let attempt=0;attempt<2;attempt+=1){
      const result=await gateway.complete({provider,purpose:`tutorial-quality-gate-${stage}${attempt?'-format-retry':''}`,batchId,candidateId,jsonMode:true,maxOutputTokens:Math.min(3000,providerConfig.maxOutputTokens),messages:[
        {role:'system',protected:true,content:attempt?`${system}\n上一次返回了文章正文而不是 JSON。本次不得输出任何文章正文。`:system},
        {role:'user',protected:true,content:user},
      ]});
      try{return parseJson(result,store);}catch(error){if(attempt===1)throw error;}
    }
    throw new Error('教程门禁未返回结果');
  };
  onProgress(`${label} 6/7 执行事实与真实性门禁`);
  let quality=await gate('initial'),count=tutorialVisibleChars(final);
  for(let attempt=0;(!quality.pass||count<minChars||count>maxChars)&&attempt<repairAttempts;attempt+=1){
    const repair=await textCall(gateway,{provider,purpose:'tutorial-repair',batchId,candidateId},skill.prompt,`只修复问题，不新增事实或实践。当前字符数 ${count}，目标 ${minChars}–${maxChars}。\n问题:${JSON.stringify(quality.issues||[])}\n事实基座:${JSON.stringify(fact)}\n\n教程:\n${final}`,maxTokens);
    final=applyTitle(clean(repair.content),selectedTitle);quality=await gate('recheck');count=tutorialVisibleChars(final);
  }
  if(!quality.pass)throw new Error(`${label}质量门禁未通过：${(quality.issues||[]).map((item)=>item.message||item).join('；')}`);
  if(count<minChars||count>maxChars)onProgress(`字数警告：${label}有 ${count} 个可见字符，不在 ${minChars}–${maxChars} 字区间，可稍后在编辑器手动删减，流程继续`);
  const configuredGate=evaluateConfiguredGates(runtime.config,{factBase:fact,output:final,visibleChars:count});
  if(!configuredGate.pass)throw new Error(`${label}配置门禁未通过：${configuredGate.issues.map((item)=>item.message).join('；')}`);
  onProgress(`${label} 7/7 自动配图：先插入 Mermaid/ECharts 图表，再规划手动供图占位`);
  const illustration=await illustrateArticle({
    gateway,store,provider,batchId,candidateId,markdown:final,factBase:JSON.stringify(fact),
    workspaceRoot,maxOutputTokens:Math.min(5000,providerConfig.maxOutputTokens),
    imageSkillPrompt:loadSkillBundle({workspaceRoot,skillName:'article-image-placeholders'}).prompt,
    onProgress,
  });
  final=illustration.markdown;
  const visualPlanPath=path.join(workdir,'09-visual-plan.json');
  writeFile(visualPlanPath,JSON.stringify(illustration.visualPlan,null,2));
  const finalPath=path.join(workdir,'09-FINAL.md'),gatePath=path.join(workdir,'08-quality-gate.json');
  writeFile(finalPath,final);writeFile(gatePath,JSON.stringify(quality,null,2));
  const title=final.match(/^#\s+(.+)$/m)?.[1]?.trim()||fact.topic;
  store.saveDocument({batchId,candidateId,kind:'draft',title,content:draft,filePath:draftPath,status:'draft'});
  store.saveDocument({batchId,candidateId,kind:'final',title,content:final,filePath:finalPath,status:'finalized'});
  artifact(store,batchId,candidateId,'自主写作初稿','04-draft.md',draftPath);artifact(store,batchId,candidateId,'自主写作质量门禁','08-quality-gate.json',gatePath);artifact(store,batchId,candidateId,'图表规划','09-visual-plan.json',visualPlanPath);artifact(store,batchId,candidateId,'文章终稿','09-FINAL.md',finalPath);
  artifact(store,batchId,candidateId,'标题候选','03-titles.md',titlePath);artifact(store,batchId,candidateId,'自然化稿','05-humanized.md',humanPath);
  artifact(store,batchId,candidateId,'审阅修订稿','06-reviewed.md',reviewedPath);artifact(store,batchId,candidateId,'SEO 优化稿','08-seo-optimized.md',seoPath);
  store.updateBatch(batchId,{stage:'typeset',status:'review'});onProgress(`${label}成稿完成：${count} 个可见字符`);
  return {candidateId,workdir,finalPath,title,visibleChars:count};
}
