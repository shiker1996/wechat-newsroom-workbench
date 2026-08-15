import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  addCapabilityCatalogEntries, catalogDraftsForManifest, findUnregisteredCapabilities, readCapabilityCatalog,
} from '../lib/tools/capability-catalog.mjs';
import { checkConsumerCapabilityGates, checkConsumerCapabilityWarnings } from '../scripts/check-consumer-capability-gates.mjs';

// 阶段 1 顺序规则收口（docs/design/capability-onboarding-configurability-plan.md §7）：
// R2 目录外能力的实现不得启用/不得设首选；R4 门禁 warning；R3 目录草案确认入库。

const projectRoot=path.resolve(import.meta.dirname,'..');

function makeRoot(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capability-onboarding-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'config'),{recursive:true});
  fs.copyFileSync(path.join(projectRoot,'config','capabilities.json'),path.join(dir,'config','capabilities.json'));
  return dir;
}

test('R2：真实仓库没有任何目录外能力的实现（收口前基线）',()=>{
  assert.deepEqual(checkConsumerCapabilityGates(projectRoot),[]);
  assert.deepEqual(checkConsumerCapabilityWarnings(projectRoot),[]);
});

test('R2：findUnregisteredCapabilities 识别目录外能力',(t)=>{
  const root=makeRoot(t);
  assert.deepEqual(findUnregisteredCapabilities(root,['content.web.search']),[]);
  assert.deepEqual(findUnregisteredCapabilities(root,['remote.demo','content.web.search','remote.demo']),['remote.demo']);
});

test('R2：六个启用/首选写路径均带 CAPABILITY_NOT_REGISTERED 拦截',()=>{
  const routes=fs.readFileSync(path.join(projectRoot,'lib','http','routes','system-routes.mjs'),'utf8');
  assert.match(routes,/code:'CAPABILITY_NOT_REGISTERED'/);
  // 路由首选 + 内置工具启用 + 第三方本地工具启用 + 远程插件启用 + 采集器运行启用 + 采集器状态启用
  assert.equal((routes.match(/rejectUnregistered\(/g)||[]).length,6);
  assert.match(routes,/capability-routes[\s\S]*?rejectUnregistered\(\[capability\],'设为路由首选'\)/);
});

test('R3：远程 Manifest 声明目录外能力时生成保守占位草案',(t)=>{
  const root=makeRoot(t);
  const manifest={id:'remote-demo',name:'Remote Demo',capabilities:['content.web.search','remote.demo']};
  const drafts=catalogDraftsForManifest(root,manifest);
  assert.equal(drafts.length,1);
  assert.equal(drafts[0].id,'remote.demo');
  assert.equal(drafts[0].needsCompletion,true);
  assert.ok(drafts[0].name&&drafts[0].description&&drafts[0].category);
  assert.match(drafts[0].description,/Remote Demo/);
});

test('R3：草案确认入库后转为已登记（门禁转绿路径），重复/非法条目被拒',(t)=>{
  const root=makeRoot(t);
  assert.deepEqual(findUnregisteredCapabilities(root,['remote.demo']),['remote.demo']);
  assert.throws(()=>addCapabilityCatalogEntries(root,[{id:'remote.demo',name:'',description:'演示',category:'扩展能力'}]),/目录条目无效/);
  assert.throws(()=>addCapabilityCatalogEntries(root,[{id:'REMOTE.DEMO',name:'演示',description:'演示能力',category:'扩展能力'}]),/目录条目无效/);
  const added=addCapabilityCatalogEntries(root,[{id:'remote.demo',name:'演示能力',description:'远程演示工具提供的能力。',category:'扩展能力'}]);
  assert.deepEqual(added.map((item)=>item.id),['remote.demo']);
  assert.deepEqual(findUnregisteredCapabilities(root,['remote.demo']),[]);
  assert.equal(readCapabilityCatalog(root).capabilities['remote.demo'].registered,true);
  assert.throws(()=>addCapabilityCatalogEntries(root,[{id:'remote.demo',name:'演示',description:'重复入库',category:'扩展能力'}]),/已在目录中/);
});

test('R4：实现声明目录外能力时门禁输出 warning（不阻断）',(t)=>{
  const root=makeRoot(t);
  fs.mkdirSync(path.join(root,'data'),{recursive:true});
  fs.writeFileSync(path.join(root,'data','remote-tool-plugins.json'),JSON.stringify({schemaVersion:1,plugins:{
    'remote-demo':{id:'remote-demo',status:'disabled',manifest:{capabilities:['remote.demo']}},
  }}));
  const warnings=checkConsumerCapabilityWarnings(root);
  assert.equal(warnings.length,1);
  assert.match(warnings[0],/remote\.demo/);
  assert.match(warnings[0],/未登记/);
  // 入库后 warning 消除
  addCapabilityCatalogEntries(root,[{id:'remote.demo',name:'演示能力',description:'远程演示工具提供的能力。',category:'扩展能力'}]);
  assert.deepEqual(checkConsumerCapabilityWarnings(root),[]);
});

test('页面：能力页签未登记分区与扩展工作室草案交互已接线',()=>{
  const skills=fs.readFileSync(path.join(projectRoot,'public','src','views','skills.js'),'utf8');
  const html=fs.readFileSync(path.join(projectRoot,'public','index.html'),'utf8');
  const styles=fs.readFileSync(path.join(projectRoot,'public','styles.css'),'utf8');
  assert.match(skills,/capability-unregistered-head/);
  assert.match(skills,/未登记 · 仅调试/);
  assert.match(skills,/registered===false/);
  assert.match(skills,/renderCatalogDrafts/);
  assert.match(skills,/catalogDrafts/);
  assert.match(skills,/POST","confirmation": "plugin-admin"[\s\S]*?capability-catalog|\/api\/system\/capability-catalog/);
  assert.match(html,/id="catalog-draft-panel"/);
  assert.match(html,/id="catalog-draft-submit"/);
  assert.match(styles,/\.capability-unregistered-badge/);
  assert.match(styles,/\.catalog-draft-item/);
});
