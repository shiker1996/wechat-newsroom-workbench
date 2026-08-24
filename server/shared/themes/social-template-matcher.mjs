import { getSocialCardTemplatePack } from '../rendering/social-card-template-registry.mjs';

const STANDARD = 'standard-v1';
const MATCH_SOURCES = Object.freeze(['program-recommended', 'user-selected', 'inherited', 'compatibility']);
const CONFIDENCE = Object.freeze(['high', 'medium', 'low']);
const MATCH_REASON_CODES = Object.freeze(['CLEAR_DIRECTION', 'NO_DIRECTION_SIGNAL', 'WEAK_DIRECTION_SIGNAL', 'AMBIGUOUS_DIRECTION_SIGNAL']);

// 只消费主题意图和受控配置，不让 AI 直接决定模板 ID。
const RULES = Object.freeze([
  {
    id: 'neon-v1', label: '终端 / 未来感', terms: [
      ['neon', 5], ['terminal', 5], ['futuristic', 4], ['future', 3], ['grid', 3], ['mono', 3],
      ['代码', 3], ['开发者', 3], ['终端', 5], ['未来', 4], ['网格', 3], ['霓虹', 5], ['技术', 2],
    ],
  },
  {
    id: 'brutalist-v1', label: '高冲击 / 硬边界', terms: [
      ['bold', 3], ['hard', 4], ['high-impact', 5], ['impact', 4], ['brutal', 5], ['poster', 3],
      ['高冲击', 5], ['硬边框', 5], ['野兽', 5], ['海报', 3], ['强对比', 3], ['黑白', 2], ['醒目', 3],
    ],
  },
  {
    id: 'editorial-v1', label: '纸张 / 编辑感', terms: [
      ['paper', 4], ['editorial', 5], ['print', 4], ['serif', 4], ['journal', 3], ['纸张', 4],
      ['编辑', 5], ['印刷', 4], ['衬线', 4], ['纸艺', 4], ['来源账页', 3], ['杂志', 3],
    ],
  },
  {
    id: 'clean-v1', label: '清爽 / 工具卡', terms: [
      ['clean', 4], ['soft', 3], ['restrained', 3], ['tool-card', 5], ['minimal', 3], ['light', 2],
      ['清爽', 4], ['柔和', 3], ['克制', 3], ['工具卡', 5], ['低装饰', 3], ['轻量', 2],
    ],
  },
]);

function text(value) {
  if (Array.isArray(value)) return value.map(text).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(text).join(' ');
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function addSignal(scores, signals, rule, signal, weight) {
  scores[rule.id] = (scores[rule.id] || 0) + weight;
  if (!signals[rule.id]) signals[rule.id] = [];
  if (!signals[rule.id].includes(signal)) signals[rule.id].push(signal);
}

function scoreText(value, scores, signals) {
  const haystack = text(value);
  for (const rule of RULES) {
    for (const [term, weight] of rule.terms) if (haystack.includes(term)) addSignal(scores, signals, rule, term, weight);
  }
}

function scoreControlledFields(definition, preferences, designSummary, scores, signals) {
  const social = definition?.social || {};
  const tokens = definition?.tokens || {};
  const typography = tokens.typography || {};
  const shape = tokens.shape || {};
  const effects = social.effects || {};
  const recipes = social.recipes || {};

  scoreText([definition?.label, definition?.description, definition?.tags, preferences?.scene, preferences?.tone], scores, signals);
  scoreText(designSummary || definition?.designSummary, scores, signals);
  scoreText(recipes, scores, signals);

  if (typography.family === 'mono' || typography.headingFamily === 'mono') addSignal(scores, signals, RULES[0], 'mono', 3);
  if (typography.headingFamily === 'serif') addSignal(scores, signals, RULES[2], 'serif', 4);
  if (effects.texture === 'grid' || effects.texture === 'scanlines') addSignal(scores, signals, RULES[0], effects.texture, 3);
  if (effects.texture === 'paper-grain') addSignal(scores, signals, RULES[2], 'paper-grain', 4);
  if (shape.radiusPx === 0 || shape.shadow === 'hard') addSignal(scores, signals, RULES[1], 'hard-edge', 4);
  if (shape.shadow === 'soft' || Number(shape.radiusPx) >= 14) addSignal(scores, signals, RULES[3], 'soft-surface', 2);

  if (preferences?.readingPriority === 'impact') addSignal(scores, signals, RULES[1], 'impact-priority', 3);
  if (preferences?.readingPriority === 'density') addSignal(scores, signals, RULES[0], 'density-priority', 2);
  if (preferences?.brightness === 'dark' && (typography.family === 'mono' || effects.texture === 'grid')) addSignal(scores, signals, RULES[0], 'dark-terminal', 2);
  if (preferences?.brightness === 'light' && shape.shadow === 'soft') addSignal(scores, signals, RULES[3], 'light-soft', 2);
}

function confidenceFor(score, margin) {
  if (score >= 8 && margin >= 3) return 'high';
  if (score >= 4 && margin >= 2) return 'medium';
  return 'low';
}

export function matchSocialTemplate({ definition = null, preferences = null, designSummary = null } = {}) {
  const scores = Object.fromEntries(RULES.map((rule) => [rule.id, 0]));
  const signals = {};
  scoreControlledFields(definition, preferences, designSummary, scores, signals);
  const ranked = RULES.map((rule) => ({ id: rule.id, label: rule.label, score: scores[rule.id] || 0, signals: signals[rule.id] || [] }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const winner = ranked[0];
  const runnerUp = ranked[1];
  const runnerUpScore = runnerUp?.score || 0;
  const margin = (winner?.score || 0) - runnerUpScore;
  const explicitDirection = Boolean(winner && winner.score >= 4 && (margin >= 2 || winner.score >= 8));
  const packId = explicitDirection ? winner.id : STANDARD;
  const pack = getSocialCardTemplatePack(packId);
  const confidence = explicitDirection ? confidenceFor(winner.score, margin) : 'low';
  const reasonCode = explicitDirection
    ? 'CLEAR_DIRECTION'
    : winner.score === 0
      ? 'NO_DIRECTION_SIGNAL'
      : winner.score < 4
        ? 'WEAK_DIRECTION_SIGNAL'
        : 'AMBIGUOUS_DIRECTION_SIGNAL';
  const source = packId === STANDARD ? 'compatibility' : 'program-recommended';
  const reason = packId === STANDARD
    ? '未识别到足够明确的 Social 视觉方向，使用标准兼容模板，待用户确认。'
    : `根据${winner.label}信号匹配 ${pack.label}：${winner.signals.slice(0, 4).join('、')}。`;
  return Object.freeze({
    templatePack: { id: pack.id, version: pack.version },
    source,
    confidence,
    reasonCode,
    score: winner?.score || 0,
    runnerUpScore,
    margin,
    reason,
    signals: winner?.signals?.slice(0, 8) || [],
    scores: Object.fromEntries(ranked.map((item) => [item.id, item.score])),
  });
}

export function templateMatchMetadata(match, { source = match?.source } = {}) {
  const resolvedSource = MATCH_SOURCES.includes(source) ? source : 'compatibility';
  const confidence = CONFIDENCE.includes(match?.confidence) ? match.confidence : 'low';
  return {
    schemaVersion: 1,
    packId: String(match?.templatePack?.id || STANDARD),
    source: resolvedSource,
    confidence,
    reasonCode: MATCH_REASON_CODES.includes(match?.reasonCode) ? match.reasonCode : 'NO_DIRECTION_SIGNAL',
    score: Number.isFinite(match?.score) ? Math.max(0, Math.round(match.score)) : 0,
    runnerUpScore: Number.isFinite(match?.runnerUpScore) ? Math.max(0, Math.round(match.runnerUpScore)) : 0,
    margin: Number.isFinite(match?.margin) ? Math.round(match.margin) : 0,
    reason: String(match?.reason || '').slice(0, 240),
    signals: Array.isArray(match?.signals) ? match.signals.map(String).slice(0, 8) : [],
  };
}

export { MATCH_SOURCES, CONFIDENCE, MATCH_REASON_CODES };
