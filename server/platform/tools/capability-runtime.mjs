import { getToolRegistry } from './index.mjs';
import { executeBrokerTool } from '../agent/tool-broker.mjs';
import { toolRuntimeMetadata } from '../agent/tool-definition.mjs';

export class CapabilityRuntime{
  constructor({registryResolver=getToolRegistry}={}){this.registryResolver=registryResolver;}
  async execute({consumerId,capability,input={},context={},preferences={}}){
    if(!consumerId)throw new Error('能力调用必须声明 consumerId');
    const registry=await this.registryResolver();
    const candidates=registry.resolveCandidates?.(capability,preferences)||[];
    const listed=registry.listCapabilities?.({includeDisabled:true})?.filter((item)=>item.capability===capability)||[];
    const first=candidates[0]?.manifest||listed[0]||{};
    const implementations=[...new Map([
      ...candidates.map(({manifest})=>[manifest.id,{plugin:manifest.id,version:manifest.version,riskLevel:manifest.riskLevel}]),
      ...listed.map((item)=>[item.plugin,{plugin:item.plugin,version:item.version,riskLevel:item.riskLevel}]),
    ]).values()];
    const catalog=[{
      capability,
      name:first.name||capability,
      description:first.description||'',
      inputSchema:structuredClone(first.inputSchema||{type:'object'}),
      outputSchema:structuredClone(first.outputSchema||{type:'object'}),
      ...toolRuntimeMetadata(first),
      implementations,
    }];
    const authorized = context.authorizedExternalWrite === true
      ? [...new Set([...(context.confirmedCapabilities||[]), capability])]
      : context.confirmedCapabilities;
    const result = await executeBrokerTool(
      { requestId:context.requestId||context.resolutionId||`cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`, capability, arguments:input, reason:context.reason||`能力调用：${consumerId}` },
      { registry, catalog, preferences, context:{...context,consumerId, ...(authorized ? {confirmedCapabilities:authorized} : {})} },
    );
    // Preserve the registry-facing provenance shape for existing capability
    // consumers while also exposing the Broker's provider field.
    if(result?.status==='ok' && result.provenance?.provider && !result.provenance.plugin){
      return {...result,provenance:{...result.provenance,plugin:result.provenance.provider}};
    }
    return result;
  }
}

const runtime=new CapabilityRuntime();
export function executeCapability(request){return runtime.execute(request);}
