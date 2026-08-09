import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('server delegates isolated functional route modules', () => {
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  for (const handler of [
    'handleModelRoutes',
    'handleContentRoutes',
    'handleSystemRoutes',
    'handleMediaRoutes',
    'handleArticleRoutes',
    'handleSocialCardRoutes',
    'handleBatchRoutes',
    'handleCandidateRoutes',
    'handleTaskRoutes',
  ]) {
    assert.match(server, new RegExp(`${handler}\\(`));
  }
  assert.doesNotMatch(server, /pathname === '\/api\/models'/);
  assert.doesNotMatch(server, /pathname === '\/api\/artifacts'/);
  assert.doesNotMatch(server, /pathname === '\/api\/system\/health'/);
  assert.doesNotMatch(server, /\/visual-preview/);
  assert.doesNotMatch(server, /\/card-editorial/);
  assert.doesNotMatch(server, /\/ai\\\/editorial/);
  assert.match(server, /createRouteHelpers\(/);
});

test('服务端路由模块均可通过 Node 语法编译', () => {
  const routeDirectory=new URL('../lib/http/routes/',import.meta.url);
  const routeFiles=fs.readdirSync(routeDirectory).filter((name)=>name.endsWith('.mjs'));
  for(const name of routeFiles){
    const file=new URL(name,routeDirectory);
    const result=spawnSync(process.execPath,['--check',fileURLToPath(file)],{encoding:'utf8'});
    assert.equal(result.status,0,`${name} 编译失败：${result.stderr}`);
  }
});

test('all server route modules link through ESM with valid named exports', async () => {
  const routeDirectory = new URL('../lib/http/routes/', import.meta.url);
  const routeFiles = fs.readdirSync(routeDirectory).filter((name) => name.endsWith('.mjs'));
  for (const name of routeFiles) {
    await assert.doesNotReject(import(new URL(name, routeDirectory)), `${name} ESM link failed`);
  }
});
