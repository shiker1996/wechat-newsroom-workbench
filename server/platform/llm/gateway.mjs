import { compactMessages, contextBudget, estimateTokens, SUMMARY_SYSTEM_PROMPT } from './context-manager.mjs';
import { webSearch as tavilySearch, formatSearchResults } from './web-search.mjs';
import { outputBudgetFor, TRUNCATION_RETRY_SYSTEM_PROMPT } from './output-budget.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { applyModelProviderConfiguration } from '../extensions/model-provider-configuration.mjs';

// 后台任务 thinking 实时进度：AiJobManager 在 run() 外层注册当前任务的接收器，
// complete() 检测到接收器且本次 thinking 开启时，内部改用流式把 reasoning 实时转发给接收器。
const thinkingSinkStore = new AsyncLocalStorage();

export function runWithThinkingSink(sink, fn) {
  return thinkingSinkStore.run(sink, fn);
}

function currentThinkingSink() {
  return thinkingSinkStore.getStore();
}

function endpoint(baseUrl) {
  const value=String(baseUrl).replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(value)?value:`${value}/chat/completions`;
}

// 会话 Agent 的伪工具协议用 role:'tool' 消息携带 JSON 结果，但本网关不使用原生 tool_calls，
// OpenAI 兼容端点（如 DeepSeek）会因缺少 tool_call_id 拒绝 tool 角色消息（HTTP 400），统一降级为 user。
function wireMessages(messages){return messages.map(({role,content})=>({role:role==='tool'?'user':role,content:String(content??'')}));}

function attachAbort(controller,signal){if(!signal)return()=>{};if(signal.aborted){controller.abort(signal.reason);return()=>{};}const abort=()=>controller.abort(signal.reason);signal.addEventListener('abort',abort,{once:true});return()=>signal.removeEventListener('abort',abort);}

function retryableStatus(status){return status===429||(status>=500&&status<=599);}
function retryDelay(attempt){return Math.min(1000,100*2**attempt);}
async function abortableDelay(ms,signal){if(signal?.aborted)throw signal.reason??new Error('请求已取消');await new Promise((resolve,reject)=>{const done=()=>{signal?.removeEventListener('abort',abort);resolve();};const timer=setTimeout(done,ms);const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason??new Error('请求已取消'));};signal?.addEventListener('abort',abort,{once:true});});}

async function fetchWithRetry(url,options,{maxAttempts=3}={}){let response;for(let attempt=0;attempt<maxAttempts;attempt+=1){if(options.signal?.aborted)throw options.signal.reason??new Error('请求已取消');response=await fetch(url,options);if(!retryableStatus(response.status)||attempt===maxAttempts-1)return response;try{await response.body?.cancel?.();}catch{}await abortableDelay(retryDelay(attempt),options.signal);}return response;}

// thinking 按用途裁决：机械结构化输出关闭推理（reasoning tokens 计入 max_tokens 会截断 JSON），
// 综合研判、写作生成、交互对话保持开启。调用方可用 input.thinking 显式覆盖。
const THINKING_DISABLED_PATTERNS = [
  /^hotspot-tagging$/,
  /^event-card$/,
  /^hotspot-brainstorm-explore$/,
  /quality-gate/,
  /title-generation/,
  /^article-fact-base$/,
  /^article-planning$/,
  /^article-image-plan$/,
  /^article-visual-plan/,
  /^magazine-design$/,
  /^social-card-/,
  /^connection-test$/,
];

export function thinkingEnabledFor(purpose) {
  const key = String(purpose || '');
  return !THINKING_DISABLED_PATTERNS.some((pattern) => pattern.test(key));
}

function budgetAudit(input,provider,outputBudget,thinking,thinkingReserve){return {...outputBudget,source:Number(input.maxOutputTokens)>0?'caller':(outputBudget.adaptive?'purpose-profile':'default-or-fixed-profile'),thinkingReserve,thinkingEnabled:Boolean(thinking),providerSupportsThinkingToggle:provider.supportsThinkingToggle===true};}

// 构造 thinking 相关 payload：开关在 thinking.type，推理强度按 DeepSeek 文档同时发
// 顶层 reasoning_effort（OpenAI SDK 示例用法）与 thinking 内嵌（接口 schema 用法），
// 保证低强度配置真正生效；未配置推理强度时显式开启 thinking（避免落到 DeepSeek 默认 high）。
function thinkingPayload(thinking, provider) {
  if (thinking === false && provider.supportsThinkingToggle) return { thinking: { type: 'disabled' } };
  if (thinking !== false) {
    const payload = { thinking: { type: 'enabled' } };
    if (provider.reasoningEffort) {
      payload.thinking.reasoning_effort = provider.reasoningEffort;
      payload.reasoning_effort = provider.reasoningEffort;
    }
    return payload;
  }
  return {};
}

function publicProvider(name, provider, configured) {
  return {
    name,
    label: provider.label || name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKeyEnv: provider.apiKeyEnv,
    configured,
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
  constructor(config, store, configurationResolver=null) {
    this.config = config.llm;
    this.store = store;
    this.configurationResolver = configurationResolver;
  }

  configuredProvider(name) {
    const declared=this.config.providers[name];
    if(!declared)return null;
    const state=this.configurationResolver?this.configurationResolver(name,declared):{configured:false,values:{}};
    return {provider:applyModelProviderConfiguration(declared,state.values||{}),apiKey:state.values?.apiKey||'',configured:state.configured===true&&Boolean(state.values?.apiKey)};
  }

  listProviders() {
    return {
      defaultProvider: this.config.defaultProvider,
      providers: Object.keys(this.config.providers).map((name) => {const value=this.configuredProvider(name);return publicProvider(name,value.provider,value.configured);}),
    };
  }

  resolve(name) {
    const providerName = name || this.config.defaultProvider;
    const resolved=this.configuredProvider(providerName);
    const provider = resolved?.provider;
    if (!provider || provider.enabled === false) throw new Error(`模型服务 ${providerName} 未启用`);
    const apiKey = resolved.apiKey;
    if (!apiKey) throw new Error(`模型服务 ${providerName} 凭据未配置，请前往系统与配置中心完成配置`);
    return { providerName, provider, apiKey };
  }

  async rawComplete({ providerName, provider, apiKey, messages, maxOutputTokens, temperature = 0.2, jsonMode = false, webSearch = false, thinking, signal }) {
    const controller = new AbortController();
    const detachAbort=attachAbort(controller,signal);
    let timedOut=false;const timer = setTimeout(() => {timedOut=true;controller.abort();}, this.config.requestTimeoutMs);
    const maxTokens = Math.min(maxOutputTokens || provider.maxOutputTokens, provider.maxOutputTokens);
    try {
      const modes=jsonMode&&provider.supportsJsonMode===true?[true,false]:[false];
      for(const useJsonMode of modes) {
        const payload = { model: provider.model, messages: wireMessages(messages), temperature };
        payload[provider.maxTokensField || 'max_tokens'] = maxTokens;
        Object.assign(payload, thinkingPayload(thinking, provider));
        if(useJsonMode)payload.response_format={type:'json_object'};
        if(webSearch && provider.webSearchConfig) { payload[provider.webSearchConfig.payloadKey] = provider.webSearchConfig.payloadValue; }
        const response = await fetchWithRetry(endpoint(provider.baseUrl), {
          method: 'POST', signal: controller.signal,
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if(!response.ok&&useJsonMode&&[400,422].includes(response.status))continue;
        if (!response.ok) throw new Error(`${provider.label || providerName} HTTP ${response.status}: ${data.error?.message || '调用失败'}`);
        const finishReason = data.choices?.[0]?.finish_reason ?? null;
        if (finishReason === 'content_filter') throw new Error(`${provider.label || providerName} 输出触发内容过滤，未返回内容`);
        if (finishReason === 'insufficient_system_resource') throw new Error(`${provider.label || providerName} 服务端推理资源不足，生成被打断，请稍后重试`);
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new Error(`${provider.label || providerName} 未返回文本内容`);
        // thinking 开启且 max_tokens 偏小时，预算可能全部耗在 reasoning 上：
        // content 为空串且 finish_reason=length，应当作截断处理，避免空内容传染下游阶段
        if (finishReason === 'length' && !content.trim()) throw new Error(`${provider.label || providerName} 输出达到上限且未返回内容（推理可能占满输出预算）`);
        if (!content.trim()) throw new Error(`${provider.label || providerName} 未返回文本内容（finish=${finishReason || 'unknown'}，输出为空白）`);
        // thinking 过程（DeepSeek reasoning_content）：只读不回写 prompt，供编辑室/任务日志展示
        const reasoning = data.choices?.[0]?.message?.reasoning_content;
        return { content, reasoning: typeof reasoning === 'string' && reasoning ? reasoning : '', usage: data.usage ?? {}, id: data.id ?? null, finishReason };
      }
      throw new Error(`${provider.label || providerName} 不支持结构化输出模式`);
    } catch (error) {
      // AbortController 超时会在响应体读取阶段中断 fetch，response.json() 的兜底会把超时吞成「未返回文本内容」，这里还原为明确的超时错误
      if (timedOut) throw new Error(`${provider.label || providerName} 请求超时（${this.config.requestTimeoutMs}ms），可在 config.local.json 调大 llm.requestTimeoutMs`);
      if (signal?.aborted) throw Object.assign(new Error(`${provider.label || providerName} 请求已取消`),{code:'MODEL_CALL_ABORTED'});
      throw error;
    } finally {
      detachAbort();
      clearTimeout(timer);
    }
  }

  async rawStreamComplete({ providerName, provider, apiKey, messages, maxOutputTokens, temperature = 0.2, jsonMode = false, webSearch = false, onDelta = () => {}, thinking, signal }, onThinking = () => {}) {
    const controller=new AbortController();const detachAbort=attachAbort(controller,signal);let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},this.config.requestTimeoutMs);
    const maxTokens=Math.min(maxOutputTokens||provider.maxOutputTokens,provider.maxOutputTokens);
    try {
      const modes=jsonMode&&provider.supportsJsonMode===true?[true,false]:[false];
      for(const useJsonMode of modes) {
        const payload={model:provider.model,messages:wireMessages(messages),temperature,stream:true};
        payload[provider.maxTokensField||'max_tokens']=maxTokens;
        Object.assign(payload, thinkingPayload(thinking, provider));
        payload.stream_options={include_usage:true};
        if(useJsonMode)payload.response_format={type:'json_object'};
        if(webSearch&&provider.webSearchConfig)payload[provider.webSearchConfig.payloadKey]=provider.webSearchConfig.payloadValue;
        const response=await fetchWithRetry(endpoint(provider.baseUrl),{method:'POST',signal:controller.signal,
          headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify(payload)});
        if(!response.ok) {
          const data=await response.json().catch(()=>({}));
          if(useJsonMode&&[400,422].includes(response.status))continue;
          throw new Error(`${provider.label||providerName} HTTP ${response.status}: ${data.error?.message||'调用失败'}`);
        }
        if(!response.body)throw new Error(`${provider.label||providerName} 未返回流式响应体`);
        const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';let content='';let reasoning='';let usage={};let id=null;let finishReason=null;
        const processLine=(line)=>{
          const trimmed=line.trim();if(!trimmed.startsWith('data:'))return;const dataText=trimmed.slice(5).trim();if(!dataText||dataText==='[DONE]')return;
          let data;try{data=JSON.parse(dataText);}catch{return;} id=data.id||id;usage=data.usage||usage;
          const choice=data.choices?.[0];const delta=choice?.delta?.content??choice?.message?.content??'';
          if(delta){content+=delta;onDelta(delta,content);}
          // thinking 过程逐段透传（DeepSeek 流式在 delta.reasoning_content）
          const reasoningDelta=choice?.delta?.reasoning_content??choice?.message?.reasoning_content??'';
          if(reasoningDelta){reasoning+=reasoningDelta;onThinking(reasoningDelta,reasoning);}
          if(choice?.finish_reason)finishReason=choice.finish_reason;
        };
        while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';for(const line of lines)processLine(line);}
        buffer+=decoder.decode();if(buffer.trim())processLine(buffer);
        if(finishReason==='content_filter')throw new Error(`${provider.label||providerName} 输出触发内容过滤，未返回内容`);
        if(finishReason==='insufficient_system_resource')throw new Error(`${provider.label||providerName} 服务端推理资源不足，生成被打断，请稍后重试`);
        if(!content.trim())throw new Error(`${provider.label||providerName} 未返回流式文本内容（finish=${finishReason||'unknown'}${reasoning?`，推理已产生 ${reasoning.length} 字符后内容为空`:''}）`);
        return {content,reasoning,usage,id,finishReason};
      }
      throw new Error(`${provider.label||providerName} 不支持结构化输出模式`);
    } catch(error) {
      if (timedOut) throw new Error(`${provider.label||providerName} 请求超时（${this.config.requestTimeoutMs}ms），可在 config.local.json 调大 llm.requestTimeoutMs`);
      if(signal?.aborted)throw Object.assign(new Error(`${provider.label||providerName} 请求已取消`),{code:'MODEL_CALL_ABORTED'});
      throw error;
    } finally {detachAbort();clearTimeout(timer);}
  }

  // complete() 的 thinking 实时化：有当前任务接收器且本次 thinking 开启时，
  // 改用流式（内容逐段累加，语义与返回结构与非流式一致），reasoning 增量转发给接收器；
  // 否则保持非流式，行为与以前完全相同。
  async rawCompleteMaybeStream(opts, { streamThinking = false } = {}) {
    const sink = currentThinkingSink();
    if (!streamThinking || !sink) return this.rawComplete(opts);
    return this.rawStreamComplete({ ...opts, onDelta: () => {} }, (delta) => { try { sink(String(delta ?? '')); } catch { /* 进度写入失败不阻断推理 */ } });
  }

  async complete(input) {
    const { providerName, provider, apiKey } = this.resolve(input.provider);
    const thinking = input.thinking ?? thinkingEnabledFor(input.purpose);
    const started = Date.now();
    const outputBudget = outputBudgetFor({
      purpose: input.purpose,
      providerMax: provider.maxOutputTokens,
      requested: input.maxOutputTokens,
      adaptive: input.adaptiveOutput,
    });
    // thinking 开启时推理 token 与内容共享 max_tokens，预算需加推理余量，否则长输入的推理会吃光内容预算导致截断
    const thinkingReserve = thinking && provider.supportsThinkingToggle === true ? Math.max(0, Number(provider.thinkingReserveTokens ?? 8000) || 0) : 0;
    const streamThinking = Boolean(currentThinkingSink()) && thinking;
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
          const result = await this.rawComplete({ providerName, provider, apiKey, thinking: false, maxOutputTokens: Math.min(1800, provider.maxOutputTokens), messages: [
            { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
            { role: 'user', content: old.map((m, i) => `[${i + 1}] ${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n') },
          ], signal:input.signal });
          compressionUsage.prompt_tokens += Number(result.usage.prompt_tokens || 0);
          compressionUsage.completion_tokens += Number(result.usage.completion_tokens || 0);
          compressionUsage.calls += 1;
          return result.content;
        },
      });
      let result;
      let fallbackAttemptUsage = null;
      try {
        result = await this.rawCompleteMaybeStream({ providerName, provider, apiKey, messages: context.messages,
          maxOutputTokens: outputBudget.initial + thinkingReserve, temperature: input.temperature, jsonMode: input.jsonMode, thinking, signal:input.signal }, { streamThinking });
      } catch (error) {
        // thinking 开启时推理可能吃光 max_tokens 导致内容为空（finish=length）：回落无思考重试一次
        if (thinking && /未返回流式文本内容/.test(String(error.message || ''))) {
          result = await this.rawCompleteMaybeStream({ providerName, provider, apiKey, messages: context.messages,
            maxOutputTokens: outputBudget.initial, temperature: input.temperature, jsonMode: input.jsonMode, thinking: false, signal:input.signal }, { streamThinking: false });
        } else {
          throw error;
        }
      }
      if (thinking && !String(result.content || '').trim() && result.finishReason === 'length') {
        fallbackAttemptUsage = result.usage;
        result = await this.rawCompleteMaybeStream({ providerName, provider, apiKey, messages: context.messages,
          maxOutputTokens: outputBudget.initial, temperature: input.temperature, jsonMode: input.jsonMode, thinking: false, signal:input.signal }, { streamThinking: false });
      }
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
            const summary = await this.rawComplete({ providerName, provider, apiKey, thinking: false, maxOutputTokens: Math.min(1800, provider.maxOutputTokens), messages: [
              { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
              { role: 'user', content: old.map((m, i) => `[${i + 1}] ${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n') },
            ], signal:input.signal });
            compressionUsage.prompt_tokens += Number(summary.usage.prompt_tokens || 0);
            compressionUsage.completion_tokens += Number(summary.usage.completion_tokens || 0);
            compressionUsage.calls += 1;
            return summary.content;
          },
        });
        context = retryContext;
        result = await this.rawCompleteMaybeStream({ providerName, provider, apiKey, messages: retryContext.messages,
          maxOutputTokens: outputBudget.retry + thinkingReserve, temperature: input.temperature, jsonMode: input.jsonMode, thinking, signal:input.signal }, { streamThinking });
      }
      const promptTokens = Number(result.usage.prompt_tokens || 0) + Number(firstAttemptUsage?.prompt_tokens || 0) + Number(fallbackAttemptUsage?.prompt_tokens || 0);
      const completionTokens = Number(result.usage.completion_tokens || 0) + Number(firstAttemptUsage?.completion_tokens || 0) + Number(fallbackAttemptUsage?.completion_tokens || 0);
      const reasoningTokens = Number(result.usage?.completion_tokens_details?.reasoning_tokens || 0)
        + Number(firstAttemptUsage?.completion_tokens_details?.reasoning_tokens || 0)
        + Number(fallbackAttemptUsage?.completion_tokens_details?.reasoning_tokens || 0);
      const callId = this.store.recordModelCall({ provider: providerName, model: provider.model, purpose: input.purpose,
        batchId: input.batchId, candidateId: input.candidateId, estimatedInputTokens: context.afterTokens,
        promptTokens: promptTokens + compressionUsage.prompt_tokens,
        completionTokens: completionTokens + compressionUsage.completion_tokens,
        reasoningTokens: reasoningTokens || null,
        compressed: context.compressed, latencyMs: Date.now() - started, status: 'completed',
        outputText: String(result.content ?? '').slice(0, 20000),
        reasoningText: typeof result.reasoning === 'string' && result.reasoning ? result.reasoning.slice(0, 20000) : null,
        outputBudget:budgetAudit(input,provider,outputBudget,thinking,thinkingReserve),generationSnapshotId:input.generationSnapshotId });
      return { ...result, callId, usage: { ...result.usage, compression: compressionUsage },
        provider: providerName, model: provider.model, context,
        outputBudget: { ...outputBudget, used: attempts === 2 ? outputBudget.retry : outputBudget.initial, attempts } };
    } catch (error) {
      this.store.recordModelCall({ provider: providerName, model: provider.model, purpose: input.purpose,
        batchId: input.batchId, candidateId: input.candidateId,
        estimatedInputTokens: context?.afterTokens ?? estimateTokens(input.messages), compressed: context?.compressed,
        latencyMs: Date.now() - started, status: 'failed', error: error.message,
        outputBudget:budgetAudit(input,provider,outputBudget,thinking,thinkingReserve),generationSnapshotId:input.generationSnapshotId });
      throw error;
    }
  }

  async streamComplete(input,onDelta=()=>{},onThinking=()=>{}) {
    const {providerName,provider,apiKey}=this.resolve(input.provider);const started=Date.now();
    const thinking=input.thinking??thinkingEnabledFor(input.purpose);
    const thinkingReserve=thinking&&provider.supportsThinkingToggle===true?Math.max(0,Number(provider.thinkingReserveTokens??8000)||0):0;
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
        const result=await this.rawComplete({providerName,provider,apiKey,thinking:false,maxOutputTokens:Math.min(1800,provider.maxOutputTokens),messages:[
          {role:'system',content:SUMMARY_SYSTEM_PROMPT},{role:'user',content:old.map((m,i)=>`[${i+1}] ${m.role}: ${typeof m.content==='string'?m.content:JSON.stringify(m.content)}`).join('\n\n')} ],signal:input.signal});
        compressionUsage.prompt_tokens+=Number(result.usage.prompt_tokens||0);compressionUsage.completion_tokens+=Number(result.usage.completion_tokens||0);compressionUsage.calls+=1;return result.content;
      }});
      let result;let attempts=1;let firstAttemptUsage=null;const bufferedDeltas=[];const initialOnDelta=outputBudget.adaptive?(delta)=>bufferedDeltas.push(delta):onDelta;
      try {
        result=await this.rawStreamComplete({providerName,provider,apiKey,messages:context.messages,maxOutputTokens:outputBudget.initial+thinkingReserve,
          temperature:input.temperature,jsonMode:input.jsonMode,webSearch,onDelta:initialOnDelta,thinking,signal:input.signal},onThinking);
      } catch (error) {
        // thinking 开启时推理可能吃光 max_tokens 导致内容为空（finish=length）：回落无思考重试一次
        if (thinking && /未返回流式文本内容/.test(String(error.message || ''))) {
          result=await this.rawStreamComplete({providerName,provider,apiKey,messages:context.messages,maxOutputTokens:outputBudget.initial,
            temperature:input.temperature,jsonMode:input.jsonMode,webSearch,onDelta:initialOnDelta,thinking:false,signal:input.signal},()=>{});
        } else {
          throw error;
        }
      }
      if(result.finishReason==='length'&&outputBudget.adaptive){firstAttemptUsage=result.usage;attempts=2;const retryBudget=contextBudget(provider,this.config,outputBudget.retry);context=await compactMessages([{role:'system',content:TRUNCATION_RETRY_SYSTEM_PROMPT,protected:true},...input.messages],{budget:retryBudget,recentMessageCount:this.config.recentMessageCount,summarize:async(old)=>{const summary=await this.rawComplete({providerName,provider,apiKey,thinking:false,maxOutputTokens:Math.min(1800,provider.maxOutputTokens),messages:[{role:'system',content:SUMMARY_SYSTEM_PROMPT},{role:'user',content:old.map((m,i)=>`[${i+1}] ${m.role}: ${typeof m.content==='string'?m.content:JSON.stringify(m.content)}`).join('\n\n')}],signal:input.signal});compressionUsage.prompt_tokens+=Number(summary.usage.prompt_tokens||0);compressionUsage.completion_tokens+=Number(summary.usage.completion_tokens||0);compressionUsage.calls+=1;return summary.content;}});result=await this.rawStreamComplete({providerName,provider,apiKey,messages:context.messages,maxOutputTokens:outputBudget.retry+thinkingReserve,temperature:input.temperature,jsonMode:input.jsonMode,webSearch,onDelta,thinking,signal:input.signal},onThinking);}else if(outputBudget.adaptive){let accumulated='';for(const delta of bufferedDeltas){accumulated+=delta;onDelta(delta,accumulated);}}
      const reasoningTokens=Number(result.usage?.completion_tokens_details?.reasoning_tokens||0);
      const callId=this.store.recordModelCall({provider:providerName,model:provider.model,purpose:input.purpose,batchId:input.batchId,candidateId:input.candidateId,
        estimatedInputTokens:context.afterTokens,promptTokens:Number(result.usage.prompt_tokens||0)+Number(firstAttemptUsage?.prompt_tokens||0)+compressionUsage.prompt_tokens,
        completionTokens:Number(result.usage.completion_tokens||0)+Number(firstAttemptUsage?.completion_tokens||0)+compressionUsage.completion_tokens,reasoningTokens:reasoningTokens||null,compressed:context.compressed,
        latencyMs:Date.now()-started,status:'completed',outputText:String(result.content??'').slice(0,20000),
        reasoningText:typeof result.reasoning==='string'&&result.reasoning?result.reasoning.slice(0,20000):null,
        outputBudget:budgetAudit(input,provider,outputBudget,thinking,thinkingReserve),generationSnapshotId:input.generationSnapshotId});
      return {...result,callId,provider:providerName,model:provider.model,context,usage:{...result.usage,compression:compressionUsage},
        outputBudget:{...outputBudget,used:attempts===2?outputBudget.retry:outputBudget.initial,attempts}};
    } catch(error) {
      this.store.recordModelCall({provider:providerName,model:provider.model,purpose:input.purpose,batchId:input.batchId,candidateId:input.candidateId,
        estimatedInputTokens:context?.afterTokens??estimateTokens(input.messages),compressed:context?.compressed,latencyMs:Date.now()-started,status:'failed',error:error.message,
        outputBudget:budgetAudit(input,provider,outputBudget,thinking,thinkingReserve),generationSnapshotId:input.generationSnapshotId});throw error;
    }
  }
}
