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

const TARGETS=new Set(['article','social','cover']);
const SCENE_TAGS=['深度观点','技术教程','快讯','数据对比','事件图文'];
const DENSITY_LABEL={dense:'紧凑',standard:'适中',airy:'宽松'};

function themeDensity(theme,target){
  if(target==='article')return DENSITY_LABEL[theme.article?.recipes?.rhythm]||'适中';
  const high=socialDensityHighFields(theme).length;
  return high>=3?'紧凑':high<=1?'宽松':'适中';
}

function publicTheme(theme,target){const colors=theme.tokens?.colors||{};return {id:theme.id,label:theme.label,description:theme.description,version:theme.version,source:theme.source,target,tags:theme.tags||[],scenes:(theme.tags||[]).filter((tag)=>SCENE_TAGS.includes(tag)),density:themeDensity(theme,target),hash:theme.hash,preview:{background:colors.page||colors.background||colors.surface,surface:colors.surface,ink:colors.text,accent:colors.accent}};}
const ORDER={article:['magazine-warm','gossip-card','tech-wire','research-report','career-essay','news-digest'],social:['neon','tokyo-night','brutalist','solarized','retro-terminal','paper-craft','charcoal','peach','orange','ice-blue','mocha','lavender','crimson','bone-white'],cover:['cover-navy-gold','cover-split-navy','cover-editorial-red','cover-forest-cream','cover-graphite-neon','cover-crimson-paper','cover-royal-data','cover-amber-cocoa','cover-violet-night','cover-jade-paper']};
const DEFAULTS={article:'magazine-warm',social:'ice-blue',cover:'cover-navy-gold'};
const aiThemeCandidates=new AiThemeCandidateStore(),aiThemeRateLimiter=new AiThemeRateLimiter();

export function themeCatalog(target,registry=getBuiltinThemeRegistry(),store=null){
  if(!TARGETS.has(target))throw new Error(`未知主题目标：${target}`);
  const rank=new Map(ORDER[target].map((id,index)=>[id,index]));
  const builtin=registry.list({target}).map((theme)=>publicTheme(theme,target));const users=(store?.listUserThemes?.({target})||[]).filter((row)=>row.status==='published'&&row.active_version_id).map((row)=>publicTheme(userThemeFromRow(row),target));
  const items=[...builtin,...users].sort((a,b)=>(a.source==='builtin'?0:1)-(b.source==='builtin'?0:1)||(rank.get(a.id)??999)-(rank.get(b.id)??999)||a.label.localeCompare(b.label,'zh-CN'));
  return {schemaVersion:1,target,defaultTheme:DEFAULTS[target],items};
}

function detail(row,target){const published=userThemeFromRow(row),draft=userThemeFromRow(row,{draft:true}),compatibility=auditThemeForPublish(draft,{target}),components=target==='social'?socialComponentEditorCatalog(draft.social?.recipes):target==='article'?articleComponentEditorCatalog(draft.article?.recipes):null;return {schemaVersion:1,id:row.id,label:row.label,target,source:'user',status:row.status,activeVersion:row.active_version||null,definition:published,draft,compatibility,editorMode:compatibility.compatible?'full':'read-only',editorCatalog:{recipes:target==='cover'?{}:themeRecipeEditorCatalog(target),components}};}
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
