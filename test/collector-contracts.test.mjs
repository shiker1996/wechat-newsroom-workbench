import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { Store } from '../lib/core/store.mjs';
import { CollectorRegistry } from '../lib/collectors/registry.mjs';
import { CollectionRunner } from '../lib/collectors/runner.mjs';
import { normalizeCollectorResult, validateCollectorManifest } from '../lib/collectors/contracts.mjs';
import { syncLegacyCollectionSources } from '../lib/collectors/legacy-source-adapter.mjs';
import { createBuiltinCollectorRegistry } from '../lib/collectors/builtin-registry.mjs';
import { createStoreCollectionRunner } from '../lib/collectors/store-runner.mjs';
import { CollectionSourceService } from '../lib/collectors/source-service.mjs';

function manifest(id='demo-collector'){const inputSchema={type:'object',additionalProperties:false,required:['url'],properties:{url:{type:'string',format:'url'}}};return {schemaVersion:1,id,name:'演示采集器',version:'1.0.0',kind:'collector',entry:'./adapter.mjs',capabilities:['collect.demo'],riskLevel:'network-read',inputSchema,outputSchema:{type:'object',properties:{items:{type:'array'}}},runtime:{timeoutMs:10000,concurrency:'parallel'},collector:{sourceTypes:['demo'],sourceConfigSchema:inputSchema}};}
function workspace(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'collector-stage0-'));const store=new Store(path.join(root,'workbench.db'));t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});return {root,store};}

test('Collector Manifest、来源配置和标准输出执行严格校验',()=>{
  assert.deepEqual(validateCollectorManifest(manifest()),[]);
  assert.ok(validateCollectorManifest({...manifest(),kind:'tool'}).length);
  assert.equal(normalizeCollectorResult({status:'ok',items:[{title:'有效内容',url:'https://example.com/a'}]}).status,'ok');
  assert.equal(normalizeCollectorResult({status:'ok',items:[{title:'',url:'https://example.com/a'}]}).error.code,'OUTPUT_INVALID');
});

test('阶段 0 注册全部内置采集器清单但不提前切换执行实现',()=>{
  const registry=createBuiltinCollectorRegistry();
  assert.deepEqual(registry.list().map((item)=>item.id),['browser-web-page','declarative-web-page','feed-collector','github-discovery-collector','reddit-collector','rsshub-collector']);
  assert.equal(registry.resolveSourceType('reddit').manifest.id,'reddit-collector');
  assert.equal(registry.resolveSourceType('twitter').manifest.id,'rsshub-collector');
});

test('采集能力按启用状态和优先级解析，并在绑定实现停用时选择兼容兜底',async t=>{
  const primary=manifest('primary'),fallback=manifest('fallback');
  const registry=new CollectorRegistry({settings:{primary:{enabled:false,priority:10},fallback:{enabled:true,priority:2}}})
    .register({manifest:primary,adapter:{collect:async()=>({status:'ok',items:[]})}})
    .register({manifest:fallback,adapter:{collect:async()=>({status:'ok',items:[{title:'兜底',url:'https://example.com/fallback'}]})}});
  assert.equal(registry.resolveSourceType('demo').manifest.id,'fallback');
  const {store}=workspace(t);store.repositories.collectionSources.upsert({pluginId:'primary',pluginVersion:'1.0.0',sourceType:'demo',sourceKey:'demo:fallback',label:'兜底源',config:{url:'https://example.com'}});
  const result=await new CollectionRunner({registry,sourceRepository:store.repositories.collectionSources}).run({batchId:'b'});
  assert.equal(result.results[0].pluginId,'fallback');assert.equal(result.items[0].title,'兜底');
});

test('采集器运行失败时按候选链兜底并记录实际尝试',async t=>{
  const primary=manifest('primary'),backup=manifest('backup');let backupCalls=0;
  const registry=new CollectorRegistry({settings:{primary:{priority:10},backup:{priority:1}}}).register({manifest:primary,adapter:{collect:async()=>{throw new Error('network down');}}}).register({manifest:backup,adapter:{collect:async()=>{backupCalls+=1;return {status:'ok',items:[{title:'备用',url:'https://example.com/backup'}]};}}});
  const {store}=workspace(t);store.upsertCollectionSource({pluginId:'primary',sourceType:'demo',sourceKey:'demo:runtime-fallback',label:'运行兜底',config:{url:'https://example.com'}});
  const result=await new CollectionRunner({registry,sourceRepository:store.repositories.collectionSources}).run({batchId:'fallback'});assert.equal(backupCalls,1);assert.equal(result.results[0].pluginId,'backup');assert.equal(result.results[0].fallbackUsed,true);assert.deepEqual(result.results[0].attempts.map((item)=>item.pluginId),['primary','backup']);
});

test('CollectionRunner 单来源失败不阻断其余来源并补充核心身份字段',async t=>{
  const {store}=workspace(t);const repository=store.repositories.collectionSources;
  repository.upsert({pluginId:'demo-collector',pluginVersion:'1.0.0',sourceType:'demo',sourceKey:'demo:ok',label:'正常源',config:{url:'https://example.com/ok'}});
  repository.upsert({pluginId:'demo-collector',pluginVersion:'1.0.0',sourceType:'demo',sourceKey:'demo:bad',label:'失败源',config:{url:'https://example.com/bad'}});
  const registry=new CollectorRegistry().register({manifest:manifest(),adapter:{collect:async(config)=>{if(config.url.endsWith('/bad'))throw new Error('network down');return {status:'ok',items:[{externalId:'1',title:'标题',url:'https://example.com/item'}]};}}});
  const failures=[];const runner=new CollectionRunner({registry,sourceRepository:repository,onFailure:(item)=>failures.push(item)});
  const result=await runner.run({batchId:'batch-demo'});
  assert.equal(result.status,'ok');assert.equal(result.results.length,2);assert.equal(result.items.length,1);
  assert.equal(result.items[0].sourceKey,'demo:ok');assert.equal(failures[0].error.code,'NETWORK_ERROR');
});

test('未加载插件和无效来源配置都形成来源级失败',async t=>{
  const {store}=workspace(t);store.repositories.collectionSources.upsert({pluginId:'missing-collector',sourceType:'demo',sourceKey:'demo:missing',label:'缺插件',config:{}});
  const failures=[];const runner=new CollectionRunner({registry:new CollectorRegistry(),sourceRepository:store.repositories.collectionSources,onFailure:(item)=>failures.push(item)});
  const result=await runner.run({batchId:'batch-demo'});
  assert.equal(result.status,'error');assert.equal(failures[0].sourceKey,'demo:missing');assert.equal(failures[0].error.code,'DEPENDENCY_MISSING');
});

test('旧订阅配置幂等同步到 collection_sources 且不改变旧响应身份',t=>{
  const {store}=workspace(t);const config={rsshub:{routes:['/twitter/user/OpenAI?limit=30','/readhub/daily?limit=30','/github/trending/daily/any?limit=30'],disabledRoutes:['/readhub/daily?limit=30'],directFeeds:[{url:'https://example.com/feed.xml',label:'Example',enabled:true}]},githubDiscovery:{enabled:true,createdWithinDays:30}};
  const first=syncLegacyCollectionSources(config,store.repositories.collectionSources);const second=syncLegacyCollectionSources(config,store.repositories.collectionSources);
  assert.equal(first.length,5);assert.equal(second.length,5);assert.equal(store.listCollectionSources().length,5);
  assert.equal(store.repositories.collectionSources.getByKey('rsshub:/readhub/daily').enabled,false);
  assert.equal(store.repositories.collectionSources.getByKey('github:search').managed,true);
});

test('collection_sources 数据库迁移幂等并保留稳定 source_key',t=>{
  const {store}=workspace(t);const row=store.upsertCollectionSource({pluginId:'demo-collector',sourceType:'demo',sourceKey:'demo:stable',label:'A',config:{url:'https://example.com/a'}});
  const updated=store.upsertCollectionSource({pluginId:'demo-collector',sourceType:'demo',sourceKey:'demo:stable',label:'B',config:{url:'https://example.com/b'}});
  assert.equal(updated.id,row.id);assert.equal(updated.label,'B');assert.equal(store.listCollectionSources().length,1);
});

test('session 采集器对多个 Reddit 来源只调用一次 collectMany',async t=>{
  const {store}=workspace(t);for(const subreddit of ['programming','node'])store.upsertCollectionSource({pluginId:'reddit-collector',sourceType:'reddit',sourceKey:`reddit:r/${subreddit}`,label:`r/${subreddit}`,config:{subreddit,sort:'hot',limit:10}});
  let sessions=0;const adapter={collect:async()=>{throw new Error('不应逐源调用');},collectMany:async(sources)=>{sessions+=1;return sources.map((source)=>({sourceId:source.id,result:{status:'ok',items:[{title:source.label,url:`https://example.com/${source.id}`}],warnings:[],provenance:{}}}));}};
  const registry=createBuiltinCollectorRegistry({'reddit-collector':adapter});const runner=new CollectionRunner({registry,sourceRepository:store.repositories.collectionSources});
  const result=await runner.run({batchId:'batch-demo',sourceTypes:['reddit']});assert.equal(sessions,1);assert.equal(result.items.length,2);
});

test('统一 Runner 的来源失败写入 pipeline_failures 并关联 collectionSourceId',async t=>{
  const {store}=workspace(t);const batch=store.createBatch({date:'2026-08-12',title:'采集失败'});const source=store.upsertCollectionSource({pluginId:'demo-collector',sourceType:'demo',sourceKey:'demo:failure',label:'失败源',config:{url:'https://example.com/fail'}});
  const registry=new CollectorRegistry().register({manifest:manifest(),adapter:{collect:async()=>{throw new Error('timeout');}}});const runner=createStoreCollectionRunner({store,registry});
  await runner.run({batchId:batch.id,sourceIds:[source.id]});const failure=store.listPipelineFailures(batch.id)[0];
  assert.equal(failure.object_key,`source:${source.id}`);assert.equal(failure.error_code,'TIMEOUT');assert.equal(failure.detail.collectionSourceId,source.id);assert.ok(failure.subscription_run_id);
});

test('统一采集源服务规范化 Reddit 配置并支持启停与更新',t=>{
  const {store}=workspace(t);const registry=createBuiltinCollectorRegistry();
  const service=new CollectionSourceService({repository:store.repositories.collectionSources,registry});
  const created=service.create({pluginId:'reddit-collector',label:'开发社区',config:{subreddit:'r/programming',sort:'new',limit:8}});
  assert.equal(created.source_key,'reddit:r/programming');assert.equal(created.label,'开发社区');assert.equal(created.config.sort,'new');
  const updated=service.update(created.id,{config:{subreddit:'node',limit:12},enabled:false});
  assert.equal(updated.source_key,'reddit:r/node');assert.equal(updated.enabled,false);assert.equal(updated.config.limit,12);
});

test('采集源页面保留旧入口并接入 Reddit、动态表单和统一 API',()=>{
  const html=fs.readFileSync(path.resolve('public/index.html'),'utf8');const view=fs.readFileSync(path.resolve('public/src/views/subscriptions.js'),'utf8');const css=fs.readFileSync(path.resolve('public/styles.css'),'utf8');
  assert.match(html,/option value="reddit"/);assert.match(html,/id="source-plugin-fields"/);assert.match(html,/id="source-status-filter"/);
  assert.match(css,/\.source-plugin-fields\{[^}]*background:#1f2927;[^}]*color:#edf2ef/);
  assert.match(css,/\.source-compose \.source-plugin-fields input[^}]*color:#edf2ef;[^}]*background:#26312f/);
  assert.match(view,/\/api\/collection-sources/);assert.match(view,/sourceConfigSchema/);assert.match(view,/\/api\/subscriptions/);
});
