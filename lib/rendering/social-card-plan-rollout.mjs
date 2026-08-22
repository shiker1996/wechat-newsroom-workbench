const DEFAULT_PROFILE = Object.freeze({
  schemaVersion: 1,
  variant: 'content-plan-v1',
  mode: 'compatibility',
  enabled: true,
  maxPlanRounds: 3,
  maxOperationsPerRound: 4,
  structuralReflowScale: 0.84,
  textRepairMaxRounds: 2,
});

const PROFILES = Object.freeze({
  'clean-v1': Object.freeze({ ...DEFAULT_PROFILE, mode: 'gray', grayBatch: true }),
  'editorial-v1': Object.freeze({ ...DEFAULT_PROFILE, mode: 'gray', grayBatch: true }),
  'brutalist-v1': Object.freeze({
    ...DEFAULT_PROFILE,
    mode: 'conservative',
    maxPlanRounds: 2,
    maxOperationsPerRound: 3,
    structuralReflowScale: 0.78,
  }),
  'neon-v1': Object.freeze({
    ...DEFAULT_PROFILE,
    mode: 'conservative',
    maxPlanRounds: 2,
    maxOperationsPerRound: 3,
    structuralReflowScale: 0.78,
  }),
});

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function average(values) {
  const list = values.map(numberOrNull).filter((value) => value != null);
  return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null;
}

function generationRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row?.operation === 'generation');
}

function metric(row, camel, snake, fallback = null) {
  return row?.[camel] ?? row?.[snake] ?? fallback;
}

export function getSocialCardPlanRolloutProfile(templatePackId = '') {
  const id = String(templatePackId || '');
  return { ...(PROFILES[id] || DEFAULT_PROFILE), templatePackId: id };
}

export function listSocialCardPlanRolloutProfiles() {
  return Object.entries(PROFILES).map(([templatePackId, profile]) => ({ templatePackId, ...profile }));
}

export function summarizeSocialCardPlanRolloutRows(rows = []) {
  const list = generationRows(rows);
  const pageCount = list.map((row) => metric(row, 'pageCount', 'page_count', 0));
  const utilization = list.map((row) => metric(row, 'avgUtilization', 'avg_utilization'));
  const planRounds = list.map((row) => metric(row, 'contentPlanAdjustmentCount', 'content_plan_adjustment_count', 0));
  const textRounds = list.map((row) => metric(row, 'textRepairCount', 'text_repair_count', 0));
  const sourceLoss = list.map((row) => metric(row, 'sourceAtomLossCount', 'source_atom_loss_count', 0));
  const jointMismatchRate = list.map((row) => {
    const attempts = Number(metric(row, 'jointPackingAuditAttempts', 'joint_packing_audit_attempts', 0) || 0);
    const mismatches = Number(metric(row, 'jointPackingMismatchCount', 'joint_packing_mismatch_count', 0) || 0);
    return attempts > 0 ? mismatches / attempts : null;
  });
  const overflowPages = list.reduce((sum, row) => sum + Number(metric(row, 'overflowPages', 'overflow_pages', 0) || 0), 0);
  const pages = list.reduce((sum, row) => sum + Number(metric(row, 'pageCount', 'page_count', 0) || 0), 0);
  return {
    sampleCount: list.length,
    successRate: list.length ? list.filter((row) => row.success !== false && Number(row.success ?? 1) !== 0 && (row.layoutPass === true || Number(row.layout_pass) !== 0)).length / list.length : null,
    averagePageCount: average(pageCount),
    averageUtilization: average(utilization),
    averagePlanAdjustmentRounds: average(planRounds) ?? 0,
    averageTextRepairRounds: average(textRounds) ?? 0,
    sourceAtomLossCount: sourceLoss.reduce((sum, value) => sum + Number(value || 0), 0),
    averageJointPackingMismatchRate: average(jointMismatchRate),
    overflowRate: pages ? overflowPages / pages : null,
    planAdjustmentRunRate: list.length ? list.filter((row) => Number(metric(row, 'contentPlanAdjustmentCount', 'content_plan_adjustment_count', 0) || 0) > 0).length / list.length : null,
  };
}

export function buildSocialCardPlanRolloutReport(rows = [], { minSamples = 3 } = {}) {
  const list = generationRows(rows);
  const groups = new Map();
  for (const row of list) {
    const templatePackId = String(row.requested_template_id || row.requestedTemplate?.id || 'unknown');
    const profile = row.rolloutProfile || row.rollout_profile_json ? (row.rolloutProfile || (() => { try { return JSON.parse(row.rollout_profile_json); } catch { return {}; } })()) : {};
    const mode = String(profile.mode || row.rolloutMode || row.rollout_mode || 'unknown');
    const key = `${templatePackId}|${mode}`;
    if (!groups.has(key)) groups.set(key, { templatePackId, mode, rows: [] });
    groups.get(key).rows.push(row);
  }
  const variants = [...groups.values()].map(({ templatePackId, mode, rows: groupRows }) => {
    const metrics = summarizeSocialCardPlanRolloutRows(groupRows);
    return { templatePackId, mode, ...metrics, enoughSamples: metrics.sampleCount >= Math.max(1, Number(minSamples) || 3) };
  });
  const byTemplate = new Map();
  for (const item of variants) {
    if (!byTemplate.has(item.templatePackId)) byTemplate.set(item.templatePackId, []);
    byTemplate.get(item.templatePackId).push(item);
  }
  const comparisons = [...byTemplate.entries()].map(([templatePackId, items]) => {
    const gray = items.find((item) => item.mode === 'gray' || item.mode === 'default');
    const conservative = items.find((item) => item.mode === 'conservative');
    const current = gray || conservative || items[0];
    const baseline = items.find((item) => item.mode === 'legacy' || item.mode === 'compatibility');
    const newer = gray || conservative;
    const sourceAtomLossZero = (newer?.sourceAtomLossCount ?? 0) === 0;
    const enoughSamples = Boolean(newer?.enoughSamples);
    const successNotWorse = !baseline || newer.successRate == null || baseline.successRate == null || newer.successRate >= baseline.successRate;
    const overflowNotWorse = !baseline || newer.overflowRate == null || baseline.overflowRate == null || newer.overflowRate <= baseline.overflowRate;
    const repairNotWorse = !baseline || newer.averagePlanAdjustmentRounds <= baseline.averagePlanAdjustmentRounds + 0.5;
    const auditAlignmentNotWorse = !baseline || newer.averageJointPackingMismatchRate == null || baseline.averageJointPackingMismatchRate == null || newer.averageJointPackingMismatchRate <= baseline.averageJointPackingMismatchRate;
    return {
      templatePackId,
      currentMode: current?.mode || 'unknown',
      baselineMode: baseline?.mode || null,
      newerMode: newer?.mode || null,
      readyForPromotion: Boolean(enoughSamples && sourceAtomLossZero && successNotWorse && overflowNotWorse && repairNotWorse && auditAlignmentNotWorse),
      gates: { enoughSamples, sourceAtomLossZero, successNotWorse, overflowNotWorse, repairNotWorse, auditAlignmentNotWorse },
      baseline: baseline || null,
      newer: newer || null,
    };
  });
  return { schemaVersion: 1, minSamples: Math.max(1, Number(minSamples) || 3), sampleCount: list.length, variants, comparisons };
}

export function evaluateSocialCardPlanRollout({ rows = [], templatePackId = '', minSamples = 3 } = {}) {
  const report = buildSocialCardPlanRolloutReport(rows, { minSamples });
  return report.comparisons.find((item) => item.templatePackId === String(templatePackId || '')) || {
    templatePackId: String(templatePackId || ''),
    readyForPromotion: false,
    gates: { enoughSamples: false, sourceAtomLossZero: true, successNotWorse: false, overflowNotWorse: false, repairNotWorse: false },
    baseline: null,
    newer: null,
  };
}
