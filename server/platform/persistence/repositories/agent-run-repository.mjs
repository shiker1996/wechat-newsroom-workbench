export class AgentRunRepository{
  constructor(db){this.db=db;}
  // allowedCapabilities：run 启动时冻结的能力授权快照（阶段 4a），后续配置变更不影响历史 run
  start(input){const now=new Date().toISOString();this.db.prepare(`INSERT INTO agent_runs
    (id,entry_point,batch_id,candidate_row_id,skill_id,provider,status,model_steps,tool_calls,allowed_capabilities_json,started_at)
    VALUES (?,?,?,?,?,?,?,0,0,?,?)`).run(input.id,input.entryPoint,input.batchId??null,input.candidateId??null,input.skillId??null,input.provider??null,'running',JSON.stringify(Array.isArray(input.allowedCapabilities)?input.allowedCapabilities.map(String):[]),now);return this.get(input.id);}
  finish(id,fields={}){const now=new Date().toISOString();this.db.prepare(`UPDATE agent_runs SET status=?,model_steps=?,tool_calls=?,finished_at=?,error=? WHERE id=?`).run(fields.status||'failed',Number(fields.modelSteps)||0,Number(fields.toolCalls)||0,now,fields.error||null,id);return this.get(id);}
  get(id){return this.#decorate(this.db.prepare('SELECT * FROM agent_runs WHERE id=?').get(id));}
  list(limit=100){return this.db.prepare('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?').all(Math.min(500,Math.max(1,Number(limit)||100))).map((row)=>this.#decorate(row));}
  #decorate(row){return row?{...row,allowedCapabilities:JSON.parse(row.allowed_capabilities_json||'[]')}:null;}
  overview(limit=100){
    const runs=this.list(limit),ids=runs.map((item)=>item.id);if(!ids.length)return {runs:[],summary:{runs:0,completed:0,failed:0,limited:0,successRate:0,toolCalls:0,toolFailures:0,averageDurationMs:0,estimatedCost:null},byEntryPoint:[],byCapability:[]};
    const placeholders=ids.map(()=>'?').join(','),calls=this.db.prepare(`SELECT * FROM agent_tool_calls WHERE agent_run_id IN (${placeholders}) ORDER BY started_at,id`).all(...ids);
    const duration=(row)=>row.finished_at?Math.max(0,new Date(row.finished_at)-new Date(row.started_at)):null;
    const decorated=runs.map((run)=>({...run,duration_ms:duration(run),toolCalls:calls.filter((call)=>call.agent_run_id===run.id).map((call)=>({...call,duration_ms:duration(call)}))}));
    const group=(items,key)=>[...new Set(items.map((item)=>item[key]))].filter(Boolean).map((value)=>{const selected=items.filter((item)=>item[key]===value),failures=selected.filter((item)=>!['completed','ok'].includes(item.status)).length,durations=selected.map(duration).filter(Number.isFinite);return {[key]:value,total:selected.length,failures,successRate:Number(((selected.length-failures)/selected.length*100).toFixed(1)),averageDurationMs:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):0};});
    const completed=runs.filter((item)=>item.status==='completed').length,failed=runs.filter((item)=>item.status==='failed').length,limited=runs.filter((item)=>item.status==='limit').length,durations=runs.map(duration).filter(Number.isFinite);
    return {runs:decorated,summary:{runs:runs.length,completed,failed,limited,successRate:Number((completed/runs.length*100).toFixed(1)),toolCalls:calls.length,toolFailures:calls.filter((item)=>item.status!=='ok').length,averageDurationMs:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):0,estimatedCost:null},byEntryPoint:group(runs,'entry_point'),byCapability:group(calls,'capability')};
  }
  startToolCall({agentRunId,request}){const id=`${agentRunId}:${request.requestId}`,now=new Date().toISOString();this.db.prepare(`INSERT OR REPLACE INTO agent_tool_calls
    (id,agent_run_id,request_id,capability,status,reason,input_summary_json,started_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(id,agentRunId,request.requestId,request.capability,'running',request.reason,JSON.stringify({keys:Object.keys(request.arguments||{}).sort()}),now);return id;}
  finishToolCall({agentRunId,request,result}){const id=`${agentRunId}:${request.requestId}`,now=new Date().toISOString();this.db.prepare(`UPDATE agent_tool_calls SET status=?,plugin=?,result_summary_json=?,error_code=?,finished_at=? WHERE id=?`).run(result.status,result.provenance?.provider||null,JSON.stringify(result.status==='ok'?{dataKeys:Object.keys(result.data||{}).sort(),warnings:result.warnings||[]}:{message:result.error?.message||''}),result.error?.code||null,now,id);return this.db.prepare('SELECT * FROM agent_tool_calls WHERE id=?').get(id)||null;}
  listToolCalls(agentRunId){return this.db.prepare('SELECT * FROM agent_tool_calls WHERE agent_run_id=? ORDER BY started_at,id').all(agentRunId).map((row)=>({...row,input_summary:JSON.parse(row.input_summary_json||'{}'),result_summary:row.result_summary_json?JSON.parse(row.result_summary_json):null}));}
  saveAttachment({batchId,entryPoint,capability,fingerprint,agentRunId=null,data}){const now=new Date().toISOString();this.db.prepare(`INSERT INTO conversation_fact_attachments
    (batch_id,entry_point,capability,fingerprint,agent_run_id,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(batch_id,entry_point,capability,fingerprint) DO UPDATE SET agent_run_id=excluded.agent_run_id,data_json=excluded.data_json,updated_at=excluded.updated_at`).run(batchId,entryPoint,capability,fingerprint,agentRunId,JSON.stringify(data),now,now);return this.getAttachment({batchId,entryPoint,capability,fingerprint});}
  getAttachment({batchId,entryPoint,capability,fingerprint}){const row=this.db.prepare('SELECT * FROM conversation_fact_attachments WHERE batch_id=? AND entry_point=? AND capability=? AND fingerprint=?').get(batchId,entryPoint,capability,fingerprint);return row?{...row,data:JSON.parse(row.data_json)}:null;}
  listAttachments({batchId,entryPoint='independent-writing'}){return this.db.prepare('SELECT * FROM conversation_fact_attachments WHERE batch_id=? AND entry_point=? ORDER BY updated_at DESC').all(batchId,entryPoint).map((row)=>({...row,data:JSON.parse(row.data_json)}));}
}
