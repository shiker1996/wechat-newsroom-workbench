import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('配置中心公开迁移覆盖率与 legacy fallback 停读条件',()=>{
  const routes=fs.readFileSync(new URL('../lib/http/routes/system-routes.mjs',import.meta.url),'utf8');
  const view=fs.readFileSync(new URL('../public/src/views/system.js',import.meta.url),'utf8');
  assert.match(routes,/configuration\/migration-status/);assert.match(routes,/readyToDisableFallback:legacyFallback===0/);
  assert.doesNotMatch(view,/configuration\/migration-status|旧配置读取|迁移覆盖率/);
});

test('用户配置说明由扫描门禁阻止重新引入旧业务配置指引',()=>{
  const script=fs.readFileSync(new URL('../scripts/check-legacy-configuration-guidance.mjs',import.meta.url),'utf8');
  assert.match(script,/\.env/);assert.match(script,/固定表单/);assert.match(script,/process\.exitCode=1/);
});
