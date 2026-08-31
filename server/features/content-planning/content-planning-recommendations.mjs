import { classifyWechatArticle, matchWechatPerformance } from './wechat-content-insights.mjs';

const LEVEL_WEIGHT = { high: 3, medium: 2, low: 1 };

function materialTitle(material = {}) {
  return String(material.title || String(material.raw_text || '').split(/[\n。！？]/).find(Boolean) || '').trim();
}

function levelOf(value) {
  return ['high', 'medium', 'low'].includes(value) ? value : 'low';
}

function bestSignal(signals = [], labels = []) {
  const wanted = new Set(labels);
  return (Array.isArray(signals) ? signals : [])
    .filter((item) => wanted.has(item.label))
    .sort((left, right) => Number(right.sample_count || 0) - Number(left.sample_count || 0) || Number(right.avg_reads || 0) - Number(left.avg_reads || 0))[0] || null;
}

function strongestSignal(signals = []) {
  return Array.isArray(signals) && signals.length ? signals[0] : null;
}

function assessmentLevel(material) {
  const assessment = material.assessment || {};
  const levels = [assessment.account_fit?.level, assessment.completeness?.level, assessment.topic_potential?.level]
    .filter(Boolean).map(levelOf);
  if (!levels.length) return 'low';
  const score = levels.reduce((sum, level) => sum + LEVEL_WEIGHT[level], 0) / levels.length;
  return score >= 2.6 ? 'high' : score >= 1.8 ? 'medium' : 'low';
}

function chooseGoal({ topic, titleStructure, feedback, insights }) {
  const followSignal = topic && Number(topic.follows_per_thousand_reads || 0) >= 3;
  if (followSignal) return { id: 'follow', label: '涨粉', reason: `相近题材历史阅读后关注约 ${topic.follows_per_thousand_reads}/千次阅读` };
  if (titleStructure && ['冲突 / 反差', '情绪 / 口语表达'].includes(titleStructure.label)) return { id: 'share', label: '分享', reason: `相近标题结构“${titleStructure.label}”更适合验证转发与讨论` };
  if (topic || strongestSignal(feedback?.topic_signals) || strongestSignal(insights?.topics)) return { id: 'reach', label: '拉新', reason: '先沿用有历史阅读样本的题材，再验证新的具体切口' };
  return { id: 'experiment', label: '实验', reason: '暂无足够匹配样本，先把题材、标题结构和结果一起做成可复盘实验' };
}

/**
 * Build a deterministic, explainable recommendation for a material or a calendar plan.
 * Historical feedback is only a soft ranking signal; it never becomes a fact or a rule.
 */
export function buildContentPlanningRecommendation(material = {}, { feedback = null, insights = {} } = {}) {
  const title = materialTitle(material);
  const classified = classifyWechatArticle({ title });
  const topic = bestSignal(feedback?.topic_signals, classified.topic_tags) || bestSignal(insights?.topics, classified.topic_tags);
  const titleStructure = bestSignal(feedback?.title_signals, [classified.title_structure]) || bestSignal(insights?.title_structures, [classified.title_structure]);
  const fallbackTopic = strongestSignal(feedback?.topic_signals) || strongestSignal(insights?.topics);
  const fallbackTitle = strongestSignal(feedback?.title_signals) || strongestSignal(insights?.title_structures);
  const matched = Boolean(topic || titleStructure);
  const historical = matchWechatPerformance(`${title}\n${material.raw_text || ''}`, insights);
  const assessment = assessmentLevel(material);
  const goal = chooseGoal({ topic: topic || fallbackTopic, titleStructure: titleStructure || fallbackTitle, feedback, insights });
  const recommendedTopic = topic?.label || fallbackTopic?.label || classified.topic_tags[0] || '当前素材题材';
  const recommendedTitleStructure = titleStructure?.label || fallbackTitle?.label || classified.title_structure;
  const reasons = [];
  if (topic) reasons.push(`匹配历史题材“${topic.label}”，${topic.sample_count || 0} 篇样本平均 ${Number(topic.avg_reads || 0).toLocaleString('zh-CN')} 阅读`);
  else if (fallbackTopic) reasons.push(`可参考历史高表现题材“${fallbackTopic.label}”，但当前素材尚未形成直接匹配`);
  if (titleStructure) reasons.push(`标题可试“${titleStructure.label}”，当前有 ${titleStructure.sample_count || 0} 篇样本`);
  else if (fallbackTitle) reasons.push(`标题可参考“${fallbackTitle.label}”，当前素材标题结构还需人工确认`);
  if (assessment !== 'low') reasons.push(`素材本身的账号切合度、完整度和话题潜力综合为${assessment === 'high' ? '高' : '中'}`);
  if (!reasons.length) reasons.push('历史样本暂未匹配，优先补齐问题、结果和适用边界后再验证');
  const score = Math.min(100,
    (assessment === 'high' ? 36 : assessment === 'medium' ? 24 : 12)
    + (topic ? Math.min(28, 10 + Number(topic.sample_count || 0) * 2) : 0)
    + (titleStructure ? Math.min(18, 8 + Number(titleStructure.sample_count || 0)) : 0)
    + (historical.sample_count ? Math.min(18, Number(historical.sample_count) * 3) : 0));
  const priority = score >= 66 ? 'high' : score >= 42 ? 'medium' : 'low';
  const validationQuestion = `验证“${recommendedTopic} + ${recommendedTitleStructure}”能否带来${goal.label}，并记录实际结果与失败边界。`;
  return {
    priority,
    priority_score: score,
    target: goal.id,
    target_label: goal.label,
    target_reason: goal.reason,
    recommended_topic: recommendedTopic,
    recommended_title_structure: recommendedTitleStructure,
    validation_question: validationQuestion,
    next_teaser: material.next_teaser || `下一篇预告：继续验证${recommendedTopic}在${recommendedTitleStructure}标题下的${goal.label}表现。`,
    reason: reasons.join('；'),
    matched_history: matched,
    history_sample_count: Math.max(Number(topic?.sample_count || 0), Number(titleStructure?.sample_count || 0), Number(historical.sample_count || 0)),
    confidence: feedback?.confidence || (historical.sample_count ? historical.level : 'low'),
  };
}

export function sortMaterialsByPlanningRecommendation(materials = []) {
  return [...materials].sort((left, right) => Number(right.planning_recommendation?.priority_score || 0) - Number(left.planning_recommendation?.priority_score || 0) || String(right.updated_at || '').localeCompare(String(left.updated_at || '')));
}
