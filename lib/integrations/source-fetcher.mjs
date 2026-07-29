import { createStoreExecutionLogger } from '../tools/execution-log.mjs';
import { executeInformationCapabilitySlot } from '../tools/capability-slots.mjs';
import {
  fetchCandidateSourceImplementation,
  fetchMaterialSourceImplementation,
} from './source-fetcher-core.mjs';

export async function fetchUrlContent(input) {
  const { toolContext = {}, ...pluginInput } = input;
  const result = await executeInformationCapabilitySlot('web-page', pluginInput, {
    workspaceRoot:pluginInput.root,
    allowedRoots:pluginInput.root ? [pluginInput.root] : [],
    allowedCapabilities:toolContext.allowedCapabilities,
    timeoutMs:pluginInput.timeoutMs || 90000,
    executionLog:createStoreExecutionLogger(toolContext.store,toolContext),
  });
  if (result.status === 'error') {
    return {
      status:'error', url:input.targetUrl || '', final_url:'', title:input.title || '',
      description:'', author:'', published_at:'', content:'', content_chars:0,
      fetched_at:new Date().toISOString(), error:result.error.message, fetch_method:'plugin',
    };
  }
  return result.data;
}

export function fetchCandidateSource(input) {
  const candidate=input.store?.getCandidate?.(input.candidateId);
  return fetchCandidateSourceImplementation({
    ...input,
    toolContext:{
      store:input.store,
      batchId:candidate?.batch_id || null,
      candidateId:input.candidateId || null,
      ...input.toolContext,
    },
    fetchImpl:fetchUrlContent,
  });
}

export function fetchMaterialSource(input) {
  return fetchMaterialSourceImplementation({
    ...input,
    toolContext:{store:input.store,...input.toolContext},
    fetchImpl:fetchUrlContent,
  });
}
