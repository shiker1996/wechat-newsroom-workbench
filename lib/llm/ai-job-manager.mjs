import crypto from 'node:crypto';
import { tagBatch } from './tasks.mjs';
import { runResearchPipeline, ensureBatchEventCards } from './research-pipeline.mjs';
import { runArticlePipeline } from './article-pipeline.mjs';
import { runTypesetPipeline } from './typeset-pipeline.mjs';
import { runSocialCardPipeline } from './social-card-pipeline.mjs';
import { runBreakingAnalysisPipeline } from './breaking-analysis-pipeline.mjs';
import { runDailyPipeline } from './daily-pipeline.mjs';
import { runTutorialPipeline } from './tutorial-pipeline.mjs';
import { runWithThinkingSink } from './gateway.mjs';

// 批次级任务改写整批热点 / 事件卡 / 批次状态，同批次内必须互斥；
// 候选级任务只写各自候选的工作目录与轨道状态，可按候选并行。
const BATCH_LEVEL_TYPES = new Set(['tag', 'retag', 'event-cards', 'research', 'breaking-analysis', 'auto', 'daily']);

export class AiJobManager {
  constructor(store, gateway, config) {
    this.store = store; this.gateway = gateway; this.config = config; this.jobs = new Map();
    this.pending = [];                 // 等待执行的任务 id（FIFO）
    this.running = new Map();          // 互斥键 -> 运行中任务 id
    this.activeCount = 0;
    this.maxConcurrent = Math.max(1, Number(config?.aiJobs?.maxConcurrent ?? 2));
  }

  // 互斥键：批次级任务按批次互斥，候选级任务按候选互斥，二者互不阻塞。
  conflictKey(job) {
    return BATCH_LEVEL_TYPES.has(job.type) ? `batch:${job.batchId}` : `candidate:${job.candidateId ?? 'none'}`;
  }

  start({ batchId, type, provider, force = false, candidateId = null, documentKind = null, theme = undefined, focus = null, focuses = [], snapshotId = null, skillSelection = null, stageSelections = null }) {
    if (!this.store.getBatch(batchId)) throw new Error('批次不存在');
    if (!['tag','retag','event-cards','research','breaking-analysis','article','daily','tutorial','typeset','social-card','auto'].includes(type)) throw new Error('未知 AI 任务');
    const pending = [...this.jobs.values()].find((job) => job.batchId === batchId && job.type === type
      && job.candidateId === candidateId && (job.status === 'running' || job.status === 'queued'));
    if (pending) return pending;
    this.gateway.resolve(provider);
    const job = { id:crypto.randomUUID(),batchId,type,candidateId,provider:provider||this.gateway.config.defaultProvider,requestedProvider:provider||null,snapshotId,skillSelection,stageSelections,
      theme,status:'queued',progress:'排队等待执行',logs:[],createdAt:new Date().toISOString() };
    this.jobs.set(job.id,job); this.store.createAiRun({id:job.id,batchId,type,provider:job.provider});
    this.store.updateAiRun(job.id,{status:'queued',progress:'排队等待执行'});
    if(type==='daily'&&Array.isArray(focuses)&&focuses.length)this.store.updateAiRun(job.id,{result_json:JSON.stringify({focuses})});
    this.pending.push(job.id);
    this.tick();
    return job;
  }

  // 从等待队列调度任务：互斥键不冲突且在并发上限内即可启动。
  tick() {
    while (this.activeCount < this.maxConcurrent) {
      const index = this.pending.findIndex((id) => {
        const job = this.jobs.get(id);
        if (!job || job.status !== 'queued') return false;
        return !this.running.has(this.conflictKey(job));
      });
      if (index === -1) break;
      const job = this.jobs.get(this.pending.splice(index, 1)[0]);
      this.running.set(this.conflictKey(job), job.id);
      this.activeCount += 1;
      job.status = 'running'; job.progress = '准备执行';
      this.store.updateAiRun(job.id, { status: 'running', progress: '准备执行' });
      this.run(job, {}).finally(() => {
        this.running.delete(this.conflictKey(job));
        this.activeCount = Math.max(0, this.activeCount - 1);
        this.tick();
      });
    }
  }

  log(job,message) {
    this.flushThinking(job);
    job.progress=message; job.logs.push({at:new Date().toISOString(),message}); if(job.logs.length>300) job.logs.shift();
    this.store.updateAiRun(job.id,{progress:message});
  }

  // thinking 实时进度：gateway 通过 runWithThinkingSink 把 reasoning 增量喂进来，
  // 节流合并成「思考：…」日志行并原地更新，避免刷屏；普通 onProgress 日志先冲刷遗留缓冲。
  flushThinking(job) {
    if(!job.thinkingBuffer)return;
    const line='思考：'+(job.thinkingBuffer.length>500?`${job.thinkingBuffer.slice(0,500)}…`:job.thinkingBuffer);
    job.thinkingBuffer='';
    const last=job.logs[job.logs.length-1];
    if(last&&last.thinking){last.message=line;last.at=new Date().toISOString();}
    else{job.logs.push({at:new Date().toISOString(),message:line,thinking:true});if(job.logs.length>300)job.logs.shift();}
    job.progress=line;
    try{this.store.updateAiRun(job.id,{progress:line});}catch{}
  }

  recordThinking(job,delta) {
    const text=String(delta||'');if(!text)return;
    job.thinkingBuffer=(job.thinkingBuffer||'')+text;
    const now=Date.now();
    if((job.thinkingFlushAt??0)&&now-job.thinkingFlushAt<600&&job.thinkingBuffer.length<120)return;
    job.thinkingFlushAt=now;
    this.flushThinking(job);
  }

  async run(job,{force,candidateId,documentKind,focus,focuses}) {
    await runWithThinkingSink((delta)=>this.recordThinking(job,delta), async () => {
    try {
      const batch=this.store.getBatch(job.batchId);
      const maxAgeHours=Number(batch?.max_age_hours)||this.config.rsshub.maxAgeHours;
      let result;
      if (job.type === 'tag' || job.type === 'retag') {
        this.store.updateBatch(job.batchId,{stage:'synthesis',status:'running'});
        result=await tagBatch({gateway:this.gateway,store:this.store,batchId:job.batchId,provider:job.provider,
          force:job.type==='retag'||force,maxAgeHours,workspaceRoot:this.config.workspaceRoot,onProgress:(m)=>this.log(job,m)});
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
          provider:job.requestedProvider,workspaceRoot:this.config.workspaceRoot,snapshotId:job.snapshotId,skillSelection:job.skillSelection,stageSelections:job.stageSelections,onProgress:(m)=>this.log(job,m)});
      } else if (job.type === 'daily') {
        result=await runDailyPipeline({gateway:this.gateway,store:this.store,batchId:job.batchId,provider:job.requestedProvider,
          workspaceRoot:this.config.workspaceRoot,snapshotId:job.snapshotId,stageSelections:job.stageSelections,focus,focuses,onProgress:(m)=>this.log(job,m)});
      } else if (job.type === 'tutorial') {
        result=await runTutorialPipeline({gateway:this.gateway,store:this.store,batchId:job.batchId,candidateId,
          provider:job.requestedProvider,workspaceRoot:this.config.workspaceRoot,snapshotId:job.snapshotId,skillSelection:job.skillSelection,stageSelections:job.stageSelections,onProgress:(m)=>this.log(job,m)});
      } else if (job.type === 'typeset') {
        result=await runTypesetPipeline({gateway:this.gateway,store:this.store,batchId:job.batchId,candidateId,
          provider:job.requestedProvider,workspaceRoot:this.config.workspaceRoot,snapshotId:job.snapshotId,documentKind,theme:job.theme||'auto',onProgress:(m)=>this.log(job,m)});
      } else if (job.type === 'auto') {
        // 一键自动化：采集后串联 打标 → 事件卡 → 事件研判；突发批次走事实基座分析
        if (batch?.batch_type === 'breaking') {
          result=await runBreakingAnalysisPipeline({gateway:this.gateway,store:this.store,batchId:job.batchId,provider:job.provider,
            workspaceRoot:this.config.workspaceRoot,onProgress:(m)=>this.log(job,m)});
        } else {
          this.store.updateBatch(job.batchId,{stage:'synthesis',status:'running'});
          job.phase='tag';
          result=await tagBatch({gateway:this.gateway,store:this.store,batchId:job.batchId,provider:job.provider,
            force:false,maxAgeHours,workspaceRoot:this.config.workspaceRoot,onProgress:(m)=>this.log(job,m)});
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
          provider:job.requestedProvider,workspaceRoot:this.config.workspaceRoot,snapshotId:job.snapshotId,onProgress:(m)=>this.log(job,m)});
      }
      job.result=result; job.status='completed'; job.finishedAt=new Date().toISOString();
      this.store.updateAiRun(job.id,{status:'completed',result_json:JSON.stringify(result),progress:job.progress});
    } catch(error) {
      job.status='failed'; job.error=error.message; job.finishedAt=new Date().toISOString(); this.log(job,`失败：${error.message}`);
      this.store.updateAiRun(job.id,{status:'failed',error:error.message});
    }
    });
  }

  get(id) { return this.jobs.get(id) ?? this.store.getAiRun(id); }
}
