import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../lib/core/store.mjs';
import { fetchUrlContent } from '../lib/integrations/source-fetcher.mjs';
import { readLocalProjectViaRegistry } from '../lib/integrations/local-project-reader.mjs';

test('URL 抓取被技能白名单拒绝时不访问网络并持久化审计', async () => {
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'tool-audit-fetch-'));let store;
  try{
    store=new Store(path.join(tempRoot,'test.db'));
    const result=await fetchUrlContent({
      targetUrl:'https://example.com/should-not-fetch',
      title:'权限测试',
      root:tempRoot,
      toolContext:{store,skillId:'wechat-mp-tutorial',allowedCapabilities:[]},
    });
    assert.equal(result.status,'error');
    const records=store.listToolExecutions({capability:'content.url.fetch'});
    assert.equal(records.length,1);
    assert.equal(records[0].status,'error');
    assert.equal(records[0].error_code,'PERMISSION_DENIED');
    assert.equal(records[0].skill_id,'wechat-mp-tutorial');
  }finally{store?.close();fs.rmSync(tempRoot,{recursive:true,force:true});}
});

test('本地项目读取被技能白名单拒绝时抛出标准错误并持久化审计', async () => {
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'tool-audit-local-'));let store;
  try{
    store=new Store(path.join(tempRoot,'test.db'));
    await assert.rejects(
      ()=>readLocalProjectViaRegistry(tempRoot,{
        toolContext:{store,skillId:'wechat-mp-tutorial',allowedCapabilities:[]},
      }),
      (error)=>error.code==='PERMISSION_DENIED',
    );
    const [record]=store.listToolExecutions({capability:'filesystem.project.read'});
    assert.equal(record.error_code,'PERMISSION_DENIED');
    assert.equal(record.skill_id,'wechat-mp-tutorial');
    assert.deepEqual(record.input_keys,['options','path']);
  }finally{store?.close();fs.rmSync(tempRoot,{recursive:true,force:true});}
});
