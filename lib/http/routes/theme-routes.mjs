import crypto from 'node:crypto';
import { getBuiltinThemeRegistry } from '../../themes/theme-registry.mjs';
import { cloneTheme, exportWorkspaceTheme, importThemeDraft, publishTheme, restoreThemeVersion, saveThemeDraft, userThemeFromRow } from '../../themes/user-theme-service.mjs';
import { compileThemePreview } from '../../themes/theme-preview.mjs';
import { themeRecipeEditorCatalog } from '../../themes/recipe-catalog.mjs';
import { auditThemeForPublish } from '../../themes/theme-publish-gate.mjs';
import { generateAiThemeCandidate } from '../../themes/ai-theme-generator.mjs';
import { AiThemeCandidateStore, AiThemeRateLimiter } from '../../themes/ai-theme-candidate-store.mjs';
import { AI_THEME_ERROR_CODES } from '../../themes/ai-theme-contract.mjs';
import { articleComponentEditorCatalog, socialComponentEditorCatalog } from '../../themes/component-catalog.mjs';
import { socialDensityHighFields } from '../../themes/theme-numeric-limits.mjs';
import { getSocialCardTemplatePack, socialCardTemplateEditorCatalog } from '../../rendering/social-card-template-registry.mjs';
import { resolveSocialCardTemplateContext } from '../../rendering/social-card-template-resolver.mjs';
import { generateSocialTemplateProposal, SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES } from '../../themes/social-template-proposal.mjs';
import { SocialTemplateProposalStore, SocialTemplateProposalRateLimiter } from '../../themes/social-template-proposal-store.mjs';
import { compileSocialTemplateProposal, compileSocialTemplateProposalPack, compileSocialTemplateProposalCss } from '../../themes/social-template-proposal-compiler.mjs';

const TARGETS=new Set(['article','social','cover']);
const SCENE_TAGS=['深度观点','技术教程','快讯','数据对比','事件图文'];
const DENSITY_LABEL={dense:'紧凑',standard:'适中',airy:'宽松'};

function themeDensity(theme,target){
  if(target==='article')return DENSITY_LABEL[theme.article?.recipes?.rhythm]||'适中';
  const high=socialDensityHighFields(theme).length;
  return high>=3?'紧凑':high<=1?'宽松':'适中';
}

function publicTheme(theme,target){const colors=theme.tokens?.colors||{},templateContext=target==='social'?resolveSocialCardTemplateContext({themeDefinition:theme}):null,template=templateContext?{id:templateContext.pack.id,version:templateContext.pack.version,label:templateContext.pack.label,renderer:templateContext.pack.renderer,source:templateContext.source,fallbackTemplate:templateContext.pack.fallbackTemplate,compatibility:templateContext.pack.id==='standard-v1'||templateContext.fallback,roleTemplates:{...templateContext.pack.roleTemplates},matching:theme.social?.templateMatch||null}:null;return {id:theme.id,label:theme.label,description:theme.description,version:theme.version,source:theme.source,target,tags:theme.tags||[],scenes:(theme.tags||[]).filter((tag)=>SCENE_TAGS.includes(tag)),density:themeDensity(theme,target),hash:theme.hash,template,preview:{background:colors.page||colors.background||colors.surface, surface:colors.surface, ink:colors.text, accent:colors.accent}};}
const ORDER={article:['magazine-warm','gossip-card','tech-wire','research-report','career-essay','news-digest'],social:['neon','tokyo-night','brutalist','solarized','retro-terminal','paper-craft','charcoal','peach','orange','ice-blue','mocha','lavender','crimson','bone-white'],cover:['cover-navy-gold','cover-split-navy','cover-editorial-red','cover-forest-cream','cover-graphite-neon','cover-crimson-paper','cover-royal-data','cover-amber-cocoa','cover-violet-night','cover-jade-paper']};
const DEFAULTS={article:'magazine-warm',social:'ice-blue',cover:'cover-navy-gold'};
const aiThemeCandidates=new AiThemeCandidateStore(),aiThemeRateLimiter=new AiThemeRateLimiter();
const socialTemplateProposals=new SocialTemplateProposalStore(),socialTemplateProposalRateLimiter=new SocialTemplateProposalRateLimiter();
function recordSocialTemplateProposalMetric(store, input) {
  try { store?.recordSocialTemplateProposalMetric?.(input); } catch { /* metrics must never break a user-facing route */ }
}

export function themeCatalog(target,registry=getBuiltinThemeRegistry(),store=null){
  if(!TARGETS.has(target))throw new Error(`未知主题目标：${target}`);
  const rank=new Map(ORDER[target].map((id,index)=>[id,index]));
  const builtin=registry.list({target}).map((theme)=>publicTheme(theme,target));const users=(store?.listUserThemes?.({target})||[]).filter((row)=>row.status==='published'&&row.active_version_id).map((row)=>publicTheme(userThemeFromRow(row),target));
  const items=[...builtin,...users].sort((a,b)=>(a.source==='builtin'?0:1)-(b.source==='builtin'?0:1)||(rank.get(a.id)??999)-(rank.get(b.id)??999)||a.label.localeCompare(b.label,'zh-CN'));
  return {schemaVersion:1,target,defaultTheme:DEFAULTS[target],items};
}

function detail(row,target){const published=userThemeFromRow(row),draft=userThemeFromRow(row,{draft:true}),compatibility=auditThemeForPublish(draft,{target}),legacySocial=target==='social'&&!draft?.social?.templatePack?.id,components=target==='social'?socialComponentEditorCatalog(draft.social?.recipes):target==='article'?articleComponentEditorCatalog(draft.article?.recipes):null,template=target==='social'?publicTheme(draft,target).template:null;return {schemaVersion:1,id:row.id,label:row.label,target,source:'user',status:row.status,activeVersion:row.active_version||null,definition:published,draft,compatibility,legacy:legacySocial,editorMode:legacySocial||!compatibility.compatible?'read-only':'full',template,editorCatalog:{recipes:target==='cover'?{}:themeRecipeEditorCatalog(target),components,templatePacks:target==='social'?socialCardTemplateEditorCatalog():[]}};}
export async function handleThemeRoutes({request,response,pathname,searchParams,json,store,body,models,candidateStore=aiThemeCandidates,rateLimiter=aiThemeRateLimiter}){
  if(request.method==='GET'&&pathname==='/api/themes/manage'){
    const items=(store.listUserThemes({includeArchived:true})||[]).map((row)=>({id:row.id,label:row.label,target:row.target,status:row.status,source:'user',activeVersion:row.active_version||null,updatedAt:row.updated_at}));json(response,200,{schemaVersion:1,items});return true;
  }
  if(request.method==='GET'&&pathname==='/api/themes'){
    const target=searchParams.get('target')||'';if(!TARGETS.has(target)){json(response,400,{error:'target 必须是 article、social 或 cover'});return true;}
    json(response,200,themeCatalog(target,getBuiltinThemeRegistry(),store));return true;
  }
  if(request.method==='POST'&&pathname==='/api/themes'){
    try{const input=await body(request);const saved=saveThemeDraft(store,{id:input.id,target:input.target,definition:input.definition});json(response,201,{theme:saved});}catch(error){json(response,400,{error:error.message,issues:error.issues||[]});}return true;
  }
  const socialTemplateProposalGenerate= request.method==='POST' && ['/api/social/template-proposals','/api/social/template-proposals/ai/generate','/api/themes/social-template-proposals/generate'].includes(pathname);
  if(socialTemplateProposalGenerate){
    try{
      socialTemplateProposalRateLimiter.assert('workspace');
      const input=await body(request);if(Buffer.byteLength(JSON.stringify(input),'utf8')>32*1024)throw Object.assign(new Error('Social 模板提案请求不能超过 32KB'),{code:SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.INPUT_INVALID,issues:[{field:'request',code:'TOO_LARGE',message:'请求不能超过 32KB'}]});
      const baseThemeId=input.baseThemeId?String(input.baseThemeId):'',baseTheme=baseThemeId?(getBuiltinThemeRegistry().get(baseThemeId)||userThemeFromRow(store.getUserTheme?.(baseThemeId),{draft:true})):null;
      if(baseThemeId&&!baseTheme)throw Object.assign(new Error('基础 Social 主题不存在'),{code:SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.INPUT_INVALID,issues:[{field:'baseThemeId',code:'NOT_FOUND',message:'请选择存在的 Social 主题'}]});
      if(baseThemeId&&(!baseTheme.targets?.includes('social')))throw Object.assign(new Error('基础主题不是 Social 主题'),{code:SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.INPUT_INVALID,issues:[{field:'baseThemeId',code:'TARGET_MISMATCH',message:'模板提案只能基于 Social 主题'}]});
      const baseTemplatePack=input.baseTemplatePack||baseTheme?.social?.templatePack?.id||'standard-v1',requestInput={...input,baseTemplatePack,baseThemeId:baseThemeId||undefined};
      const controller=new AbortController();request.once?.('aborted',()=>controller.abort());const candidate=await generateSocialTemplateProposal({gateway:models,request:requestInput,candidateStore:socialTemplateProposals,basePack:getSocialCardTemplatePack(baseTemplatePack),baseTheme,signal:controller.signal});
      recordSocialTemplateProposalMetric(store,{operation:'generated',proposalId:candidate.proposal?.proposalId,candidateId:candidate.id,templatePackId:candidate.proposal?.baseTemplatePack||baseTemplatePack,themeId:baseThemeId});
      const {id,...value}=candidate;json(response,200,{proposalId:value.proposal?.proposalId||id,candidateId:id,...value});
    }catch(error){const status=error.code===SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.RATE_LIMITED?429:error.code===SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.MODEL_UNAVAILABLE?503:error.code===SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.EXPIRED?410:400;json(response,status,{error:error.message,code:error.code||SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.OUTPUT_INVALID,issues:error.issues||[]});}
    return true;
  }
  if(request.method==='GET'&&pathname==='/api/social/template-proposals/metrics'){
    const templatePackId=searchParams.get('templatePackId')||null;
    json(response,200,store?.socialTemplateProposalMetricsStats?.({templatePackId})||{templatePackId,generatedCount:0,compiledCount:0,confirmedCount:0,rejectedCount:0,acceptanceRate:null,compilePassRate:null,productionEligibleRate:null,failedRoles:{},underfilledPages:0,overflowPages:0,underfilledRate:null,overflowRate:null,extensionGate:{decision:'collect-more-evidence',rendererExtensionEligible:false,sampleCount:0}});
    return true;
  }
  const socialTemplateProposalCompile=pathname.match(/^\/api\/social\/template-proposals\/([^/]+)\/compile$/);
  if(request.method==='POST'&&socialTemplateProposalCompile){
    try{
      const id=decodeURIComponent(socialTemplateProposalCompile[1]);let value;
      try{value=socialTemplateProposals.get(id);}catch(error){if(error.code!==SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.EXPIRED)throw error;value=socialTemplateProposals.getByProposalId(id);}
      const baseThemeId=value.request?.baseThemeId||'',baseTheme=baseThemeId?(getBuiltinThemeRegistry().get(baseThemeId)||userThemeFromRow(store.getUserTheme?.(baseThemeId),{draft:true})):null;
      const input=await body(request).catch(()=>({}));
      const themeId=input.themeId||baseThemeId,theme=themeId?(getBuiltinThemeRegistry().get(themeId)||userThemeFromRow(store.getUserTheme?.(themeId),{draft:true})):baseTheme;
      if(themeId&&!theme)throw Object.assign(new Error('预览主题不存在'),{code: 'SOCIAL_TEMPLATE_PROPOSAL_THEME_NOT_FOUND',issues:[{field:'themeId',code:'NOT_FOUND',message:'请选择存在的 Social 主题'}]});
      if(theme&&!theme.targets?.includes('social'))throw Object.assign(new Error('预览主题不是 Social 主题'),{code:'SOCIAL_TEMPLATE_PROPOSAL_THEME_TARGET_MISMATCH',issues:[{field:'themeId',code:'TARGET_MISMATCH',message:'模板提案正式预览只能使用 Social 主题'}]});
      const compiled=compileSocialTemplateProposal({proposal:value.proposal,themeDefinition:theme,channelMode:input.channelMode==='wechat'?'wechat':'xiaohongshu'});
      recordSocialTemplateProposalMetric(store,{operation:'compiled',proposalId:value.proposal?.proposalId||id,candidateId:value.id,templatePackId:compiled.templatePack?.id,themeId:themeId,productionEligible:compiled.audit.productionEligible,auditValid:compiled.audit.valid,failedRoles:compiled.audit.issues.filter((item)=>item.role).map((item)=>item.role),issues:compiled.audit.issues,issueCount:compiled.audit.issues.length,pageCount:(compiled.html.match(/<section class="page /g)||[]).length});
      json(response,200,{candidateId:value.id,expiresAt:value.expiresAt,...compiled});
    }catch(error){const status=error.code===SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.EXPIRED?410:error.code==='SOCIAL_TEMPLATE_PROPOSAL_THEME_NOT_FOUND'?404:400;json(response,status,{error:error.message,code:error.code||SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.OUTPUT_INVALID,issues:error.issues||[]});}
    return true;
  }
  const socialTemplateProposalConfirm=pathname.match(/^\/api\/social\/template-proposals\/([^/]+)\/confirm$/);
  if(request.method==='POST'&&socialTemplateProposalConfirm){
    try{
      const id=decodeURIComponent(socialTemplateProposalConfirm[1]);let value;
      try{value=socialTemplateProposals.get(id);}catch(error){if(error.code!==SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.EXPIRED)throw error;value=socialTemplateProposals.getByProposalId(id);}
      const input=await body(request),themeId=String(input.themeId||'').trim(),row=themeId?store.getUserTheme?.(themeId):null;
      if(!themeId||!row)throw Object.assign(new Error('请先选择要绑定模板的 Social 用户主题'),{code:'SOCIAL_TEMPLATE_PROPOSAL_THEME_REQUIRED',issues:[{field:'themeId',code:'REQUIRED',message:'必须绑定到已存在的 Social 用户主题草稿'}]});
      if(row.target!=='social')throw Object.assign(new Error('模板提案只能绑定 Social 主题'),{code:'SOCIAL_TEMPLATE_PROPOSAL_THEME_TARGET_MISMATCH',issues:[{field:'themeId',code:'TARGET_MISMATCH',message:'目标主题必须是 social'}]});
      const theme=userThemeFromRow(row,{draft:true}),compiled=compileSocialTemplateProposal({proposal:value.proposal,themeDefinition:theme,channelMode:'xiaohongshu'});
      if(!compiled.audit.productionEligible){recordSocialTemplateProposalMetric(store,{operation:'rejected',proposalId:value.proposal?.proposalId||id,candidateId:value.id,themeId,productionEligible:false,auditValid:compiled.audit.valid,failedRoles:compiled.audit.issues.filter((item)=>item.role).map((item)=>item.role),issues:compiled.audit.issues,issueCount:compiled.audit.issues.length,pageCount:(compiled.html.match(/<section class="page /g)||[]).length});throw Object.assign(new Error('模板提案未通过正式样稿门禁，不能确认绑定'),{code:'SOCIAL_TEMPLATE_PROPOSAL_AUDIT_FAILED',issues:compiled.audit.issues});}
      const basePack=compileSocialTemplateProposalPack(value.proposal),templatePack={...basePack,css:compileSocialTemplateProposalCss(basePack)},definition=structuredClone(theme);
      definition.social.templatePack=templatePack;
      const saved=saveThemeDraft(store,{id:themeId,target:'social',definition,templateBindingSource:'user-selected'});
      recordSocialTemplateProposalMetric(store,{operation:'confirmed',proposalId:value.proposal?.proposalId||id,candidateId:value.id,templatePackId:templatePack.id,themeId,productionEligible:compiled.audit.productionEligible,auditValid:compiled.audit.valid,failedRoles:compiled.audit.issues.filter((item)=>item.role).map((item)=>item.role),issues:compiled.audit.issues,issueCount:compiled.audit.issues.length});
      socialTemplateProposals.update(value.id,{proposal:{...value.proposal,status:'ready'},confirmedAt:new Date().toISOString(),confirmedThemeId:themeId,templatePack});
      json(response,200,{proposalId:value.proposal?.proposalId||id,candidateId:value.id,theme:saved,templatePack,audit:compiled.audit,requiresThemePublish:true});
    }catch(error){const status=error.code===SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.EXPIRED?410:error.code==='SOCIAL_TEMPLATE_PROPOSAL_AUDIT_FAILED'?422:error.code==='SOCIAL_TEMPLATE_PROPOSAL_THEME_REQUIRED'||error.code==='SOCIAL_TEMPLATE_PROPOSAL_THEME_TARGET_MISMATCH'?400:400;json(response,status,{error:error.message,code:error.code||SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.OUTPUT_INVALID,issues:error.issues||[]});}
    return true;
  }
  const socialTemplateProposalGet=pathname.match(/^\/api\/social\/template-proposals\/([^/]+)$/);
  if(request.method==='GET'&&socialTemplateProposalGet){
    try{const id=decodeURIComponent(socialTemplateProposalGet[1]);let value;try{value=socialTemplateProposals.get(id);}catch(error){if(error.code!==SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.EXPIRED)throw error;value=socialTemplateProposals.getByProposalId(id);}json(response,200,{proposalId:value.proposal?.proposalId||id,candidateId:value.id,...value});}catch(error){json(response,error.code===SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.EXPIRED?410:404,{error:error.message,code:error.code||SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.EXPIRED,issues:error.issues||[]});}return true;
  }
  if(request.method==='POST'&&pathname==='/api/themes/ai/generate'){
    try{
      rateLimiter.assert('workspace');const input=await body(request);if(Buffer.byteLength(JSON.stringify(input),'utf8')>16*1024)throw Object.assign(new Error('AI 主题生成请求不能超过 16KB'),{code:AI_THEME_ERROR_CODES.INPUT_INVALID,issues:[{field:'request',code:'TOO_LARGE',message:'请求不能超过 16KB'}]});
      const controller=new AbortController();request.once?.('aborted',()=>controller.abort());const referenceThemes=(store.listUserThemes?.({includeArchived:true})||[]).map((row)=>userThemeFromRow(row,{draft:true})).filter(Boolean),candidate=await generateAiThemeCandidate({gateway:models,input,candidateStore,signal:controller.signal,referenceThemes});
      const {id,...value}=candidate;json(response,200,{candidateId:id,...value});
    }catch(error){const status=error.code===AI_THEME_ERROR_CODES.RATE_LIMITED?429:error.code===AI_THEME_ERROR_CODES.MODEL_UNAVAILABLE?503:400;json(response,status,{error:error.message,code:error.code||AI_THEME_ERROR_CODES.MODEL_OUTPUT_INVALID,issues:error.issues||[]});}return true;
  }
  const aiThemeCreateMatch=pathname.match(/^\/api\/themes\/ai\/candidates\/([^/]+)\/create$/);
  if(request.method==='POST'&&aiThemeCreateMatch){
    try{
      const candidateId=decodeURIComponent(aiThemeCreateMatch[1]),candidate=candidateStore.get(candidateId),input=await body(request),definition=structuredClone(candidate.definition);
      if(input.label!==undefined)definition.label=String(input.label).trim();if(input.description!==undefined)definition.description=String(input.description).trim();
      const audit=auditThemeForPublish(definition,{target:candidate.target});if(!audit.valid)throw Object.assign(new Error('AI 主题候选重新校验失败'),{code:AI_THEME_ERROR_CODES.OUTPUT_INVALID,issues:audit.issues});
      let id='';for(let attempt=0;attempt<10&&!id;attempt++){const value=`ai-${candidate.target}-${crypto.randomUUID().slice(0,8)}`;if(!store.getUserTheme(value)&&!getBuiltinThemeRegistry().has(value))id=value;}if(!id)throw new Error('无法生成唯一主题 ID，请重试');
      const theme=saveThemeDraft(store,{id,target:candidate.target,definition});candidateStore.delete(candidateId);json(response,201,{theme,creationMethod:'ai',aiProvenance:{serviceId:candidate.model.serviceId,model:candidate.model.model,promptVersion:candidate.promptVersion,generatedAt:candidate.createdAt,repairs:candidate.repairs}});
    }catch(error){const status=error.code===AI_THEME_ERROR_CODES.CANDIDATE_EXPIRED?410:400;json(response,status,{error:error.message,code:error.code||AI_THEME_ERROR_CODES.OUTPUT_INVALID,issues:error.issues||[]});}return true;
  }
  if(request.method==='POST'&&pathname==='/api/themes/preview'){
    try{const input=await body(request);json(response,200,compileThemePreview({target:input.target,definition:input.definition,highlightField:input.highlightField||''}));}catch(error){json(response,400,{error:error.message,issues:error.issues||[]});}return true;
  }
  if(request.method==='POST'&&pathname==='/api/themes/import'){try{const input=await body(request);json(response,201,importThemeDraft(store,{definition:input.definition,id:input.id||null}));}catch(error){json(response,400,{error:error.message,issues:error.issues||[]});}return true;}
  const themeCloneMatch=pathname.match(/^\/api\/themes\/([^/]+)\/clone$/);if(request.method==='POST'&&themeCloneMatch){try{const input=await body(request);json(response,201,{theme:cloneTheme(store,{sourceId:decodeURIComponent(themeCloneMatch[1]),id:input.id,label:input.label})});}catch(error){json(response,400,{error:error.message,issues:error.issues||[]});}return true;}
  const themeDraftMatch=pathname.match(/^\/api\/themes\/([^/]+)\/draft$/);if(request.method==='PUT'&&themeDraftMatch){try{const input=await body(request),id=decodeURIComponent(themeDraftMatch[1]),row=store.getUserTheme(id);if(!row){json(response,404,{error:'用户主题不存在'});return true;}json(response,200,{theme:saveThemeDraft(store,{id,target:row.target,definition:input.definition})});}catch(error){json(response,400,{error:error.message,issues:error.issues||[]});}return true;}
  const themeValidateMatch=pathname.match(/^\/api\/themes\/([^/]+)\/validate$/);if(request.method==='POST'&&themeValidateMatch){const id=decodeURIComponent(themeValidateMatch[1]),row=store.getUserTheme(id);if(!row){json(response,404,{error:'用户主题不存在'});return true;}json(response,200,auditThemeForPublish(userThemeFromRow(row,{draft:true}),{target:row.target}));return true;}
  const themePreviewMatch=pathname.match(/^\/api\/themes\/([^/]+)\/preview$/);if(request.method==='POST'&&themePreviewMatch){try{const row=store.getUserTheme(decodeURIComponent(themePreviewMatch[1]));if(!row){json(response,404,{error:'用户主题不存在'});return true;}const input=await body(request),definition=input.definition||userThemeFromRow(row,{draft:true});json(response,200,compileThemePreview({target:row.target,definition,highlightField:input.highlightField||''}));}catch(error){json(response,400,{error:error.message,issues:error.issues||[]});}return true;}
  const themePublishMatch=pathname.match(/^\/api\/themes\/([^/]+)\/publish$/);if(request.method==='POST'&&themePublishMatch){try{json(response,200,{theme:publishTheme(store,decodeURIComponent(themePublishMatch[1]))});}catch(error){json(response,400,{error:error.message,issues:error.issues||[]});}return true;}
  const themeArchiveMatch=pathname.match(/^\/api\/themes\/([^/]+)\/archive$/);if(request.method==='POST'&&themeArchiveMatch){const result=store.archiveUserTheme(decodeURIComponent(themeArchiveMatch[1]));json(response,result?200:404,result?{archived:true}:{error:'用户主题不存在'});return true;}
  const themeVersionsMatch=pathname.match(/^\/api\/themes\/([^/]+)\/versions$/);if(request.method==='GET'&&themeVersionsMatch){json(response,200,{items:store.userThemeVersions(decodeURIComponent(themeVersionsMatch[1]))});return true;}
  const themeRestoreMatch=pathname.match(/^\/api\/themes\/([^/]+)\/versions\/([^/]+)\/restore$/);if(request.method==='POST'&&themeRestoreMatch){try{json(response,200,{theme:restoreThemeVersion(store,decodeURIComponent(themeRestoreMatch[1]),decodeURIComponent(themeRestoreMatch[2]))});}catch(error){json(response,404,{error:error.message});}return true;}
  const themeExportMatch=pathname.match(/^\/api\/themes\/([^/]+)\/export$/);if(request.method==='GET'&&themeExportMatch){try{json(response,200,exportWorkspaceTheme(store,decodeURIComponent(themeExportMatch[1]),{draft:searchParams.get('draft')==='1'}));}catch(error){json(response,404,{error:error.message});}return true;}
  const themeUsageMatch=pathname.match(/^\/api\/themes\/([^/]+)\/usage$/);if(request.method==='GET'&&themeUsageMatch){json(response,200,store.themeUsageStats(decodeURIComponent(themeUsageMatch[1])));return true;}
  const themeImpactMatch=pathname.match(/^\/api\/themes\/([^/]+)\/archive-impact$/);if(request.method==='GET'&&themeImpactMatch){const impact=store.themeArchiveImpact(decodeURIComponent(themeImpactMatch[1]));json(response,impact.exists?200:404,impact.exists?impact:{error:'用户主题不存在'});return true;}
  const themeDetailMatch=pathname.match(/^\/api\/themes\/([^/]+)$/);
  if(request.method==='GET'&&themeDetailMatch){
    const id=decodeURIComponent(themeDetailMatch[1]);const user=store?.getUserTheme?.(id);if(user){json(response,200,detail(user,user.target));return true;}const theme=getBuiltinThemeRegistry().get(id);if(!theme){json(response,404,{error:`未知主题：${id}`});return true;}
    const target=searchParams.get('target')||theme.targets[0];if(!TARGETS.has(target)||!theme.targets.includes(target)){json(response,404,{error:`主题 ${id} 不支持 ${target||'指定目标'}`});return true;}
    json(response,200,{schemaVersion:1,...publicTheme(theme,target)});return true;
  }
  return false;
}
