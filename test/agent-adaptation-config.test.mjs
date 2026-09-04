import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildAdaptation, loadAdaptationMessages, loadAgentAdaptation, requireAgentAdaptation } from '../server/platform/agent/resource-adaptation.mjs';

// Agent 适配声明挪到 capability-consumers.json 的 adaptation 字段，config 是运行时唯一事实来源。

const projectRoot=path.resolve(import.meta.dirname,'..');

function makeRoot(t,mutate){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-adaptation-config-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'config'),{recursive:true});
  const consumers=JSON.parse(fs.readFileSync(path.join(projectRoot,'config','capability-consumers.json'),'utf8'));
  mutate?.(consumers);
  fs.writeFileSync(path.join(dir,'config','capability-consumers.json'),JSON.stringify(consumers));
  return dir;
}

test('loadAgentAdaptation：真实 config 三个 agent 条目均有合法 adaptation 声明',()=>{
  const editorial=loadAgentAdaptation(projectRoot,'agent.editorial');
  assert.deepEqual(editorial,{resourceSources:[{source:'hotspotSources'},{source:'candidateUrls'},{source:'project'}],resultHandlers:{},defaultResultHandler:'sanitize-only',handlerOptions:{}});
  const tutorial=loadAgentAdaptation(projectRoot,'agent.independent-writing');
  assert.deepEqual(tutorial,{resourceSources:[{source:'materials',limit:5},{source:'documentRoots'},{source:'project'}],resultHandlers:{'cap_filesystem_project_read':'project-fact-attachment'},defaultResultHandler:'fact-attachment',handlerOptions:{}});
  const social=loadAgentAdaptation(projectRoot,'agent.custom-social');
  assert.deepEqual(social,{resourceSources:[{source:'materials',limit:8},{source:'documentRoots'},{source:'project'}],resultHandlers:{},defaultResultHandler:'fact-attachment',handlerOptions:{entryPoint:'custom-social',collectSources:true}});
});

test('config 驱动与内联声明的 buildAdaptation 行为一致（资源目录 + 参数改写）',(t)=>{
  const root=makeRoot(t);
  const inputs={materialUrls:['https://a.example.com/1','https://b.example.com/2'],answer:'参考 https://c.example.com/3',documentRoots:['/docs'],projectPath:'/proj'};
  const fromConfig=buildAdaptation({adaptation:loadAgentAdaptation(root,'agent.independent-writing'),inputs,workspaceRoot:root});
  const inline=buildAdaptation({adaptation:{resourceSources:[{source:'materials',limit:5},{source:'documentRoots'},{source:'project'}],resultHandlers:{'cap_filesystem_project_read':'project-fact-attachment'},defaultResultHandler:'fact-attachment'},inputs,workspaceRoot:root});
  assert.deepEqual([...fromConfig.resources.entries()],[...inline.resources.entries()]);
  assert.deepEqual([...fromConfig.resources.keys()],['material:1','material:2','material:3','document-root:1','project:current']);
  const request={capability:'cap_content_url_fetch'};
  assert.deepEqual(fromConfig.resolveArguments({resourceId:'material:1'},request),inline.resolveArguments({resourceId:'material:1'},request));
});

test('config 缺失或无 adaptation 字段时读取器返回 null，运行时要求显式配置',(t)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-adaptation-empty-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  assert.equal(loadAgentAdaptation(dir,'agent.editorial'),null,'登记文件缺失回退 null');
  const root=makeRoot(t,(consumers)=>{delete consumers.consumers.find((item)=>item.id==='agent.editorial').adaptation;});
  assert.equal(loadAgentAdaptation(root,'agent.editorial'),null,'条目无 adaptation 字段回退 null');
  assert.throws(()=>requireAgentAdaptation(dir,'agent.editorial'),/缺少统一 adaptation 配置/);
  assert.throws(()=>requireAgentAdaptation(root,'agent.editorial'),/缺少统一 adaptation 配置/);
});

test('非法 source / handler 名在读取处报错',(t)=>{
  const badSource=makeRoot(t,(consumers)=>{consumers.consumers.find((item)=>item.id==='agent.editorial').adaptation.resourceSources.push({source:'bogus-source'});});
  assert.throws(()=>loadAgentAdaptation(badSource,'agent.editorial'),/未知资源注册器/);
  const badHandler=makeRoot(t,(consumers)=>{consumers.consumers.find((item)=>item.id==='agent.custom-social').adaptation.resultHandlers={'cap_content_web_search':'bogus-handler'};});
  assert.throws(()=>loadAgentAdaptation(badHandler,'agent.custom-social'),/未知结果处理器/);
  const badDefault=makeRoot(t,(consumers)=>{consumers.consumers.find((item)=>item.id==='agent.editorial').adaptation.defaultResultHandler='bogus';});
  assert.throws(()=>loadAgentAdaptation(badDefault,'agent.editorial'),/默认结果处理器未知/);
});

test('inputs 缺某来源时该注册器跳过不炸（空输入不产出条目）',()=>{
  const adaptation=buildAdaptation({adaptation:{resourceSources:[{source:'hotspotSources'},{source:'candidateUrls'},{source:'project'},{source:'materials',limit:5},{source:'documentRoots'}]},inputs:{}});
  assert.deepEqual([...adaptation.resources.keys()],[]);
});

test('materials 的 limit 来自声明条目（去重 + 截断语义同 mergeMaterialUrls）',()=>{
  const inputs={materialUrls:['https://a.example.com/1','https://a.example.com/1','https://b.example.com/2'],answer:'见 https://c.example.com/3 与 https://d.example.com/4'};
  const limited=buildAdaptation({adaptation:{resourceSources:[{source:'materials',limit:3}]},inputs});
  assert.deepEqual([...limited.resources.keys()],['material:1','material:2','material:3']);
});

// 阶段 5：授权拒绝文案外置到 config/agent-adaptation-messages.json，按 consumerId + capability 二维维护。
function makeMessagesRoot(t,messages){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-adaptation-messages-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'config'),{recursive:true});
  fs.writeFileSync(path.join(dir,'config','agent-adaptation-messages.json'),JSON.stringify({schemaVersion:1,messages}));
  return dir;
}

test('文案按 consumerId + capability 命中配置（二维结构）',(t)=>{
  const dir=makeMessagesRoot(t,{'agent.editorial':{'cap_filesystem_project_read':'配置里的项目文案'}});
  assert.deepEqual(loadAdaptationMessages(dir,'agent.editorial'),{'cap_filesystem_project_read':'配置里的项目文案'});
  const adaptation=buildAdaptation({workspaceRoot:dir,consumerId:'agent.editorial'});
  const denied=adaptation.resolveArguments.bind(null,{resourceId:'project:current'},{capability:'cap_filesystem_project_read'});
  assert.throws(denied,(error)=>error.code==='RESOURCE_NOT_ALLOWED'&&error.message==='配置里的项目文案');
});

test('不同 agent 同一 capability 文案不同',(t)=>{
  const dir=makeMessagesRoot(t,{
    'agent.editorial':{'cap_content_url_fetch':'资源不属于当前候选'},
    'agent.custom-social':{'cap_content_url_fetch':'素材 URL 未授权'},
  });
  const editorial=buildAdaptation({workspaceRoot:dir,consumerId:'agent.editorial'});
  const social=buildAdaptation({workspaceRoot:dir,consumerId:'agent.custom-social'});
  const request={capability:'cap_content_url_fetch'};
  assert.throws(editorial.resolveArguments.bind(null,{resourceId:'material:9'},request),(error)=>error.message==='资源不属于当前候选');
  assert.throws(social.resolveArguments.bind(null,{resourceId:'material:9'},request),(error)=>error.message==='素材 URL 未授权');
});

test('agent 条目内未覆盖的 capability 回退档案内联兜底文案',(t)=>{
  const dir=makeMessagesRoot(t,{'agent.custom-social':{'cap_content_url_fetch':'素材 URL 未授权'}});
  const adaptation=buildAdaptation({workspaceRoot:dir,consumerId:'agent.custom-social'});
  const denied=adaptation.resolveArguments.bind(null,{resourceId:'document-root:9'},{capability:'cap_content_document_search'});
  assert.throws(denied,(error)=>error.code==='RESOURCE_NOT_ALLOWED'&&error.message==='文档目录未授权');
});

test('JSON 缺失或无该 agent 条目时回退档案内联兜底文案（嵌入式/测试工作区）',(t)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-adaptation-messages-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  assert.deepEqual(loadAdaptationMessages(dir,'agent.editorial'),{},'文件缺失回退 {}');
  const empty=makeMessagesRoot(t,{'agent.editorial':{'cap_content_url_fetch':'资源不属于当前候选'}});
  assert.deepEqual(loadAdaptationMessages(empty,'agent.custom-social'),{},'无该 agent 条目回退 {}');
  const adaptation=buildAdaptation({workspaceRoot:dir,consumerId:'agent.editorial'});
  const denied=adaptation.resolveArguments.bind(null,{resourceId:'project:current'},{capability:'cap_filesystem_project_read'});
  assert.throws(denied,(error)=>error.code==='RESOURCE_NOT_ALLOWED'&&error.message==='项目资源不属于当前请求');
});

test('真实 config 三个 agent 条目的文案与迁移前各 Adapter 内联文案一致',()=>{
  assert.deepEqual(loadAdaptationMessages(projectRoot,'agent.editorial'),{
    'cap_filesystem_project_read':'项目资源不属于当前请求',
    'cap_content_url_fetch':'资源不属于当前候选',
    'cap_content_passage_retrieve':'段落资源不存在、未抓取或不属于当前候选',
  });
  assert.deepEqual(loadAdaptationMessages(projectRoot,'agent.independent-writing'),{
    'cap_filesystem_project_read':'项目资源不属于当前请求',
    'cap_content_url_fetch':'URL 资源不属于当前请求',
    'cap_content_document_search':'文档目录未授权',
  });
  assert.deepEqual(loadAdaptationMessages(projectRoot,'agent.custom-social'),{
    'cap_content_url_fetch':'素材 URL 未授权',
    'cap_content_repository_inspect':'仓库不属于用户授权的 GitHub 素材',
    'cap_content_document_search':'文档目录未授权',
  });
});
