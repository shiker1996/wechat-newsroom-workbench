import { createGenerationSnapshot } from './registry.mjs';
import { getToolRegistry } from '../tools/index.mjs';
import { readActiveSkillConfig } from './configuration.mjs';

export function bindGenerationSnapshot(gateway, generationSnapshotId) {
  if (!generationSnapshotId) return gateway;
  return new Proxy(gateway, {
    get(target, property, receiver) {
      if (property === 'complete') return (input) => target.complete({ ...input, generationSnapshotId });
      if (property === 'streamComplete') return (input, onDelta) => target.streamComplete({ ...input, generationSnapshotId }, onDelta);
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export async function resolveSkillToolPolicy({ workspaceRoot, skillId, snapshot = null }) {
  const frozenSnapshot=snapshot?.snapshot || snapshot;
  const frozenSkill=frozenSnapshot?.skills?.find((item)=>item.id===skillId);
  const config=frozenSkill?.config || (frozenSnapshot?.skillConfig && frozenSnapshot.skills?.[0]?.id===skillId
    ? frozenSnapshot.skillConfig
    : readActiveSkillConfig(workspaceRoot,skillId));
  const available=(await getToolRegistry()).listCapabilities();
  const allowedCapabilities=config?.allowedTools?.length ? [...new Set(config.allowedTools)] : null;
  if(allowedCapabilities){
    const missing=allowedCapabilities.filter((capability)=>!available.some((item)=>item.capability===capability));
    if(missing.length)throw new Error(`技能工具白名单包含不存在的能力：${missing.join('、')}`);
  }
  return {
    skillId,
    config:config || null,
    allowedCapabilities,
    tools:allowedCapabilities===null?available:available.filter((item)=>allowedCapabilities.includes(item.capability)),
  };
}

export async function prepareSkillRun({ gateway, store, batchId, candidateId = null, purpose, bundles, provider, snapshotId = null, selection = null }) {
  const historical=snapshotId?store.getGenerationSnapshot?.(snapshotId):null;
  if(snapshotId&&!historical)throw new Error('指定的 generation snapshot 不存在');
  if(historical&&(historical.batch_id!==batchId||(historical.candidate_row_id??null)!==(candidateId??null)))throw new Error('generation snapshot 不属于当前任务');
  if(historical){
    const frozenById=new Map(historical.snapshot.skills.map((item)=>[item.id,item]));
    bundles=bundles.map((bundle)=>{
      const frozen=frozenById.get(bundle.skillName||bundle.writerSkill);
      if(!frozen)throw new Error(`历史快照缺少技能：${bundle.skillName||bundle.writerSkill}`);
      const frozenConfig=frozen.config
        ? {...frozen.config,version:frozen.version,configHash:frozen.configHash}
        : null;
      Object.assign(bundle,{prompt:frozen.prompt,hash:String(frozen.promptHash||'').replace(/^sha256:/,''),config:frozenConfig});
      return bundle;
    });
    if(bundles[0])bundles[0].config={...(bundles[0].config||{}),...(historical.snapshot.skillConfig||{})};
  }
  // 调用方传入的第一个技能是流程主技能。子技能的 Prompt 覆盖层独立生效，
  // 但不能因为它恰好存在配置就接管整条流程的模型、工具与质量门禁。
  const primary=bundles[0];
  const configuredProvider=primary?.config?.defaultModel;
  const configuredExists=configuredProvider&&gateway.config?.providers?.[configuredProvider];
  const selectedProvider=historical?.snapshot.modelProvider || provider || (configuredExists ? configuredProvider : gateway.config?.defaultProvider);
  const resolved=gateway.config?.providers?.[selectedProvider] || gateway.resolve?.(selectedProvider)?.provider;
  if(!resolved)throw new Error('技能运行时无法解析模型配置');
  if(historical?.snapshot.model&&resolved.model!==historical.snapshot.model){
    throw new Error(`历史模型版本不可用：${selectedProvider}/${historical.snapshot.model}`);
  }
  const available=(await getToolRegistry()).listCapabilities();
  const frozenAllowedTools=historical?.snapshot.skillConfig?.allowedTools;
  const hasFrozenWhitelist=Array.isArray(frozenAllowedTools)&&frozenAllowedTools.length>0;
  const allowed=primary?.config?.allowedTools || [];
  // 空白名单等价于未配置：未配置时不过滤工具；历史快照的冻结工具已在下方逐一校验版本。
  const hasWhitelist=hasFrozenWhitelist||allowed.length>0;
  const tools=historical?.snapshot.tools || (hasWhitelist ? available.filter((item)=>allowed.includes(item.capability)) : available);
  if(historical){
    for(const frozen of tools){
      if(!available.some((item)=>item.capability===frozen.capability&&item.plugin===frozen.plugin&&item.version===frozen.version)){
        throw new Error(`历史工具版本不可用：${frozen.capability}/${frozen.plugin}@${frozen.version}`);
      }
    }
  }
  if(!historical&&hasWhitelist&&allowed.length!==tools.length)throw new Error('技能工具白名单包含已禁用或不存在的能力');
  const snapshot=historical?{...historical.snapshot,reusedFromSnapshotId:historical.id,createdAt:new Date().toISOString()}:createGenerationSnapshot({
    skillBundles:bundles,tools,provider:selectedProvider,
    model:resolved.model || '',purpose,selection,
  });
  snapshot.skillConfig={...(snapshot.skillConfig||{}),defaultModel:primary?.config?.defaultModel||'',allowedTools:hasFrozenWhitelist?[...frozenAllowedTools]:(allowed.length?allowed:null),
    gates:primary?.config?.gates||null,version:primary?.config?.version||null,configHash:primary?.config?.configHash||''};
  const savedSnapshot=store.saveGenerationSnapshot?.({batchId,candidateId,purpose,snapshot});
  return {provider:selectedProvider,providerConfig:resolved,config:primary?.config||null,tools,
    allowedCapabilities:hasFrozenWhitelist?[...frozenAllowedTools]:(allowed.length?allowed:null),bundles,snapshotId:savedSnapshot?.id||historical?.id||null};
}
