import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync=promisify(execFile);
const pluginRoot=import.meta.dirname;

function migrateLegacyProfile(legacyPath,targetPath){
  if(fs.existsSync(targetPath)||!fs.existsSync(legacyPath))return false;
  fs.mkdirSync(path.dirname(targetPath),{recursive:true});
  fs.renameSync(legacyPath,targetPath);
  return true;
}

export function redditBrowserOptions(configuration={}){
  const cdp=new URL(configuration.cdpUrl||'http://localhost:9333');
  if(!['localhost','127.0.0.1','[::1]','::1'].includes(cdp.hostname))return {managed:false,cdpUrl:cdp.href.replace(/\/$/,'')};
  const port=Number(cdp.port||9222);
  const profileId=String(configuration.profileId||'default').replace(/[^a-z0-9-]/gi,'-').toLowerCase();
  const profileDirectory=profileId==='default'?'default':profileId;
  const workspaceRoot=path.resolve(configuration.workspaceRoot||path.join(pluginRoot,'..','..'));
  const profilePath=path.join(workspaceRoot,'data','plugin-runtime','reddit-collector','profiles',profileDirectory);
  const legacyDirectory=profileId==='default'?'reddit-chrome-profile':`profile-${profileId}`;
  const legacyProfilePath=path.join(path.resolve(configuration.legacyProfileRoot||path.join(pluginRoot,'data')),legacyDirectory);
  return {managed:configuration.browserLifecycle!=='external',mode:configuration.browserLifecycle||'automatic',port,cdpUrl:`http://127.0.0.1:${port}`,profilePath,legacyProfilePath};
}

async function cdpReady(cdpUrl,fetchImpl=fetch){
  try{const response=await fetchImpl(`${cdpUrl}/json/version`,{signal:AbortSignal.timeout(1500)});const data=response.ok?await response.json():null;return Boolean(data?.webSocketDebuggerUrl);}catch{return false;}
}

async function runScript(name,options,execImpl=execFileAsync){
  const script=path.join(pluginRoot,'scripts',name),args=['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-Port',String(options.port),'-ProfilePath',options.profilePath];
  return execImpl('powershell.exe',args,{cwd:pluginRoot,windowsHide:true,timeout:30000,maxBuffer:1000000});
}

export async function ensureRedditBrowser(configuration={},dependencies={}){
  const options=redditBrowserOptions(configuration),fetchImpl=dependencies.fetchImpl||fetch;
  if(await cdpReady(options.cdpUrl,fetchImpl))return {...options,owned:false};
  if(!options.managed)throw new Error('Reddit 专用 Chrome 未运行，当前配置为外部管理模式');
  migrateLegacyProfile(options.legacyProfilePath,options.profilePath);
  fs.mkdirSync(options.profilePath,{recursive:true});
  await runScript('start-chrome.ps1',options,dependencies.execImpl);
  if(!await cdpReady(options.cdpUrl,fetchImpl))throw new Error('Reddit Chrome 已启动但 CDP 未就绪');
  return {...options,owned:true};
}

export async function releaseRedditBrowser(session,dependencies={}){
  if(!session?.owned||session.mode!=='automatic')return false;
  if(Number(dependencies.closeDelayMs||0)>0)await new Promise((resolve)=>setTimeout(resolve,Number(dependencies.closeDelayMs)));
  await runScript('stop-chrome.ps1',session,dependencies.execImpl);
  return true;
}
