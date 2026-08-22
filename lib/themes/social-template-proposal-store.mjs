import crypto from 'node:crypto';
import { SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES, SocialTemplateProposalError } from './social-template-proposal.mjs';

export class SocialTemplateProposalStore {
  constructor({ttlMs=20*60*1000,maxEntries=40,now=()=>Date.now()}={}){this.ttlMs=ttlMs;this.maxEntries=maxEntries;this.now=now;this.items=new Map();}
  cleanup(){const time=this.now();for(const [id,item] of this.items)if(item.expiresAtMs<=time)this.items.delete(id);while(this.items.size>this.maxEntries)this.items.delete(this.items.keys().next().value);}
  put(value){this.cleanup();const id=crypto.randomUUID(),createdAtMs=this.now(),record={...structuredClone(value),id,createdAt:new Date(createdAtMs).toISOString(),expiresAt:new Date(createdAtMs+this.ttlMs).toISOString(),expiresAtMs:createdAtMs+this.ttlMs};this.items.set(id,record);this.cleanup();return this.public(record);}
  get(id){this.cleanup();const item=this.items.get(id);if(!item)throw new SocialTemplateProposalError(SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.EXPIRED,'Social 模板提案不存在或已过期',[{field:'proposalId',code:'EXPIRED',message:'请重新生成模板提案'}]);return this.public(item);}
  getByProposalId(proposalId){this.cleanup();const item=[...this.items.values()].find((value)=>value.proposal?.proposalId===proposalId);if(!item)throw new SocialTemplateProposalError(SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.EXPIRED,'Social 模板提案不存在或已过期',[{field:'proposalId',code:'EXPIRED',message:'请重新生成模板提案'}]);return this.public(item);}
  update(id,patch={}){this.cleanup();const item=this.items.get(id)||[...this.items.values()].find((value)=>value.proposal?.proposalId===id);if(!item)throw new SocialTemplateProposalError(SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.EXPIRED,'Social 模板提案不存在或已过期',[{field:'proposalId',code:'EXPIRED',message:'请重新生成模板提案'}]);Object.assign(item,structuredClone(patch));return this.public(item);}
  delete(id){return this.items.delete(id);}
  public(item){const {expiresAtMs,...value}=item;return structuredClone(value);}
}

export class SocialTemplateProposalRateLimiter {
  constructor({limit=4,windowMs=60*1000,now=()=>Date.now()}={}){this.limit=limit;this.windowMs=windowMs;this.now=now;this.hits=new Map();}
  assert(key='workspace'){const cutoff=this.now()-this.windowMs,values=(this.hits.get(key)||[]).filter((value)=>value>cutoff);if(values.length>=this.limit)throw new SocialTemplateProposalError(SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.RATE_LIMITED,'Social 模板提案生成请求过于频繁，请稍后重试',[{field:'request',code:'RATE_LIMITED',message:`每 ${Math.ceil(this.windowMs/1000)} 秒最多生成 ${this.limit} 次`}]);values.push(this.now());this.hits.set(key,values);}
}
