import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from '../core/atomic-file.mjs';

const fileFor=(root)=>path.join(root,'data','capability-routes.json');
const legacyFileFor=(root)=>path.join(root,'data','information-capability-slots.json');
const LEGACY_SLOTS={'web-page':'content.url.fetch','web-search':'content.web.search','news-search':'content.news.search',repository:'content.repository.inspect',document:'content.document.search','local-project':'filesystem.project.read'};
function atomic(file,value){atomicWriteJson(file,value);}
export function readCapabilityRoutes(root){const file=fileFor(root);if(!fs.existsSync(file))return {schemaVersion:1,routes:{}};let value;try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){console.warn(`统一能力路由配置文件损坏，回退为空配置: ${file} (${error.message})`);return {schemaVersion:1,routes:{}};}if(value.schemaVersion!==1||!value.routes)throw new Error('统一能力路由配置无效');return value;}
export function preferredImplementation(root,capability){return readCapabilityRoutes(root).routes[capability]?.preferredImplementationId||'';}
export function setCapabilityRoute(root,capability,input={}){const value=readCapabilityRoutes(root);if(input.preferredImplementationId)value.routes[capability]={preferredImplementationId:String(input.preferredImplementationId),updatedAt:new Date().toISOString()};else delete value.routes[capability];atomic(fileFor(root),value);return {capability,...(value.routes[capability]||{preferredImplementationId:''})};}
export function migrateLegacyCapabilityRoutes(root){const legacy=legacyFileFor(root),value=readCapabilityRoutes(root),migrated=[];if(fs.existsSync(legacy)){const old=JSON.parse(fs.readFileSync(legacy,'utf8'));for(const [slotId,pluginId] of Object.entries(old||{})){const capability=LEGACY_SLOTS[slotId]||slotId;if(!pluginId||value.routes[capability])continue;value.routes[capability]={preferredImplementationId:String(pluginId),migratedFrom:`information-capability-slots:${slotId}`,updatedAt:new Date().toISOString()};migrated.push({slotId,capability,pluginId});}}atomic(fileFor(root),value);return {migrated,total:Object.keys(value.routes).length,legacyFileExists:fs.existsSync(legacy)};}
