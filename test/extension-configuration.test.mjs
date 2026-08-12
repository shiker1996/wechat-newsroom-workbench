import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/core/store.mjs';
import { ExtensionConfigurationService } from '../lib/extensions/configuration-service.mjs';
import { validateConfigurationSchema, validateConfigurationValue } from '../lib/extensions/configuration-schema.mjs';
import { ToolRegistry } from '../lib/tools/registry.mjs';
import { ok } from '../lib/tools/schemas.mjs';

const schema={type:'object',additionalProperties:false,required:['endpoint','apiKey'],properties:{
  endpoint:{type:'string',title:'服务地址',format:'url'},
  apiKey:{type:'string',title:'API Key',format:'password',secret:true},
  retries:{type:'integer',title:'重试次数',minimum:0,maximum:5,default:2},
  mode:{type:'string',title:'模式',enum:['fast','safe'],enumNames:['快速','稳妥'],default:'safe'},
}};

test('安全配置 Schema 子集拒绝任意结构并校验字段值',()=>{
  assert.deepEqual(validateConfigurationSchema(schema),[]);
  assert.ok(validateConfigurationSchema({...schema,oneOf:[]}).some((item)=>item.field.endsWith('oneOf')));
  assert.ok(validateConfigurationValue(schema,{endpoint:'file:///tmp/x',apiKey:'x',retries:8,mode:'other'}).length>=3);
});

test('扩展配置与多字段秘密分离保存且公开结果不回读秘密',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'extension-config-'));const store=new Store(path.join(root,'workbench.db'));
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const service=new ExtensionConfigurationService({root,repository:store.repositories.extensionSettings});
  const manifest={configuration:schema};
  assert.equal(service.describe({extensionType:'tool',extensionId:'demo-tool',manifest}).status,'needs_configuration');
  const saved=service.save({extensionType:'tool',extensionId:'demo-tool',manifest,input:{endpoint:'https://example.com',apiKey:'secret-value',retries:3,mode:'fast'}});
  assert.equal(saved.configured,true);assert.equal(saved.values.apiKey,'__configured__');
  const row=store.getExtensionSetting('tool','demo-tool');
  assert.equal(row.value.endpoint,'https://example.com');assert.equal(JSON.stringify(row.value).includes('secret-value'),false);
  assert.equal(fs.readFileSync(path.join(root,'.env.remote-plugins'),'utf8').includes('secret-value'),true);
  assert.deepEqual(service.snapshot({extensionType:'tool',extensionId:'demo-tool',manifest}),{
    extensionType:'tool',extensionId:'demo-tool',status:'ready',configured:true,updatedAt:row.updated_at,schemaVersion:1,
  });
});

test('技能 Manifest 可以声明动态 configuration',async()=>{
  const {validateSkillManifest}=await import('../lib/skills/manifest.mjs');
  const manifest={schemaVersion:1,id:'configurable-skill',name:'配置技能',version:'1.0.0',kind:'stage',entryPoints:[],contentTypes:[],
    inputContract:'demo_input',outputContract:'demo_output',requiredCapabilities:[],optionalCapabilities:[],compatibleApp:'>=0.1.0',source:{type:'builtin',url:''},configuration:schema};
  assert.deepEqual(validateSkillManifest(manifest),[]);
});

test('未配置工具被阻断，已配置工具只向 adapter 注入解析值并审计非秘密快照',async()=>{
  const records=[];let received=null;
  const manifest={id:'configured-tool',version:'1.0.0',capabilities:['demo.configured'],riskLevel:'read-only',
    inputSchema:{type:'object',properties:{}},outputSchema:{type:'object',properties:{}},configuration:schema};
  const adapter={execute:async(_input,context)=>{received=context.configuration;return ok({});}};
  const blocked=new ToolRegistry().register({manifest,adapter});
  assert.equal((await blocked.execute('demo.configured',{},{})).error.code,'DEPENDENCY_MISSING');
  const registry=new ToolRegistry({configurationResolver:()=>({configured:true,values:{endpoint:'https://example.com',apiKey:'secret-value'},snapshot:{status:'ready',configHash:'sha256:redacted'}})}).register({manifest,adapter});
  const result=await registry.execute('demo.configured',{}, {executionLog:(record)=>records.push(record)});
  assert.equal(result.status,'ok');assert.equal(received.apiKey,'secret-value');
  assert.deepEqual(records[0].configurationSnapshot,{status:'ready',configHash:'sha256:redacted'});
  assert.equal(JSON.stringify(records[0]).includes('secret-value'),false);
});
