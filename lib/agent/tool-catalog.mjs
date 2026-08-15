const READ_ONLY_RISKS=new Set(['read-only','network-read']);

export function buildConversationToolCatalog({registry,entryCapabilities=[],allowedCapabilities=null}={}){
  if(!registry||typeof registry.listCapabilities!=='function')throw new TypeError('缺少工具注册表');
  const entry=new Set(entryCapabilities),allowed=Array.isArray(allowedCapabilities)?new Set(allowedCapabilities):null;
  const implementations=registry.listCapabilities().filter((item)=>entry.has(item.capability)&&(!allowed||allowed.has(item.capability))&&READ_ONLY_RISKS.has(item.riskLevel));
  const capabilities=[...new Set(implementations.map((item)=>item.capability))].sort();
  return Object.freeze(capabilities.map((capability)=>{const manifest=registry.resolve(capability)?.manifest||{};return Object.freeze({
    capability,name:manifest.name||capability,description:manifest.description||'',inputSchema:structuredClone(manifest.inputSchema||{type:'object'}),
    implementations:implementations.filter((item)=>item.capability===capability).map((item)=>Object.freeze({plugin:item.plugin,version:item.version,riskLevel:item.riskLevel})),
  });}));
}

export function visibleCapabilitySet(catalog){return new Set((catalog||[]).map((item)=>item.capability));}
