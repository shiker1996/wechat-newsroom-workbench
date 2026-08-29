import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { handleContentRoutes } from '../server/platform/http/routes/content-routes.mjs';

function json(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

test('JSON 产物预览允许工作台 iframe 同源嵌入', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-preview-route-'));
  const filePath = path.join(root, 'event-heat-ranking.json');
  fs.writeFileSync(filePath, '{"items":[{"title":"事件热榜"}]}', 'utf8');
  const artifact = {
    id: 7,
    name: path.basename(filePath),
    file_path: filePath,
  };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const handled = await handleContentRoutes({
      request,
      response,
      pathname: url.pathname,
      searchParams: url.searchParams,
      store: { getArtifact: (id) => id === artifact.id ? artifact : null },
      artifactRoots: [root],
      mime: { '.json': 'application/json; charset=utf-8' },
      json,
    });
    if (!handled && !response.writableEnded) {
      response.writeHead(404);
      response.end();
    }
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const preview = await fetch(`${baseUrl}/api/artifacts/${artifact.id}/preview`);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-security-policy') || '', /frame-ancestors 'self'/);
    const previewHtml = await preview.text();
    assert.match(previewHtml, /<title>event-heat-ranking\.json<\/title>/);
    assert.match(previewHtml, /\{"items":\[\{"title":"事件热榜"\}\]\}/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
