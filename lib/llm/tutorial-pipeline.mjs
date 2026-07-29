import fs from 'node:fs';
import path from 'node:path';
import { loadSkillBundle } from './skill-runtime.mjs';
import { candidateArticleDir } from '../core/workspace-paths.mjs';
import { markdownVisibleChars } from '../domain/markdown-visible-chars.mjs';

function writeFile(filePath,content){fs.mkdirSync(path.dirname(filePath),{recursive:true});const temp=`${filePath}.tmp`;fs.writeFileSync(temp,`${String(content).trimEnd()}\n`,'utf8');fs.renameSync(temp,filePath);return fs.statSync(filePath);}
function clean(value){return String(value||'').trim().replace(/^```(?:markdown)?\s*/i,'').replace(/\s*```$/,'');}
export function tutorialVisibleChars(value){return markdownVisibleChars(value);}
function parseJson(result,store){try{return JSON.parse(String(result.content).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch(error){store.updateModelCall(result.callId,{status:'invalid_output',error:error.message});throw new Error(`教程门禁返回无效 JSON：${error.message}`);}}
function artifact(store,batchId,candidateId,kind,name,filePath){const stat=fs.statSync(filePath);store.upsertArtifact({batchId,candidateId,track:'article',kind,name,path:filePath,size:stat.size,modifiedAt:stat.mtime.toISOString()});}
async function textCall(gateway,input,system,user,maxOutputTokens){return gateway.complete({...input,maxOutputTokens,messages:[{role:'system',content:system,protected:true},{role:'user',content:user,protected:true}]});}

export async function runTutorialPipeline({gateway,store,batchId,candidateId,provider,workspaceRoot,onProgress=()=>{}}){
  const candidate=store.getCandidate(candidateId);if(!candidate||candidate.batch_id!==batchId)throw new Error('教程项目不存在或不属于当前批次');
  const batch=store.getBatch(batchId),workdir=candidateArticleDir(workspaceRoot,batch,candidate);
  const factPath=path.join(workdir,'01-tutorial-fact-base.json');
  if(!fs.existsSync(factPath))throw new Error('缺少教程事实基座');
  const fact=JSON.parse(fs.readFileSync(factPath,'utf8'));
  const articleMode=fact.article_mode==='experience'?'experience':'tutorial';
  if(articleMode==='tutorial'&&(fact.steps||[]).length<2)throw new Error('使用教程至少需要 2 个步骤');
  if(articleMode==='experience'&&!(fact.points||[]).some((item)=>item.source_level==='author_experience'))throw new Error('心得经验文章至少需要一条作者真实体验');
  if((fact.materials||[]).some((item)=>item.status!=='ok'))throw new Error('教程存在抓取失败的素材链接，请修正后重新创建');
  const {provider:providerConfig}=gateway.resolve(provider),maxTokens=Math.min(6500,providerConfig.maxOutputTokens);
  const skill=loadSkillBundle({workspaceRoot,skillName:articleMode==='experience'?'wechat-mp-personal-writing':'wechat-mp-tutorial'});
  const reviewer=loadSkillBundle({workspaceRoot,skillName:'article-reviewer'});
  const humanizer=loadSkillBundle({workspaceRoot,skillName:'humanizer-zh'});
  const label=articleMode==='experience'?'心得经验':'使用教程';
  onProgress(`${label} 1/4 根据自主写作事实基座生成初稿`);
  const draftResult=await textCall(gateway,{provider,purpose:'tutorial-drafting',batchId,candidateId},skill.prompt,`${articleMode==='experience'?'personal_writing_fact_base':'tutorial_fact_base'}:\n${JSON.stringify(fact)}`,maxTokens);
  const draft=clean(draftResult.content),draftPath=path.join(workdir,'04-draft.md');writeFile(draftPath,draft);
  onProgress('教程 2/4 去除模板腔并保持步骤与事实不变');
  const humanResult=await textCall(gateway,{provider,purpose:'tutorial-humanize',batchId,candidateId},`${humanizer.prompt}\n\n只改表达，不新增步骤、命令、版本、结果、来源或亲测经历。`,draft,maxTokens);
  let final=clean(humanResult.content);
  const gate=async(stage)=>parseJson(await gateway.complete({provider,purpose:`tutorial-quality-gate-${stage}`,batchId,candidateId,jsonMode:true,maxOutputTokens:Math.min(3000,providerConfig.maxOutputTokens),messages:[
    {role:'system',protected:true,content:`${reviewer.prompt}\n\n只执行${label}门禁并返回 {"pass":boolean,"issues":[{"message":"..."}]}。${articleMode==='experience'?'检查第一人称经历只来自 author_experience，观点未超出作者输入，素材事实保留归属，model_suggestion 未伪装亲历或确定结论。':'检查步骤可复现、环境与前置条件明确、所有确定性步骤和结果由 author_experience 或 user_material 支持、model_suggestion 未伪装实测、来源链接可追溯。'}不要估算字符数，长度由程序检查。`},
    {role:'user',protected:true,content:`${articleMode==='experience'?'personal_writing_fact_base':'tutorial_fact_base'}:${JSON.stringify(fact)}\n\n${label}文章:\n${final}`},
  ]}),store);
  onProgress(`${label} 3/4 执行事实与真实性门禁`);
  let quality=await gate('initial'),count=tutorialVisibleChars(final);
  if(!quality.pass||count<1000||count>1800){
    const repair=await textCall(gateway,{provider,purpose:'tutorial-repair',batchId,candidateId},skill.prompt,`只修复问题，不新增事实或实践。当前字符数 ${count}，目标 1000–1800。\n问题:${JSON.stringify(quality.issues||[])}\n事实基座:${JSON.stringify(fact)}\n\n教程:\n${final}`,maxTokens);
    final=clean(repair.content);quality=await gate('recheck');count=tutorialVisibleChars(final);
  }
  if(!quality.pass)throw new Error(`${label}质量门禁未通过：${(quality.issues||[]).map((item)=>item.message||item).join('；')}`);
  if(count<1000||count>1800)throw new Error(`${label}有 ${count} 个可见字符，未达到 1000–1800 字门禁`);
  onProgress(`${label} 4/4 保存标准文章终稿`);
  const finalPath=path.join(workdir,'09-FINAL.md'),gatePath=path.join(workdir,'08-quality-gate.json');
  writeFile(finalPath,final);writeFile(gatePath,JSON.stringify(quality,null,2));
  const title=final.match(/^#\s+(.+)$/m)?.[1]?.trim()||fact.topic;
  store.saveDocument({batchId,candidateId,kind:'draft',title,content:draft,filePath:draftPath,status:'draft'});
  store.saveDocument({batchId,candidateId,kind:'final',title,content:final,filePath:finalPath,status:'finalized'});
  artifact(store,batchId,candidateId,'自主写作初稿','04-draft.md',draftPath);artifact(store,batchId,candidateId,'自主写作质量门禁','08-quality-gate.json',gatePath);artifact(store,batchId,candidateId,'文章终稿','09-FINAL.md',finalPath);
  store.updateBatch(batchId,{stage:'typeset',status:'review'});onProgress(`${label}成稿完成：${count} 个可见字符`);
  return {candidateId,workdir,finalPath,title,visibleChars:count};
}
