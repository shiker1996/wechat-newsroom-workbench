export function toolRuntimeMetadata(tool = {}, fallbackRisk = 'read-only') {
  const riskLevel = tool.riskLevel || tool.implementations?.[0]?.riskLevel || fallbackRisk;
  const sideEffect = tool.sideEffect || (riskLevel === 'external-write' ? 'external-write' : riskLevel === 'local-write' ? 'local-write' : 'none');
  const replayPolicy = tool.replayPolicy || (sideEffect === 'none' && (typeof tool.idempotent !== 'boolean' || tool.idempotent) ? 'reuse-result' : 'never');
  if (!['reuse-result', 'never'].includes(replayPolicy)) throw new Error(`工具 replayPolicy 不合法：${replayPolicy}`);
  return {
    riskLevel,
    sideEffect,
    timeoutMs: Number.isFinite(tool.timeoutMs) && tool.timeoutMs > 0 ? Math.min(tool.timeoutMs, 300000) : 30000,
    idempotent: typeof tool.idempotent === 'boolean' ? tool.idempotent : ['read-only', 'network-read'].includes(riskLevel),
    requiresConfirmation: tool.requiresConfirmation === true || riskLevel === 'external-write' || sideEffect === 'external-write',
    replayPolicy,
    pathInputs: [...(tool.pathInputs || [])],
  };
}
