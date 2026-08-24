import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getRuntimeSettings, updateRuntimeSettings } from '../server/platform/integrations/runtime-settings.mjs';

test('运行设置不再读取或写入项目根 .env',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-settings-'));const rsshubRoot=path.join(root,'RSSHub');fs.mkdirSync(rsshubRoot,{recursive:true});
  const config={workspaceRoot:root,rsshub:{rootDir:rsshubRoot,baseUrl:'http://127.0.0.1:1200'},reddit:{cdpUrl:'http://127.0.0.1:9333'},articleLength:{minVisibleChars:1300,maxVisibleChars:2000}};
  try{
    const before=getRuntimeSettings(root,config);assert.deepEqual(before.app,[]);
    updateRuntimeSettings(root,config,{app:[{key:'DEEPSEEK_API_KEY',value:'ignored'}],rsshub:[]});
    assert.equal(fs.existsSync(path.join(root,'.env')),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('RSSHub KV 编辑器支持合法键且拒绝重复或非法键',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-rsshub-'));const rsshubRoot=path.join(root,'RSSHub');fs.mkdirSync(rsshubRoot,{recursive:true});
  const config={workspaceRoot:root,rsshub:{rootDir:rsshubRoot,baseUrl:'http://127.0.0.1:1200'},reddit:{cdpUrl:'http://127.0.0.1:9333'},articleLength:{minVisibleChars:1300,maxVisibleChars:2000}};
  try{
    updateRuntimeSettings(root,config,{app:[],rsshub:[{key:'PROXY_PORT',value:'7890'}]});
    assert.match(fs.readFileSync(path.join(rsshubRoot,'.env'),'utf8'),/PROXY_PORT=7890/);
    assert.throws(()=>updateRuntimeSettings(root,config,{app:[],rsshub:[{key:'BAD-KEY',value:'x'}]}));
    assert.throws(()=>updateRuntimeSettings(root,config,{app:[],rsshub:[{key:'A',value:'1'},{key:'A',value:'2'}]}));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('统一配置页面不再渲染工作台环境变量分组',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const view=fs.readFileSync(new URL('../public/src/views/system.js',import.meta.url),'utf8');
  assert.doesNotMatch(html,/app-env-fields|data-config-panel="app"/);
  assert.doesNotMatch(view,/APP_ENV_GROUPS|collectEnvFields|renderAppEnvGroups/);
  assert.match(html,/本机能力配置/);
  assert.doesNotMatch(html,/能力注册表/);
});
