// 能力健康检查预取 + 进程内 TTL 缓存（遗留 6）：
// buildCapabilityGraph 保持同步，由调用方先用本模块并发预取健康表（Map<capability, verdict>），
// 再作为可选参数传入图谱计算。verdict：'healthy'（至少一个启用实现健康）、
// 'unhealthy'（启用实现均报告不可用）、'unknown'（健康检查异常/超时，图谱回退代理判定并标注）。
// 缓存在写操作（插件启停/凭据/采集器状态等）后整体失效——写操作低频，全清可接受。

const DEFAULT_TTL_MS=45_000;
// 键：`${capability}::${plugin}`，值：{verdict, expiresAt}
const cache=new Map();

export function invalidateCapabilityHealthCache(){
  cache.clear();
}

async function probeOne(registry,capability,plugin,ttlMs,now){
  const key=`${capability}::${plugin}`,hit=cache.get(key);
  if(hit&&hit.expiresAt>now())return hit.verdict;
  let verdict;
  try{
    const result=await registry.health(capability,{plugin});
    verdict=result?.status==='ok'?(result.data?.available===false?'unhealthy':'healthy'):'unknown';
  }catch{
    verdict='unknown';
  }
  cache.set(key,{verdict,expiresAt:now()+ttlMs});
  return verdict;
}

// 并发预取给定能力的健康表。registry 为工具注册表（lib/tools/index.mjs 单例）。
// 只探测启用的实现；没有任何启用实现的能力不产生表项（图谱按代理判定）。
export async function prefetchCapabilityHealth(registry,capabilities,{ttlMs=DEFAULT_TTL_MS,now=Date.now}={}){
  const wanted=new Set(capabilities);
  const entries=(registry.listCapabilities({includeDisabled:true})||[])
    .filter((item)=>item.enabled!==false&&wanted.has(item.capability));
  const probes=new Map();
  await Promise.all(entries.map((item)=>{
    const key=`${item.capability}::${item.plugin}`;
    if(!probes.has(key))probes.set(key,probeOne(registry,item.capability,item.plugin,ttlMs,now).then((verdict)=>({capability:item.capability,verdict})));
    return probes.get(key);
  }));
  const byCapability=new Map();
  for(const {capability,verdict} of await Promise.all(probes.values())){
    const current=byCapability.get(capability);
    // 聚合：任一健康 → healthy；否则任一异常 → unknown（回退代理）；否则 unhealthy
    if(current==='healthy')continue;
    if(verdict==='healthy'||verdict==='unknown')byCapability.set(capability,verdict);
    else if(!current)byCapability.set(capability,verdict);
  }
  return byCapability;
}

// 测试钩子：清空缓存并返回当前缓存大小
export function capabilityHealthCacheSize(){
  return cache.size;
}
