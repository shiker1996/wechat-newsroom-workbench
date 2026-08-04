import fs from 'node:fs';
import path from 'node:path';

const CATEGORIES = ['🤖 AI/技术动态', '📰 综合资讯', '🏢 大厂战略', '📈 行业趋势', '💼 职场生态'];

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

function preScores(conflict, audience, informationGain, emotion, timeliness, impact, sourceReliability) {
  return { conflict, audience, informationGain, emotion, timeliness, impact, sourceReliability };
}

function hotspot({ title, url, category, marketScope, score, sourceName, route, summary, publishedAt }) {
  return {
    title, url, category, marketScope, score,
    sourceName, route,
    sourceGroup: 'rsshub', source: 'rsshub', sourceType: 'rsshub',
    publishedAt, researchEligible: true,
    summary,
  };
}

function tags({ eventKey, eventParts, keywords, chinaRelevance, riskLevel, pre }) {
  return {
    eventKey,
    eventParts,
    keywords,
    chinaRelevance,
    relevanceReason: '演示数据：按热度与账号定位综合评估',
    riskLevel,
    riskReason: '演示数据：无真实风险判定',
    preScores: pre,
    credibleScoop: 2,
    saturationPenalty: 0,
    duplicatePenalty: 0,
    blackHorseSignals: [],
  };
}

const todayItems = [
  hotspot({
    title: '阿里云宣布开源新一代 Qwen 模型，推理成本再降三成',
    url: 'https://example.com/news/qwen-open-source',
    category: '🤖 AI/技术动态', marketScope: '国内', score: 92,
    sourceName: '36氪', route: '/36kr/hot-list',
    publishedAt: isoHoursAgo(3),
    summary: '阿里云在开发者日宣布开源新一代 Qwen 系列模型，官方称同等能力下推理成本下降约 30%，并开放长上下文与工具调用能力。',
  }),
  hotspot({
    title: '开源大模型密集上新：性能对标旗舰，权重与量化包同步放出',
    url: 'https://example.com/news/open-model-release',
    category: '🤖 AI/技术动态', marketScope: '全球', score: 85,
    sourceName: 'Solidot', route: '/solidot',
    publishedAt: isoHoursAgo(5),
    summary: '多个开源大模型在同一周内更新版本，参数量更小、推理更快，社区出现大量本地部署教程，MCP 工具生态随之增长。',
  }),
  hotspot({
    title: '微信公众平台新规：AI 生成内容需主动声明',
    url: 'https://example.com/news/wechat-ai-label',
    category: '📰 综合资讯', marketScope: '国内', score: 88,
    sourceName: '晚点 LatePost', route: '/latepost',
    publishedAt: isoHoursAgo(6),
    summary: '微信公众平台发布内容规范更新，要求创作者对 AI 生成内容进行声明，平台将对标识情况与原创保护联动评估。',
  }),
  hotspot({
    title: '海外主流内容平台集体上线 AI 生成内容标识',
    url: 'https://example.com/news/ai-content-label-global',
    category: '📰 综合资讯', marketScope: '全球', score: 84,
    sourceName: 'TechCrunch', route: '/techcrunch/news',
    publishedAt: isoHoursAgo(8),
    summary: '多家海外内容与社交媒体平台在同一周内推出 AI 生成内容标识，规范使用与透明度成为新一轮行业共识。',
  }),
  hotspot({
    title: '公众号流量主政策调整：原创与互动权重上调',
    url: 'https://example.com/news/mp-traffic-policy',
    category: '📈 行业趋势', marketScope: '国内', score: 80,
    sourceName: '虎嗅', route: '/huxiu/article',
    publishedAt: isoHoursAgo(10),
    summary: '流量主收益规则更新，原创占比与粉丝互动被纳入更高权重，靠转载与洗稿的账号收益进一步收窄。',
  }),
  hotspot({
    title: 'Node.js 24 正式支持内置 SQLite，全栈开发再简化',
    url: 'https://example.com/news/node-sqlite',
    category: '💼 职场生态', marketScope: '全球', score: 82,
    sourceName: 'Reddit · r/programming', route: 'programming',
    publishedAt: isoHoursAgo(12),
    summary: 'Node.js 24 将 SQLite 作为实验性内置模块提供，本地数据型工具不再需要单独安装数据库依赖，社区讨论热烈。',
  }),
  hotspot({
    title: '七家新能源车企公布七月销量，头部座次生变',
    url: 'https://example.com/news/nev-sales',
    category: '📈 行业趋势', marketScope: '国内', score: 78,
    sourceName: '界面新闻', route: '/jiemian/lists/65',
    publishedAt: isoHoursAgo(14),
    summary: '多家新能源车企披露七月交付数据，整体同比增长，但部分品牌增速放缓，价格战与智能驾驶成为下一阶段焦点。',
  }),
  hotspot({
    title: '新能源产业链观察：电池新工艺量产提速',
    url: 'https://example.com/news/battery-process',
    category: '📈 行业趋势', marketScope: '国内', score: 72,
    sourceName: '界面新闻', route: '/jiemian/lists/65',
    publishedAt: isoHoursAgo(16),
    summary: '多家电池厂商公布新一代电芯工艺进展，能量密度与快充指标提升，量产节奏成为行业关注重点。',
  }),
  hotspot({
    title: '半导体出口管制再收紧，产业链加速国产替代',
    url: 'https://example.com/news/semiconductor-export',
    category: '🏢 大厂战略', marketScope: '国内', score: 86,
    sourceName: 'ReadHub', route: '/readhub',
    publishedAt: isoHoursAgo(20),
    summary: '新一轮半导体设备出口管制生效，相关上市公司回应业务影响，设备与材料国产替代逻辑再度被强化。',
  }),
  hotspot({
    title: '折叠屏手机出货量创新高，轻薄与影像成新卖点',
    url: 'https://example.com/news/foldable-phone',
    category: '📰 综合资讯', marketScope: '国内', score: 70,
    sourceName: '36氪', route: '/36kr/hot-list',
    publishedAt: isoHoursAgo(26),
    summary: '折叠屏手机市场持续扩张，厂商在新一代产品上同时强调轻薄机身与影像能力，高端机竞争进一步加剧。',
  }),
];

const yesterdayItems = [
  hotspot({
    title: 'AI 编程助手进入日常：调查显示近半数开发者已在用',
    url: 'https://example.com/news/ai-coding-survey',
    category: '💼 职场生态', marketScope: '全球', score: 90,
    sourceName: 'ReadHub', route: '/readhub',
    publishedAt: isoHoursAgo(28),
    summary: '一份开发者调查显示，近半数受访者已在日常开发中使用 AI 编程助手，代码审查与测试生成是最高频场景。',
  }),
  hotspot({
    title: 'MCP 协议持续升温：主流工具与应用加速接入',
    url: 'https://example.com/news/mcp-adoption',
    category: '🤖 AI/技术动态', marketScope: '全球', score: 87,
    sourceName: 'Reddit · r/artificial', route: 'artificial',
    publishedAt: isoHoursAgo(30),
    summary: 'Model Context Protocol 生态扩展加快，更多编辑器、数据库与浏览器工具接入，本地 AI 工作流的组装变得更容易。',
  }),
  hotspot({
    title: '多家大模型厂商下调 API 价格，推理成本进入下降通道',
    url: 'https://example.com/news/llm-price-cut',
    category: '🤖 AI/技术动态', marketScope: '国内', score: 83,
    sourceName: '36氪', route: '/36kr/hot-list',
    publishedAt: isoHoursAgo(34),
    summary: '大模型 API 价格持续下调，长文本与高并发场景的单位成本显著降低，应用层开始把更重的任务交给模型。',
  }),
  hotspot({
    title: '国产大模型长文本评测：中英文能力差距进一步缩小',
    url: 'https://example.com/news/llm-long-context',
    category: '📈 行业趋势', marketScope: '国内', score: 75,
    sourceName: '虎嗅', route: '/huxiu/article',
    publishedAt: isoHoursAgo(40),
    summary: '第三方评测显示，国产大模型在长文本理解与中文创作上表现稳定，与国际旗舰模型的差距持续收窄。',
  }),
  hotspot({
    title: '内容创作工具周报：公众号排版与配图效率成为关注焦点',
    url: 'https://example.com/news/content-tool-weekly',
    category: '📰 综合资讯', marketScope: '国内', score: 68,
    sourceName: '虎嗅', route: '/huxiu/article',
    publishedAt: isoHoursAgo(44),
    summary: '本周内容创作工具讨论集中在排版效率与配图质量，编辑工作台与一键成图类工具的热度上升。',
  }),
];

function demoTodayHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>演示排版 · 开源大模型观察</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.8; color: #2c2c2c; max-width: 680px; margin: 0 auto; padding: 32px 20px; }
  h1 { font-size: 26px; letter-spacing: 1px; border-left: 4px solid #c0392b; padding-left: 12px; }
  h2 { font-size: 20px; margin-top: 28px; }
  .lead { color: #666; }
  blockquote { border-left: 3px solid #bdc3c7; margin: 16px 0; padding: 8px 16px; color: #555; background: #fafafa; }
  .keyword { color: #c0392b; font-weight: 600; }
</style></head>
<body>
  <h1>开源大模型这一周：成本、生态与内容合规</h1>
  <p class="lead">演示排版产物 · 虚构内容 · 2026-08-04</p>
  <p>过去一周，<span class="keyword">开源大模型</span>的节奏明显加快。新一代 Qwen 在同等能力下进一步压低推理成本，多个主流工具开始原生支持本地模型调用，<span class="keyword">MCP 生态</span>的接入速度也在提升。</p>
  <h2>成本进入下降通道</h2>
  <p>多家厂商在同一周期内下调 API 价格，长文本与高并发场景的单位成本显著降低，应用层开始把更重的任务交给模型。</p>
  <blockquote>对内容创作者而言，更重要的是平台侧的合规变化：AI 生成内容标识正在成为共识。</blockquote>
  <h2>内容合规与原创价值</h2>
  <p>公众号与海外主流平台先后更新规范，要求对 AI 生成内容进行声明。对长期输出原创内容的账号来说，规范反而拉大了与搬运账号之间的差距。</p>
</body>
</html>`;
}

export function seedDemoData(store, { root }) {
  const existing = store.db.prepare('SELECT COUNT(*) AS n FROM batches').get().n;
  if (existing > 0) return { seeded: false };

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400 * 1000).toISOString().slice(0, 10);

  const todayBatch = store.createBatch({
    date: today,
    title: `${today} 每日选题`,
    note: '演示批次：用于在未配置模型服务商时预览工作台各视图。',
    requestedTracks: ['article', 'social_cards'],
  });

  const redditRun = store.startSourceRun(todayBatch.id, 'reddit');
  store.finishSourceRun(redditRun, 'ok', 4, null);
  const rssRun = store.startSourceRun(todayBatch.id, 'rsshub');
  store.finishSourceRun(rssRun, 'ok', 6, null);

  store.addHotspots(todayBatch.id, 'rsshub', todayItems);
  const todayTagged = [
    [0, { eventKey: '通义千问|开源新模型', eventParts: { who: '通义千问', what: '开源新模型', actionType: '开源', object: 'Qwen', labels: { who: '通义千问', what: '开源新模型', object: 'Qwen' } }, keywords: ['Qwen', '开源', '大模型', '推理成本'], chinaRelevance: 10, riskLevel: '低', preScores: preScores(8, 12, 13, 9, 10, 8, 8) }],
    [1, { eventKey: '通义千问|开源新模型', eventParts: { who: '通义千问', what: '开源新模型', actionType: '开源', object: 'Qwen', labels: { who: '通义千问', what: '开源新模型', object: 'Qwen' } }, keywords: ['开源', '大模型', '本地部署'], chinaRelevance: 8, riskLevel: '低', preScores: preScores(6, 11, 12, 8, 10, 7, 7) }],
    [2, { eventKey: '内容平台|标注AI生成内容', eventParts: { who: '内容平台', what: '标注AI生成内容', actionType: '发布', object: 'AI生成标识', labels: { who: '内容平台', what: '标注AI生成内容', object: 'AI生成标识' } }, keywords: ['AI生成', '公众号', '平台规范'], chinaRelevance: 10, riskLevel: '中', preScores: preScores(7, 14, 14, 9, 10, 9, 8) }],
    [3, { eventKey: '内容平台|标注AI生成内容', eventParts: { who: '内容平台', what: '标注AI生成内容', actionType: '发布', object: 'AI生成标识', labels: { who: '内容平台', what: '标注AI生成内容', object: 'AI生成标识' } }, keywords: ['AI生成', '标识', '海外'], chinaRelevance: 6, riskLevel: '中', preScores: preScores(6, 13, 12, 8, 10, 8, 8) }],
    [4, { eventKey: '公众号平台|扶持原创', eventParts: { who: '公众号平台', what: '扶持原创', actionType: '发布', object: '流量主政策', labels: { who: '公众号平台', what: '扶持原创', object: '流量主政策' } }, keywords: ['流量主', '原创', '公众号'], chinaRelevance: 10, riskLevel: '低', preScores: preScores(5, 12, 11, 7, 9, 7, 7) }],
    [5, { eventKey: 'Node.js|支持内置SQLite', eventParts: { who: 'Node.js', what: '支持内置SQLite', actionType: '发布', object: 'node:sqlite', labels: { who: 'Node.js', what: '支持内置SQLite', object: 'node:sqlite' } }, keywords: ['Node.js', 'SQLite', '全栈'], chinaRelevance: 7, riskLevel: '低', preScores: preScores(4, 10, 12, 6, 8, 7, 9) }],
    [6, { eventKey: '新能源车企|公布7月销量', eventParts: { who: '新能源车企', what: '公布7月销量', actionType: '发布', object: '销量数据', labels: { who: '新能源车企', what: '公布7月销量', object: '销量数据' } }, keywords: ['新能源', '销量', '车企'], chinaRelevance: 9, riskLevel: '低', preScores: preScores(6, 12, 11, 7, 8, 7, 7) }],
    [7, { eventKey: '新能源车企|公布7月销量', eventParts: { who: '新能源车企', what: '公布7月销量', actionType: '发布', object: '销量数据', labels: { who: '新能源车企', what: '公布7月销量', object: '销量数据' } }, keywords: ['电池', '新能源', '量产'], chinaRelevance: 8, riskLevel: '低', preScores: preScores(5, 11, 10, 6, 8, 6, 7) }],
  ];
  for (const [index, tag] of todayTagged) {
    const hotspotRow = store.db.prepare('SELECT id FROM hotspots WHERE batch_id=? ORDER BY id LIMIT 1 OFFSET ?').get(todayBatch.id, index);
    store.updateHotspotTags(hotspotRow.id, { ...tag, category: todayItems[index].category, marketScope: todayItems[index].marketScope, score: todayItems[index].score });
  }

  const taggedIds = (indexes) => indexes.map((index) => store.db.prepare('SELECT id FROM hotspots WHERE batch_id=? ORDER BY id LIMIT 1 OFFSET ?').get(todayBatch.id, index).id);
  store.addCandidates(todayBatch.id, taggedIds([0, 2, 4, 5]), { tracks: ['article'] });
  store.addCandidates(todayBatch.id, taggedIds([1, 3, 6]), { tracks: ['social_cards'] });

  const taggingRun = store.createAiRun({ id: `demo-today-${Date.now()}`, batchId: todayBatch.id, type: 'auto', provider: 'deepseek' });
  store.updateAiRun(taggingRun.id, { status: 'completed', progress: '已完成事件研判与打标（演示数据）', result_json: '{}' });

  const demoArticleDir = path.join(root, 'articles', 'demo');
  fs.mkdirSync(demoArticleDir, { recursive: true });
  const demoTodayPath = path.join(demoArticleDir, 'article.ai.html');
  fs.writeFileSync(demoTodayPath, demoTodayHtml(), 'utf8');
  const demoTodayStat = fs.statSync(demoTodayPath);
  store.upsertArtifact({
    batchId: todayBatch.id,
    kind: '排版 HTML',
    name: 'article.ai.html',
    path: demoTodayPath,
    size: demoTodayStat.size,
    modifiedAt: demoTodayStat.mtime.toISOString(),
    status: 'ready',
  });

  const yesterdayBatch = store.createBatch({
    date: yesterday,
    title: `${yesterday} 每日选题`,
    note: '演示批次：昨日已完成一批生产链步骤。',
    requestedTracks: ['article', 'social_cards'],
  });
  store.addHotspots(yesterdayBatch.id, 'rsshub', yesterdayItems);
  const yesterdayTagged = [
    [0, { eventKey: 'AI编程助手|使用调查', eventParts: { who: '开发者', what: '使用AI编程助手', actionType: '发布', object: '调查数据', labels: { who: '开发者', what: '使用AI编程助手', object: '调查数据' } }, keywords: ['AI编程', '开发者', '调查'], chinaRelevance: 8, riskLevel: '低', preScores: preScores(6, 12, 13, 8, 7, 8, 8) }],
    [1, { eventKey: 'MCP协议|生态扩展', eventParts: { who: 'MCP', what: '生态扩展', actionType: '发布', object: '协议', labels: { who: 'MCP', what: '生态扩展', object: '协议' } }, keywords: ['MCP', 'AI', '工具生态'], chinaRelevance: 8, riskLevel: '低', preScores: preScores(5, 11, 13, 7, 8, 8, 8) }],
    [2, { eventKey: '大模型厂商|下调API价格', eventParts: { who: '大模型厂商', what: '下调API价格', actionType: '发布', object: 'API价格', labels: { who: '大模型厂商', what: '下调API价格', object: 'API价格' } }, keywords: ['大模型', 'API', '价格'], chinaRelevance: 9, riskLevel: '低', preScores: preScores(6, 12, 11, 7, 8, 7, 7) }],
  ];
  for (const [index, tag] of yesterdayTagged) {
    const hotspotRow = store.db.prepare('SELECT id FROM hotspots WHERE batch_id=? ORDER BY id LIMIT 1 OFFSET ?').get(yesterdayBatch.id, index);
    store.updateHotspotTags(hotspotRow.id, { ...tag, category: yesterdayItems[index].category, marketScope: yesterdayItems[index].marketScope, score: yesterdayItems[index].score });
  }
  const yesterdayTaggedIds = yesterdayTagged.map(([index]) => store.db.prepare('SELECT id FROM hotspots WHERE batch_id=? ORDER BY id LIMIT 1 OFFSET ?').get(yesterdayBatch.id, index).id);
  store.addCandidates(yesterdayBatch.id, yesterdayTaggedIds, { tracks: ['article', 'social_cards'] });
  const yesterdayResearch = store.createAiRun({ id: `demo-yest-${Date.now()}`, batchId: yesterdayBatch.id, type: 'auto', provider: 'deepseek' });
  store.updateAiRun(yesterdayResearch.id, { status: 'completed', progress: '已完成事件研判与打标（演示数据）', result_json: '{}' });

  const demoArticlePath = path.join(demoArticleDir, '09-FINAL.md');
  const demoArticleContent = [
    `# 演示文章：开源大模型这一周发生了三件值得注意的事`,
    ``,
    `> 本文为工作台演示产物，用于在无模型服务商配置时预览「产物」视图，内容为虚构示例。`,
    ``,
    `## 核心变化`,
    ``,
    `过去一周，开源大模型社区密集上新。新一代 Qwen 在同等能力下把推理成本进一步压低，MCP 生态的接入速度明显加快，多个主流工具开始原生支持本地模型调用。`,
    ``,
    `## 对内容创作者意味着什么`,
    ``,
    `AI 生成内容标识正在成为平台共识。公众号与海外主流平台先后更新规范，明确要求对 AI 生成内容进行声明。对长期输出原创内容的账号来说，规范反而拉大了与搬运账号之间的差距。`,
  ].join('\n');
  fs.writeFileSync(demoArticlePath, demoArticleContent, 'utf8');
  const demoStat = fs.statSync(demoArticlePath);
  store.upsertArtifact({
    batchId: yesterdayBatch.id,
    kind: '文章终稿',
    name: '09-FINAL.md',
    path: demoArticlePath,
    size: demoStat.size,
    modifiedAt: demoStat.mtime.toISOString(),
    status: 'ready',
  });

  return { seeded: true, todayBatchId: todayBatch.id, yesterdayBatchId: yesterdayBatch.id };
}
