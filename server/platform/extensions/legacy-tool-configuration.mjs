export function legacyToolConfiguration(manifest,config={},environment=process.env){
  switch(manifest.id){
    case 'url-fetch': return {provider:environment.SOURCE_FETCH_PROVIDER||'auto',endpoint:environment.FIRECRAWL_MCP_URL||'https://mcp.firecrawl.dev/v2/mcp',apiKey:environment.FIRECRAWL_API_KEY||'',githubToken:environment.GITHUB_TOKEN||environment.GITHUB_ACCESS_TOKEN||'',...(config.sourceFetch||{})};
    case 'tavily-search': return {apiKey:environment.TAVILY_API_KEY||'',enabled:config.tavily?.enabled!==false,maxResults:Number(config.tavily?.maxResults||5)};
    case 'upyun-image-upload': return {bucket:environment.UPYUN_BUCKET||'',operator:environment.UPYUN_OPERATOR||'',password:environment.UPYUN_PASSWORD||'',domain:environment.UPYUN_DOMAIN||'img.shiker.tech',prefix:environment.UPYUN_PREFIX||'weedit'};
    case 'document-folder-search': return {roots:Array.isArray(config.documentSearch?.roots)?config.documentSearch.roots:[],maxResults:5};
    default:return {};
  }
}
