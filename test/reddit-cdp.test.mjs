import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cdpCandidates } from '../plugins/reddit/collector.mjs';
import { ensureRedditBrowser, releaseRedditBrowser, redditBrowserOptions } from '../plugins/reddit/browser-lifecycle.mjs';

test('Reddit CDP loopback fallback includes localhost for modern Chrome Host validation', () => {
  assert.deepEqual(cdpCandidates('http://127.0.0.1:9222'), [
    'http://127.0.0.1:9222',
    'http://localhost:9222',
    'http://[::1]:9222',
  ]);
});

test('Reddit Chrome launcher waits for IPv4 CDP readiness without PowerShell localhost timeout', () => {
  const script = fs.readFileSync(new URL('../plugins/reddit/scripts/start-chrome.ps1', import.meta.url), 'utf8');
  assert.match(script, /http:\/\/127\.0\.0\.1:\$Port\/json\/version/);
  assert.match(script, /--user-data-dir=`"\$profilePath`"/);
  assert.match(script, /ProcessStartInfo/);
  assert.match(script, /Arguments = "--remote-debugging-port=\$Port/);
  assert.match(script, /CDP did not become ready/);
  assert.doesNotMatch(script, /Start-Process "https:\/\/old\.reddit\.com/);
});

test('手动启动和批次采集默认使用同一个 Reddit Profile', () => {
  const script = fs.readFileSync(new URL('../plugins/reddit/scripts/start-chrome.ps1', import.meta.url), 'utf8');
  const options = redditBrowserOptions({ cdpUrl: 'http://localhost:9333',workspaceRoot:path.resolve('.') });
  assert.match(script, /data\\plugin-runtime\\reddit-collector\\profiles\\default/);
  assert.match(options.profilePath, /data[\\/]plugin-runtime[\\/]reddit-collector[\\/]profiles[\\/]default$/);
});

test('首次启动把旧 Reddit Profile 原子迁移到插件运行数据目录',async(t)=>{
  const workspaceRoot=fs.mkdtempSync(path.join(os.tmpdir(),'reddit-profile-migrate-'));t.after(()=>fs.rmSync(workspaceRoot,{recursive:true,force:true}));
  const legacyProfileRoot=path.join(workspaceRoot,'legacy-profiles');
  const configuration={cdpUrl:'http://localhost:9333',workspaceRoot,legacyProfileRoot};
  const options=redditBrowserOptions(configuration);
  fs.mkdirSync(options.legacyProfilePath,{recursive:true});fs.writeFileSync(path.join(options.legacyProfilePath,'marker.txt'),'login-cache');
  let ready=false;
  await ensureRedditBrowser(configuration,{fetchImpl:async()=>ready?new Response(JSON.stringify({webSocketDebuggerUrl:'ws://ready'})):Promise.reject(new Error('offline')),execImpl:async()=>{ready=true;return {stdout:'',stderr:''};}});
  assert.equal(fs.readFileSync(path.join(options.profilePath,'marker.txt'),'utf8'),'login-cache');
  assert.equal(fs.existsSync(options.legacyProfilePath),false);
});

test('Reddit Chrome stopper falls back to the dedicated listening port when CIM is unavailable', () => {
  const script = fs.readFileSync(new URL('../plugins/reddit/scripts/stop-chrome.ps1', import.meta.url), 'utf8');
  assert.match(script, /netstat -ano/);
  assert.match(script, /ProcessName -eq 'chrome'/);
  assert.match(script, /chromeProcess\.ProcessId/);
  assert.match(script, /Stop-Process[^\n]+-ErrorAction Stop/);
  assert.match(script, /did not release CDP port/);
});

test('已有手动 Chrome 只复用不关闭',async()=>{
  let executions=0;
  const fetchImpl=async()=>new Response(JSON.stringify({webSocketDebuggerUrl:'ws://ready'}));
  const session=await ensureRedditBrowser({cdpUrl:'http://localhost:9333',browserLifecycle:'automatic'},{fetchImpl,execImpl:async()=>{executions+=1;}});
  assert.equal(session.owned,false);
  assert.equal(await releaseRedditBrowser(session,{execImpl:async()=>{executions+=1;}}),false);
  assert.equal(executions,0);
});

test('automatic 模式仅关闭本次自动启动的 Chrome',async()=>{
  let ready=false;const scripts=[];
  const fetchImpl=async()=>ready?new Response(JSON.stringify({webSocketDebuggerUrl:'ws://ready'})):Promise.reject(new Error('offline'));
  const execImpl=async(_command,args)=>{scripts.push(args.find((item)=>String(item).endsWith('.ps1')));ready=true;return {stdout:'',stderr:''};};
  const session=await ensureRedditBrowser({cdpUrl:'http://localhost:9333',browserLifecycle:'automatic',profileId:'test'},{fetchImpl,execImpl});
  assert.equal(session.owned,true);
  await releaseRedditBrowser(session,{execImpl});
  assert.match(scripts[0],/start-chrome\.ps1$/);
  assert.match(scripts[1],/stop-chrome\.ps1$/);
});

test('persistent 模式自动启动后保持运行',async()=>{
  let ready=false,executions=0;
  const session=await ensureRedditBrowser({cdpUrl:'http://localhost:9333',browserLifecycle:'persistent'},{fetchImpl:async()=>ready?new Response(JSON.stringify({webSocketDebuggerUrl:'ws://ready'})):Promise.reject(new Error('offline')),execImpl:async()=>{executions+=1;ready=true;return {stdout:'',stderr:''};}});
  assert.equal(session.owned,true);
  assert.equal(await releaseRedditBrowser(session,{execImpl:async()=>{executions+=1;}}),false);
  assert.equal(executions,1);
});
