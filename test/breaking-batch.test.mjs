import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/core/store.mjs';
import { indexArtifacts } from '../lib/artifacts/artifact-indexer.mjs';
import { batchArticlesDir, batchTopicsDir, candidateArticleDir, candidateSocialCardDir } from '../lib/core/workspace-paths.mjs';

test('突发热点创建独立批次并保存多个素材链接', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'breaking-batch-'));
  let store;
  try {
    store=new Store(path.join(root,'test.db'));
    const batch=store.createBreakingBatch({
      date:'2026-07-23',title:'模型公司突发事件',note:'作者观察',
      urls:['https://x.com/example/status/1','https://example.com/announcement'],
      requestedTracks:['article','social_cards'],
    });
    assert.equal(batch.batch_type,'breaking');
    assert.deepEqual(batch.requested_tracks_list,['article','social_cards']);
    assert.equal(batch.hotspots.length,1);
    assert.deepEqual(batch.hotspots[0].materials.map((item)=>item.url),[
      'https://x.com/example/status/1','https://example.com/announcement',
    ]);
  } finally {
    store?.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('批次工作目录按批次 ID 隔离，旧日期目录存在时回退兼容', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-paths-'));
  try {
    const regular={id:'2026-07-23-aaaaaa',batch_date:'2026-07-23',batch_type:'regular'};
    const breaking={id:'2026-07-23-bbbbbb',batch_date:'2026-07-23',batch_type:'breaking'};
    const candidate={candidate_id:'C001'};
    // 无历史目录：常规批次也使用完整批次 ID（同日多批次隔离）
    assert.equal(batchTopicsDir(root,regular),path.join(root,'topics','2026-07-23-aaaaaa-orchestrated'));
    assert.equal(batchTopicsDir(root,breaking),path.join(root,'topics','2026-07-23-bbbbbb-orchestrated'));
    assert.notEqual(candidateArticleDir(root,regular,candidate),candidateArticleDir(root,breaking,candidate));
    assert.notEqual(candidateSocialCardDir(root,regular,candidate),candidateSocialCardDir(root,breaking,candidate));
    // 存在按日期命名的历史目录：旧批次回退到历史目录，数据保持可读写
    const legacyTopics=path.join(root,'topics','2026-07-23-orchestrated');
    const legacyArticle=path.join(root,'articles','2026-07-23-c001');
    fs.mkdirSync(legacyTopics,{recursive:true});
    fs.mkdirSync(legacyArticle,{recursive:true});
    assert.equal(batchTopicsDir(root,regular),legacyTopics);
    assert.equal(candidateArticleDir(root,regular,candidate),legacyArticle);
    assert.equal(batchTopicsDir(root,breaking),path.join(root,'topics','2026-07-23-bbbbbb-orchestrated'));
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('批次级文章目录按批次 ID 隔离，旧日期目录回退兼容', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-paths-'));
  try {
    const first={id:'2026-07-23-aaaaaa',batch_date:'2026-07-23',batch_type:'regular'};
    const second={id:'2026-07-23-bbbbbb',batch_date:'2026-07-23',batch_type:'regular'};
    // 无历史目录：同日多批次的批次级文稿目录互不覆盖
    assert.equal(batchArticlesDir(root,first),path.join(root,'articles','2026-07-23-aaaaaa'));
    assert.notEqual(batchArticlesDir(root,first),batchArticlesDir(root,second));
    // 存在按日期命名的历史目录：回退兼容
    const legacy=path.join(root,'articles','2026-07-23');
    fs.mkdirSync(legacy,{recursive:true});
    assert.equal(batchArticlesDir(root,first),legacy);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('产物索引在同日多批次时优先按批次 ID 归属，不串档', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'artifact-indexer-'));
  let store;
  try {
    store=new Store(path.join(root,'test.db'));
    const first=store.createBatch({date:'2026-07-23',title:'早批'});
    const second=store.createBatch({date:'2026-07-23',title:'午批'});
    const dir=path.join(root,'topics',`${second.id}-orchestrated`);
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'topics-ranked.md'),'# 榜单\n');
    indexArtifacts(store,[root]);
    // 路径含同一天日期前缀，但必须归到 ID 匹配的午批，而不是先建库的早批
    assert.equal(store.listArtifacts({batchId:first.id}).length,0);
    const artifacts=store.listArtifacts({batchId:second.id});
    assert.equal(artifacts.length,1);
    assert.equal(artifacts[0].name,'topics-ranked.md');
  } finally {
    store?.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('普通批次页面不再提供手动添加热点入口', () => {
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const drawer=fs.readFileSync(new URL('../public/src/views/batch-drawer.js',import.meta.url),'utf8');
  assert.doesNotMatch(html,/manual-hotspot-dialog|data-submit-manual-hotspot/);
  assert.doesNotMatch(drawer,/data-manual-hotspot|hotspots\/manual/);
  assert.match(html,/breaking-batch-dialog/);
  assert.match(drawer,/\/api\/batches\/breaking/);
});
