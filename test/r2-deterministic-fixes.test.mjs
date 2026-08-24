import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('R2 备份版本、设置读取与 Reddit 管理脚本使用当前生产契约',()=>{
  const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
  const routes=fs.readFileSync(new URL('../server/platform/http/routes/system-routes.mjs',import.meta.url),'utf8');
  assert.match(server,/appVersion:APP_VERSION/);
  assert.doesNotMatch(server,/appVersion:'0\.1\.0'/);
  assert.match(routes,/request\.method === 'GET' && pathname === '\/api\/system\/settings'/);
  assert.match(routes,/plugins', 'reddit', 'scripts', 'start-chrome\.ps1'/);
  assert.match(routes,/plugins', 'reddit', 'scripts', 'stop-chrome\.ps1'/);
  assert.doesNotMatch(routes,/plugins', 'collectors', 'reddit'/);
});
