import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseEnv } from '../lib/core/env.mjs';

const root=process.cwd();
const inventory=JSON.parse(fs.readFileSync(path.join(root,'test','fixtures','configuration-migration-inventory.json'),'utf8'));
const readJson=(file)=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
const readEnv=(file)=>fs.existsSync(file)?parseEnv(fs.readFileSync(file,'utf8')):{};
const get=(value,key)=>key.split('.').reduce((current,part)=>current?.[part],value);
const digest=(value)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const localConfig=readJson(path.join(root,'config.local.json'));
const appEnv=readEnv(path.join(root,'.env'));
const example=readJson(path.join(root,'config.example.json'));
const rsshubRoot=get(localConfig,'rsshub.rootDir')||get(example,'rsshub.rootDir')||'RSSHub';
const rsshubEnv=readEnv(path.resolve(root,rsshubRoot,'.env'));

function valuesFor(entry){
  if(entry.source==='env')return [{path:entry.path,value:appEnv[entry.path]}];
  if(entry.source==='rsshub-env')return Object.entries(rsshubEnv).map(([key,value])=>({path:key,value}));
  if(!entry.path.includes('*'))return [{path:entry.path,value:get(localConfig,entry.path)}];
  const pattern=new RegExp(`^${entry.path.split('.').map((part)=>part==='*'?'[^.]+':part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\.')}$`);
  const flatten=(value,prefix='',into=[])=>{if(value&&typeof value==='object'&&!Array.isArray(value)){for(const [key,item] of Object.entries(value))flatten(item,prefix?`${prefix}.${key}`:key,into);}else into.push({path:prefix,value});return into;};
  return flatten(localConfig).filter((item)=>pattern.test(item.path));
}

const entries=[];
for(const item of inventory.entries)for(const found of valuesFor(item))entries.push({source:item.source,path:found.path,target:item.target,secret:item.secret,configured:found.value!==undefined&&found.value!==null&&found.value!=='',...(item.secret?{}:{value:found.value??null}),...(found.value===undefined?{}:{valueHash:digest(found.value)})});
const snapshot={schemaVersion:1,createdAt:new Date().toISOString(),inventoryVersion:inventory.schemaVersion,workspace:path.basename(root),sources:{env:fs.existsSync(path.join(root,'.env')),config:fs.existsSync(path.join(root,'config.local.json')),rsshubEnv:Object.keys(rsshubEnv).length>0},entries};
const output=path.join(root,'data','configuration-migration-baseline.json');
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,`${JSON.stringify(snapshot,null,2)}\n`,'utf8');
console.log(`配置迁移脱敏基线已写入 ${path.relative(root,output)}（${entries.length} 项，秘密仅记录配置状态和摘要）`);
