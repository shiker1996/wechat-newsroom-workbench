import crypto from 'node:crypto';
import { collectReddit } from '../collectors/reddit.mjs';
import { collectRssHub } from '../collectors/rsshub.mjs';

export class JobManager {
  constructor(store, config) {
    this.store = store;
    this.config = config;
    this.jobs = new Map();
  }

  startCollection(batchId, sources) {
    if (!this.store.getBatch(batchId)) throw new Error('批次不存在');
    const running = [...this.jobs.values()].find((job) => job.batchId === batchId && job.status === 'running');
    if (running) return running;
    const job = {
      id: crypto.randomUUID(), batchId, type: 'collect', sources,
      status: 'running', progress: '准备采集', logs: [], createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    this.runCollection(job).catch(() => {});
    return job;
  }

  log(job, message) {
    job.progress = message;
    job.logs.push({ at: new Date().toISOString(), message });
    if (job.logs.length > 200) job.logs.shift();
  }

  async runCollection(job) {
    const collectors = {
      reddit: () => collectReddit(this.config.reddit, (message) => this.log(job, message),
        (result)=>this.store.recordSubscriptionRun(job.batchId,result)),
      rsshub: () => collectRssHub(this.config.rsshub, (message) => this.log(job, message),
        (result)=>this.store.recordSubscriptionRun(job.batchId,result)),
    };
    this.store.updateBatch(job.batchId, { status: 'running', stage: 'collect' });
    const results=await Promise.all(job.sources.map(async(source)=>{
      if (!collectors[source]) return false;
      const sourceRunId = this.store.startSourceRun(job.batchId, source);
      this.log(job, `开始采集 ${source}`);
      try {
        const items = await collectors[source]();
        this.store.addHotspots(job.batchId, source, items);
        this.store.finishSourceRun(sourceRunId, 'success', items.length);
        this.log(job, `${source} 完成，共 ${items.length} 条`);
        return true;
      } catch (error) {
        this.store.finishSourceRun(sourceRunId, 'failed', 0, error.message);
        this.log(job, `${source} 失败：${error.message}`);
        return false;
      }
    }));
    const successes=results.filter(Boolean).length;
    job.status = successes ? 'completed' : 'failed';
    job.finishedAt = new Date().toISOString();
    this.store.updateBatch(job.batchId, {
      status: successes ? 'review' : 'blocked',
      stage: successes ? 'synthesis' : 'collect',
    });
  }

  get(id) { return this.jobs.get(id) ?? null; }
}
