import crypto from 'node:crypto';
import { tagBatch } from './tasks.mjs';
import { runResearchPipeline, ensureBatchEventCards } from './research-pipeline.mjs';
import { runArticlePipeline } from './article-pipeline.mjs';
import { runTypesetPipeline } from './typeset-pipeline.mjs';
import { runSocialCardPipeline } from './social-card-pipeline.mjs';
import { runBreakingAnalysisPipeline } from './breaking-analysis-pipeline.mjs';
import { runDailyPipeline } from './daily-pipeline.mjs';
import { runTutorialPipeline } from './tutorial-pipeline.mjs';

export class AiJobManager {
  constructor(store, gateway, config) {
    this.store = store; this.gateway = gateway; this.config = config; this.jobs = new Map();
  }

  start({ batchId, type, provider, force = false, candidateId = null, documentKind = null, theme = undefined, focus = null, focuses = [] }) {
    if (!this.store.getBatch(batchId)) throw new Error('批次不存在');
    if (!['tag','retag','event-cards','research','breaking-analysis','article','daily','tutorial','typeset','social-card','auto'].includes(type)) throw new Error('未知 AI 任务');
    const running = [...this.jobs.values()].find((job) => job.batchId === batchId && job.status === 'running');
    if (running) {
      if (running.type === type && running.candidateId === candidateId) return running;
      throw new Error(`当前批次已有 ${running.type} 任务运行，请等待完成后再启动下一步`);
    }
    this.gateway.resolve(provider);
    const job = { id:crypto.randomUUID(),batchId,type,candidateId,provider:provider||this.gateway.config.defaultProvider,
      theme,status:'running',progress:'准备执行',logs:[],createdAt:new Date().toISOString() };
    this.jobs.set(job.id,job); this.store.createAiRun({id:job.id,batchId,type,provider:job.provider});
    this.run(job,{force,candidateId,documentKind,focus,focuses}).catch(()=>{}); return job;
  }

  log(job,message) {
    job.progress=message; job.logs.push({at:new Date().toISOString(),message}); if(job.logs.length>300) job.logs.shift();
    this.store.updateAiRun(job.id,{progress:message});
  }

  async run(job,{force,candidateId,documentKind,focus,focuses}) {
    try {
      const batch=this.store.getBatch(job.batchId);
      const maxAgeHours=Number(batch?.max_age_hours)||this.config.rsshub.maxAgeHours;
      let result;
      if (job.type === 'tag' || job.type === 'retag') {
        this.store.updateBatch(job.batchId,{stage:'synthesis',status:'running'});
        result=await tagBatch({gateway:this.gateway,store:this.store,batchId:job.batchId,provider:job.provider,
          force:job.type==='retag'||force,maxAgeHours,onProgress:(m)=>this.log(job,m)});
        this.store.updateBatch(job.batchId,{stage:'synthesis',status:'review'});
      } else if (job.type === 'event-cards') {
        // 事件卡是独立环节：打标后手动或自动触发；force 时整体重建
        this.store.updateBatch(job.batchId,{stage:'synthesis',status:'running'});
        result=await ensureBatchEventCards({gateway:this.gateway,store:this.store,batchId:job.batchId,provider:job.provider,
          workspaceRoot:this.config.workspaceRoot,maxAgeHours,regenerate:Boolean(force),
          onProgress:(m)=>this.log(job,m)});
        this.store.updateBatch(job.batchId,{stage:'synthesis',status:'review'});
      } else if (job.type === 'research') {
        result=await runResearchPipeline({gateway:this.gateway,store:this.store,batchId:job.batchId,provider:job.provider,
          workspaceRoot:this.config.workspaceRoot,maxAgeHours,onProgress:(m)=>this.log(job,m)});
      } else if (job.type === 'breaking-analysis') {
        result=await runBreakingAnalysisPipeline({gateway:this.gateway,store:this.store,batchId:job.batchId,provider:job.provider,
          workspaceRoot:this.config.workspaceRoot,onProgress:(m)=>this.log(job,m)});
      } else if (job.type === 'article') {
        result=await runArticlePipeline({gateway:this.gateway,store:this.store,batchId:job.batchId,candidateId,
          provider:job.provider,workspaceRoot:this.config.workspaceRoot,onProgress:(m)=>this.log(job,m)});
      } else if (job.type === 'daily') {
        result=await runDailyPipeline({gateway:this.gateway,store:this.store,batchId:job.batchId,provider:job.provider,
          workspaceRoot:this.config.workspaceRoot,focus,focuses,onProgress:(m)=>this.log(job,m)});
      } else if (job.type === 'tutorial') {
        result=await runTutorialPipeline({gateway:this.gateway,store:this.store,batchId:job.batchId,candidateId,
          provider:job.provider,workspaceRoot:this.config.workspaceRoot,onProgress:(m)=>this.log(job,m)});
      } else if (job.type === 'typeset') {
        result=await runTypesetPipeline({gateway:this.gateway,store:this.store,batchId:job.batchId,candidateId,
          provider:job.provider,workspaceRoot:this.config.workspaceRoot,documentKind,theme:job.theme||'auto',onProgress:(m)=>this.log(job,m)});
      } else if (job.type === 'auto') {
        // 一键自动化：采集后串联 打标 → 事件卡 → 事件研判；突发批次走事实基座分析
        if (batch?.batch_type === 'breaking') {
          result=await runBreakingAnalysisPipeline({gateway:this.gateway,store:this.store,batchId:job.batchId,provider:job.provider,
            workspaceRoot:this.config.workspaceRoot,onProgress:(m)=>this.log(job,m)});
        } else {
          this.store.updateBatch(job.batchId,{stage:'synthesis',status:'running'});
          job.phase='tag';
          result=await tagBatch({gateway:this.gateway,store:this.store,batchId:job.batchId,provider:job.provider,
            force:false,maxAgeHours,onProgress:(m)=>this.log(job,m)});
          try {
            job.phase='event-cards';
            const cardResult=await ensureBatchEventCards({gateway:this.gateway,store:this.store,batchId:job.batchId,provider:job.provider,
              workspaceRoot:this.config.workspaceRoot,maxAgeHours,onProgress:(m)=>this.log(job,m)});
            result={...result,eventCards:{total:cardResult.total,generated:cardResult.generated,cached:cardResult.cached,failed:cardResult.failed.length}};
          } catch(error) { this.log(job,`事件卡生成失败（不阻塞自动流程）：${error.message}`); }
          this.store.updateBatch(job.batchId,{stage:'synthesis',status:'review'});
          job.phase='research';
          const research=await runResearchPipeline({gateway:this.gateway,store:this.store,batchId:job.batchId,provider:job.provider,
            workspaceRoot:this.config.workspaceRoot,maxAgeHours,onProgress:(m)=>this.log(job,m)});
          result={...result,research};
        }
      } else {
        result=await runSocialCardPipeline({gateway:this.gateway,store:this.store,batchId:job.batchId,candidateId,
          provider:job.provider,workspaceRoot:this.config.workspaceRoot,onProgress:(m)=>this.log(job,m)});
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
