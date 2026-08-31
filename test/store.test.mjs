import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { WorkbenchQueryService } from '../server/platform/persistence/queries/workbench-query-service.mjs';
import { EditorialRepository } from '../server/platform/persistence/repositories/editorial-repository.mjs';
import { SocialCandidateRepository } from '../server/platform/persistence/repositories/social-candidate-repository.mjs';
import { CustomArticleRepository } from '../server/platform/persistence/repositories/custom-article-repository.mjs';
import { BatchQueryService } from '../server/platform/persistence/queries/batch-query-service.mjs';
import { CandidateQueryService } from '../server/platform/persistence/queries/candidate-query-service.mjs';
import { CandidateSelectionService } from '../server/features/research/application/candidate-selection-service.mjs';
import { DatabaseRestoreService } from '../server/platform/persistence/database-restore-service.mjs';

test('Store delegates cross-domain reads to the workbench query service', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-query-service-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    assert.ok(store.queries.workbench instanceof WorkbenchQueryService);
    assert.ok(store.queries.batches instanceof BatchQueryService);
    assert.ok(store.queries.candidates instanceof CandidateQueryService);
    assert.equal(store.getBatch(-1), null);
    assert.deepEqual(store.getBatchOverview(-1), store.queries.batches.getOverview(-1));
    assert.deepEqual(store.listCandidates(-1), store.queries.candidates.list(-1));
    assert.equal(store.getCandidate(-1), null);
    assert.deepEqual(store.listFinalArticles(), store.queries.workbench.listFinalArticles());
    assert.deepEqual(store.listCalendarContent(), store.queries.workbench.listCalendarContent());
    assert.deepEqual(store.findSimilarArticles(-1), store.queries.workbench.findSimilarArticles(-1));
    assert.deepEqual(store.findSimilarSocialCards(-1), store.queries.workbench.findSimilarSocialCards(-1));
    assert.deepEqual(store.articleStats(), store.queries.workbench.articleStats());
    assert.deepEqual(store.listLogs(), store.queries.workbench.listLogs());
    assert.deepEqual(store.overview(), store.queries.workbench.overview());
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Store exposes editorial and social candidate repositories through compatible methods', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-domain-repositories-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    assert.ok(store.repositories.editorial instanceof EditorialRepository);
    assert.ok(store.repositories.socialCandidates instanceof SocialCandidateRepository);
    assert.ok(store.repositories.customArticles instanceof CustomArticleRepository);
    assert.ok(store.services.candidateSelection instanceof CandidateSelectionService);
    assert.ok(store.services.databaseRestore instanceof DatabaseRestoreService);
    assert.deepEqual(store.getEditorial(999), store.repositories.editorial.getArticle(999));
    assert.deepEqual(store.getCardEditorial(999), store.repositories.editorial.getCard(999));
    assert.equal(store.getRepositoryFactSheet(999), null);
    assert.equal(store.getSocialScore(999), null);
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('database restore service replaces data while Store remains a compatible facade', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-database-restore-'));
  const backupPath = path.join(tempRoot, 'backup.db');
  const targetPath = path.join(tempRoot, 'target.db');
  let source; let target;
  try {
    source = new Store(backupPath);
    source.createBatch({ date: '2026-08-01', title: 'backup batch' });
    source.close(); source = null;
    target = new Store(targetPath);
    target.createBatch({ date: '2026-08-02', title: 'target batch' });
    assert.equal(target.restoreFromDatabase(backupPath).count, 1);
    assert.equal(target.listBatches()[0].title, 'backup batch');
  } finally {
    source?.close();
    target?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('自主写作创建请求按请求 ID 和内容指纹保持幂等并关联原候选',()=>{
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-custom-idempotency-'));let store;
  try{
    store=new Store(path.join(tempRoot,'test.db'));
    const batch=store.createBatch({date:'2026-07-28',title:'自主写作幂等'});
    const first=store.createCustomArticleRequest({batchId:batch.id,requestId:'request-1',fingerprint:'fingerprint-1'});
    const sameRequest=store.createCustomArticleRequest({batchId:batch.id,requestId:'request-1',fingerprint:'fingerprint-1'});
    const sameContent=store.createCustomArticleRequest({batchId:batch.id,requestId:'request-2',fingerprint:'fingerprint-1'});
    assert.equal(sameRequest.id,first.id);
    assert.equal(sameContent.id,first.id);
    store.addHotspots(batch.id,'manual',[{title:'教程'}]);
    const candidate=store.addCandidates(batch.id,[store.getBatch(batch.id).hotspots[0].id])[0];
    store.updateCandidateTrack(candidate.id,'article',{output_mode:'wechat-tutorial',pool_role:'自主写作'});
    store.createAiRun({id:'job-1',batchId:batch.id,type:'tutorial',provider:'test'});
    store.updateAiRun('job-1',{status:'failed',error:'质量门禁未通过'});
    store.updateCustomArticleRequest(first.id,{candidateId:candidate.id,latestJobId:'job-1'});
    const restored=store.getCustomArticleRequestByCandidate(candidate.id);
    assert.equal(restored.latest_job_id,'job-1');
    assert.equal(restored.request_id,'request-1');
    let projects=store.listCustomArticleProjects(batch.id);
    assert.equal(projects.length,1);
    assert.equal(projects[0].job_status,'failed');
    store.saveDocument({batchId:batch.id,candidateId:candidate.id,kind:'draft',title:'教程草稿',content:'# 教程草稿'});
    projects=store.listCustomArticleProjects(batch.id);
    assert.equal(projects[0].document_title,'教程草稿');
  }finally{store?.close();fs.rmSync(tempRoot,{recursive:true,force:true});}
});

test('自动图文预选排除历史上已生成完整图文的同一仓库，但不影响人工加入', () => {
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-social-history-filter-'));let store;
  try {
    store=new Store(path.join(tempRoot,'test.db'));
    const oldBatch=store.createBatch({date:'2026-07-22',title:'历史批次'});
    store.addHotspots(oldBatch.id,'github',[{title:'alibaba/open-code-review',url:'https://github.com/alibaba/open-code-review',repository:'alibaba/open-code-review'}]);
    store.addCandidates(oldBatch.id,[store.getBatch(oldBatch.id).hotspots[0].id],{tracks:['social_cards']});
    const oldCandidate=store.listCandidates(oldBatch.id,'social_cards')[0];
    const html=path.join(tempRoot,'my-design.html');fs.writeFileSync(html,'<html></html>');const stat=fs.statSync(html);
    store.upsertArtifact({batchId:oldBatch.id,candidateId:oldCandidate.id,track:'social_cards',kind:'图文设计 HTML',name:'my-design.html',path:html,size:stat.size,modifiedAt:'2026-07-22T08:00:00.000Z'});
    const newBatch=store.createBatch({date:'2026-07-29',title:'当前批次'});
    store.addHotspots(newBatch.id,'github',[{title:'alibaba/open-code-review 再次上榜',url:'https://github.com/alibaba/open-code-review',repository:'alibaba/open-code-review'}]);
    const hotspot=store.getBatch(newBatch.id).hotspots[0];
    store.saveSocialPreselection(newBatch.id,[{hotspotId:hotspot.id,socialScore:88}]);
    assert.equal(store.listCandidates(newBatch.id,'social_cards').length,0);
    store.addCandidates(newBatch.id,[hotspot.id],{tracks:['social_cards']});
    assert.equal(store.listCandidates(newBatch.id,'social_cards').length,1);
  } finally {store?.close();fs.rmSync(tempRoot,{recursive:true,force:true});}
});

test('编辑决策将布尔型体验要求规范化为 SQLite 整数',()=>{
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-editorial-bool-'));let store;
  try{
    store=new Store(path.join(tempRoot,'test.db'));
    const batch=store.createBatch({date:'2026-07-28',title:'自主写作'});
    store.addHotspots(batch.id,'manual',[{title:'教程',url:'https://example.com/tutorial'}]);
    const hotspot=store.getBatch(batch.id).hotspots[0];
    const candidate=store.addCandidates(batch.id,[hotspot.id],{tracks:['article']})[0];
    const saved=store.saveEditorial(candidate.id,{experience_required:true});
    assert.equal(saved.experience_required,1);
  }finally{store?.close();fs.rmSync(tempRoot,{recursive:true,force:true});}
});

test('批次级早报反复保存时更新同一文稿并保留版本',()=>{
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-daily-document-'));let store;
  try{
    store=new Store(path.join(tempRoot,'test.db'));
    const batch=store.createBatch({date:'2026-07-28',title:'早报批次'});
    store.saveDocument({batchId:batch.id,kind:'daily-final',title:'第一版',content:'# 第一版'});
    store.saveDocument({batchId:batch.id,kind:'daily-final',title:'第二版',content:'# 第二版'});
    const docs=store.listDocuments(batch.id).filter((item)=>item.kind==='daily-final');
    assert.equal(docs.length,1);
    assert.equal(docs[0].title,'第二版');
    assert.equal(store.listDocumentRevisions(docs[0].id).length,2);
  }finally{store?.close();fs.rmSync(tempRoot,{recursive:true,force:true});}
});

test('完成和归档批次退出当前工作台但保留历史记录',()=>{
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-batch-lifecycle-'));
  let store;
  try{
    store=new Store(path.join(tempRoot,'test.db'));
    const older=store.createBatch({date:'2026-07-25',title:'旧批次'});
    const current=store.createBatch({date:'2026-07-26',title:'当前批次'});
    assert.equal(store.overview().latest.id,current.id);
    store.updateBatch(current.id,{status:'review',lifecycle_status:'completed'});
    assert.equal(store.overview().latest.id,older.id);
    store.updateBatch(older.id,{lifecycle_status:'archived'});
    assert.equal(store.overview().latest,null);
    const history=store.listBatches(10);
    assert.deepEqual(history.map((item)=>item.lifecycle_status),['completed','archived']);
    assert.equal(history[0].status,'review');
  }finally{
    store?.close();
    fs.rmSync(tempRoot,{recursive:true,force:true});
  }
});

test('工作台今日文章与图文只统计当前活动批次',()=>{
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-current-batch-counts-'));
  let store;
  try{
    store=new Store(path.join(tempRoot,'test.db'));
    const oldBatch=store.createBatch({date:'2026-07-25',title:'旧批次'});
    store.addHotspots(oldBatch.id,'rsshub',[{title:'旧选题',url:'https://example.com/old'}]);
    const oldCandidate=store.addCandidates(oldBatch.id,[store.getBatch(oldBatch.id).hotspots[0].id],{tracks:['article','social_cards']})[0];
    store.updateCandidateTrack(oldCandidate.id,'article',{status:'drafting'});
    store.updateCandidateTrack(oldCandidate.id,'social_cards',{status:'drafting'});
    const currentBatch=store.createBatch({date:'2026-07-26',title:'当前批次'});

    let overview=store.overview();
    assert.equal(overview.latest.id,currentBatch.id);
    assert.equal(overview.articleCandidates,1);
    assert.equal(overview.socialCandidates,1);
    assert.equal(overview.articleInProgress,0);
    assert.equal(overview.socialInProgress,0);

    store.addHotspots(currentBatch.id,'rsshub',[{title:'今日选题',url:'https://example.com/today'}]);
    const currentCandidate=store.addCandidates(currentBatch.id,[store.getBatch(currentBatch.id).hotspots[0].id],{tracks:['article']})[0];
    store.updateCandidateTrack(currentCandidate.id,'article',{status:'review'});
    overview=store.overview();
    assert.equal(overview.articleCandidates,2);
    assert.equal(overview.articleInProgress,1);
    assert.equal(overview.socialInProgress,0);
  }finally{
    store?.close();
    fs.rmSync(tempRoot,{recursive:true,force:true});
  }
});

test('工作台效率反馈计算采集到研判耗时、AI 成功率、推进率和瓶颈',()=>{
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-efficiency-'));
  let store;
  try{
    store=new Store(path.join(tempRoot,'test.db'));
    const baselineBatch=store.createBatch({date:'2026-07-25',title:'效率基线'});
    store.recordSubscriptionRun(baselineBatch.id,{sourceGroup:'rsshub',sourceType:'rsshub',sourceKey:'baseline',
      sourceName:'历史测试源',status:'ok',itemCount:8,durationMs:4000});
    const batch=store.createBatch({date:'2026-07-26',title:'效率反馈'});
    const now=new Date().toISOString();
    store.db.prepare(`INSERT INTO subscription_runs
      (batch_id,source_group,source_type,source_key,source_name,status,item_count,duration_ms,error,started_at,ended_at)
      VALUES (?,?,?,?,?,'failed',0,1000,'超时',?,?),
             (?,?,?,?,?,'ok',10,2500,NULL,?,?)`).run(
        batch.id,'rsshub','rsshub','test','测试源',now,now,
        batch.id,'rsshub','rsshub','test','测试源',now,now);
    store.db.prepare(`INSERT INTO ai_runs
      (id,batch_id,type,provider,status,progress,result_json,error,created_at,updated_at)
      VALUES ('ok',?,'tag','test','completed','','{}',NULL,?,?),
             ('bad',?,'research','test','failed','','{}','失败',?,?)`).run(batch.id,now,now,batch.id,now,now);
    // 采集到研判耗时：source_runs 最早开始 → 最近完成的 research/auto 结束
    store.db.prepare(`INSERT INTO source_runs (batch_id,source,status,item_count,started_at,ended_at)
      VALUES (?,'rsshub','success',10,?,?)`).run(batch.id,'2026-07-26T08:00:00.000Z','2026-07-26T08:02:00.000Z');
    store.db.prepare(`INSERT INTO ai_runs
      (id,batch_id,type,provider,status,progress,result_json,error,created_at,updated_at)
      VALUES ('auto-ok',?,'auto','test','completed','','{}',NULL,?,?)`).run(batch.id,'2026-07-26T08:02:00.000Z','2026-07-26T08:30:00.000Z');
    const overview=store.overview();
    assert.equal(overview.efficiency.aiSuccessRate,67);
    assert.equal(overview.efficiency.artifactCount,0);
    assert.equal(overview.efficiency.collectToResearchDurationMs,30*60*1000);
    assert.match(overview.efficiency.bottleneck,/失败任务/);
    assert.equal(overview.efficiencyBaseline.sampleSize,1);
    // 基线批次没有完成的研判记录，不参与均值
    assert.equal(overview.efficiencyBaseline.collectToResearchDurationMs,null);
  }finally{
    store?.close();
    fs.rmSync(tempRoot,{recursive:true,force:true});
  }
});

test('研判完成状态不受 ai_runs 截断列表影响（latestResearch 独立查询）',()=>{
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-research-'));
  let store;
  try{
    store=new Store(path.join(tempRoot,'test.db'));
    const batch=store.createBatch({date:'2026-07-27',title:'研判截断'});
    store.createAiRun({id:'auto-1',batchId:batch.id,type:'auto',provider:'test'});
    store.updateAiRun('auto-1',{status:'completed'});
    // 模拟排版重试把研判记录挤出最新 20 条窗口
    for(let i=0;i<24;i+=1){
      store.createAiRun({id:`typeset-${i}`,batchId:batch.id,type:'typeset',provider:'test'});
      store.updateAiRun(`typeset-${i}`,{status:'completed'});
    }
    const fetched=store.getBatch(batch.id);
    assert.equal(fetched.ai_status.latestResearch?.id,'auto-1');
    assert.equal(fetched.ai_status.latestResearch?.status,'completed');
  }finally{
    store?.close();
    fs.rmSync(tempRoot,{recursive:true,force:true});
  }
});

test('打标持久化保留 eventParts 四要素与扩展字段', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-store-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-24', title: '测试批次' });
    store.addHotspots(batch.id, 'rsshub', [{ id: 'h1', title: '测试热点', url: 'https://example.com' }]);
    const hotspot = store.getBatch(batch.id).hotspots[0];
    store.updateHotspotTags(hotspot.id, {
      category: '🤖 AI/技术动态', marketScope: '国内', score: 80, chinaRelevance: 8, relevanceReason: '相关',
      riskLevel: '低', riskReason: '', eventKey: 'openai|发布gpt5',
      eventParts: { who: 'openai', what: '发布gpt5', where: '全球', when: '2026-07', actionType: '发布', object: 'gpt-5', occasion: '',
        labels: { who: 'OpenAI', what: '发布 GPT-5', object: 'GPT-5', occasion: '' } },
      keywords: [], globalException: false,
      preScores: { conflict: 10 }, credibleScoop: 0, saturationPenalty: 0, duplicatePenalty: 0, blackHorseSignals: [],
    });
    const saved = JSON.parse(store.getBatch(batch.id).hotspots[0].raw_json).aiTags;
    assert.equal(saved.eventParts.who, 'openai');
    assert.equal(saved.eventParts.actionType, '发布');
    assert.equal(saved.eventParts.object, 'gpt-5');
    assert.equal(saved.eventParts.labels.who, 'OpenAI');
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('document revisions only record meaningful changes', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-revisions-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-26', title: 'revision test' });
    const now = new Date().toISOString();
    store.db.prepare(`INSERT INTO candidates
      (batch_id,candidate_id,created_at,updated_at) VALUES (?,?,?,?)`).run(batch.id,'revision-candidate',now,now);
    const candidateId = store.db.prepare('SELECT id FROM candidates WHERE batch_id=?').get(batch.id).id;
    const first = store.saveDocument({ batchId:batch.id,candidateId,kind:'draft',title:'title',content:'first' });
    store.saveDocument({ batchId:batch.id,candidateId,kind:'draft',title:'title',content:'first' });
    store.saveDocument({ batchId:batch.id,candidateId,kind:'draft',title:'title',content:'second' });
    const revisions = store.listDocumentRevisions(first.id);
    assert.equal(revisions.length,2);
    assert.equal(store.getDocumentRevision(first.id,revisions[0].id).content,'second');
    assert.equal(store.getDocumentRevision(first.id,revisions[1].id).content,'first');
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('批次、热点和概览可持久化', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-store-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-19', title: '测试批次' });
    store.addHotspots(batch.id, 'reddit', [{ id: 't3_1', title: '测试热点', url: 'https://example.com' }]);
    assert.equal(store.getBatch(batch.id).hotspots.length, 1);
    assert.equal(store.overview().hotspots, 1);
    assert.equal(store.listHotspots({ q: '测试' }).length, 1);
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('同一批次同来源同标题会更新而不重复', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-store-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-19', title: '测试批次' });
    store.addHotspots(batch.id, 'rsshub', [{ title: '同一条', url: 'https://one.example' }]);
    store.addHotspots(batch.id, 'rsshub', [{ title: '同一条', url: 'https://two.example' }]);
    const items = store.getBatch(batch.id).hotspots;
    assert.equal(items.length, 1);
    assert.equal(items[0].url, 'https://two.example');
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('不同具体订阅源的同标题热点不会互相覆盖', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-store-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-19', title: '来源身份测试' });
    store.addHotspots(batch.id, 'rsshub', [{ title:'同名发布',url:'https://one.example',sourceKey:'twitter:/twitter/user/OpenAI',sourceType:'twitter',sourceName:'@OpenAI' }]);
    store.addHotspots(batch.id, 'rsshub', [{ title:'同名发布',url:'https://two.example',sourceKey:'direct:https://two.example/feed.xml',sourceType:'direct',sourceName:'公众号二号' }]);
    const items = store.getBatch(batch.id).hotspots;
    assert.equal(items.length, 2);
    assert.deepEqual(new Set(items.map((item) => item.source)), new Set(['twitter:/twitter/user/OpenAI','direct:https://two.example/feed.xml']));
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('单源健康状态持久化且重启恢复悬空任务', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-store-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-19', title: '恢复测试' });
    store.updateBatch(batch.id,{status:'running'});
    const sourceRunId=store.startSourceRun(batch.id,'rsshub');
    store.createAiRun({id:'ai-running',batchId:batch.id,type:'tag',provider:'deepseek'});
    store.recordSubscriptionRun(batch.id,{sourceGroup:'rsshub',sourceType:'twitter',sourceKey:'twitter:/twitter/user/OpenAI',sourceName:'@OpenAI',status:'running',startedAt:'2026-07-19T00:00:00.000Z'});
    const recovered=store.recoverInterruptedWork();
    assert.deepEqual(recovered,{aiRuns:1,sourceRuns:1,subscriptionRuns:1,batches:1});
    assert.equal(store.getAiRun('ai-running').status,'interrupted');
    assert.equal(store.getBatch(batch.id).sources.find((item)=>item.id===sourceRunId).status,'interrupted');
    assert.equal(store.listSubscriptionHealth()[0].status,'interrupted');
    assert.equal(store.getSourceRun(sourceRunId).status,'interrupted');
    assert.equal(store.listRecentRuns(10).some((item)=>item.run_kind==='ai' && item.id==='ai-running'), true);
    assert.equal(store.listRecentRuns(10).some((item)=>item.run_kind==='source'), true);
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('来源健康历史和最近 AI 任务可查询', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-store-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-19', title: '历史查询测试' });
    store.recordSubscriptionRun(batch.id, { sourceGroup:'rsshub', sourceType:'direct', sourceKey:'direct:https://example.com/feed.xml', sourceName:'示例源', status:'success', itemCount:3, endedAt:new Date().toISOString() });
    store.createAiRun({ id:'ai-history', batchId:batch.id, type:'tag', provider:'deepseek' });
    assert.equal(store.listSubscriptionHealthHistory({ days: 14 }).length, 1);
    assert.equal(store.listRecentAiRuns(10)[0].id, 'ai-history');
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('候选、编辑决策与文稿形成连续状态', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-store-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-19', title: '生产链测试' });
    store.addHotspots(batch.id, 'reddit', [{ title: '值得讨论的热点', url: 'https://example.com/topic' }]);
    const hotspot = store.getBatch(batch.id).hotspots[0];
    const candidate = store.addCandidates(batch.id, [hotspot.id])[0];
    store.updateCandidate(candidate.id, { thesis: '这是一条明确命题', angle: '从开发者影响切入' });
    store.saveEditorial(candidate.id, { next_action: 'WRITE_NOW', confirmed_facts: '事实 A 已确认' });
    const restored = store.getCandidate(candidate.id);
    assert.equal(restored.thesis, '这是一条明确命题');
    assert.equal(restored.editorial.next_action, 'WRITE_NOW');
    store.saveHotspotSource(hotspot.id,{url:hotspot.url,status:'ok',title:'来源标题',content:'可核验正文',content_chars:5,fetched_at:'2026-07-19T08:00:00Z'});
    assert.equal(store.getCandidate(candidate.id).source_document.title,'来源标题');
    const document = store.saveDocument({ batchId: batch.id, candidateId: candidate.id, kind: 'draft', content: '# 标题\n\n正文。' });
    assert.equal(document.visible_chars, 3);
    assert.equal(store.listDocuments(batch.id).length, 1);
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('候选双轨可独立加入、过滤和移除', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-tracks-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-22', title: '双轨测试' });
    store.addHotspots(batch.id, 'rsshub', [{ title: '开源工具项目', url: 'https://github.com/example/tool' }]);
    const hotspot = store.getBatch(batch.id).hotspots[0];
    const article = store.addCandidates(batch.id, [hotspot.id])[0];
    assert.equal(store.listCandidates(batch.id, 'article').length, 1);
    assert.equal(store.listCandidates(batch.id, 'social_cards').length, 0);

    store.addCandidateTracks(article.id, ['social_cards']);
    const social = store.listCandidates(batch.id, 'social_cards');
    assert.equal(social.length, 1);
    assert.equal(social[0].id, article.id);
    assert.equal(social[0].output_mode, 'wechat-tool-cards');
    assert.equal(store.overview().socialCandidates, 1);

    store.removeCandidateTrack(article.id, 'article');
    assert.equal(store.listCandidates(batch.id, 'article').length, 0);
    assert.equal(store.listCandidates(batch.id, 'social_cards').length, 1);
    assert.ok(store.getCandidate(article.id));
    store.close();
    store = new Store(path.join(tempRoot, 'test.db'));
    assert.equal(store.listCandidates(batch.id, 'article').length, 0);
    assert.equal(store.listCandidates(batch.id, 'social_cards').length, 1);
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('同一组热点分次加入两条轨道时复用综合候选', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-composite-tracks-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-22', title: '综合双轨测试' });
    store.addHotspots(batch.id, 'rsshub', [{ title: '项目 A' }, { title: '项目 B' }]);
    const ids = store.getBatch(batch.id).hotspots.map((item) => item.id);
    const article = store.createCompositeCandidate(batch.id, ids, { tracks: ['article'] });
    const social = store.createCompositeCandidate(batch.id, ids.slice().reverse(), { tracks: ['social_cards'] });
    assert.equal(social.id, article.id);
    assert.equal(store.listCandidates(batch.id, 'article').length, 1);
    assert.equal(store.listCandidates(batch.id, 'social_cards').length, 1);
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('文章研判不再把贴图建议重复写入图文轨道', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-research-tracks-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-22', title: '研判分流测试' });
    store.addHotspots(batch.id, 'rsshub', [{ title: '开源工具' }, { title: '行业新闻' }]);
    const [tool, news] = store.getBatch(batch.id).hotspots;
    store.saveAnalyzedCandidates(batch.id, [
      { hotspotId:tool.id,poolRole:'核心8条',riskLevel:'低',angle:'工具角度',thesis:'工具命题',h:60,b:70,p:40,s:2,d:0,f:58,socialRecommended:true },
      { hotspotId:news.id,poolRole:'黑马2条',riskLevel:'低',angle:'新闻角度',thesis:'新闻命题',h:60,b:70,p:40,s:2,d:0,f:58,socialRecommended:false },
    ]);
    const social = store.listCandidates(batch.id, 'social_cards');
    assert.equal(social.length, 0);
    assert.equal(store.listCandidates(batch.id, 'article').length, 2);
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('全量图文预选可独立创建仅图文轨道候选', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-social-preselection-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date:'2026-07-22', title:'图文独立预选' });
    store.addHotspots(batch.id, 'rsshub', [{ title:'GitHub 工具', url:'https://github.com/example/tool' }]);
    const hotspot = store.getBatch(batch.id).hotspots[0];
    store.saveSocialPreselection(batch.id, [{ hotspotId:hotspot.id, socialScore:82, reasons:['GitHub 仓库'] }]);
    assert.equal(store.listCandidates(batch.id, 'article').length, 0);
    const social = store.listCandidates(batch.id, 'social_cards');
    assert.equal(social.length, 1);
    assert.equal(social[0].track_pool_role, 'AI 图文预选');
    assert.equal(social[0].track_score, 82);
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive:true, force:true });
  }
});

test('图文产物显式关联候选与轨道', () => {
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-artifact-track-'));let store;
  try{store=new Store(path.join(tempRoot,'test.db'));const batch=store.createBatch({date:'2026-07-22',title:'产物关联'});store.addHotspots(batch.id,'rsshub',[{title:'工具',url:'https://github.com/o/r'}]);store.addCandidates(batch.id,[store.getBatch(batch.id).hotspots[0].id]);const candidate=store.listCandidates(batch.id)[0];const file=path.join(tempRoot,'page-01.png');fs.writeFileSync(file,'png');const stat=fs.statSync(file);store.upsertArtifact({batchId:batch.id,candidateId:candidate.id,track:'social_cards',kind:'图文卡片 PNG',name:'page-01.png',path:file,size:stat.size,modifiedAt:stat.mtime.toISOString()});const artifact=store.listArtifacts({batchId:batch.id})[0];assert.equal(artifact.candidate_row_id,candidate.id);assert.equal(artifact.track,'social_cards');assert.equal(artifact.candidate_id,candidate.candidate_id);
  }finally{store?.close();fs.rmSync(tempRoot,{recursive:true,force:true});}
});

test('内容日历同时返回文章终稿与图文最终 HTML', () => {
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-calendar-content-'));let store;
  try {
    store=new Store(path.join(tempRoot,'test.db'));
    const batch=store.createBatch({date:'2026-07-22',title:'内容日历'});
    store.addHotspots(batch.id,'rsshub',[{title:'日历中的工具',url:'https://github.com/o/r'}]);
    store.addCandidates(batch.id,[store.getBatch(batch.id).hotspots[0].id]);
    const candidate=store.listCandidates(batch.id)[0];
    store.addCandidateTracks(candidate.id,['social_cards'],{pool_role:'AI 图文预选'});
    store.saveDocument({batchId:batch.id,candidateId:candidate.id,kind:'final',title:'文章终稿',content:'正文',status:'ready'});
    const copy=path.join(tempRoot,'copy.txt');fs.writeFileSync(copy,'标题\n正文');const copyStat=fs.statSync(copy);
    store.upsertArtifact({batchId:batch.id,candidateId:candidate.id,track:'social_cards',kind:'图文配套文案',name:'copy.txt',path:copy,size:copyStat.size,modifiedAt:'2026-07-22T07:59:00.000Z'});
    const html=path.join(tempRoot,'my-design.html');fs.writeFileSync(html,'<html></html>');const stat=fs.statSync(html);
    store.upsertArtifact({batchId:batch.id,candidateId:candidate.id,track:'social_cards',kind:'图文设计 HTML',name:'my-design.html',path:html,size:stat.size,modifiedAt:'2026-07-22T08:00:00.000Z'});
    const aiHtml=path.join(tempRoot,'ai-beautified.html');fs.writeFileSync(aiHtml,'<html>AI视觉</html>');const aiStat=fs.statSync(aiHtml);
    store.upsertArtifact({batchId:batch.id,candidateId:candidate.id,track:'social_cards',kind:'AI 视觉 HTML',name:'ai-beautified.html',path:aiHtml,size:aiStat.size,modifiedAt:'2026-07-22T08:01:00.000Z'});
    const entries=store.listCalendarContent({month:'2026-07'});
    assert.equal(entries.filter((item)=>item.content_type==='article').length,1);
    const socialEntries=entries.filter((item)=>item.content_type==='social_cards');
    assert.equal(socialEntries.length,1);
    assert.equal(socialEntries[0].candidate_row_id,candidate.id);
    assert.equal(socialEntries[0].id,store.listArtifacts({batchId:batch.id}).find((item)=>item.name==='ai-beautified.html').id);
  } finally {store?.close();fs.rmSync(tempRoot,{recursive:true,force:true});}
});

test('内容日历以最终 HTML 作为图文交付标志', () => {
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-calendar-copy-marker-'));let store;
  try {
    store=new Store(path.join(tempRoot,'test.db'));
    const batch=store.createBatch({date:'2026-07-24',title:'copy 标志'});
    store.addHotspots(batch.id,'rsshub',[{title:'仅有文案的图文',url:'https://github.com/o/copy-only'}]);
    store.addCandidates(batch.id,[store.getBatch(batch.id).hotspots[0].id]);
    const candidate=store.listCandidates(batch.id)[0];
    const html=path.join(tempRoot,'my-design.html');fs.writeFileSync(html,'<html></html>');const stat=fs.statSync(html);
    store.upsertArtifact({batchId:batch.id,candidateId:candidate.id,track:'social_cards',kind:'图文设计 HTML',name:'my-design.html',path:html,size:stat.size,modifiedAt:'2026-07-24T08:00:00.000Z'});
    const social=store.listCalendarContent({month:'2026-07'}).find((item)=>item.content_type==='social_cards');
    assert.equal(social.candidate_row_id,candidate.id);
    assert.equal(social.id,store.listArtifacts({batchId:batch.id})[0].id);
  } finally {store?.close();fs.rmSync(tempRoot,{recursive:true,force:true});}
});

test('内容日历不把 copy.txt 单独当作图文交付标志', () => {
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-calendar-copy-only-'));let store;
  try {
    store=new Store(path.join(tempRoot,'test.db'));
    const batch=store.createBatch({date:'2026-07-25',title:'仅有文案'});
    store.addHotspots(batch.id,'rsshub',[{title:'仅有文案的图文',url:'https://github.com/o/copy-only'}]);
    store.addCandidates(batch.id,[store.getBatch(batch.id).hotspots[0].id]);
    const candidate=store.listCandidates(batch.id)[0];
    const copy=path.join(tempRoot,'copy.txt');fs.writeFileSync(copy,'标题\n正文');const stat=fs.statSync(copy);
    store.upsertArtifact({batchId:batch.id,candidateId:candidate.id,track:'social_cards',kind:'图文配套文案',name:'copy.txt',path:copy,size:stat.size,modifiedAt:'2026-07-25T08:00:00.000Z'});
    assert.equal(store.listCalendarContent({month:'2026-07'}).some((item)=>item.content_type==='social_cards'),false);
  } finally {store?.close();fs.rmSync(tempRoot,{recursive:true,force:true});}
});

test('内容日历兼容只有最终 HTML、尚未登记 copy.txt 的图文', () => {
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-calendar-html-fallback-'));let store;
  try {
    store=new Store(path.join(tempRoot,'test.db'));
    const batch=store.createBatch({date:'2026-07-26',title:'HTML 回退'});
    store.addHotspots(batch.id,'rsshub',[{title:'仅有 HTML 的图文',url:'https://github.com/o/html-only'}]);
    store.addCandidates(batch.id,[store.getBatch(batch.id).hotspots[0].id]);
    const candidate=store.listCandidates(batch.id)[0];
    const html=path.join(tempRoot,'my-design.html');fs.writeFileSync(html,'<html></html>');const stat=fs.statSync(html);
    store.upsertArtifact({batchId:batch.id,candidateId:candidate.id,track:'social_cards',kind:'图文设计 HTML',name:'my-design.html',path:html,size:stat.size,modifiedAt:'2026-07-26T08:00:00.000Z'});
    const social=store.listCalendarContent({month:'2026-07'}).find((item)=>item.content_type==='social_cards');
    assert.equal(social.candidate_row_id,candidate.id);
    assert.equal(social.id,store.listArtifacts({batchId:batch.id})[0].id);
  } finally {store?.close();fs.rmSync(tempRoot,{recursive:true,force:true});}
});

test('图文候选返回仓库描述与可读的入选理由', () => {
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-social-context-'));let store;
  try {
    store=new Store(path.join(tempRoot,'test.db'));
    const batch=store.createBatch({date:'2026-07-23',title:'图文候选上下文'});
    store.addHotspots(batch.id,'github',[{title:'owner/tool',url:'https://github.com/owner/tool',description:'帮助开发者自动整理复杂日志',stars:2345,discoveryChannels:['search']}]);
    const hotspot=store.getBatch(batch.id).hotspots[0];
    store.saveSocialPreselection(batch.id,[{hotspotId:hotspot.id,socialScore:80,socialScoreDetails:{toolClarity:18,scenarioValue:14,demonstrability:15,visualPotential:12,saveSearchValue:13,sourceCompleteness:18,finalScore:80}}]);
    const candidate=store.listCandidates(batch.id,'social_cards')[0];
    assert.equal(candidate.repository_description,'','未打标热点不再回退英文简介');
    assert.match(candidate.social_selection_reason,/近期增长发现/);
    assert.match(candidate.social_selection_reason,/2,345 Stars/);
    assert.match(store.getCandidate(candidate.id).social_selection_reason,/工具定位清晰/);
  } finally {store?.close();fs.rmSync(tempRoot,{recursive:true,force:true});}
});

test('图文编辑室按同一仓库提示历史图文覆盖', () => {
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-social-history-'));let store;
  try {
    store=new Store(path.join(tempRoot,'test.db'));
    const oldBatch=store.createBatch({date:'2026-07-22',title:'历史批次'});
    store.addHotspots(oldBatch.id,'github',[{title:'owner/tool',url:'https://github.com/owner/tool',repository:'owner/tool'}]);
    store.addCandidates(oldBatch.id,[store.getBatch(oldBatch.id).hotspots[0].id],{tracks:['social_cards']});
    const oldCandidate=store.listCandidates(oldBatch.id,'social_cards')[0];
    const html=path.join(tempRoot,'my-design.html');fs.writeFileSync(html,'<html></html>');const stat=fs.statSync(html);
    store.upsertArtifact({batchId:oldBatch.id,candidateId:oldCandidate.id,track:'social_cards',kind:'图文设计 HTML',name:'my-design.html',path:html,size:stat.size,modifiedAt:'2026-07-22T08:00:00.000Z'});
    const newBatch=store.createBatch({date:'2026-07-23',title:'当前批次'});
    store.addHotspots(newBatch.id,'github',[{title:'owner/tool 新版本',url:'https://github.com/owner/tool',repository:'owner/tool'}]);
    store.addCandidates(newBatch.id,[store.getBatch(newBatch.id).hotspots[0].id],{tracks:['social_cards']});
    const current=store.listCandidates(newBatch.id,'social_cards')[0];
    const similar=store.findSimilarSocialCards(current.id);
    assert.equal(similar.length,1);
    assert.equal(similar[0].candidateRowId,oldCandidate.id);
    assert.equal(similar[0].reason,'同一仓库');
  } finally {store?.close();fs.rmSync(tempRoot,{recursive:true,force:true});}
});

test('多报道事件研判落池为事件级综合候选并携带评分，重跑幂等', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-event-candidate-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-23', title: '事件候选测试' });
    store.addHotspots(batch.id, 'rsshub', [{ title: '事件A 报道一' }, { title: '事件A 报道二' }, { title: '事件B 唯一报道' }]);
    const [a1, a2, b1] = store.getBatch(batch.id).hotspots;
    const records = [
      { hotspotId:a1.id, hotspotIds:[a1.id, a2.id], title:'事件A 报道一', poolRole:'核心8条', riskLevel:'低', angle:'角度A', thesis:'命题A', distributionLane:'通知池', readerStake:'影响开发者岗位选择', h:70, b:60, p:40, s:2, d:0, f:58, eventValue:82, a:68 },
      { hotspotId:b1.id, title:'事件B 唯一报道', poolRole:'黑马2条', riskLevel:'低', angle:'角度B', thesis:'命题B', h:60, b:60, p:40, s:2, d:0, f:52 },
    ];
    store.saveAnalyzedCandidates(batch.id, records);
    const list = store.listCandidates(batch.id, 'article');
    assert.equal(list.length, 2);
    const composite = list.find((item) => item.composite);
    assert.ok(composite, '多报道事件应落池为综合候选');
    assert.equal(composite.hotspot_count, 2);
    assert.equal(composite.pool_role, '核心8条');
    assert.equal(composite.f_score, 58);
    assert.equal(composite.event_value, 82);
    assert.equal(composite.article_value, 68);
    assert.equal(composite.distribution_lane, '通知池');
    assert.equal(composite.reader_stake, '影响开发者岗位选择');
    assert.equal(composite.status, 'analyzed');
    const single = list.find((item) => !item.composite);
    assert.equal(single.hotspot_id, b1.id);
    // 重跑研判：相同事件不重复创建候选，分数更新
    store.saveAnalyzedCandidates(batch.id, [{ ...records[0], f: 61 }]);
    const again = store.listCandidates(batch.id, 'article');
    assert.equal(again.length, 2);
    assert.equal(again.find((item) => item.composite).f_score, 61);
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('已锁定候选保留历史内容路线快照，不被新一轮分类覆盖', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-locked-route-snapshot-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-23', title: '历史路线快照' });
    store.addHotspots(batch.id, 'github', [{ title: '历史项目', url: 'https://github.com/acme/demo' }]);
    const hotspot = store.getBatch(batch.id).hotspots[0];
    store.saveAnalyzedCandidates(batch.id, [{ hotspotId: hotspot.id, poolRole: '核心8条', riskLevel: '低', angle: '项目角度', thesis: '项目命题', contentClass: 'github_project', contentRoute: 'social_only', articleEligible: false, h: 20, b: 20, p: 20, f: 20 }]);
    const candidate = store.listCandidates(batch.id, 'article')[0];
    store.updateCandidateTrack(candidate.id, 'article', { status: 'locked' });
    store.saveAnalyzedCandidates(batch.id, [{ hotspotId: hotspot.id, poolRole: '核心8条', riskLevel: '低', angle: '新闻角度', thesis: '新闻命题', contentClass: 'news_event', contentRoute: 'article', articleEligible: true, h: 80, b: 80, p: 80, f: 80 }]);
    const preserved = store.getCandidate(candidate.id);
    assert.equal(preserved.content_class, 'github_project');
    assert.equal(preserved.content_route, 'social_only');
    assert.equal(preserved.article_eligible, 0);
    assert.equal(preserved.tracks.find((track) => track.track === 'article').status, 'locked');
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('议题综合候选按标题去重、刷新成员并优先展示自身标题', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-topic-dedup-'));
  let store;
  try {
    store = new Store(path.join(tempRoot, 'test.db'));
    const batch = store.createBatch({ date: '2026-07-23', title: '议题去重测试' });
    store.addHotspots(batch.id, 'rsshub', [{ title: '刚刚，全球三大AI包揽IMO满分' }, { title: 'Kimi 发布新模型' }, { title: 'Kimi 融资传闻' }]);
    const [h1, h2, h3] = store.getBatch(batch.id).hotspots;
    const title = '关于"Kimi"的近期热点综述';
    const first = store.createCompositeCandidate(batch.id, [h1.id, h2.id], { title });
    const display = store.listCandidates(batch.id, 'article').find((item) => item.id === first.id);
    assert.equal(display.hotspot_title, title);
    // 同一标题重跑：复用候选并刷新成员，而不是新建
    const found = store.findCompositeByTitle(batch.id, title);
    assert.equal(found.id, first.id);
    store.replaceCompositeMembers(first.id, [h2.id, h3.id], batch.id);
    assert.equal(store.listCandidates(batch.id, 'article').filter((item) => item.composite).length, 1);
    const members = store.candidateHotspots(first.id).map((item) => item.id);
    assert.deepEqual(members, [h2.id, h3.id].sort((a, b) => a - b));
  } finally {
    store?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('重复生成按任务和用途精确查找最近快照', () => {
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-snapshot-lookup-'));let store;
  try{
    store=new Store(path.join(tempRoot,'test.db'));
    const batch=store.createBatch({date:'2026-07-29',title:'快照测试'});
    store.addHotspots(batch.id,'rsshub',[{title:'候选一'},{title:'候选二'}]);
    const hotspots=store.getBatch(batch.id).hotspots;
    store.addCandidates(batch.id,hotspots.map((item)=>item.id),{tracks:['article']});
    const [candidate,other]=store.listCandidates(batch.id,'article');
    store.saveGenerationSnapshot({batchId:batch.id,candidateId:candidate.id,purpose:'article',snapshot:{marker:'old'}});
    store.saveGenerationSnapshot({batchId:batch.id,candidateId:candidate.id,purpose:'typeset',snapshot:{marker:'other'}});
    const latest=store.saveGenerationSnapshot({batchId:batch.id,candidateId:candidate.id,purpose:'article',snapshot:{marker:'new'}});
    store.saveGenerationSnapshot({batchId:batch.id,candidateId:other.id,purpose:'article',snapshot:{marker:'wrong-candidate'}});
    const found=store.findLatestGenerationSnapshot({batchId:batch.id,candidateId:candidate.id,purposes:['article']});
    assert.equal(found.id,latest.id);
    assert.equal(found.snapshot.marker,'new');
  }finally{store?.close();fs.rmSync(tempRoot,{recursive:true,force:true});}
});

test('图文候选描述优先用打标中文理由，ai-search 通道展示兴趣契合分', () => {
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-social-tagreason-'));let store;
  try {
    store=new Store(path.join(tempRoot,'test.db'));
    const batch=store.createBatch({date:'2026-08-07',title:'图文候选打标理由'});
    store.addHotspots(batch.id,'github',[{title:'owner/ai-tool',url:'https://github.com/owner/ai-tool',description:'messy english description',stars:900,discoveryChannels:['ai-search'],interestScore:9,interestReason:'读者会想用'}]);
    const hotspot=store.getBatch(batch.id).hotspots[0];
    store.updateHotspotTags(hotspot.id,{category:'🤖 AI/技术动态',chinaRelevance:10,relevanceReason:'国内 AI 开发者会立刻想试用的 Agent 工具'});
    store.saveSocialPreselection(batch.id,[{hotspotId:hotspot.id,socialScore:80,socialScoreDetails:{toolClarity:18,scenarioValue:14,demonstrability:15,visualPotential:12,saveSearchValue:13,sourceCompleteness:18,finalScore:80}}]);
    const candidate=store.listCandidates(batch.id,'social_cards')[0];
    assert.equal(candidate.repository_description,'国内 AI 开发者会立刻想试用的 Agent 工具');
    assert.match(candidate.social_selection_reason,/AI 兴趣发现 · 兴趣契合 9\/10/);
  } finally {store?.close();fs.rmSync(tempRoot,{recursive:true,force:true});}
});
