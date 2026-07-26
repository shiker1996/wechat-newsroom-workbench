import crypto from 'node:crypto';
import { collectReddit } from '../../collectors/reddit.mjs';
import { collectRssHub } from '../../collectors/rsshub.mjs';
import path from 'node:path';

export class JobManager {
  constructor(store, config) {
    this.store = store;
    this.config = config;
    this.jobs = new Map();
  }

  startCollection(batchId, sources, maxAgeHours = null) {
    if (!this.store.getBatch(batchId)) throw new Error('批次不存在');
    const running = [...this.jobs.values()].find((job) => job.batchId === batchId && job.status === 'running');
    if (running) return running;
    const job = {
      id: crypto.randomUUID(), batchId, type: 'collect', sources, maxAgeHours,
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
    this.store.updateBatch(job.batchId, { status: 'running', stage: 'collect' });
    const tasks=[];
    if(job.sources.includes('reddit'))tasks.push((async()=>{
      const source='reddit';const runId=this.store.startSourceRun(job.batchId,source);this.log(job,`开始采集 ${source}`);
      try{const items=await collectReddit(this.config.reddit,(message)=>this.log(job,message),(result)=>this.store.recordSubscriptionRun(job.batchId,result));this.store.addHotspots(job.batchId,source,items);this.store.finishSourceRun(runId,'success',items.length);this.log(job,`${source} 完成，共 ${items.length} 条`);return true;}
      catch(error){this.store.finishSourceRun(runId,'failed',0,error.message);this.log(job,`${source} 失败：${error.message}`);return false;}
    })());
    const feedSources=job.sources.filter((source)=>source==='rsshub'||source==='github');
    if(feedSources.length)tasks.push((async()=>{
      const runIds=new Map(feedSources.map((source)=>[source,this.store.startSourceRun(job.batchId,source)]));
      this.log(job,`开始采集 ${feedSources.join(' + ')}`);
      try{
        const scope=feedSources.length===2?'all':feedSources[0];
        const items=await collectRssHub({...this.config.rsshub,maxAgeHours:job.maxAgeHours||this.config.rsshub.maxAgeHours,collectionScope:scope,githubDiscovery:{...this.config.githubDiscovery,cacheDir:path.join(this.config.workspaceRoot,'data','github-cache')}},(message)=>this.log(job,message),(result)=>this.store.recordSubscriptionRun(job.batchId,result));
        for(const source of feedSources){const selected=items.filter((item)=>(item.sourceGroup==='github'?'github':'rsshub')===source);this.store.addHotspots(job.batchId,source,selected);this.store.finishSourceRun(runIds.get(source),'success',selected.length);this.log(job,`${source} 完成，共 ${selected.length} 条`);}
        return true;
      }catch(error){for(const source of feedSources)this.store.finishSourceRun(runIds.get(source),'failed',0,error.message);this.log(job,`${feedSources.join(' + ')} 失败：${error.message}`);return false;}
    })());
    const results=await Promise.all(tasks);
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
