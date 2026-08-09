import { tagBatch } from '../llm/tasks.mjs';
import { runResearchPipeline, ensureBatchEventCards } from '../llm/research-pipeline.mjs';
import { runArticlePipeline } from '../llm/article-pipeline.mjs';
import { runTypesetPipeline } from '../llm/typeset-pipeline.mjs';
import { runSocialCardPipeline } from '../llm/social-card-pipeline.mjs';
import { runBreakingAnalysisPipeline } from '../llm/breaking-analysis-pipeline.mjs';
import { runDailyPipeline } from '../llm/daily-pipeline.mjs';
import { runTutorialPipeline } from '../llm/tutorial-pipeline.mjs';
import { runCoverImageJob } from '../llm/cover-image-generator.mjs';
import { runAutoPipeline } from './auto-pipeline.mjs';

export const AI_JOB_TYPES = Object.freeze([
  'tag', 'retag', 'event-cards', 'research', 'breaking-analysis', 'article',
  'daily', 'tutorial', 'typeset', 'social-card', 'cover-image', 'auto',
]);

export const BATCH_LEVEL_AI_JOB_TYPES = new Set([
  'tag', 'retag', 'event-cards', 'research', 'breaking-analysis', 'auto', 'daily',
]);

export function createAiJobHandlers({ store, gateway, config, log }) {
  const progress = (job) => (message) => log(job, message);
  return new Map([
    ['tag', async ({ job, maxAgeHours, options }) => {
      store.updateBatch(job.batchId, { stage: 'synthesis', status: 'running' });
      const result = await tagBatch({ gateway, store, batchId: job.batchId, provider: job.provider,
        force: Boolean(options.force), maxAgeHours, workspaceRoot: config.workspaceRoot, onProgress: progress(job) });
      store.updateBatch(job.batchId, { stage: 'synthesis', status: 'review' });
      return result;
    }],
    ['retag', async ({ job, maxAgeHours }) => {
      store.updateBatch(job.batchId, { stage: 'synthesis', status: 'running' });
      const result = await tagBatch({ gateway, store, batchId: job.batchId, provider: job.provider,
        force: true, maxAgeHours, workspaceRoot: config.workspaceRoot, onProgress: progress(job) });
      store.updateBatch(job.batchId, { stage: 'synthesis', status: 'review' });
      return result;
    }],
    ['event-cards', async ({ job, maxAgeHours, options }) => {
      store.updateBatch(job.batchId, { stage: 'synthesis', status: 'running' });
      const result = await ensureBatchEventCards({ gateway, store, batchId: job.batchId, provider: job.provider,
        workspaceRoot: config.workspaceRoot, maxAgeHours, regenerate: Boolean(options.force), onProgress: progress(job) });
      store.updateBatch(job.batchId, { stage: 'synthesis', status: 'review' });
      if (result.failed.length) throw new Error(`${result.failed.length} 张事件卡生成失败，可点击“继续生成事件卡”重试`);
      return result;
    }],
    ['research', ({ job, maxAgeHours }) => runResearchPipeline({ gateway, store, batchId: job.batchId,
      provider: job.provider, workspaceRoot: config.workspaceRoot, maxAgeHours, onProgress: progress(job) })],
    ['breaking-analysis', ({ job }) => runBreakingAnalysisPipeline({ gateway, store, batchId: job.batchId,
      provider: job.provider, workspaceRoot: config.workspaceRoot, onProgress: progress(job) })],
    ['article', ({ job, options }) => runArticlePipeline({ gateway, store, batchId: job.batchId, candidateId: options.candidateId,
      provider: job.requestedProvider, workspaceRoot: config.workspaceRoot, snapshotId: job.snapshotId,
      skillSelection: job.skillSelection, stageSelections: job.stageSelections, articleLength: config.articleLength,
      onProgress: progress(job) })],
    ['daily', ({ job, options }) => runDailyPipeline({ gateway, store, batchId: job.batchId, provider: job.requestedProvider,
      workspaceRoot: config.workspaceRoot, snapshotId: job.snapshotId, stageSelections: job.stageSelections,
      focus: options.focus, focuses: options.focuses, articleLength: config.articleLength, onProgress: progress(job) })],
    ['tutorial', ({ job, options }) => runTutorialPipeline({ gateway, store, batchId: job.batchId, candidateId: options.candidateId,
      provider: job.requestedProvider, workspaceRoot: config.workspaceRoot, snapshotId: job.snapshotId,
      skillSelection: job.skillSelection, stageSelections: job.stageSelections, articleLength: config.articleLength,
      onProgress: progress(job) })],
    ['typeset', ({ job, options }) => runTypesetPipeline({ gateway, store, batchId: job.batchId, candidateId: options.candidateId,
      provider: job.requestedProvider, workspaceRoot: config.workspaceRoot, snapshotId: job.snapshotId,
      documentKind: options.documentKind, theme: job.theme || 'auto', onProgress: progress(job) })],
    ['social-card', ({ job, options }) => runSocialCardPipeline({ gateway, store, batchId: job.batchId,
      candidateId: options.candidateId, provider: job.requestedProvider, workspaceRoot: config.workspaceRoot,
      snapshotId: job.snapshotId, onProgress: progress(job) })],
    ['cover-image', ({ job }) => runCoverImageJob({ gateway, store, batchId: job.batchId, candidateId: job.candidateId,
      provider: job.requestedProvider, workspaceRoot: config.workspaceRoot, theme: job.theme || '', onProgress: progress(job) })],
    ['auto', ({ job, batch, maxAgeHours }) => runAutoPipeline({ gateway, store, config, job, batch, maxAgeHours,
      onProgress: progress(job) })],
  ]);
}
