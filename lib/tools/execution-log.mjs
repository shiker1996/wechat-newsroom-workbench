export function createExecutionRecord({ capability, plugin, version, input, result, startedAt, finishedAt, authorizedExternalWrite = false, configurationSnapshot = null, resolutionId = null, attempt = 1, fallbackFrom = null, consumerId = null }) {
  return Object.freeze({
    capability,
    plugin,
    version,
    status:result.status,
    errorCode:result.status === 'error' ? result.error.code : null,
    inputKeys:Object.keys(input || {}).sort(),
    startedAt,
    finishedAt,
    durationMs:new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    authorizedExternalWrite:Boolean(authorizedExternalWrite),
    configurationSnapshot:configurationSnapshot ? structuredClone(configurationSnapshot) : null,
    resolutionId,attempt,fallbackFrom,consumerId,
  });
}

export function createStoreExecutionLogger(store, metadata = {}) {
  if (typeof store?.saveToolExecution !== 'function') return null;
  return (record) => store.saveToolExecution({
    batchId:metadata.batchId || null,
    candidateId:metadata.candidateId || null,
    generationSnapshotId:metadata.generationSnapshotId || null,
    skillId:metadata.skillId || null,
    record,
  });
}
