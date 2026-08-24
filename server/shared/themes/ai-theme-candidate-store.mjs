import crypto from 'node:crypto';
import { AI_THEME_ERROR_CODES, AiThemeContractError } from './ai-theme-contract.mjs';

export class AiThemeCandidateStore {
  constructor({ttlMs=15*60*1000,maxEntries=50,now=()=>Date.now()}={}){this.ttlMs=ttlMs;this.maxEntries=maxEntries;this.now=now;this.items=new Map();}
  cleanup(){const time=this.now();for(const [id,item] of this.items)if(item.expiresAtMs<=time)this.items.delete(id);while(this.items.size>this.maxEntries)this.items.delete(this.items.keys().next().value);}
  put(value){this.cleanup();const id=crypto.randomUUID(),createdAtMs=this.now(),record={...structuredClone(value),id,createdAt:new Date(createdAtMs).toISOString(),expiresAt:new Date(createdAtMs+this.ttlMs).toISOString(),expiresAtMs:createdAtMs+this.ttlMs};this.items.set(id,record);this.cleanup();return this.public(record);}
  get(id){this.cleanup();const item=this.items.get(id);if(!item)throw new AiThemeContractError(AI_THEME_ERROR_CODES.CANDIDATE_EXPIRED,'AI 主题候选不存在或已过期',[{field:'candidateId',code:'EXPIRED',message:'请重新生成主题候选'}]);return this.public(item);}
  delete(id){return this.items.delete(id);}
  public(item){const {expiresAtMs,...value}=item;return structuredClone(value);}
}

export class AiThemeRateLimiter {
  constructor({limit=5,windowMs=60*1000,now=()=>Date.now()}={}){this.limit=limit;this.windowMs=windowMs;this.now=now;this.hits=new Map();}
  assert(key='workspace'){const cutoff=this.now()-this.windowMs,values=(this.hits.get(key)||[]).filter((value)=>value>cutoff);if(values.length>=this.limit)throw new AiThemeContractError(AI_THEME_ERROR_CODES.RATE_LIMITED,'AI 主题生成请求过于频繁，请稍后重试',[{field:'request',code:'RATE_LIMITED',message:`每 ${Math.ceil(this.windowMs/1000)} 秒最多生成 ${this.limit} 次`}]);values.push(this.now());this.hits.set(key,values);}
}

