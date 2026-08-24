import { getToolRegistry } from './index.mjs';

export class CapabilityRuntime{
  constructor({registryResolver=getToolRegistry}={}){this.registryResolver=registryResolver;}
  async execute({consumerId,capability,input={},context={},preferences={}}){if(!consumerId)throw new Error('能力调用必须声明 consumerId');const registry=await this.registryResolver();return registry.execute(capability,input,{...context,consumerId},preferences);}
}

const runtime=new CapabilityRuntime();
export function executeCapability(request){return runtime.execute(request);}
