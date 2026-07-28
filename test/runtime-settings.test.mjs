import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getRuntimeSettings, updateRuntimeSettings } from '../lib/integrations/runtime-settings.mjs';

test('运行配置仅返回密钥状态并允许覆盖或清除白名单字段', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'write-assistant-settings-'));
  const rsshubRoot=path.join(root,'RSSHub');fs.mkdirSync(rsshubRoot);
  fs.writeFileSync(path.join(root,'.env'),'DEEPSEEK_API_KEY=secret-before\nUNRELATED=keep\n','utf8');
  fs.writeFileSync(path.join(rsshubRoot,'.env'),'PROXY_HOST=127.0.0.1\nTWITTER_AUTH_TOKEN=twitter-secret\n','utf8');
  const config={workspaceRoot:root,reddit:{cdpUrl:'http://127.0.0.1:9222'},rsshub:{rootDir:rsshubRoot,baseUrl:'http://127.0.0.1:1200'}};
  try{
    const before=getRuntimeSettings(root,config);
    assert.equal(before.app.find((item)=>item.key==='DEEPSEEK_API_KEY').value,'');
    assert.equal(before.app.find((item)=>item.key==='DEEPSEEK_API_KEY').configured,true);
    assert.equal(before.rsshub.find((item)=>item.key==='PROXY_HOST').value,'');
    updateRuntimeSettings(root,config,{app:[{key:'DEEPSEEK_API_KEY',clear:true},{key:'MOONSHOT_API_KEY',value:'new-secret'},{key:'UNRELATED',value:'changed'}],rsshub:[{key:'PROXY_PORT',value:'7890'},{key:'YOUTUBE_KEY',value:'video-secret'}]});
    const appText=fs.readFileSync(path.join(root,'.env'),'utf8');
    assert.doesNotMatch(appText,/secret-before/);
    assert.match(appText,/UNRELATED=keep/);
    assert.match(appText,/MOONSHOT_API_KEY=new-secret/);
    assert.match(fs.readFileSync(path.join(rsshubRoot,'.env'),'utf8'),/PROXY_PORT=7890/);
    assert.match(fs.readFileSync(path.join(rsshubRoot,'.env'),'utf8'),/YOUTUBE_KEY=video-secret/);
  }finally{
    delete process.env.DEEPSEEK_API_KEY;delete process.env.MOONSHOT_API_KEY;
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('RSSHub KV 编辑器支持任意合法键且拒绝重复或非法键',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'write-assistant-rsshub-kv-'));
  const rsshubRoot=path.join(root,'RSSHub');fs.mkdirSync(rsshubRoot);
  const config={workspaceRoot:root,reddit:{cdpUrl:'http://127.0.0.1:9222'},rsshub:{rootDir:rsshubRoot,baseUrl:'http://127.0.0.1:1200'}};
  try{
    updateRuntimeSettings(root,config,{app:[],rsshub:[{key:'TELEGRAM_TOKEN',value:'secret'}]});
    assert.equal(getRuntimeSettings(root,config).rsshub[0].value,'');
    assert.throws(()=>updateRuntimeSettings(root,config,{app:[],rsshub:[{key:'BAD-KEY',value:'x'}]}),/不合法/);
    assert.throws(()=>updateRuntimeSettings(root,config,{app:[],rsshub:[{key:'A',value:'1'},{key:'A',value:'2'}]}),/重复/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('工作台环境配置按用途折叠分组且默认不展开', () => {
  const view=fs.readFileSync(new URL('../public/src/views/system.js',import.meta.url),'utf8');
  const styles=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
  for(const label of ['原文抓取','图片存储','工作台运行'])assert.match(view,new RegExp(label));
  assert.doesNotMatch(view,/label:"旧版模型服务"/);
  assert.match(view,/<details class="env-group"/);
  assert.doesNotMatch(view,/<details class="env-group"[^>]* open/);
  assert.match(styles,/\.env-group\[open\]>summary/);
});
