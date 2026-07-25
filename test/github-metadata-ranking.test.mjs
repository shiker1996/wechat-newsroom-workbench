import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaggingInput } from '../lib/llm/tasks.mjs';
import { clusterItems, preselection, selectSocialCandidates } from '../lib/llm/research-pipeline.mjs';

const tags={eventKey:'repo|发布|工具',chinaRelevance:8,relevanceReason:'适合国内开发者',riskLevel:'低',keywords:['开发工具'],
  preScores:{conflict:5,audience:14,informationGain:12,emotion:5,impact:7,sourceReliability:8},credibleScoop:0,saturationPenalty:1};

test('GitHub 元数据进入打标输入且限制字段规模',()=>{
  const input=buildTaggingInput({id:1,source:'github:search',source_group:'github',source_type:'search',source_name:'GitHub 新项目增长发现',title:'o/r',url:'https://github.com/o/r',published_at:'2026-07-20',raw_json:JSON.stringify({repository:'o/r',description:'AI workflow tool',language:'TypeScript',stars:1500,topics:['ai','workflow'],createdAt:'2026-07-10',discoveryChannels:['search']})});
  assert.equal(input.repository.stars,1500);
  assert.deepEqual(input.repository.topics,['ai','workflow']);
  assert.deepEqual(input.repository.discoveryChannels,['search']);
});

test('图文研判使用仓库描述、Star 与发现渠道',()=>{
  const hotspot={id:2,title:'o/r',source:'github:search',source_group:'github',source_type:'search',url:'https://github.com/o/r',category:'🤖 AI/技术动态',market_scope:'全球性',score:80,published_at:'2026-07-20',
    raw_json:JSON.stringify({description:'AI workflow CLI for developers',language:'TypeScript',stars:1800,topics:['agent','cli'],createdAt:'2026-07-10',discoveryChannels:['search','mentioned'],aiTags:tags})};
  const selected=selectSocialCandidates(preselection(clusterItems([hotspot]),'2026-07-22'));
  assert.equal(selected.length,1);
  assert.equal(selected[0].repositoryMeta.stars,1800);
  assert.ok(selected[0].reasons.includes('近期增长发现'));
  assert.ok(selected[0].reasons.some((reason)=>reason.includes('Stars')));
});
