import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/core/store.mjs';

test('visual editor decisions persist and aggregate by type', (t) => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'visual-decisions-'));
  const store=new Store(path.join(root,'test.db'));
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const batch=store.createBatch({date:'2026-07-28',title:'测试'});
  store.saveVisualDecision({batchId:batch.id,visualType:'mermaid',action:'inserted',heading:'流程'});
  store.saveVisualDecision({batchId:batch.id,visualType:'mermaid',action:'ignored',heading:'架构'});
  store.saveVisualDecision({batchId:batch.id,visualType:'echarts',action:'inserted',heading:'数据'});
  const stats=store.visualDecisionStats();
  const mermaid=stats.find((row)=>row.visual_type==='mermaid');
  const echarts=stats.find((row)=>row.visual_type==='echarts');
  assert.equal(mermaid.inserted,1);assert.equal(mermaid.ignored,1);
  assert.equal(echarts.inserted,1);assert.equal(echarts.ignored,0);
});
