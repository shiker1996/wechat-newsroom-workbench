const DEFAULT_MIN_SAMPLES = 3;
const DEFAULT_MIN_FAILURES = 3;

function asRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

/**
 * Decide whether Social template evidence justifies a new renderer.
 * This is deliberately conservative: repeated role-level failures are
 * required, and ordinary audit/layout issues keep the current primitives.
 */
export function summarizeSocialTemplateExtensionGate(rows, {
  minSamples = DEFAULT_MIN_SAMPLES,
  minFailures = DEFAULT_MIN_FAILURES,
} = {}) {
  const samples = asRows(rows).filter((row) => row.operation === 'compiled' || row.operation === 'rejected');
  const roleFailures = {};
  const issueCodes = {};
  for (const row of samples) {
    const roles = Array.isArray(row.failedRoles) ? row.failedRoles : [];
    for (const role of roles) roleFailures[role] = (roleFailures[role] || 0) + 1;
    const issues = Array.isArray(row.issues) ? row.issues : [];
    for (const code of issues.map((issue) => issue?.code).filter(Boolean)) issueCodes[code] = (issueCodes[code] || 0) + 1;
  }
  const repeatedRoles = Object.entries(roleFailures)
    .filter(([, count]) => count >= minFailures)
    .sort((a, b) => b[1] - a[1])
    .map(([role, count]) => ({ role, count }));
  const decision = samples.length < minSamples
    ? 'collect-more-evidence'
    : repeatedRoles.length
      ? 'renderer-change-candidate'
      : 'keep-current-primitives';
  return {
    decision,
    rendererExtensionEligible: decision === 'renderer-change-candidate',
    sampleCount: samples.length,
    minSamples,
    minFailures,
    repeatedRoles,
    roleFailures,
    issueCodes,
  };
}
