const object=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});
const string=(title,extra={})=>({type:'string',title,...extra});
const integer=(title,minimum,maximum,extra={})=>({type:'integer',title,minimum,maximum,...extra});

export function modelIdentifier(connectionId='',model='') {
  const connection=String(connectionId||'').trim();
  const name=String(model||'').trim();
  return connection&&name?`${connection}/${name}`:name||connection;
}

export const MODEL_CONNECTION_FIELDS=Object.freeze(['label','baseUrl','protocol']);
export const MODEL_FIELDS=Object.freeze([
  'connectionId','label','model','contextWindow','maxOutputTokens','maxTokensField','taggingChunkSize',
  'taggingConcurrency','supportsJsonMode','supportsNativeTools','supportsToolCallStreaming',
  'supportsThinkingToggle','responsesReasoningToggle','thinkingReserveTokens','reasoningEffort','enabled',
]);

function connectionProperties(connection={}) {
  const properties={
    label:string('供应商名称',{default:connection.label||''}),
    baseUrl:string('API 地址',{format:'url',default:connection.baseUrl||''}),
    protocol:{type:'string',title:'API 协议',enum:['chat_completions','responses'],enumNames:['Chat Completions','Responses'],default:connection.protocol||'chat_completions'},
    apiKey:string('API Key',{secret:true,format:'password'}),
  };
  return properties;
}

export function modelConnectionManifest(id,connection={}) {
  return {id,name:connection.label||id,credentialProfile:`model-connection-${id}`,configuration:object(connectionProperties(connection),['label','baseUrl','apiKey'])};
}

export function modelProviderModelManifest(id,provider={},connections=[],isDefault=false) {
  const values=connections.length?connections.map(([connectionId,connection])=>({id:connectionId,label:connection.label||connectionId})):[];
  const connectionId=provider.connectionId||values[0]?.id||'';
  const modelKey=connectionId&&provider.model?`${connectionId}/${provider.model}`:provider.label||provider.model||id;
  return {id,name:modelKey,modelKey,configuration:object({
    connectionId:{type:'string',title:'供应商',description:'模型创建后不可修改；需要切换供应商时请新增模型。',default:connectionId,readOnly:true},
    label:string('模型显示名称',{default:provider.label||id}),
    model:string('模型名称',{default:provider.model||''}),
    contextWindow:integer('上下文窗口',1024,10000000,{default:provider.contextWindow||128000}),
    maxOutputTokens:integer('最大输出 Token',256,1000000,{default:provider.maxOutputTokens||4096}),
    maxTokensField:string('Token 参数名',{default:provider.maxTokensField||'max_tokens'}),
    taggingChunkSize:integer('打标分块大小',1,1000,{default:provider.taggingChunkSize||20}),
    taggingConcurrency:integer('打标并发数',1,100,{default:provider.taggingConcurrency||2}),
    supportsJsonMode:{type:'boolean',title:'支持 JSON Mode',default:provider.supportsJsonMode===true},
    supportsNativeTools:{type:'boolean',title:'支持原生工具调用',default:provider.supportsNativeTools===true},
    supportsToolCallStreaming:{type:'boolean',title:'支持工具调用流式事件',default:provider.supportsToolCallStreaming===true},
    supportsThinkingToggle:{type:'boolean',title:'支持思考开关',default:provider.supportsThinkingToggle===true},
    responsesReasoningToggle:{type:'boolean',title:'Responses 支持思考开关',default:provider.responsesReasoningToggle===true},
    thinkingReserveTokens:integer('思考预留 Token',0,1000000,{default:provider.thinkingReserveTokens??8000}),
    ...(provider.reasoningEffort?{reasoningEffort:string('推理强度',{default:provider.reasoningEffort})}:{}),
    ...(provider.webSearchConfig?.payloadKey?{
      webSearchPayloadKey:string('联网搜索参数名',{default:provider.webSearchConfig.payloadKey}),
      webSearchPayloadValue:string('联网搜索参数值',{default:String(provider.webSearchConfig.payloadValue)}),
    }:{}),
    default:{type:'boolean',title:'设为默认模型',description:'保存后该模型成为默认调用渠道（未勾选时不影响现有默认）',default:isDefault},
    enabled:{type:'boolean',title:'启用',default:provider.enabled!==false},
  },['connectionId','label','model'])};
}

export function modelProviderManifest(id,provider={},isDefault=false) {
  const properties={
    label:string('显示名称',{default:provider.label||id}),
    baseUrl:string('API 地址',{format:'url',default:provider.baseUrl||''}),
    model:string('模型名称',{default:provider.model||''}),
    protocol:{type:'string',title:'API 协议',enum:['chat_completions','responses'],enumNames:['Chat Completions','Responses'],default:provider.protocol||'chat_completions'},
    apiKey:string('API Key',{secret:true,format:'password'}),
    contextWindow:integer('上下文窗口',1024,10000000,{default:provider.contextWindow||128000}),
    maxOutputTokens:integer('最大输出 Token',256,1000000,{default:provider.maxOutputTokens||4096}),
    maxTokensField:string('Token 参数名',{default:provider.maxTokensField||'max_tokens'}),
    taggingChunkSize:integer('打标分块大小',1,1000,{default:provider.taggingChunkSize||20}),
    taggingConcurrency:integer('打标并发数',1,100,{default:provider.taggingConcurrency||2}),
    supportsJsonMode:{type:'boolean',title:'支持 JSON Mode',default:provider.supportsJsonMode===true},
    supportsNativeTools:{type:'boolean',title:'支持原生工具调用',default:provider.supportsNativeTools===true},
    supportsToolCallStreaming:{type:'boolean',title:'支持工具调用流式事件',default:provider.supportsToolCallStreaming===true},
    supportsThinkingToggle:{type:'boolean',title:'支持思考开关',default:provider.supportsThinkingToggle===true},
    responsesReasoningToggle:{type:'boolean',title:'Responses 支持思考开关',default:provider.responsesReasoningToggle===true},
    thinkingReserveTokens:integer('思考预留 Token',0,1000000,{default:provider.thinkingReserveTokens??8000}),
    default:{type:'boolean',title:'设为默认模型',description:'保存后该模型成为默认调用渠道（未勾选时不影响现有默认）',default:isDefault},
    enabled:{type:'boolean',title:'启用',default:provider.enabled!==false},
  };
  if(provider.reasoningEffort)properties.reasoningEffort=string('推理强度',{default:provider.reasoningEffort});
  if(provider.webSearchConfig?.payloadKey) {
    properties.webSearchPayloadKey=string('联网搜索参数名',{default:provider.webSearchConfig.payloadKey});
    properties.webSearchPayloadValue=string('联网搜索参数值',{default:String(provider.webSearchConfig.payloadValue)});
  }
  return {id,name:provider.label||id,credentialProfile:`model-provider-${id}`,configuration:object(properties,['label','baseUrl','model','apiKey'])};
}

export function legacyModelProviderConfiguration(provider={},environment=process.env) {
  const values={};
  for(const key of ['label','baseUrl','model','protocol','contextWindow','maxOutputTokens','maxTokensField','taggingChunkSize','taggingConcurrency','supportsJsonMode','supportsNativeTools','supportsToolCallStreaming','supportsThinkingToggle','responsesReasoningToggle','thinkingReserveTokens','reasoningEffort','enabled']) {
    if(provider[key]!==undefined)values[key]=provider[key];
  }
  if(provider.apiKeyEnv&&environment[provider.apiKeyEnv])values.apiKey=environment[provider.apiKeyEnv];
  if(provider.webSearchConfig?.payloadKey) {
    values.webSearchPayloadKey=provider.webSearchConfig.payloadKey;
    values.webSearchPayloadValue=String(provider.webSearchConfig.payloadValue);
  }
  return values;
}

function payloadValue(value) {
  if(value==='true')return true;
  if(value==='false')return false;
  if(value!==''&&!Number.isNaN(Number(value)))return Number(value);
  return value;
}

export function applyModelProviderConfiguration(provider={},values={}) {
  const merged={...provider,...values};
  delete merged.apiKey;
  delete merged.default;
  delete merged.webSearchPayloadKey;
  delete merged.webSearchPayloadValue;
  if(values.webSearchPayloadKey)merged.webSearchConfig={payloadKey:values.webSearchPayloadKey,payloadValue:payloadValue(values.webSearchPayloadValue)};
  else if('webSearchPayloadKey' in values)delete merged.webSearchConfig;
  return merged;
}
