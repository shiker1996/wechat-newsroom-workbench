export function createExecutionRecord({ capability, plugin, version, input, result, startedAt, finishedAt, authorizedExternalWrite = false, configurationSnapshot = null, resolutionId = null, attempt = 1, fallbackFrom = null, consumerId = null, agentRunId = null, agentToolCallId = null, workflowRunId = null, rootRunId = null, stageId = null, sideEffect = 'none', replayPolicy = 'never' }) {
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
    resolutionId,attempt,fallbackFrom,consumerId,agentRunId,agentToolCallId,workflowRunId,rootRunId,stageId,sideEffect,replayPolicy,
  });
}

export function createStoreExecutionLogger(store, metadata = {}) {
  if (typeof store?.saveToolExecution !== 'function') return null;
  return (record) => store.saveToolExecution({
    batchId:metadata.batchId || null,
    candidateId:metadata.candidateId || null,
    generationSnapshotId:metadata.generationSnapshotId || null,
    skillId:metadata.skillId || null,
    agentRunId:metadata.agentRunId || null,
    agentToolCallId:metadata.agentToolCallId || null,
    workflowRunId:metadata.workflowRunId || null,
    rootRunId:metadata.rootRunId || null,
    stageId:metadata.stageId || null,
    sideEffect:metadata.sideEffect || null,
    replayPolicy:metadata.replayPolicy || null,
    record,
  });
}
