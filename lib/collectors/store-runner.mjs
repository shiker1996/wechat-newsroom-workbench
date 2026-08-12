import { CollectionRunner } from './runner.mjs';

export function createStoreCollectionRunner({store,registry}){
  const subscriptionRuns=new Map();
  const runner=new CollectionRunner({registry,sourceRepository:store.repositories.collectionSources,
    onSourceResult:(record)=>{const id=store.recordSubscriptionRun(record.batchId,{
      sourceGroup:record.sourceType,sourceType:record.sourceType,sourceKey:record.sourceKey,sourceName:record.sourceName,
      status:record.status==='ok'?'success':'failed',itemCount:record.itemCount,durationMs:record.durationMs,
      error:record.error?.message||'',startedAt:new Date(Date.now()-record.durationMs).toISOString(),endedAt:new Date().toISOString(),
    },{indexFailure:false});subscriptionRuns.set(record.sourceId,id);},
    onFailure:(record)=>store.recordPipelineFailure({batchId:record.batchId,stage:'collect',objectType:'subscription',
      objectKey:`source:${record.sourceId}`,subscriptionRunId:subscriptionRuns.get(record.sourceId)||null,title:record.sourceName,errorCode:record.error.code,errorMessage:record.error.message,
      detail:{collectionSourceId:record.sourceId,pluginId:record.pluginId,pluginVersion:record.pluginVersion,sourceKey:record.sourceKey,
        errorCode:record.error.code,retryable:record.retryable,action:record.action||''}}),
  });return runner;
}
