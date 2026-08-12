import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cdpCandidates } from '../plugins/collectors/reddit/collector.mjs';
import { ensureRedditBrowser, releaseRedditBrowser } from '../plugins/collectors/reddit/browser-lifecycle.mjs';

test('Reddit CDP loopback fallback includes localhost for modern Chrome Host validation', () => {
  assert.deepEqual(cdpCandidates('http://127.0.0.1:9222'), [
    'http://127.0.0.1:9222',
    'http://localhost:9222',
    'http://[::1]:9222',
  ]);
});

test('Reddit Chrome launcher waits for IPv4 CDP readiness without PowerShell localhost timeout', () => {
  const script = fs.readFileSync(new URL('../plugins/collectors/reddit/scripts/start-chrome.ps1', import.meta.url), 'utf8');
  assert.match(script, /http:\/\/127\.0\.0\.1:\$Port\/json\/version/);
  assert.match(script, /--user-data-dir=`"\$profilePath`"/);
  assert.match(script, /ProcessStartInfo/);
  assert.match(script, /Arguments = "--remote-debugging-port=\$Port/);
  assert.match(script, /CDP did not become ready/);
  assert.doesNotMatch(script, /Start-Process "https:\/\/old\.reddit\.com/);
});

test('Reddit Chrome stopper falls back to the dedicated listening port when CIM is unavailable', () => {
  const script = fs.readFileSync(new URL('../plugins/collectors/reddit/scripts/stop-chrome.ps1', import.meta.url), 'utf8');
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
