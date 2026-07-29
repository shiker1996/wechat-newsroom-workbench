import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from '../core/env.mjs';

function envPath(root){return path.join(root,'.env.remote-plugins');}
function metadataPath(root){return path.join(root,'data','credential-profiles.json');}
function keyFor(profile){return `REMOTE_PLUGIN_${crypto.createHash('sha256').update(profile).digest('hex').slice(0,16).toUpperCase()}_TOKEN`;}

function writeEnv(root,values){
  const filePath=envPath(root);
  const lines=Object.entries(values).filter(([,value])=>value).map(([key,value])=>`${key}=${JSON.stringify(String(value))}`);
  fs.writeFileSync(filePath,`${lines.join('\n')}${lines.length?'\n':''}`,'utf8');
}

function readMetadata(root){
  if(!fs.existsSync(metadataPath(root)))return {schemaVersion:1,profiles:{}};
  const value=JSON.parse(fs.readFileSync(metadataPath(root),'utf8'));
  if(value.schemaVersion!==1||!value.profiles)throw new Error('远程凭据目录无效');
  return value;
}

function writeMetadata(root,value){
  const filePath=metadataPath(root);fs.mkdirSync(path.dirname(filePath),{recursive:true});
  const temporary=`${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`,'utf8');fs.renameSync(temporary,filePath);
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
