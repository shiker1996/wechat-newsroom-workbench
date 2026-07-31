import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  INFORMATION_CAPABILITY_SLOTS,
  listInformationCapabilitySlots,
  setInformationCapabilitySlot,
} from '../lib/tools/capability-slots.mjs';

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
    await assert.rejects(setInformationCapabilitySlot(root,'web-page','repository-inspector'),/不实现该信息能力/);
    const cleared=await setInformationCapabilitySlot(root,'web-page','');
    assert.equal(cleared.preferredPlugin,'');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('external information flows call slots instead of binding plugin implementations',()=>{
  const source=fs.readFileSync(new URL('../lib/integrations/source-fetcher.mjs',import.meta.url),'utf8');
  const project=fs.readFileSync(new URL('../lib/integrations/local-project-reader.mjs',import.meta.url),'utf8');
  const repository=fs.readFileSync(new URL('../lib/integrations/repository-inspector.mjs',import.meta.url),'utf8');
  assert.match(source,/executeInformationCapabilitySlot\('web-page'/);
  assert.match(project,/executeInformationCapabilitySlot\('local-project'/);
  assert.match(repository,/executeInformationCapabilitySlot\('repository'/);
});

test('skills and plugins page shows slot status and supports implementation selection',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const skills=fs.readFileSync(new URL('../public/src/views/skills.js',import.meta.url),'utf8');
  assert.match(html,/id="information-slot-list"/);
  assert.match(html,/id="information-slot-summary"/);
  assert.match(html,/写作所需的信息能力/);
  assert.match(skills,/\/api\/system\/information-capability-slots/);
  assert.match(skills,/data-information-slot/);
  assert.match(skills,/data-connect-information-tool/);
  assert.match(skills,/selectCapabilityTab\("extensions"\)/);
});
