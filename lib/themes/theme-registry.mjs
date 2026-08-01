import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadThemeDirectory } from './theme-loader.mjs';

const moduleRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).filter((key)=>!key.startsWith('_')).sort().map((key)=>[key,canonical(value[key])]));return value;}
export function normalizedThemeJson(theme){return JSON.stringify(canonical(theme));}
export function themeHash(theme){return `sha256:${crypto.createHash('sha256').update(normalizedThemeJson(theme)).digest('hex')}`;}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}

export function createThemeRegistry({builtinRoot=path.join(moduleRoot,'themes')}={}){
  const loaded=loadThemeDirectory(builtinRoot,{source:'builtin'});const byId=new Map();
  for(const raw of loaded){if(byId.has(raw.id))throw new Error(`主题 ID 重复：${raw.id}`);const {_file,...definition}=raw;const theme=freeze({...definition,hash:themeHash(definition),file:_file});byId.set(theme.id,theme);}
  return Object.freeze({
    list({target,status='published'}={}){return [...byId.values()].filter((theme)=>(!target||theme.targets.includes(target))&&(!status||theme.status===status));},
    get(id){return byId.get(id)||null;},
    require(id){const theme=byId.get(id);if(!theme)throw new Error(`未知主题：${id}`);return theme;},
    has(id){return byId.has(id);},
  });
}

let builtinRegistry;
export function getBuiltinThemeRegistry(){if(!builtinRegistry)builtinRegistry=createThemeRegistry();return builtinRegistry;}
