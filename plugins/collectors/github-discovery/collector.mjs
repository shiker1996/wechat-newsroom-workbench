import { requestGitHubJson } from '../../shared/github-client.mjs';

export function repositoryFromUrl(value){try{const url=new URL(String(value||''));if(url.hostname.toLowerCase()!=='github.com')return null;const [owner,repo]=url.pathname.split('/').filter(Boolean);if(!owner||!repo||['topics','trending','search','marketplace'].includes(owner.toLowerCase()))return null;return {repository:`${owner}/${repo.replace(/\.git$/i,'')}`,url:`https://github.com/${owner}/${repo.replace(/\.git$/i,'')}`};}catch{return null;}}
function mergeRepository(map,item,channel){const parsed=repositoryFromUrl(item.url)||item.repository&&{repository:item.repository,url:`https://github.com/${item.repository}`};if(!parsed)return;const key=parsed.repository.toLowerCase();const current=map.get(key);const channels=[...new Set([...(current?.discoveryChannels||[]),channel,...(item.discoveryChannels||[])])];const priority={trending:4,'ai-search':3,search:2,mentioned:1};const preferred=!current||priority[channel]>priority[current.primaryDiscovery||'mentioned']?item:current;map.set(key,{...current,...preferred,id:`github:${key}`,title:parsed.repository,url:parsed.url,repository:parsed.repository,sourceGroup:'github',discoveryChannels:channels,primaryDiscovery:channels.sort((a,b)=>priority[b]-priority[a])[0]});}

export async function discoverGitHubRepositories(items,config={},onProgress=()=>{},onSourceResult=()=>{}){
  const map=new Map();const others=[];
  for(const item of items){if(item.sourceGroup==='github'){mergeRepository(map,item,item.sourceType||item.primaryDiscovery||'trending');continue;}others.push(item);for(const url of item.githubRepositories||[]){const parsed=repositoryFromUrl(url);if(parsed)mergeRepository(map,{...parsed,sourceType:'mentioned',sourceKey:'github:mentioned',sourceName:'其他热点提及的 GitHub 项目',publishedAt:item.publishedAt,mentionedBy:[{title:item.title,url:item.url,source:item.sourceName}]},'mentioned');}}
  if(config.enabled===false)return [...others,...map.values()];
  if(config.searchEnabled!==false){const createdAfter=new Date(Date.now()-Math.max(1,Number(config.createdWithinDays||30))*86400000).toISOString().slice(0,10);const minStars=Math.max(1,Number(config.minStars||1000));const limit=Math.max(1,Math.min(100,Number(config.limit||30)));const query=`stars:>=${minStars} created:>=${createdAfter} fork:false archived:false`;const startedAt=new Date().toISOString();const started=Date.now();
    try{onProgress(`正在发现最近 ${config.createdWithinDays||30} 天新建且 Star ≥ ${minStars} 的 GitHub 项目`);const result=await requestGitHubJson(`/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${limit}`,{cacheDir:config.cacheDir,ttlMs:Number(config.cacheTtlMs||30*60*1000),fetchImpl:config.fetchImpl||fetch,token:config.token??process.env.GITHUB_ACCESS_TOKEN});const found=(result.items||[]).slice(0,limit);for(const repo of found)mergeRepository(map,{url:repo.html_url,repository:repo.full_name,sourceType:'search',sourceKey:'github:search',sourceName:`GitHub 新项目 · ${createdAfter} 后创建`,publishedAt:startedAt,description:repo.description||'',language:repo.language||'',stars:repo.stargazers_count,topics:repo.topics||[],createdAt:repo.created_at,updatedAt:repo.updated_at,searchQuery:query},'search');onSourceResult({sourceGroup:'github',sourceType:'search',sourceKey:'github:search',sourceName:'GitHub 新项目增长发现',status:'success',itemCount:found.length,durationMs:Date.now()-started,startedAt,endedAt:new Date().toISOString()});}
    catch(error){onProgress(`GitHub Search 增长发现失败，已保留 Trending 与热点提及结果：${error.message}`);onSourceResult({sourceGroup:'github',sourceType:'search',sourceKey:'github:search',sourceName:'GitHub 新项目增长发现',status:'failed',itemCount:0,durationMs:Date.now()-started,error:error.message,startedAt,endedAt:new Date().toISOString()});}}
  // AI 兴趣查询组（job-manager 经 LLM 规划后传入）：逐组独立搜索，单组失败不影响其余；
  // 兴趣相关性过滤在采集编排层（job-manager）统一做，这里只负责搜索与归并。
  // 注意：search/ai-search 的 publishedAt 一律用发现时间而非 repo.created_at——
  // 下游 isFreshForBatch 按批次窗口过滤 published_at，用仓库创建时间会导致整批发现结果被新鲜度过滤吞掉。
  for(const spec of Array.isArray(config.aiQueries)?config.aiQueries:[]){
    const label=String(spec?.label||'兴趣发现').slice(0,40);const keywords=String(spec?.query||'').trim();if(!keywords)continue;
    const days=Math.max(7,Number(spec.createdWithinDays||60));const stars=Math.max(10,Number(spec.minStars||50));const perQuery=Math.max(1,Math.min(50,Number(spec.limit||15)));
    const after=new Date(Date.now()-days*86400000).toISOString().slice(0,10);
    const language=String(spec.language||'').trim();
    const query=`${keywords} stars:>=${stars} created:>=${after} fork:false archived:false${language?` language:${language}`:''}`;
    const sourceKey=`github:ai-search:${label}`;const queryStarted=Date.now();const queryStartedAt=new Date().toISOString();
    try{
      onProgress(`正在按兴趣方向「${label}」搜索 GitHub 项目`);
      const result=await requestGitHubJson(`/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perQuery}`,{cacheDir:config.cacheDir,ttlMs:Number(config.cacheTtlMs||30*60*1000),fetchImpl:config.fetchImpl||fetch,token:config.token??process.env.GITHUB_ACCESS_TOKEN});
      const found=(result.items||[]).slice(0,perQuery);
      for(const repo of found)mergeRepository(map,{url:repo.html_url,repository:repo.full_name,sourceType:'ai-search',sourceKey,sourceName:`AI 兴趣发现 · ${label}`,publishedAt:queryStartedAt,description:repo.description||'',language:repo.language||'',stars:repo.stargazers_count,topics:repo.topics||[],createdAt:repo.created_at,updatedAt:repo.updated_at,searchQuery:query},'ai-search');
      onSourceResult({sourceGroup:'github',sourceType:'ai-search',sourceKey,sourceName:`AI 兴趣发现 · ${label}`,status:'success',itemCount:found.length,durationMs:Date.now()-queryStarted,startedAt:queryStartedAt,endedAt:new Date().toISOString()});
    }catch(error){
      onProgress(`兴趣方向「${label}」搜索失败，已跳过：${error.message}`);
      onSourceResult({sourceGroup:'github',sourceType:'ai-search',sourceKey,sourceName:`AI 兴趣发现 · ${label}`,status:'failed',itemCount:0,durationMs:Date.now()-queryStarted,error:error.message,startedAt:queryStartedAt,endedAt:new Date().toISOString()});
    }
  }
  return [...others,...map.values()].map((item)=>item.sourceGroup==='github'?{...item,sourceType:item.primaryDiscovery,sourceKey:`github:${item.primaryDiscovery}`,sourceName:item.primaryDiscovery==='trending'||item.primaryDiscovery==='ai-search'?item.sourceName:item.primaryDiscovery==='search'?'GitHub 新项目增长发现':'其他热点提及的 GitHub 项目'}:item);
}
