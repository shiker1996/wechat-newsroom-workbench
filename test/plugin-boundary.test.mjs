import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditPluginBoundaries, scanPluginBoundaries } from '../server/platform/plugins/boundary-audit.mjs';

const root=path.resolve(import.meta.dirname,'..');

test('插件边界基线冻结现有耦合且禁止新增违规',()=>{
  const result=auditPluginBoundaries(root);
  assert.deepEqual(result.newViolations,[],`发现新增插件边界违规：\n${result.newViolations.map((item)=>`${item.file} -> ${item.evidence}`).join('\n')}`);
  assert.deepEqual(result.invalidBaseline,[],`边界基线缺少治理字段：${result.invalidBaseline.map((item)=>item.id).join('、')}`);
});

test('插件边界扫描覆盖全部违规类型且不依赖仓库保留违规',()=>{
  const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'plugin-boundary-'));
  try{
    for(const name of ['alpha','beta','shared'])fs.mkdirSync(path.join(fixture,'plugins',name),{recursive:true});
    fs.writeFileSync(path.join(fixture,'plugins','alpha','index.mjs'),`import '../beta/index.mjs';\nimport '../shared/result.mjs';\nimport '../../../server/host.mjs';\nconst a=path.join(root,'scripts','job.py');\nconst b=process.env.USERPROFILE;`);
    fs.writeFileSync(path.join(fixture,'plugins','beta','index.mjs'),'export default 1;');
    fs.writeFileSync(path.join(fixture,'plugins','shared','result.mjs'),'export default 1;');
    const types=new Set(scanPluginBoundaries(fixture).map((item)=>item.type));
    for(const type of ['cross-plugin','shared-source','project-source','project-script','user-runtime'])assert.ok(types.has(type),`扫描器未覆盖 ${type}`);
  }finally{fs.rmSync(fixture,{recursive:true,force:true});}
});
