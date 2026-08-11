import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addSubscription, listSubscriptions, removeSubscription, subscriptionTestInput, updateSubscription } from '../lib/integrations/subscriptions.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-assistant-subscriptions-'));
  const config = { rsshub: { routes:['/readhub?limit=30'], disabledRoutes:[], directFeeds:[] } };
  return { root, config };
}

test('订阅源可新增、暂停并持久化', () => {
  const { root, config } = fixture();
  try {
    addSubscription(root, config, { kind:'twitter', value:'@OpenAI' });
    addSubscription(root, config, { kind:'direct', value:'https://example.com/feed.xml', label:'示例 Feed' });
    updateSubscription(root, config, { kind:'twitter', value:'/twitter/user/OpenAI?limit=30', enabled:false });
    const listed = listSubscriptions(config);
    assert.equal(listed.summary.total, 3);
    assert.equal(listed.summary.twitter, 1);
    assert.equal(listed.summary.direct, 1);
    assert.equal(listed.items.find((item) => item.kind === 'twitter').enabled, false);
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'config.local.json'), 'utf8'));
    assert.deepEqual(saved.rsshub.disabledRoutes, ['/twitter/user/OpenAI?limit=30']);
    assert.equal(saved.rsshub.directFeeds[0].label, '示例 Feed');
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('删除订阅时同步清理禁用记录', () => {
  const { root, config } = fixture();
  try {
    config.rsshub.disabledRoutes = ['/readhub?limit=30'];
    removeSubscription(root, config, { kind:'rsshub', value:'/readhub?limit=30' });
    assert.deepEqual(config.rsshub.routes, []);
    assert.deepEqual(config.rsshub.disabledRoutes, []);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('订阅台账把 GitHub Search 作为只读采集入口展示',()=>{
  const result=listSubscriptions({rsshub:{routes:['/github/trending/daily/any?limit=30'],disabledRoutes:[],directFeeds:[]},githubDiscovery:{enabled:true,createdWithinDays:30,minStars:1000}},[]);
  const search=result.items.find((item)=>item.value==='github:search');
  assert.equal(search.kind,'github');
  assert.equal(search.managed,true);
  assert.equal(result.summary.github,2);
});

test('X 订阅测试同时兼容表单用户名和列表中的已保存路由',()=>{
  assert.deepEqual(subscriptionTestInput({kind:'twitter',value:'@OpenAI'}),{kind:'twitter',value:'/twitter/user/OpenAI?limit=3'});
  assert.deepEqual(subscriptionTestInput({kind:'twitter',value:'/twitter/user/Alibaba_Qwen?limit=30'}),{kind:'twitter',value:'/twitter/user/Alibaba_Qwen?limit=3'});
  assert.throws(()=>subscriptionTestInput({kind:'twitter',value:'/readhub?limit=30'}),/有效的 X 用户名/);
});
