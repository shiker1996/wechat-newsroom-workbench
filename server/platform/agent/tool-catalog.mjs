const READ_ONLY_RISKS=new Set(['read-only','network-read']);

export function buildConversationToolCatalog({registry,entryCapabilities=[],allowedCapabilities=null,applicationTools=[]}={}){
  if(!registry||typeof registry.listCapabilities!=='function')throw new TypeError('缺少工具注册表');
  const entry=new Set(entryCapabilities),allowed=Array.isArray(allowedCapabilities)?new Set(allowedCapabilities):null;
  const implementations=registry.listCapabilities().filter((item)=>entry.has(item.capability)&&(!allowed||allowed.has(item.capability))&&READ_ONLY_RISKS.has(item.riskLevel));
  const capabilities=[...new Set(implementations.map((item)=>item.capability))].sort();
  const catalog=capabilities.map((capability)=>{const manifest=registry.resolve(capability)?.manifest||{};return {
    capability,name:manifest.name||capability,description:manifest.description||'',inputSchema:structuredClone(manifest.inputSchema||{type:'object'}),
    implementations:implementations.filter((item)=>item.capability===capability).map((item)=>Object.freeze({plugin:item.plugin,version:item.version,riskLevel:item.riskLevel})),
  };});
  // 业务型 Agent 工具不经过插件注册表，但仍复用同一套目录、原生 function tool、
  // ToolRequest 校验和执行审计。调用方必须显式传入，避免普通对话入口意外暴露写入能力。
  for(const tool of applicationTools||[]){
    if(!tool?.capability|| (allowed&&!allowed.has(tool.capability)))continue;
    if(catalog.some((item)=>item.capability===tool.capability))throw new Error(`Agent 业务工具能力冲突：${tool.capability}`);
    catalog.push({
      capability:String(tool.capability),name:String(tool.name||tool.capability),description:String(tool.description||''),
      inputSchema:structuredClone(tool.inputSchema||{type:'object'}),implementations:[Object.freeze({plugin:String(tool.plugin||'application'),version:String(tool.version||'1.0.0'),riskLevel:String(tool.riskLevel||'local-write')})],
    });
  }
  return Object.freeze(catalog.sort((left,right)=>left.capability.localeCompare(right.capability)).map((item)=>Object.freeze(item)));
}

export function visibleCapabilitySet(catalog){return new Set((catalog||[]).map((item)=>item.capability));}

export function buildNativeToolDefinitions(catalog = []) {
  const names = new Set();
  return catalog.map((item) => {
    const name = String(item.capability || '');
    if (!name || names.has(name)) throw new Error(`原生工具名称冲突：${name}`);
    names.add(name);
    return {
      type: 'function',
      function: {
        name,
        description: String(item.description || item.name || item.capability || '').slice(0, 1024),
        parameters: structuredClone(item.inputSchema || { type: 'object' }),
      },
    };
  });
}

export function capabilityForToolName(name, catalog = []) {
  const match = catalog.find((item) => item.capability === String(name || ''));
  return match?.capability || null;
}

export function providerSupportsNativeTools(gateway, providerName) {
  const name = providerName || gateway?.config?.defaultProvider;
  const listed = gateway?.listProviders?.().providers?.find((item) => item.name === name);
  return listed?.supportsNativeTools === true || gateway?.config?.providers?.[name]?.supportsNativeTools === true;
}

export function providerSupportsToolCallStreaming(gateway, providerName) {
  const name = providerName || gateway?.config?.defaultProvider;
  const listed = gateway?.listProviders?.().providers?.find((item) => item.name === name);
  return listed?.supportsToolCallStreaming === true || gateway?.config?.providers?.[name]?.supportsToolCallStreaming === true;
}
