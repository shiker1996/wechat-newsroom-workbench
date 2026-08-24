import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkConsumerCapabilityGates } from '../scripts/quality/check-consumer-capability-gates.mjs';

// 阶段 6 治理门禁（设计文档 §10 阶段 6）：真实仓库必须无违规；
// 反向场景（声明无适配、适配未登记）必须被门禁捕获。

const projectRoot=path.resolve(import.meta.dirname,'..');

function makeRoot(t,mutate){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'consumer-gates-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'config'),{recursive:true});
  fs.mkdirSync(path.join(dir,'skills'),{recursive:true});
  const consumers=JSON.parse(fs.readFileSync(path.join(projectRoot,'config','capability-consumers.json'),'utf8'));
  mutate?.(consumers);
  fs.writeFileSync(path.join(dir,'config','capability-consumers.json'),JSON.stringify(consumers));
  fs.copyFileSync(path.join(projectRoot,'config','capabilities.json'),path.join(dir,'config','capabilities.json'));
  return dir;
}

test('真实仓库通过消费者—能力治理门禁',()=>{
  assert.deepEqual(checkConsumerCapabilityGates(projectRoot),[]);
});

test('门禁 A：登记声明但适配缺失（adapterStatus=missing）被捕获',(t)=>{
  const root=makeRoot(t,(consumers)=>{
    consumers.consumers.find((item)=>item.id==='agent.editorial').dependencies
      .find((item)=>item.capability==='content.web.search').adapterStatus='missing';
  });
  const issues=checkConsumerCapabilityGates(root);
  assert.ok(issues.some((issue)=>issue.includes('agent.editorial/content.web.search')&&issue.includes('适配缺失')),issues.join('\n'));
});

test('门禁 B：适配已接线但未登记被捕获；命中档案表的资源类登记超出常量放行（纯参数超出放行）',(t)=>{
  const missing=makeRoot(t,(consumers)=>{
    const agent=consumers.consumers.find((item)=>item.id==='agent.custom-social');
    agent.dependencies=agent.dependencies.filter((item)=>item.capability!=='content.repository.inspect');
  });
  assert.ok(checkConsumerCapabilityGates(missing).some((issue)=>issue.includes('agent.custom-social')&&issue.includes('content.repository.inspect')&&issue.includes('未在登记中声明')));
  // content.document.search 命中 resourceKind 档案表（默认适配路径），登记了但常量未含 → 合法
  const extra=makeRoot(t,(consumers)=>{
    consumers.consumers.find((item)=>item.id==='agent.editorial').dependencies.push({
      capability:'content.document.search',requirement:'optional',failurePolicy:'continue-with-warning',
      declaration:'optional',adapterStatus:'ready',resourceKinds:[],triggerPolicy:'model-request',
      authorizationAction:null,resultPolicy:'passthrough',source:'builtin',
    });
  });
  assert.deepEqual(checkConsumerCapabilityGates(extra),[]);
  // 纯参数能力登记超出常量 → 放行（机制二：登记即生效）
  const pure=makeRoot(t,(consumers)=>{
    consumers.consumers.find((item)=>item.id==='agent.editorial').dependencies.push({
      capability:'vendor.pure.lookup',requirement:'optional',failurePolicy:'continue-with-warning',
      declaration:'optional',adapterStatus:'ready',resourceKinds:[],triggerPolicy:'model-request',
      authorizationAction:null,resultPolicy:'passthrough',source:'builtin',
    });
  });
  assert.deepEqual(checkConsumerCapabilityGates(pure),[]);
});

test('门禁 A：内置技能 Manifest 声明了消费者未登记的能力被捕获',(t)=>{
  const root=makeRoot(t);
  fs.mkdirSync(path.join(root,'skills','rogue-skill'),{recursive:true});
  fs.writeFileSync(path.join(root,'skills','rogue-skill','skill.json'),JSON.stringify({
    schemaVersion:1,id:'rogue-skill',name:'违规技能',version:'1.0.0',kind:'stage',
    entryPoints:['custom-social'],optionalCapabilities:['image.cdn.upload'],
  }));
  const issues=checkConsumerCapabilityGates(root);
  assert.ok(issues.some((issue)=>issue.includes('rogue-skill')&&issue.includes('image.cdn.upload')),issues.join('\n'));
});
