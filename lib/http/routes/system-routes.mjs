import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkReddit } from '../../../collectors/reddit.mjs';
import { checkRssHub, ensureStarted, stopRssHub, testSubscription } from '../../../collectors/rsshub.mjs';
import {
  addSubscription,
  listSubscriptions,
  removeSubscription,
  subscriptionTestInput,
  updateSubscription,
} from '../../integrations/subscriptions.mjs';
import { validateWorkbenchBackup } from '../../artifacts/backup-archive.mjs';
import { getGitHubApiHealth } from '../../integrations/github-api.mjs';
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
  const names=['installed-skills','skill-package-archive','installed-tool-plugins','tool-plugin-archive'];
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
        'remote-tool-plugins.json','remote-tool-plugin-events.jsonl','information-capability-slots.json']){
        const live=path.join(root,'data',name),incoming=path.join(staging,name),previous=`${live}.previous-${suffix}`;
        if(fs.existsSync(live)){fs.renameSync(live,previous);moved.push({live,previous});}
        if(fs.existsSync(incoming))fs.renameSync(incoming,live);
      }
    },
    commit(){for(const {previous} of moved)if(fs.existsSync(previous))fs.rmSync(previous,{recursive:true,force:true});fs.rmSync(staging,{recursive:true,force:true});},
    rollback(){
      for(const name of [...names,'skill-packages.json','skill-install-events.jsonl','tool-plugins.json','tool-plugin-install-events.jsonl',
        'remote-tool-plugins.json','remote-tool-plugin-events.jsonl','information-capability-slots.json']){const live=path.join(root,'data',name);if(fs.existsSync(live))fs.rmSync(live,{recursive:true,force:true});}
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
    json(response, 200, {
      reddit,
      rsshub,
      github: target === 'all' || target === 'github' ? getGitHubApiHealth() : null,
      node: process.version,
      now: new Date().toISOString(),
      target,
    });
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/system/settings') {
    json(response, 200, getRuntimeSettings(root, config));
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/system/skills') {
    const skills = new SkillRegistry({ workspaceRoot:root }).list();
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
        credential:credentialStatus(root,item.manifest.credentialProfile),
        health:{status:'ok',data:{available:false,disabled:item.status!=='enabled'}},
        recentExecution:store.listToolExecutions({capability,limit:1})[0]||null,
      })));
    const tools=[...loadedTools.map((item)=>{
      const installed=pluginCatalog.plugins[item.plugin];
      const remote=remoteCatalog.plugins[item.plugin];
      if(remote)return {...item,enabled:remote.status==='enabled',thirdParty:true,remote:true,status:remote.status,
        source:remote.manifest.source,compatibleApp:remote.manifest.compatibleApp,permissions:remote.manifest.permissions,
        endpointHost:new URL(remote.manifest.endpoint).hostname,credential:credentialStatus(root,remote.manifest.credentialProfile)};
      return installed?{...item,enabled:installed.status==='enabled',thirdParty:true,status:installed.status,
        source:installed.manifest.source,compatibleApp:installed.manifest.compatibleApp,permissions:installed.manifest.permissions,
        contentHash:installed.contentHash,restartRequired:installed.restartRequired}:{...item,thirdParty:false};
    }),...installedTools.filter((item)=>!loadedTools.some((loaded)=>loaded.plugin===item.plugin&&loaded.capability===item.capability)),
      ...remoteTools.filter((item)=>!loadedTools.some((loaded)=>loaded.plugin===item.plugin&&loaded.capability===item.capability))];
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
    try{const result=setRemotePluginStatus(root,decodeURIComponent(remoteStatusMatch[1]),(await body(request)).status);await reloadToolRegistry();json(response,200,result);}
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
      const input=await body(request),affectedSkills=skillsUsingCapabilities(root,item.manifest.capabilities);
      if(affectedSkills.length&&input.confirmImpact!==true){json(response,409,{error:'插件仍被技能声明使用',requiresConfirmation:true,affectedSkills});return true;}
      const result=uninstallRemotePlugin(root,id);await reloadToolRegistry();json(response,200,{...result,affectedSkills});
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
    try{requirePluginAdmin(request);json(response,200,setInstalledToolPluginStatus(root,decodeURIComponent(installedPluginStatusMatch[1]),(await body(request)).status));}
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
    try{json(response,200,setInstalledSkillStatus(root,decodeURIComponent(skillStatusMatch[1]),(await body(request)).status));}
    catch(error){json(response,400,{error:error.message});}
    return true;
  }
  const skillUpdateMatch=pathname.match(/^\/api\/system\/skills\/([^/]+)\/update$/);
  if(request.method==='POST'&&skillUpdateMatch){
    try{
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
      const affectedSkills=skillsUsingCapabilities(root,item.manifest.capabilities);
      const input=await body(request);
      if(affectedSkills.length&&input.confirmImpact!==true){json(response,409,{error:'插件仍被技能声明使用',requiresConfirmation:true,affectedSkills});return true;}
      json(response,200,{...uninstallToolPlugin(root,pluginId),affectedSkills});
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
    const affectedSkills=disabling?skillsUsingCapabilities(root,plugin.capabilities):[];
    if(affectedSkills.length&&input.confirmDisable!==true){
      json(response,409,{error:'该插件仍被已发布技能使用',requiresConfirmation:true,affectedSkills});
      return true;
    }
    const setting=writeToolPluginSetting(root,pluginId,{
      enabled:input.enabled===undefined?plugin.enabled:Boolean(input.enabled),
      priority:input.priority===undefined?plugin.priority:Number(input.priority),
    });
    await reloadToolRegistry();
    json(response,200,{pluginId,...setting,affectedSkills});
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
      limit:Number(searchParams.get('limit')||100),
    })});
    return true;
  }
  const skillMatch = pathname.match(/^\/api\/system\/skills\/([^/]+)$/);
  if(request.method==='DELETE'&&skillMatch){
    try{json(response,200,uninstallSkillPackage(root,decodeURIComponent(skillMatch[1])));}
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
      skillMarkdown:sourceFile?fs.readFileSync(sourceFile,'utf8'):'',
      sourcePath:sourceFile?path.relative(root,sourceFile).replaceAll('\\','/'):'',
    });return true;
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
        result = await runPowerShellScript(path.join(root, 'scripts', 'stop-reddit-chrome.ps1'), ['-Port', port]);
      }
      if (action === 'start' || action === 'restart') {
        result = await runPowerShellScript(path.join(root, 'scripts', 'start-reddit-chrome.ps1'), ['-Port', port]);
      }
    }
    json(response, 200, { ...result, service, action });
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/subscriptions') {
    json(response, 200, listSubscriptions(config, store.listSubscriptionHealth()));
    return true;
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
      const packageEntries=[...parsed.entries.entries()].filter(([name])=>/^data\/(?:skill-packages\.json|skill-install-events\.jsonl|installed-skills\/|skill-package-archive\/|tool-plugins\.json|tool-plugin-install-events\.jsonl|installed-tool-plugins\/|tool-plugin-archive\/|remote-tool-plugins\.json|remote-tool-plugin-events\.jsonl|information-capability-slots\.json)/.test(name));
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
    json(response, 201, listSubscriptions(config, store.listSubscriptionHealth()));
    return true;
  }
  if (request.method === 'PATCH' && pathname === '/api/subscriptions') {
    updateSubscription(root, config, await body(request));
    json(response, 200, listSubscriptions(config, store.listSubscriptionHealth()));
    return true;
  }
  if (request.method === 'DELETE' && pathname === '/api/subscriptions') {
    removeSubscription(root, config, await body(request));
    json(response, 200, listSubscriptions(config, store.listSubscriptionHealth()));
    return true;
  }
  return false;
}
