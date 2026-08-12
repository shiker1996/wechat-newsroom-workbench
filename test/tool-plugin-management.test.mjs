import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const routes=fs.readFileSync(new URL('../lib/http/routes/system-routes.mjs',import.meta.url),'utf8');
const registry=fs.readFileSync(new URL('../lib/tools/registry.mjs',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../lib/tools/index.mjs',import.meta.url),'utf8');

test('插件管理 API 具备变更确认、即时重载和单项检查',()=>{
  assert.match(routes,/\/api\\\/system\\\/tool-plugins/);
  assert.match(routes,/validateDisableImpact/);
  assert.match(routes,/requiresImpactConfirmation:true/);
  assert.match(routes,/impactVersion/);
  assert.match(routes,/writeToolPluginSetting/);
  assert.match(routes,/await reloadToolRegistry\(\)/);
  assert.match(routes,/toolPluginTestMatch/);
});

test('注册中心对业务调用隐藏停用实现并保留管理视图',()=>{
  assert.match(registry,/listCapabilities\(\{ includeDisabled = false \}/);
  assert.match(registry,/listPlugins\(\)/);
  assert.match(registry,/\.sort\(\(left,right\)=>this\.\#state\(right\.manifest\)\.priority/);
  assert.match(index,/readToolPluginSettings\(root\)/);
  assert.match(index,/export function reloadToolRegistry/);
});
