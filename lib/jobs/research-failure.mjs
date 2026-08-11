export function classifyResearchFailure(error) {
  const message=String(error?.message||error||'事件研判失败');
  if(/聚类门禁|报道数不守恒/.test(message))return {code:'cluster_invariant_failed',category:'deterministic_gate'};
  if(/缺少完整语义标注/.test(message))return {code:'missing_tags',category:'prerequisite'};
  if(/没有处于有效时间|没有可研判内容|所有有效事件均已跳过/.test(message))return {code:'empty_scope',category:'prerequisite'};
  if(/探索脑暴没有返回有效候选/.test(message))return {code:'empty_brainstorm',category:'model_output_gate'};
  if(/全部候选均为 NO_ANGLE/.test(message))return {code:'all_candidates_rejected',category:'model_output_gate'};
  if(/JSON|输出上限|截断|有效候选/.test(message))return {code:'invalid_model_output',category:'model_output_gate'};
  if(/超时|timeout|网络|fetch|内容为空|未返回/.test(message))return {code:'model_call_failed',category:'provider'};
  return {code:'research_failed',category:'unknown'};
}

export function recordResearchFailure({store,job,error}) {
  const classified=classifyResearchFailure(error);
  return store.recordPipelineFailure({batchId:job.batchId,runId:job.id,stage:'research',objectType:'stage',
    objectKey:'stage:research',title:'事件研判',errorCode:classified.code,errorMessage:String(error?.message||error),
    detail:{category:classified.category,phase:job.phase||'research',provider:job.provider,skippable:false}});
}
