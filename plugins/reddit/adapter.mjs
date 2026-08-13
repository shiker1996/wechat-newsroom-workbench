import { collectReddit, checkReddit } from './collector.mjs';
import { ensureRedditBrowser, releaseRedditBrowser, redditBrowserOptions } from './browser-lifecycle.mjs';
import { ok } from './result.mjs';

export function createAdapter({config,onProgress=()=>{},configuration={},pageDependencies={}}={}){
  const reddit={...config.reddit,...configuration,workspaceRoot:config.workspaceRoot};
  const withBrowser=async(operation)=>{
    const session=await ensureRedditBrowser(reddit,pageDependencies);
    try{return await operation({...reddit,cdpUrl:session.cdpUrl});}
    finally{await releaseRedditBrowser(session,{...pageDependencies,closeDelayMs:reddit.closeDelayMs});}
  };
  return {
    health:async()=>{
      const options=redditBrowserOptions(reddit),result=await checkReddit({...reddit,cdpUrl:options.cdpUrl});
      if(result.ok)return {status:'ok',data:{available:true,...result,lifecycle:options.mode||'external'}};
      return options.managed
        ? {status:'ok',data:{available:true,browserRunning:false,lifecycle:options.mode,action:'采集时将自动启动专用 Chrome'}}
        : {status:'error',error:{code:'DEPENDENCY_MISSING',message:result.error,retryable:false}};
    },
    collect:async(source)=>withBrowser(async(runtime)=>ok(await collectReddit({...runtime,subreddits:[source.subreddit],limitPerSubreddit:source.limit||15},onProgress),{fetchMethod:'browser-cdp'})),
    test:async(source)=>withBrowser(async(runtime)=>{const items=await collectReddit({...runtime,subreddits:[source.subreddit],limitPerSubreddit:Math.min(5,source.limit||5)},onProgress);return {ok:true,title:`r/${source.subreddit}`,itemCount:items.length,items:items.slice(0,5).map(({title,url})=>({title,url}))};}),
    collectMany:async(sources)=>withBrowser(async(runtime)=>{const subreddits=sources.map((source)=>source.config.subreddit),limits=new Map(sources.map((source)=>[source.config.subreddit,source.config.limit||15])),statuses=new Map();const items=await collectReddit({...runtime,subreddits,limitPerSubreddit:Math.max(...limits.values())},onProgress,(result)=>statuses.set(result.sourceKey,result));return sources.map((source)=>{const status=statuses.get(source.source_key),selected=items.filter((item)=>item.subreddit===source.config.subreddit).slice(0,limits.get(source.config.subreddit));return status?.status==='failed'?{sourceId:source.id,result:{status:'error',error:{code:'NETWORK_ERROR',message:status.error||'Reddit 来源失败',retryable:true}}}:{sourceId:source.id,result:ok(selected,{fetchMethod:'browser-cdp'})};});}),
  };
}
