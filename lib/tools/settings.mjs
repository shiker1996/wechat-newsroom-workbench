import fs from 'node:fs';
import path from 'node:path';

function settingsPath(workspaceRoot) {
  return path.join(workspaceRoot,'data','tool-plugin-settings.json');
}

function normalizeEntry(input = {}) {
  return {
    enabled:input.enabled !== false,
    priority:Math.max(-100,Math.min(100,Number(input.priority)||0)),
  };
}

export function readToolPluginSettings(workspaceRoot) {
  const filePath=settingsPath(workspaceRoot);
  if(!fs.existsSync(filePath))return {};
  let parsed;
  try{parsed=JSON.parse(fs.readFileSync(filePath,'utf8'));}
  catch(error){throw new Error(`工具插件设置无效：${error.message}`);}
  return Object.fromEntries(Object.entries(parsed||{}).map(([id,value])=>[id,normalizeEntry(value)]));
}

export function writeToolPluginSetting(workspaceRoot, pluginId, input) {
  const current=readToolPluginSettings(workspaceRoot);
  const next={...current,[pluginId]:normalizeEntry({...current[pluginId],...input})};
  writeToolPluginSettings(workspaceRoot,next);
  return next[pluginId];
}

export function writeToolPluginSettings(workspaceRoot, settings) {
  const filePath=settingsPath(workspaceRoot);
  const next=Object.fromEntries(Object.entries(settings||{}).map(([id,value])=>[id,normalizeEntry(value)]));
  fs.mkdirSync(path.dirname(filePath),{recursive:true});
  const temporary=`${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary,`${JSON.stringify(next,null,2)}\n`,'utf8');
  fs.renameSync(temporary,filePath);
  return next;
}
