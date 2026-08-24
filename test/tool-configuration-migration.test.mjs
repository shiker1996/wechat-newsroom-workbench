import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { legacyToolConfiguration } from '../server/platform/extensions/legacy-tool-configuration.mjs';

test('阶段 2 工具 Manifest 声明统一配置且秘密字段受保护',()=>{
  const manifest=(id)=>JSON.parse(fs.readFileSync(`plugins/${id}/manifest.json`,'utf8'));
  for(const id of ['url-fetch','tavily-search','upyun-image-upload','document-folder-search'])assert.equal(manifest(id).configuration.type,'object');
  assert.equal(manifest('url-fetch').configuration.properties.apiKey.secret,true);
  assert.equal(manifest('tavily-search').configuration.properties.apiKey.secret,true);
  assert.equal(manifest('upyun-image-upload').configuration.properties.password.secret,true);
});

test('阶段 2 旧配置仅作为 fallback 并映射到实际工具',()=>{
  const env={SOURCE_FETCH_PROVIDER:'python',FIRECRAWL_MCP_URL:'https://fire.example/mcp',FIRECRAWL_API_KEY:'fire',TAVILY_API_KEY:'tavily',UPYUN_BUCKET:'bucket',UPYUN_OPERATOR:'operator',UPYUN_PASSWORD:'password',UPYUN_DOMAIN:'img.example'};
  const config={sourceFetch:{upgradeThreshold:60},tavily:{enabled:true,maxResults:7},documentSearch:{roots:['C:/vault']}};
  assert.deepEqual(legacyToolConfiguration({id:'url-fetch'},config,env),{provider:'python',endpoint:'https://fire.example/mcp',apiKey:'fire',githubToken:'',upgradeThreshold:60});
  assert.equal(legacyToolConfiguration({id:'tavily-search'},config,env).maxResults,7);
  assert.deepEqual(legacyToolConfiguration({id:'document-folder-search'},config,env).roots,['C:/vault']);
  assert.equal(legacyToolConfiguration({id:'upyun-image-upload'},config,env).password,'password');
});

test('阶段 2 用户提示不再要求直接编辑业务密钥环境变量',()=>{
  const tavily=fs.readFileSync('plugins/tavily-search/adapter.mjs','utf8');const upyun=fs.readFileSync('skills/upyun-upload-image/SKILL.md','utf8');const info=fs.readFileSync('server/platform/integrations/information-search.mjs','utf8');
  assert.doesNotMatch(tavily,/在 \.env .*TAVILY_API_KEY/);assert.match(tavily,/系统与配置中心/);
  assert.match(upyun,/系统与配置中心/);assert.match(info,/系统与配置中心/);
});
