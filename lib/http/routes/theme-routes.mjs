import { getBuiltinThemeRegistry } from '../../themes/theme-registry.mjs';
import { cloneTheme, exportWorkspaceTheme, importThemeDraft, publishTheme, restoreThemeVersion, saveThemeDraft, userThemeFromRow } from '../../themes/user-theme-service.mjs';
import { validateThemeDefinition } from '../../themes/theme-validator.mjs';

const TARGETS=new Set(['article','social']);
const ORDER={article:['magazine-warm','gossip-card','tech-wire','research-report','career-essay','news-digest'],social:['neon','tokyo-night','brutalist','solarized','retro-terminal','paper-craft','charcoal','peach','orange','ice-blue','mocha','lavender','crimson','bone-white']};
const DEFAULTS={article:'magazine-warm',social:'ice-blue'};

function publicTheme(theme,target){const colors=theme.tokens?.colors||{};return {id:theme.id,label:theme.label,description:theme.description,version:theme.version,source:theme.source,target,tags:theme.tags||[],hash:theme.hash,preview:{background:colors.page||colors.background||colors.surface,surface:colors.surface,ink:colors.text,accent:colors.accent}};}

export function themeCatalog(target,registry=getBuiltinThemeRegistry(),store=null){
  if(!TARGETS.has(target))throw new Error(`未知主题目标：${target}`);
  const rank=new Map(ORDER[target].map((id,index)=>[id,index]));
  const builtin=registry.list({target}).map((theme)=>publicTheme(theme,target));const users=(store?.listUserThemes?.({target})||[]).filter((row)=>row.status==='published'&&row.active_version_id).map((row)=>publicTheme(userThemeFromRow(row),target));
  const items=[...builtin,...users].sort((a,b)=>(a.source==='builtin'?0:1)-(b.source==='builtin'?0:1)||(rank.get(a.id)??999)-(rank.get(b.id)??999)||a.label.localeCompare(b.label,'zh-CN'));
  return {schemaVersion:1,target,defaultTheme:DEFAULTS[target],items};
}

function detail(row,target){const published=userThemeFromRow(row),draft=userThemeFromRow(row,{draft:true});return {schemaVersion:1,id:row.id,label:row.label,target,source:'user',status:row.status,activeVersion:row.active_version||null,definition:published,draft};}
export async function handleThemeRoutes({request,response,pathname,searchParams,json,store,body}){
  if(request.method==='GET'&&pathname==='/api/themes/manage'){
    const items=(store.listUserThemes({includeArchived:true})||[]).map((row)=>({id:row.id,label:row.label,target:row.target,status:row.status,source:'user',activeVersion:row.active_version||null,updatedAt:row.updated_at}));json(response,200,{schemaVersion:1,items});return true;
  }
  if(request.method==='GET'&&pathname==='/api/themes'){
    const target=searchParams.get('target')||'';if(!TARGETS.has(target)){json(response,400,{error:'target 必须是 article 或 social'});return true;}
    json(response,200,themeCatalog(target,getBuiltinThemeRegistry(),store));return true;
  }
  if(request.method==='POST'&&pathname==='/api/themes'){
    try{const input=await body(request);const saved=saveThemeDraft(store,{id:input.id,target:input.target,definition:input.definition});json(response,201,{theme:saved});}catch(error){json(response,400,{error:error.message,issues:error.issues||[]});}return true;
  }
  if(request.method==='POST'&&pathname==='/api/themes/import'){try{const input=await body(request);json(response,201,importThemeDraft(store,{definition:input.definition,id:input.id||null}));}catch(error){json(response,400,{error:error.message,issues:error.issues||[]});}return true;}
  const themeCloneMatch=pathname.match(/^\/api\/themes\/([^/]+)\/clone$/);if(request.method==='POST'&&themeCloneMatch){try{const input=await body(request);json(response,201,{theme:cloneTheme(store,{sourceId:decodeURIComponent(themeCloneMatch[1]),id:input.id,label:input.label})});}catch(error){json(response,400,{error:error.message,issues:error.issues||[]});}return true;}
  const themeDraftMatch=pathname.match(/^\/api\/themes\/([^/]+)\/draft$/);if(request.method==='PUT'&&themeDraftMatch){try{const input=await body(request),id=decodeURIComponent(themeDraftMatch[1]),row=store.getUserTheme(id);if(!row){json(response,404,{error:'用户主题不存在'});return true;}json(response,200,{theme:saveThemeDraft(store,{id,target:row.target,definition:input.definition})});}catch(error){json(response,400,{error:error.message,issues:error.issues||[]});}return true;}
  const themeValidateMatch=pathname.match(/^\/api\/themes\/([^/]+)\/validate$/);if(request.method==='POST'&&themeValidateMatch){try{const id=decodeURIComponent(themeValidateMatch[1]),row=store.getUserTheme(id);if(!row){json(response,404,{error:'用户主题不存在'});return true;}const {hash,...definition}=userThemeFromRow(row,{draft:true});validateThemeDefinition(definition,{expectedTarget:row.target,expectedSource:'user'});json(response,200,{valid:true,issues:[]});}catch(error){json(response,200,{valid:false,issues:error.issues||[{message:error.message}]});}return true;}
  const themePreviewMatch=pathname.match(/^\/api\/themes\/([^/]+)\/preview$/);if(request.method==='POST'&&themePreviewMatch){const row=store.getUserTheme(decodeURIComponent(themePreviewMatch[1]));if(!row){json(response,404,{error:'用户主题不存在'});return true;}const theme=userThemeFromRow(row,{draft:true}),colors=theme.tokens.colors;json(response,200,{valid:true,theme:{id:theme.id,label:theme.label,target:row.target,version:theme.version,source:'user',preview:{background:colors.page||colors.background,surface:colors.surface,ink:colors.text,accent:colors.accent}},sample:{title:'主题样稿：把复杂内容讲清楚',lead:'这是一段用于检查正文、强调色和内容表面的固定预览。',section:'核心判断',quote:'好的主题服务于内容层级，而不是抢走注意力。'}});return true;}
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
