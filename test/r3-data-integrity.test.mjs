import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { WORKBENCH_SCHEMA_VERSION } from '../server/platform/persistence/migrations.mjs';
import { acquireInstanceLock } from '../server/platform/core/instance-lock.mjs';

test('数据库迁移版本持久化且重复启动不重复执行结构修复',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'write-assistant-r3-migration-'));
  const dbPath=path.join(root,'workbench.db');
  let store;
  try {
    store=new Store(dbPath);
    assert.equal(store.db.prepare('SELECT MAX(version) version FROM schema_migrations').get().version,WORKBENCH_SCHEMA_VERSION);
    store.close();store=new Store(dbPath);
    assert.equal(store.db.prepare('SELECT COUNT(*) count FROM schema_migrations').get().count,WORKBENCH_SCHEMA_VERSION);
  } finally { store?.close();fs.rmSync(root,{recursive:true,force:true}); }
});

test('存量迁移补齐 candidates 的 reader_stake_score 列',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'write-assistant-r3-reader-stake-'));
  const dbPath=path.join(root,'workbench.db');
  let store;
  try {
    store=new Store(dbPath);
    store.db.exec('ALTER TABLE candidates DROP COLUMN reader_stake_score');
    store.db.prepare('DELETE FROM schema_migrations WHERE version IN (16,17,18)').run();
    store.close();store=null;
    store=new Store(dbPath);
    const columns=new Set(store.db.prepare('PRAGMA table_info(candidates)').all().map((column)=>column.name));
    assert.ok(columns.has('reader_stake_score'));
    assert.equal(store.db.prepare('SELECT MAX(version) version FROM schema_migrations').get().version,WORKBENCH_SCHEMA_VERSION);
  } finally { store?.close();fs.rmSync(root,{recursive:true,force:true}); }
});

test('批次级文稿在 NULL candidate 下仍保持唯一',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'write-assistant-r3-doc-'));let store;
  try {
    store=new Store(path.join(root,'workbench.db'));
    const batch=store.createBatch({date:'2026-08-14',title:'R3'});
    store.saveDocument({batchId:batch.id,kind:'daily-final',content:'第一版'});
    store.saveDocument({batchId:batch.id,kind:'daily-final',content:'第二版'});
    assert.equal(store.db.prepare("SELECT COUNT(*) count FROM documents WHERE batch_id=? AND kind='daily-final'").get(batch.id).count,1);
  } finally { store?.close();fs.rmSync(root,{recursive:true,force:true}); }
});

test('候选删除后编号按历史最大值递增而不碰撞或跳过热点',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'write-assistant-r3-candidate-'));let store;
  try {
    store=new Store(path.join(root,'workbench.db'));
    const batch=store.createBatch({date:'2026-08-14',title:'R3'});
    store.addHotspots(batch.id,'rsshub',[1,2,3].map((n)=>({title:`热点${n}`,url:`https://example.com/${n}`})));
    const hotspots=store.getBatch(batch.id).hotspots;
    const first=store.addCandidates(batch.id,hotspots.slice(0,2).map((item)=>item.id));
    store.deleteCandidate(first[0].id);
    const candidates=store.addCandidates(batch.id,[hotspots[2].id]);
    const created=candidates.find((item)=>item.hotspot_id===hotspots[2].id);
    assert.ok(created);
    assert.equal(created.candidate_id,'C003');
  } finally { store?.close();fs.rmSync(root,{recursive:true,force:true}); }
});

test('单实例锁拒绝同进程重复持有并可释放重取',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'write-assistant-r3-lock-'));
  const first=acquireInstanceLock(root);
  try {
    assert.throws(()=>acquireInstanceLock(root),(error)=>error.code==='INSTANCE_ALREADY_RUNNING');
    first.release();
    const second=acquireInstanceLock(root);second.release();
  } finally { first.release();fs.rmSync(root,{recursive:true,force:true}); }
});
