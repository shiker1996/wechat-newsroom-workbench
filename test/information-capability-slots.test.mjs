import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  INFORMATION_CAPABILITY_SLOTS,
  executeCapabilityWithPreference,
  listInformationCapabilitySlots,
  preferredPluginForCapability,
  setInformationCapabilitySlot,
} from '../server/platform/tools/capability-slots.mjs';

test('information slots expose stable writing-oriented capability contracts',()=>{
  assert.deepEqual(INFORMATION_CAPABILITY_SLOTS.map((item)=>item.id),[
    'web-page','web-search','news-search','repository','document','local-project',
  ]);
  assert.equal(INFORMATION_CAPABILITY_SLOTS.find((item)=>item.id==='repository').capability,'content.repository.inspect');
});

test('information slots report connected and missing implementations explicitly',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'information-slots-'));
  try{
    const items=await listInformationCapabilitySlots(root);
    assert.equal(items.find((item)=>item.id==='web-page').available,true);
    assert.equal(items.find((item)=>item.id==='repository').selectedPlugin,'repository-inspector');
    assert.equal(items.find((item)=>item.id==='web-search').selectedPlugin,'tavily-search');
    assert.equal(items.find((item)=>item.id==='news-search').selectedPlugin,'tavily-search');
    assert.equal(items.find((item)=>item.id==='document').selectedPlugin,'document-folder-search');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('slot implementation preference is validated and persisted',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'information-slot-setting-'));
  try{
    const selected=await setInformationCapabilitySlot(root,'web-page','url-fetch');
    assert.equal(selected.preferredPlugin,'url-fetch');
    assert.equal(selected.selectedPlugin,'url-fetch');
    await assert.rejects(setInformationCapabilitySlot(root,'web-page','repository-inspector'),/不实现该能力/);
    const cleared=await setInformationCapabilitySlot(root,'web-page','');
    assert.equal(cleared.preferredPlugin,'');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('external information flows call slots instead of binding plugin implementations',()=>{
  const source=fs.readFileSync(new URL('../server/platform/integrations/source-fetcher.mjs',import.meta.url),'utf8');
  const project=fs.readFileSync(new URL('../server/platform/integrations/local-project-reader.mjs',import.meta.url),'utf8');
  const repository=fs.readFileSync(new URL('../server/platform/integrations/repository-inspector.mjs',import.meta.url),'utf8');
  assert.match(source,/executeInformationCapabilitySlot\('web-page'/);
  assert.match(project,/executeInformationCapabilitySlot\('local-project'/);
  assert.match(repository,/executeInformationCapabilitySlot\('repository'/);
});

test('slot list covers every registered capability, not only the fixed six',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'all-capability-slots-'));
  try{
    const items=await listInformationCapabilitySlots(root);
    const ids=items.map((item)=>item.id);
    // 固定 6 个信息槽位仍在
    for(const id of ['web-page','web-search','news-search','repository','document','local-project'])assert.ok(ids.includes(id));
    // 其余注册能力以能力名自动生成槽位
    assert.ok(ids.includes('content.passage.retrieve'));
    assert.ok(ids.includes('diagram.mermaid.render'));
    assert.ok(ids.includes('image.cdn.upload'));
    const passage=items.find((item)=>item.id==='content.passage.retrieve');
    assert.equal(passage.stage,'工具能力');
    assert.equal(passage.selectedPlugin,'local-passage-retrieval');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('capability-level preference can be set by capability id and honored on execute',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'capability-pref-'));
  try{
    const selected=await setInformationCapabilitySlot(root,'content.passage.retrieve','local-passage-retrieval');
    assert.equal(selected.preferredPlugin,'local-passage-retrieval');
    assert.equal(preferredPluginForCapability(root,'content.passage.retrieve'),'local-passage-retrieval');
    await assert.rejects(setInformationCapabilitySlot(root,'content.passage.retrieve','url-fetch'),/不实现该能力/);
    await assert.rejects(setInformationCapabilitySlot(root,'no.such.capability','url-fetch'),/未知能力槽位/);
    const result=await executeCapabilityWithPreference(root,'content.passage.retrieve',{documents:[{id:'a',content:'测试内容 '.repeat(100)}],query:'测试'});
    assert.equal(result.status,'ok');
    assert.equal(result.provenance.plugin,'local-passage-retrieval');
    // 固定槽位的偏好同样能被能力级查询命中
    await setInformationCapabilitySlot(root,'web-page','url-fetch');
    assert.equal(preferredPluginForCapability(root,'content.url.fetch'),'url-fetch');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('skills and plugins page shows slot status and supports implementation selection',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const skills=fs.readFileSync(new URL('../public/src/views/skills.js',import.meta.url),'utf8');
  assert.match(html,/id="information-slot-list"/);
  assert.match(html,/id="information-slot-summary"/);
  assert.match(html,/能力所需工具/);
  assert.doesNotMatch(skills,/\/api\/system\/information-capability-slots/);
  assert.match(skills,/\/api\/system\/capability-routes/);
  assert.match(skills,/data-capability-route/);
});
