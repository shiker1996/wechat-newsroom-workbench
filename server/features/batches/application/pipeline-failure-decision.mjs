export function skipPipelineFailure({ failureId, batchId, reason = '', store }) {
  const failure = store.getPipelineFailure(failureId);
  if (!failure || failure.batch_id !== batchId) throw new Error('失败记录不存在');
  if (failure.stage === 'research' || failure.object_type === 'stage') throw new Error('批次级错误不能跳过，请修复后重试');
  if (failure.stage === 'tag') { if (!failure.hotspot_id) throw new Error('失败记录没有关联热点'); store.setHotspotResearchEligible(failure.hotspot_id, false); }
  const updated = store.skipPipelineFailure(failure.id, reason);
  if (!updated) throw new Error(`失败记录当前状态不可跳过：${failure.status}`);
  return updated;
}
export function reopenPipelineFailure({ failureId, batchId, store }) {
  const failure = store.getPipelineFailure(failureId);
  if (!failure || failure.batch_id !== batchId) throw new Error('失败记录不存在');
  if (failure.stage === 'tag' && failure.hotspot_id) store.setHotspotResearchEligible(failure.hotspot_id, true);
  const updated = store.reopenPipelineFailure(failure.id);
  if (!updated) throw new Error(`失败记录当前状态不可恢复：${failure.status}`);
  return updated;
}
