import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from '../core/env.mjs';
import { atomicWriteJson, atomicWriteUtf8 } from '../core/atomic-file.mjs';

function envPath(root){return path.join(root,'.env.remote-plugins');}
function metadataPath(root){return path.join(root,'data','credential-profiles.json');}
function keyFor(profile,field='token'){return `EXTENSION_${crypto.createHash('sha256').update(`${profile}:${field}`).digest('hex').slice(0,20).toUpperCase()}`;}

function writeEnv(root,values){
  const filePath=envPath(root);
  const lines=Object.entries(values).filter(([,value])=>value).map(([key,value])=>`${key}=${JSON.stringify(String(value))}`);
  atomicWriteUtf8(filePath,`${lines.join('\n')}${lines.length?'\n':''}`);
}

function readMetadata(root){
  if(!fs.existsSync(metadataPath(root)))return {schemaVersion:1,profiles:{}};
  const value=JSON.parse(fs.readFileSync(metadataPath(root),'utf8'));
  if(value.schemaVersion!==1||!value.profiles)throw new Error('远程凭据目录无效');
  return value;
}

function writeMetadata(root,value){
  atomicWriteJson(metadataPath(root),value);
}

export function setRemoteCredential(root,pluginId,profile,token){
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile)||!token?.trim())throw new Error('凭据配置无效');
  const current=fs.existsSync(envPath(root))?parseEnv(fs.readFileSync(envPath(root),'utf8')):{};
  current[keyFor(profile)]=token.trim();writeEnv(root,current);
  const metadata=readMetadata(root);
  metadata.profiles[profile]={pluginId,configured:true,updatedAt:new Date().toISOString()};
  writeMetadata(root,metadata);
  return {profile,pluginId,configured:true,updatedAt:metadata.profiles[profile].updatedAt};
}

export function clearRemoteCredential(root,pluginId,profile){
  const current=fs.existsSync(envPath(root))?parseEnv(fs.readFileSync(envPath(root),'utf8')):{};
  delete current[keyFor(profile)];writeEnv(root,current);
  const metadata=readMetadata(root);delete metadata.profiles[profile];writeMetadata(root,metadata);
  return {profile,pluginId,configured:false};
}

export function getRemoteCredential(root,profile){
  if(!profile)return '';
  const values=fs.existsSync(envPath(root))?parseEnv(fs.readFileSync(envPath(root),'utf8')):{};
  return values[keyFor(profile)]||'';
}

export function credentialStatus(root,profile){
  const item=readMetadata(root).profiles[profile];
  return {profile,configured:Boolean(item?.configured),updatedAt:item?.updatedAt||''};
}

export function setCredentialFields(root,pluginId,profile,fields){
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile))throw new Error('凭据 Profile 无效');
  const current=fs.existsSync(envPath(root))?parseEnv(fs.readFileSync(envPath(root),'utf8')):{};
  const metadata=readMetadata(root);const configuredFields={...(metadata.profiles[profile]?.fields||{})};
  for(const [field,value] of Object.entries(fields||{})){
    if(!/^[A-Za-z][A-Za-z0-9_-]*$/.test(field)||!String(value||'').trim())throw new Error(`凭据字段无效：${field}`);
    current[keyFor(profile,field)]=String(value).trim();configuredFields[field]=true;
  }
  writeEnv(root,current);const updatedAt=new Date().toISOString();
  metadata.profiles[profile]={pluginId,configured:Object.keys(configuredFields).length>0,fields:configuredFields,updatedAt};writeMetadata(root,metadata);
  return credentialFieldsStatus(root,profile,Object.keys(configuredFields));
}

export function getCredentialFields(root,profile,fields=[]){
  const values=fs.existsSync(envPath(root))?parseEnv(fs.readFileSync(envPath(root),'utf8')):{};
  return Object.fromEntries(fields.flatMap((field)=>{
    const value=values[keyFor(profile,field)];return value?[[field,value]]:[];
  }));
}

export function credentialFieldsStatus(root,profile,fields=[]){
  const values=getCredentialFields(root,profile,fields);const metadata=readMetadata(root).profiles[profile];
  return {profile,configured:fields.every((field)=>Boolean(values[field])),updatedAt:metadata?.updatedAt||'',
    fields:Object.fromEntries(fields.map((field)=>[field,{configured:Boolean(values[field])}]))};
}

export function credentialProfileReference(root,profile,fields=[]){
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile))throw new Error('凭据 Profile 无效');
  const status=credentialFieldsStatus(root,profile,fields);
  return {profile,configured:status.configured,updatedAt:status.updatedAt,fields:status.fields};
}
