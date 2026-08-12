import { tagBatch } from '../llm/tasks.mjs';
import { ensureBatchEventCards, runResearchPipeline } from '../llm/research-pipeline.mjs';
import { runBreakingAnalysisPipeline } from '../llm/breaking-analysis-pipeline.mjs';

export async function runAutoPipeline({ gateway, store, config, job, batch, maxAgeHours, onProgress }) {
  if (batch?.batch_type === 'breaking') {
    return runBreakingAnalysisPipeline({
      gateway,
      store,
      batchId: job.batchId,
      provider: job.provider,
      workspaceRoot: config.workspaceRoot,
      onProgress,
    });
  }

  store.updateBatch(job.batchId, { stage: 'synthesis', status: 'running' });
  job.phase = 'tag';
  let result = await tagBatch({
    gateway,
    store,
    batchId: job.batchId,
    provider: job.provider,
    force: false,
    maxAgeHours,
    workspaceRoot: config.workspaceRoot,
    runId: job.id,
    onProgress,
  });
  const tagFailures=store.listPipelineFailures(job.batchId,{statuses:['open','retrying'],stages:['tag']});
  if(tagFailures.length)throw new Error(`语义打标存在 ${tagFailures.length} 条待处理失败，流程已暂停；请重试或跳过后继续`);

  job.phase = 'event-cards';
  const cardResult = await ensureBatchEventCards({
    gateway,
    store,
    batchId: job.batchId,
    provider: job.provider,
    workspaceRoot: config.workspaceRoot,
    maxAgeHours,
    runId: job.id,
    onProgress,
  });
  result = {
    ...result,
    eventCards: {
      total: cardResult.total,
      generated: cardResult.generated,
      cached: cardResult.cached,
      failed: cardResult.failed.length,
    },
  };
  const eventCardFailures=store.listPipelineFailures(job.batchId,{statuses:['open','retrying'],stages:['event-card']});
  if(eventCardFailures.length)throw new Error(`事件卡存在 ${eventCardFailures.length} 条待处理失败，流程已暂停；请重试或跳过后继续`);

  store.updateBatch(job.batchId, { stage: 'synthesis', status: 'review' });
  job.phase = 'research';
  const research = await runResearchPipeline({
    gateway,
    store,
    batchId: job.batchId,
    provider: job.provider,
    workspaceRoot: config.workspaceRoot,
    maxAgeHours,
    onProgress,
  });
  return { ...result, research };
}
