export class AgentRunRepository{
  constructor(db){this.db=db;}
  // allowedCapabilities：run 启动时冻结的能力授权快照（阶段 4a），后续配置变更不影响历史 run
  start(input){const now=new Date().toISOString();this.db.prepare(`INSERT INTO agent_runs
    (id,entry_point,batch_id,candidate_row_id,skill_id,provider,status,model_steps,tool_calls,allowed_capabilities_json,started_at,generation_snapshot_id,root_run_id,workflow_run_id,stage_id,parent_run_id)
    VALUES (?,?,?,?,?,?,?,0,0,?,?,?,?,?,?,?)`).run(input.id,input.entryPoint,input.batchId??null,input.candidateId??null,input.skillId??null,input.provider??null,'running',JSON.stringify(Array.isArray(input.allowedCapabilities)?input.allowedCapabilities.map(String):[]),now,input.generationSnapshotId??null,input.rootRunId??input.id,input.workflowRunId??input.rootRunId??input.id,input.stageId??input.entryPoint,input.parentRunId??null);return this.get(input.id);}
  finish(id,fields={}){const now=new Date().toISOString();this.db.prepare(`UPDATE agent_runs SET status=?,model_steps=?,tool_calls=?,finished_at=?,error=? WHERE id=?`).run(fields.status||'failed',Number(fields.modelSteps)||0,Number(fields.toolCalls)||0,now,fields.error||null,id);return this.get(id);}
  get(id){return this.#decorate(this.db.prepare('SELECT * FROM agent_runs WHERE id=?').get(id));}
  appendEvent(agentRunId,event){
    this.db.prepare(`INSERT INTO agent_run_events(agent_run_id,sequence,event_json,created_at)
      VALUES (?,(SELECT COALESCE(MAX(sequence),0)+1 FROM agent_run_events WHERE agent_run_id=?),?,?)`).run(agentRunId,agentRunId,JSON.stringify(event),new Date().toISOString());
  }
  listEvents(agentRunId,{afterSequence=0,limit=500}={}){
    return this.db.prepare('SELECT * FROM agent_run_events WHERE agent_run_id=? AND sequence>? ORDER BY sequence LIMIT ?')
      .all(agentRunId,Number(afterSequence)||0,Math.min(2000,Math.max(1,Number(limit)||500))).map((row)=>({...row,event:JSON.parse(row.event_json)}));
  }
  saveStep({agentRunId,step,phase,summary={}}){
    this.db.prepare('INSERT INTO agent_steps(agent_run_id,step_index,phase,summary_json,created_at) VALUES (?,?,?,?,?)')
      .run(agentRunId,step,phase,JSON.stringify(summary),new Date().toISOString());
  }
  listSteps(agentRunId){return this.db.prepare(`SELECT * FROM agent_steps WHERE agent_run_id=? ORDER BY step_index,CASE phase WHEN 'model_completed' THEN 0 WHEN 'tools_completed' THEN 1 ELSE 2 END`).all(agentRunId).map((row)=>({...row,summary:JSON.parse(row.summary_json)}));}
  saveCheckpoint(agentRunId,state){
    this.db.prepare(`INSERT INTO agent_checkpoints(agent_run_id,sequence,state_json,created_at)
      VALUES (?,(SELECT COALESCE(MAX(sequence),0)+1 FROM agent_checkpoints WHERE agent_run_id=?),?,?)`).run(agentRunId,agentRunId,JSON.stringify(state),new Date().toISOString());
  }
  latestCheckpoint(agentRunId){const row=this.db.prepare('SELECT * FROM agent_checkpoints WHERE agent_run_id=? ORDER BY sequence DESC LIMIT 1').get(agentRunId);return row?{...row,state:JSON.parse(row.state_json)}:null;}
  trace(agentRunId,{afterSequence=0,eventLimit=500,modelCallLimit=100,runtimeAudit=null}={}){
    const run=this.get(agentRunId);if(!run)return null;
    const latestCheckpoint=this.latestCheckpoint(agentRunId);
    const modelCalls=runtimeAudit?.listModelCallsForAgentRun?.(agentRunId,modelCallLimit)||[];
    const toolExecutions=runtimeAudit?.listToolExecutionsForAgentRun?.(agentRunId,eventLimit)||[];
    return {schemaVersion:1,run,events:this.listEvents(agentRunId,{afterSequence,limit:eventLimit}),steps:this.listSteps(agentRunId),modelCalls,toolCalls:this.listToolCalls(agentRunId),toolExecutions,latestCheckpoint,
      resumable:Boolean(latestCheckpoint?.state?.resumable&&run.status!=='completed')};
  }
  listByRoot(rootRunId, limit = 500) {
    const key = String(rootRunId);
    return this.db.prepare(`SELECT * FROM agent_runs WHERE root_run_id=? OR workflow_run_id=? OR id=?
      ORDER BY started_at,id LIMIT ?`).all(key, key, key, Math.min(2000, Math.max(1, Number(limit) || 500))).map((row) => this.#decorate(row));
  }
  workflowTrace(rootRunId, { eventLimit = 1000, modelCallLimit = 500, toolLimit = 500, runtimeAudit = null } = {}) {
    const runs = this.listByRoot(rootRunId, 2000);
    if (!runs.length) return null;
    const ids = runs.map((run) => run.id);
    const placeholders = ids.map(() => '?').join(',');
    const events = this.db.prepare(`SELECT * FROM agent_run_events WHERE agent_run_id IN (${placeholders}) ORDER BY created_at,sequence LIMIT ?`)
      .all(...ids, Math.min(5000, Math.max(1, Number(eventLimit) || 1000))).map((row) => ({ ...row, event: JSON.parse(row.event_json) }));
    const steps = this.db.prepare(`SELECT * FROM agent_steps WHERE agent_run_id IN (${placeholders}) ORDER BY created_at,step_index LIMIT ?`)
      .all(...ids, Math.min(5000, Math.max(1, Number(eventLimit) || 1000))).map((row) => ({ ...row, summary: JSON.parse(row.summary_json) }));
    const modelCalls = runtimeAudit?.listModelCallsByRoot?.(rootRunId, modelCallLimit) || [];
    const toolExecutions = runtimeAudit?.listToolExecutionsByRoot?.(rootRunId, toolLimit) || [];
    const toolCalls = this.db.prepare(`SELECT * FROM agent_tool_calls WHERE agent_run_id IN (${placeholders}) ORDER BY started_at,id LIMIT ?`)
      .all(...ids, Math.min(2000, Math.max(1, Number(toolLimit) || 500))).map((row) => ({ ...row, input_summary: JSON.parse(row.input_summary_json || '{}'), result_summary: row.result_summary_json ? JSON.parse(row.result_summary_json) : null }));
    const checkpoints = this.db.prepare(`SELECT * FROM agent_checkpoints WHERE agent_run_id IN (${placeholders}) ORDER BY created_at,sequence LIMIT ?`)
      .all(...ids, Math.min(2000, Math.max(1, Number(eventLimit) || 1000))).map((row) => ({ ...row, state: JSON.parse(row.state_json) }));
    const batchIds = [...new Set(runs.map((run) => run.batch_id).filter(Boolean))];
    const candidateIds = [...new Set(runs.map((run) => run.candidate_row_id).filter((id) => id != null))];
    const artifactWhere = [];
    const artifactValues = [];
    if (batchIds.length) { artifactWhere.push(`batch_id IN (${batchIds.map(() => '?').join(',')})`); artifactValues.push(...batchIds); }
    if (candidateIds.length) { artifactWhere.push(`candidate_row_id IN (${candidateIds.map(() => '?').join(',')})`); artifactValues.push(...candidateIds); }
    const artifacts = artifactWhere.length ? this.db.prepare(`SELECT id,batch_id,candidate_row_id,kind,name,file_path,size,modified_at,status,track FROM artifacts WHERE ${artifactWhere.join(' OR ')} ORDER BY modified_at DESC,id DESC LIMIT ?`).all(...artifactValues, Math.min(2000, Math.max(1, Number(eventLimit) || 1000))) : [];
    return { schemaVersion: 2, rootRunId: String(rootRunId), runs, events, steps, modelCalls, toolCalls, toolExecutions, checkpoints, artifacts,
      resumable: runs.some((run) => run.status !== 'completed' && checkpoints.some((checkpoint) => checkpoint.agent_run_id === run.id && checkpoint.state?.resumable)) };
  }
  claimResume(agentRunId, claimToken, leaseMs=120000){
    const now=Date.now(),claimedAt=new Date(now).toISOString(),leaseUntil=new Date(now+Math.max(1000,Number(leaseMs)||120000)).toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current=this.db.prepare('SELECT * FROM agent_resume_claims WHERE agent_run_id=?').get(agentRunId);
      if(current && new Date(current.lease_until).getTime()>now) { this.db.exec('ROLLBACK'); return false; }
      this.db.prepare(`INSERT INTO agent_resume_claims(agent_run_id,claim_token,claimed_at,lease_until) VALUES (?,?,?,?)
        ON CONFLICT(agent_run_id) DO UPDATE SET claim_token=excluded.claim_token,claimed_at=excluded.claimed_at,lease_until=excluded.lease_until`)
        .run(agentRunId,claimToken,claimedAt,leaseUntil);
      this.db.exec('COMMIT'); return true;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  releaseResume(agentRunId,claimToken){return this.db.prepare('DELETE FROM agent_resume_claims WHERE agent_run_id=? AND claim_token=?').run(agentRunId,claimToken).changes>0;}
  getIdempotentResult({key,capability,plugin=null,version=null}){
    if(!key||!capability)return null;
    const row=this.db.prepare('SELECT * FROM agent_tool_idempotency WHERE idempotency_key=? AND capability=? AND (expires_at IS NULL OR expires_at>?)').get(String(key),String(capability),new Date().toISOString());
    if(!row || (plugin && row.plugin!==plugin) || (version && row.version!==version))return null;
    return {...row,result:JSON.parse(row.result_json)};
  }
  saveIdempotentResult({key,capability,plugin=null,version=null,result,expiresAt=null}){
    if(!key||!capability||!result)return null;
    const now=new Date().toISOString();
    this.db.prepare(`INSERT INTO agent_tool_idempotency(idempotency_key,capability,plugin,version,result_json,created_at,expires_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING`).run(String(key),String(capability),plugin,version,JSON.stringify(result),now,expiresAt);
    return this.getIdempotentResult({key,capability,plugin,version});
  }
  list(limit=100){return this.db.prepare('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?').all(Math.min(500,Math.max(1,Number(limit)||100))).map((row)=>this.#decorate(row));}
  #decorate(row){return row?{...row,allowedCapabilities:JSON.parse(row.allowed_capabilities_json||'[]'),rootRunId:row.root_run_id??null,workflowRunId:row.workflow_run_id??null,stageId:row.stage_id??null,parentRunId:row.parent_run_id??null}:null;}
  overview(limit=100){
    const runs=this.list(limit),ids=runs.map((item)=>item.id);if(!ids.length)return {runs:[],summary:{runs:0,completed:0,failed:0,limited:0,successRate:0,toolCalls:0,toolFailures:0,averageDurationMs:0,estimatedCost:null},byEntryPoint:[],byCapability:[]};
    const placeholders=ids.map(()=>'?').join(','),calls=this.db.prepare(`SELECT * FROM agent_tool_calls WHERE agent_run_id IN (${placeholders}) ORDER BY started_at,id`).all(...ids);
    const duration=(row)=>row.finished_at?Math.max(0,new Date(row.finished_at)-new Date(row.started_at)):null;
    const decorated=runs.map((run)=>({...run,duration_ms:duration(run),toolCalls:calls.filter((call)=>call.agent_run_id===run.id).map((call)=>({...call,duration_ms:duration(call)}))}));
    const group=(items,key)=>[...new Set(items.map((item)=>item[key]))].filter(Boolean).map((value)=>{const selected=items.filter((item)=>item[key]===value),failures=selected.filter((item)=>!['completed','ok'].includes(item.status)).length,durations=selected.map(duration).filter(Number.isFinite);return {[key]:value,total:selected.length,failures,successRate:Number(((selected.length-failures)/selected.length*100).toFixed(1)),averageDurationMs:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):0};});
    const completed=runs.filter((item)=>item.status==='completed').length,failed=runs.filter((item)=>item.status==='failed').length,limited=runs.filter((item)=>item.status==='limit').length,durations=runs.map(duration).filter(Number.isFinite);
    return {runs:decorated,summary:{runs:runs.length,completed,failed,limited,successRate:Number((completed/runs.length*100).toFixed(1)),toolCalls:calls.length,toolFailures:calls.filter((item)=>item.status!=='ok').length,averageDurationMs:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):0,estimatedCost:null},byEntryPoint:group(runs,'entry_point'),byCapability:group(calls,'capability')};
  }
  startToolCall({agentRunId,request,rootRunId=null,workflowRunId=null,stageId=null}){const id=`${agentRunId}:${request.requestId}`,now=new Date().toISOString();const run=this.db.prepare('SELECT root_run_id,workflow_run_id,stage_id FROM agent_runs WHERE id=?').get(agentRunId);this.db.prepare(`INSERT OR REPLACE INTO agent_tool_calls
    (id,agent_run_id,request_id,capability,status,reason,input_summary_json,started_at,root_run_id,workflow_run_id,stage_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id,agentRunId,request.requestId,request.capability,'running',request.reason,JSON.stringify({keys:Object.keys(request.arguments||{}).sort()}),now,rootRunId??run?.root_run_id??null,workflowRunId??run?.workflow_run_id??null,stageId??run?.stage_id??null);return id;}
  finishToolCall({agentRunId,request,result}){const id=`${agentRunId}:${request.requestId}`,now=new Date().toISOString();this.db.prepare(`UPDATE agent_tool_calls SET status=?,plugin=?,result_summary_json=?,error_code=?,finished_at=? WHERE id=?`).run(result.status,result.provenance?.provider||null,JSON.stringify(result.status==='ok'?{dataKeys:Object.keys(result.data||{}).sort(),warnings:result.warnings||[]}:{message:result.error?.message||''}),result.error?.code||null,now,id);return this.db.prepare('SELECT * FROM agent_tool_calls WHERE id=?').get(id)||null;}
  listToolCalls(agentRunId){return this.db.prepare('SELECT * FROM agent_tool_calls WHERE agent_run_id=? ORDER BY started_at,id').all(agentRunId).map((row)=>({...row,input_summary:JSON.parse(row.input_summary_json||'{}'),result_summary:row.result_summary_json?JSON.parse(row.result_summary_json):null}));}
  saveAttachment({batchId,entryPoint,capability,fingerprint,agentRunId=null,data}){const now=new Date().toISOString();this.db.prepare(`INSERT INTO conversation_fact_attachments
    (batch_id,entry_point,capability,fingerprint,agent_run_id,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(batch_id,entry_point,capability,fingerprint) DO UPDATE SET agent_run_id=excluded.agent_run_id,data_json=excluded.data_json,updated_at=excluded.updated_at`).run(batchId,entryPoint,capability,fingerprint,agentRunId,JSON.stringify(data),now,now);return this.getAttachment({batchId,entryPoint,capability,fingerprint});}
  getAttachment({batchId,entryPoint,capability,fingerprint}){const row=this.db.prepare('SELECT * FROM conversation_fact_attachments WHERE batch_id=? AND entry_point=? AND capability=? AND fingerprint=?').get(batchId,entryPoint,capability,fingerprint);return row?{...row,data:JSON.parse(row.data_json)}:null;}
  listAttachments({batchId,entryPoint='independent-writing'}){return this.db.prepare('SELECT * FROM conversation_fact_attachments WHERE batch_id=? AND entry_point=? ORDER BY updated_at DESC').all(batchId,entryPoint).map((row)=>({...row,data:JSON.parse(row.data_json)}));}
}
