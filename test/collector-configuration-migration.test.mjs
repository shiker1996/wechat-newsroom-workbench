import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_COLLECTOR_MANIFESTS } from '../server/platform/collectors/builtin-registry.mjs';
import { legacyCollectorConfiguration } from '../server/platform/extensions/legacy-collector-configuration.mjs';

const manifest=(id)=>BUILTIN_COLLECTOR_MANIFESTS.find((item)=>item.id===id);

test('阶段 3 内置采集器声明全局配置且来源字段保持独立',()=>{
  const reddit=manifest('reddit-collector'),rsshub=manifest('rsshub-collector'),github=manifest('github-discovery-collector');
  assert.ok(reddit.configuration.properties.cdpUrl);assert.ok(reddit.collector.sourceConfigSchema.properties.subreddit);assert.equal(reddit.configuration.properties.subreddit,undefined);
  assert.ok(rsshub.configuration.properties.baseUrl);assert.ok(rsshub.collector.sourceConfigSchema.properties.route);assert.equal(rsshub.configuration.properties.routes,undefined);
  assert.equal(github.credentialProfile,'github');assert.equal(github.configuration.properties.token.secret,true);
});

test('阶段 3 旧采集配置映射为插件 fallback，不夹带来源数组',()=>{
  const config={reddit:{cdpUrl:'http://localhost:9444',navigationTimeoutMs:45000,subreddits:['node']},rsshub:{baseUrl:'https://rss.example',routes:['/x'],concurrency:3},githubDiscovery:{enabled:true,minStars:20,aiQueries:{enabled:false,refreshDays:9}}};
  const reddit=legacyCollectorConfiguration(manifest('reddit-collector'),config,{}),rsshub=legacyCollectorConfiguration(manifest('rsshub-collector'),config,{}),github=legacyCollectorConfiguration(manifest('github-discovery-collector'),config,{GITHUB_TOKEN:'token'});
  assert.equal(reddit.cdpUrl,'http://localhost:9444');assert.equal(reddit.subreddits,undefined);
  assert.equal(rsshub.baseUrl,'https://rss.example');assert.equal(rsshub.routes,undefined);
  assert.equal(github.token,'token');assert.equal(github.aiQueriesEnabled,false);assert.equal(github.refreshDays,9);
});
