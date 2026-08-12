function withoutLimit(value){return String(value).replace(/([?&])limit=\d+(?:&|$)/i,'$1').replace(/[?&]$/,'');}
function routeKind(route){return /^\/twitter\/user\//i.test(route)?'twitter':/^\/github\/trending\//i.test(route)?'github':'rsshub';}
export function syncLegacyCollectionSources(config,repository){
  const disabled=new Set(config.rsshub.disabledRoutes||[]);const rows=[];
  for(const subreddit of config.reddit?.subreddits||[])rows.push(repository.upsert({pluginId:'reddit-collector',pluginVersion:'1.0.0',sourceType:'reddit',sourceKey:`reddit:r/${subreddit}`,label:`r/${subreddit}`,config:{subreddit,sort:'hot',limit:Number(config.reddit.limitPerSubreddit||15)},enabled:true,origin:'legacy-config'}));
  for(const route of config.rsshub.routes||[]){const kind=routeKind(route),identity=withoutLimit(route);const period=identity.match(/^\/github\/trending\/(daily|weekly|monthly)\//i)?.[1];
    rows.push(repository.upsert({pluginId:'rsshub-collector',pluginVersion:'builtin',sourceType:kind,sourceKey:kind==='github'?`github:trending:${period||'unknown'}`:`${kind}:${identity}`,
      label:kind==='twitter'?`@${decodeURIComponent(identity.match(/^\/twitter\/user\/([^?]+)/i)?.[1]||identity)}`:kind==='github'?`GitHub Trending · ${period||''}`:identity,config:{route},enabled:!disabled.has(route),origin:'legacy-config'}));}
  for(const feed of config.rsshub.directFeeds||[])if(feed?.url)rows.push(repository.upsert({pluginId:'feed-collector',pluginVersion:'builtin',sourceType:'direct',sourceKey:`direct:${feed.url}`,label:feed.label||feed.url,config:{url:feed.url},enabled:feed.enabled!==false,origin:'legacy-config'}));
  if(config.githubDiscovery){const {createdWithinDays=30,minStars=1000,limit=30}=config.githubDiscovery;rows.push(repository.upsert({pluginId:'github-discovery-collector',pluginVersion:'builtin',sourceType:'github',sourceKey:'github:search',label:`GitHub Search · 最近 ${createdWithinDays} 天`,config:{createdWithinDays:Number(createdWithinDays),minStars:Number(minStars),limit:Number(limit)},enabled:config.githubDiscovery.enabled!==false,managed:true,origin:'legacy-config'}));}
  repository.disableMissingLegacy(rows.map((item)=>item.source_key));return rows;
}
