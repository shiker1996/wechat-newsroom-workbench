import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { CollectorRegistry } from '../server/platform/collectors/registry.mjs';
import { CollectionRunner } from '../server/features/collection/application/collection-runner.mjs';
import { normalizeCollectorResult, validateCollectorManifest } from '../server/platform/collectors/contracts.mjs';
import { createBuiltinCollectorRegistry } from '../server/platform/collectors/builtin-registry.mjs';
import { createStoreCollectionRunner } from '../server/features/collection/application/store-collection-runner.mjs';
import { CollectionSourceService } from '../server/features/collection/application/source-service.mjs';

function manifest(id='demo-collector'){const inputSchema={type:'object',additionalProperties:false,required:['url'],properties:{url:{type:'string',format:'url'}}};return {schemaVersion:1,id,name:'演示采集器',version:'1.0.0',kind:'collector',entry:'./adapter.mjs',capabilities:['cap_collect_demo'],riskLevel:'network-read',inputSchema,outputSchema:{type:'object',properties:{items:{type:'array'}}},runtime:{timeoutMs:10000,concurrency:'parallel'},collector:{sourceTypes:['demo'],sourceConfigSchema:inputSchema}};}
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

test('用户暂停采集源后 upsert 不会重新启用',t=>{
  const {store}=workspace(t);const repository=store.repositories.collectionSources;
  repository.upsert({pluginId:'rsshub-collector',pluginVersion:'builtin',sourceType:'rsshub',sourceKey:'rsshub:/readhub/daily',label:'每日读',config:{route:'/readhub/daily?limit=30'},enabled:true,origin:'unified-api'});
  const source=repository.getByKey('rsshub:/readhub/daily');
  repository.setEnabled(source.id,false);
  repository.upsert({pluginId:'rsshub-collector',pluginVersion:'builtin',sourceType:'rsshub',sourceKey:'rsshub:/readhub/daily',label:'每日读',config:{route:'/readhub/daily?limit=30'},enabled:true,origin:'unified-api'});
  assert.equal(repository.getByKey('rsshub:/readhub/daily').enabled,false,'upsert 应保留用户手动暂停状态');
});

test('删除采集源后不再出现在列表中',t=>{
  const {store}=workspace(t);const repository=store.repositories.collectionSources;
  repository.upsert({pluginId:'rsshub-collector',pluginVersion:'builtin',sourceType:'rsshub',sourceKey:'rsshub:/readhub/daily',label:'每日读',config:{route:'/readhub/daily?limit=30'},enabled:true,origin:'unified-api'});
  const source=repository.getByKey('rsshub:/readhub/daily');
  assert.equal(repository.remove(source.id),true);
  assert.equal(store.listCollectionSources().length,0,'删除后列表不再出现该来源');
  assert.equal(repository.getByKey('rsshub:/readhub/daily'),null);
});

test('用户通过统一 API 重新添加已删除来源时恢复为可用状态',t=>{
  const {store}=workspace(t);const repository=store.repositories.collectionSources;
  repository.upsert({pluginId:'rsshub-collector',pluginVersion:'builtin',sourceType:'rsshub',sourceKey:'rsshub:/readhub/daily',label:'每日读',config:{route:'/readhub/daily?limit=30'},enabled:true,origin:'unified-api'});
  const source=repository.getByKey('rsshub:/readhub/daily');
  repository.remove(source.id);
  const revived=repository.upsert({pluginId:'rsshub-collector',pluginVersion:'builtin',sourceType:'rsshub',sourceKey:'rsshub:/readhub/daily',label:'手动重加',config:{route:'/readhub/daily?limit=30'},enabled:true,origin:'unified-api'});
  assert.ok(revived,'重新 upsert 应返回可用来源');
  assert.equal(revived.dismissed,false);
  assert.equal(store.listCollectionSources().length,1);
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
