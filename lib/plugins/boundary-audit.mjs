import fs from 'node:fs';
import path from 'node:path';

const CODE_EXTENSIONS=new Set(['.mjs','.js','.cjs']);
const IMPORT_PATTERN=/(?:from\s*|import\s*\(|^\s*import\s*)\s*['"]([^'"]+)['"]/gm;
const PATH_PATTERNS=[
  {type:'project-script',pattern:/path\.(?:join|resolve)\([^;\r\n]*?['"]scripts['"][^;\r\n]*?\)/g},
  {type:'project-skill',pattern:/path\.(?:join|resolve)\([^;\r\n]*?['"]skills['"][^;\r\n]*?\)/g},
  {type:'user-runtime',pattern:/(?:process\.env\.USERPROFILE|\.codex[\\/]skills)/gi},
];

function slash(value){return value.replaceAll('\\','/');}
function walk(directory){if(!fs.existsSync(directory))return [];return fs.readdirSync(directory,{withFileTypes:true}).flatMap((entry)=>{if(entry.name==='data'||entry.name==='node_modules')return [];const target=path.join(directory,entry.name);return entry.isDirectory()?walk(target):entry.isFile()&&CODE_EXTENSIONS.has(path.extname(entry.name))?[target]:[];});}
function pluginOwner(pluginsRoot,file){const relative=path.relative(pluginsRoot,file);return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)?relative.split(path.sep)[0]:'';}
function issueId(type,plugin,file,target){return `${type}:${plugin}:${slash(file)}:${slash(target)}`;}

export function scanPluginPackageBoundaryIssues(directory,{runtimeDependencies=[]}={}){
  const root=path.resolve(directory),issues=[];
  const allowedDependencies=new Set(runtimeDependencies);
  for(const file of walk(root)){
    const source=fs.readFileSync(file,'utf8'),relative=slash(path.relative(root,file));
    for(const match of source.matchAll(IMPORT_PATTERN)){
      const specifier=match[1];if(specifier.startsWith('node:'))continue;
      if(!specifier.startsWith('.')){const packageName=specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];if(!allowedDependencies.has(packageName))issues.push(`${relative}: 未审计包依赖 ${specifier}`);continue;}
      const resolved=path.resolve(path.dirname(file),specifier),inside=resolved===root||resolved.startsWith(`${root}${path.sep}`);
      if(!inside)issues.push(`${relative}: import 超出插件包 ${specifier}`);
    }
    if(/(?:process\.env\.USERPROFILE|\.codex[\\/]skills)/i.test(source))issues.push(`${relative}: 禁止依赖用户目录或 Codex Skill`);
    for(const match of source.matchAll(/path\.(?:join|resolve)\([^;\r\n]*?['"](?:skills|scripts)['"][^;\r\n]*?\)/g)){
      const evidence=match[0].replace(/\s+/g,' ');
      if(evidence.includes("pluginRoot,'scripts'")||evidence.includes('pluginRoot,\'scripts\''))continue;
      issues.push(`${relative}: 禁止引用项目 skills/scripts ${evidence.slice(0,120)}`);
    }
  }
  return [...new Set(issues)].sort();
}

export function scanPluginBoundaries(root){
  const pluginsRoot=path.resolve(root,'plugins'),issues=[];
  for(const file of walk(pluginsRoot)){
    const plugin=pluginOwner(pluginsRoot,file),source=fs.readFileSync(file,'utf8'),relative=slash(path.relative(root,file));
    for(const match of source.matchAll(IMPORT_PATTERN)){
      const specifier=match[1];if(specifier.startsWith('node:')||!specifier.startsWith('.'))continue;
      const resolved=path.resolve(path.dirname(file),specifier),targetPlugin=pluginOwner(pluginsRoot,resolved);
      if(targetPlugin&&targetPlugin!==plugin){const type=targetPlugin==='shared'?'shared-source':'cross-plugin';issues.push({id:issueId(type,plugin,relative,targetPlugin),type,plugin,file:relative,target:targetPlugin,evidence:specifier});continue;}
      if(!targetPlugin){const target=slash(path.relative(root,resolved));issues.push({id:issueId('project-source',plugin,relative,target),type:'project-source',plugin,file:relative,target,evidence:specifier});}
    }
    for(const {type,pattern} of PATH_PATTERNS)for(const match of source.matchAll(pattern)){
      const evidence=match[0].replace(/\s+/g,' ').slice(0,180);
      if(type==='project-script'&&(evidence.includes("pluginRoot,'scripts'")||evidence.includes('pluginRoot,\'scripts\'')||evidence.includes("'skills'")||evidence.includes("\"skills\"")))continue;
      issues.push({id:issueId(type,plugin,relative,evidence),type,plugin,file:relative,target:evidence,evidence});
    }
  }
  return [...new Map(issues.map((item)=>[item.id,item])).values()].sort((a,b)=>a.id.localeCompare(b.id));
}

export function readPluginBoundaryBaseline(root){const file=path.join(root,'docs','plugin-boundary-baseline.json'),value=JSON.parse(fs.readFileSync(file,'utf8'));if(value.schemaVersion!==1||!Array.isArray(value.violations))throw new Error('plugin-boundary-baseline.json 格式无效');return value;}

export function auditPluginBoundaries(root){
  const actual=scanPluginBoundaries(root),baseline=readPluginBoundaryBaseline(root),known=new Map(baseline.violations.map((item)=>[item.id,item]));
  const newViolations=actual.filter((item)=>!known.has(item.id));
  const resolved=baseline.violations.filter((item)=>!actual.some((current)=>current.id===item.id));
  const invalidBaseline=baseline.violations.filter((item)=>!item.phase||!item.owner||!item.resolution);
  return {actual,baseline,newViolations,resolved,invalidBaseline,pass:newViolations.length===0&&invalidBaseline.length===0};
}
