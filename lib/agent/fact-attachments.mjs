import crypto from 'node:crypto';
import { stableArguments } from './context.mjs';

export function factAttachmentFingerprint(argumentsValue){return crypto.createHash('sha256').update(stableArguments(argumentsValue)).digest('hex');}
export function saveFactAttachment(store,{batchId,entryPoint='independent-writing',capability,arguments:args,agentRunId,data}){return store?.saveConversationFactAttachment?.({batchId,entryPoint,capability,fingerprint:factAttachmentFingerprint(args),agentRunId,data});}
export function getFactAttachment(store,{batchId,entryPoint='independent-writing',capability,arguments:args}){return store?.getConversationFactAttachment?.({batchId,entryPoint,capability,fingerprint:factAttachmentFingerprint(args)})||null;}

// 创建端回填用的搜索类能力（repository.inspect 无 query 语义，不在放宽范围内）
export const SEARCH_ATTACHMENT_CAPABILITIES=Object.freeze(['content.web.search','content.news.search','content.document.search']);

// 同 batch+entryPoint 的会话 Agent 检索结果选择：优先 _agentQuery 与 topic 精确匹配；
// 无精确匹配时回退到该能力最近一次结果（调用方传入的列表须按 updated_at DESC 排序，
// store.listConversationFactAttachments 即此语义）。batch/entryPoint 隔离由查询本身保证。
export function selectConversationSearchAttachments(attachments,topic){
  const selected=new Map();
  for(const capability of SEARCH_ATTACHMENT_CAPABILITIES){
    const items=(attachments||[]).filter((item)=>item.capability===capability);
    if(!items.length)continue;
    const exact=items.find((item)=>String(item.data?._agentQuery||'').trim()===String(topic||'').trim());
    selected.set(capability,exact||items[0]);
  }
  return selected;
}
