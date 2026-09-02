import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Store } from '../server/platform/core/store.mjs';
import { tagBatch } from '../server/features/research/llm/tasks.mjs';
import { ensureBatchEventCards } from '../server/features/research/application/research-pipeline.mjs';
import { retryPipelineFailure, skipPipelineFailure, reopenPipelineFailure } from '../server/features/batches/index.mjs';
import { classifyResearchFailure, recordResearchFailure } from '../server/features/research/index.mjs';

function workspace(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pipeline-failures-'));
  const store=new Store(path.join(root,'test.db'));
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  return {root,store};
}

test('采集失败按当前批次的订阅源与顶层来源执行持久化',t=>{
  const {store}=workspace(t);
  const batch=store.createBatch({date:'2026-08-11',title:'采集失败'});
  const startedAt=new Date().toISOString();
  const subscriptionId=store.recordSubscriptionRun(batch.id,{
    sourceGroup:'rsshub',sourceType:'rsshub',sourceKey:'rsshub:/readhub/daily',sourceName:'/readhub/daily',
    status:'failed',itemCount:0,durationMs:123,error:'HTTP 503',startedAt,endedAt:startedAt,
  });
  const sourceRunId=store.startSourceRun(batch.id,'reddit');
  store.finishSourceRun(sourceRunId,'failed',0,'所有 Reddit 分区均采集失败');
  const failures=store.listPipelineFailures(batch.id);
  assert.equal(failures.length,2);
  const subscription=failures.find((item)=>item.object_type==='subscription');
  assert.equal(subscription.subscription_run_id,subscriptionId);
  assert.equal(subscription.object_key,`subscription:${subscriptionId}`);
  assert.equal(subscription.detail.sourceKey,'rsshub:/readhub/daily');
  const source=failures.find((item)=>item.object_type==='source');
  assert.equal(source.source_run_id,sourceRunId);
  assert.equal(source.error_message,'所有 Reddit 分区均采集失败');
  assert.equal(store.getBatch(batch.id).pipeline_failures.length,2);
});

test('同一失败对象再次失败更新索引而不丢失首次失败时间',t=>{
  const {store}=workspace(t);
  const batch=store.createBatch({date:'2026-08-11',title:'失败去重'});
  const first=store.recordPipelineFailure({batchId:batch.id,stage:'tag',objectType:'hotspot',objectKey:'hotspot:7',
    errorMessage:'第一次失败',title:'热点'});
  const second=store.recordPipelineFailure({batchId:batch.id,stage:'tag',objectType:'hotspot',objectKey:'hotspot:7',
    errorMessage:'第二次失败',title:'热点'});
  assert.equal(first.id,second.id);
  assert.equal(second.first_failed_at,first.first_failed_at);
  assert.equal(second.error_message,'第二次失败');
  assert.equal(store.listPipelineFailures(batch.id).length,1);
});

test('打标达到单条重试上限后保存热点级失败记录',async t=>{
  const {store}=workspace(t);
  const batch=store.createBatch({date:'2026-08-11',title:'打标失败'});
  store.addHotspots(batch.id,'rsshub',[{title:'抽象数学问题',url:'https://example.com/math',publishedAt:new Date().toISOString()}]);
  const gateway={config:{defaultProvider:'deepseek',providers:{deepseek:{maxOutputTokens:8192,taggingChunkSize:1}}},async complete(){
    const callId=store.recordModelCall({provider:'deepseek',model:'test',purpose:'hotspot-tagging',batchId:batch.id,status:'completed'});
    return {callId,content:'{"items":[]}',finishReason:'stop',model:'test',context:{compressed:false,afterTokens:10},usage:{}};
  }};
  const result=await tagBatch({gateway,store,batchId:batch.id,provider:'deepseek',workspaceRoot:process.cwd(),runId:'tag-run'});
  assert.equal(result.failed,1);
  const [failure]=store.listPipelineFailures(batch.id);
  const hotspot=store.getBatch(batch.id).hotspots[0];
  assert.equal(failure.stage,'tag');
  assert.equal(failure.hotspot_id,hotspot.id);
  assert.equal(failure.run_id,'tag-run');
  assert.match(failure.error_message,/0\/1 条有效标注/);
});

test('事件卡达到重试上限后保存事件级失败记录',async t=>{
  const {root,store}=workspace(t);
  const batch=store.createBatch({date:'2026-08-11',title:'事件卡失败'});
  store.addHotspots(batch.id,'rsshub',[{title:'主体发布产品',url:'https://example.com/a',publishedAt:new Date().toISOString()}]);
  const hotspot=store.getBatch(batch.id).hotspots[0];
  store.updateHotspotTags(hotspot.id,{eventKey:'主体|发布产品',preScores:{conflict:1},eventParts:{who:'主体',what:'发布产品'}});
  const gateway={config:{defaultProvider:'deepseek',providers:{deepseek:{maxOutputTokens:8192,eventCardChunkSize:1,eventCardConcurrency:1}}},async complete(){
    const callId=store.recordModelCall({provider:'deepseek',model:'test',purpose:'event-card',batchId:batch.id,status:'completed'});
    return {callId,content:'not-json',finishReason:'stop',model:'test',context:{compressed:false,afterTokens:10},usage:{}};
  }};
  const result=await ensureBatchEventCards({gateway,store,batchId:batch.id,provider:'deepseek',workspaceRoot:root,runId:'card-run'});
  assert.equal(result.failed.length,1);
  const [failure]=store.listPipelineFailures(batch.id);
  assert.equal(failure.stage,'event-card');
  assert.equal(failure.object_type,'event');
  assert.equal(failure.run_id,'card-run');
  assert.equal(failure.detail.reportCount,1);
});

test('单条打标重试成功后自动解决原失败记录',async t=>{
  const {root,store}=workspace(t);const batch=store.createBatch({date:'2026-08-11',title:'补打'});
  store.addHotspots(batch.id,'rsshub',[{title:'待补打',url:'https://example.com/retry',publishedAt:new Date().toISOString()}]);
  const hotspot=store.getBatch(batch.id).hotspots[0];
  const failure=store.recordPipelineFailure({batchId:batch.id,stage:'tag',objectType:'hotspot',objectKey:`hotspot:${hotspot.id}`,
    hotspotId:hotspot.id,title:hotspot.title,url:hotspot.url,errorMessage:'模型漏回'});
  const gateway={config:{defaultProvider:'deepseek',providers:{deepseek:{maxOutputTokens:8192,taggingChunkSize:1}}},async complete(){
    return {callId:1,content:JSON.stringify({items:[{id:hotspot.id,eventParts:{who:'主体',what:'发布'},preScores:{conflict:1}}]}),
      finishReason:'stop',model:'test',context:{compressed:false,afterTokens:10},usage:{}};
  }};
  await retryPipelineFailure({failureId:failure.id,batchId:batch.id,provider:'deepseek',store,gateway,
    config:{workspaceRoot:root},onProgress:()=>{}});
  const resolved=store.getPipelineFailure(failure.id);
  assert.equal(resolved.status,'resolved');assert.equal(resolved.retry_count,1);assert.ok(resolved.resolved_at);
});

test('采集源重试只请求原 RSSHub route 并解决失败',async t=>{
  const {root,store}=workspace(t);const requests=[];
  const server=http.createServer((request,response)=>{requests.push(request.url);response.writeHead(200,{'content-type':'application/xml'});
    response.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>Retry Feed</title><item><title>重试成功热点</title><link>https://example.com/item</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`);});
  await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const batch=store.createBatch({date:'2026-08-11',title:'来源补采'});const failure=store.recordPipelineFailure({
    batchId:batch.id,stage:'collect',objectType:'subscription',objectKey:'subscription:999',title:'/retry-feed',errorMessage:'HTTP 503',
    detail:{sourceGroup:'rsshub',sourceType:'rsshub',sourceKey:'rsshub:/retry-feed',sourceName:'/retry-feed'},
  });
  await retryPipelineFailure({failureId:failure.id,batchId:batch.id,store,gateway:null,config:{workspaceRoot:root,
    reddit:{},githubDiscovery:{enabled:false},rsshub:{baseUrl:`http://127.0.0.1:${server.address().port}`,routes:[],directFeeds:[],
      disabledRoutes:[],keepAlive:true,maxAgeHours:24,allowUndated:true,routeTimeoutMs:2000}},onProgress:()=>{}});
  assert.deepEqual(requests,['/','/retry-feed?limit=30']);
  assert.equal(store.getPipelineFailure(failure.id).status,'resolved');
  assert.equal(store.getBatch(batch.id).hotspots.length,1);
});

test('单个事件卡重试成功后合并产物并解决失败',async t=>{
  const {root,store}=workspace(t);const batch=store.createBatch({date:'2026-08-11',title:'事件卡补生成'});
  store.addHotspots(batch.id,'rsshub',[{title:'主体发布新品',url:'https://example.com/event',publishedAt:new Date().toISOString()}]);
  const hotspot=store.getBatch(batch.id).hotspots[0];store.updateHotspotTags(hotspot.id,{eventKey:'主体|发布新品',
    eventParts:{who:'主体',what:'发布新品'},preScores:{conflict:1}});
  const failingGateway={config:{defaultProvider:'deepseek',providers:{deepseek:{maxOutputTokens:8192,eventCardChunkSize:1}}},async complete(){
    return {callId:1,content:'not-json',finishReason:'stop',context:{},usage:{}};
  }};
  await ensureBatchEventCards({gateway:failingGateway,store,batchId:batch.id,provider:'deepseek',workspaceRoot:root,runId:'first'});
  const failure=store.listPipelineFailures(batch.id)[0];
  const successGateway={config:failingGateway.config,async complete(input){const rows=JSON.parse(input.messages[1].content.replace(/^【极简重试】[^\n]*\n/,''));
    return {callId:2,finishReason:'stop',context:{compressed:false,afterTokens:10},usage:{},content:JSON.stringify({items:[{
      event_id:rows[0].event_id,conclusion:'补生成成功',confirmed_facts:['事实'],source_increment:[],disagreements:[],timeline:[],unverified:[],angles:[],
    }]})};}};
  await retryPipelineFailure({failureId:failure.id,batchId:batch.id,provider:'deepseek',store,gateway:successGateway,
    config:{workspaceRoot:root},onProgress:()=>{}});
  assert.equal(store.getPipelineFailure(failure.id).status,'resolved');
  const artifact=JSON.parse(fs.readFileSync(path.join(root,'topics',`${batch.id}-orchestrated`,'sources','event-cards.json'),'utf8'));
  assert.equal(artifact.items[0].conclusion,'补生成成功');
});

test('跳过打标热点会排除研究范围，恢复后重新纳入',t=>{
  const {store}=workspace(t);const batch=store.createBatch({date:'2026-08-11',title:'跳过打标'});
  store.addHotspots(batch.id,'rsshub',[{title:'失败热点',publishedAt:new Date().toISOString()}]);const hotspot=store.getBatch(batch.id).hotspots[0];
  const failure=store.recordPipelineFailure({batchId:batch.id,stage:'tag',objectType:'hotspot',objectKey:`hotspot:${hotspot.id}`,
    hotspotId:hotspot.id,title:hotspot.title,errorMessage:'缺少有效标注'});
  const skipped=skipPipelineFailure({failureId:failure.id,batchId:batch.id,reason:'与账号无关',store});
  assert.equal(skipped.status,'skipped');assert.equal(skipped.skip_reason,'与账号无关');
  assert.equal(store.getHotspot(hotspot.id).research_eligible,0);
  const reopened=reopenPipelineFailure({failureId:failure.id,batchId:batch.id,store});
  assert.equal(reopened.status,'open');assert.equal(store.getHotspot(hotspot.id).research_eligible,1);
});

test('跳过事件后事件卡生成范围排除该事件，恢复后重新出现',async t=>{
  const {root,store}=workspace(t);const batch=store.createBatch({date:'2026-08-11',title:'跳过事件'});
  store.addHotspots(batch.id,'rsshub',[{title:'事件一',publishedAt:new Date().toISOString()},{title:'事件二',publishedAt:new Date().toISOString()}]);
  const [one,two]=store.getBatch(batch.id).hotspots;store.updateHotspotTags(one.id,{eventKey:'主体甲|发布',eventParts:{who:'主体甲',what:'发布'},preScores:{conflict:1}});
  store.updateHotspotTags(two.id,{eventKey:'主体乙|融资',eventParts:{who:'主体乙',what:'融资'},preScores:{conflict:1}});
  const gateway={config:{defaultProvider:'x',providers:{x:{maxOutputTokens:8192}}},async complete(input){
    const rows=JSON.parse(input.messages[1].content);return {callId:1,finishReason:'stop',context:{},usage:{},content:JSON.stringify({items:rows.map((row)=>({event_id:row.event_id,conclusion:'卡片'}))})};}};
  const initial=await ensureBatchEventCards({gateway,store,batchId:batch.id,provider:'x',workspaceRoot:root});
  const eventId=initial.clusters[0].event_id;const failure=store.recordPipelineFailure({batchId:batch.id,stage:'event-card',objectType:'event',objectKey:`event:${eventId}`,
    title:initial.clusters[0].representative_title,errorMessage:'测试跳过',detail:{eventId}});
  skipPipelineFailure({failureId:failure.id,batchId:batch.id,reason:'信息不足',store});
  const skipped=await ensureBatchEventCards({gateway,store,batchId:batch.id,provider:'x',workspaceRoot:root});
  assert.equal(skipped.total,1);assert.ok(!skipped.clusters.some((event)=>event.event_id===eventId));
  reopenPipelineFailure({failureId:failure.id,batchId:batch.id,store});
  const reopened=await ensureBatchEventCards({gateway,store,batchId:batch.id,provider:'x',workspaceRoot:root});
  assert.equal(reopened.total,2);assert.ok(reopened.clusters.some((event)=>event.event_id===eventId));
});

test('批次级研判失败不允许跳过',t=>{
  const {store}=workspace(t);const batch=store.createBatch({date:'2026-08-11',title:'研判错误'});
  const failure=store.recordPipelineFailure({batchId:batch.id,stage:'research',objectType:'stage',objectKey:'stage:research',errorMessage:'聚类守恒失败'});
  assert.throws(()=>skipPipelineFailure({failureId:failure.id,batchId:batch.id,store}),/不能跳过/);
  assert.equal(store.getPipelineFailure(failure.id).status,'open');
});

test('研判错误分类并持久化为不可跳过的阶段失败',t=>{
  const {store}=workspace(t);const batch=store.createBatch({date:'2026-08-11',title:'研判持久化'});
  assert.equal(classifyResearchFailure(new Error('事件聚类门禁失败：报道数不守恒')).code,'cluster_invariant_failed');
  assert.equal(classifyResearchFailure(new Error('模型返回的 JSON 无效')).code,'invalid_model_output');
  const failure=recordResearchFailure({store,job:{id:'research-run',batchId:batch.id,provider:'deepseek',phase:'research'},
    error:new Error('探索脑暴没有返回有效候选')});
  assert.equal(failure.stage,'research');assert.equal(failure.object_type,'stage');
  assert.equal(failure.error_code,'empty_brainstorm');assert.equal(failure.detail.skippable,false);
});

test('阶段3研判失败优先以阶段3模式重试并在成功后解决',async t=>{
  const {root,store}=workspace(t);const batch=store.createBatch({date:'2026-08-11',title:'研判重试'});
  const failure=store.recordPipelineFailure({batchId:batch.id,stage:'research',objectType:'stage',objectKey:'stage:research',
    title:'事件研判',errorCode:'invalid_model_output',errorMessage:'阶段 3 模型输出 JSON 无效',detail:{phase:'topic_generation',skippable:false}});
  let calls=0;const response=await retryPipelineFailure({failureId:failure.id,batchId:batch.id,provider:'deepseek',store,gateway:{},
    config:{workspaceRoot:root},researchRunner:async(input)=>{calls+=1;assert.equal(input.batchId,batch.id);assert.equal(input.resumeFrom,'topic_generation');return {candidates:3};}});
  assert.equal(calls,1);assert.deepEqual(response.result,{candidates:3});
  assert.equal(store.getPipelineFailure(failure.id).status,'resolved');
});
