import { performance } from 'node:perf_hooks';
import { enforcePolicy } from './policy.mjs';
import { failure, validateInput, validateResult } from './schemas.mjs';
import { createExecutionRecord } from './execution-log.mjs';
import { orderedCandidates, shouldFallback } from './fallback-policy.mjs';
import * as resultSdk from '../plugin-sdk/result.mjs';
import * as network from '../plugin-sdk/network.mjs';
import * as github from '../plugin-sdk/github-client.mjs';

function thrown(error){const message=String(error?.message||error);if(/not found|Cannot find package/i.test(message))return failure('DEPENDENCY_MISSING',message,{action:'检查或安装运行依赖'});if(/timeout/i.test(message))return failure('TIMEOUT',message,{retryable:true});if(/fetch|network|ECONN|ENOTFOUND/i.test(message))return failure('FETCH_FAILED',message,{retryable:true});return failure('OUTPUT_INVALID',message);}

export class ToolRegistry{
  #plugins=[];#settings={};#configurationResolver=null;
  constructor({settings={},configurationResolver=null}={}){this.#settings=settings;this.#configurationResolver=configurationResolver;}
  register(plugin){this.#plugins.push(plugin);return this;}
  #state(manifest){const configured=this.#settings[manifest.id]||{};return {enabled:typeof configured.enabled==='boolean'?configured.enabled:manifest.enabledByDefault!==false,priority:Number.isFinite(Number(configured.priority))?Number(configured.priority):Number(manifest.priority)||0};}
  listPlugins(){const available=new Set(this.listCapabilities().map((item)=>item.capability));return [...this.#plugins].sort((left,right)=>this.#state(right.manifest).priority-this.#state(left.manifest).priority||left.manifest.id.localeCompare(right.manifest.id)).map(({manifest})=>{const state=this.#state(manifest),missingCapabilities=(manifest.requiredCapabilities||[]).filter((capability)=>!available.has(capability));return {...manifest,...state,available:state.enabled&&!missingCapabilities.length,missingCapabilities};});}
  listCapabilities({ includeDisabled = false }={}){return this.#plugins.flatMap(({manifest})=>{const state=this.#state(manifest);if(!includeDisabled&&!state.enabled)return [];return manifest.capabilities.map((capability)=>({capability,plugin:manifest.id,version:manifest.version,riskLevel:manifest.riskLevel,enabled:state.enabled,priority:state.priority}));});}
  resolveCandidates(capability,preferences={}){const enabledCapabilities=new Set(this.#plugins.filter((plugin)=>this.#state(plugin.manifest).enabled).flatMap((plugin)=>plugin.manifest.capabilities));return orderedCandidates(this.#plugins.filter(({manifest})=>manifest.capabilities.includes(capability)&&this.#state(manifest).enabled&&(manifest.requiredCapabilities||[]).every((required)=>enabledCapabilities.has(required))),{preferredId:preferences.plugin,priorityOf:(item)=>this.#state(item.manifest).priority});}
  resolve(capability,preferences={}){return this.resolveCandidates(capability,preferences)[0]||null;}
  async health(capability,preferences={}){const plugin=this.resolve(capability,preferences);if(!plugin)return failure('DEPENDENCY_MISSING',`没有能力实现：${capability}`);if(!plugin.adapter.health)return {status:'ok',data:{available:true}};try{const state=plugin.manifest.configuration?await this.#configurationResolver?.(plugin.manifest):null;if(plugin.manifest.configuration&&!state?.configured)return failure('DEPENDENCY_MISSING','插件需要先完成配置');const result=await plugin.adapter.health(Object.freeze({pluginId:plugin.manifest.id,configuration:state?.values||{}})),invalid=validateResult(result);return invalid?failure('OUTPUT_INVALID',`健康检查结果无效：${invalid}`):result;}catch(error){return thrown(error);}}
  async execute(capability,input={},context={},preferences={}){
    const started=performance.now(),startedAt=new Date().toISOString(),candidates=this.resolveCandidates(capability,preferences),resolutionId=context.resolutionId||`tool-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;let configurationState=null,previous=null,last=null;
    const finish=(result,selected,attempt,fallbackFrom)=>{if(result.status==='ok'){result.metrics={...(result.metrics||{}),durationMs:Math.round(performance.now()-started)};result.provenance={plugin:selected.manifest.id,version:selected.manifest.version,resolutionId,attempt,...(result.provenance||{})};}context.executionLog?.(createExecutionRecord({capability,plugin:selected?.manifest.id||null,version:selected?.manifest.version||null,input,result,startedAt,finishedAt:new Date().toISOString(),authorizedExternalWrite:context.authorizedExternalWrite,configurationSnapshot:configurationState?.snapshot||null,resolutionId,attempt,fallbackFrom,consumerId:context.consumerId||context.skillId||null}));return result;};
    if(!candidates.length)return finish(failure('DEPENDENCY_MISSING',`没有能力实现：${capability}`),null,0,null);
    for(let index=0;index<candidates.length;index+=1){const selected=candidates[index];configurationState=null;let result;
      if(selected.manifest.configuration){configurationState=await(this.#configurationResolver?.(selected.manifest,context)||context.extensionConfiguration||null);if(!configurationState?.configured)result=failure('DEPENDENCY_MISSING','插件需要先完成配置',{action:'前往本机能力配置完成配置'});}
      if(!result){const invalid=validateInput(selected.manifest.inputSchema,input);if(invalid)result=failure('INVALID_INPUT',invalid);}
      if(!result){const denied=enforcePolicy(selected.manifest,input,context);if(denied)result=failure(denied.code,denied.message);}
      if(!result)try{
        const capabilities=Object.freeze({
          invoke:(childCapability,childInput={},childPreferences={})=>this.execute(childCapability,childInput,{...context,consumerId:selected.manifest.id,parentResolutionId:resolutionId},childPreferences),
        });
        result=await selected.adapter.execute(input,Object.freeze({...context,capability,capabilities,result:resultSdk,network,github,pluginId:selected.manifest.id,configuration:configurationState?.values||{},resolutionId,attempt:index+1}));const invalid=validateResult(result,selected.manifest.outputSchema);if(invalid)result=failure('OUTPUT_INVALID',invalid);
      }catch(error){result=thrown(error);}
      last=finish(result,selected,index+1,previous);if(last.status==='ok'||!shouldFallback(last,{signal:context.signal})||index===candidates.length-1)return last;previous=selected.manifest.id;
    }return last;
  }
}
