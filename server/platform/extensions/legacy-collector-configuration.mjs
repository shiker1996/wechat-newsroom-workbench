export function legacyCollectorConfiguration(manifest,config={},environment=process.env){
  switch(manifest.id){
    case 'reddit-collector':return {cdpUrl:config.reddit?.cdpUrl||'http://localhost:9333',navigationTimeoutMs:Number(config.reddit?.navigationTimeoutMs||30000)};
    case 'rsshub-collector':return {baseUrl:config.rsshub?.baseUrl||'http://127.0.0.1:1200',rootDir:config.rsshub?.rootDir||'RSSHub',startScript:config.rsshub?.startScript||'',stopScript:config.rsshub?.stopScript||'',pidFile:config.rsshub?.pidFile||'',startupTimeoutMs:Number(config.rsshub?.startupTimeoutMs||180000),keepAlive:config.rsshub?.keepAlive!==false,maxAgeHours:Number(config.rsshub?.maxAgeHours||168),allowUndated:config.rsshub?.allowUndated!==false,concurrency:Number(config.rsshub?.concurrency||5)};
    case 'github-discovery-collector':{const value=config.githubDiscovery||{},ai=value.aiQueries||{};const {aiQueries:_legacyAiQueries,...flat}=value;return {...flat,token:environment.GITHUB_TOKEN||environment.GITHUB_ACCESS_TOKEN||'',aiQueriesEnabled:ai.enabled!==false,refreshDays:Number(ai.refreshDays||7),maxQueries:Number(ai.maxQueries||6),perQueryLimit:Number(ai.perQueryLimit||15),relevanceFilter:ai.relevanceFilter!==false,minInterestScore:Number(ai.minInterestScore||6)};}
    default:return {};
  }
}
