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
  githubDiscovery:{enabled:true,createdWithinDays:30,minStars:1000,limit:30,cacheTtlMs:1800000,
    // AI 兴趣仓库发现：LLM 按账号内容支柱生成 Search 查询组（refreshDays 内复用缓存），
    // 搜到的仓库再经兴趣相关性打分过滤；任一环节失败自动退化为纯规则发现
    aiQueries:{enabled:true,refreshDays:7,maxQueries:6,perQueryLimit:15,relevanceFilter:true,minInterestScore:6}},
  llm: {
    defaultProvider: 'deepseek',
    requestTimeoutMs: 300000,
    safetyReserveTokens: 2048,
    recentMessageCount: 8,
    providers: {
      deepseek: {
        label: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKeyEnv: 'DEEPSEEK_API_KEY',
        contextWindow: 900000,
        maxOutputTokens: 16384,
        maxTokensField: 'max_tokens',
        taggingChunkSize: 8,
        taggingConcurrency: 6,
        supportsJsonMode: true,
        // v4-flash 支持 thinking 开关；gateway 按调用用途决定是否关闭推理（结构化抽取关闭，对话/写作保持开启）
        supportsThinkingToggle: true,
        // thinking 开启时追加的推理 token 余量（推理与内容共享 max_tokens）
        thinkingReserveTokens: 8000,
        // 推理强度 low/high/max（v4-flash 三档均支持）；默认 low 收敛思维链长度，避免推理失控吃光输出预算
        reasoningEffort: 'low',
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
        maxOutputTokens: 16384,
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
  // 文档检索槽位（content.document.search）：用户明确授权的本地知识库根目录（如 Obsidian vault），
  // 只读扫描，未配置时文档检索开关不生效
  documentSearch: { roots: [] },
  // 抓取路由与质量评分阈值（待办 7-P1/P2）；评分权重与拦截词表在 lib/domain/source-quality.mjs 内
  sourceFetch: {
    upgradeThreshold: 55,    // Python 抓取质量分低于此值才升级 Firecrawl（计费）
    rssContentMinChars: 800, // RSS 摘要达到此长度视为可用正文，免抓
    rssFallbackMinChars: 200,// 抓取全部失败时，摘要兜底降级的最小长度
    githubMinChars: 200,     // GitHub README 低于此长度视为不可用，落回通用抓取
  },
  // AI 后台任务并发：候选级任务（文章 / 图文 / 排版 / 自主写作）按候选并行，
  // 批次级任务（打标 / 研判 / 自动流程）同批次互斥；超出上限的任务排队等待。
  aiJobs: { maxConcurrent: 2 },
  // 成稿字数门禁（可见字符，口径见 lib/domain/markdown-visible-chars.mjs）：
  // 成稿 / 早报 / 自主写作三条链路与编辑器终稿保存统一从这里读取；
  // pipelines 下可按链路做差异覆盖（缺省回退全局 min/max）；
  // 单技能仍可在技能覆盖层 gates.length 做最终覆盖（优先级最高）。
  articleLength: {
    minVisibleChars: 1300,
    maxVisibleChars: 2000,
    pipelines: { article: {}, daily: {}, tutorial: {} },
  },
};

// 解析某条链路的有效字数区间：pipelines[chain] 差异覆盖 → 全局 min/max。
export function resolveArticleLength(config, chain) {
  const base = config?.articleLength ?? {};
  const override = (chain && base.pipelines?.[chain]) ?? {};
  const min = Number(override.minVisibleChars ?? base.minVisibleChars ?? 1300);
  const max = Number(override.maxVisibleChars ?? base.maxVisibleChars ?? 2000);
  return { min, max };
}

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
