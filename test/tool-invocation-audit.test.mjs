import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../server/platform/core/store.mjs';

test('工具候选尝试按 resolutionId 持久化为完整调用链',t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'tool-invocation-')),store=new Store(path.join(root,'test.db'));t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});const common={capability:'cap_demo_search',version:'1.0.0',inputKeys:['query'],startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),durationMs:1,authorizedExternalWrite:false,resolutionId:'resolution-1',consumerId:'feature.demo'};store.saveToolExecution({record:{...common,plugin:'primary',status:'error',errorCode:'TIMEOUT',attempt:1,fallbackFrom:null}});store.saveToolExecution({record:{...common,plugin:'backup',status:'ok',errorCode:null,attempt:2,fallbackFrom:'primary'}});const items=store.listToolInvocation('resolution-1');assert.equal(items.length,2);assert.equal(items[0].plugin,'primary');assert.equal(items[1].fallback_from,'primary');assert.equal(items[1].consumer_id,'feature.demo');});
