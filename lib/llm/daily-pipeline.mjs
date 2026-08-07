import fs from 'node:fs';
import path from 'node:path';
import { ensureBatchEventCards, dimensionSelections } from './research-pipeline.mjs';
import { loadSkillBundle } from './skill-runtime.mjs';
import { bindGenerationSnapshot, prepareSkillRun } from '../skills/pipeline-runtime.mjs';
import { configuredRepairAttempts, evaluateConfiguredGates } from '../skills/configuration.mjs';
import { batchArticlesDir } from '../core/workspace-paths.mjs';
import { resolveArticleLength } from '../core/config.mjs';
import { markdownVisibleChars } from '../domain/markdown-visible-chars.mjs';
import { resolveArticleStageSkills } from '../skills/entry-routing.mjs';

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, `${String(content).trimEnd()}\n`, 'utf8');
  fs.renameSync(temp, filePath);
  return fs.statSync(filePath);
}
function cleanMarkdown(value) {
  return String(value || '').trim().replace(/^```(?:markdown)?\s*/i, '').replace(/\s*```$/, '');
}
function applyTitle(markdown,title) {
  const value=String(markdown||'').trim(),safe=String(title||'').trim();
  if(!safe)return value;
  return /^#\s+.+$/m.test(value)?value.replace(/^#\s+.+$/m,`# ${safe}`):`# ${safe}\n\n${value}`;
}
export function dailyVisibleChars(markdown) {
  return markdownVisibleChars(markdown);
}
function parseJson(result, store) {
  const raw = String(result.content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(raw); } catch (error) {
    store.updateModelCall(result.callId, { status: 'invalid_output', error: `早报门禁返回无效 JSON：${error.message}` });
    throw new Error(`早报门禁返回无效 JSON：${error.message}`);
  }
}
function artifact(store, batchId, kind, name, filePath) {
  const stat = fs.statSync(filePath);
  store.upsertArtifact({ batchId, kind, name, path: filePath, size: stat.size, modifiedAt: stat.mtime.toISOString() });
}
function normalizeEvent(event) {
  const card = event.card || {};
  return {
    event_id: event.event_id,
    title: event.representative_title || card.title,
    conclusion: card.conclusion || '',
    key_facts: card.key_facts || card.keyFacts || [],
    uncertainties: card.uncertainties || [],
    sources: (event.articles || []).map((item) => ({
      title: item.title, source: item.source, url: item.url, time: item.time,
    })).filter((item) => item.url),
  };
}
export function dailyFocusOptions(clusters) {
  return dimensionSelections(clusters, [], { whoLimit:50, whatLimit:50, whereLimit:50 })
    .filter((group)=>group.events.filter((event)=>event.card).length>=2)
    .map((group)=>({
      dimension:group.dimension,key:group.key,label:group.title,score:group.score,riskLevel:group.riskLevel,
      eventIds:group.events.filter((event)=>event.card).map((event)=>event.event_id),
      leads:group.leads||[],
    }));
}
export function selectDailyEvents(clusters, focuses = []) {
  const requested=Array.isArray(focuses)?focuses:[focuses];
  const wanted=new Set(requested.map((item)=>`${item?.dimension}:${item?.key}`));
  const events=new Map();
  for(const group of dimensionSelections(clusters, [], { whoLimit:50, whatLimit:50, whereLimit:50 })){
    if(!wanted.has(`${group.dimension}:${group.key}`))continue;
    for(const event of group.events)if(event.card)events.set(event.event_id,normalizeEvent(event));
  }
  return [...events.values()];
}
export function normalizeDailyQuality(quality, visibleChars) {
  const issues=(Array.isArray(quality?.issues)?quality.issues:[]).filter((item)=>{
    const message=String(item?.message||item||'');
    if(visibleChars<=1800&&/可能.{0,8}(超过|超出).{0,8}1800|无法确认.{0,8}1800/.test(message))return false;
    if(/事件\s*ID|事件ID|独立引用|逐(?:条|事件)引用/.test(message)&&!/关键事实|事实错误|来源不支持/.test(message))return false;
    return true;
  });
  return {...quality,issues,pass:issues.length===0};
}
async function textCall(gateway, input, system, user, maxOutputTokens) {
  return gateway.complete({ ...input, maxOutputTokens, messages: [
    { role: 'system', content: system, protected: true },
    { role: 'user', content: user, protected: true },
  ] });
}

export async function runDailyPipeline({ gateway, store, batchId, provider, workspaceRoot, snapshotId=null, stageSelections=null, focuses = [], focus = null, articleLength=null, onProgress = () => {} }) {
  const batch = store.getBatch(batchId);
  if (!batch) throw new Error('批次不存在');
  if (batch.batch_type === 'breaking') throw new Error('突发专题不适合生成批次早报');
  onProgress('早报 1/6 读取并补齐事件事实卡');
  const cards = await ensureBatchEventCards({
    gateway, store, batchId, provider, workspaceRoot,
    maxAgeHours: Number(batch.max_age_hours) || 168, onProgress,
  });
  const options=dailyFocusOptions(cards.clusters||[]);
  const requested=(Array.isArray(focuses)&&focuses.length?focuses:[focus]).filter(Boolean);
  const requestedKeys=new Set(requested.map((item)=>`${item.dimension}:${item.key}`));
  const selectedFocuses=options.filter((item)=>requestedKeys.has(`${item.dimension}:${item.key}`));
  if(!selectedFocuses.length||selectedFocuses.length!==requestedKeys.size)throw new Error('部分所选事件关系不存在、关联事件不足 2 条，或事实卡尚未生成');
  const newsItems = selectDailyEvents(cards.clusters || [], selectedFocuses);
  const focusContext={
    labels:selectedFocuses.map((item)=>item.label),
    dimensions:[...new Set(selectedFocuses.map((item)=>item.dimension))],
    relations:selectedFocuses,
  };

  const workdir = path.join(batchArticlesDir(workspaceRoot, batch), 'daily');
  const factPath = path.join(workdir, '01-news-items.json');
  writeFile(factPath, JSON.stringify({ batch_id: batchId, generated_at: new Date().toISOString(), focus:focusContext, items: newsItems }, null, 2));
  const historicalSnapshot=snapshotId?store.getGenerationSnapshot?.(snapshotId):null;
  const historicalStages=historicalSnapshot?.snapshot?.selection?.stages||{};
  const resolvedStages=historicalSnapshot?historicalStages:(stageSelections||await resolveArticleStageSkills({workspaceRoot,entryPoint:'batch-daily'}));
  const dailySkill = loadSkillBundle({ workspaceRoot, skillName: 'wechat-mp-daily' });
  const titleGenerator = loadSkillBundle({ workspaceRoot, skillName: resolvedStages.title?.selectedSkill||'title-generator' });
  const reviewer = loadSkillBundle({ workspaceRoot, skillName: resolvedStages.reviewer?.selectedSkill||'article-reviewer' });
  const humanizer = loadSkillBundle({ workspaceRoot, skillName: resolvedStages.humanizer?.selectedSkill||'humanizer-zh' });
  const seoOptimizer = loadSkillBundle({ workspaceRoot, skillName: resolvedStages.seo?.selectedSkill||'seo-content-optimizer' });
  const runtime=await prepareSkillRun({gateway,store,batchId,purpose:'daily',bundles:[dailySkill,titleGenerator,humanizer,reviewer,seoOptimizer],provider,snapshotId,
    selection:{requestedSkill:'',selectedSkill:'wechat-mp-daily',selectionSource:'builtin-default',entryPoint:'batch-daily',stages:resolvedStages}});
  gateway=bindGenerationSnapshot(gateway,runtime.snapshotId);
  provider=runtime.provider;const providerConfig=runtime.providerConfig;
  const configuredLength=runtime.config?.gates?.length;
  // 技能覆盖层 > config.local.json articleLength（pipelines.daily 差异覆盖）> 默认 1300–2000
  const resolvedLength=resolveArticleLength({articleLength},'daily');
  const minChars=Number(configuredLength?.minVisibleChars??resolvedLength.min),maxChars=Number(configuredLength?.maxVisibleChars??resolvedLength.max);
  const repairAttempts=configuredRepairAttempts(runtime.config,1);
  const maxTokens = Math.min(5000, providerConfig.maxOutputTokens);

  onProgress(`早报 2/6 围绕 ${selectedFocuses.length} 个关系归纳 ${newsItems.length} 个关联事件`);
  const draftResult = await textCall(gateway, { provider, purpose: 'daily-drafting', batchId }, dailySkill.prompt,
    `批次日期：${batch.batch_date}\n批次标题：${batch.title}\n\nfocus:\n${JSON.stringify(focusContext)}\n\nnews_items:\n${JSON.stringify(newsItems)}`, maxTokens);
  let draft = cleanMarkdown(draftResult.content);
  const draftPath = path.join(workdir, '02-draft.md');
  writeFile(draftPath, draft);

  onProgress('早报 3/6 根据完整初稿生成并锁定标题');
  const titleResult=await gateway.complete({provider,purpose:'daily-title-generation',batchId,jsonMode:true,maxOutputTokens:Math.min(3000,providerConfig.maxOutputTokens),messages:[
    {role:'system',protected:true,content:`${titleGenerator.prompt}\n\n根据完整早报生成标题，返回严格 JSON：{"selectedTitle":"最终标题","titleCandidates":["候选1","候选2"],"coreKeywords":["关键词"]}。不得引入事件事实卡没有的事实、数字、人物或结论。`},
    {role:'user',protected:true,content:JSON.stringify({batchDate:batch.batch_date,focus:focusContext,draft})},
  ]});
  let titlePlan={};try{titlePlan=parseJson(titleResult,store);}catch{}
  const selectedTitle=String(titlePlan.selectedTitle||draft.match(/^#\s+(.+)$/m)?.[1]||`${batch.batch_date} 大厂早报`).trim();
  const titleCandidates=Array.isArray(titlePlan.titleCandidates)?titlePlan.titleCandidates.map(String).filter(Boolean):[selectedTitle];
  const coreKeywords=Array.isArray(titlePlan.coreKeywords)?titlePlan.coreKeywords.map(String).filter(Boolean).slice(0,6):[];
  const titlePath=path.join(workdir,'02-titles.md');
  writeFile(titlePath,`# 标题候选\n\n${titleCandidates.map((item,index)=>`${index+1}. ${item}`).join('\n')}\n\nSELECTED_TITLE: ${selectedTitle}\n\ncore_keywords: ${coreKeywords.join('、')}`);

  onProgress('早报 4/6 去除模板腔并保持事实不变');
  const humanResult = await textCall(gateway, { provider, purpose: 'daily-humanize', batchId },
    `${humanizer.prompt}\n\n只改表达，不新增、删改或推断任何事实、数字、来源与 URL；保留早报结构。`,
    draft, maxTokens);
  const human=applyTitle(cleanMarkdown(humanResult.content),selectedTitle),humanPath=path.join(workdir,'03-humanized.md');
  writeFile(humanPath,human);

  onProgress('早报 5/6 审阅修订并执行 SEO 优化');
  const reviewResult=await textCall(gateway,{provider,purpose:'daily-review',batchId},`${reviewer.prompt}\n\n根据事件事实卡直接返回修订后的完整 Markdown，不要输出审阅报告、评分、result 标记或新增事实。保留来源链接与标题。`,
    `focus:${JSON.stringify(focusContext)}\nnews_items:${JSON.stringify(newsItems)}\n\n待审早报:\n${human}`,maxTokens);
  const reviewed=applyTitle(cleanMarkdown(reviewResult.content),selectedTitle),reviewedPath=path.join(workdir,'04-reviewed.md');
  writeFile(reviewedPath,reviewed);
  const seoResult=await textCall(gateway,{provider,purpose:'daily-seo',batchId},`${seoOptimizer.prompt}\n\n直接返回优化后的完整 Markdown。不得改变事实、来源和关系判断；不得添加搜索量或效果承诺。`,
    `核心关键词:${coreKeywords.join('、')}\n\n待优化早报:\n${reviewed}`,maxTokens);
  let final=applyTitle(cleanMarkdown(seoResult.content),selectedTitle),seoPath=path.join(workdir,'05-seo-optimized.md');
  writeFile(seoPath,final);

  const gate = async (article, stage) => parseJson(await gateway.complete({
    provider, purpose: `daily-quality-gate-${stage}`, batchId, jsonMode: true,
    maxOutputTokens: Math.min(3000, providerConfig.maxOutputTokens),
    messages: [
      { role: 'system', protected: true, content: `${reviewer.prompt}\n\n你只执行关系维度早报质量门禁，返回 JSON：{"pass":boolean,"issues":[{"message":"..."}]}。检查标题、导语和结构是否兑现全部 focus；是否概括重要事实并正确解释关系；是否有 2–6 个信息段落和可追溯来源链接；事实是否均由 news_items 支持；严肃事件语气是否中性。允许把多个事件合并归纳，不要求每个事件独立成段、独立引用、出现标题或暴露 event_id。不要判断字符数，字符上限由程序确定性检查。` },
      { role: 'user', protected: true, content: `focus:${JSON.stringify(focusContext)}\nnews_items:${JSON.stringify(newsItems)}\n\n待检查早报：\n${article}` },
    ],
  }), store);
  onProgress('早报 6/6 执行最终质量门禁并保存终稿');
  let quality = normalizeDailyQuality(await gate(final, 'initial'),dailyVisibleChars(final));
  for(let attempt=0;(!quality.pass||dailyVisibleChars(final)<minChars||dailyVisibleChars(final)>maxChars)&&attempt<repairAttempts;attempt+=1){
    onProgress(`早报质量门禁未通过，执行一次保真返工`);
    const repair = await textCall(gateway, { provider, purpose: 'daily-repair', batchId }, dailySkill.prompt,
      `只修复所列问题，不新增事实。focus:${JSON.stringify(focusContext)}\nnews_items:${JSON.stringify(newsItems)}\n问题:${JSON.stringify(quality.issues || [])}\n当前可见字符:${dailyVisibleChars(final)}\n\n待返工早报：\n${final}`, maxTokens);
    final = applyTitle(cleanMarkdown(repair.content),selectedTitle);
    quality = normalizeDailyQuality(await gate(final, 'recheck'),dailyVisibleChars(final));
  }
  const count = dailyVisibleChars(final);
  if (!quality.pass) throw new Error(`早报质量门禁未通过：${(quality.issues || []).map((item) => item.message || item).join('；')}`);
  if (count<minChars||count>maxChars) onProgress(`字数警告：早报有 ${count} 个可见字符，不在 ${minChars}–${maxChars} 字区间，可稍后在编辑器手动删减，流程继续`);
  const configuredGate=evaluateConfiguredGates(runtime.config,{factBase:{items:newsItems},output:final,visibleChars:count});
  if(!configuredGate.pass)throw new Error(`早报配置门禁未通过：${configuredGate.issues.map((item)=>item.message).join('；')}`);

  const finalPath = path.join(workdir, '03-FINAL.md');
  const gatePath = path.join(workdir, '06-quality-gate.json');
  writeFile(finalPath, final);
  writeFile(gatePath, JSON.stringify(quality, null, 2));
  const title = final.match(/^#\s+(.+)$/m)?.[1]?.trim() || `${batch.batch_date} 大厂早报`;
  store.saveDocument({ batchId, kind: 'daily-draft', title, content: draft, filePath: draftPath, status: 'draft' });
  store.saveDocument({ batchId, kind: 'daily-final', title, content: final, filePath: finalPath, status: 'finalized' });
  artifact(store, batchId, '早报事实清单', '01-news-items.json', factPath);
  artifact(store, batchId, '早报初稿', '02-draft.md', draftPath);
  artifact(store, batchId, '标题候选', '02-titles.md', titlePath);
  artifact(store, batchId, '自然化稿', '03-humanized.md', humanPath);
  artifact(store, batchId, '审阅修订稿', '04-reviewed.md', reviewedPath);
  artifact(store, batchId, 'SEO 优化稿', '05-seo-optimized.md', seoPath);
  artifact(store, batchId, '早报质量门禁', '06-quality-gate.json', gatePath);
  artifact(store, batchId, '早报终稿', '03-FINAL.md', finalPath);
  onProgress(`批次早报完成：${selectedFocuses.length} 个关系 · ${newsItems.length} 个关联事件 · ${count} 个可见字符`);
  return { workdir, finalPath, title, visibleChars: count, eventCount: newsItems.length, focuses:selectedFocuses };
}
