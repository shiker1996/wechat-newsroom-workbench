import fs from 'node:fs';
import path from 'node:path';
import { tagBatch } from '../../llm/tasks.mjs';
import { ensureBatchEventCards } from '../../llm/research-pipeline.mjs';
import { resolveArticleStageSkills } from '../../skills/entry-routing.mjs';
import { isFreshForBatch, clusterItems } from '../../llm/research-pipeline.mjs';
import { dailyFocusOptions } from '../../llm/daily-pipeline.mjs';
import { isResearchEligibleHotspot } from '../../domain/hotspot-pipeline-scope.mjs';
import { respond, boundedLimit } from '../route-helpers.mjs';
import { retryPipelineFailure } from '../../jobs/pipeline-failure-retry.mjs';
import { skipPipelineFailure, reopenPipelineFailure } from '../../jobs/pipeline-failure-decision.mjs';

export async function handleTaskRoutes({ request, response, pathname, searchParams, store, body, json, aiJobs, jobs, models, root, config,
  batchWorkdir, batchMaxAgeHours }) {
  const pipelineFailureGate=(batchId,stages,action)=>{const failures=store.listPipelineFailures(batchId,{statuses:['open','retrying'],stages});return failures.length
    ?{error:`上游环节仍有 ${failures.length} 条待处理失败，请先重试或跳过后再${action}`,code:'PIPELINE_FAILURES_PENDING',failureCount:failures.length,stages}:null;};
  const failureRetryMatch=pathname.match(/^\/api\/batches\/([^/]+)\/pipeline-failures\/(\d+)\/retry$/);
  if(failureRetryMatch&&request.method==='POST'){
    const batchId=decodeURIComponent(failureRetryMatch[1]);const input=await body(request);
    try{return respond(json,response,200,await retryPipelineFailure({failureId:Number(failureRetryMatch[2]),batchId,
      provider:input.provider||config.llm.defaultProvider,store,gateway:models,config}));}
    catch(error){return respond(json,response,422,{error:error.message});}
  }
  const failureDecisionMatch=pathname.match(/^\/api\/batches\/([^/]+)\/pipeline-failures\/(\d+)\/(skip|reopen)$/);
  if(failureDecisionMatch&&request.method==='POST'){
    const batchId=decodeURIComponent(failureDecisionMatch[1]);const input=await body(request);
    try{const failure=failureDecisionMatch[3]==='skip'
      ?skipPipelineFailure({failureId:Number(failureDecisionMatch[2]),batchId,reason:input.reason,store})
      :reopenPipelineFailure({failureId:Number(failureDecisionMatch[2]),batchId,store});
      return respond(json,response,200,{failure});}
    catch(error){return respond(json,response,422,{error:error.message});}
  }
  const tagMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/tag$/);
  if (tagMatch && request.method === 'POST') {
    const input = await body(request); const batchId = decodeURIComponent(tagMatch[1]);
    const blocked=pipelineFailureGate(batchId,['collect'],'打标');if(blocked)return respond(json,response,409,blocked);
    if (input.background === true) return respond(json, response, 202, aiJobs.start({ batchId, provider: input.provider, type: input.force ? 'retag' : 'tag', force: Boolean(input.force) }));
    const result = await tagBatch({ gateway: models, store, batchId, provider: input.provider, limit: input.limit, force: Boolean(input.force), maxAgeHours: batchMaxAgeHours(store.getBatch(batchId)), workspaceRoot: config.workspaceRoot });
    try {
      const cardResult = await ensureBatchEventCards({ gateway: models, store, batchId, provider: input.provider, workspaceRoot: config.workspaceRoot, maxAgeHours: batchMaxAgeHours(store.getBatch(batchId)), regenerate: Boolean(input.force) });
      result.eventCards = { total: cardResult.total, generated: cardResult.generated, cached: cardResult.cached, failed: cardResult.failed.length };
    } catch (error) { result.eventCards = { error: error.message }; }
    return respond(json, response, 200, result);
  }
  const researchMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/research$/);
  if (researchMatch && request.method === 'POST') {
    const input = await body(request); const batchId = decodeURIComponent(researchMatch[1]); const batch = store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    const blocked=pipelineFailureGate(batchId,['collect','tag','event-card'],'研判');if(blocked)return respond(json,response,409,blocked);
    return respond(json, response, 202, aiJobs.start({ batchId, provider: input.provider, type: batch.batch_type === 'breaking' ? 'breaking-analysis' : 'research' }));
  }
  const autoMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/auto$/);
  if (autoMatch && request.method === 'POST') {
    const input = await body(request); const batchId = decodeURIComponent(autoMatch[1]);
    if (!store.getBatch(batchId)) return respond(json, response, 404, { error: '批次不存在' });
    const blocked=pipelineFailureGate(batchId,['collect'],'继续流程');if(blocked)return respond(json,response,409,blocked);
    return respond(json, response, 202, aiJobs.start({ batchId, provider: input.provider, type: 'auto' }));
  }
  const eventCardsMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/event-cards$/);
  if (eventCardsMatch && request.method === 'POST') {
    const input = await body(request); const batchId = decodeURIComponent(eventCardsMatch[1]);
    if (!store.getBatch(batchId)) return respond(json, response, 404, { error: '批次不存在' });
    const blocked=pipelineFailureGate(batchId,['collect','tag'],'生成事件卡');if(blocked)return respond(json,response,409,blocked);
    return respond(json, response, 202, aiJobs.start({ batchId, provider: input.provider, type: 'event-cards', force: Boolean(input.force) }));
  }
  const dailyMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily$/);
  if (dailyMatch && request.method === 'GET') {
    const batchId = decodeURIComponent(dailyMatch[1]); const batch = store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    let eventCards = [], focusOptions = [];
    try {
      const cardFile = path.join(batchWorkdir(batch), 'sources', 'event-cards.json');
      if (fs.existsSync(cardFile)) {
        eventCards = JSON.parse(fs.readFileSync(cardFile, 'utf8'))?.items || [];
        const cardMap = new Map(eventCards.map((item) => [item.event_id, item]));
        const eligible = batch.hotspots.filter(isResearchEligibleHotspot).filter((item) => isFreshForBatch(item, batch.batch_date, batchMaxAgeHours(batch)));
        const clusters = clusterItems(eligible); for (const event of clusters) event.card = cardMap.get(event.event_id) || null;
        focusOptions = dailyFocusOptions(clusters);
      }
    } catch {}
    const documents = store.listDocuments(batchId).filter((item) => item.kind === 'daily-draft' || item.kind === 'daily-final');
    const jobs = store.listAiRuns(batchId, 30).filter((job) => job.type === 'daily').slice(0, 5).map((job) => {
      let focuses = []; try { const parsed = JSON.parse(job.result_json || '{}'); if (Array.isArray(parsed.focuses)) focuses = parsed.focuses; } catch {}
      return { id: job.id, status: job.status, progress: job.progress, error: job.error, provider: job.provider, focuses, createdAt: job.created_at, updatedAt: job.updated_at };
    });
    return respond(json, response, 200, { batch: { id: batch.id, title: batch.title, batchDate: batch.batch_date, batchType: batch.batch_type }, eventCards, focusOptions, documents, jobs });
  }
  if (dailyMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(dailyMatch[1]); const batch = store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    const input = await body(request); const requestedStages = input.stageSkills && typeof input.stageSkills === 'object' ? input.stageSkills : {};
    const hasExplicitStages = Object.values(requestedStages).some((value) => String(value || '').trim());
    const previousSnapshot = (input.useLatestSkill === true || hasExplicitStages) ? null : store.findLatestGenerationSnapshot({ batchId, candidateId: null, purposes: ['daily'] });
    const stageSelections = previousSnapshot ? null : await resolveArticleStageSkills({ workspaceRoot: root, entryPoint: 'batch-daily', requested: requestedStages });
    return respond(json, response, 202, aiJobs.start({ batchId, provider: previousSnapshot ? null : input.provider, type: 'daily', snapshotId: previousSnapshot?.id || null, stageSelections, focuses: Array.isArray(input.focuses) ? input.focuses : [], focus: input.focus || null }));
  }
  if (request.method === 'GET' && pathname === '/api/jobs') return respond(json, response, 200, store.listRecentRuns(boundedLimit(searchParams,40,500)));
  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobMatch && request.method === 'GET') {
    const persistedSource = /^source:(\d+)$/.exec(jobMatch[1]);
    const job = jobs.get(jobMatch[1]) ?? aiJobs.get(jobMatch[1]) ?? (persistedSource ? store.getSourceRun(Number(persistedSource[1])) : null);
    return respond(json, response, job ? 200 : 404, job ?? { error: '任务不存在或服务已重启' });
  }
  return false;
}
