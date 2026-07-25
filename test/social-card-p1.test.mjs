import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRepository } from '../lib/repository-inspector.mjs';
import { evaluateCardGate } from '../lib/social-card-gate.mjs';

function response(status,data){return {status,ok:status>=200&&status<300,async json(){return data;},async text(){return JSON.stringify(data);}};}

test('仓库核验读取公开元数据并提取安装命令', async()=>{
  const fetchImpl=async(url)=>{
    if(url.endsWith('/readme'))return response(200,{content:Buffer.from('# Useful Tool\n\nAutomates local releases.\n\n## Features\n\n- Generates changelogs from commits\n- Publishes signed release artifacts\n\n## Install\n\n```bash\nnpm install useful-tool\n```').toString('base64'),html_url:'https://github.com/o/r#readme'});
    if(url.endsWith('/license'))return response(200,{license:{spdx_id:'MIT'},html_url:'https://github.com/o/r/blob/main/LICENSE'});
    if(url.endsWith('/releases/latest'))return response(200,{tag_name:'v1.0.0',published_at:'2026-07-20T00:00:00Z',html_url:'https://github.com/o/r/releases/tag/v1.0.0'});
    return response(200,{html_url:'https://github.com/o/r',description:'Useful tool',stargazers_count:1200,forks_count:40,topics:['cli','linux'],license:{spdx_id:'MIT'},default_branch:'main',language:'TypeScript',archived:false});
  };
  const fact=await inspectRepository('https://github.com/o/r',{fetchImpl,token:''});
  assert.equal(fact.repository,'o/r');assert.equal(fact.license.type,'MIT');assert.deepEqual(fact.installation,['npm install useful-tool']);
  assert.match(fact.readme.markdown,/Generates changelogs/);assert.ok(fact.readme.sections.some((section)=>section.title==='Features'));
});

test('CARD GATE 在事实和编辑决策完整时通过',()=>{
  const facts={data:{sourceUrl:'https://github.com/o/r',coreCapabilities:['能力'],installation:['npm i x'],license:{type:'MIT'},maturity:'released'}};
  const editorial={target_reader:'开发者',pain_point:'配置复杂',tool_positioning:'自动化工具',must_highlight:'核心能力',must_disclose:'需要网络访问',forbidden_claims:'不得写亲测',recommended_pages:6};
  const gate=evaluateCardGate({},facts,editorial);assert.equal(gate.ready,true);assert.equal(gate.passed,gate.total);
  assert.equal(evaluateCardGate({},null,{}).ready,false);
});
