import crypto from 'node:crypto';
import { EVENT_RESOLUTION_POLICY, duplicatePenaltyForHeat } from './event-resolution-policy.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { batchTopicsDir } from '../../../platform/core/workspace-paths.mjs';

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

// 用于判断“同一事件的不同报道”时，排除职位、动作和新闻套话；
// 具体人名、项目名等实体仍会保留，避免把同一事件拆成多个历史 ID。
const CONTINUITY_STOP_TERMS = new Set([
  ...GENERIC_TERMS,
  '苹果', 'ceo', '职位', '交接', '换帅', '上任', '卸任', '接任', '人事', '变动',
  '项目', '产品', '工具', '插件', '版本', '开发', '开源', '用户', '团队', '服务',
]);
const POSITION_TERMS = new Set(['ceo', '总裁', '董事长', '负责人', '经理', '部长', '首席', '掌门']);

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

function distinctiveEntitySet(record) {
  const structural = new Set([
    ...tokens(record?.whoKey),
    ...tokens(record?.objectKey),
    ...tokens(record?.actionType),
  ]);
  return new Set([...setOf(record?.entityKeys)].filter((value) => {
    const token = clean(value);
    return token.length >= 2 && !structural.has(token) && !CONTINUITY_STOP_TERMS.has(token)
      && !/^\d+(?:\.\d+)?$/.test(token);
  }));
}

function isSameEventContinuity(left, right, objectScore, triggerScore) {
  if (!left?.whoKey || left.whoKey !== right?.whoKey) return false;
  if (timeCompatibility(left.timeWindow, right.timeWindow) < 0.5) return false;
  if (!left.actionType || left.actionType !== right.actionType) return false;
  if (objectScore < 0.7) return false;
  const sharedObjectTerms = [...new Set(tokens(left.objectKey))].filter((value) => tokens(right.objectKey).includes(value));
  if (!sharedObjectTerms.some((value) => POSITION_TERMS.has(value))) return false;
  const sharedEntities = [...distinctiveEntitySet(left)].filter((value) => distinctiveEntitySet(right).has(value));
  // 两个以上具体实体通常意味着同一人物/项目链；一个具体实体再加上较强触发词重合，
  // 也可视为同一事件的后续报道。仅主体、职位或动作相同不触发。
  return sharedEntities.length >= 2 || (sharedEntities.length >= 1 && triggerScore >= 0.6);
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
    // eventKey is a semantic hint, not a durable event identity. If both
    // reports carry different month windows, do not let a repeated
    // who|what label merge unrelated later releases automatically.
    if (left.timeWindow && right.timeWindow && timeCompatibility(left.timeWindow, right.timeWindow) === 0) {
      return { score: 55, method: 'new' };
    }
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
  if (isSameEventContinuity(left, right, objectMatch, trigger)) {
    return { score: Math.max(score, EVENT_RESOLUTION_POLICY.autoMergeScore), method: 'structured-continuity' };
  }
  return { score, method: score >= EVENT_RESOLUTION_POLICY.autoMergeScore ? 'structured' : score >= EVENT_RESOLUTION_POLICY.reviewScore ? 'review' : 'new' };
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
    ...(report.entityKeys || []).slice(0, EVENT_RESOLUTION_POLICY.maxEntityKeys).map((value) => `entity:${value}`),
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
    if (best?.score >= EVENT_RESOLUTION_POLICY.autoMergeScore) {
      best.group.records.push(report);
    } else {
      if (best?.score >= EVENT_RESOLUTION_POLICY.reviewScore) reviewQueue.push({ hotspotId: report.hotspotId, candidateHotspotId: best.member.hotspotId,
        candidateScore: best.score, method: 'structured-review', reason: '结构化相似但未达到自动归并阈值' });
      const group = { records: [report] };
      groups.push(group);
      register(group, report);
    }
    if (best?.score >= EVENT_RESOLUTION_POLICY.autoMergeScore) register(best.group, report);
  }
  return { groups, reviewQueue };
}

function mergeResolvedEventsById(events, { splitConflictingHistory = false } = {}) {
  const merged = new Map();
  const collisions = [];
  for (const [index, event] of events.entries()) {
    const current = merged.get(event.event_id);
    if (!current) {
      merged.set(event.event_id, { ...event, hotspot_ids: [...new Set(event.hotspot_ids || [])], legacy_event_ids: [...new Set(event.legacy_event_ids || [])], new_information_hotspot_ids: [...new Set(event.new_information_hotspot_ids || [])] });
      continue;
    }
    if (splitConflictingHistory && structuredMatch(current.normalized || {}, event.normalized || {}).score < EVENT_RESOLUTION_POLICY.autoMergeScore) {
      const detachedId = makeEventId(`${event.canonical_key || event.event_id}|collision:${index}`);
      const detached = { ...event, event_id: detachedId, historical_match: null, update_type: 'new_event', event_state: 'new_event', new_information_hotspot_ids: [...new Set(event.hotspot_ids || [])] };
      merged.set(detachedId, detached);
      collisions.push({ event_id: event.event_id, action: 'split_conflicting_history', reassigned_event_id: detachedId, hotspot_ids: event.hotspot_ids || [] });
      continue;
    }
    collisions.push({ event_id: event.event_id, hotspot_ids: event.hotspot_ids || [], merged_into_hotspot_ids: current.hotspot_ids || [] });
    const normalized = aggregate([current.normalized || {}, event.normalized || {}]);
    current.normalized = normalized;
    current.canonical_key = canonicalKey(normalized);
    current.title = buildEventTitle(normalized);
    current.hotspot_ids = [...new Set([...(current.hotspot_ids || []), ...(event.hotspot_ids || [])])];
    current.legacy_event_ids = [...new Set([...(current.legacy_event_ids || []), ...(event.legacy_event_ids || [])])];
    current.new_information_hotspot_ids = [...new Set([...(current.new_information_hotspot_ids || []), ...(event.new_information_hotspot_ids || [])])];
    current.first_seen_at = [current.first_seen_at, event.first_seen_at].filter(Boolean).sort()[0] || null;
    current.last_seen_at = [current.last_seen_at, event.last_seen_at].filter(Boolean).sort().at(-1) || null;
    if (event.update_type === 'new_update' || current.update_type === 'new_update') current.update_type = 'new_update';
    if (event.event_state === 'new_update' || current.event_state === 'new_update') current.event_state = 'new_update';
    if ((event.historical_match?.score || 0) > (current.historical_match?.score || 0)) current.historical_match = event.historical_match;
  }
  return { events: [...merged.values()], collisions };
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
    for (const entity of (normalized.entityKeys || []).slice(0, EVENT_RESOLUTION_POLICY.maxEntityKeys)) add(`entity:${entity}`, event);
  }
  return index;
}

function historyCandidates(normalized, history, index) {
  const keys = [
    normalized.eventKey ? `event:${normalized.eventKey}` : '',
    normalized.whoKey ? `who:${normalized.whoKey}` : '',
    normalized.objectKey ? `object:${normalized.objectKey}` : '',
    ...(normalized.entityKeys || []).slice(0, EVENT_RESOLUTION_POLICY.maxEntityKeys).map((value) => `entity:${value}`),
  ].filter(Boolean);
  const candidates = new Set(keys.flatMap((key) => [...(index.get(key) || [])]));
  if (candidates.size) return [...candidates].slice(0, EVENT_RESOLUTION_POLICY.maxHistoryCandidates);
  return (history || []).slice(0, EVENT_RESOLUTION_POLICY.maxHistoryCandidates);
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
  const resolvedEvents = groups.map((group) => {
    const normalized = aggregate(group.records);
    const canonical = canonicalKey(normalized);
    let historicalMatch = null;
    for (const candidate of historyCandidates(normalized, history, historyIndex)) {
      const match = structuredMatch(normalized, candidate.normalized || candidate);
      if (!historicalMatch || match.score > historicalMatch.score) historicalMatch = { ...match, candidate };
    }
    const attachHistory = historicalMatch?.score >= EVENT_RESOLUTION_POLICY.autoMergeScore;
    const eventId = attachHistory ? historicalMatch.candidate.event_id : makeEventId(canonical);
    const hotspotIds = group.records.map((record) => record.hotspotId);
    const legacyEventIds = [...new Set(hotspotIds.map((id) => legacyByHotspot.get(id)).filter(Boolean))];
    const previous = attachHistory ? (historicalMatch.candidate.normalized || historicalMatch.candidate) : null;
    const semanticUpdate = Boolean(previous && (
      normalized.triggerKey !== previous.triggerKey
      || normalized.actionType !== previous.actionType
      || normalized.objectKey !== previous.objectKey
      || normalized.topicLabel !== previous.topicLabel
    ));
    const previousLastSeen = Date.parse(historicalMatch?.candidate?.last_seen_at || '');
    const hasLaterReport = group.records.some((record) => {
      const timestamp = Date.parse(record.publishedAt || '');
      return Number.isFinite(timestamp) && (!Number.isFinite(previousLastSeen) || timestamp > previousLastSeen);
    });
    const update_type = !attachHistory
      ? 'new_event'
      : (semanticUpdate ? 'new_fact' : (hasLaterReport ? 'new_source' : 'duplicate'));
    const event_state = !attachHistory ? 'new_event' : (semanticUpdate ? 'new_update' : 'continuing');
    const newInformationHotspotIds = !attachHistory
      ? hotspotIds
      : (semanticUpdate ? group.records.filter((record) => {
        const timestamp = Date.parse(record.publishedAt || '');
        return !Number.isFinite(previousLastSeen) || (Number.isFinite(timestamp) && timestamp > previousLastSeen);
      }).map((record) => record.hotspotId) : []);
    return {
      event_id: eventId,
      title: buildEventTitle(normalized),
      canonical_key: canonical,
      normalized,
      hotspot_ids: hotspotIds,
      legacy_event_ids: legacyEventIds,
      update_type,
      event_state,
      new_information_hotspot_ids: newInformationHotspotIds,
      historical_match: attachHistory ? { event_id: historicalMatch.candidate.event_id, score: historicalMatch.score, method: historicalMatch.method } : null,
      first_seen_at: group.records.map((record) => record.publishedAt).filter(Boolean).sort()[0] || null,
      last_seen_at: group.records.map((record) => record.publishedAt).filter(Boolean).sort().at(-1) || null,
    };
  });

  const { events, collisions: historicalCollisions } = mergeResolvedEventsById(resolvedEvents, { splitConflictingHistory: true });
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
    differences: { merges, splits, review_queue: reviewQueue, historical_collisions: historicalCollisions },
    events,
  };
}

function parseRaw(hotspot) {
  try { return JSON.parse(hotspot?.raw_json || '{}'); } catch { return {}; }
}

function sourceOf(article) { return article.source || article.channel || '未知来源'; }

function repositoryMetaOfHotspot(hotspot) {
  const raw = parseRaw(hotspot);
  const isRepository = hotspot?.source_group === 'github'
    || hotspot?.source === 'github'
    || /^https:\/\/github\.com\//i.test(String(hotspot?.url || ''));
  if (!isRepository) return null;
  return {
    repository: raw.repository || hotspot.title || '',
    description: raw.description || '',
    language: raw.language || '',
    stars: Number.isFinite(Number(raw.stars)) ? Number(raw.stars) : null,
    topics: Array.isArray(raw.topics) ? raw.topics : [],
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
    discoveryChannels: Array.isArray(raw.discoveryChannels) ? raw.discoveryChannels : [],
    primaryDiscovery: raw.primaryDiscovery || hotspot.source_type || '',
    trendingPeriods: Array.isArray(raw.periods) ? raw.periods : raw.period ? [raw.period] : [],
    mentionedBy: Array.isArray(raw.mentionedBy) ? raw.mentionedBy : [],
  };
}

// 将稳定事件直接装配为研究用事件对象。它不读取 legacy cluster，旧结构只在迁移工具中保留。
export function materializeStableEvents({ shadowEvents = [], hotspots = [], heatByEvent = new Map() } = {}) {
  const hotspotById = new Map(hotspots.map((hotspot) => [Number(hotspot.id), hotspot]));
  return mergeResolvedEventsById(shadowEvents).events.map((stableEvent) => {
    const members = (stableEvent.hotspot_ids || []).map((hotspotId) => {
      const hotspot = hotspotById.get(Number(hotspotId));
      if (!hotspot) return null;
      const raw = parseRaw(hotspot); const tags = raw.aiTags || {};
      const repositoryMeta = repositoryMetaOfHotspot(hotspot);
      return { category_id: `G${String(hotspotId).padStart(5, '0')}`, hotspot_id: Number(hotspotId), title: hotspot.title,
        source: hotspot.source_name || hotspot.source_group || hotspot.source || '未知来源', channel: hotspot.source || '', url: hotspot.url || null,
        heat: hotspot.score ?? null, time: hotspot.published_at || hotspot.created_at || null, risk_level: tags.riskLevel || '待评估', summary: raw.summary || '', keywords: tags.keywords || [],
        ...(repositoryMeta ? { repositoryMeta } : {}) };
    }).filter(Boolean);
    const lead = members[0] || {}; const leadHotspot = hotspotById.get(Number(lead.hotspot_id));
    const leadTags = leadHotspot ? parseRaw(leadHotspot).aiTags || {} : {};
    const normalized = stableEvent.normalized || {}; const heat = heatByEvent.get(stableEvent.event_id) || {};
    const eventParts = { ...(leadTags.eventParts || {}), who: normalized.whoKey || leadTags.eventParts?.who || '', what: normalized.triggerKey || leadTags.eventParts?.what || stableEvent.title,
      object: normalized.objectKey || leadTags.eventParts?.object || '', actionType: normalized.actionType || leadTags.eventParts?.actionType || '其他' };
    const tags = { ...leadTags, eventKey: normalized.eventKey || leadTags.eventKey || '', eventParts };
    const sourceSet = new Set(members.map(sourceOf).filter(Boolean));
    const latest = members.map((article) => article.time).filter(Boolean).sort().at(-1) || stableEvent.last_seen_at || null;
    const repositoryMeta = members.find((article) => article.repositoryMeta)?.repositoryMeta || null;
    return { event_id: stableEvent.event_id, stable_event_id: stableEvent.event_id, representative_title: stableEvent.title || '未命名事件',
      representativeHotspotId: Number(lead.hotspot_id) || null, market_scope: leadHotspot?.market_scope || '待标注',
      china_relevance_score: Number(heat.chinaRelevanceScore ?? leadTags.chinaRelevance ?? 0), china_relevance_reason: leadTags.relevanceReason || '', global_exception: Boolean(leadTags.globalException),
      topic_category: leadHotspot?.category || '📰 综合资讯', keywords: [...new Set(members.flatMap((article) => article.keywords || []).concat(leadTags.keywords || []))].slice(0, 12),
      source_count: sourceSet.size, report_count: members.length, peak_source_percentile: null, latest_time: latest, cluster_confidence: members.length > 1 ? 'medium' : 'low',
      articles: members, tags, repositoryMeta, eventHeatScore: heat.heatScore ?? null, eventValue: heat.eventValue ?? heat.heatScore ?? null, t: heat.t ?? heat.eventValue ?? heat.heatScore ?? null,
      eventHeatRank: heat.rank ?? null, eventHeatState: heat.state || null, eventHistoryRepeatDays: Number(heat.repeatDays || 0), duplicatePenalty: duplicatePenaltyForHeat({ state: heat.state, repeatDays: heat.repeatDays }), card: null,
      hotspot_ids: stableEvent.hotspot_ids || [], normalized: stableEvent.normalized || {}, legacy_event_ids: stableEvent.legacy_event_ids || [],
      classification: stableEvent.classification || null };
  });
}
