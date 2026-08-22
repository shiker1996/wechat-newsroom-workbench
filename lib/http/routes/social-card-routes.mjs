import { bindGenerationSnapshot, prepareSkillRun, resolveSkillToolPolicy } from '../../skills/pipeline-runtime.mjs';
import { buildSocialCardFactEnvelope, buildSocialCardStoryboardSystemPrompt, toLegacySocialCardPromptInput } from '../../domain/social-card-storyboard-contracts.mjs';
import { listSocialCardStageSkillSlots, resolveSocialCardStageSkills } from '../../skills/entry-routing.mjs';
import { requestGitHubJson } from '../../plugin-sdk/github-client.mjs';
import { pipeFile } from '../route-helpers.mjs';
import { socialThemeDefinition } from '../../themes/social-theme-compiler.mjs';
import { resolveWorkspaceTheme } from '../../themes/user-theme-service.mjs';
import { createSocialCardStoryboardThemeSnapshot, getSocialCardTemplateCapabilities, resolveSocialCardStoryboardThemeState, validateSocialCardTemplateCompatibility } from '../../rendering/social-card-template-resolver.mjs';
import { summarizeSocialTemplateRun, summarizeSocialCardPageRoles } from '../../rendering/social-card-template-metrics.mjs';
import { getSocialCardPlanRolloutProfile } from '../../rendering/social-card-plan-rollout.mjs';
import { applySocialCardRestructureOperations, buildDeterministicSocialCardRestructureOperations } from '../../rendering/social-card-repair-policy.mjs';
import { buildSocialCardReflowPreview } from '../../rendering/social-card-reflow-preview.mjs';
import { normalizeSocialCardPageTitle } from '../../rendering/social-card-title.mjs';
import { socialCardPageBudget, socialCardPageBudgetMessage } from '../../rendering/social-card-page-budget.mjs';

const SOCIAL_CARD_ENTRY_POINTS=Object.freeze({
  repository:'social-tool',
  event:'social-event',
  custom:'social-custom',
});

function socialTemplateContext(store, editorial, channelMode, contentType) {
  const themeId=editorial?.visual_style||'ice-blue';
  const themeDefinition=resolveWorkspaceTheme(store,themeId,'social')||socialThemeDefinition(themeId,{fallback:false});
  return { themeDefinition, capabilities:getSocialCardTemplateCapabilities({themeDefinition,channelMode,contentType}) };
}

function invalidateSocialCardArtifacts({writeUtf8, workspaceDir, reason}) {
  const payload = JSON.stringify({
    schemaVersion: 1,
    status: 'invalidated',
    reason,
    invalidatedAt: new Date().toISOString(),
    pages: [],
  }, null, 2);
  for (const name of ['layout-report.json', 'card-plan-reflow.json']) {
    try { writeUtf8(path.join(workspaceDir, name), payload); } catch {}
  }
}

export async function handleSocialCardRoutes(context) {
  const { request, response, pathname, searchParams, store, json, body, path, fs, root, config, mime, models, aiJobs, socialCardFiles, isInsideRoots, createZip, socialContentType, resolveEventAnalysisFor, socialCardGate, socialChannelMode, describeCardLayouts, SOCIAL_CARD_LAYOUTS, SOCIAL_CARD_COMPOSITION_MODES, normalizeCardComposition, loadSkillBundle, fetchCandidateSource, candidateEventGroups, candidateRepositoryUrl, inspectRepository, socialCardWorkdir, writeUtf8, repositoryFactMarkdown, evaluateCardGate } = context;
  const cardEditorialMatch = pathname.match(/^\/api\/candidates\/(\d+)\/card-editorial$/);
  const socialCardStageSkillsMatch=pathname.match(/^\/api\/creation-entry-points\/([^/]+)\/social-card-stage-skills$/);
  if(socialCardStageSkillsMatch&&request.method==='GET'){
    try{
      const entryPoint=decodeURIComponent(socialCardStageSkillsMatch[1]);
      return json(response,200,await listSocialCardStageSkillSlots({
        workspaceRoot:root,entryPoint,contentType:searchParams.get('contentType')||'',
      }));
    }catch(error){return json(response,400,{error:error.message});}
  }
  const cardPageLayoutMatch = pathname.match(/^\/api\/candidates\/(\d+)\/card-pages\/(\d+)\/layout$/);
  const cardPageAiMatch = pathname.match(/^\/api\/candidates\/(\d+)\/card-pages\/(\d+)\/ai$/);
  const cardPageMatch = pathname.match(/^\/api\/candidates\/(\d+)\/card-pages\/(\d+)$/);
  const socialCardsMatch = pathname.match(/^\/api\/candidates\/(\d+)\/social-cards$/);
  if(pathname==='/api/social/template-metrics'&&request.method==='GET'){
    const templatePackId=searchParams.get('templatePackId')||searchParams.get('template')||null;
    const themeId=searchParams.get('themeId')||searchParams.get('theme')||null;
    const pageRole=searchParams.get('pageRole')||searchParams.get('role')||null;
    return json(response,200,store.socialTemplateMetricsStats?.({templatePackId,themeId,pageRole})||{usageCount:0,calibration:{schemaVersion:1,sampleCount:0,dimensions:[]}});
  }
  if(socialCardsMatch&&request.method==='GET'){
    const candidate=store.getCandidate(Number(socialCardsMatch[1]));if(!candidate)return json(response,404,{error:'候选不存在'});const batch=store.getBatch(candidate.batch_id);const workspace=socialCardFiles(batch,candidate);
    const read=(name,fallback='')=>{const file=path.join(workspace.dir,name);if(!fs.existsSync(file))return fallback;return fs.readFileSync(file,'utf8');};
    const parse=(name,fallback)=>{try{return JSON.parse(read(name));}catch{return fallback;}};
    const images=workspace.files.filter((file)=>file.name.startsWith('output/')).map((file,index)=>({index:index+1,name:path.basename(file.name),url:`/api/candidates/${candidate.id}/social-cards/files/${encodeURIComponent(file.name)}`,downloadUrl:`/api/candidates/${candidate.id}/social-cards/files/${encodeURIComponent(file.name)}?download=1`,size:fs.statSync(file.path).size}));
    return json(response,200,{candidateId:candidate.id,code:candidate.candidate_id,title:candidate.hotspot_title,ready:images.length>0,images,copy:read('copy.txt'),facts:read('fact-sheet.md'),cardPlan:parse('card-plan.json',{}),layout:parse('layout-report.json',{}),delivery:parse('delivery-report.json',{}),contentPlanAdjustments:parse('social-card-content-plan-adjustments.json',null),factIndex:parse('social-card-fact-index.json',null),templateMetrics:parse('social-template-metrics.json',null),templateStats:store.socialTemplateMetricsStats?.()||null,htmlUrl:fs.existsSync(path.join(workspace.dir,'my-design.html'))?`/api/candidates/${candidate.id}/social-cards/files/my-design.html`:'',bundleUrl:images.length?`/api/candidates/${candidate.id}/social-cards/download`:''});
  }
  const socialCardFileMatch=pathname.match(/^\/api\/candidates\/(\d+)\/social-cards\/files\/(.+)$/);
  if(socialCardFileMatch&&request.method==='GET'){
    const candidate=store.getCandidate(Number(socialCardFileMatch[1]));if(!candidate)return json(response,404,{error:'候选不存在'});const batch=store.getBatch(candidate.batch_id);const workspace=socialCardFiles(batch,candidate);const relative=decodeURIComponent(socialCardFileMatch[2]);const file=path.resolve(workspace.dir,relative);
    if(!isInsideRoots(file,[workspace.dir])||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(response,404,{error:'图文产物不存在'});const headers={'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'};if(searchParams.get('download')==='1')headers['content-disposition']=`attachment; filename="${path.basename(file).replace(/"/g,'')}"`;response.writeHead(200,headers);return pipeFile(response,file);
  }
  const socialCardDownloadMatch=pathname.match(/^\/api\/candidates\/(\d+)\/social-cards\/download$/);
  if(socialCardDownloadMatch&&request.method==='GET'){
    const candidate=store.getCandidate(Number(socialCardDownloadMatch[1]));if(!candidate)return json(response,404,{error:'候选不存在'});const batch=store.getBatch(candidate.batch_id);const workspace=socialCardFiles(batch,candidate);if(!workspace.files.length)return json(response,404,{error:'暂无可下载图文产物'});const zip=createZip(workspace.files);response.writeHead(200,{'content-type':'application/zip','content-disposition':`attachment; filename="${candidate.candidate_id.toLowerCase()}-social-cards.zip"`,'content-length':zip.length});return response.end(zip);
  }
  if (cardEditorialMatch && request.method === 'GET') {
    const candidate=store.getCandidate(Number(cardEditorialMatch[1]));
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const editorial=store.getCardEditorial(candidate.id); const facts=store.getRepositoryFactSheet(candidate.id); const score=store.getSocialScore(candidate.id);
    const workspace=socialCardFiles(store.getBatch(candidate.batch_id),candidate);let layoutReport=null;let reflowState=null;let contentPlanAdjustments=null;let factIndex=null;
    try{const reportPath=path.join(workspace.dir,'layout-report.json');if(fs.existsSync(reportPath))layoutReport=JSON.parse(fs.readFileSync(reportPath,'utf8'));}catch{}
    try{const reflowPath=path.join(workspace.dir,'card-plan-reflow.json');if(fs.existsSync(reflowPath)){const raw=JSON.parse(fs.readFileSync(reflowPath,'utf8'));reflowState={schemaVersion:raw.schemaVersion||1,source:raw.source||'',changed:Boolean(raw.changed),originalPageCount:Number(raw.originalPageCount)||0,finalPageCount:Number(raw.finalPageCount)||0,operations:Array.isArray(raw.operations)?raw.operations:[],warnings:Array.isArray(raw.warnings)?raw.warnings:[],unresolved:Array.isArray(raw.unresolved)?raw.unresolved:[]};}}catch{}
    try{const adjustmentPath=path.join(workspace.dir,'social-card-content-plan-adjustments.json');if(fs.existsSync(adjustmentPath))contentPlanAdjustments=JSON.parse(fs.readFileSync(adjustmentPath,'utf8'));}catch{}
    try{const factIndexPath=path.join(workspace.dir,'social-card-fact-index.json');if(fs.existsSync(factIndexPath))factIndex=JSON.parse(fs.readFileSync(factIndexPath,'utf8'));}catch{}
    const contentType=socialContentType(candidate),eventAnalysis=contentType==='event'?resolveEventAnalysisFor(candidate):null;
    const gate=socialCardGate(candidate,contentType,facts,editorial,eventAnalysis);
    const cardPlan=JSON.parse(editorial.card_plan_json||'[]');const channelMode=socialChannelMode(candidate);
    const themeContext=socialTemplateContext(store,editorial,channelMode,contentType);
    const themeState=resolveSocialCardStoryboardThemeState({editorial,themeDefinition:themeContext.themeDefinition,channelMode,contentType});
    return json(response,200,{candidate,editorial,facts,score,contentType,channelMode,eventAnalysis,gate,themeState,layoutReport,reflowState,contentPlanAdjustments,factIndex,layoutDecisions:describeCardLayouts(cardPlan,{layoutStyle:editorial.layout_style,compositionMode:editorial.composition_mode,channelMode})});
  }
  if(cardPageLayoutMatch&&request.method==='PUT'){
    const candidate=store.getCandidate(Number(cardPageLayoutMatch[1]));if(!candidate)return json(response,404,{error:'候选不存在'});
    const pageIndex=Number(cardPageLayoutMatch[2])-1;const input=await body(request);const layoutStyle=String(input.layout_style||'auto');
    if(!SOCIAL_CARD_LAYOUTS.includes(layoutStyle))return json(response,400,{error:'不支持的逐页版式'});
    const current=store.getCardEditorial(candidate.id);let cardPlan;try{cardPlan=JSON.parse(current.card_plan_json||'[]');}catch{cardPlan=[];}
    if(!Array.isArray(cardPlan)||!cardPlan[pageIndex])return json(response,404,{error:'故事板页面不存在'});
    cardPlan[pageIndex]={...cardPlan[pageIndex],layout_style:layoutStyle};
    const editorial=store.saveCardEditorial(candidate.id,{...current,card_plan_json:JSON.stringify(cardPlan)});
    const channelMode=socialChannelMode(candidate);
    return json(response,200,{editorial,cardPlan,layoutDecisions:describeCardLayouts(cardPlan,{layoutStyle:editorial.layout_style,compositionMode:editorial.composition_mode,channelMode})});
  }
  // 单页 AI 重生成：保留其他页和当前页的页面职责，只把完整事实基座、原故事板和该页的布局问题交给模型。
  // 这一步只更新故事板；用户确认内容后再生成整组 HTML/PNG，避免单页失败误覆盖已有交付物。
  if(cardPageAiMatch&&request.method==='POST'){
    const candidate=store.getCandidate(Number(cardPageAiMatch[1]));if(!candidate)return json(response,404,{error:'候选不存在'});
    const pageIndex=Number(cardPageAiMatch[2])-1;const input=await body(request);const current=store.getCardEditorial(candidate.id);
    let cardPlan;try{cardPlan=JSON.parse(current.card_plan_json||'[]');}catch{cardPlan=[];}
    const previousPage=cardPlan[pageIndex];if(!previousPage)return json(response,404,{error:'故事板页面不存在'});
    const contentType=socialContentType(candidate),facts=store.getRepositoryFactSheet(candidate.id);
    const eventAnalysis=contentType==='event'?resolveEventAnalysisFor(candidate):null;
    if(contentType==='repository'&&!facts?.data?.sourceUrl)return json(response,409,{error:'请先完成仓库事实核验'});
    if(contentType==='event'&&!eventAnalysis?.analysis?.eventSummary)return json(response,409,{error:'该事件尚无事件卡，请先完成事件研判'});
    if(contentType==='custom'&&facts?.data?.kind!=='custom')return json(response,409,{error:'请先填写自定义事实基座'});
    const channelMode=socialChannelMode(candidate);
    const templateContext=socialTemplateContext(store,current,channelMode,contentType);
    const rolloutProfile=getSocialCardPlanRolloutProfile(templateContext.capabilities.templatePack.id);
    let layoutPage=null;
    try{
      const entryPoint=SOCIAL_CARD_ENTRY_POINTS[contentType];
      const routingContentType=contentType==='custom'?String(facts?.data?.content_type||''):contentType;
      const stageSelections=await resolveSocialCardStageSkills({workspaceRoot:root,entryPoint,contentType:routingContentType,requested:input.stageSkills&&typeof input.stageSkills==='object'?input.stageSkills:{}});
      const storyboardSelection=stageSelections.storyboard;const socialSkill=loadSkillBundle({workspaceRoot:root,skillName:storyboardSelection.selectedSkill});
      if(socialSkill.fallback)throw new Error('项目图文生成技能缺失');
      const storyboardSystem=buildSocialCardStoryboardSystemPrompt({workspaceRoot:root,skillId:storyboardSelection.selectedSkill,skillPrompt:socialSkill.prompt,contentType,channelMode,templateCapabilities:templateContext.capabilities});
      const skillRuntime=await prepareSkillRun({gateway:models,store,batchId:candidate.batch_id,candidateId:candidate.id,purpose:`social-card-page-regeneration-${contentType}`,bundles:[{...socialSkill,prompt:storyboardSystem,hash:''}],provider:input.provider,selection:{requestedSkill:storyboardSelection.requestedSkill,selectedSkill:storyboardSelection.selectedSkill,selectionSource:storyboardSelection.selectionSource,entryPoint,contentType:routingContentType,stages:stageSelections}});
      const workspace=socialCardFiles(store.getBatch(candidate.batch_id),candidate);
      try{const report=JSON.parse(fs.readFileSync(path.join(workspace.dir,'layout-report.json'),'utf8'));layoutPage=(report.pages||[])[pageIndex]||null;}catch{}
      const factEnvelope=buildSocialCardFactEnvelope({contentType,channelMode,topic:candidate.hotspot_title,facts:facts?.data,eventAnalysis:eventAnalysis?.analysis,outputMode:current.output_mode});
      const editMode=input.mode;
      if(!['expand','compress','restructure'].includes(editMode))return json(response,400,{error:'请先根据布局审计选择扩写、缩写或结构拆页'});
      const targetTemplate=templateContext.capabilities.roles[previousPage.role]||templateContext.capabilities.roles.concept;
      const targetTemplateContext={pack:templateContext.capabilities.templatePack,source:templateContext.capabilities.source,fallback:templateContext.capabilities.fallback,role:previousPage.role||'concept',templateId:targetTemplate?.template||'',supportedBlocks:targetTemplate?.supportedBlocks||[],maxBlocks:targetTemplate?.maxBlocks||3,maxItems:targetTemplate?.maxItems||9};
      if(editMode==='restructure'){
        const result=await bindGenerationSnapshot(models,skillRuntime.snapshotId).complete({provider:skillRuntime.provider,purpose:'social-card-page-restructure',batchId:candidate.batch_id,candidateId:candidate.id,jsonMode:true,maxOutputTokens:Math.min(5000,skillRuntime.providerConfig.maxOutputTokens),messages:[
          {role:'system',protected:true,content:`${storyboardSystem}\n\n当前是单页结构修复阶段。页面 P${pageIndex+1} 存在结构性布局问题。只输出 JSON，不要输出完整 card_plan、HTML、CSS 或解释。允许的唯一操作是 split_page，按完整列表项、步骤、时间线节点或对比表行拆分；封面和结尾页不可拆；禁止删除、改写、合并事实。格式：{"operations":[{"op":"split_page","page":${pageIndex+1},"groups":[{"blocks":[{"block":0,"items":[0,1]}]},{"blocks":[{"block":0,"items":[2,3]}]}]}]}。必须覆盖被拆内容块的全部条目，不能重复或遗漏。`},
          {role:'system',protected:true,content:`模板不可变上下文：${JSON.stringify(targetTemplateContext)}。`},
          {role:'user',protected:true,content:JSON.stringify({facts:toLegacySocialCardPromptInput(factEnvelope),full_card_plan:cardPlan,target_page_number:pageIndex+1,target_page:previousPage,target_template:targetTemplateContext,layout_report_for_target_page:layoutPage})},
        ]});
        let parsed;
        try{parsed=JSON.parse(String(result.content||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch(error){throw new Error(`结构修复 JSON 无法解析：${error.message}`);}
        let operations=Array.isArray(parsed)?parsed:parsed?.operations;
        const beforePlan=structuredClone(cardPlan);
       const pageBudget=socialCardPageBudget(contentType);
       let applied=applySocialCardRestructureOperations(cardPlan,operations,{maxPages:pageBudget.absolute});
       if(!applied.valid&&(!Array.isArray(operations)||!operations.length)){
          operations=buildDeterministicSocialCardRestructureOperations(cardPlan,[{page:pageIndex+1,issues:previousPage?.issues||[]}],{maxPages:pageBudget.absolute});
          applied=applySocialCardRestructureOperations(cardPlan,operations,{maxPages:pageBudget.absolute});
       }
       if(!applied.valid&&(!Array.isArray(operations)||!operations.length)){
          const reason=cardPlan.length>=pageBudget.absolute
            ? `当前故事板已有 ${cardPlan.length} 页，已达到绝对安全上限 ${pageBudget.absolute} 页`
            : '目标页没有可完整拆分的列表、步骤、时间线、场景、统计或对比条目';
          throw new Error(`结构修复未返回操作，${reason}。请改用 AI 缩写本页，或先调整故事板内容计划`);
        }
        if(!applied.valid)throw new Error(`结构修复未通过程序校验：${applied.issues.join('；')}`);
        if(!applied.changed)throw new Error('结构修复未改变故事板，已停止无效重试');
        const templateCompatibility=validateSocialCardTemplateCompatibility(applied.pages,{themeDefinition:templateContext.themeDefinition,channelMode,contentType});
        const editorial=store.saveCardEditorial(candidate.id,{...current,card_plan_json:JSON.stringify(applied.pages),status:'AI_READY'});
        const pageMetric=summarizeSocialTemplateRun({requestedTemplate:{...templateContext.capabilities.templatePack,source:templateContext.capabilities.source},renderedTemplate:{...templateCompatibility.templatePack,source:templateCompatibility.source},channelMode,contentType,themeId:templateContext.themeDefinition.id,report:layoutPage?{valid:false,pages:[layoutPage]}:null,fallback:templateContext.capabilities.fallback,operation:'page-regeneration',success:true,editMode,targetPage:pageIndex+1,pageRoleStats:summarizeSocialCardPageRoles(applied.pages,{valid:false,pages:applied.pages.map((item,index)=>index===pageIndex?layoutPage||{}:{valid:true,issues:[]})}),pagesAdded:applied.pages.length-beforePlan.length,structuralReflowAttempted:true,structuralReflowSuccess:false,rolloutProfile});
        store.recordSocialTemplateMetric?.({...pageMetric,batchId:candidate.batch_id,candidateId:candidate.id});
        const preview=buildSocialCardReflowPreview({beforePlan,afterPlan:applied.pages,operations});
        return json(response,200,{editorial,cardPlan:applied.pages,page:applied.pages[pageIndex]||applied.pages.find((item)=>item.continuation_of===pageIndex+1),template:{...templateCompatibility,target:templateCompatibility.pages?.[pageIndex]||null,context:targetTemplateContext},templateMetrics:pageMetric,gate:socialCardGate(candidate,contentType,facts,editorial,eventAnalysis),layoutDecisions:describeCardLayouts(applied.pages,{layoutStyle:editorial.layout_style,compositionMode:editorial.composition_mode,channelMode}),reasoning:typeof result.reasoning==='string'?result.reasoning:'',restructure:{operations,preview},renderState:{status:'storyboard-updated',pendingRender:true,htmlUpdated:false,pngUpdated:false}});
      }
      const modeInstruction=editMode==='expand'
        ? '当前模式：AI 扩写本页。仅在原始素材支持的范围内补充具体事实、机制、步骤、边界或合适的结构化内容，提升信息密度；不要用空泛形容词填充。'
        : '当前模式：AI 缩写本页。保留页面结论、关键事实和必要边界，合并重复表达，缩短标题、正文和列表，优先移除次要内容，解决页面过满或溢出。';
      const result=await bindGenerationSnapshot(models,skillRuntime.snapshotId).complete({provider:skillRuntime.provider,purpose:'social-card-page-regeneration',batchId:candidate.batch_id,candidateId:candidate.id,jsonMode:true,maxOutputTokens:Math.min(3000,skillRuntime.providerConfig.maxOutputTokens),messages:[
        {role:'system',protected:true,content:`${storyboardSystem}\n\n## 当前运行阶段：单页故事板 AI 改写\n只重生成指定的一个 page。${modeInstruction} 必须充分使用完整事实基座与原始 README/素材，不得编造。其他页面不可改动；当前页的 kind、role、goal、evidence 和 layout_style 必须保持不变。根据布局报告关注 underfilled、overfilled、overflow、clipped 等问题，可重写标题和内容块，但内容块最多 3 个、列表合计最多 9 项。只输出 JSON：{"page":{...}}。`},
        {role:'system',protected:true,content:`模板不可变上下文：${JSON.stringify(targetTemplateContext)}。保持当前页 role、layout_style、事实边界和尺寸不变；只使用模板支持的内容块，最多 ${Math.min(3,targetTemplateContext.maxBlocks)} 个块、${Math.min(9,targetTemplateContext.maxItems)} 个条目。`},
        {role:'user',protected:true,content:JSON.stringify({facts:toLegacySocialCardPromptInput(factEnvelope),full_card_plan:cardPlan,target_page_number:pageIndex+1,target_page:previousPage,target_template:targetTemplateContext,layout_report_for_target_page:layoutPage})},
      ]});
      const parsed=JSON.parse(String(result.content||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));const generated=parsed?.page;
      if(!generated||typeof generated!=='object'||!Array.isArray(generated.content_blocks)||!generated.content_blocks.length)throw new Error('单页重生成未返回有效内容块');
      const allowedBlockTypes=new Set(['text','list','code','note','stats','compare','steps','timeline','scenes','highlight']);
      if(generated.content_blocks.length>Math.min(3,targetTemplateContext.maxBlocks)||generated.content_blocks.some((block)=>!allowedBlockTypes.has(block?.type)))throw new Error('单页重生成返回了不支持的内容块结构');
      const normalized=normalizeCardComposition({...previousPage,...generated,kind:previousPage.kind,role:previousPage.role,goal:previousPage.goal,evidence:previousPage.evidence,layout_style:previousPage.layout_style},{pageIndex,seed:`${candidate.batch_id}|${candidate.id}`});
      cardPlan[pageIndex]={...previousPage,...generated,kind:previousPage.kind,role:normalized.role,composition:normalized.composition,goal:previousPage.goal,evidence:previousPage.evidence,layout_style:previousPage.layout_style,layout_intent:previousPage.layout_intent,title:normalizeSocialCardPageTitle(String(generated.title||previousPage.title).trim(),{kind:previousPage.kind}),content_blocks:generated.content_blocks};
      const templateCompatibility=validateSocialCardTemplateCompatibility(cardPlan,{themeDefinition:templateContext.themeDefinition,channelMode,contentType});
      const editorial=store.saveCardEditorial(candidate.id,{...current,card_plan_json:JSON.stringify(cardPlan),status:'AI_READY'});
      const pageMetric=summarizeSocialTemplateRun({requestedTemplate:{...templateContext.capabilities.templatePack,source:templateContext.capabilities.source},renderedTemplate:{...templateCompatibility.templatePack,source:templateCompatibility.source},channelMode,contentType,themeId:templateContext.themeDefinition.id,report:layoutPage?{valid:!Array.isArray(layoutPage.issues)||!layoutPage.issues.length,pages:[layoutPage]}:null,fallback:templateContext.capabilities.fallback,operation:'page-regeneration',success:true,editMode,targetPage:pageIndex+1,pageRoleStats:summarizeSocialCardPageRoles(cardPlan,{valid:true,pages:cardPlan.map((item,index)=>index===pageIndex?layoutPage||{valid:true,issues:[]}:{valid:true,issues:[]})}),textRepairCount:1,rolloutProfile});
      store.recordSocialTemplateMetric?.({...pageMetric,batchId:candidate.batch_id,candidateId:candidate.id});
      return json(response,200,{editorial,cardPlan,page:cardPlan[pageIndex],template:{...templateCompatibility,target:templateCompatibility.pages?.[pageIndex]||null,context:targetTemplateContext},templateMetrics:pageMetric,gate:socialCardGate(candidate,contentType,facts,editorial,eventAnalysis),layoutDecisions:describeCardLayouts(cardPlan,{layoutStyle:editorial.layout_style,compositionMode:editorial.composition_mode,channelMode}),reasoning:typeof result.reasoning==='string'?result.reasoning:'',renderState:{status:'storyboard-updated',pendingRender:true,htmlUpdated:false,pngUpdated:false}});
    }catch(error){
      const failedMetric=summarizeSocialTemplateRun({requestedTemplate:{...templateContext.capabilities.templatePack,source:templateContext.capabilities.source},renderedTemplate:{...templateContext.capabilities.templatePack,source:templateContext.capabilities.source},channelMode,contentType,themeId:templateContext.themeDefinition.id,report:layoutPage?{valid:!Array.isArray(layoutPage.issues)||!layoutPage.issues.length,pages:[layoutPage]}:null,fallback:templateContext.capabilities.fallback,operation:'page-regeneration',success:false,editMode:input.mode,targetPage:pageIndex+1,hardGateFailure:true,rolloutProfile});
      store.recordSocialTemplateMetric?.({...failedMetric,batchId:candidate.batch_id,candidateId:candidate.id});
      return json(response,502,{error:`单页故事板重生成失败：${error.message}`});
    }
  }
  if(cardPageMatch&&request.method==='PUT'){
    const candidate=store.getCandidate(Number(cardPageMatch[1]));if(!candidate)return json(response,404,{error:'候选不存在'});
    const pageIndex=Number(cardPageMatch[2])-1;const input=await body(request);
    const current=store.getCardEditorial(candidate.id);let cardPlan;try{cardPlan=JSON.parse(current.card_plan_json||'[]');}catch{cardPlan=[];}
    if(!Array.isArray(cardPlan)||!cardPlan[pageIndex])return json(response,404,{error:'故事板页面不存在'});
    const title=String(input.title||'').trim();
    if(!title)return json(response,400,{error:'页面标题不能为空'});
    const blocks=Array.isArray(input.content_blocks)?input.content_blocks.slice(0,4):null;
    if(!blocks?.length)return json(response,400,{error:'每页至少保留一个内容块'});
    const allowedBlockTypes=['text','list','code','note','stats','compare','steps','timeline','scenes','highlight'];
    if(blocks.some((block)=>!allowedBlockTypes.includes(block?.type)))return json(response,400,{error:'故事板包含不支持的内容块类型'});
    cardPlan[pageIndex]={
      ...cardPlan[pageIndex],
      title,
      goal:String(input.goal||'').trim(),
      content_blocks:blocks.map((block)=>({
        ...block,
        title:String(block.title||'').trim(),
        content:String(block.content||'').trim(),
      })),
    };
    const editorial=store.saveCardEditorial(candidate.id,{...current,card_plan_json:JSON.stringify(cardPlan),status:'AI_READY'});
    const facts=store.getRepositoryFactSheet(candidate.id),contentType=socialContentType(candidate);
    const eventAnalysis=contentType==='event'?resolveEventAnalysisFor(candidate):null;
    const channelMode=socialChannelMode(candidate);
    return json(response,200,{editorial,cardPlan,gate:socialCardGate(candidate,contentType,facts,editorial,eventAnalysis),layoutDecisions:describeCardLayouts(cardPlan,{layoutStyle:editorial.layout_style,compositionMode:editorial.composition_mode,channelMode})});
  }
  if (cardEditorialMatch && request.method === 'PUT') {
    const candidate=store.getCandidate(Number(cardEditorialMatch[1]));
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const input=await body(request);
    if(input.layout_style&&!SOCIAL_CARD_LAYOUTS.includes(input.layout_style))return json(response,400,{error:'不支持的图文版式'});
    if(input.composition_mode&&!SOCIAL_CARD_COMPOSITION_MODES.includes(input.composition_mode))return json(response,400,{error:'不支持的构图模式'});
    let editorial=store.saveCardEditorial(candidate.id,input); const facts=store.getRepositoryFactSheet(candidate.id);
    const contentType=socialContentType(candidate),eventAnalysis=contentType==='event'?resolveEventAnalysisFor(candidate):null;
    let cardPlan=[];try{cardPlan=JSON.parse(editorial.card_plan_json||'[]');}catch{}
    const channelMode=socialChannelMode(candidate);
    const themeContext=socialTemplateContext(store,editorial,channelMode,contentType);
    let themeState=resolveSocialCardStoryboardThemeState({editorial,themeDefinition:themeContext.themeDefinition,channelMode,contentType});
    // 同一模板家族换主题只改变 Token；没有模板快照的历史故事板必须先重新生成故事板。
    if (input.visual_style && themeState.status === 'render-only') {
      editorial=store.saveCardEditorial(candidate.id,{...editorial,storyboard_theme_snapshot_json:JSON.stringify(createSocialCardStoryboardThemeSnapshot({themeDefinition:themeContext.themeDefinition,channelMode,contentType}))});
      themeState=resolveSocialCardStoryboardThemeState({editorial,themeDefinition:themeContext.themeDefinition,channelMode,contentType});
      invalidateSocialCardArtifacts({writeUtf8,workspaceDir:socialCardFiles(store.getBatch(candidate.batch_id),candidate).dir,reason:'theme-changed'});
    }
    return json(response,200,{editorial,contentType,gate:socialCardGate(candidate,contentType,facts,editorial,eventAnalysis),themeState,cardPlan,layoutDecisions:describeCardLayouts(cardPlan,{layoutStyle:editorial.layout_style,compositionMode:editorial.composition_mode,channelMode})});
  }
  // 渠道切换：只换 output_mode 的渠道前缀（wechat-* ↔ xiaohongshu-*），类型部分不动，轨道与卡片决策同步
  const cardChannelMatch = pathname.match(/^\/api\/candidates\/(\d+)\/card-channel$/);
  if (cardChannelMatch && request.method === 'POST') {
    const candidate=store.getCandidate(Number(cardChannelMatch[1]));
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const input=await body(request);
    const channel=String(input.channel||'').trim();
    if(!['wechat','xiaohongshu'].includes(channel))return json(response,400,{error:'channel 必须是 wechat 或 xiaohongshu'});
    const track=candidate.tracks?.find((item)=>item.track==='social_cards');
    const currentMode=track?.output_mode||store.getCardEditorial(candidate.id).output_mode||'wechat-tool-cards';
    const typeSuffix=String(currentMode).replace(/^(wechat|xiaohongshu)-/,'');
    const nextMode=`${channel}-${typeSuffix}`;
    if(nextMode!==currentMode){
      store.updateCandidateTrack(candidate.id,'social_cards',{output_mode:nextMode});
      store.saveCardEditorial(candidate.id,{...store.getCardEditorial(candidate.id),output_mode:nextMode});
      invalidateSocialCardArtifacts({writeUtf8,workspaceDir:socialCardFiles(store.getBatch(candidate.batch_id),candidate).dir,reason:'channel-changed'});
    }
    const updated=store.getCandidate(candidate.id);
    const editorial=store.getCardEditorial(candidate.id);const cardPlan=JSON.parse(editorial.card_plan_json||'[]');
    const contentType=socialContentType(candidate);const themeContext=socialTemplateContext(store,editorial,channel,contentType);const themeState=resolveSocialCardStoryboardThemeState({editorial,themeDefinition:themeContext.themeDefinition,channelMode:channel,contentType});
    return json(response,200,{outputMode:nextMode,channelMode:channel,hasPlan:Boolean(cardPlan.length),candidate:updated,themeState,layoutDecisions:describeCardLayouts(cardPlan,{layoutStyle:editorial.layout_style,compositionMode:editorial.composition_mode,channelMode:channel})});
  }
  const cardEditorialAiMatch = pathname.match(/^\/api\/candidates\/(\d+)\/ai\/card-editorial$/);
  if (cardEditorialAiMatch && request.method === 'POST') {
    const candidate=store.getCandidate(Number(cardEditorialAiMatch[1])); if(!candidate)return json(response,404,{error:'候选不存在'});
    const contentType=socialContentType(candidate),facts=store.getRepositoryFactSheet(candidate.id);
    let eventAnalysis=contentType==='event'?resolveEventAnalysisFor(candidate):null;
    if(contentType==='repository'&&!facts?.data?.sourceUrl)return json(response,409,{error:'请先完成仓库事实核验'});
    if(contentType==='event'){
      if(!eventAnalysis?.analysis?.eventSummary)return json(response,409,{error:'该事件尚无事件卡，请先在热点全景运行事件研判'});
      // 日常批次事件候选可能尚未抓取来源，生成故事板前自动补抓
      if(!(eventAnalysis.analysis.sources||[]).some((item)=>item.status==='ok')){
        const hotspots=candidateEventGroups(candidate).flatMap((group)=>group.hotspots);
        if(hotspots.length){
          try{
            const toolPolicy=await resolveSkillToolPolicy({workspaceRoot:root,skillId:'xiaohongshu-article-generator'});
            await fetchCandidateSource({
              store,sourceFetch:config.sourceFetch,candidateId:candidate.id,root,force:false,hotspots,
              toolContext:{store,batchId:candidate.batch_id,candidateId:candidate.id,
                skillId:'xiaohongshu-article-generator',allowedCapabilities:toolPolicy.allowedCapabilities},
            });
          }catch{}
        }
        eventAnalysis=resolveEventAnalysisFor(candidate);
      }
    }
    if(contentType==='custom'&&facts?.data?.kind!=='custom')return json(response,409,{error:'请先填写自定义事实基座'});
    const input=await body(request); const current=store.getCardEditorial(candidate.id);
    try {
      const entryPoint=SOCIAL_CARD_ENTRY_POINTS[contentType];
      const routingContentType=contentType==='custom'?String(facts?.data?.content_type||''):contentType;
      const requestedStages=input.stageSkills&&typeof input.stageSkills==='object'?input.stageSkills:{};
      const stageSelections=await resolveSocialCardStageSkills({
        workspaceRoot:root,entryPoint,contentType:routingContentType,requested:requestedStages,
      });
      const storyboardSelection=stageSelections.storyboard;
      const socialSkill=loadSkillBundle({workspaceRoot:root,skillName:storyboardSelection.selectedSkill});
      if(socialSkill.fallback)throw new Error('项目图文生成技能缺失');
      const channelMode=socialChannelMode(candidate);
      const templateContext=socialTemplateContext(store,current,channelMode,contentType);
      const storyboardSystem=buildSocialCardStoryboardSystemPrompt({
        workspaceRoot:root,skillId:storyboardSelection.selectedSkill,
        skillPrompt:socialSkill.prompt,contentType,channelMode,templateCapabilities:templateContext.capabilities,
      });
      const storyboardBundle={...socialSkill,prompt:storyboardSystem,hash:''};
      const skillRuntime=await prepareSkillRun({
        gateway:models,store,batchId:candidate.batch_id,candidateId:candidate.id,
        purpose:`social-card-editorial-${contentType}`,bundles:[storyboardBundle],provider:input.provider,
        selection:{
          requestedSkill:storyboardSelection.requestedSkill,
          selectedSkill:storyboardSelection.selectedSkill,
          selectionSource:storyboardSelection.selectionSource,
          entryPoint,contentType:routingContentType,stages:stageSelections,
        },
      });
      const selectedProvider=skillRuntime.provider,providerConfig=skillRuntime.providerConfig;
      const factEnvelope=buildSocialCardFactEnvelope({
        contentType,channelMode,topic:candidate.hotspot_title,facts:facts?.data,
        eventAnalysis:eventAnalysis?.analysis,outputMode:current.output_mode,
      });
      const result=await bindGenerationSnapshot(models,skillRuntime.snapshotId).complete({provider:selectedProvider,purpose:'social-card-editorial',batchId:candidate.batch_id,candidateId:candidate.id,jsonMode:true,maxOutputTokens:Math.min(6000,providerConfig.maxOutputTokens),messages:[
        {role:'system',protected:true,content:storyboardSystem},
        {role:'user',protected:true,content:JSON.stringify(toLegacySocialCardPromptInput(factEnvelope))}
      ]});
      const parsed=JSON.parse(result.content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
       const pageBudget=socialCardPageBudget(contentType);
       const rawCardPlan=Array.isArray(parsed.card_plan)?parsed.card_plan:[];
       const pageBudgetError=socialCardPageBudgetMessage(rawCardPlan.length,contentType);
       if(pageBudgetError)return json(response,502,{error:`AI 故事板生成失败：${pageBudgetError}`});
       const cardPlan = rawCardPlan.map((page,pageIndex) => {
        const instructionPatterns = [/^让读者(?:一眼)?知道/,/^让读者/,/^读者(?:能|会|可以|理解|了解|知道)/,/^本页(?:旨在|希望|要|应该|目的(?:是|为))?/,/^这一页(?:旨在|希望|要|应该|目的(?:是|为))?/,/^本卡(?:旨在|希望|要|应该|目的(?:是|为))?/,/^本章节(?:旨在|希望|要|应该|目的(?:是|为))?/,/^请/];
        const clean = (text) => { if(typeof text!=='string')return text; let s=text.trim(); for(const re of instructionPatterns)s=s.replace(re,'').trim(); return s.replace(/^[，。；、:：\s]+/,'').trim(); };
        const smart=normalizeCardComposition(page,{pageIndex,seed:`${candidate.batch_id}|${candidate.id}`});
        return { ...page, role:smart.role, composition:smart.composition, layout_style:SOCIAL_CARD_LAYOUTS.includes(page.layout_style)?page.layout_style:'auto', title:normalizeSocialCardPageTitle(clean(page.title),{kind:page.kind}), goal:clean(page.goal), evidence:(Array.isArray(page.evidence)?page.evidence:[]).map(clean), content_blocks:(Array.isArray(page.content_blocks)?page.content_blocks:[]).map((b)=>({...b,title:clean(b.title),content:clean(b.content)})) };
      });
      const templateCompatibility=validateSocialCardTemplateCompatibility(cardPlan,{themeDefinition:templateContext.themeDefinition,channelMode,contentType});
      const asText=(value,fallback='')=>typeof value==='string'?value.trim():value==null?fallback:Array.isArray(value)?value.map((item)=>typeof item==='string'?item:JSON.stringify(item)).join('\n'):JSON.stringify(value);
      const editorial=store.saveCardEditorial(candidate.id,{...current,
        target_reader:asText(parsed.target_reader,current.target_reader),pain_point:asText(parsed.pain_point,current.pain_point),
        tool_positioning:asText(parsed.tool_positioning,current.tool_positioning),must_highlight:asText(parsed.must_highlight,current.must_highlight),
        must_disclose:asText(parsed.must_disclose,current.must_disclose),getting_started:asText(parsed.getting_started,current.getting_started),
        forbidden_claims:asText(parsed.forbidden_claims,current.forbidden_claims),
         recommended_pages:Math.max(4,Math.min(pageBudget.absolute,Number(parsed.recommended_pages)||cardPlan.length||pageBudget.recommended)),card_plan_json:JSON.stringify(cardPlan),storyboard_theme_snapshot_json:JSON.stringify(createSocialCardStoryboardThemeSnapshot({themeDefinition:templateContext.themeDefinition,channelMode,contentType})),status:'AI_READY'});
      // 故事板重生成后，上一版 HTML/PNG 的内容计划调整记录不再属于当前故事板。
      // 保留文件但清空 rounds，避免编辑器把旧计划误显示为新故事板的调整结果。
      try {
        const workspace=socialCardFiles(store.getBatch(candidate.batch_id),candidate);
        writeUtf8(path.join(workspace.dir,'social-card-content-plan-adjustments.json'),JSON.stringify({schemaVersion:1,status:'invalidated',reason:'storyboard-regenerated',invalidatedAt:new Date().toISOString(),rounds:[]},null,2));
        invalidateSocialCardArtifacts({writeUtf8,workspaceDir:workspace.dir,reason:'storyboard-regenerated'});
      } catch {}
      const gate=socialCardGate(candidate,contentType,facts,editorial,eventAnalysis);
      const themeState=resolveSocialCardStoryboardThemeState({editorial,themeDefinition:templateContext.themeDefinition,channelMode,contentType});
       return json(response,200,{editorial,gate,themeState,cardPlan,contentType,eventAnalysis,pageBudget,layoutDecisions:describeCardLayouts(cardPlan,{layoutStyle:editorial.layout_style,compositionMode:editorial.composition_mode,channelMode}),
        template:templateCompatibility,
        reasoning:typeof result.reasoning==='string'&&result.reasoning?result.reasoning:''});
    } catch(error) { return json(response,502,{error:`AI 图文决策失败：${error.message}`}); }
  }
  const repositoryInspectMatch = pathname.match(/^\/api\/candidates\/(\d+)\/repository\/inspect$/);
  if (repositoryInspectMatch && request.method === 'POST') {
    const candidate=store.getCandidate(Number(repositoryInspectMatch[1]));
    if(!candidate)return json(response,404,{error:'候选不存在'});
    if(socialContentType(candidate)==='event')return json(response,409,{error:'事件型图文使用突发事实基座，不执行仓库核验'});
    if(socialContentType(candidate)==='custom')return json(response,409,{error:'自定义图文使用自定义事实基座，不执行仓库核验'});
    const sourceUrl=candidateRepositoryUrl(candidate); if(!sourceUrl)return json(response,409,{error:'该候选没有可核验的 GitHub 仓库地址'});
    try {
      const toolPolicy=await resolveSkillToolPolicy({workspaceRoot:root,skillId:'xiaohongshu-article-generator'});
      const fact=await inspectRepository(sourceUrl,{requestGitHubJson,workspaceRoot:root,cacheDir:path.join(root,'data','github-cache'),toolContext:{store,batchId:candidate.batch_id,candidateId:candidate.id,skillId:'xiaohongshu-article-generator',allowedCapabilities:toolPolicy.allowedCapabilities}}); const saved=store.saveRepositoryFactSheet(candidate.id,{repository:fact.repository,sourceUrl:fact.sourceUrl,status:'ok',data:fact,checkedAt:fact.stars.checkedAt});
      const score=store.getSocialScore(candidate.id);
      const batch=store.getBatch(candidate.batch_id); const dir=socialCardWorkdir(batch,candidate); const jsonPath=path.join(dir,'repository-fact-sheet.json'); const mdPath=path.join(dir,'fact-sheet.md');
      const jsonFile=writeUtf8(jsonPath,JSON.stringify(fact,null,2)); const mdFile=writeUtf8(mdPath,repositoryFactMarkdown(fact));
      store.upsertArtifact({batchId:batch.id,kind:'仓库事实基座',name:path.basename(jsonPath),path:jsonPath,...jsonFile});
      store.upsertArtifact({batchId:batch.id,kind:'图文事实清单',name:path.basename(mdPath),path:mdPath,...mdFile});
      const editorial=store.getCardEditorial(candidate.id); return json(response,200,{facts:saved,score,gate:evaluateCardGate(candidate,saved,editorial)});
    } catch(error) {
      store.saveRepositoryFactSheet(candidate.id,{sourceUrl,status:'failed',data:{},error:error.message,checkedAt:new Date().toISOString()});
      return json(response,502,{error:`仓库核验失败：${error.message}`});
    }
  }
  const cardLockMatch = pathname.match(/^\/api\/candidates\/(\d+)\/card-lock$/);
  if (cardLockMatch && request.method === 'POST') {
    const candidate=store.getCandidate(Number(cardLockMatch[1])); if(!candidate)return json(response,404,{error:'候选不存在'});
    const editorial=store.getCardEditorial(candidate.id),facts=store.getRepositoryFactSheet(candidate.id),contentType=socialContentType(candidate);
    const gate=socialCardGate(candidate,contentType,facts,editorial,contentType==='event'?resolveEventAnalysisFor(candidate):null);
    if(!gate.ready)return json(response,409,{error:`CARD GATE 未通过：${gate.issues.join('；')}`,gate});
    store.saveCardEditorial(candidate.id,{...editorial,status:'LOCKED'});
    store.updateCandidateTrack(candidate.id,'social_cards',{status:'locked',locked_at:new Date().toISOString()});
    return json(response,200,{ok:true,gate,track:store.listCandidateTracks(candidate.id).find((item)=>item.track==='social_cards')});
  }
  const socialGenerateMatch = pathname.match(/^\/api\/candidates\/(\d+)\/ai\/social-card$/);
  if (socialGenerateMatch && request.method === 'POST') {
    const candidate=store.getCandidate(Number(socialGenerateMatch[1]));
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const editorial=store.getCardEditorial(candidate.id),contentType=socialContentType(candidate),channelMode=socialChannelMode(candidate),themeContext=socialTemplateContext(store,editorial,channelMode,contentType);
    const themeState=resolveSocialCardStoryboardThemeState({editorial,themeDefinition:themeContext.themeDefinition,channelMode,contentType});
    if(themeState.status==='needs-storyboard')return json(response,409,{error:themeState.reason||'当前主题的模板能力与故事板不一致，请先重新生成故事板',themeState});
    const input=await body(request);
    const purpose=`social-cards-${socialContentType(candidate)}`;
    const previousSnapshot=input.useLatestSkill===true?null:store.findLatestGenerationSnapshot({
      batchId:candidate.batch_id,candidateId:candidate.id,purposes:[purpose],
    });
    return json(response,202,aiJobs.start({batchId:candidate.batch_id,candidateId:candidate.id,
      provider:previousSnapshot?null:input.provider,type:'social-card',snapshotId:previousSnapshot?.id||null}));
  }
  return false;
}
