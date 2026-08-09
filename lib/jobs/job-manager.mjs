import crypto from 'node:crypto';
import { collectReddit } from '../../collectors/reddit.mjs';
import { collectRssHub } from '../../collectors/rsshub.mjs';
import path from 'node:path';
import { planRepoDiscoveryQueries, filterRepositoriesByInterest } from '../llm/repo-discovery.mjs';
import { getAccountContext } from '../domain/account-context.mjs';
import { filterCollectedItems } from '../domain/collection-quality.mjs';

export class JobManager {
  // modelsResolver：可选的 LLM 网关惰性取值（server.mjs 先建 JobManager 后建 ModelGateway），
  // 仅用于 AI 兴趣仓库发现；未提供或失败时自动退化为纯规则发现（Trending + 增长搜索 + 提及）。
  constructor(store, config, modelsResolver = null) {
    this.store = store;
    this.config = config;
    this.modelsResolver = modelsResolver;
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
      try{const items=await collectReddit(this.config.reddit,(message)=>this.log(job,message),(result)=>this.store.recordSubscriptionRun(job.batchId,result));const quality=filterCollectedItems(items);this.store.addHotspots(job.batchId,source,quality.kept);this.store.finishSourceRun(runId,'success',quality.kept.length);this.log(job,`${source} 完成，保留 ${quality.kept.length} 条${quality.dropped.length?`，过滤空内容 ${quality.dropped.length} 条`:''}`);return true;}
      catch(error){this.store.finishSourceRun(runId,'failed',0,error.message);this.log(job,`${source} 失败：${error.message}`);return false;}
    })());
    const feedSources=job.sources.filter((source)=>source==='rsshub'||source==='github');
    if(feedSources.length)tasks.push((async()=>{
      const runIds=new Map(feedSources.map((source)=>[source,this.store.startSourceRun(job.batchId,source)]));
      this.log(job,`开始采集 ${feedSources.join(' + ')}`);
      try{
        const scope=feedSources.length===2?'all':feedSources[0];
        // AI 兴趣仓库发现：LLM 规划查询组（带缓存），随 github 采集一并搜索；随后按账号兴趣过滤
        const aiCfg=this.config.githubDiscovery?.aiQueries||{};
        const gateway=typeof this.modelsResolver==='function'?this.modelsResolver():null;
        let aiQueryList=[];
        if(feedSources.includes('github')&&aiCfg.enabled!==false&&gateway){
          const planned=await planRepoDiscoveryQueries({
            workspaceRoot:this.config.workspaceRoot,gateway,accountContext:getAccountContext(),
            refreshDays:Number(aiCfg.refreshDays||7),maxQueries:Number(aiCfg.maxQueries||6),
            log:(message)=>this.log(job,message),
          });
          aiQueryList=planned.queries||[];
        }
        const items=await collectRssHub({...this.config.rsshub,maxAgeHours:job.maxAgeHours||this.config.rsshub.maxAgeHours,collectionScope:scope,githubDiscovery:{...this.config.githubDiscovery,aiQueries:aiQueryList.map((q)=>({...q,limit:Number(aiCfg.perQueryLimit||15)})),cacheDir:path.join(this.config.workspaceRoot,'data','github-cache')}},(message)=>this.log(job,message),(result)=>this.store.recordSubscriptionRun(job.batchId,result));
        const quality=filterCollectedItems(items);
        if(quality.dropped.length)this.log(job,`采集质量过滤：丢弃 ${quality.dropped.length} 条标题和正文均为空的记录`);
        let filtered=quality.kept;
        if(aiQueryList.length&&aiCfg.relevanceFilter!==false&&gateway){
          const aiRepos=items.filter((item)=>item.sourceGroup==='github'&&(item.discoveryChannels||[]).includes('ai-search'));
          if(aiRepos.length){
            const kept=await filterRepositoriesByInterest({
              gateway,accountContext:getAccountContext(),repos:aiRepos,
              threshold:Number(aiCfg.minInterestScore||6),log:(message)=>this.log(job,message),
            });
            // kept 项带 interestScore/interestReason：按仓库名回贴到归并结果上，分数随 raw_json 入库
            const keptMap=new Map(kept.map((item)=>[String(item.repository||'').toLowerCase(),item]));
            filtered=items.map((item)=>{
              if(item.sourceGroup!=='github'||!(item.discoveryChannels||[]).includes('ai-search'))return item;
              const keptItem=keptMap.get(String(item.repository||'').toLowerCase());
              if(keptItem)return keptItem;
              // 同时被其他通道（trending/search/mentioned）发现的仓库不因兴趣过滤而丢失，仅降回规则通道
              const rest=(item.discoveryChannels||[]).filter((c)=>c!=='ai-search');
              if(!rest.length)return null;
              return {...item,discoveryChannels:rest,sourceType:rest[0],primaryDiscovery:rest[0],sourceName:rest[0]==='trending'?item.sourceName:rest[0]==='search'?'GitHub 新项目增长发现':'其他热点提及的 GitHub 项目',interestScore:undefined,interestReason:undefined};
            }).filter(Boolean);
          }
        }
        for(const source of feedSources){const selected=filtered.filter((item)=>(item.sourceGroup==='github'?'github':'rsshub')===source);this.store.addHotspots(job.batchId,source,selected);this.store.finishSourceRun(runIds.get(source),'success',selected.length);this.log(job,`${source} 完成，共 ${selected.length} 条`);}
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
