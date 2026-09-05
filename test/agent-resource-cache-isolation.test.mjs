import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBrokerTool } from '../server/platform/agent/tool-broker.mjs';

test('相同资源别名按运行和解析后资源隔离，重跑读取更新后的主题', async () => {
  const saved = new Map();
  const store = {
    getAgentIdempotentResult: ({ key }) => saved.get(key),
    saveAgentIdempotentResult: ({ key, result }) => saved.set(key, { result }),
  };
  const capability = 'cap_test_read';
  const request = { requestId: 'read', capability, arguments: { resourceId: 'project:current' } };
  const catalog = [{ capability, inputSchema: { type: 'object' }, outputSchema: { type: 'object' } }];
  let theme = 'ice-blue', calls = 0;
  const read = (agentRunId, project) => executeBrokerTool(request, {
    catalog, resolveArguments: () => ({ project }),
    context: { store, agentRunId, idempotencyKey: 'same-alias', toolHandlers: {
      [capability]: ({ project }) => { calls++; return { status: 'ok', data: { project, theme } }; },
    } },
  });
  await read('run-c011', 'c011');
  const c008 = await read('run-c008', 'c008');
  assert.equal(c008.data.project, 'c008');
  await read('run-c008', 'c008');
  assert.equal(calls, 2);
  const other = await read('run-c008', 'other-resource');
  assert.equal(other.data.project, 'other-resource');
  theme = 'brutalist';
  const rerun = await read('run-c008-new', 'c008');
  assert.equal(rerun.data.theme, 'brutalist');
  assert.equal(calls, 4);
});
