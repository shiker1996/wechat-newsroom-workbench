import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { handleSystemRoutes } from '../lib/http/routes/system-routes.mjs';
import { createZip } from '../lib/artifacts/zip-bundle.mjs';
import { readStoredZip, validateWorkbenchBackup } from '../lib/artifacts/backup-archive.mjs';
import { createRemoteAdapter, privateIp } from '../lib/tools/remote-adapter.mjs';
import { execute as urlFetchExecute } from '../plugins/url-fetch/adapter.mjs';

function json(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

async function body(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 12_000_000) throw new Error('请求体过大');
  }
  return text ? JSON.parse(text) : {};
}

async function binaryBody(request, maxBytes = 100_000_000) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > maxBytes) throw new Error('备份包超过 100 MB 限制'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

async function startSystemRoutes(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-routes-'));
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    try {
      const handled = await handleSystemRoutes({
        request, response, pathname: url.pathname, searchParams: url.searchParams,
        root, config: {}, store: {}, json, body, binaryBody, createWorkbenchBackup: async () => {},
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

const ADMIN_HEADER = { 'x-admin-confirm': 'TRUSTED-LOCAL-PLUGIN' };

test('技能包变更类路由缺少受信确认头时一律拒绝', async (t) => {
  const base = await startSystemRoutes(t);
  const cases = [
    { method: 'POST', path: '/api/system/skill-packages/install', headers: { 'content-type': 'application/zip' }, payload: Buffer.from('PK\x03\x04') },
    { method: 'POST', path: '/api/system/skills/demo/update', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ directory: '/tmp/x' }) },
    { method: 'PATCH', path: '/api/system/skills/demo/status', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ status: 'disabled' }) },
    { method: 'DELETE', path: '/api/system/skills/demo', headers: {}, payload: null },
  ];
  for (const item of cases) {
    const response = await fetch(`${base}${item.path}`, { method: item.method, headers: item.headers, body: item.payload });
    assert.equal(response.status, 400, `${item.method} ${item.path} 不应放行`);
    const result = await response.json();
    assert.match(result.error, /受信安装确认/, `${item.method} ${item.path} 应提示缺少确认头`);
  }
});

test('技能包路由带受信确认头后进入正常校验流程', async (t) => {
  const base = await startSystemRoutes(t);
  const response = await fetch(`${base}/api/system/skills/demo/status`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', ...ADMIN_HEADER },
    body: JSON.stringify({ status: 'disabled' }),
  });
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.doesNotMatch(result.error, /受信安装确认/);
});

function tempFile(dir, name, content) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

test('备份包拒绝路径穿越、绝对路径与重复条目', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-slip-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const payload = tempFile(dir, 'payload.txt', 'x');
  const badNames = ['../evil.txt', '..\\evil.txt', '/abs.txt', 'data/../../evil.txt'];
  for (const name of badNames) {
    const zip = createZip([{ name, path: payload }]);
    assert.throws(() => readStoredZip(zip), /非法文件路径/, `应拒绝条目 ${name}`);
  }
  const duplicate = createZip([{ name: 'manifest.json', path: payload }, { name: 'manifest.json', path: payload }]);
  assert.throws(() => validateWorkbenchBackup(duplicate), /非法文件路径/);
});

test('内网地址判定覆盖保留段与映射地址', () => {
  const blocked = ['10.0.0.1', '127.0.0.1', '0.0.0.0', '100.64.0.1', '169.254.1.1', '172.16.0.1',
    '192.0.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1',
    '::1', '::', 'fc00::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1'];
  for (const address of blocked) assert.equal(privateIp(address), true, `${address} 应判定为内网/保留`);
  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'];
  for (const address of allowed) assert.equal(privateIp(address), false, `${address} 应判定为公网`);
});

test('url-fetch 插件拒绝本机与内网目标', async () => {
  const cases = ['http://127.0.0.1:1200/feed', 'http://2130706433/', 'http://[::1]/', 'http://localhost/', 'https://192.168.0.1/'];
  for (const targetUrl of cases) {
    const result = await urlFetchExecute({ targetUrl });
    assert.equal(result.status, 'error', `${targetUrl} 应被拒绝`);
    assert.equal(result.error.code, 'INVALID_INPUT');
    assert.match(result.error.message, /本机|内网/);
  }
});

test('远程插件响应超过大小限制即中断读取', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-adapter-'));
  try {
    const manifest = {
      type: 'api', endpoint: 'https://example.com/api', allowedDomains: ['example.com'],
      timeoutMs: 5000, maxResponseBytes: 64, credentialProfile: 'missing-profile',
    };
    const chunk = Buffer.alloc(128, 65);
    const fetchImpl = async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(chunk); controller.enqueue(chunk); controller.close(); },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const dnsLookup = async () => [{ address: '93.184.216.34' }];
    const adapter = createRemoteAdapter({ root, manifest, dependencies: { fetchImpl, dnsLookup } });
    const result = await adapter.execute({});
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'FETCH_FAILED');
    assert.match(result.error.message, /大小限制/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('artifact 预览标题的双引号被转义，无法注入属性', async () => {
  const { imageArtifactPreviewHtml } = await import('../lib/artifacts/artifact-preview.mjs');
  const html = imageArtifactPreviewHtml('/content/x.png', 'x" onerror="alert(1)');
  assert.ok(!html.includes('alt="x" onerror='), 'title 中的双引号必须被转义');
  assert.ok(html.includes('&quot;'));
});
