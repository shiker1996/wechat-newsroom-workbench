import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requestGitHubJson, getGitHubApiHealth } from '../lib/integrations/github-api.mjs';

function response(status,data,headers={}){return {status,ok:status>=200&&status<300,headers:{get(name){return headers[name.toLowerCase()]??null;}},async json(){return data;},async text(){return JSON.stringify(data);}};}
test('GitHub REST 使用 ETag 缓存并记录配额',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'github-cache-'));let calls=0;try{const fetchImpl=async()=>{calls+=1;return response(200,{id:1},{etag:'"abc"','x-ratelimit-limit':'5000','x-ratelimit-remaining':'4999','x-ratelimit-reset':'1780000000','x-ratelimit-resource':'core'});};const first=await requestGitHubJson('/repos/o/r',{fetchImpl,token:'token',cacheDir:dir,ttlMs:60000});const second=await requestGitHubJson('/repos/o/r',{fetchImpl,token:'token',cacheDir:dir,ttlMs:60000});assert.deepEqual(first,{id:1});assert.deepEqual(second,{id:1});assert.equal(calls,1);const health=getGitHubApiHealth();assert.equal(health.remaining,4999);assert.equal(health.authenticated,true);assert.ok(health.cacheHits>=1);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
