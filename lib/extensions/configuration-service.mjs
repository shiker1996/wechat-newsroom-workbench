import crypto from 'node:crypto';
import { schemaDefaults, secretFields, validateConfigurationSchema, validateConfigurationValue } from './configuration-schema.mjs';
import { credentialFieldsStatus, getCredentialFields, setCredentialFields } from '../tools/remote-credentials.mjs';

function hash(value) { return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
function credentialProfile(extensionType,extensionId,manifest){const profile=manifest.credentialProfile||manifest.configurationCredentialProfile||`${extensionType}-${extensionId}`;if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile))throw new Error('扩展凭据 Profile 无效');return profile;}
function declaredFallback(schema,fallbackValues){const fields=new Set(Object.keys(schema?.properties||{}));return Object.fromEntries(Object.entries(fallbackValues||{}).filter(([field])=>fields.has(field)));}
function publicValues(schema,value,credentialStatus) {
  const secrets=new Set(secretFields(schema));
  return Object.fromEntries(Object.entries(value||{}).filter(([key])=>!secrets.has(key)).concat(
    [...secrets].map((key)=>[key,credentialStatus.fields[key]?.configured?'__configured__':''])));
}

export class ExtensionConfigurationService {
  constructor({root,repository}) { this.root=root;this.repository=repository; }
  describe({extensionType,extensionId,manifest,fallbackValues={}}) {
    const schema=manifest.configuration || null;
    if (!schema) return {extensionType,extensionId,schema:null,configured:true,status:'ready',values:{},credentialStatus:{fields:{}}};
    fallbackValues=declaredFallback(schema,fallbackValues);
    const schemaIssues=validateConfigurationSchema(schema);
    if (schemaIssues.length) return {extensionType,extensionId,schema,configured:false,status:'invalid_schema',issues:schemaIssues,values:{},credentialStatus:{fields:{}}};
    const stored=this.repository.get(extensionType,extensionId);
    const storedValue=declaredFallback(schema,stored?.value||{});
    const profile=credentialProfile(extensionType,extensionId,manifest);
    const credentialStatus=credentialFieldsStatus(this.root,profile,secretFields(schema));
    for(const field of secretFields(schema))if(fallbackValues[field]&&!credentialStatus.fields[field]?.configured)credentialStatus.fields[field]={configured:true,source:'legacy_fallback'};
    credentialStatus.configured=secretFields(schema).every((field)=>credentialStatus.fields[field]?.configured);
    const values={...schemaDefaults(schema),...fallbackValues,...storedValue,...getCredentialFields(this.root,profile,secretFields(schema))};
    const issues=validateConfigurationValue(schema,values);
    const configured=!issues.length;
    const storedFields=new Set(Object.keys(storedValue));
    const credentialValues=getCredentialFields(this.root,profile,secretFields(schema));
    const credentialFields=new Set(Object.keys(credentialValues));
    const legacyFallbackFields=stored?[]:Object.keys(fallbackValues).filter((field)=>!storedFields.has(field)&&!credentialFields.has(field));
    return {extensionType,extensionId,schema,configured,status:configured?'ready':'needs_configuration',issues,
      values:publicValues(schema,values,credentialStatus),credentialStatus,updatedAt:stored?.updated_at||'',
      source:stored||credentialFields.size?'unified':legacyFallbackFields.length?'legacy_fallback':'defaults',legacyFallbackFields};
  }
  save({extensionType,extensionId,manifest,input,fallbackValues={}}) {
    const schema=manifest.configuration;
    fallbackValues=declaredFallback(schema,fallbackValues);
    if (!schema) throw new Error('该扩展未声明动态配置');
    const schemaIssues=validateConfigurationSchema(schema); if(schemaIssues.length)throw new Error(schemaIssues[0].message);
    const current=this.describe({extensionType,extensionId,manifest,fallbackValues});
    const secrets=new Set(secretFields(schema)); const profile=credentialProfile(extensionType,extensionId,manifest);
    const values={...schemaDefaults(schema),...Object.fromEntries(Object.entries(input||{}).filter(([key])=>!secrets.has(key)))};
    const secretInput=Object.fromEntries([...secrets].filter((key)=>input?.[key]&&input[key]!=='__configured__').map((key)=>[key,String(input[key])]));
    const existing=getCredentialFields(this.root,profile,[...secrets]);
    const complete={...values,...Object.fromEntries([...secrets].flatMap((key)=>fallbackValues[key]?[[key,fallbackValues[key]]]:[])),...existing,...secretInput}; const issues=validateConfigurationValue(schema,complete);
    if(issues.length){const error=new Error('扩展配置校验失败');error.issues=issues;throw error;}
    if(Object.keys(secretInput).length)setCredentialFields(this.root,extensionId,profile,secretInput);
    const record=this.repository.save({extensionType,extensionId,value:values,configured:true,status:'ready',configHash:hash(complete)});
    return {...this.describe({extensionType,extensionId,manifest,fallbackValues}),updatedAt:record.updated_at};
  }
  snapshot({extensionType,extensionId,manifest,fallbackValues={}}) {
    const state=this.describe({extensionType,extensionId,manifest,fallbackValues});
    return {extensionType,extensionId,status:state.status,configured:state.configured,updatedAt:state.updatedAt||'',schemaVersion:1};
  }
  resolve({extensionType,extensionId,manifest,fallbackValues={}}) {
    fallbackValues=declaredFallback(manifest.configuration,fallbackValues);
    const state=this.describe({extensionType,extensionId,manifest,fallbackValues});
    if(!state.configured)return {...state,values:{},snapshot:this.snapshot({extensionType,extensionId,manifest,fallbackValues})};
    const profile=credentialProfile(extensionType,extensionId,manifest);const stored=this.repository.get(extensionType,extensionId);
    return {...state,values:{...schemaDefaults(manifest.configuration),...fallbackValues,...declaredFallback(manifest.configuration,stored?.value||{}),...getCredentialFields(this.root,profile,secretFields(manifest.configuration))},
      snapshot:this.snapshot({extensionType,extensionId,manifest,fallbackValues})};
  }
}
