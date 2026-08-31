const TOPIC_RATIO_ALIASES = {
  'AI 工具': ['工具', 'AI', '开源', '工程'],
  '开发者工具': ['工具', '开源', '工程'],
  '开源项目': ['工具', '开源', '工程'],
  '效率与方法': ['工具', '工程', '效率'],
  '职场观察': ['职场', '切身', '工作'],
  '行业动态': ['平台', '事件', '科技', '商业'],
};

function number(value) {
  const parsed = Number(String(value ?? '').replace(/[,，%％]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function percent(value) {
  const parsed = number(value);
  return parsed <= 1 ? parsed * 100 : parsed;
}

function validCycles(snapshots = []) {
  const seen = new Set();
  return (Array.isArray(snapshots) ? snapshots : [])
    .filter((item) => item?.metric_window_start && item?.metric_window_end && Number(item.linked_article_count || 0) >= 3)
    .sort((left, right) => String(right.metric_window_end).localeCompare(String(left.metric_window_end)) || Number(right.id || 0) - Number(left.id || 0))
    .filter((item) => {
      const key = `${item.metric_window_start}:${item.metric_window_end}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
}

function signalFromCycles(cycles, key) {
  const map = new Map();
  for (const cycle of cycles) for (const item of cycle[key] || []) {
    if (!item?.label) continue;
    const current = map.get(item.label) || { ...item, sample_count: 0, total_reads: 0, total_follows: 0 };
    current.sample_count += Number(item.sample_count || 0);
    current.total_reads += Number(item.total_reads || 0);
    current.total_follows += Number(item.total_follows || 0);
    current.avg_reads = current.sample_count ? Math.round(current.total_reads / current.sample_count) : Number(item.avg_reads || 0);
    current.follows_per_thousand_reads = current.total_reads ? Number((current.total_follows / current.total_reads * 1000).toFixed(2)) : Number(item.follows_per_thousand_reads || 0);
    map.set(item.label, current);
  }
  return [...map.values()].sort((left, right) => Number(right.avg_reads || 0) - Number(left.avg_reads || 0) || Number(right.follows_per_thousand_reads || 0) - Number(left.follows_per_thousand_reads || 0));
}

function ratioKeyForTopic(topic, ratio) {
  const aliases = TOPIC_RATIO_ALIASES[topic] || [topic];
  return Object.keys(ratio).find((key) => aliases.some((alias) => key.includes(alias))) || null;
}

function proposeRatio(accountContext, topic) {
  const current = accountContext?.contentRatio && typeof accountContext.contentRatio === 'object' ? { ...accountContext.contentRatio } : {
    '开源项目、工具与工程实践': '60%',
    '开发者职场与切身利益': '20%',
    '平台事件与科技商业影响': '15%',
    '技术认知与原创长文': '5%',
  };
  const key = ratioKeyForTopic(topic, current);
  if (!key) return { current, proposed: current, changed: false, note: `历史信号集中在“${topic}”，但现有 contentRatio 没有可直接映射的栏目，建议先人工决定是否新增映射。` };
  const values = Object.fromEntries(Object.entries(current).map(([name, value]) => [name, percent(value)]));
  const donor = Object.keys(values).filter((name) => name !== key).sort((left, right) => values[left] - values[right])[0];
  if (!donor || values[donor] < 5) return { current, proposed: current, changed: false, note: `历史信号集中在“${topic}”，但现有比例没有足够的可调空间。` };
  const shift = Math.min(5, values[donor]);
  values[key] += shift; values[donor] -= shift;
  const proposed = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, `${Math.round(value)}%`]));
  return { current, proposed, changed: true, note: `建议把“${key}”提高约 ${Math.round(shift)} 个百分点，并从“${donor}”中让出相同比例；这是下一周期实验，不是自动改配置。` };
}

function distributionSuggestion(review = {}) {
  const articles = Array.isArray(review.articles) ? review.articles : [];
  const groups = [true, false].map((notified) => {
    const rows = articles.filter((item) => Boolean(item.notified) === notified);
    const reads = rows.reduce((sum, item) => sum + number(item.reads), 0);
    const follows = rows.reduce((sum, item) => sum + number(item.follows_after_read), 0);
    return { notified, count: rows.length, reads, follows, followRate: reads ? follows / reads * 1000 : 0 };
  });
  const notified = groups[0]; const unnotified = groups[1];
  if (!articles.length) return { proposed: { '推荐': '60%', '通知': '20%', '实验': '20%' }, reason: '暂无文章级通知/非通知样本，先保留推荐、通知和实验三类空间。', confidence: 'low' };
  const winner = notified.followRate >= unnotified.followRate ? '通知' : '推荐';
  return {
    proposed: winner === '通知' ? { '推荐': '50%', '通知': '30%', '实验': '20%' } : { '推荐': '60%', '通知': '20%', '实验': '20%' },
    reason: `当前${winner}样本的阅读后关注效率相对更高（通知 ${notified.followRate.toFixed(2)} / 非通知 ${unnotified.followRate.toFixed(2)} 每千阅读）；由于样本口径有限，建议只调整 10 个百分点并保留实验位。`,
    confidence: articles.length >= 8 ? 'medium' : 'low',
  };
}

export function buildWechatStrategyRecommendations({ snapshots = [], columnPerformance = [], review = {}, accountContext = {} } = {}) {
  const cycles = validCycles(snapshots);
  if (cycles.length < 2) return { ready: false, required_cycles: 2, cycle_count: cycles.length, cycles, suggestions: [], caveats: ['至少需要两个不同指标周期，且每个周期至少关联 3 篇正文，才生成账号级建议。', '同一指标周期重复生成反馈快照不会被当作新的内容周期。'] };
  const topicSignals = signalFromCycles(cycles.slice(0, 2), 'topic_signals');
  const titleSignals = signalFromCycles(cycles.slice(0, 2), 'title_signals');
  const strongestTopic = topicSignals[0]?.label || '当前高表现题材';
  const ratio = proposeRatio(accountContext, strongestTopic);
  const suggestions = [{
    id: 'content-ratio', type: 'contentRatio', title: '内容配比建议', level: ratio.changed ? 'medium' : 'low', current: ratio.current, proposed: ratio.proposed, reason: ratio.note, evidence: `${cycles[0].metric_window_start}—${cycles[0].metric_window_end} 与 ${cycles[1].metric_window_start}—${cycles[1].metric_window_end} 两个周期；主要信号：${strongestTopic}`,
  }];
  if (columnPerformance.length) {
    const columns = [...columnPerformance].sort((left, right) => number(right.avg_reads) - number(left.avg_reads));
    suggestions.push({ id: 'column-priority', type: 'columnPriority', title: '栏目优先级建议', level: columns[0].sample_count >= 3 ? 'medium' : 'low', proposed: columns.slice(0, 5).map((item, index) => ({ column: item.column_name || '未命名栏目', priority: index + 1, sample_count: Number(item.sample_count || 0), avg_reads: number(item.avg_reads), follows_per_thousand_reads: number(item.follows_per_thousand_reads) })), reason: '按已登记栏目且成功关联公众号指标的文章表现排序；未登记栏目或未匹配文章不参与比较。', evidence: `${columns.reduce((sum, item) => sum + Number(item.sample_count || 0), 0)} 篇栏目样本` });
  } else suggestions.push({ id: 'column-priority', type: 'columnPriority', title: '栏目优先级建议', level: 'low', proposed: [], reason: '当前没有足够的“发布信息 + 栏目 + 公众号指标”关联，暂不对栏目排优先级；先在内容日历补齐栏目和发布信息。', evidence: '栏目表现数据不足' });
  const distribution = distributionSuggestion(review);
  suggestions.push({ id: 'distribution-ratio', type: 'distributionRatio', title: '推荐 / 通知 / 实验比例建议', level: distribution.confidence, proposed: distribution.proposed, reason: distribution.reason, evidence: '文章级通知与非通知样本' });
  const bestFollow = [...topicSignals].sort((left, right) => number(right.follows_per_thousand_reads) - number(left.follows_per_thousand_reads))[0];
  const bestTitle = titleSignals[0];
  suggestions.push({ id: 'packaging', type: 'packaging', title: '账号包装与关注理由建议', level: bestFollow?.sample_count >= 3 ? 'medium' : 'low', proposed: { followReason: `关注我，可以持续看到${bestFollow?.label || strongestTopic}相关的真实实践和判断；标题先尝试${bestTitle?.label || '具体问题 + 结果'}，再根据实际数据复盘。` }, reason: '把历史表现较好的题材和标题结构转译成关注理由草案，仍需作者确认语气和长期承诺。', evidence: `${topicSignals.length} 个题材信号 · ${titleSignals.length} 个标题结构信号` });
  return { ready: true, required_cycles: 2, cycle_count: cycles.length, cycles: cycles.slice(0, 4).map((item) => ({ id: item.id, metric_window_start: item.metric_window_start, metric_window_end: item.metric_window_end, linked_article_count: item.linked_article_count, confidence: item.confidence })), suggestions, caveats: ['以上建议只用于下一轮策略讨论，不会自动写入 account-context.json。', '公众号导出数据无法证明题材、标题或分发方式之间的因果关系；执行后仍需继续记录结果。'] };
}
