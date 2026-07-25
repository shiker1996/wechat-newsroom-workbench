import fs from 'node:fs';
import path from 'node:path';

const defaults = {
  port: 4317,
  workspaceRoot: '.',
  contentRoots: [],
  reddit: {
    cdpUrl: 'http://127.0.0.1:9222',
    subreddits: ['technology', 'programming', 'artificial', 'sysadmin'],
    limitPerSubreddit: 15,
    navigationTimeoutMs: 30000,
  },
  rsshub: {
    baseUrl: 'http://127.0.0.1:1200',
    rootDir: 'RSSHub',
    startScript: 'scripts/rsshub-start.ps1',
    stopScript: 'scripts/rsshub-stop.ps1',
    pidFile: 'data/rsshub.pid',
    startupTimeoutMs: 180000,
    keepAlive: true,
    maxAgeHours: 168,
    allowUndated: true,
    concurrency: 5,
    disabledRoutes: [],
    directFeeds: [],
    routes: [
      '/latepost?limit=30',
      '/techcrunch/news?limit=30',
      '/huxiu/article?limit=30',
      '/solidot?limit=30',
      '/readhub?limit=30',
      '/jiemian/lists/65?limit=30',
      '/anthropic/engineering?limit=30',
      '/anthropic/news?limit=30',
      '/36kr/hot-list?limit=30',
      '/github/trending/daily/any?limit=30',
      '/github/trending/weekly/any?limit=30',
      '/github/trending/monthly/any?limit=30',
    ],
  },
  githubDiscovery:{enabled:true,createdWithinDays:30,minStars:1000,limit:30,cacheTtlMs:1800000},
  llm: {
    defaultProvider: 'deepseek',
    requestTimeoutMs: 120000,
    safetyReserveTokens: 2048,
    recentMessageCount: 8,
    providers: {
      deepseek: {
        label: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKeyEnv: 'DEEPSEEK_API_KEY',
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        maxTokensField: 'max_tokens',
        taggingChunkSize: 8,
        taggingConcurrency: 6,
        supportsJsonMode: true,
        enabled: true,
      },
      minimax: {
        label: 'MiniMax',
        baseUrl: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.7',
        apiKeyEnv: 'MINIMAX_API_KEY',
        contextWindow: 204800,
        maxOutputTokens: 2048,
        maxTokensField: 'max_completion_tokens',
        taggingChunkSize: 2,
        taggingConcurrency: 4,
        supportsJsonMode: true,
        enabled: true,
        webSearchConfig: { payloadKey: 'enable_web_search', payloadValue: true },
      },
      kimi: {
        label: 'Kimi',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2.6',
        apiKeyEnv: 'MOONSHOT_API_KEY',
        contextWindow: 262144,
        maxOutputTokens: 8192,
        maxTokensField: 'max_tokens',
        taggingChunkSize: 8,
        taggingConcurrency: 6,
        supportsJsonMode: true,
        enabled: true,
        webSearchConfig: { payloadKey: 'enable_search', payloadValue: true },
      },
    },
  },
  tavily: { enabled: false, apiKeyEnv: 'TAVILY_API_KEY', maxResults: 5 },
};

function merge(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(base[key] ?? {}, value)
      : value;
  }
  return result;
}

export function loadConfig(root = process.cwd()) {
  const localPath = path.join(root, 'config.local.json');
  const local = fs.existsSync(localPath)
    ? JSON.parse(fs.readFileSync(localPath, 'utf8'))
    : {};
  const config=merge(defaults, local);
  if(config.workspaceRoot&&!path.isAbsolute(config.workspaceRoot))config.workspaceRoot=path.resolve(root,config.workspaceRoot);
  config.contentRoots=(config.contentRoots||[]).map((value)=>path.isAbsolute(value)?value:path.resolve(root,value));
  for(const key of ['rootDir','startScript','stopScript','pidFile']){
    const value=config.rsshub?.[key];
    if(value&&!path.isAbsolute(value))config.rsshub[key]=path.resolve(root,value);
  }
  const envPort=Number(process.env.WORKBENCH_PORT);
  if(Number.isInteger(envPort)&&envPort>0&&envPort<65536)config.port=envPort;
  return config;
}
