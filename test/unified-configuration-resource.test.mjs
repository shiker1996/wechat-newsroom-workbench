import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ExtensionConfigurationService } from '../server/platform/extensions/configuration-service.mjs';
import { buildConfigurationCatalog, findConfigurationResource } from '../server/platform/extensions/configuration-catalog.mjs';
import { applyModelProviderConfiguration, legacyModelProviderConfiguration, modelProviderManifest } from '../server/platform/extensions/model-provider-configuration.mjs';

function repository(){const rows=new Map();return {get:(type,id)=>rows.get(`${type}:${id}`)||null,save:(input)=>{const value={...input,value:structuredClone(input.value),updated_at:new Date().toISOString()};rows.set(`${input.extensionType}:${input.extensionId}`,value);return value;}};}

test('统一配置目录包含 system 与 model-provider 一等资源',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'configuration-catalog-'));
  try{const items=await buildConfigurationCatalog({root,config:{llm:{providers:{demo:{label:'Demo',baseUrl:'https://example.com/v1',model:'demo-1',contextWindow:8000,maxOutputTokens:1000}}}}});const workbench=findConfigurationResource(items,'system','workbench');assert.ok(workbench);assert.deepEqual(workbench.manifest.configuration.properties.discussionResearchTopK.enum,[5,8,10]);assert.equal(workbench.manifest.configuration.properties.discussionResearchTopK.default,8);assert.ok(findConfigurationResource(items,'model-provider','demo'));}
  finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('模型供应商 Schema 覆盖运行时高级参数且旧环境变量可回退',()=>{
  const provider={label:'Demo',baseUrl:'https://example.com/v1',model:'demo-1',apiKeyEnv:'DEMO_KEY',contextWindow:8000,maxOutputTokens:1000,maxTokensField:'max_completion_tokens',taggingChunkSize:12,taggingConcurrency:3,supportsJsonMode:true,supportsThinkingToggle:true,thinkingReserveTokens:4000,reasoningEffort:'low',webSearchConfig:{payloadKey:'search',payloadValue:true}};
  const manifest=modelProviderManifest('demo',provider);
  for(const field of ['maxTokensField','taggingChunkSize','taggingConcurrency','supportsJsonMode','supportsNativeTools','supportsToolCallStreaming','supportsThinkingToggle','thinkingReserveTokens','reasoningEffort','webSearchPayloadKey','webSearchPayloadValue'])assert.ok(manifest.configuration.properties[field],field);
  const fallback=legacyModelProviderConfiguration(provider,{DEMO_KEY:'legacy-secret'});
  assert.equal(fallback.apiKey,'legacy-secret');
  const runtime=applyModelProviderConfiguration(provider,{...fallback,model:'new-model'});
  assert.equal(runtime.model,'new-model');assert.deepEqual(runtime.webSearchConfig,{payloadKey:'search',payloadValue:true});assert.equal('apiKey' in runtime,false);
});

test('不同扩展可引用同一个共享凭据 Profile',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'shared-credential-')),repo=repository(),service=new ExtensionConfigurationService({root,repository:repo});
  const schema={type:'object',additionalProperties:false,properties:{token:{type:'string',secret:true}},required:['token']};
  try{const first={id:'github-discovery',credentialProfile:'github',configuration:schema};const second={id:'github-repository',credentialProfile:'github',configuration:schema};service.save({extensionType:'collector',extensionId:first.id,manifest:first,input:{token:'secret-token'}});const state=service.resolve({extensionType:'tool',extensionId:second.id,manifest:second});assert.equal(state.configured,true);assert.equal(state.values.token,'secret-token');assert.equal(state.credentialStatus.profile,'github');}
  finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('统一资源路由保留旧扩展配置接口',()=>{
  const source=fs.readFileSync(path.resolve('server/platform/http/routes/system-routes.mjs'),'utf8');
  assert.match(source,/\/api\/system\/configuration\/catalog/);assert.match(source,/unifiedConfigurationMatch/);assert.match(source,/extensionConfigurationMatch/);
});
