import { collectorFailure, normalizeCollectorResult, validateSourceConfiguration } from './contracts.mjs';
import { shouldFallback } from '../tools/fallback-policy.mjs';

function caught(error){const message=String(error?.message||error);if(error?.code)return collectorFailure(error.code,message,{retryable:error.code!=='INVALID_SOURCE_CONFIG'&&error.code!=='SELECTOR_MISMATCH'});if(/timeout|aborted/i.test(message))return collectorFailure('TIMEOUT',message,{retryable:true});return collectorFailure('NETWORK_ERROR',message,{retryable:true});}

export class CollectionRunner{
  constructor({registry,sourceRepository,onSourceResult=()=>{},onFailure=()=>{}}){this.registry=registry;this.sourceRepository=sourceRepository;this.onSourceResult=onSourceResult;this.onFailure=onFailure;}
  async run({batchId,sourceIds=null,sourceTypes=null,retry=null,signal=null,limits={}}){
    const sources=this.sourceRepository.listEnabled({ids:sourceIds,sourceTypes});const results=[];
    const sessionGroups=new Map();const regular=[];
    for(const source of sources){const plugin=this.registry.get(source.plugin_id);if(plugin?.manifest.runtime.concurrency==='session'&&typeof plugin.adapter.collectMany==='function'){
      const group=sessionGroups.get(source.plugin_id)||{plugin,sources:[]};group.sources.push(source);sessionGroups.set(source.plugin_id,group);
    }else regular.push(source);}
    for(const {plugin,sources:groupSources} of sessionGroups.values()){
      const started=Date.now();let outputs;
      try{outputs=await plugin.adapter.collectMany(groupSources,Object.freeze({batchId,retry:retry||{active:false,failureId:null,retryCount:0},signal,limits}));}
      catch(error){outputs=groupSources.map((source)=>({sourceId:source.id,result:caught(error)}));}
      for(const source of groupSources){const output=outputs.find((item)=>Number(item.sourceId)===Number(source.id));const normalized=output?.result?.status==='error'?output.result:normalizeCollectorResult(output?.result||{},limits);results.push(this.#record(batchId,source,plugin,normalized,started));}
    }
    for(const source of regular){
      const started=Date.now();const bound=this.registry.get(source.plugin_id),available=this.registry.resolveSourceTypeCandidates?.(source.source_type)||[],candidates=[...(bound?[bound]:[]),...available.filter((item)=>item!==bound)].filter((candidate)=>!validateSourceConfiguration(candidate.manifest,source.config).length);let plugin=candidates[0]||null,result;const attempts=[];
      if(!plugin){const loaded=this.registry.getManifest?.(source.plugin_id);result=loaded
        ? collectorFailure('INVALID_SOURCE_CONFIG',`采集源配置不符合 ${source.plugin_id} 的来源表单`,{action:'迁移或修正当前采集源配置'})
        : collectorFailure('DEPENDENCY_MISSING',`采集插件未加载：${source.plugin_id}`,{action:'启用或重新安装采集插件'});}
      else{
        const issues=validateSourceConfiguration(plugin.manifest,source.config);
        if(issues.length)result=collectorFailure('INVALID_SOURCE_CONFIG',issues[0].message,{action:'编辑并重新测试采集源'});
        else for(let index=0;index<candidates.length;index+=1){plugin=candidates[index];const context=Object.freeze({batchId,sourceId:source.id,sourceKey:source.source_key,retry:retry||{active:false,failureId:null,retryCount:0},signal,resolutionId:`collector-${batchId}-${source.id}`,attempt:index+1,
          limits:{maxItems:Math.min(500,Number(limits.maxItems)||100),timeoutMs:Math.min(plugin.manifest.runtime.timeoutMs,Number(limits.timeoutMs)||plugin.manifest.runtime.timeoutMs),maxResponseBytes:Math.min(12000000,Number(limits.maxResponseBytes)||12000000)},log:()=>{},emitProgress:()=>{}});
          try{result=normalizeCollectorResult(await plugin.adapter.collect(source.config,context),context.limits);}catch(error){result=caught(error);}attempts.push({pluginId:plugin.manifest.id,attempt:index+1,status:result.status,errorCode:result.status==='error'?result.error.code:null});if(result.status==='ok'||!shouldFallback(result,{signal})||index===candidates.length-1)break;}
      }
      results.push(this.#record(batchId,source,plugin,result,started,attempts));
    }
    return {status:results.some((item)=>item.status==='ok')?'ok':'error',results,items:results.flatMap((item)=>item.result.status==='ok'?item.result.items.map((entry)=>({...entry.raw,...entry,sourceGroup:item.sourceType==='direct'||item.sourceType==='rsshub'||item.sourceType==='twitter'?'rsshub':item.sourceType,sourceType:item.sourceType,sourceKey:item.sourceKey,sourceName:item.sourceName,collectorPlugin:item.pluginId,collectorVersion:item.pluginVersion})):[])};
  }
  #record(batchId,source,plugin,result,started,attempts=[]){const record={batchId,sourceId:source.id,sourceKey:source.source_key,sourceType:source.source_type,sourceName:source.label,
    pluginId:plugin?.manifest.id||source.plugin_id,pluginVersion:plugin?.manifest.version||source.plugin_version||'',status:result.status,itemCount:result.status==='ok'?result.items.length:0,durationMs:Date.now()-started,attempts,fallbackUsed:attempts.length>1,...(result.status==='error'?{error:result.error}:{})};
    this.onSourceResult(record);if(result.status==='error')this.onFailure({...record,retryable:result.error.retryable,action:result.error.action||''});return {...record,result};}
}
