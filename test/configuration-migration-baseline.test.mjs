import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_FIELDS } from '../server/platform/integrations/runtime-settings.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const inventory=JSON.parse(fs.readFileSync(path.join(root,'test','fixtures','configuration-migration-inventory.json'),'utf8'));
const entries=inventory.entries;
const leaves=(value,prefix='',into=[])=>{if(value&&typeof value==='object'&&!Array.isArray(value)){for(const [key,item] of Object.entries(value))leaves(item,prefix?`${prefix}.${key}`:key,into);}else into.push(prefix);return into;};
const matches=(pattern,key)=>new RegExp(`^${pattern.split('.').map((part)=>part==='*'?'[^.]+':part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\.')}$`).test(key);

test('阶段 0 清单覆盖全部旧 env 与 config 示例字段',()=>{
  const envPaths=entries.filter((item)=>item.source==='env').map((item)=>item.path).sort();
  assert.deepEqual(APP_FIELDS,[],'运行时不应重新暴露项目根 .env 业务字段');
  assert.ok(envPaths.length>0,'历史迁移清单应保留已迁移 env 字段用于审计');
  const config=JSON.parse(fs.readFileSync(path.join(root,'config.example.json'),'utf8'));
  const patterns=entries.filter((item)=>item.source==='config').map((item)=>item.path);
  const missing=leaves(config).filter((key)=>!patterns.some((pattern)=>matches(pattern,key)));
  assert.deepEqual(missing,[],`存在未分类旧配置：${missing.join(', ')}`);
  assert.ok(entries.some((item)=>item.source==='rsshub-env'&&item.path==='*'&&item.secret));
});

test('阶段 0 每项配置都有目标、秘密属性和可验证消费点',()=>{
  for(const item of entries){
    assert.equal(typeof item.secret,'boolean',`${item.source}:${item.path} 缺少 secret`);
    assert.match(item.target,/^[a-z][a-z-]*:/,`${item.source}:${item.path} 缺少目标归属`);
    assert.equal(typeof item.consumer?.file,'string',`${item.path} 缺少历史消费文件`);
    assert.equal(typeof item.consumer?.token,'string',`${item.path} 缺少历史消费标记`);
  }
});

test('脱敏快照生成器不会输出秘密原值',()=>{
  const source=fs.readFileSync(path.join(root,'scripts','quality','snapshot-legacy-configuration.mjs'),'utf8');
  assert.match(source,/item\.secret\?\{\}:\{value:/);
  assert.match(source,/valueHash:digest/);
  assert.doesNotMatch(source,/secretValue|plaintext/);
});
