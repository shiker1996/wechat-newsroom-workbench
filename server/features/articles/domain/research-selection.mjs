import { normalizeResearchPoints } from '../../../shared/domain/research-selection.mjs';

export { normalizeResearchPoints } from '../../../shared/domain/research-selection.mjs';

function parseValue(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return [];
  try { return JSON.parse(text); } catch { return text; }
}

function text(value) { return String(value ?? '').trim(); }

function pointText(point) {
  return text(point?.statement || point?.question || point?.relationship_statement || point?.label);
}

function keyFor(point) {
  const pointId = text(point?.point_id || point?.id);
  if (pointId) return `id:${pointId}`;
  return [text(point?.scope), text(point?.kind), pointText(point).replace(/\s+/g, ' ')].join('|').toLowerCase();
}

function normalizePoint(point) {
  if (typeof point === 'string') {
    const statement = text(point);
    return statement ? { statement } : null;
  }
  if (!point || typeof point !== 'object' || Array.isArray(point)) return null;
  const statement = pointText(point);
  if (!statement) return null;
  const normalized = {
    point_id: text(point.point_id || point.id),
    scope: text(point.scope || 'internal'),
    kind: text(point.kind),
    label: text(point.label),
    statement,
    expected: text(point.expected),
    observed: text(point.observed),
    gap: text(point.gap),
    baseline: text(point.baseline || point.expected_or_baseline),
    impact: text(point.impact || point.reader_impact),
    why_it_matters: text(point.why_it_matters || point.interpretation),
    issue: text(point.issue),
    difference: text(point.difference || point.difference_or_conflict),
    parties: Array.isArray(point.parties) ? point.parties.map(text).filter(Boolean) : [],
    supporting_facts: Array.isArray(point.supporting_facts || point.confirmed_facts) ? (point.supporting_facts || point.confirmed_facts).map(text).filter(Boolean) : [],
    evidence_boundary: point.evidence_boundary && typeof point.evidence_boundary === 'object' ? point.evidence_boundary : text(point.evidence_boundary),
    comparison_basis: Array.isArray(point.comparison_basis) ? point.comparison_basis : [],
    refutes: text(point.refutes),
    confidence: text(point.confidence),
    question: text(point.question),
    event_id: text(point.event_id),
    event_ids: Array.isArray(point.event_ids) ? point.event_ids.map(text).filter(Boolean) : [],
    reference_event_ids: Array.isArray(point.reference_event_ids) ? point.reference_event_ids.map(text).filter(Boolean) : [],
    event_title: text(point.event_title),
    relation_id: text(point.relation_id),
    signal_id: text(point.signal_id),
    material_refs: Array.isArray(point.material_refs) ? point.material_refs.map(text).filter(Boolean) : [],
    signal_refs: Array.isArray(point.signal_refs) ? point.signal_refs.map(text).filter(Boolean) : [],
    relation_refs: Array.isArray(point.relation_refs) ? point.relation_refs.map(text).filter(Boolean) : [],
    material_ids: Array.isArray(point.material_ids) ? point.material_ids.map(text).filter(Boolean) : [],
    evidence_source_ids: Array.isArray(point.evidence_source_ids) ? point.evidence_source_ids.map(text).filter(Boolean) : [],
    evidence_source_refs: Array.isArray(point.evidence_source_refs) ? point.evidence_source_refs.map(text).filter(Boolean) : [],
    evidence_levels: Array.isArray(point.evidence_levels) ? point.evidence_levels.map(text).filter(Boolean) : [],
    writing_role: text(point.writing_role),
    reason: text(point.reason),
  };
  return Object.fromEntries(Object.entries(normalized).filter(([key, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    if (key === 'statement' || key === 'scope') return true;
    return Boolean(value);
  }));
}

export function researchPointsComplete(value) { return normalizeResearchPoints(value).length > 0; }

function matches(point, target) {
  const targetId = text(typeof target === 'object' ? target.point_id || target.id : target);
  const targetText = text(typeof target === 'object' ? pointText(target) : target).replace(/\s+/g, ' ').toLowerCase();
  return (targetId && text(point.point_id) === targetId) || (targetText && pointText(point).replace(/\s+/g, ' ').toLowerCase() === targetText);
}

export function mergeResearchPoints(current, update) {
  const existing = normalizeResearchPoints(current);
  if (update == null) return existing;
  const parsed = parseValue(update);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed.clear || parsed.replace || parsed.set || parsed.append || parsed.remove)) {
    if (parsed.clear) return [];
    const replacement = Object.prototype.hasOwnProperty.call(parsed, 'replace') ? parsed.replace : parsed.set;
    let result = Object.prototype.hasOwnProperty.call(parsed, 'replace') || Object.prototype.hasOwnProperty.call(parsed, 'set')
      ? normalizeResearchPoints(replacement)
      : existing;
    if (parsed.remove) result = result.filter((point) => ![].concat(parsed.remove).some((target) => matches(point, target)));
    if (parsed.append) result = normalizeResearchPoints([...result, ...normalizeResearchPoints(parsed.append)]);
    return result;
  }
  return normalizeResearchPoints([...existing, ...normalizeResearchPoints(parsed)]);
}

export function researchPointKey(point) { return keyFor(normalizePoint(point) || {}); }

export function normalizeRejectedAngles(value) {
  const parsed = parseValue(value);
  if (Array.isArray(parsed)) return parsed.filter(Boolean).map((item) => typeof item === 'string' ? { statement: text(item), reason: '' } : { statement: text(item?.statement || item?.direction), reason: text(item?.reason) }).filter((item) => item.statement);
  if (parsed && typeof parsed === 'object') return normalizeRejectedAngles([parsed]);
  return text(parsed).split(/\r?\n/).map((item) => ({ statement: text(item), reason: '' })).filter((item) => item.statement);
}
