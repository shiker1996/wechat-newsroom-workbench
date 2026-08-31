const TOPIC_RULES = [
  { id: 'ai-tools', label: 'AI 工具', words: ['AI', '人工智能', '大模型', '智能体', 'deepseek', 'claude', 'cursor', 'copilot', 'agent'] },
  { id: 'developer-tools', label: '开发者工具', words: ['代码', '编程', '程序员', '开发', '终端', 'VS Code', '插件', 'OCR', 'Markdown', 'PDF', '技能'] },
  { id: 'open-source', label: '开源项目', words: ['开源', 'GitHub', '仓库', '框架', '项目', 'Web UI'] },
  { id: 'workplace-observation', label: '职场观察', words: ['职场', '研发', '工作', '离职', '劝退', '应届生', '程序员', '同事', '老板'] },
  { id: 'efficiency-method', label: '效率与方法', words: ['效率', '成本', '自动化', '工作流', '方法', '教程', '一次装齐', '批量'] },
  { id: 'industry-dynamics', label: '行业动态', words: ['发布', '合作', '开源', '阿里', '字节', '腾讯', 'OpenAI', '西山居', '雷军'] },
];

const STRUCTURE_RULES = [
  { id: 'result-promise', label: '结果 / 数字承诺', test: (text) => /\d|\d+\s*(ms|秒|倍|人|天|种|步|个)|效率|成本|一键|一次装齐|全搞定/i.test(text) },
  { id: 'conflict-contrast', label: '冲突 / 反差', test: (text) => /别|不要|不再|但是|却|反而|因为|失去|完蛋|劝退|不能|还在/i.test(text) },
  { id: 'question-hook', label: '疑问 / 问题钩子', test: (text) => /[?？]|为什么|如何|怎么|谁懂|谁知道/.test(text) },
  { id: 'tool-name', label: '工具名 + 用途', test: (text) => /[:：]/.test(text) && TOPIC_RULES.slice(0, 3).some((rule) => rule.words.some((word) => text.toLowerCase().includes(word.toLowerCase()))) },
  { id: 'emotional-spoken', label: '情绪 / 口语表达', test: (text) => /[!！😭😂🔥😅🤯]|拜托|告别|绝了|离谱|难评|真的|居然|没想到/.test(text) },
];

function includesWord(text, word) {
  return text.toLowerCase().includes(String(word).toLowerCase());
}

function classifyTitle(title = '') {
  const text = String(title || '').trim();
  const matchedTopics = TOPIC_RULES.filter((rule) => rule.words.some((word) => includesWord(text, word)));
  const topicTags = matchedTopics.slice(0, 3).map((rule) => rule.label);
  if (!topicTags.length) topicTags.push('其他观察');
  const matchedStructures = STRUCTURE_RULES.filter((rule) => rule.test(text));
  const titleStructure = matchedStructures[0]?.label || '陈述 / 观察型';
  return {
    topicTags,
    titleStructure,
    titleFeatures: {
      hasNumber: /\d/.test(text),
      hasQuestion: /[?？]|为什么|如何|怎么/.test(text),
      hasColon: /[:：]/.test(text),
      hasEmotion: /[!！😭😂🔥😅🤯]/.test(text),
      hasQuotedPhrase: /[“”\"「」『』]/.test(text),
    },
    classificationSource: 'heuristic',
  };
}

function average(values) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length) : 0;
}

function aggregate(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    for (const key of keyOf(item)) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
  }
  return [...groups.entries()].map(([label, group]) => {
    const reads = group.reduce((sum, item) => sum + Number(item.reads || 0), 0);
    const follows = group.reduce((sum, item) => sum + Number(item.follows_after_read || 0), 0);
    const sampleCount = group.length;
    return {
      label,
      sample_count: sampleCount,
      total_reads: reads,
      avg_reads: average(group.map((item) => item.reads)),
      total_follows: follows,
      follows_per_thousand_reads: reads ? Number((follows / reads * 1000).toFixed(2)) : 0,
      confidence: sampleCount >= 8 ? 'medium' : 'low',
    };
  }).sort((left, right) => right.avg_reads - left.avg_reads || right.follows_per_thousand_reads - left.follows_per_thousand_reads);
}

export function classifyWechatArticle(article = {}) {
  const classification = classifyTitle(article.title);
  return {
    ...article,
    topic_tags: classification.topicTags,
    title_structure: classification.titleStructure,
    title_features: classification.titleFeatures,
    classification_source: classification.classificationSource,
  };
}

export function buildWechatInsights(articles = []) {
  const classifiedArticles = articles.map(classifyWechatArticle);
  const topics = aggregate(classifiedArticles, (item) => item.topic_tags);
  const titleStructures = aggregate(classifiedArticles, (item) => [item.title_structure]);
  const strongestReadTopic = topics[0] || null;
  const strongestFollowTopic = [...topics].sort((left, right) => right.follows_per_thousand_reads - left.follows_per_thousand_reads || right.sample_count - left.sample_count)[0] || null;
  const strongestReadStructure = titleStructures[0] || null;
  const strongestFollowStructure = [...titleStructures].sort((left, right) => right.follows_per_thousand_reads - left.follows_per_thousand_reads || right.sample_count - left.sample_count)[0] || null;
  return {
    topics,
    title_structures: titleStructures,
    summary: {
      strongest_read_topic: strongestReadTopic,
      strongest_follow_topic: strongestFollowTopic,
      strongest_read_structure: strongestReadStructure,
      strongest_follow_structure: strongestFollowStructure,
      caveat: '题材和标题结构为规则初判；样本量有限，只作为选题和素材推荐的软信号。',
    },
  };
}

export function matchWechatPerformance(text = '', insights = {}) {
  const classification = classifyTitle(text);
  const topics = (insights.topics || []).filter((item) => classification.topicTags.includes(item.label));
  const structure = (insights.title_structures || []).find((item) => item.label === classification.titleStructure) || null;
  const bestTopic = [...topics].sort((left, right) => right.avg_reads - left.avg_reads)[0] || null;
  const bestFollowTopic = [...topics].sort((left, right) => right.follows_per_thousand_reads - left.follows_per_thousand_reads)[0] || null;
  const hasSignal = Boolean(bestTopic || structure);
  const level = bestTopic?.sample_count >= 8 || bestFollowTopic?.sample_count >= 8 ? 'medium' : hasSignal ? 'low' : 'low';
  const reasons = [];
  if (bestTopic) reasons.push(`相近历史题材 ${bestTopic.label} 有 ${bestTopic.sample_count} 篇样本，平均 ${bestTopic.avg_reads.toLocaleString('zh-CN')} 阅读`);
  if (bestFollowTopic && bestFollowTopic.follows_per_thousand_reads > 0) reasons.push(`该题材历史阅读后关注约 ${bestFollowTopic.follows_per_thousand_reads}/千次阅读`);
  if (structure) reasons.push(`可参考标题结构“${structure.label}”（${structure.sample_count} 篇样本）`);
  return {
    level,
    reason: reasons.join('；') || '暂未匹配到足够的历史题材或标题结构样本',
    matched_topics: topics.map((item) => item.label),
    matched_title_structure: structure?.label || classification.titleStructure,
    sample_count: Math.max(topics.reduce((sum, item) => sum + item.sample_count, 0), structure?.sample_count || 0),
  };
}
