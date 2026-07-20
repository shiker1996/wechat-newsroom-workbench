import fs from 'node:fs';
import path from 'node:path';
import { planImagePlaceholders } from '../image-workflow.mjs';
import { scoreKeywords } from './seo-score.mjs';
import { formatAccountContext } from '../account-context.mjs';

function writeFile(filePath,content) { fs.mkdirSync(path.dirname(filePath),{recursive:true}); const temp=`${filePath}.tmp`; fs.writeFileSync(temp,String(content).trimEnd()+'\n','utf8'); fs.renameSync(temp,filePath); return fs.statSync(filePath); }
function cleanMarkdown(value) { return String(value||'').trim().replace(/^```(?:markdown)?\s*/i,'').replace(/\s*```$/,''); }
function visibleChars(markdown) { return markdown.replace(/^#.*$/gm,'').replace(/<!--[^]*?-->/g,'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_`>#-]/g,'').replace(/\s/g,'').length; }
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
  if(candidate.category==='🤖 AI/技术动态')return 'wechat-mp-tech-hotspot';
  if(candidate.category==='🏢 大厂战略'&&/趣|离谱|八卦/.test(candidate.angle||''))return 'wechat-mp-gossip-chill';
  return 'wechat-mp-deep-dive';
}

function buildPlanSystem() {
  return formatAccountContext() + '\n\n你是公众号成稿规划器。严格依据已锁定简报，不得补造事实、数字、引语、作者经历或来源。\n- 如果候选标记为 composite=true，说明这是**综合选题**，需要对多个热点来源进行综合。sourceUrl 包含多个来源的标题和 URL。\n- 如果 composite 为 false 或未提供，则是单热点常规选题。\n返回严格JSON：{"contentRole":"拉新|沉淀|搜索","expectedAction":["评论|分享|收藏|关注|搜索"],"practicalIncrement":字符串,"materialsMarkdown":字符串,"outlineMarkdown":字符串,"titleCandidates":[{"title":字符串,"reason":字符串}],"selectedTitle":字符串,"coreKeywords":[字符串],"remainingRisks":[字符串]}。\noutlineMarkdown必须包含"核心判断、目标读者、内容角色、事实基座、结构大纲、信息增量、实用增量、增长承接"。事实基座只使用输入的已确认事实并就近记录来源URL；不确定内容标记unverified且不得进入正文。标题不超过28个汉字。不要输出JSON之外的文字。';
}

async function textCall(gateway,input,system,user,maxOutputTokens=5000) {
  return gateway.complete({...input,maxOutputTokens,messages:[{role:'system',content:system,protected:true},{role:'user',content:user,protected:true}]});
}

export async function runArticlePipeline({gateway,store,batchId,candidateId,provider,workspaceRoot,onProgress=()=>{}}) {
  const candidate=store.getCandidate(candidateId); if(!candidate||candidate.batch_id!==batchId)throw new Error('候选不存在或不属于当前批次');
  const editorial=candidate.editorial;
  if(editorial.brief_status!=='LOCKED'||editorial.next_action!=='WRITE_NOW')throw new Error('必须先完成编辑会并锁定 article-brief.md');
  if(editorial.open_questions.trim())throw new Error('仍有未决问题,不能进入成稿');
  if(editorial.experience_required&&!editorial.confirmed_experiences.trim())throw new Error('本题依赖亲身实践,但尚无已确认经历或证据');
  if(!editorial.confirmed_facts.trim())throw new Error('事实基座为空,请回到编辑室确认可写事实和来源');
  if(candidate.f_score!=null&&candidate.f_score<55)throw new Error(`候选 F=${candidate.f_score},低于成稿硬门槛 55`);
  const batch=store.getBatch(batchId); const workdir=path.join(workspaceRoot,'articles',`${batch.batch_date}-${candidate.candidate_id.toLowerCase()}`);
  fs.mkdirSync(workdir,{recursive:true}); const providerConfig=gateway.config.providers[provider||gateway.config.defaultProvider];
  const sourceUrls=candidate.composite?(candidate.hotspots||[]).map((h)=>h.title+" ("+(h.url||"无 URL")+")").join(String.fromCharCode(10)):candidate.url;
  const brief={candidateId:candidate.candidate_id,topic:candidate.hotspot_title,sourceUrl:sourceUrls,category:candidate.category,score:candidate.f_score,
    angle:candidate.angle,thesis:candidate.thesis,confirmedFacts:editorial.confirmed_facts,authorOpinions:editorial.author_opinions,
    confirmedExperiences:editorial.confirmed_experiences,rejectedAngles:editorial.rejected_angles,forbiddenClaims:editorial.forbidden_claims,
    experienceRequired:Boolean(editorial.experience_required),composite:Boolean(candidate.composite)};
  onProgress('Step 0/1 校验锁定简报并建立作者素材');
  const briefPath=path.join(workdir,'00-article-brief.md'); const sourceBrief=path.join(workspaceRoot,'topics',`${batch.batch_date}-orchestrated`,candidate.candidate_id,'article-brief.md');
  writeFile(briefPath,fs.existsSync(sourceBrief)?fs.readFileSync(sourceBrief,'utf8'):`---\nbrief_status: LOCKED\ncandidate_id: ${candidate.candidate_id}\nexperience_required: ${brief.experienceRequired}\ndecision_source: explicit-user\nfinal_readiness: WRITE_NOW\n---\n\n# ${brief.topic}\n\n## 锁定命题\n${brief.thesis}\n`);
  onProgress('Step 2 建立事实基座、大纲与标题候选');
  const PLAN_SYSTEM = buildPlanSystem();
  const planningResult=await gateway.complete({provider,purpose:'article-planning',batchId,candidateId,jsonMode:true,maxOutputTokens:Math.min(5000,providerConfig.maxOutputTokens),
    messages:[{role:'system',content:PLAN_SYSTEM,protected:true},{role:'user',content:JSON.stringify(brief),protected:true}]});
  const plan=parseJsonResult(planningResult,store); const selectedTitle=String(plan.selectedTitle||candidate.hotspot_title).trim();
  const materials=`# 作者素材\n\n- topic:${brief.topic}\n- angle:${brief.angle}\n- article_brief_path:${briefPath}\n- brief_status:LOCKED\n- experience_required:${brief.experienceRequired}\n- experience:${brief.confirmedExperiences||'无;公共资料分析,不得使用第一人称亲测'}\n- author_opinion:${brief.authorOpinions||'未提供'}\n- avoid:${brief.forbiddenClaims||'不得虚构事实与经历'}\n- content_role:${plan.contentRole}\n- expected_action:${(plan.expectedAction||[]).join('、')}\n- practical_increment:${plan.practicalIncrement||'观察框架'}\n\n${plan.materialsMarkdown||''}`;
  const outline=`# 文章大纲\n\n${plan.outlineMarkdown||''}\n\n## 来源\n- [原始热点来源](${brief.sourceUrl||''})\n\n## 剩余风险\n${(plan.remainingRisks||[]).map((x)=>`- ${x}`).join('\n')||'- 无'}`;
  const titles=`# 标题候选\n\ncore_keywords: ${(plan.coreKeywords||[]).join('、')}\n\n${(plan.titleCandidates||[]).map((x,i)=>`${i+1}. ${x.title} - ${x.reason}`).join('\n')}\n\nSELECTED_TITLE: ${selectedTitle}\nwriter_skill: ${writerSkill(candidate)}`;
  const p01=path.join(workdir,'01-personal-materials.md'),p02=path.join(workdir,'02-outline.md'),p03=path.join(workdir,'03-titles.md'); writeFile(p01,materials);writeFile(p02,outline);writeFile(p03,titles);
  onProgress(`Step 4 使用 ${writerSkill(candidate)} 生成初稿`);
  const draftResult=await textCall(gateway,{provider,purpose:'article-drafting-pipeline',batchId,candidateId},`你是${writerSkill(candidate)}写作器。只使用事实基座中的已确认事实;事实、来源和作者判断要区分。不得虚构亲测。正文必须兑现读者任务与实用增量,不超过2000可见字符。输出Markdown文章,第一行唯一H1标题,不附说明。`,`标题:${selectedTitle}\n\n锁定简报:${JSON.stringify(brief)}\n\n大纲:\n${outline}`,Math.min(5200,providerConfig.maxOutputTokens));
  let draft=cleanMarkdown(draftResult.content); const p04=path.join(workdir,'04-draft.md');writeFile(p04,draft);
  onProgress('Step 4.5 根据初稿正文生成标题');
  const titleGenSystem = '你是中文标题生成器，根据文章正文和选题信息生成标题。原则:准确不夸大、清晰、具体含细节、吸引(信息差/影响/张力)、搜索友好含1-2核心词。不超过28汉字。返回严格JSON:{"titleCandidates":[{"title":"标题","reason":"理由","score":0-12}],"selectedTitle":"最终选中标题","coreKeywords":["核心词1"]}';
  const titleGenResult=await gateway.complete({provider,purpose:'article-title-generation',batchId,candidateId,jsonMode:true,maxOutputTokens:Math.min(5000,providerConfig.maxOutputTokens),
    messages:[{role:'system',content:titleGenSystem,protected:true},{role:'user',content:JSON.stringify({topic:candidate.hotspot_title,draft:draft}),protected:true}]});
  let titleGen; try { titleGen=parseJsonResult(titleGenResult,store); } catch { titleGen={}; }
  const finalSelectedTitle=String(titleGen.selectedTitle||selectedTitle).trim();
  const finalTitleCandidates=titleGen.titleCandidates||[]; const finalCoreKeywords=titleGen.coreKeywords||plan.coreKeywords||[];
  const updatedTitles='# 标题候选\n\ncore_keywords: '+finalCoreKeywords.join('、')+'\n\n'+finalTitleCandidates.map((x,i)=>(i+1)+'. '+x.title+' - '+x.reason+(x.score!=null?' (得分:'+x.score+'/12)':'')).join('\n')+'\n\nSELECTED_TITLE: '+finalSelectedTitle+'; // 初稿正文重生成\nwriter_skill: '+writerSkill(candidate);
  writeFile(p03,updatedTitles);
  const humanResult=await textCall(gateway,{provider,purpose:'article-humanize',batchId,candidateId},'去除模板腔和AI写作痕迹,但不得改变事实、数字、引语、来源、标题、作者观点与素材边界。只输出改写后的Markdown文章。',draft,Math.min(5000,providerConfig.maxOutputTokens));
  const human=cleanMarkdown(humanResult.content); const p05=path.join(workdir,'05-humanized.md');writeFile(p05,human);
  onProgress('Step 5 审稿与事实/逻辑/风险门禁');
  const reviewResult=await textCall(gateway,{provider,purpose:'article-review',batchId,candidateId},`你是严格审稿人。修订文章但不得新增事实。检查事实支持、事实观点边界、逻辑、标题兑现、敏感侵权风险、实用增量和克制转化。只输出修订后的Markdown;文末附HTML注释:<!-- REVIEW\nresult: pass|needs-revision\nverified_facts: 数字\ncitation_coverage: 百分比\nremaining_risks: 内容\n-->。`,human,Math.min(5200,providerConfig.maxOutputTokens));
  let reviewed=cleanMarkdown(reviewResult.content);
  if(/result:\s*needs-revision/i.test(reviewed)) {
    onProgress('Step 5 审稿未通过,执行一次定向修订复审');
    const repairResult=await textCall(gateway,{provider,purpose:'article-review-repair',batchId,candidateId},`根据文末 REVIEW 指出的问题修订正文,不得新增事实、数字、引语或来源。修订后再次审查;只输出完整 Markdown,并在文末附:<!-- REVIEW\nresult: pass|needs-revision\nverified_facts: 数字\ncitation_coverage: 百分比\nremaining_risks: 内容\n-->。`,reviewed,Math.min(5200,providerConfig.maxOutputTokens));
    reviewed=cleanMarkdown(repairResult.content);
  }
  if(!/result:\s*pass/i.test(reviewed))throw new Error('审稿门禁未通过;请查看模型调用失败信息并回到编辑器修订');
  const p06=path.join(workdir,'06-reviewed.md');writeFile(p06,reviewed);
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
  const seoContext = seoScores.length
    ? `\n\n关键词评分:${seoScores.map(k => `${k.keyword}=${k.seo_score??'N/A'}`).join(', ')}。相关词:${seoScores.flatMap(k=>k.related_keywords||[]).join('、')}`
    : '';
  onProgress('Step 6.2 搜一搜优化');
  const seoResult=await textCall(gateway,{provider,purpose:'article-seo',batchId,candidateId},'优化微信公众号搜一搜可发现性。核心词自然出现在标题或前200字;不得改变事实、引语、作者立场、实用增量,不堆砌关键词。移除审稿注释,只输出Markdown文章。\n\n核心关键词: '+coreKw.join('、')+seoContext,reviewed,Math.min(5000,providerConfig.maxOutputTokens));
  let final=cleanMarkdown(seoResult.content).replace(/<!--\s*REVIEW[\s\S]*?-->/gi,'').trim();
  if(visibleChars(final)>2000) { onProgress('终稿超过2000字,执行一次保真压缩'); const compressed=await textCall(gateway,{provider,purpose:'article-length-gate',batchId,candidateId},'将文章压缩到2000个可见字符以内。保留标题、关键事实、来源、作者立场、风险边界和实用增量;删除重复背景和同义结论。只输出Markdown。',final,Math.min(4800,providerConfig.maxOutputTokens)); final=cleanMarkdown(compressed.content); }
  if(visibleChars(final)>2000)throw new Error(`终稿仍有 ${visibleChars(final)} 个可见字符,超过2000门禁`);
  const seoFinal=final;
  onProgress('Step 7 规划必须由编辑提供的来源图与资料图');
  final=await planImagePlaceholders({gateway,store,batchId,candidateId,provider,markdown:final,maxOutputTokens:Math.min(3000,providerConfig.maxOutputTokens)});
  const p08=path.join(workdir,'08-seo-optimized.md'),p09=path.join(workdir,'09-FINAL.md');writeFile(p08,seoFinal);writeFile(p09,final);
  store.saveDocument({batchId,candidateId,kind:'final',title:finalSelectedTitle,content:final,filePath:p09,status:'finalized'});
  for(const [kind,name,file] of [['锁定简报','00-article-brief.md',briefPath],['作者素材','01-personal-materials.md',p01],['文章大纲','02-outline.md',p02],['标题候选','03-titles.md',p03],['文章初稿','04-draft.md',p04],['去AI稿','05-humanized.md',p05],['审稿稿','06-reviewed.md',p06],['SEO关键词','07-seo-keywords.md',p07],['SEO优化稿','08-seo-optimized.md',p08],['文章终稿','09-FINAL.md',p09]])artifact(store,batchId,kind,name,file);
  store.updateBatch(batchId,{stage:'typeset',status:'review'}); onProgress(`成稿完成:${visibleChars(final)} 个可见字符`);
  return {workdir,finalPath:p09,visibleChars:visibleChars(final),writerSkill:writerSkill(candidate),title:finalSelectedTitle};
}
