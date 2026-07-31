// 远程插件首次执行确认（开源清单 3.3）：安装/启用 ≠ 信任，首次真实调用前必须显式确认域名与权限。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { confirmRemotePluginFirstRun, installRemotePlugin, readRemotePluginCatalog } from '../lib/tools/remote-package-manager.mjs';
import { createRemoteAdapter } from '../lib/tools/remote-adapter.mjs';
import { handleSystemRoutes } from '../lib/http/routes/system-routes.mjs';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'remote-first-run-'));
}

function manifest() {
  return {
    schemaVersion: 1,
    id: 'demo-remote',
    name: '演示远程插件',
    version: '1.0.0',
    type: 'remote-api',
    capabilities: ['demo.search'],
    riskLevel: 'network-read',
    endpoint: 'https://api.example.com/search',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    timeoutMs: 5000,
    compatibleApp: '>=0.1.0',
  };
}

const publicDns = async () => [{ address: '93.184.216.34' }];
const fakeFetch = async () => new Response(JSON.stringify({ status: 'ok', data: { echo: 1 } }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

test('未确认的远程插件真实调用被门禁拒绝，确认后放行', async () => {
  const root = tmpdir();
  const installed = installRemotePlugin(root, manifest());
  const adapter = createRemoteAdapter({ root, manifest: installed.manifest, dependencies: { fetchImpl: fakeFetch, dnsLookup: publicDns } });

  const blocked = await adapter.execute({ query: 'demo' });
  assert.equal(blocked.status, 'error');
  assert.equal(blocked.error.code, 'FIRST_RUN_CONFIRM_REQUIRED');
  assert.match(blocked.error.message, /技能与插件/);

  confirmRemotePluginFirstRun(root, 'demo-remote');
  const allowed = await adapter.execute({ query: 'demo' });
  assert.equal(allowed.status, 'ok');
  assert.deepEqual(allowed.data, { echo: 1 });
  assert.equal(readRemotePluginCatalog(root).plugins['demo-remote'].firstRunConfirmedAt !== undefined, true);
});

test('健康检查不受首次执行门禁限制', async () => {
  const root = tmpdir();
  const installed = installRemotePlugin(root, manifest());
  const adapter = createRemoteAdapter({ root, manifest: installed.manifest, dependencies: { fetchImpl: fakeFetch, dnsLookup: publicDns } });
  const health = await adapter.health();
  assert.equal(health.status, 'ok');
});

function json(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

async function body(request) {
  let text = '';
  for await (const chunk of request) text += chunk;
  return text ? JSON.parse(text) : {};
}

async function startSystemRoutes(t, root) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    try {
      const handled = await handleSystemRoutes({
        request, response, pathname: url.pathname, searchParams: url.searchParams,
        root, config: {}, store: {}, json, body, binaryBody: body, createWorkbenchBackup: async () => {},
      });
      if (!handled) json(response, 404, { error: 'not found' });
    } catch (error) {
      if (!response.headersSent) json(response, 500, { error: error.message });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('first-run-confirm 路由写入确认时间，未知插件返回 400', async (t) => {
  const root = tmpdir();
  installRemotePlugin(root, manifest());
  const base = await startSystemRoutes(t, root);

  const missing = await fetch(`${base}/api/system/remote-tool-plugins/nope/first-run-confirm`, { method: 'POST', body: '{}' });
  assert.equal(missing.status, 400);

  const okResponse = await fetch(`${base}/api/system/remote-tool-plugins/demo-remote/first-run-confirm`, { method: 'POST', body: '{}' });
  assert.equal(okResponse.status, 200);
  const result = await okResponse.json();
  assert.ok(result.firstRunConfirmedAt);
});
