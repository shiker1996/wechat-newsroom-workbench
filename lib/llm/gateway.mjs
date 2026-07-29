import { compactMessages, contextBudget, estimateTokens, SUMMARY_SYSTEM_PROMPT } from './context-manager.mjs';
import { webSearch as tavilySearch, formatSearchResults } from './web-search.mjs';
import { outputBudgetFor, TRUNCATION_RETRY_SYSTEM_PROMPT } from './output-budget.mjs';

function endpoint(baseUrl) {
  const value=String(baseUrl).replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(value)?value:`${value}/chat/completions`;
}

function publicProvider(name, provider) {
  return {
    name,
    label: provider.label || name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKeyEnv: provider.apiKeyEnv,
    configured: Boolean(process.env[provider.apiKeyEnv]),
    contextWindow: provider.contextWindow,
    maxOutputTokens: provider.maxOutputTokens,
    maxTokensField: provider.maxTokensField || 'max_tokens',
    taggingChunkSize: provider.taggingChunkSize,
    taggingConcurrency: provider.taggingConcurrency,
    supportsJsonMode: provider.supportsJsonMode === true,
    enabled: provider.enabled !== false,
    supportsWebSearch: !!provider.webSearchConfig,
  };
}

export class ModelGateway {
  constructor(config, store) {
    this.config = config.llm;
    this.store = store;
  }

  listProviders() {
    return {
      defaultProvider: this.config.defaultProvider,
      providers: Object.entries(this.config.providers).map(([name, value]) => publicProvider(name, value)),
    };
  }

  resolve(name) {
    const providerName = name || this.config.defaultProvider;
    const provider = this.config.providers[providerName];
    if (!provider || provider.enabled === false) throw new Error(`模型服务 ${providerName} 未启用`);
    const apiKey = process.env[provider.apiKeyEnv];
    if (!apiKey) throw new Error(`缺少环境变量 ${provider.apiKeyEnv}`);
    return { providerName, provider, apiKey };
  }

  async rawComplete({ providerName, provider, apiKey, messages, maxOutputTokens, temperature = 0.2, jsonMode = false, webSearch = false }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    const maxTokens = Math.min(maxOutputTokens || provider.maxOutputTokens, provider.maxOutputTokens);
    try {
      const modes=jsonMode&&provider.supportsJsonMode===true?[true,false]:[false];
      for(const useJsonMode of modes) {
        const payload = { model: provider.model, messages: messages.map(({ role, content }) => ({ role, content: String(content ?? '') })), temperature };
        payload[provider.maxTokensField || 'max_tokens'] = maxTokens;
        if(useJsonMode)payload.response_format={type:'json_object'};
        if(webSearch && provider.webSearchConfig) { payload[provider.webSearchConfig.payloadKey] = provider.webSearchConfig.payloadValue; }
        const response = await fetch(endpoint(provider.baseUrl), {
          method: 'POST', signal: controller.signal,
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if(!response.ok&&useJsonMode&&[400,422].includes(response.status))continue;
        if (!response.ok) throw new Error(`${provider.label || providerName} HTTP ${response.status}: ${data.error?.message || '调用失败'}`);
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new Error(`${provider.label || providerName} 未返回文本内容`);
        return { content, usage: data.usage ?? {}, id: data.id ?? null, finishReason: data.choices?.[0]?.finish_reason ?? null };
      }
      throw new Error(`${provider.label || providerName} 不支持结构化输出模式`);
    } finally {
      clearTimeout(timer);
    }
  }

  async rawStreamComplete({ providerName, provider, apiKey, messages, maxOutputTokens, temperature = 0.2, jsonMode = false, webSearch = false, onDelta = () => {} }) {
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.config.requestTimeoutMs);
    const maxTokens=Math.min(maxOutputTokens||provider.maxOutputTokens,provider.maxOutputTokens);
    try {
      const modes=jsonMode&&provider.supportsJsonMode===true?[true,false]:[false];
      for(const useJsonMode of modes) {
        const payload={model:provider.model,messages:messages.map(({role,content})=>({role,content:String(content??'')})),temperature,stream:true};
        payload[provider.maxTokensField||'max_tokens']=maxTokens;if(useJsonMode)payload.response_format={type:'json_object'};
        if(webSearch&&provider.webSearchConfig)payload[provider.webSearchConfig.payloadKey]=provider.webSearchConfig.payloadValue;
        const response=await fetch(endpoint(provider.baseUrl),{method:'POST',signal:controller.signal,
          headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify(payload)});
        if(!response.ok) {
          const data=await response.json().catch(()=>({}));
          if(useJsonMode&&[400,422].includes(response.status))continue;
          throw new Error(`${provider.label||providerName} HTTP ${response.status}: ${data.error?.message||'调用失败'}`);
        }
        if(!response.body)throw new Error(`${provider.label||providerName} 未返回流式响应体`);
        const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';let content='';let usage={};let id=null;let finishReason=null;
        const processLine=(line)=>{
          const trimmed=line.trim();if(!trimmed.startsWith('data:'))return;const dataText=trimmed.slice(5).trim();if(!dataText||dataText==='[DONE]')return;
          let data;try{data=JSON.parse(dataText);}catch{return;} id=data.id||id;usage=data.usage||usage;
          const choice=data.choices?.[0];const delta=choice?.delta?.content??choice?.message?.content??'';
          if(delta){content+=delta;onDelta(delta,content);}if(choice?.finish_reason)finishReason=choice.finish_reason;
        };
        while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';for(const line of lines)processLine(line);}
        buffer+=decoder.decode();if(buffer.trim())processLine(buffer);
        if(!content)throw new Error(`${provider.label||providerName} 未返回流式文本内容`);
        return {content,usage,id,finishReason};
      }
      throw new Error(`${provider.label||providerName} 不支持结构化输出模式`);
    } finally {clearTimeout(timer);}
  }

  async complete(input) {
    const { providerName, provider, apiKey } = this.resolve(input.provider);
    const started = Date.now();
    const outputBudget = outputBudgetFor({
      purpose: input.purpose,
      providerMax: provider.maxOutputTokens,
      requested: input.maxOutputTokens,
      adaptive: input.adaptiveOutput,
    });
    const budget = contextBudget(provider, this.config, outputBudget.initial);
    let context;
    const compressionUsage = { prompt_tokens: 0, completion_tokens: 0, calls: 0 };
    const webSearch = input.webSearch === true;
    // Tavily web search fallback for providers without native search
    if (webSearch && !provider.webSearchConfig && this.config.tavily?.enabled) {
      const tavilyApiKey = process.env[this.config.tavily.apiKeyEnv];
      if (tavilyApiKey) {
        const lastUserMsg = [...input.messages].reverse().find(m => m.role === 'user');
        if (lastUserMsg && typeof lastUserMsg.content === 'string') {
          try {
            const tavilyResult = await tavilySearch(lastUserMsg.content.slice(0, 200), {
              apiKey: tavilyApiKey, maxResults: this.config.tavily?.maxResults ?? 5,
            });
            const searchContext = formatSearchResults(tavilyResult);
            if (searchContext) {
              input.messages = [
                { role: 'system', content: '以下是网络搜索到的实时信息，请参考这些内容来回答用户的问题。' },
                { role: 'user', content: searchContext },
                ...input.messages,
              ];
            }
          } catch (_) { /* tavily fail */ }
        }
      }
    }
    try {
      context = await compactMessages(input.messages, {
        budget,
        recentMessageCount: this.config.recentMessageCount,
        summarize: async (old) => {
          const result = await this.rawComplete({ providerName, provider, apiKey, maxOutputTokens: Math.min(1800, provider.maxOutputTokens), messages: [
            { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
            { role: 'user', content: old.map((m, i) => `[${i + 1}] ${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n') },
          ] });
          compressionUsage.prompt_tokens += Number(result.usage.prompt_tokens || 0);
          compressionUsage.completion_tokens += Number(result.usage.completion_tokens || 0);
          compressionUsage.calls += 1;
          return result.content;
        },
      });
      let result = await this.rawComplete({ providerName, provider, apiKey, messages: context.messages,
        maxOutputTokens: outputBudget.initial, temperature: input.temperature, jsonMode: input.jsonMode });
      let attempts = 1;
      let firstAttemptUsage = null;
      if (result.finishReason === 'length' && outputBudget.adaptive) {
        firstAttemptUsage = result.usage;
        attempts = 2;
        const retryBudget = contextBudget(provider, this.config, outputBudget.retry);
        const retryContext = await compactMessages([
          { role: 'system', content: TRUNCATION_RETRY_SYSTEM_PROMPT, protected: true },
          ...input.messages,
        ], {
          budget: retryBudget,
          recentMessageCount: this.config.recentMessageCount,
          summarize: async (old) => {
            const summary = await this.rawComplete({ providerName, provider, apiKey, maxOutputTokens: Math.min(1800, provider.maxOutputTokens), messages: [
              { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
              { role: 'user', content: old.map((m, i) => `[${i + 1}] ${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n') },
            ] });
            compressionUsage.prompt_tokens += Number(summary.usage.prompt_tokens || 0);
            compressionUsage.completion_tokens += Number(summary.usage.completion_tokens || 0);
            compressionUsage.calls += 1;
            return summary.content;
          },
        });
        context = retryContext;
        result = await this.rawComplete({ providerName, provider, apiKey, messages: retryContext.messages,
          maxOutputTokens: outputBudget.retry, temperature: input.temperature, jsonMode: input.jsonMode });
      }
      const promptTokens = Number(result.usage.prompt_tokens || 0) + Number(firstAttemptUsage?.prompt_tokens || 0);
      const completionTokens = Number(result.usage.completion_tokens || 0) + Number(firstAttemptUsage?.completion_tokens || 0);
      const callId = this.store.recordModelCall({ provider: providerName, model: provider.model, purpose: input.purpose,
        batchId: input.batchId, candidateId: input.candidateId, estimatedInputTokens: context.afterTokens,
        promptTokens: promptTokens + compressionUsage.prompt_tokens,
        completionTokens: completionTokens + compressionUsage.completion_tokens,
        compressed: context.compressed, latencyMs: Date.now() - started, status: 'completed',
        generationSnapshotId:input.generationSnapshotId });
      return { ...result, callId, usage: { ...result.usage, compression: compressionUsage },
        provider: providerName, model: provider.model, context,
        outputBudget: { ...outputBudget, used: attempts === 2 ? outputBudget.retry : outputBudget.initial, attempts } };
    } catch (error) {
      this.store.recordModelCall({ provider: providerName, model: provider.model, purpose: input.purpose,
        batchId: input.batchId, candidateId: input.candidateId,
        estimatedInputTokens: context?.afterTokens ?? estimateTokens(input.messages), compressed: context?.compressed,
        latencyMs: Date.now() - started, status: 'failed', error: error.message,
        generationSnapshotId:input.generationSnapshotId });
      throw error;
    }
  }

  async streamComplete(input,onDelta=()=>{}) {
    const {providerName,provider,apiKey}=this.resolve(input.provider);const started=Date.now();
    const outputBudget=outputBudgetFor({purpose:input.purpose,providerMax:provider.maxOutputTokens,requested:input.maxOutputTokens,adaptive:input.adaptiveOutput});
    const budget=contextBudget(provider,this.config,outputBudget.initial);let context;
    const compressionUsage={prompt_tokens:0,completion_tokens:0,calls:0};
    try {
      const webSearch=input.webSearch===true;
      if(webSearch&&!provider.webSearchConfig&&this.config.tavily?.enabled){
        const apiKey=process.env[this.config.tavily.apiKeyEnv];
        if(apiKey){
          const lastUserMsg=[...input.messages].reverse().find(m=>m.role==='user');
          if(lastUserMsg&&typeof lastUserMsg.content==='string'){
            try{
              const r=await tavilySearch(lastUserMsg.content.slice(0,200),{apiKey,maxResults:this.config.tavily.maxResults??5});
              const ctx=formatSearchResults(r);
              if(ctx)input.messages=[{role:'system',content:'以下是网络搜索到的实时信息，请参考这些内容来回答。'},{role:'user',content:ctx},...input.messages];
            }catch(_){}
          }
        }
      }
      context=await compactMessages(input.messages,{budget,recentMessageCount:this.config.recentMessageCount,summarize:async(old)=>{
        const result=await this.rawComplete({providerName,provider,apiKey,maxOutputTokens:Math.min(1800,provider.maxOutputTokens),messages:[
          {role:'system',content:SUMMARY_SYSTEM_PROMPT},{role:'user',content:old.map((m,i)=>`[${i+1}] ${m.role}: ${typeof m.content==='string'?m.content:JSON.stringify(m.content)}`).join('\n\n')} ]});
        compressionUsage.prompt_tokens+=Number(result.usage.prompt_tokens||0);compressionUsage.completion_tokens+=Number(result.usage.completion_tokens||0);compressionUsage.calls+=1;return result.content;
      }});
      const result=await this.rawStreamComplete({providerName,provider,apiKey,messages:context.messages,maxOutputTokens:outputBudget.initial,
        temperature:input.temperature,jsonMode:input.jsonMode,webSearch,onDelta});
      const callId=this.store.recordModelCall({provider:providerName,model:provider.model,purpose:input.purpose,batchId:input.batchId,candidateId:input.candidateId,
        estimatedInputTokens:context.afterTokens,promptTokens:Number(result.usage.prompt_tokens||0)+compressionUsage.prompt_tokens,
        completionTokens:Number(result.usage.completion_tokens||0)+compressionUsage.completion_tokens,compressed:context.compressed,
        latencyMs:Date.now()-started,status:'completed',generationSnapshotId:input.generationSnapshotId});
      return {...result,callId,provider:providerName,model:provider.model,context,usage:{...result.usage,compression:compressionUsage},
        outputBudget:{...outputBudget,used:outputBudget.initial,attempts:1}};
    } catch(error) {
      this.store.recordModelCall({provider:providerName,model:provider.model,purpose:input.purpose,batchId:input.batchId,candidateId:input.candidateId,
        estimatedInputTokens:context?.afterTokens??estimateTokens(input.messages),compressed:context?.compressed,latencyMs:Date.now()-started,status:'failed',error:error.message,
        generationSnapshotId:input.generationSnapshotId});throw error;
    }
  }
}
