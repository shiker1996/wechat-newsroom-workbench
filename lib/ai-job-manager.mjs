import crypto from 'node:crypto';
import { tagBatch } from './llm/tasks.mjs';
import { runResearchPipeline } from './llm/research-pipeline.mjs';
import { runArticlePipeline } from './llm/article-pipeline.mjs';
import { runTypesetPipeline } from './typeset-pipeline.mjs';

export class AiJobManager {
  constructor(store, gateway, config) {
    this.store = store; this.gateway = gateway; this.config = config; this.jobs = new Map();
  }

  start({ batchId, type, provider, force = false, candidateId = null, mode = 'local' }) {
    if (!this.store.getBatch(batchId)) throw new Error('批次不存在');
    if (!['tag','retag','research','article','typeset'].includes(type)) throw new Error('未知 AI 任务');
    const running = [...this.jobs.values()].find((job) => job.batchId === batchId && job.status === 'running');
    if (running) {
      if (running.type === type && running.candidateId === candidateId && running.mode === mode) return running;
      throw new Error(`当前批次已有 ${running.type} 任务运行，请等待完成后再启动下一步`);
    }
    this.gateway.resolve(provider);
    const job = { id:crypto.randomUUID(),batchId,type,candidateId,mode,provider:provider||this.gateway.config.defaultProvider,
      status:'running',progress:'准备执行',logs:[],createdAt:new Date().toISOString() };
    this.jobs.set(job.id,job); this.store.createAiRun({id:job.id,batchId,type,provider:job.provider});
    this.run(job,{force,candidateId,mode}).catch(()=>{}); return job;
  }

  log(job,message) {
    job.progress=message; job.logs.push({at:new Date().toISOString(),message}); if(job.logs.length>300) job.logs.shift();
    this.store.updateAiRun(job.id,{progress:message});
  }

  async run(job,{force,candidateId,mode}) {
    try {
      let result;
      if (job.type === 'tag' || job.type === 'retag') {
        this.store.updateBatch(job.batchId,{stage:'synthesis',status:'running'});
        result=await tagBatch({gateway:this.gateway,store:this.store,batchId:job.batchId,provider:job.provider,
          force:job.type==='retag'||force,onProgress:(m)=>this.log(job,m)});
        this.store.updateBatch(job.batchId,{stage:'synthesis',status:'review'});
      } else if (job.type === 'research') {
        result=await runResearchPipeline({gateway:this.gateway,store:this.store,batchId:job.batchId,provider:job.provider,
          workspaceRoot:this.config.workspaceRoot,maxAgeHours:this.config.rsshub.maxAgeHours,onProgress:(m)=>this.log(job,m)});
      } else if (job.type === 'article') {
        result=await runArticlePipeline({gateway:this.gateway,store:this.store,batchId:job.batchId,candidateId,
          provider:job.provider,workspaceRoot:this.config.workspaceRoot,onProgress:(m)=>this.log(job,m)});
      } else {
        result=await runTypesetPipeline({gateway:this.gateway,store:this.store,batchId:job.batchId,candidateId,
          provider:job.provider,workspaceRoot:this.config.workspaceRoot,mode,onProgress:(m)=>this.log(job,m)});
      }
      job.result=result; job.status='completed'; job.finishedAt=new Date().toISOString();
      this.store.updateAiRun(job.id,{status:'completed',result_json:JSON.stringify(result),progress:job.progress});
    } catch(error) {
      job.status='failed'; job.error=error.message; job.finishedAt=new Date().toISOString(); this.log(job,`失败：${error.message}`);
      this.store.updateAiRun(job.id,{status:'failed',error:error.message});
    }
  }

  get(id) { return this.jobs.get(id) ?? this.store.getAiRun(id); }
}
