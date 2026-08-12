import crypto from 'node:crypto';
import { schemaDefaults, secretFields, validateConfigurationValue } from './configuration-schema.mjs';
import { setCredentialFields } from '../tools/remote-credentials.mjs';

const digest=(value)=>`sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
function profile(type,id,manifest){return manifest.credentialProfile||manifest.configurationCredentialProfile||`${type}-${id}`;}

export function planLegacyConfigurationMigration({resources,repository,fallbackFor}) {
  return resources.map((resource)=>{
    const existing=repository.get(resource.type,resource.id);
    const fallback=fallbackFor(resource)||{};const schema=resource.manifest.configuration;
    const allowed=new Set(Object.keys(schema?.properties||{}));
    const values=Object.fromEntries(Object.entries(fallback).filter(([key,value])=>allowed.has(key)&&value!==undefined&&value!==null&&value!==''));
    const secrets=new Set(secretFields(schema));const secretValues=Object.fromEntries(Object.entries(values).filter(([key])=>secrets.has(key)));
    const ordinaryValues=Object.fromEntries(Object.entries(values).filter(([key])=>!secrets.has(key)));
    const complete={...schemaDefaults(schema),...ordinaryValues,...secretValues};const issues=validateConfigurationValue(schema,complete);
    return {resource,action:existing?'skip':'migrate',ordinaryValues,secretValues,configured:issues.length===0,issues,
      fields:Object.keys(ordinaryValues),secretFields:Object.keys(secretValues)};
  });
}

export function applyLegacyConfigurationMigration({root,repository,plan}) {
  const results=[];
  for(const item of plan){const {resource}=item;if(item.action==='skip'){results.push({type:resource.type,id:resource.id,status:'skipped_existing'});continue;}
    if(Object.keys(item.secretValues).length)setCredentialFields(root,resource.id,profile(resource.type,resource.id,resource.manifest),item.secretValues);
    repository.save({extensionType:resource.type,extensionId:resource.id,value:{...schemaDefaults(resource.manifest.configuration),...item.ordinaryValues},configured:item.configured,status:item.configured?'ready':'needs_configuration',configHash:digest({...item.ordinaryValues,...Object.keys(item.secretValues).sort()})});
    results.push({type:resource.type,id:resource.id,status:'migrated',configured:item.configured,fields:item.fields,secretFields:item.secretFields,issues:item.issues});
  }return results;
}
