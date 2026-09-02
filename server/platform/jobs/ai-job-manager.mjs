import crypto from 'node:crypto';
import { runWithThinkingSink } from '../llm/gateway.mjs';

export class AiJobManager {
  constructor(store, gateway, config, { handlers = new Map(), batchLevelTypes = new Set(), onFailure = null } = {}) {
    this.store = store; this.gateway = gateway; this.config = config; this.jobs = new Map();
    this.pending = [];                 // 等待执行的任务 id（FIFO）
    this.running = new Map();          // 互斥键 -> 运行中任务 id
    this.activeCount = 0;
    this.maxConcurrent = Math.max(1, Number(config?.aiJobs?.maxConcurrent ?? 2));
    this.handlers = handlers;
    this.batchLevelTypes = batchLevelTypes;
    this.onFailure = onFailure;
  }

  // 互斥键：批次级任务按批次互斥，候选级任务按候选互斥，二者互不阻塞。
  conflictKey(job) {
    return this.batchLevelTypes.has(job.type) ? `batch:${job.batchId}` : `candidate:${job.candidateId ?? 'none'}`;
  }

  start({ batchId, type, provider, force = false, candidateId = null, documentKind = null, theme = undefined, mode = 'standard', focus = null, focuses = [], snapshotId = null, skillSelection = null, stageSelections = null, styleBrief = '', failureId = null }) {
    if (!this.store.getBatch(batchId)) throw new Error('批次不存在');
    if (!this.handlers.has(type)) throw new Error('未知 AI 任务');
    const pending = [...this.jobs.values()].find((job) => job.batchId === batchId && job.type === type
      && job.candidateId === candidateId && job.failureId === failureId && (job.status === 'running' || job.status === 'queued'));
    if (pending) return pending;
    this.gateway.resolve(provider);
    const job = { id:crypto.randomUUID(),batchId,type,candidateId,failureId,provider:provider||this.gateway.config.defaultProvider,requestedProvider:provider||null,snapshotId,skillSelection,stageSelections,
      theme,mode,status:'queued',progress:'排队等待执行',logs:[],createdAt:new Date().toISOString(),
      runOptions:{ force, candidateId, documentKind, ...(failureId != null ? { failureId } : {}), ...(mode !== 'standard' ? { mode } : {}), focus, focuses, ...(String(styleBrief||'').trim()?{styleBrief:String(styleBrief).trim()}:{}) } };
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
      // run() 当前会把业务异常落为 failed，但调度器仍必须兜住任何越过
      // run() 边界的拒绝（例如 onFailure、日志或收尾存储异常）。否则被忽略的
      // finally Promise 可能变成 unhandled rejection，Node 进程会直接退出。
      this.run(job, job.runOptions || {})
        .catch((error) => this.recordUnexpectedFailure(job, error))
        .finally(() => {
          this.running.delete(this.conflictKey(job));
          this.activeCount = Math.max(0, this.activeCount - 1);
          this.pruneTerminalJobs();
          try { this.tick(); } catch {}
        })
        .catch(() => {});
    }
  }

  recordUnexpectedFailure(job, error) {
    const message = error?.message || String(error || 'AI 任务异常退出');
    job.status = 'failed';
    job.error = message;
    job.finishedAt = new Date().toISOString();
    try {
      this.store.updateAiRun(job.id, { status: 'failed', error: message, progress: `失败：${message}` });
    } catch {}
  }

  pruneTerminalJobs(limit = 100) {
    const terminal=[...this.jobs.values()].filter((job)=>['completed','failed','interrupted'].includes(job.status));
    for(const job of terminal.slice(0,Math.max(0,terminal.length-limit)))this.jobs.delete(job.id);
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

  async run(job, options = {}) {
    await runWithThinkingSink((delta)=>this.recordThinking(job,delta), async () => {
    try {
      const batch=this.store.getBatch(job.batchId);
      const maxAgeHours=Number(batch?.max_age_hours)||this.config.rsshub.maxAgeHours;
      const handler = this.handlers.get(job.type);
      if (!handler) throw new Error('未知 AI 任务');
      const result = await handler({ job, batch, maxAgeHours, options });
      job.result=result; job.status='completed'; job.finishedAt=new Date().toISOString();
      this.store.updateAiRun(job.id,{status:'completed',result_json:JSON.stringify(result),progress:job.progress});
    } catch(error) {
      if (this.onFailure) this.onFailure({ job, error });
      job.status='failed'; job.error=error.message; job.finishedAt=new Date().toISOString(); this.log(job,`失败：${error.message}`);
      this.store.updateAiRun(job.id,{status:'failed',error:error.message});
    }
    });
  }

  get(id) { return this.jobs.get(id) ?? this.store.getAiRun(id); }
}
