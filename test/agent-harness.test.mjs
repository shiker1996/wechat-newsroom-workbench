import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { runSkill } from '../server/platform/agent/harness.mjs';
import { runConversationAgent } from '../server/platform/agent/conversation-agent.mjs';
import { AGENT_EVENT_PROTOCOL, agentEvent } from '../server/platform/agent/events.mjs';
import { runPipelineStage } from '../server/platform/skills/pipeline-runtime.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/harness-replay.json', import.meta.url), 'utf8'));
const catalog = [{ capability: 'cap_fixture_read', inputSchema: { type: 'object' } }];
const final = () => ({ type: 'final', assistantReply: '完成', output: {} });

for (const entry of fixture.entries) {
  for (const native of [false, true]) {
    test(`Harness replay ${entry.entryPoint}/${entry.skillId} ${native ? 'native' : 'legacy'} 保持结果和事件`, async () => {
      async function replay(run) {
        const events = [], calls = [];
        const result = await run({ ...entry, catalog, toolContext: { skillId: entry.skillId },
          registry: { async execute(capability, input) { calls.push({ capability, input }); return structuredClone(fixture.toolResult); } },
          onEvent: (event) => { const { agentRunId, ...payload } = event; assert.ok(agentRunId); events.push(payload); },
          modelStep: async ({ step, messages }) => {
            if (step > 0) assert.match(messages.at(-1).content, /固定资料/);
            if (native && step === 0) return { nativeTools: true, toolCalls: [{ id: 'fixture', name: 'cap_fixture_read', input: { query: '资料' } }] };
            return structuredClone(fixture.turns[step]);
          },
        });
        const { agentRunId, ...data } = result;
        assert.ok(agentRunId);
        assert.deepEqual(events.map((event) => event.type), fixture.events);
        assert.equal(calls.length, 1);
        return { data, events, calls };
      }
      assert.deepEqual(await replay(runSkill), await replay(runConversationAgent));
    });
  }
}

test('Harness 在执行前验证技能、入口和必需能力', async () => {
  let called = false;
  const request = { skillId: 'demo', entryPoint: 'demo', context: { modelStep: () => { called = true; return final(); } } };
  await assert.rejects(runSkill({ ...request, definition: { id: 'other', kind: 'agent-skill' } }), { code: 'INVALID_SKILL_RUN' });
  await assert.rejects(runSkill({ ...request, definition: { id: 'demo', kind: 'agent-skill', entryPoints: ['other'] } }), { code: 'SKILL_ENTRY_NOT_ALLOWED' });
  await assert.rejects(runSkill({ ...request, definition: { id: 'demo', kind: 'agent-skill', requiredCapabilities: ['cap_missing'] } }), { code: 'SKILL_CAPABILITY_MISSING' });
  assert.equal(called, false);
});

test('Harness 协议版本独立于既有 NDJSON 对象，拒绝无效授权类型', async () => {
  assert.equal(AGENT_EVENT_PROTOCOL.version, fixture.schemaVersion);
  assert.deepEqual(agentEvent('done', { data: { reply: '完成' } }), { type: 'done', data: { reply: '完成' } });
  await assert.rejects(runSkill({ skillId: 'demo', entryPoint: 'demo', policy: { allowedCapabilities: 'cap_fixture_read' }, context: { modelStep: final } }), { code: 'INVALID_SKILL_RUN' });
});

test('Harness scope 取目录、运行授权与 policy 的交集，冻结审计授权', async () => {
  let audit;
  const result = await runSkill({ skillId: 'demo', entryPoint: 'demo', policy: { allowedCapabilities: ['cap_fixture_read', 'cap_ungranted'] },
    context: { catalog, toolContext: { allowedCapabilities: [] }, store: { startAgentRun: (run) => { audit = run; } },
      modelStep: ({ catalog: actual }) => { assert.deepEqual(actual, []); return final(); } } });
  assert.equal(result.type, 'final');
  assert.deepEqual(audit.allowedCapabilities, []);
});

test('Harness prompt 与确定性 stage 分流且保留各自输出契约', async () => {
  const messages = [{ role: 'user', content: '写标题' }];
  const promptResult = { content: '标题', usage: { outputTokens: 2 } };
  assert.equal(await runSkill({ skillId: 'title', entryPoint: 'article', definition: { id: 'title', kind: 'prompt-skill' }, context: {
    messages, modelInput: { purpose: 'title' }, gateway: { complete: async (input) => { assert.deepEqual(input.messages, messages); assert.equal(input.purpose, 'title'); return promptResult; } },
  } }), promptResult);
  const stageResult = { markdown: '修改后的文章' };
  assert.equal(await runSkill({ skillId: 'review', entryPoint: 'article', input: { markdown: '原稿' }, definition: { id: 'review', kind: 'stage-skill' }, context: {
    executeStage: async ({ input, skillId }) => { assert.equal(skillId, 'review'); assert.equal(input.markdown, '原稿'); return stageResult; },
  } }), stageResult);
});

test('Pipeline stage 通过 Harness 建立可追踪 Run 并关联模型调用', async () => {
  const calls = [], runs = [];
  const store = {
    startAgentRun: (run) => { runs.push(run); return run; },
    appendAgentRunEvent: () => {}, saveAgentStep: () => {}, finishAgentRun: () => {},
  };
  const result = await runPipelineStage({ store, batchId: 'batch-1', candidateId: 7, provider: 'mock', purpose: 'article-drafting-pipeline',
    gateway: { complete: async (input) => { calls.push(input); return { content: '正文' }; } },
    messages: [{ role: 'user', content: '写作' }], maxOutputTokens: 1000, rootRunId: 'root-1', workflowRunId: 'workflow-1', stageId: 'drafting' });
  assert.equal(result.content, '正文');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].workflowRunId, 'workflow-1');
  assert.equal(calls[0].agentRunId, runs[0].id);
  assert.equal(calls[0].stageId, 'drafting');
});

test('Harness snapshot 不存在或不匹配时不得回退到实时配置', async () => {
  const request = { skillId: 'demo', entryPoint: 'demo', snapshotId: 'frozen', context: { modelStep: final } };
  await assert.rejects(runSkill(request), { code: 'SKILL_SNAPSHOT_UNAVAILABLE' });
  await assert.rejects(runSkill({ ...request, context: { ...request.context, resolveSnapshot: () => ({ skillId: 'other' }) } }), { code: 'SKILL_SNAPSHOT_MISMATCH' });
});

test('Harness 使用 snapshot messages、预算及授权并传递快照关联', async () => {
  let audit;
  const result = await runSkill({ skillId: 'demo', entryPoint: 'demo', snapshotId: 'frozen', context: {
    catalog, messages: [{ role: 'user', content: 'live' }], store: { startAgentRun: (run) => { audit = run; } },
    resolveSnapshot: () => ({ skillId: 'demo', entryPoint: 'demo', definition: { id: 'demo', kind: 'agent-skill' }, runtime: {
      messages: [{ role: 'user', content: 'frozen' }], budget: { maxModelSteps: 1 }, catalog: [],
    } }),
    modelStep: ({ messages, catalog: actual }) => { assert.equal(messages[0].content, 'frozen'); assert.deepEqual(actual, []); return final(); },
  } });
  assert.equal(result.modelSteps, 1);
  assert.equal(audit.generationSnapshotId, 'frozen');
});

test('Harness 历史快照不能增加当前入口能力或替换资源授权', async () => {
  let audit;
  await runSkill({ skillId: 'demo', entryPoint: 'demo', snapshotId: 'frozen', context: {
    catalog: [], toolContext: { allowedRoots: ['/current'] }, store: { startAgentRun: (run) => { audit = run; } },
    resolveSnapshot: () => ({ skillId: 'demo', entryPoint: 'demo', definition: { id: 'demo', kind: 'agent-skill' }, runtime: {
      catalog, toolContext: { allowedCapabilities: ['cap_fixture_read'], allowedRoots: ['/outside'] },
    } }),
    modelStep: ({ catalog: actual }) => { assert.deepEqual(actual, []); return final(); },
  } });
  assert.deepEqual(audit.allowedCapabilities, []);
  assert.deepEqual(audit.allowedRoots, ['/current']);
});

test('所有生产 Agent adapter 通过 Harness Facade 启动', () => {
  for (const file of [
    '../server/features/articles/application/agent/editorial-adapter.mjs',
    '../server/features/articles/application/agent/tutorial-adapter.mjs',
    '../server/features/social-cards/application/agent/custom-social-adapter.mjs',
    '../server/platform/agent/ai-visual-document-agent.mjs',
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /import \{ runSkill \} from .*harness\.mjs/);
    assert.doesNotMatch(source, /runConversationAgent/);
  }
});
