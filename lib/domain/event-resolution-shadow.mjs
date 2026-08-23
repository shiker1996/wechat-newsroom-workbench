import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { batchTopicsDir } from '../core/workspace-paths.mjs';

const ACTION_COMPATIBILITY = new Map([
  ['发布', new Set(['发布', '更新', '开源'])],
  ['更新', new Set(['发布', '更新', '开源'])],
  ['开源', new Set(['发布', '更新', '开源'])],
  ['争议回应', new Set(['争议回应', '评论', '质疑', '后续', '复述'])],
  ['评论', new Set(['争议回应', '评论', '质疑', '后续', '复述'])],
  ['质疑', new Set(['争议回应', '评论', '质疑', '后续', '复述'])],
  ['后续', new Set(['争议回应', '评论', '质疑', '后续', '复述'])],
  ['复述', new Set(['争议回应', '评论', '质疑', '后续', '复述'])],
]);

const ALIASES = new Map([
  ['moonshot ai', '月之暗面'], ['moonshot', '月之暗面'],
  ['anthropic ai', 'anthropic'], ['open ai', 'openai'],
  ['apipricing', 'api计费'], ['api billing', 'api计费'],
  ['chat gpt', 'chatgpt'], ['gpt 5', 'gpt5'],
]);

const GENERIC_TERMS = new Set([
  '发布', '宣布', '回应', '评论', '质疑', '后续', '复述', '引发', '争议', '相关', '消息',
  '最新', '今日', '近日', '动态', '事件', '新闻', '观点', '文章', '表示', '称', '认为',
  '背后', '到底', '为何', '什么', '谁在', '能不能', '教授', '公司', '平台', '集团',
]);

function clean(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase()
    .replace(/[“”‘’"'`]/g, '')
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[，。！？、；：（）()【】\[\]《》<>「」]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function alias(value) {
  const normalized = clean(value);
  return ALIASES.get(normalized) || normalized;
}

function normalizeObject(value) {
  const normalized = alias(value);
  return normalized.replace(/(?:策略|规则|方案|机制)$/u, '') || normalized;
}

function tokens(value) {
  const normalized = clean(value);
  if (!normalized) return [];
  const result = new Set();
  for (const token of normalized.match(/[a-z0-9][a-z0-9._-]*/g) || []) {
    if (!GENERIC_TERMS.has(token)) result.add(token);
  }
  for (const block of normalized.match(/[\u4e00-\u9fff]+/g) || []) {
    if (block.length <= 4 && !GENERIC_TERMS.has(block)) result.add(block);
    for (let index = 0; index < block.length - 1; index += 1) {
      const gram = block.slice(index, index + 2);
      if (!GENERIC_TERMS.has(gram)) result.add(gram);
    }
  }
  return [...result];
}

function meaningfulPhrase(value) {
  return tokens(value).filter((token) => token.length > 1).sort().join('|');
}

function parseEventKey(value) {
  const parts = String(value || '').split('|');
  return { who: parts.shift() || '', what: parts.join('|') };
}

function timeWindow(item, parts) {
  const supplied = parts.when || parts.timeWindow || item.when || '';
  const fromSupplied = String(supplied).match(/\d{4}-\d{1,2}(?:-\d{1,2})?/);
  if (fromSupplied) return fromSupplied[0].replace(/-(\d)$/, '-0$1');
  const parsed = Date.parse(item.published_at || item.created_at || '');
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toISOString().slice(0, 7);
}

export function normalizedReport(item) {
  let raw = {};
  try { raw = JSON.parse(item.raw_json || '{}'); } catch {}
  const tags = raw.aiTags || {};
  const parts = tags.eventParts || {};
  const key = parseEventKey(tags.eventKey);
  const whoKey = alias(parts.who || key.who);
  const what = parts.what || key.what || item.title || '';
  const objectKey = normalizeObject(parts.object || meaningfulPhrase(what));
  const triggerKey = meaningfulPhrase(what) || meaningfulPhrase(item.title);
  const objectLabel = String(parts.object || '').trim().replace(/(?:策略|规则|方案|机制)$/u, '').trim();
  const topicLabel = String(parts.what || '').trim();
  const description = String(tags.eventDescription || tags.relevanceReason || raw.summary || '').trim();
  const titleTokens = tokens(`${item.title || ''} ${raw.summary || ''} ${(tags.keywords || []).join(' ')}`);
  const entityKeys = [...new Set([whoKey, objectKey, ...titleTokens].filter(Boolean))];
  const actionType = clean(parts.actionType || tags.actionType || '其他') || '其他';
  return {
    hotspotId: Number(item.id),
    title: String(item.title || ''),
    whoKey,
    objectKey,
    objectLabel,
    triggerKey,
    topicLabel,
    description,
    actionType,
    timeWindow: timeWindow(item, parts),
    entityKeys,
    keywords: Array.isArray(tags.keywords) ? tags.keywords.map(clean).filter(Boolean) : [],
    eventKey: clean(tags.eventKey),
    publishedAt: item.published_at || item.created_at || null,
  };
}

function setOf(value) {
  return new Set(Array.isArray(value) ? value.filter(Boolean) : tokens(value));
}

function overlap(left, right) {
  const a = setOf(left); const b = setOf(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / Math.max(a.size, b.size);
}

function fieldMatch(left, right) {
  if (!left || !right) return 0.5;
  if (left === right) return 1;
  const ratio = overlap(left, right);
  if (ratio >= 0.4) return 0.7;
  return 0;
}

function triggerMatch(left, right) {
  if (!left || !right) return 0.25;
  if (left === right) return 1;
  const ratio = overlap(left, right);
  if (ratio >= 0.6) return 0.8;
  if (ratio >= 0.25) return 0.6;
  return 0;
}

function actionCompatibility(left, right) {
  if (!left || !right || left === '其他' || right === '其他') return 0.5;
  if (left === right) return 1;
  if (ACTION_COMPATIBILITY.get(left)?.has(right) || ACTION_COMPATIBILITY.get(right)?.has(left)) return 0.6;
  return 0;
}

function timeCompatibility(left, right) {
  if (!left || !right) return 0.5;
  if (left === right) return 1;
  const leftDate = Date.parse(`${left}-01`); const rightDate = Date.parse(`${right}-01`);
  if (!Number.isFinite(leftDate) || !Number.isFinite(rightDate)) return 0.5;
  const months = Math.abs((leftDate - rightDate) / (1000 * 60 * 60 * 24 * 30.4375));
  if (months <= 1.1) return 0.5;
  return 0;
}

export function structuredMatch(left, right) {
  if (left.eventKey && right.eventKey && left.eventKey === right.eventKey) {
    return { score: 100, method: 'exact' };
  }
  const whoMatch = left.whoKey && right.whoKey && left.whoKey === right.whoKey ? 1 : 0;
  const objectMatch = fieldMatch(left.objectKey, right.objectKey);
  const entity = overlap(left.entityKeys, right.entityKeys);
  let trigger = triggerMatch(left.triggerKey, right.triggerKey);
  const action = actionCompatibility(left.actionType, right.actionType);
  const time = timeCompatibility(left.timeWindow, right.timeWindow);
  // 标题修辞差异很大时，如果主体、对象、时间和事实实体高度一致，
  // 允许进入自动合并区间；这正是“称福利”与“谁缴社保”这类同一争议的情况。
  if (trigger === 0 && objectMatch === 1 && entity >= 0.3) trigger = 0.6;
  // 同主体、同对象、同一时间窗口的报道即使标题事实词被摘要噪声冲散，
  // 仍视为同一事件候选；后续增量状态再区分“新进展”和“持续讨论”。
  if (trigger === 0 && whoMatch === 1 && objectMatch === 1 && time >= 0.5) trigger = 0.8;
  const score = Math.round(30 * whoMatch + 25 * objectMatch + 20 * trigger + 10 * action + 10 * time + 5 * entity);
  return { score, method: score >= 82 ? 'structured' : score >= 65 ? 'review' : 'new' };
}

function stableValue(records, field) {
  const counts = new Map();
  for (const record of records) {
    const value = String(record[field] || '').trim();
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
}

function aggregate(records) {
  const entityKeys = [...new Set(records.flatMap((record) => record.entityKeys || []))];
  return {
    whoKey: stableValue(records, 'whoKey'),
    objectKey: stableValue(records, 'objectKey'),
    objectLabel: stableValue(records, 'objectLabel'),
    triggerKey: stableValue(records, 'triggerKey'),
    topicLabel: stableValue(records, 'topicLabel'),
    description: stableValue(records, 'description'),
    actionType: stableValue(records, 'actionType') || '其他',
    timeWindow: stableValue(records, 'timeWindow'),
    entityKeys,
    eventKey: stableValue(records, 'eventKey'),
  };
}

const ACTION_TITLE_LABELS = new Map([
  ['发布', '发布'], ['更新', '更新'], ['开源', '开源'], ['回应', '回应'], ['争议回应', '回应'],
  ['评论', '评论'], ['质疑', '质疑'], ['收购', '收购'], ['融资', '融资'], ['裁员', '裁员'],
]);

const DISPLAY_LABELS = new Map([
  ['openai', 'OpenAI'], ['anthropic', 'Anthropic'], ['deepseek', 'DeepSeek'], ['chatgpt', 'ChatGPT'], ['gpt5', 'GPT-5'], ['codex', 'Codex'], ['a16z', 'a16z'], ['aiagent', 'AI Agent'],
  ['api计费', 'API 计费'], ['api billing', 'API 计费'],
]);

function displayLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return DISPLAY_LABELS.get(text.toLowerCase()) || text;
}

function trimDescription(value) {
  return String(value || '').replace(/^\s+|\s+$/g, '').replace(/[。！？；，,、]+$/u, '').slice(0, 42);
}

/** Create a stable event-semantic title; source headlines are intentionally excluded. */
export function buildEventTitle(record = {}) {
  const who = displayLabel(record.whoLabel || record.whoKey);
  const structuredTopic = record.objectLabel || record.topicLabel;
  const compactKey = String(record.objectKey || record.triggerKey || '').split('|').filter(Boolean);
  const keyTopic = compactKey.length <= 3 ? compactKey.join('、') : '';
  const topic = displayLabel(structuredTopic || keyTopic);
  const action = ACTION_TITLE_LABELS.get(String(record.actionType || '').trim());
  if (who && topic && action) return `${who}${action}${topic}`;
  if (who && topic) return `${who}：${topic}`;
  if (topic && action) return `${action}${topic}`;
  if (topic) return topic;
  const description = trimDescription(record.description);
  if (who && description) return `${who}：${description}`;
  if (description) return description;
  return who ? `${who}相关事件` : '未识别主体的相关事件';
}

function makeEventId(canonicalKey) {
  return `S${crypto.createHash('sha1').update(canonicalKey).digest('hex').slice(0, 10).toUpperCase()}`;
}

function canonicalKey(record) {
  return [record.whoKey || 'unknown', record.objectKey || 'unknown', record.triggerKey || 'unknown'].join('|');
}

function buildLegacyMap(legacyClusters = []) {
  const map = new Map();
  for (const cluster of legacyClusters) {
    for (const article of cluster.articles || []) map.set(Number(article.hotspot_id), cluster.event_id);
  }
  return map;
}

function buildGroups(reports) {
  const groups = [];
  const reviewQueue = [];
  const index = new Map();
  const keysOf = (report) => [...new Set([
    report.eventKey ? `event:${report.eventKey}` : '',
    report.whoKey ? `who:${report.whoKey}` : '',
    report.objectKey ? `object:${report.objectKey}` : '',
    ...(report.entityKeys || []).slice(0, 24).map((value) => `entity:${value}`),
  ].filter(Boolean))];
  const register = (group, report) => {
    for (const key of keysOf(report)) {
      if (!index.has(key)) index.set(key, new Set());
      index.get(key).add(group);
    }
  };
  for (const report of reports) {
    let best = null;
    const candidateGroups = new Set(keysOf(report).flatMap((key) => [...(index.get(key) || [])]));
    for (const group of candidateGroups) {
      const candidate = group.records.reduce((winner, member) => {
        const match = structuredMatch(report, member);
        return !winner || match.score > winner.score ? { ...match, member } : winner;
      }, null);
      if (!best || candidate.score > best.score) best = { ...candidate, group };
    }
    if (best?.score >= 82) {
      best.group.records.push(report);
    } else {
      if (best?.score >= 65) reviewQueue.push({ hotspotId: report.hotspotId, candidateHotspotId: best.member.hotspotId,
        candidateScore: best.score, method: 'structured-review', reason: '结构化相似但未达到自动归并阈值' });
      const group = { records: [report] };
      groups.push(group);
      register(group, report);
    }
    if (best?.score >= 82) register(best.group, report);
  }
  return { groups, reviewQueue };
}

function buildHistoryIndex(history) {
  const index = new Map();
  const add = (key, event) => {
    if (!key) return;
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(event);
  };
  for (const event of history || []) {
    const normalized = event.normalized || event;
    add(normalized.eventKey ? `event:${normalized.eventKey}` : '', event);
    add(normalized.whoKey ? `who:${normalized.whoKey}` : '', event);
    add(normalized.objectKey ? `object:${normalized.objectKey}` : '', event);
    for (const entity of (normalized.entityKeys || []).slice(0, 24)) add(`entity:${entity}`, event);
  }
  return index;
}

function historyCandidates(normalized, history, index) {
  const keys = [
    normalized.eventKey ? `event:${normalized.eventKey}` : '',
    normalized.whoKey ? `who:${normalized.whoKey}` : '',
    normalized.objectKey ? `object:${normalized.objectKey}` : '',
    ...(normalized.entityKeys || []).slice(0, 24).map((value) => `entity:${value}`),
  ].filter(Boolean);
  const candidates = new Set(keys.flatMap((key) => [...(index.get(key) || [])]));
  if (candidates.size) return [...candidates].slice(0, 50);
  return (history || []).slice(0, 50);
}

function readJson(filePath) {
  try { if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
  return null;
}

export function loadShadowHistory({ store, workspaceRoot, currentBatchId, limit = 30 } = {}) {
  const batches = store?.listBatches?.(limit) || [];
  const events = new Map();
  for (const batch of batches) {
    if (!batch?.id || batch.id === currentBatchId) continue;
    const file = path.join(batchTopicsDir(workspaceRoot, batch), 'sources', 'event-resolution-shadow.json');
    const payload = readJson(file);
    for (const event of payload?.events || []) {
      if (!event.event_id || events.has(event.event_id)) continue;
      events.set(event.event_id, { ...event, historyBatchId: batch.id });
    }
  }
  return [...events.values()];
}

export function resolveEventShadow({ batch, hotspots = [], legacyClusters = [], history = [] } = {}) {
  const reports = hotspots.map(normalizedReport).filter((report) => report.hotspotId);
  const { groups, reviewQueue } = buildGroups(reports);
  const legacyByHotspot = buildLegacyMap(legacyClusters);
  const historyIndex = buildHistoryIndex(history);
  const events = groups.map((group) => {
    const normalized = aggregate(group.records);
    const canonical = canonicalKey(normalized);
    let historicalMatch = null;
    for (const candidate of historyCandidates(normalized, history, historyIndex)) {
      const match = structuredMatch(normalized, candidate.normalized || candidate);
      if (!historicalMatch || match.score > historicalMatch.score) historicalMatch = { ...match, candidate };
    }
    const attachHistory = historicalMatch?.score >= 82;
    const eventId = attachHistory ? historicalMatch.candidate.event_id : makeEventId(canonical);
    const hotspotIds = group.records.map((record) => record.hotspotId);
    const legacyEventIds = [...new Set(hotspotIds.map((id) => legacyByHotspot.get(id)).filter(Boolean))];
    return {
      event_id: eventId,
      title: buildEventTitle(normalized),
      canonical_key: canonical,
      normalized,
      hotspot_ids: hotspotIds,
      legacy_event_ids: legacyEventIds,
      historical_match: attachHistory ? { event_id: historicalMatch.candidate.event_id, score: historicalMatch.score, method: historicalMatch.method } : null,
      first_seen_at: group.records.map((record) => record.publishedAt).filter(Boolean).sort()[0] || null,
      last_seen_at: group.records.map((record) => record.publishedAt).filter(Boolean).sort().at(-1) || null,
    };
  });

  const shadowByHotspot = new Map(events.flatMap((event) => event.hotspot_ids.map((id) => [id, event.event_id])));
  const merges = events.filter((event) => event.legacy_event_ids.length > 1).map((event) => ({
    event_id: event.event_id, legacy_event_ids: event.legacy_event_ids, hotspot_ids: event.hotspot_ids,
  }));
  const splits = [];
  const legacyToShadow = new Map();
  for (const [hotspotId, legacyId] of legacyByHotspot) {
    const shadowId = shadowByHotspot.get(hotspotId);
    if (!shadowId) continue;
    if (!legacyToShadow.has(legacyId)) legacyToShadow.set(legacyId, new Set());
    legacyToShadow.get(legacyId).add(shadowId);
  }
  for (const [legacyEventId, shadowIds] of legacyToShadow) {
    if (shadowIds.size > 1) splits.push({ legacy_event_id: legacyEventId, shadow_event_ids: [...shadowIds] });
  }

  return {
    schema_version: 1,
    resolver_version: 'shadow-v1',
    algorithm_version: 'structured-v1',
    mode: 'shadow',
    generated_at: new Date().toISOString(),
    batch_id: batch?.id || null,
    batch_date: batch?.batch_date || null,
    input_count: reports.length,
    history_event_count: history.length,
    legacy: { event_count: legacyClusters.length, hotspot_count: legacyByHotspot.size },
    shadow: { event_count: events.length, hotspot_count: shadowByHotspot.size },
    conservation: { input_count: reports.length, assigned_count: shadowByHotspot.size, ok: reports.length === shadowByHotspot.size },
    differences: { merges, splits, review_queue: reviewQueue },
    events,
  };
}
