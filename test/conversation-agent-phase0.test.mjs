import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  CONVERSATION_AGENT_BUDGET_DEFAULTS,
  CONVERSATION_AGENT_BUDGET_LIMITS,
  CONVERSATION_AGENT_ENTRY_POINTS,
  CONVERSATION_AGENT_ERROR_CODES,
  CONVERSATION_AGENT_SCHEMA_VERSION,
  CONVERSATION_AGENT_STREAM_EVENTS,
} from '../server/platform/agent/contracts.mjs';

const readJson=(relative)=>JSON.parse(fs.readFileSync(new URL(relative,import.meta.url),'utf8'));

test('Phase 0 固定 Agent 入口、错误码、流事件和安全预算',()=>{
  assert.equal(CONVERSATION_AGENT_SCHEMA_VERSION,1);
  assert.deepEqual(CONVERSATION_AGENT_ENTRY_POINTS,['editorial','independent-writing','custom-social']);
  for(const code of ['INVALID_AGENT_ENVELOPE','CAPABILITY_NOT_VISIBLE','RESOURCE_NOT_ALLOWED','TOOL_PERMISSION_DENIED','AGENT_BUDGET_EXCEEDED']){
    assert.ok(CONVERSATION_AGENT_ERROR_CODES.includes(code));
  }
  assert.deepEqual(CONVERSATION_AGENT_STREAM_EVENTS,[
    'assistant.delta','assistant.thinking','tool.requested','tool.running','tool.completed','tool.failed',
    'tool.needs_confirmation','agent.limit','done','error',
  ]);
  for(const key of Object.keys(CONVERSATION_AGENT_BUDGET_DEFAULTS)){
    assert.ok(CONVERSATION_AGENT_BUDGET_DEFAULTS[key]<=CONVERSATION_AGENT_BUDGET_LIMITS[key],`${key} 默认值不得超过硬上限`);
  }
  assert.equal(CONVERSATION_AGENT_BUDGET_DEFAULTS.maxModelSteps,3);
  assert.equal(CONVERSATION_AGENT_BUDGET_DEFAULTS.maxToolCalls,5);
  assert.equal(CONVERSATION_AGENT_BUDGET_DEFAULTS.timeoutMs,90000);
});

test('Phase 0 三份 JSON Schema 禁止未知字段并区分工具请求、成功结果、错误结果和最终输出',()=>{
  const request=readJson('../server/platform/agent/schemas/tool-request.schema.json');
  const result=readJson('../server/platform/agent/schemas/tool-result.schema.json');
  const envelope=readJson('../server/platform/agent/schemas/agent-envelope.schema.json');
  assert.equal(request.additionalProperties,false);
  assert.deepEqual(request.required,['requestId','capability','arguments']);
  assert.equal(request.properties.reason.maxLength,160);
  assert.equal(result.oneOf.length,2);
  assert.equal(result.oneOf[0].properties.status.const,'ok');
  assert.equal(result.oneOf[1].properties.status.const,'error');
  assert.equal(envelope.oneOf.length,2);
  assert.equal(envelope.oneOf[0].properties.type.const,'tool_requests');
  assert.equal(envelope.oneOf[0].properties.requests.maxItems,4);
  assert.equal(envelope.oneOf[0].properties.requests.items.$ref,'tool-request.schema.json');
  assert.equal(envelope.oneOf[1].properties.type.const,'final');
});

test('Phase 0 基线冻结三入口当前触发方式、能力矩阵、门禁和已知审计缺口',()=>{
  const baseline=readJson('./fixtures/conversation-agent-phase0-baseline.json');
  assert.equal(baseline.schemaVersion,1);
  assert.equal(baseline.productionAgentEnabled,true);
  assert.deepEqual(baseline.entries.map((entry)=>entry.id),CONVERSATION_AGENT_ENTRY_POINTS);
  const editorial=baseline.entries.find((entry)=>entry.id==='editorial');
  assert.ok(editorial.capabilities.includes('content.url.fetch'));
  assert.ok(editorial.capabilities.includes('content.passage.retrieve'));
  assert.equal(editorial.modelDeclaredToolIntent,'ToolRequest[]');
  const tutorial=baseline.entries.find((entry)=>entry.id==='independent-writing');
  assert.ok(tutorial.capabilities.includes('filesystem.project.read'));
  assert.equal(tutorial.modelDeclaredToolIntent,'ToolRequest[]');
  const custom=baseline.entries.find((entry)=>entry.id==='custom-social');
  assert.ok(custom.capabilities.includes('content.repository.inspect'));
  assert.equal(custom.modelDeclaredToolIntent,'ToolRequest[]');
  assert.equal(baseline.auditMetadata.knownGaps.length,1);
});

test('Phase 5 三个生产入口保留可扫描调用点并统一启用 Agent runtime',()=>{
  const article=fs.readFileSync(new URL('../server/platform/http/routes/article-routes.mjs',import.meta.url),'utf8');
  const candidate=fs.readFileSync(new URL('../server/platform/http/routes/candidate-routes.mjs',import.meta.url),'utf8');
  const baseline=readJson('./fixtures/conversation-agent-phase0-baseline.json');
  assert.match(article,new RegExp(baseline.callsiteMarkers.editorial));
  assert.match(candidate,new RegExp(baseline.callsiteMarkers['independent-writing']));
  assert.match(candidate,new RegExp(baseline.callsiteMarkers['custom-social']));
  assert.doesNotMatch(article,/from ['"]\.\.\/\.\.\/agent\/conversation-agent\.mjs/);
  assert.doesNotMatch(candidate,/from ['"]\.\.\/\.\.\/agent\/conversation-agent\.mjs/);
});

test('Phase 5 收口后无旧私有协议、旧执行器或 provider 隐式搜索',()=>{
  const article=fs.readFileSync(new URL('../server/platform/http/routes/article-routes.mjs',import.meta.url),'utf8');
  const customChat=fs.readFileSync(new URL('../server/features/social-cards/llm/custom-social-chat.mjs',import.meta.url),'utf8');
  const candidate=fs.readFileSync(new URL('../server/platform/http/routes/candidate-routes.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(article,/fetchEvents|autoFetchEditorialEvents|runEditorialTurnStream/);
  assert.doesNotMatch(candidate,/runTutorialChatStream|runCustomSocialChatStream/);
  assert.doesNotMatch(customChat,/webSearch:\s*true/);
});
