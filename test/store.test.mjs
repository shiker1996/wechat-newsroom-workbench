import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.mjs';

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
    const html=path.join(tempRoot,'my-design.html');fs.writeFileSync(html,'<html></html>');const stat=fs.statSync(html);
    store.upsertArtifact({batchId:batch.id,candidateId:candidate.id,track:'social_cards',kind:'图文设计 HTML',name:'my-design.html',path:html,size:stat.size,modifiedAt:'2026-07-22T08:00:00.000Z'});
    const entries=store.listCalendarContent({month:'2026-07'});
    assert.equal(entries.filter((item)=>item.content_type==='article').length,1);
    assert.equal(entries.filter((item)=>item.content_type==='social_cards').length,1);
    assert.equal(entries.find((item)=>item.content_type==='social_cards').candidate_row_id,candidate.id);
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
    assert.equal(candidate.repository_description,'帮助开发者自动整理复杂日志');
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
      { hotspotId:a1.id, hotspotIds:[a1.id, a2.id], title:'事件A 报道一', poolRole:'核心8条', riskLevel:'低', angle:'角度A', thesis:'命题A', h:70, b:60, p:40, s:2, d:0, f:58 },
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
