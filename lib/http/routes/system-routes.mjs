import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { checkReddit } from '../../../plugins/collectors/reddit/collector.mjs';
import { checkRssHub, ensureStarted, stopRssHub, testSubscription } from '../../../plugins/collectors/rsshub/collector.mjs';
import {
  addSubscription,
  listSubscriptions,
  removeSubscription,
  subscriptionTestInput,
  updateSubscription,
} from '../../integrations/subscriptions.mjs';
import { validateWorkbenchBackup } from '../../artifacts/backup-archive.mjs';
import { getGitHubApiHealth } from '../../connectors/github-client.mjs';
import { getRuntimeSettings, runPowerShellScript, updateRuntimeSettings } from '../../integrations/runtime-settings.mjs';
import { SkillRegistry } from '../../skills/registry.mjs';
import { BUILTIN_PLUGINS, getToolRegistry, reloadToolRegistry } from '../../tools/index.mjs';
import { writeToolPluginSetting, writeToolPluginSettings } from '../../tools/settings.mjs';
import { readActiveSkillConfig } from '../../skills/configuration.mjs';
import { loadSkillBundle } from '../../llm/skill-runtime.mjs';
import {
  installToolPlugin, listToolPluginInstallEvents, listToolPluginVersions, readToolPluginCatalog,
  rollbackToolPlugin, setInstalledToolPluginStatus, uninstallToolPlugin, validateToolPluginDirectory,
} from '../../tools/package-manager.mjs';
import {
  confirmRemotePluginFirstRun,
  installRemotePlugin, listRemotePluginEvents, readRemotePluginCatalog, setRemotePluginStatus,
  uninstallRemotePlugin, validateRemotePluginManifest,
} from '../../tools/remote-package-manager.mjs';
import { clearRemoteCredential, credentialStatus, setRemoteCredential } from '../../tools/remote-credentials.mjs';
import { createRemoteAdapter } from '../../tools/remote-adapter.mjs';
import {
  installSkillPackage, listSkillInstallEvents, readSkillPackageCatalog, setInstalledSkillStatus,
  setSkillEntryDefault, setSkillStageDefault, uninstallSkillPackage, validateSkillPackageDirectory, validateSkillZipPackage,
} from '../../skills/package-manager.mjs';
import { listArticleStageSkillSlots, listEntryWriterSkills } from '../../skills/entry-routing.mjs';
import { listInformationCapabilitySlots, setInformationCapabilitySlot } from '../../tools/capability-slots.mjs';
import { analyzeImplementationImpact, buildCapabilityGraph } from '../../tools/capability-graph.mjs';
import { migrateLegacyCapabilityRoutes, readCapabilityRoutes, setCapabilityRoute } from '../../tools/capability-routes.mjs';
import { ExtensionConfigurationService } from '../../extensions/configuration-service.mjs';
import { writeCollectorToolSetting } from '../../collectors/settings.mjs';
import { buildConfigurationCatalog, findConfigurationResource } from '../../extensions/configuration-catalog.mjs';
import { syncLegacyCollectionSources } from '../../collectors/legacy-source-adapter.mjs';
import { createBuiltinCollectorRegistry } from '../../collectors/builtin-registry.mjs';
import { CollectionSourceService, sourceInputForPlugin } from '../../collectors/source-service.mjs';
import { createCollectorRuntime, listCollectorPluginStates } from '../../collectors/runtime-registry.mjs';
import { confirmCollectorPluginFirstRun, installCollectorPlugin, listCollectorPluginEvents, readCollectorPluginCatalog, setCollectorPluginStatus, uninstallCollectorPlugin, validateCollectorPluginDirectory } from '../../collectors/package-manager.mjs';

function skillsUsingCapabilities(root, capabilities) {
  const expected=new Set(capabilities);
  return new SkillRegistry({workspaceRoot:root}).list().flatMap((skill)=>{
    const active=readActiveSkillConfig(root,skill.id);
    const declared=[...(skill.requiredCapabilities||[]),...(skill.optionalCapabilities||[])];
    return (active?.allowedTools||declared).some((capability)=>expected.has(capability))
      ? [{id:skill.id,name:skill.name}]
      : [];
  });
}

function requirePluginAdmin(request){
  if(request.headers['x-admin-confirm']!=='TRUSTED-LOCAL-PLUGIN')throw new Error('缺少本地管理员受信安装确认');
}

function stageWritingSkillRestore(root, entries) {
  const writingRoot=path.resolve(root,'writing-skills');
  const suffix=`${process.pid}-${Date.now()}`;
  const staging=path.resolve(root,`.writing-skills-restore-${suffix}`);
  const previous=path.resolve(root,`.writing-skills-previous-${suffix}`);
  fs.mkdirSync(staging,{recursive:true});
  try{
    for(const [name,data] of entries){
      const relative=name.replace(/^writing-skills\//,'');
      const target=path.resolve(staging,relative);
      if(!target.startsWith(`${staging}${path.sep}`))throw new Error('技能配置恢复路径越界');
      JSON.parse(data.toString('utf8'));
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,data);
    }
  }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
  let hadPrevious=false;let swapped=false;
  return {
    swap(){
      if(fs.existsSync(writingRoot)){fs.renameSync(writingRoot,previous);hadPrevious=true;}
      try{fs.renameSync(staging,writingRoot);swapped=true;}
      catch(error){if(hadPrevious)fs.renameSync(previous,writingRoot);throw error;}
    },
    commit(){if(hadPrevious)try{fs.rmSync(previous,{recursive:true,force:true});}catch{}},
    rollback(){
      if(swapped&&fs.existsSync(writingRoot))fs.rmSync(writingRoot,{recursive:true,force:true});
      if(hadPrevious&&fs.existsSync(previous))fs.renameSync(previous,writingRoot);
      if(fs.existsSync(staging))fs.rmSync(staging,{recursive:true,force:true});
    },
  };
}

function stageSkillPackageRestore(root,entries){
  const names=['installed-skills','skill-package-archive','installed-tool-plugins','tool-plugin-archive','installed-collector-plugins'];
  const suffix=`${process.pid}-${Date.now()}`;
  const staging=path.join(root,'data',`.skill-packages-restore-${suffix}`);
  const moved=[];
  fs.mkdirSync(staging,{recursive:true});
  try{
    for(const [name,data] of entries){
      const relative=name.replace(/^data\//,'');
      const target=path.resolve(staging,relative);
      if(!target.startsWith(`${path.resolve(staging)}${path.sep}`))throw new Error('第三方技能恢复路径越界');
      fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);
    }
    const catalogFile=path.join(staging,'skill-packages.json');
    if(fs.existsSync(catalogFile))JSON.parse(fs.readFileSync(catalogFile,'utf8'));
  }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
  return {
    swap(){
      for(const name of [...names,'skill-packages.json','skill-install-events.jsonl','tool-plugins.json','tool-plugin-install-events.jsonl',
        'remote-tool-plugins.json','remote-tool-plugin-events.jsonl','collector-plugins.json','collector-plugin-events.jsonl','information-capability-slots.json']){
        const live=path.join(root,'data',name),incoming=path.join(staging,name),previous=`${live}.previous-${suffix}`;
        if(fs.existsSync(live)){fs.renameSync(live,previous);moved.push({live,previous});}
        if(fs.existsSync(incoming))fs.renameSync(incoming,live);
      }
    },
    commit(){for(const {previous} of moved)if(fs.existsSync(previous))fs.rmSync(previous,{recursive:true,force:true});fs.rmSync(staging,{recursive:true,force:true});},
    rollback(){
      for(const name of [...names,'skill-packages.json','skill-install-events.jsonl','tool-plugins.json','tool-plugin-install-events.jsonl',
        'remote-tool-plugins.json','remote-tool-plugin-events.jsonl','collector-plugins.json','collector-plugin-events.jsonl','information-capability-slots.json']){const live=path.join(root,'data',name);if(fs.existsSync(live))fs.rmSync(live,{recursive:true,force:true});}
      for(const {live,previous} of moved)if(fs.existsSync(previous))fs.renameSync(previous,live);
      fs.rmSync(staging,{recursive:true,force:true});
    },
  };
}

export async function handleSystemRoutes(context) {
  const {
    request, response, pathname, searchParams, root, config, store,
    json, body, binaryBody, createWorkbenchBackup,
  } = context;
  const extensionSettingRepository=store?.repositories?.extensionSettings||{
    get:()=>null,save:()=>{throw new Error('扩展配置仓储不可用');},list:()=>[],
  };
  const extensionConfiguration=new ExtensionConfigurationService({root,repository:extensionSettingRepository});
  const collectorRuntime=()=>createCollectorRuntime({root,config,configurationResolver:(manifest)=>extensionConfiguration.resolve({extensionType:'collector',extensionId:manifest.id,manifest})});
  const configurationCatalog=()=>buildConfigurationCatalog({root,config});
  const resourceFallback=()=>({});
  migrateLegacyCapabilityRoutes(root);
  const capabilityGraph=async()=>{
    const registry=await getToolRegistry(),toolCatalog=readToolPluginCatalog(root),remoteCatalog=readRemotePluginCatalog(root);
    const toolsById=new Map(registry.listPlugins().map((item)=>[item.id,item]));
    for(const item of [...Object.values(toolCatalog.plugins),...Object.values(remoteCatalog.plugins)])if(item.status!=='uninstalled'&&!toolsById.has(item.id))toolsById.set(item.id,{...item.manifest,enabled:false,priority:0});
    const collectors=listCollectorPluginStates(root,createBuiltinCollectorRegistry().list());
    return buildCapabilityGraph({root,tools:[...toolsById.values()],collectors,collectionSources:store.listCollectionSources(),routes:readCapabilityRoutes(root).routes,configurationState:(type,id,manifest)=>extensionConfiguration.describe({extensionType:type,extensionId:id,manifest})});
  };
  const implementationImpact=async(type,id)=>{const result=analyzeImplementationImpact(await capabilityGraph(),{type,id});return {...result,impactVersion:`sha256:${crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex')}`};};
  const validateDisableImpact=async(type,id,input)=>{const impact=await implementationImpact(type,id);if(!impact.exists)return {ok:false,status:404,error:'工具实现不存在或没有声明能力',impact};if(!impact.canDisable)return {ok:false,status:409,error:'停用会造成必需能力断链',blocked:true,impact};if(impact.capabilities.length&&input.impactVersion!==impact.impactVersion)return {ok:false,status:409,error:'请先确认最新影响范围',requiresImpactConfirmation:true,impact};return {ok:true,impact};};

  if (request.method === 'POST' && pathname === '/api/system/cache/clear') {
    const input = await body(request);
    const kinds = input.kind === 'all' ? ['github-cache', 'source-cache'] : [String(input.kind || '')];
    const allowed = new Set(['github-cache', 'source-cache']);
    const cleared = [];
    for (const kind of kinds) {
      if (!allowed.has(kind)) {
        json(response, 400, { error: `不支持的缓存类型：${kind}` });
        return true;
      }
      const dir = path.join(root, 'data', kind);
      let removed = 0;
      if (fs.existsSync(dir)) {
        for (const entry of fs.readdirSync(dir)) {
          fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
          removed += 1;
        }
      }
      cleared.push({ kind, removed });
    }
    json(response, 200, { ok: true, cleared });
    return true;
  }

  if (request.method === 'GET' && pathname === '/api/system/health') {
    const target = searchParams.get('target') || 'all';
    if (!['all', 'reddit', 'rsshub', 'github'].includes(target)) {
      json(response, 400, { error: '未知的检查目标' });
      return true;
    }
    const [reddit, rsshub] = await Promise.all([
      target === 'all' || target === 'reddit' ? checkReddit(config.reddit) : Promise.resolve(null),
      target === 'all' || target === 'rsshub' ? checkRssHub(config.rsshub) : Promise.resolve(null),
    ]);
    const githubHealth=target === 'all' || target === 'github' ? getGitHubApiHealth() : null;
    if(githubHealth){const manifest=createBuiltinCollectorRegistry().getManifest('github-discovery-collector');const state=extensionConfiguration.describe({extensionType:'collector',extensionId:manifest.id,manifest});githubHealth.tokenConfigured=Boolean(state.credentialStatus?.fields?.token?.configured);}
    json(response, 200, {
      reddit,
      rsshub,
      github: githubHealth,
      node: process.version,
      now: new Date().toISOString(),
      target,
    });
    return true;
  }
  if(request.method==='GET'&&pathname==='/api/system/extension-configurations'){
    const skills=new SkillRegistry({workspaceRoot:root}).list().filter((manifest)=>manifest.configuration).map((manifest)=>({id:manifest.id,name:manifest.name,type:'skill',kind:manifest.kind,state:extensionConfiguration.describe({extensionType:'skill',extensionId:manifest.id,manifest})}));
    const toolRegistry=await getToolRegistry(),toolCatalog=readToolPluginCatalog(root),remoteCatalog=readRemotePluginCatalog(root);const toolManifests=new Map([...toolRegistry.listPlugins(),...Object.values(toolCatalog.plugins).filter((item)=>item.status!=='uninstalled').map((item)=>item.manifest),...Object.values(remoteCatalog.plugins).filter((item)=>item.status!=='uninstalled').map((item)=>item.manifest)].filter((manifest)=>manifest.configuration).map((manifest)=>[manifest.id,manifest]));
    const tools=[...toolManifests.values()].map((manifest)=>({id:manifest.id,name:manifest.name||manifest.id,type:'tool',kind:'tool',state:extensionConfiguration.describe({extensionType:'tool',extensionId:manifest.id,manifest})}));
    const collectors=Object.values(readCollectorPluginCatalog(root).plugins).filter((item)=>item.status!=='uninstalled'&&item.manifest.configuration).map((item)=>({id:item.id,name:item.name,type:'collector',kind:item.manifest.type,state:extensionConfiguration.describe({extensionType:'collector',extensionId:item.id,manifest:item.manifest})}));
    json(response,200,{items:[...skills,...tools,...collectors].sort((a,b)=>a.type.localeCompare(b.type)||a.name.localeCompare(b.name))});return true;
  }
  if(request.method==='GET'&&pathname==='/api/system/configuration/catalog'){
    const items=await configurationCatalog();json(response,200,{items:items.map(({manifest,...item})=>({...item,renderer:manifest.configurationRenderer||'standard',state:extensionConfiguration.describe({extensionType:item.type,extensionId:item.id,manifest,fallbackValues:resourceFallback({...item,manifest})})}))});return true;
  }
  if(request.method==='GET'&&pathname==='/api/system/configuration/migration-status'){
    const items=await configurationCatalog();const resources=items.map((resource)=>{const state=extensionConfiguration.describe({extensionType:resource.type,extensionId:resource.id,manifest:resource.manifest,fallbackValues:resourceFallback(resource)});return {type:resource.type,id:resource.id,name:resource.name,configured:state.configured,source:state.source,legacyFallbackFields:state.legacyFallbackFields||[]};});
    const migrated=resources.filter((item)=>item.source==='unified').length,legacyFallback=resources.filter((item)=>item.source==='legacy_fallback').length;
    json(response,200,{total:resources.length,migrated,legacyFallback,defaults:resources.length-migrated-legacyFallback,coverage:resources.length?Number((migrated/resources.length*100).toFixed(1)):100,readyToDisableFallback:legacyFallback===0,resources});return true;
  }
  if(request.method==='GET'&&pathname==='/api/system/capability-graph'){
    json(response,200,await capabilityGraph());return true;
  }
  const capabilityRouteMatch=pathname.match(/^\/api\/system\/capability-routes\/(.+)$/);
  if(request.method==='PUT'&&capabilityRouteMatch){const capability=decodeURIComponent(capabilityRouteMatch[1]),input=await body(request),pluginId=String(input.preferredImplementationId||'');const registry=await getToolRegistry();if(pluginId&&!registry.listCapabilities({includeDisabled:true}).some((item)=>item.capability===capability&&item.plugin===pluginId)){json(response,400,{error:'所选工具不实现该能力'});return true;}json(response,200,setCapabilityRoute(root,capability,{preferredImplementationId:pluginId}));return true;}
  const implementationImpactMatch=pathname.match(/^\/api\/system\/(tools|collectors)\/([^/]+)\/status-impact$/);
  if(request.method==='GET'&&implementationImpactMatch){
    const type=implementationImpactMatch[1]==='collectors'?'collector':'tool',id=decodeURIComponent(implementationImpactMatch[2]);
    const result=await implementationImpact(type,id);
    if(!result.exists){json(response,404,{error:'工具实现不存在或没有声明能力'});return true;}
    json(response,200,result);return true;
  }
  const unifiedConfigurationMatch=pathname.match(/^\/api\/system\/configuration\/([^/]+)\/([^/]+)$/);
  if(unifiedConfigurationMatch&&['GET','PUT'].includes(request.method)){
    const type=decodeURIComponent(unifiedConfigurationMatch[1]),id=decodeURIComponent(unifiedConfigurationMatch[2]);const resource=findConfigurationResource(await configurationCatalog(),type,id);
    if(!resource){json(response,404,{error:'配置资源不存在'});return true;}
    try{const result=request.method==='GET'?extensionConfiguration.describe({extensionType:type,extensionId:id,manifest:resource.manifest,fallbackValues:resourceFallback(resource)}):extensionConfiguration.save({extensionType:type,extensionId:id,manifest:resource.manifest,input:await body(request),fallbackValues:resourceFallback(resource)});json(response,200,result);}catch(error){json(response,400,{error:error.message,issues:error.issues||[]});}return true;
  }
  const unifiedConfigurationTestMatch=pathname.match(/^\/api\/system\/configuration\/([^/]+)\/([^/]+)\/test$/);
  if(request.method==='POST'&&unifiedConfigurationTestMatch){const type=decodeURIComponent(unifiedConfigurationTestMatch[1]),id=decodeURIComponent(unifiedConfigurationTestMatch[2]);const resource=findConfigurationResource(await configurationCatalog(),type,id);if(!resource){json(response,404,{error:'配置资源不存在'});return true;}const state=extensionConfiguration.describe({extensionType:type,extensionId:id,manifest:resource.manifest,fallbackValues:resourceFallback(resource)});json(response,state.configured?200:400,{pass:state.configured,state});return true;}
  if (request.method === 'GET' && pathname === '/api/system/skills') {
    const skills = new SkillRegistry({ workspaceRoot:root }).list().map((skill)=>({...skill,
      extensionConfiguration:extensionConfiguration.describe({extensionType:'skill',extensionId:skill.id,manifest:skill})}));
    const toolRegistry=await getToolRegistry();
    const loadedTools=await Promise.all(toolRegistry.listCapabilities({includeDisabled:true}).map(async(item)=>({
      ...item,health:item.enabled?await toolRegistry.health(item.capability,{plugin:item.plugin})
        : {status:'ok',data:{available:false,disabled:true}},
      recentExecution:store.listToolExecutions({capability:item.capability,limit:1})[0]||null,
    })));
    const pluginCatalog=readToolPluginCatalog(root);
    const remoteCatalog=readRemotePluginCatalog(root);
    const installedTools=Object.values(pluginCatalog.plugins).filter((item)=>item.status!=='uninstalled').flatMap((item)=>
      item.manifest.capabilities.map((capability)=>({
        capability,plugin:item.id,version:item.version,riskLevel:item.manifest.riskLevel,
        enabled:item.status==='enabled',priority:0,thirdParty:true,status:item.status,
        source:item.manifest.source,compatibleApp:item.manifest.compatibleApp,permissions:item.manifest.permissions,
        contentHash:item.contentHash,restartRequired:item.restartRequired,
        health:{status:'ok',data:{available:false,restartRequired:true}},
        recentExecution:store.listToolExecutions({capability,limit:1})[0]||null,
      })));
    const remoteTools=Object.values(remoteCatalog.plugins).filter((item)=>item.status!=='uninstalled').flatMap((item)=>
      item.manifest.capabilities.map((capability)=>({
        capability,plugin:item.id,version:item.version,riskLevel:item.manifest.riskLevel,
        enabled:item.status==='enabled',priority:0,thirdParty:true,remote:true,status:item.status,
        source:item.manifest.source,compatibleApp:item.manifest.compatibleApp,permissions:item.manifest.permissions,
        endpointHost:new URL(item.manifest.endpoint).hostname,
        firstRunConfirmedAt:item.firstRunConfirmedAt||'',
        credential:credentialStatus(root,item.manifest.credentialProfile),
        health:{status:'ok',data:{available:false,disabled:item.status!=='enabled'}},
        recentExecution:store.listToolExecutions({capability,limit:1})[0]||null,
      })));
    const tools=[...loadedTools.map((item)=>{
      const installed=pluginCatalog.plugins[item.plugin];
      const remote=remoteCatalog.plugins[item.plugin];
      if(remote)return {...item,enabled:remote.status==='enabled',thirdParty:true,remote:true,status:remote.status,
        source:remote.manifest.source,compatibleApp:remote.manifest.compatibleApp,permissions:remote.manifest.permissions,
        endpointHost:new URL(remote.manifest.endpoint).hostname,firstRunConfirmedAt:remote.firstRunConfirmedAt||'',credential:credentialStatus(root,remote.manifest.credentialProfile)};
      return installed?{...item,enabled:installed.status==='enabled',thirdParty:true,status:installed.status,
        source:installed.manifest.source,compatibleApp:installed.manifest.compatibleApp,permissions:installed.manifest.permissions,
        contentHash:installed.contentHash,restartRequired:installed.restartRequired}:{...item,thirdParty:false};
    }),...installedTools.filter((item)=>!loadedTools.some((loaded)=>loaded.plugin===item.plugin&&loaded.capability===item.capability)),
      ...remoteTools.filter((item)=>!loadedTools.some((loaded)=>loaded.plugin===item.plugin&&loaded.capability===item.capability))]
      .map((tool)=>{const manifest=toolRegistry.listPlugins().find((item)=>item.id===tool.plugin)||pluginCatalog.plugins[tool.plugin]?.manifest||remoteCatalog.plugins[tool.plugin]?.manifest||tool;
        return {...tool,name:manifest.name||tool.plugin,kind:manifest.kind||'tool',configuration:manifest.configuration||null,
          extensionConfiguration:extensionConfiguration.describe({extensionType:'tool',extensionId:tool.plugin,manifest})};});
    const packageCatalog=readSkillPackageCatalog(root);
    json(response, 200, { readonly:true, skills, tools, total:skills.length,
      entryDefaults:packageCatalog.entryDefaults,stageDefaults:packageCatalog.stageDefaults,routingEnabled:true });
    return true;
  }
  if(request.method==='GET'&&pathname==='/api/system/information-capability-slots'){
    json(response,200,{items:await listInformationCapabilitySlots(root)});return true;
  }
  const informationSlotMatch=pathname.match(/^\/api\/system\/information-capability-slots\/([^/]+)$/);
  if(request.method==='PUT'&&informationSlotMatch){
    try{json(response,200,await setInformationCapabilitySlot(root,decodeURIComponent(informationSlotMatch[1]),String((await body(request)).pluginId||'')));}
    catch(error){json(response,400,{error:error.message});}
    return true;
  }
  const creationSkillsMatch=pathname.match(/^\/api\/creation-entry-points\/([^/]+)\/skills$/);
  if(request.method==='GET'&&creationSkillsMatch){
    try{
      json(response,200,await listEntryWriterSkills({
        workspaceRoot:root,
        entryPoint:decodeURIComponent(creationSkillsMatch[1]),
        contentType:String(searchParams.get('contentType')||''),
        recommendedSkillId:String(searchParams.get('recommendedSkillId')||''),
      }));
    }catch(error){json(response,400,{error:error.message});}
    return true;
  }
  const creationStageSkillsMatch=pathname.match(/^\/api\/creation-entry-points\/([^/]+)\/stage-skills$/);
  if(request.method==='GET'&&creationStageSkillsMatch){
    try{json(response,200,await listArticleStageSkillSlots({
      workspaceRoot:root,entryPoint:decodeURIComponent(creationStageSkillsMatch[1]),
    }));}
    catch(error){json(response,400,{error:error.message});}
    return true;
  }
  if(request.method==='GET'&&pathname==='/api/system/tool-plugin-install-events'){
    json(response,200,{items:listToolPluginInstallEvents(root,Number(searchParams.get('limit')||100))});return true;
  }
  if(request.method==='GET'&&pathname==='/api/system/remote-tool-plugin-events'){
    json(response,200,{items:listRemotePluginEvents(root,Number(searchParams.get('limit')||100))});return true;
  }
  if(request.method==='POST'&&['/api/system/remote-tool-plugins/validate','/api/system/remote-tool-plugins'].includes(pathname)){
    try{
      const input=await body(request),manifest=input.manifest||input;
      const checked=validateRemotePluginManifest(manifest);
      const localItem=readToolPluginCatalog(root).plugins[checked.id];
      if(!pathname.endsWith('/validate')&&(BUILTIN_PLUGINS.includes(checked.id)||(localItem&&localItem.status!=='uninstalled')))throw new Error(`插件 ID 与本地插件冲突：${checked.id}`);
      const result=pathname.endsWith('/validate')?checked:installRemotePlugin(root,checked);
      if(!pathname.endsWith('/validate'))await reloadToolRegistry();
      json(response,200,result);
    }catch(error){json(response,400,{error:error.message});}
    return true;
  }
  const remoteStatusMatch=pathname.match(/^\/api\/system\/remote-tool-plugins\/([^/]+)\/status$/);
  if(request.method==='PATCH'&&remoteStatusMatch){
    try{const id=decodeURIComponent(remoteStatusMatch[1]),input=await body(request);if(input.status==='disabled'){const check=await validateDisableImpact('tool',id,input);if(!check.ok){json(response,check.status,{error:check.error,...check});return true;}}const result=setRemotePluginStatus(root,id,input.status);await reloadToolRegistry();json(response,200,{...result,appliesTo:'new-tasks'});}
    catch(error){json(response,400,{error:error.message});}
    return true;
  }
  const remoteFirstRunMatch=pathname.match(/^\/api\/system\/remote-tool-plugins\/([^/]+)\/first-run-confirm$/);
  if(request.method==='POST'&&remoteFirstRunMatch){
    try{const result=confirmRemotePluginFirstRun(root,decodeURIComponent(remoteFirstRunMatch[1]));json(response,200,result);}
    catch(error){json(response,400,{error:error.message});}
    return true;
  }
  const remoteCredentialsMatch=pathname.match(/^\/api\/system\/remote-tool-plugins\/([^/]+)\/credentials$/);
  if((request.method==='GET'||request.method==='PUT')&&remoteCredentialsMatch){
    const id=decodeURIComponent(remoteCredentialsMatch[1]),item=readRemotePluginCatalog(root).plugins[id];
    if(!item||item.status==='uninstalled'){json(response,404,{error:'远程插件不存在'});return true;}
    const profile=item.manifest.credentialProfile;
    if(!profile){json(response,400,{error:'该插件未声明凭据配置'});return true;}
    try{
      if(request.method==='GET')json(response,200,credentialStatus(root,profile));
      else{
        const input=await body(request);
        const result=input.clear===true?clearRemoteCredential(root,id,profile):setRemoteCredential(root,id,profile,input.token);
        json(response,200,result);
      }
    }catch(error){json(response,400,{error:error.message});}
    return true;
  }
  const remoteTestMatch=pathname.match(/^\/api\/system\/remote-tool-plugins\/([^/]+)\/test$/);
  if(request.method==='POST'&&remoteTestMatch){
    const id=decodeURIComponent(remoteTestMatch[1]),item=readRemotePluginCatalog(root).plugins[id];
    if(!item||item.status==='uninstalled'){json(response,404,{error:'远程插件不存在'});return true;}
    const health=await createRemoteAdapter({root,manifest:item.manifest}).health();
    json(response,200,{pluginId:id,pass:health.status==='ok'&&health.data?.available!==false,health});return true;
  }
  const remoteDeleteMatch=pathname.match(/^\/api\/system\/remote-tool-plugins\/([^/]+)$/);
  if(request.method==='DELETE'&&remoteDeleteMatch){
    const id=decodeURIComponent(remoteDeleteMatch[1]),item=readRemotePluginCatalog(root).plugins[id];
    if(!item||item.status==='uninstalled'){json(response,404,{error:'远程插件不存在'});return true;}
    try{
      const input=await body(request),check=await validateDisableImpact('tool',id,input);if(!check.ok){json(response,check.status,{error:check.error,...check});return true;}
      const result=uninstallRemotePlugin(root,id);await reloadToolRegistry();json(response,200,{...result,impact:check.impact,appliesTo:'new-tasks',historyPreserved:true});
    }catch(error){json(response,400,{error:error.message});}
    return true;
  }
  if(request.method==='POST'&&['/api/system/tool-plugin-packages/validate','/api/system/tool-plugin-packages/install'].includes(pathname)){
    try{
      if(pathname.endsWith('/install'))requirePluginAdmin(request);
      const input=await body(request);
      const result=pathname.endsWith('/validate')?validateToolPluginDirectory(input.directory)
        :installToolPlugin({workspaceRoot:root,directory:input.directory,builtinIds:BUILTIN_PLUGINS});
      const safe={...result};delete safe.directory;
      json(response,200,safe);
    }catch(error){json(response,400,{error:error.message});}
    return true;
  }
  const installedPluginStatusMatch=pathname.match(/^\/api\/system\/tool-plugins\/([^/]+)\/status$/);
  if(request.method==='PATCH'&&installedPluginStatusMatch){
    try{requirePluginAdmin(request);const id=decodeURIComponent(installedPluginStatusMatch[1]),input=await body(request);if(input.status==='disabled'){const check=await validateDisableImpact('tool',id,input);if(!check.ok){json(response,check.status,{error:check.error,...check});return true;}}json(response,200,{...setInstalledToolPluginStatus(root,id,input.status),appliesTo:'new-tasks'});}
    catch(error){json(response,400,{error:error.message});}
    return true;
  }
  const pluginVersionsMatch=pathname.match(/^\/api\/system\/tool-plugins\/([^/]+)\/versions$/);
  if(request.method==='GET'&&pluginVersionsMatch){
    json(response,200,{items:listToolPluginVersions(root,decodeURIComponent(pluginVersionsMatch[1]))});return true;
  }
  const pluginRollbackMatch=pathname.match(/^\/api\/system\/tool-plugins\/([^/]+)\/rollback$/);
  if(request.method==='POST'&&pluginRollbackMatch){
    try{requirePluginAdmin(request);json(response,200,rollbackToolPlugin(root,decodeURIComponent(pluginRollbackMatch[1]),(await body(request)).version));}
    catch(error){json(response,400,{error:error.message});}
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/system/skill-install-events') {
    json(response,200,{items:listSkillInstallEvents(root,Number(searchParams.get('limit')||100))});return true;
  }
  if (request.method === 'GET' && pathname === '/api/system/skill-entry-defaults') {
    const catalog=readSkillPackageCatalog(root);
    json(response,200,{items:catalog.entryDefaults,stageItems:catalog.stageDefaults,routingEnabled:true});return true;
  }
  const entryDefaultMatch=pathname.match(/^\/api\/system\/skill-entry-defaults\/([^/]+)$/);
  if(request.method==='PUT'&&entryDefaultMatch){
    const input=await body(request);
    const items=setSkillEntryDefault(root,decodeURIComponent(entryDefaultMatch[1]),input.skillId||'');
    json(response,200,{items,routingEnabled:true});return true;
  }
  const stageDefaultMatch=pathname.match(/^\/api\/system\/skill-stage-defaults\/([^/]+)\/([^/]+)$/);
  if(request.method==='PUT'&&stageDefaultMatch){
    try{
      const input=await body(request);
      const items=setSkillStageDefault(root,decodeURIComponent(stageDefaultMatch[1]),decodeURIComponent(stageDefaultMatch[2]),input.skillId||'');
      json(response,200,{items,routingEnabled:true});
    }catch(error){json(response,400,{error:error.message});}
    return true;
  }
  if(request.method==='POST'&&['/api/system/skill-packages/validate','/api/system/skill-packages/install'].includes(pathname)){
    try{
      if(pathname.endsWith('/install'))requirePluginAdmin(request);
      const isZip=String(request.headers['content-type']||'').includes('zip');
      const result=pathname.endsWith('/validate')
        ? (isZip?validateSkillZipPackage(await binaryBody(request,6_000_000)):validateSkillPackageDirectory((await body(request)).directory))
        : installSkillPackage({workspaceRoot:root,...(isZip?{zipBuffer:await binaryBody(request,6_000_000)}:{directory:(await body(request)).directory})});
      const safe={...result};delete safe.directory;
      json(response,200,safe);return true;
    }catch(error){json(response,400,{error:error.message});return true;}
  }
  const skillStatusMatch=pathname.match(/^\/api\/system\/skills\/([^/]+)\/status$/);
  if(request.method==='PATCH'&&skillStatusMatch){
    try{requirePluginAdmin(request);json(response,200,setInstalledSkillStatus(root,decodeURIComponent(skillStatusMatch[1]),(await body(request)).status));}
    catch(error){json(response,400,{error:error.message});}
    return true;
  }
  const skillUpdateMatch=pathname.match(/^\/api\/system\/skills\/([^/]+)\/update$/);
  if(request.method==='POST'&&skillUpdateMatch){
    try{
      requirePluginAdmin(request);
      const expected=decodeURIComponent(skillUpdateMatch[1]);
      const isZip=String(request.headers['content-type']||'').includes('zip');
      const source=isZip?{zipBuffer:await binaryBody(request,6_000_000)}:{directory:(await body(request)).directory};
      const checked=isZip?validateSkillZipPackage(source.zipBuffer):validateSkillPackageDirectory(source.directory);
      if(checked.manifest.id!==expected)throw new Error(`更新包 ID 必须为 ${expected}`);
      const result=installSkillPackage({workspaceRoot:root,...source});
      json(response,200,result);
    }catch(error){json(response,400,{error:error.message});}
    return true;
  }
  const toolPluginMatch=pathname.match(/^\/api\/system\/tool-plugins\/([^/]+)$/);
  if(request.method==='DELETE'&&toolPluginMatch){
    const pluginId=decodeURIComponent(toolPluginMatch[1]);
    try{
      requirePluginAdmin(request);
      const item=readToolPluginCatalog(root).plugins[pluginId];
      if(!item||item.status==='uninstalled'){json(response,404,{error:'第三方插件不存在'});return true;}
      const input=await body(request);
      const check=await validateDisableImpact('tool',pluginId,input);if(!check.ok){json(response,check.status,{error:check.error,...check});return true;}
      json(response,200,{...uninstallToolPlugin(root,pluginId),impact:check.impact,appliesTo:'new-tasks',historyPreserved:true});
    }catch(error){json(response,400,{error:error.message});}
    return true;
  }
  if(request.method==='PATCH'&&toolPluginMatch){
    const pluginId=decodeURIComponent(toolPluginMatch[1]);
    if(!BUILTIN_PLUGINS.includes(pluginId)){json(response,404,{error:'插件不存在'});return true;}
    const input=await body(request);
    const registry=await getToolRegistry();
    const plugin=registry.listPlugins().find((item)=>item.id===pluginId);
    if(!plugin){json(response,404,{error:'插件不存在'});return true;}
    const disabling=input.enabled===false&&plugin.enabled;
    let impact=null;if(disabling){const check=await validateDisableImpact('tool',pluginId,input);if(!check.ok){json(response,check.status,{error:check.error,...check});return true;}impact=check.impact;}
    const setting=writeToolPluginSetting(root,pluginId,{
      enabled:input.enabled===undefined?plugin.enabled:Boolean(input.enabled),
      priority:input.priority===undefined?plugin.priority:Number(input.priority),
    });
    await reloadToolRegistry();
    json(response,200,{pluginId,...setting,impact,appliesTo:'new-tasks'});
    return true;
  }
  const toolPluginTestMatch=pathname.match(/^\/api\/system\/tool-plugins\/([^/]+)\/test$/);
  if(request.method==='POST'&&toolPluginTestMatch){
    const pluginId=decodeURIComponent(toolPluginTestMatch[1]);
    const registry=await getToolRegistry();
    const plugin=registry.listPlugins().find((item)=>item.id===pluginId);
    if(!plugin){json(response,404,{error:'插件不存在'});return true;}
    if(!plugin.enabled){
      json(response,200,{pluginId,pass:false,health:{status:'ok',data:{available:false,disabled:true}}});
      return true;
    }
    const checks=await Promise.all(plugin.capabilities.map(async(capability)=>({
      capability,health:await registry.health(capability,{plugin:pluginId}),
    })));
    json(response,200,{pluginId,pass:checks.every((item)=>item.health.status==='ok'
      &&item.health.data?.available!==false),checks});
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/system/tool-executions') {
    json(response,200,{items:store.listToolExecutions({
      batchId:searchParams.get('batchId')||null,
      candidateId:searchParams.get('candidateId')?Number(searchParams.get('candidateId')):null,
      capability:searchParams.get('capability')||null,
      plugin:searchParams.get('plugin')||null,
      limit:Number(searchParams.get('limit')||100),
    })});
    return true;
  }
  const skillMatch = pathname.match(/^\/api\/system\/skills\/([^/]+)$/);
  if(request.method==='DELETE'&&skillMatch){
    try{requirePluginAdmin(request);json(response,200,uninstallSkillPackage(root,decodeURIComponent(skillMatch[1])));}
    catch(error){json(response,400,{error:error.message});}
    return true;
  }
  if (request.method === 'GET' && skillMatch) {
    const skillId=decodeURIComponent(skillMatch[1]);
    const discovered=new SkillRegistry({workspaceRoot:root}).get(skillId);
    if(!discovered){json(response,404,{error:'技能不存在'});return true;}
    const bundle=loadSkillBundle({workspaceRoot:root,skillName:skillId});
    const sourceFile=bundle.files[0]||(discovered.files?.[0]?path.join(root,discovered.files[0]):null);
    const catalog=readSkillPackageCatalog(root);
    const kindToSlot={storyboard:'storyboard',title:'title',reviewer:'reviewer',humanizer:'humanizer',seo:'seo'};
    const defaultScopes=(discovered.entryPoints||[]).flatMap((entryPoint)=>{
      if(discovered.kind==='writer')return [{entryPoint,slot:'writer',isDefault:catalog.entryDefaults[entryPoint]===skillId}];
      const slot=kindToSlot[discovered.kind];
      return slot?[{entryPoint,slot,isDefault:catalog.stageDefaults?.[entryPoint]?.[slot]===skillId}]:[];
    });
    json(response,200,{...discovered,readonly:true,defaultScopes,
      extensionConfiguration:extensionConfiguration.describe({extensionType:'skill',extensionId:skillId,manifest:discovered}),
      skillMarkdown:sourceFile?fs.readFileSync(sourceFile,'utf8'):'',
      sourcePath:sourceFile?path.relative(root,sourceFile).replaceAll('\\','/'):'',
    });return true;
  }
  const extensionConfigurationMatch=pathname.match(/^\/api\/system\/(skills|tool-plugins|collector-plugins)\/([^/]+)\/configuration$/);
  if(extensionConfigurationMatch&&['GET','PUT'].includes(request.method)){
    const extensionType=extensionConfigurationMatch[1]==='skills'?'skill':extensionConfigurationMatch[1]==='collector-plugins'?'collector':'tool';
    const extensionId=decodeURIComponent(extensionConfigurationMatch[2]);
    let manifest;
    if(extensionType==='skill')manifest=new SkillRegistry({workspaceRoot:root}).get(extensionId);
    else if(extensionType==='collector')manifest=readCollectorPluginCatalog(root).plugins[extensionId]?.manifest;
    else{
      const registry=await getToolRegistry();
      manifest=registry.listPlugins().find((item)=>item.id===extensionId)
        ||readToolPluginCatalog(root).plugins[extensionId]?.manifest||readRemotePluginCatalog(root).plugins[extensionId]?.manifest;
    }
    if(!manifest){json(response,404,{error:'扩展不存在'});return true;}
    try{
      const result=request.method==='GET'
        ?extensionConfiguration.describe({extensionType,extensionId,manifest})
        :extensionConfiguration.save({extensionType,extensionId,manifest,input:await body(request)});
      json(response,200,result);
    }catch(error){json(response,400,{error:error.message,issues:error.issues||[]});}
    return true;
  }
  const invocationMatch=pathname.match(/^\/api\/system\/tool-invocations\/([^/]+)$/);
  if(request.method==='GET'&&invocationMatch){json(response,200,{items:store.listToolInvocation(decodeURIComponent(invocationMatch[1]))});return true;}
  const extensionConfigurationTestMatch=pathname.match(/^\/api\/system\/(skills|tool-plugins|collector-plugins)\/([^/]+)\/configuration\/test$/);
  if(request.method==='POST'&&extensionConfigurationTestMatch){
    const extensionType=extensionConfigurationTestMatch[1]==='skills'?'skill':extensionConfigurationTestMatch[1]==='collector-plugins'?'collector':'tool';
    const extensionId=decodeURIComponent(extensionConfigurationTestMatch[2]);
    if(extensionType==='skill'){
      const manifest=new SkillRegistry({workspaceRoot:root}).get(extensionId);
      if(!manifest){json(response,404,{error:'扩展不存在'});return true;}
      const state=extensionConfiguration.describe({extensionType,extensionId,manifest});
      json(response,200,{pass:state.configured,state});return true;
    }
    if(extensionType==='collector'){const manifest=readCollectorPluginCatalog(root).plugins[extensionId]?.manifest;if(!manifest){json(response,404,{error:'采集器不存在'});return true;}const state=extensionConfiguration.describe({extensionType,extensionId,manifest});json(response,200,{pass:state.configured,state});return true;}
    const registry=await getToolRegistry();const manifest=registry.listPlugins().find((item)=>item.id===extensionId);
    if(!manifest){json(response,404,{error:'扩展不存在或尚未加载'});return true;}
    const state=extensionConfiguration.describe({extensionType,extensionId,manifest});
    if(!state.configured){json(response,200,{pass:false,state});return true;}
    const checks=await Promise.all(manifest.capabilities.map(async(capability)=>({capability,health:await registry.health(capability,{plugin:extensionId})})));
    json(response,200,{pass:checks.every((item)=>item.health.status==='ok'&&item.health.data?.available!==false),state,checks});return true;
  }
  if(request.method==='POST'&&/^\/api\/system\/skills\/[^/]+\/(?:versions(?:\/\d+\/restore)?|dry-run)$/.test(pathname)){
    json(response,403,{error:'内置技能为只读，请通过代码仓库修改 SKILL.md'});return true;
  }
  if (request.method === 'GET' && pathname === '/api/system/generation-snapshots') {
    json(response, 200, { items:store.listGenerationSnapshots({
      batchId:searchParams.get('batchId') || null,
      candidateId:searchParams.get('candidateId') ? Number(searchParams.get('candidateId')) : null,
      limit:Number(searchParams.get('limit') || 50),
    }) });
    return true;
  }
  if (request.method === 'PUT' && pathname === '/api/system/settings') {
    json(response, 200, updateRuntimeSettings(root, config, await body(request)));
    return true;
  }

  const runtimeMatch = pathname.match(/^\/api\/system\/runtime\/(rsshub|reddit)\/(start|stop|restart)$/);
  if (request.method === 'POST' && runtimeMatch) {
    const [, service, action] = runtimeMatch;
    let result = { message: '操作完成' };
    if (service === 'rsshub') {
      if (action === 'stop' || action === 'restart') result = await stopRssHub(config.rsshub);
      if (action === 'start' || action === 'restart') {
        const started = await ensureStarted(config.rsshub, () => {});
        result = { message: started ? 'RSSHub 已启动并通过健康检查' : 'RSSHub 已在运行' };
      }
    } else {
      const port = String(new URL(config.reddit.cdpUrl).port || 9222);
      if (action === 'stop' || action === 'restart') {
        result = await runPowerShellScript(path.join(root, 'plugins', 'collectors', 'reddit', 'scripts', 'stop-chrome.ps1'), ['-Port', port]);
      }
      if (action === 'start' || action === 'restart') {
        result = await runPowerShellScript(path.join(root, 'plugins', 'collectors', 'reddit', 'scripts', 'start-chrome.ps1'), ['-Port', port]);
      }
    }
    json(response, 200, { ...result, service, action });
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/subscriptions') {
    if(store?.repositories?.collectionSources)syncLegacyCollectionSources(config,store.repositories.collectionSources);
    json(response, 200, listSubscriptions(config, store.listSubscriptionHealth()));
    return true;
  }
  if(request.method==='GET'&&pathname==='/api/collector-plugins'){
    const items=listCollectorPluginStates(root,createBuiltinCollectorRegistry().list()).map((item)=>{const configuration=item.configuration?extensionConfiguration.describe({extensionType:'collector',extensionId:item.id,manifest:item}):null;const available=item.available&&(!configuration||configuration.configured);return {...item,available,configurationState:configuration,sourceCount:store.listCollectionSources().filter((source)=>source.plugin_id===item.id).length,executionStatus:!item.available?'unavailable':configuration&&!configuration.configured?'needs_configuration':'ready'};});json(response,200,{items});return true;
  }
  const collectorRuntimeSettingMatch=pathname.match(/^\/api\/system\/collector-tools\/([^/]+)$/);
  if(request.method==='PATCH'&&collectorRuntimeSettingMatch){const id=decodeURIComponent(collectorRuntimeSettingMatch[1]),input=await body(request);if(input.enabled===false){const check=await validateDisableImpact('collector',id,input);if(!check.ok){json(response,check.status,{error:check.error,...check});return true;}}json(response,200,{...writeCollectorToolSetting(root,id,input),appliesTo:'new-tasks'});return true;}
  if(request.method==='GET'&&pathname==='/api/system/collector-plugin-events'){json(response,200,{items:listCollectorPluginEvents(root,Number(searchParams.get('limit')||100))});return true;}
  if(request.method==='POST'&&['/api/system/collector-plugin-packages/validate','/api/system/collector-plugin-packages/install'].includes(pathname)){
    try{if(pathname.endsWith('/install'))requirePluginAdmin(request);const input=await body(request);const result=pathname.endsWith('/validate')?validateCollectorPluginDirectory(input.directory):installCollectorPlugin(root,input.directory,createBuiltinCollectorRegistry().list().map((item)=>item.id));const safe={...result};delete safe.directory;json(response,200,safe);}
    catch(error){json(response,400,{error:error.message});}return true;
  }
  const collectorStatusMatch=pathname.match(/^\/api\/system\/collector-plugins\/([^/]+)\/status$/);
  if(request.method==='PATCH'&&collectorStatusMatch){try{requirePluginAdmin(request);const id=decodeURIComponent(collectorStatusMatch[1]),input=await body(request);if(input.status==='disabled'){const check=await validateDisableImpact('collector',id,input);if(!check.ok){json(response,check.status,{error:check.error,...check});return true;}}json(response,200,{...setCollectorPluginStatus(root,id,input.status),appliesTo:'new-tasks'});}catch(error){json(response,400,{error:error.message});}return true;}
  const collectorConfirmMatch=pathname.match(/^\/api\/system\/collector-plugins\/([^/]+)\/first-run-confirm$/);
  if(request.method==='POST'&&collectorConfirmMatch){try{json(response,200,confirmCollectorPluginFirstRun(root,decodeURIComponent(collectorConfirmMatch[1])));}catch(error){json(response,400,{error:error.message});}return true;}
  const collectorDeleteMatch=pathname.match(/^\/api\/system\/collector-plugins\/([^/]+)$/);
  if(request.method==='DELETE'&&collectorDeleteMatch){const id=decodeURIComponent(collectorDeleteMatch[1]),affectedSources=store.listCollectionSources().filter((item)=>item.plugin_id===id).map((item)=>({id:item.id,label:item.label,enabled:item.enabled}));try{requirePluginAdmin(request);const input=await body(request),check=await validateDisableImpact('collector',id,input);if(!check.ok){json(response,check.status,{error:check.error,...check});return true;}json(response,200,{...uninstallCollectorPlugin(root,id),affectedSources,impact:check.impact,sourcesPreserved:true,historyPreserved:true,appliesTo:'new-tasks'});}catch(error){json(response,400,{error:error.message});}return true;}
  if(request.method==='GET'&&pathname==='/api/collection-sources'){
    if(!store?.repositories?.collectionSources){json(response,200,{items:[]});return true;}
    syncLegacyCollectionSources(config,store.repositories.collectionSources);
    const healthByKey=new Map(store.listSubscriptionHealth().map((item)=>[item.source_key,item]));
    json(response,200,{items:store.listCollectionSources().map((item)=>({...item,health:healthByKey.get(item.source_key)||null,pluginStatus:'ready'}))});return true;
  }
  if(pathname==='/api/collection-sources'&&request.method==='POST'){
    try{const registry=await collectorRuntime();const service=new CollectionSourceService({repository:store.repositories.collectionSources,registry});json(response,201,service.create(await body(request)));}
    catch(error){json(response,400,{error:error.message});}return true;
  }
  const collectionSourceMatch=pathname.match(/^\/api\/collection-sources\/(\d+)$/);
  if(collectionSourceMatch&&['PATCH','DELETE'].includes(request.method)){
    const id=Number(collectionSourceMatch[1]);try{
      if(request.method==='DELETE'){store.repositories.collectionSources.remove(id);json(response,200,{deleted:true,id});}
      else{const input=await body(request);if(Object.keys(input).every((key)=>key==='enabled'))json(response,200,store.repositories.collectionSources.setEnabled(id,input.enabled!==false));
        else{const registry=await collectorRuntime();json(response,200,new CollectionSourceService({repository:store.repositories.collectionSources,registry}).update(id,input));}}
    }catch(error){json(response,400,{error:error.message});}return true;
  }
  const collectionSourceTestMatch=pathname.match(/^\/api\/collection-sources\/(\d+)\/test$/);
  if(request.method==='POST'&&collectionSourceTestMatch){
    const id=Number(collectionSourceTestMatch[1]),source=store.getCollectionSource(id);if(!source){json(response,404,{error:'采集源不存在'});return true;}
    const registry=await collectorRuntime();const plugin=registry.get(source.plugin_id);
    try{if(!plugin?.adapter.test)throw new Error('该采集器暂不支持连接测试');const result=await plugin.adapter.test(source.config);store.repositories.collectionSources.updateTest(id,{status:'success'});json(response,200,result);}
    catch(error){store.repositories.collectionSources.updateTest(id,{status:'failed',error:error.message});json(response,400,{error:error.message});}return true;
  }
  if(request.method==='POST'&&pathname==='/api/collection-sources/test'){
    try{const input=await body(request),registry=await collectorRuntime();const normalized=sourceInputForPlugin(input.pluginId,input.config||input);const plugin=registry.get(input.pluginId);if(!plugin?.adapter.test)throw new Error('该采集器暂不支持连接测试');json(response,200,await plugin.adapter.test(normalized.config));}
    catch(error){json(response,400,{error:error.message});}return true;
  }
  if (request.method === 'GET' && pathname === '/api/system/backup') {
    const backup = await createWorkbenchBackup();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    response.writeHead(200, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="write-assistant-${stamp}.zip"`,
      'content-length': backup.buffer.length,
      'cache-control': 'no-store',
    });
    response.end(backup.buffer);
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/system/backup/validate') {
    try {
      const parsed = validateWorkbenchBackup(await binaryBody(request));
      json(response, 200, {
        valid: true,
        createdAt: parsed.manifest.createdAt,
        appVersion: parsed.manifest.appVersion,
        fileCount: parsed.manifest.files.length,
        totalBytes: parsed.manifest.files.reduce((sum, item) => sum + item.size, 0),
      });
    } catch (error) {
      json(response, 400, { valid: false, error: error.message });
    }
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/system/backup/restore') {
    if (request.headers['x-restore-confirm'] !== 'RESTORE') {
      json(response, 409, { error: '缺少恢复确认' });
      return true;
    }
    let tempDir;
    try {
      const parsed = validateWorkbenchBackup(await binaryBody(request));
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-assistant-restore-'));
      const sourceDb = path.join(tempDir, 'workbench.db');
      fs.writeFileSync(sourceDb, parsed.entries.get('data/workbench.db'));
      const probe = new (await import('node:sqlite')).DatabaseSync(sourceDb, { readOnly: true });
      try {
        if (probe.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
          throw new Error('备份数据库完整性检查失败');
        }
      } finally {
        probe.close();
      }
      const safety = await createWorkbenchBackup();
      const backupDir = path.join(root, 'data', 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      const safetyName = `before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
      fs.writeFileSync(path.join(backupDir, safetyName), safety.buffer);
      const activeEntries=[...parsed.entries.entries()].filter(([name])=>/^writing-skills\/[^/]+\/active\.json$/.test(name));
      const pluginSettingsEntry=parsed.entries.get('data/tool-plugin-settings.json')||null;
      const pluginSettings=pluginSettingsEntry?JSON.parse(pluginSettingsEntry.toString('utf8')):null;
      const skillRestore=stageWritingSkillRestore(root,activeEntries);
      const packageEntries=[...parsed.entries.entries()].filter(([name])=>/^data\/(?:skill-packages\.json|skill-install-events\.jsonl|installed-skills\/|skill-package-archive\/|tool-plugins\.json|tool-plugin-install-events\.jsonl|installed-tool-plugins\/|tool-plugin-archive\/|remote-tool-plugins\.json|remote-tool-plugin-events\.jsonl|collector-plugins\.json|collector-plugin-events\.jsonl|installed-collector-plugins\/|information-capability-slots\.json)/.test(name));
      const packageRestore=packageEntries.length?stageSkillPackageRestore(root,packageEntries):null;
      let result;
      try{
        skillRestore.swap();
        packageRestore?.swap();
        result=store.restoreFromDatabase(sourceDb);
        if(pluginSettings)writeToolPluginSettings(root,pluginSettings);
        await reloadToolRegistry();
        skillRestore.commit();
        packageRestore?.commit();
      }catch(error){skillRestore.rollback();packageRestore?.rollback();throw error;}
      json(response, 200, { restored: true, batches: result.count, safetyBackup: safetyName });
    } catch (error) {
      json(response, 400, { restored: false, error: error.message });
    } finally {
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    }
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/subscriptions/health-history') {
    json(response, 200, store.listSubscriptionHealthHistory({
      days: Number(searchParams.get('days') ?? 14),
      limit: Number(searchParams.get('limit') ?? 500),
    }));
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/subscriptions/test') {
    json(response, 200, await testSubscription(config.rsshub, subscriptionTestInput(await body(request))));
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/subscriptions') {
    addSubscription(root, config, await body(request));
    if(store?.repositories?.collectionSources)syncLegacyCollectionSources(config,store.repositories.collectionSources);
    json(response, 201, listSubscriptions(config, store.listSubscriptionHealth()));
    return true;
  }
  if (request.method === 'PATCH' && pathname === '/api/subscriptions') {
    updateSubscription(root, config, await body(request));
    if(store?.repositories?.collectionSources)syncLegacyCollectionSources(config,store.repositories.collectionSources);
    json(response, 200, listSubscriptions(config, store.listSubscriptionHealth()));
    return true;
  }
  if (request.method === 'DELETE' && pathname === '/api/subscriptions') {
    removeSubscription(root, config, await body(request));
    if(store?.repositories?.collectionSources)syncLegacyCollectionSources(config,store.repositories.collectionSources);
    json(response, 200, listSubscriptions(config, store.listSubscriptionHealth()));
    return true;
  }
  return false;
}
