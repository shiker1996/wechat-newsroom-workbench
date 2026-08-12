import fs from 'node:fs';
import path from 'node:path';
import { collectReddit } from '../../plugins/collectors/reddit/collector.mjs';
import { collectRssHub } from '../../plugins/collectors/rsshub/collector.mjs';
import { discoverGitHubRepositories } from '../../plugins/collectors/github-discovery/collector.mjs';
import { filterCollectedItems } from '../domain/collection-quality.mjs';
import { tagBatch } from '../llm/tasks.mjs';
import { ensureBatchEventCards, runResearchPipeline } from '../llm/research-pipeline.mjs';
import { syncLegacyCollectionSources } from '../collectors/legacy-source-adapter.mjs';
import { createCollectorRuntime } from '../collectors/runtime-registry.mjs';
import { createStoreCollectionRunner } from '../collectors/store-runner.mjs';
import { ExtensionConfigurationService } from '../extensions/configuration-service.mjs';
import { legacyCollectorConfiguration } from '../extensions/legacy-collector-configuration.mjs';

function cachedAiQuery(config, sourceKey) {
  const label=String(sourceKey).slice('github:ai-search:'.length);
  try {
    const file=path.join(config.workspaceRoot,'data','repo-discovery-queries.json');
    const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
    return (parsed.queries||[]).find((item)=>String(item.label)===label)||null;
  } catch { return null; }
}

async function retrySubscription({ failure, store, config, onProgress }) {
  const detail=failure.detail||{};const sourceKey=String(detail.sourceKey||'');let lastResult=null;
  syncLegacyCollectionSources(config,store.repositories.collectionSources);
  const unifiedSource=detail.collectionSourceId?store.getCollectionSource(detail.collectionSourceId):store.repositories.collectionSources.getByKey(sourceKey);
  if(unifiedSource){
    const query=sourceKey.startsWith('github:ai-search:')?cachedAiQuery(config,sourceKey):null;
    const configuration=new ExtensionConfigurationService({root:config.workspaceRoot,repository:store.repositories.extensionSettings});const runner=createStoreCollectionRunner({store,registry:await createCollectorRuntime({root:config.workspaceRoot,config,configurationResolver:(manifest)=>configuration.resolve({extensionType:'collector',extensionId:manifest.id,manifest})})});
    const run=await runner.run({batchId:failure.batch_id,sourceIds:[unifiedSource.id],retry:{active:true,failureId:failure.id,retryCount:failure.retry_count||0}});
    const result=run.results[0];if(!result||result.status!=='ok')throw new Error(result?.error?.message||'数据源重试未返回成功结果');
    const quality=filterCollectedItems(run.items);const sourceGroup=unifiedSource.source_type==='reddit'?'reddit':unifiedSource.source_type==='github'?'github':'rsshub';store.addHotspots(failure.batch_id,sourceGroup,quality.kept);
    return {collectionSourceId:unifiedSource.id,itemCount:quality.kept.length,dropped:quality.dropped.length};
  }
  const onSourceResult=(result)=>{lastResult=result;store.recordSubscriptionRun(failure.batch_id,result,{indexFailure:false});};
  let items=[];let sourceGroup=detail.sourceGroup||'rsshub';
  if(sourceKey.startsWith('reddit:r/')) {
    const subreddit=sourceKey.slice('reddit:r/'.length);
    items=await collectReddit({...config.reddit,subreddits:[subreddit]},onProgress,onSourceResult);
    sourceGroup='reddit';
  } else if(sourceKey==='github:search'||sourceKey.startsWith('github:ai-search:')) {
    const query=sourceKey.startsWith('github:ai-search:')?cachedAiQuery(config,sourceKey):null;
    if(sourceKey.startsWith('github:ai-search:')&&!query)throw new Error('找不到该 AI 兴趣来源的原始查询，无法精确重试');
    items=await discoverGitHubRepositories([],{
      ...config.githubDiscovery,cacheDir:path.join(config.workspaceRoot,'data','github-cache'),
      searchEnabled:sourceKey==='github:search',aiQueries:query?[query]:[],
    },onProgress,onSourceResult);
    sourceGroup='github';
  } else {
    let routes=[];let directFeeds=[];let collectionScope=sourceGroup==='github'?'github':'rsshub';
    if(sourceKey.startsWith('direct:')) directFeeds=[{url:sourceKey.slice('direct:'.length),label:failure.title,enabled:true}];
    else if(sourceKey.startsWith('github:trending:')) routes=[`/github/trending/${sourceKey.slice('github:trending:'.length)}/any?limit=30`];
    else if(sourceKey.includes(':')) routes=[sourceKey.slice(sourceKey.indexOf(':')+1)];
    else throw new Error(`不支持精确重试的数据源：${sourceKey}`);
    items=await collectRssHub({...config.rsshub,routes,directFeeds,disabledRoutes:[],collectionScope,
      githubDiscovery:{...config.githubDiscovery,enabled:false}},onProgress,onSourceResult);
  }
  if(!lastResult||lastResult.status!=='success')throw new Error(lastResult?.error||'数据源重试未返回成功结果');
  const quality=filterCollectedItems(items);
  store.addHotspots(failure.batch_id,sourceGroup,quality.kept);
  return {subscriptionRun:lastResult,itemCount:quality.kept.length,dropped:quality.dropped.length};
}

async function retryTopSource({ failure, store, config, onProgress }) {
  if(failure.title!=='reddit')throw new Error('顶层来源汇总不能精确重试，请重试下方具体订阅源');
  const results=[];const items=await collectReddit(config.reddit,onProgress,(result)=>{
    results.push(result);store.recordSubscriptionRun(failure.batch_id,result,{indexFailure:false});
  });
  const quality=filterCollectedItems(items);store.addHotspots(failure.batch_id,'reddit',quality.kept);
  if(!results.some((item)=>item.status==='success'))throw new Error('所有 Reddit 分区仍采集失败');
  return {sources:results,itemCount:quality.kept.length,dropped:quality.dropped.length};
}

export async function retryPipelineFailure({ failureId, batchId, provider, store, gateway, config, onProgress=()=>{}, researchRunner=runResearchPipeline }) {
  const failure=store.getPipelineFailure(failureId);
  if(!failure||failure.batch_id!==batchId)throw new Error('失败记录不存在');
  if(!['open','retrying'].includes(failure.status))throw new Error(`失败记录当前状态不可重试：${failure.status}`);
  if(!store.startPipelineFailureRetry(failure.id))throw new Error('失败记录已被其他操作处理');
  try {
    let result;
    if(failure.stage==='collect'&&failure.object_type==='subscription') result=await retrySubscription({failure,store,config,onProgress});
    else if(failure.stage==='collect'&&failure.object_type==='source') result=await retryTopSource({failure,store,config,onProgress});
    else if(failure.stage==='tag'&&failure.hotspot_id) {
      result=await tagBatch({gateway,store,batchId,provider,hotspotIds:[failure.hotspot_id],force:true,
        maxAgeHours:store.getBatch(batchId)?.max_age_hours||168,workspaceRoot:config.workspaceRoot,onProgress});
      if(result.failed||result.updated!==1)throw new Error(result.failed?'该热点重试后仍未返回有效标注':'目标热点不在当前可打标范围内');
    } else if(failure.stage==='event-card') {
      const eventId=failure.detail?.eventId||failure.object_key.replace(/^event:/,'');
      result=await ensureBatchEventCards({gateway,store,batchId,provider,eventIds:[eventId],
        maxAgeHours:store.getBatch(batchId)?.max_age_hours||168,workspaceRoot:config.workspaceRoot,onProgress});
      if(result.failed.some((item)=>item.event_id===eventId)||!result.clusters.some((item)=>item.event_id===eventId&&item.card))
        throw new Error('该事件重试后仍未生成有效事件卡');
    } else if(failure.stage==='research'&&failure.object_type==='stage') {
      result=await researchRunner({gateway,store,batchId,provider,
        maxAgeHours:store.getBatch(batchId)?.max_age_hours||168,workspaceRoot:config.workspaceRoot,onProgress});
    } else throw new Error('该失败类型暂不支持单条重试');
    store.resolvePipelineFailure(failure.id);
    return {failure:store.getPipelineFailure(failure.id),result};
  } catch(error) {
    store.failPipelineFailureRetry(failure.id,error.message,{...failure.detail,lastRetryError:error.message});
    throw error;
  }
}
