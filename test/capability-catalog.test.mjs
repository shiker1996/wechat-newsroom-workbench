import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { readCapabilityCatalog } from '../lib/tools/capability-catalog.mjs';

const root=path.resolve(import.meta.dirname,'..');

test('能力目录为全部内置能力提供中文名称、描述和分类',()=>{
  const catalog=readCapabilityCatalog(root);
  for(const [id,item] of Object.entries(catalog.capabilities)){
    assert.equal(item.id,id);
    assert.ok(/[\u4e00-\u9fff]/.test(item.name),`${id} 缺少中文名称`);
    assert.ok(item.description.length>=8,`${id} 描述过短`);
    assert.ok(item.category);
  }
});
