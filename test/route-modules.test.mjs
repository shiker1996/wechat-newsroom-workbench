import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('server delegates isolated functional route modules', () => {
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  for (const handler of [
    'handleModelRoutes',
    'handleContentRoutes',
    'handleSystemRoutes',
    'handleMediaRoutes',
    'handleArticleRoutes',
    'handleSocialCardRoutes',
  ]) {
    assert.match(server, new RegExp(`${handler}\\(`));
  }
  assert.doesNotMatch(server, /pathname === '\/api\/models'/);
  assert.doesNotMatch(server, /pathname === '\/api\/artifacts'/);
  assert.doesNotMatch(server, /pathname === '\/api\/system\/health'/);
  assert.doesNotMatch(server, /\/visual-preview/);
  assert.doesNotMatch(server, /\/card-editorial/);
  assert.doesNotMatch(server, /\/ai\\\/editorial/);
});
