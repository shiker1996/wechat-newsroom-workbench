import fs from 'node:fs';
import path from 'node:path';

const SOURCE_URL='https://github.com/shiker1996/wechat-newsroom-workbench';
const DEPENDENCY_PATTERN=/(?:from\s*|import\s*\()\s*['"]([^.'"][^'"]*)['"]/g;
const EXCLUDED_DIRECTORIES=new Set(['data','node_modules']);

function copyDirectory(source,target){
  fs.mkdirSync(target,{recursive:true});
  for(const entry of fs.readdirSync(source,{withFileTypes:true})){
    if(entry.isDirectory()&&EXCLUDED_DIRECTORIES.has(entry.name))continue;
    const from=path.join(source,entry.name),to=path.join(target,entry.name);
    if(entry.isDirectory())copyDirectory(from,to);
    else if(entry.isFile())fs.copyFileSync(from,to);
  }
}

function runtimeDependencies(directory){const dependencies=new Set();for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const target=path.join(directory,entry.name);if(entry.isDirectory()&&!EXCLUDED_DIRECTORIES.has(entry.name))for(const value of runtimeDependencies(target))dependencies.add(value);else if(entry.isFile()&&path.extname(entry.name)==='.mjs'){const source=fs.readFileSync(target,'utf8');for(const match of source.matchAll(DEPENDENCY_PATTERN))if(!match[1].startsWith('node:'))dependencies.add(match[1].startsWith('@')?match[1].split('/').slice(0,2).join('/'):match[1].split('/')[0]);}}return [...dependencies].sort();}

function distributionManifest(manifest,directory){
  const collector=manifest.kind==='collector';
  return {
    ...manifest,
    type:manifest.type||(collector?'local-collector':'local-adapter'),
    source:manifest.source||{type:'reviewed-package',url:SOURCE_URL},
    compatibleApp:manifest.compatibleApp||'>=0.5.0',
    runtimeDependencies:manifest.runtimeDependencies||runtimeDependencies(directory),
    permissions:manifest.permissions||{
      networkDomains:[],
      pathAccess:collector?[]:[...(manifest.pathInputs||[])],
      externalWrite:manifest.riskLevel==='external-write',
      credentials:[],
    },
  };
}

export function stageBuiltinPluginPackage(sourceDirectory,outputRoot){
  const source=path.resolve(sourceDirectory),manifestFile=path.join(source,'manifest.json');
  if(!fs.existsSync(manifestFile))throw new Error(`插件缺少 manifest.json：${source}`);
  const manifest=distributionManifest(JSON.parse(fs.readFileSync(manifestFile,'utf8')),source);
  const target=path.join(path.resolve(outputRoot),manifest.id);
  if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true});
  copyDirectory(source,target);
  fs.writeFileSync(path.join(target,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`,'utf8');
  return {directory:target,manifest};
}

export function stageAllBuiltinPluginPackages(pluginsRoot,outputRoot){
  const packages=[];
  for(const entry of fs.readdirSync(pluginsRoot,{withFileTypes:true}).filter((item)=>item.isDirectory()&&!item.name.startsWith('_')).sort((a,b)=>a.name.localeCompare(b.name))){
    const directory=path.join(pluginsRoot,entry.name);
    if(fs.existsSync(path.join(directory,'manifest.json')))packages.push(stageBuiltinPluginPackage(directory,outputRoot));
  }
  return packages;
}
