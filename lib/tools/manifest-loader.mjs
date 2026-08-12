import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateConfigurationSchema } from '../extensions/configuration-schema.mjs';
import { validatePluginManifestBase } from '../../plugins/shared/manifest-contract.mjs';

const REQUIRED = ['id', 'name', 'version', 'capabilities', 'entry', 'riskLevel', 'inputSchema', 'outputSchema'];
const RISK_LEVELS = new Set(['read-only','local-write','network-read','external-write']);

function inside(candidate, root) {
  const relative=path.relative(root,candidate);
  return relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative));
}

function freeze(value) {
  if(value&&typeof value==='object'){
    for(const child of Object.values(value))freeze(child);
    Object.freeze(value);
  }
  return value;
}

export async function loadPluginManifests({ pluginsRoot, allowlist = [] }) {
  const root = path.resolve(pluginsRoot);
  const plugins = [];
  for (const id of allowlist) {
    const directory = path.resolve(root, id);
    if (path.dirname(directory) !== root) throw new Error(`非法插件目录：${id}`);
    const manifestPath = path.join(directory, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`插件 ${id} 缺少 manifest.json`);
    const rawManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const manifest = {
      type:'local-adapter',
      compatibleApp:'>=0.1.0',
      source:{type:'builtin',url:''},
      permissions:{
        networkDomains:[],
        pathAccess:rawManifest.pathInputs||[],
        externalWrite:rawManifest.riskLevel==='external-write',
        credentials:[],
      },
      ...rawManifest,
    };
    const baseIssues=validatePluginManifestBase(manifest);
    if(baseIssues.length||manifest.kind!=='tool')throw new Error(`插件 ${id} manifest 基础结构无效：${baseIssues[0]?.field||'kind'}`);
    const missing = REQUIRED.filter((key) => manifest[key] === undefined);
    if (missing.length) throw new Error(`插件 ${id} manifest 缺少字段：${missing.join(', ')}`);
    if (manifest.id !== id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)
      || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)
      || !Array.isArray(manifest.capabilities) || !manifest.capabilities.length
      || manifest.capabilities.some((item)=>typeof item!=='string'||!item.trim())
      || new Set(manifest.capabilities).size!==manifest.capabilities.length
      || !RISK_LEVELS.has(manifest.riskLevel)
      || manifest.inputSchema?.type!=='object' || manifest.outputSchema?.type!=='object') {
      throw new Error(`插件 ${id} manifest 无效`);
    }
    if((manifest.pathInputs||[]).some((field)=>manifest.inputSchema.properties?.[field]?.type!=='string')){
      throw new Error(`插件 ${id} pathInputs 必须引用字符串输入字段`);
    }
    const configurationIssues=manifest.configuration?validateConfigurationSchema(manifest.configuration):[];
    if(configurationIssues.length)throw new Error(`插件 ${id} configuration 无效：${configurationIssues[0].message}`);
    const entry = path.resolve(directory, manifest.entry);
    if (!inside(entry,directory)) throw new Error(`插件 ${id} entry 超出插件目录`);
    const adapter=await import(pathToFileURL(entry).href);
    if(typeof adapter.execute!=='function')throw new Error(`插件 ${id} adapter 缺少 execute`);
    plugins.push({ manifest:freeze(manifest), adapter });
  }
  return plugins;
}
