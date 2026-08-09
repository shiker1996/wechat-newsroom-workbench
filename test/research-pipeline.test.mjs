import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { brainstorm, clusterItems, deterministicTimeliness, generateEventCards, isFreshForBatch, isSocialCardCandidate, preselection, resolveScoring, selectDimensionPool, focusedCategories, scoreCards, selectSocialCandidates, dimensionSelections, DIMENSION_POOL_ROLES, ensureBatchEventCards, markdownRanked } from '../lib/llm/research-pipeline.mjs';

function hotspot(id, title, eventKey, source='rsshub') {
  return { id, title, source, url:`https://example.com/${id}`, category:'🤖 AI/技术动态', market_scope:'全球性', score:80,
    raw_json:JSON.stringify({aiTags:{eventKey,chinaRelevance:8,relevanceReason:'影响国内开发者',riskLevel:'低',keywords:['模型'],
      preScores:{conflict:14,audience:16,informationGain:12,emotion:10,timeliness:9,impact:8,sourceReliability:8},
      credibleScoop:0,saturationPenalty:2,duplicatePenalty:0,blackHorseSignals:['信息稀缺']}}) };
}

test('语义事件指纹合并同事件且报道数守恒', () => {
  const events=clusterItems([hotspot(1,'A报道','主体|发布|模型','reddit'),hotspot(2,'B报道','主体|发布|模型','rsshub'),hotspot(3,'另一事件','主体|裁员|团队')]);
  assert.equal(events.length,2);
  assert.equal(events.reduce((sum,event)=>sum+event.report_count,0),3);
  assert.equal(events.find((event)=>event.report_count===2).source_count,2);
});

test('event_id 由事件指纹派生，与输入顺序和无关条目增减无关', () => {
  const base=[hotspot(1,'A报道','主体|发布|模型','reddit'),hotspot(2,'B报道','主体|发布|模型','rsshub'),hotspot(3,'另一事件','主体|裁员|团队')];
  const idOf=(events,title)=>events.find((event)=>event.representative_title===title).event_id;
  const forward=clusterItems(base);
  const reversed=clusterItems([...base].reverse());
  assert.equal(idOf(forward,'A报道'),idOf(reversed,'A报道'));
  assert.equal(idOf(forward,'另一事件'),idOf(reversed,'另一事件'));
  // 插入无关事件（含无 eventKey 的单条）后，已有事件的 event_id 保持不变
  const untagged={id:99,title:'未打标',source:'rsshub',url:'https://example.com/99',category:'🤖 AI/技术动态',market_scope:'全球性',score:10,raw_json:'{}'};
  const expanded=clusterItems([untagged,...base,hotspot(4,'新事件','主体|融资|公司')]);
  assert.equal(idOf(expanded,'A报道'),idOf(forward,'A报道'));
  assert.equal(idOf(expanded,'另一事件'),idOf(forward,'另一事件'));
});

test('研判使用真实发布时间过滤并确定性计算时效', () => {
  const old={published_at:'2026-07-01T12:07:00.000Z'};
  const recent={published_at:'2026-07-19T08:00:00.000Z'};
  assert.equal(isFreshForBatch(old,'2026-07-19',168),false);
  assert.equal(isFreshForBatch(recent,'2026-07-19',168),true);
  assert.equal(deterministicTimeliness(old.published_at,'2026-07-19'),0);
  assert.equal(deterministicTimeliness(recent.published_at,'2026-07-19'),10);
});

test('有效时间窗口优先按实际抓取时间（created_at）判定', () => {
  // 2026-07-12 10:00 (+08:00) 发布，批次日期 2026-07-19：按批次日 23:59 判定窗口起点为 07-12 23:59，应为旧闻；
  // 但抓取时间为 07-19 10:00 (+08:00)，窗口起点为 07-12 10:00，刚好在窗口内，应判为有效。
  const boundary={published_at:'2026-07-12T10:00:00+08:00',created_at:'2026-07-19T10:00:00+08:00'};
  assert.equal(isFreshForBatch(boundary,'2026-07-19',168),true);
  // 缺 created_at 时回退到批次日期 23:59:59 的旧行为
  const noCollected={published_at:'2026-07-12T10:00:00+08:00'};
  assert.equal(isFreshForBatch(noCollected,'2026-07-19',168),false);
  // 抓取时间之前超过 168 小时的仍为旧闻
  const stale={published_at:'2026-07-11T09:59:00+08:00',created_at:'2026-07-19T10:00:00+08:00'};
  assert.equal(isFreshForBatch(stale,'2026-07-19',168),false);
});

test('维度统一选题：核心8混排 + 黑马2 + 候补3，事件回填入池身份', () => {
  const clusters=clusterItems(Array.from({length:13},(_,i)=>hotspot(i+1,`事件${i+1}`,`主体${i+1}|动作|对象`)));
  const ranking=preselection(clusters);
  const pool=selectDimensionPool(clusters, ranking);
  assert.equal(pool.selected.length,10);
  assert.equal(pool.selected.filter((item)=>item.poolRole==='黑马2条').length,2);
  assert.equal(pool.backup.length,3);
  // 13 个单事件主体各成一个 who 候选，前 8 为核心，其余为黑马/候补/未入选
  assert.ok(pool.selected.every((item)=>item.dimension==='who'));
  const inPool=ranking.filter((item)=>item.poolRole!=='未入选');
  assert.equal(inPool.length,10);
  const eliminated=ranking.find((item)=>item.poolRole==='未入选');
  assert.ok(eliminated.eliminationReason.length>0);
});

test('成稿线前置：F 低于 55 的候选不进入选题池', () => {
  const source = fs.readFileSync(new URL('../lib/llm/research-pipeline.mjs', import.meta.url), 'utf8');
  assert.match(source, /const DRAFT_FLOOR = 55/);
  assert.match(source, /draftable = breaking \? scored : scored\.filter\(\(item\) => item\.f >= DRAFT_FLOOR\)/);
  assert.match(source, /saveAnalyzedCandidates\(batchId,draftable\.map/);
});

test('账号契合：命中内容支柱类目的维度组获得加分', () => {
  const accountContext={contentPillars:['AI 行业热点：技术动态与战略观察']};
  const focused=focusedCategories(accountContext);
  assert.ok(focused.has('🤖 AI/技术动态') || focused.has('🏢 大厂战略'));
  const clusters=clusterItems([
    hotspot(1,'AI 事件','openai|发布模型'),
    hotspot(2,'AI 事件二','anthropic|发布模型'),
  ]);
  const ranking=preselection(clusters);
  const pool=selectDimensionPool(clusters, ranking, { accountContext });
  const group=pool.groups.find((item)=>item.dimension==='who'&&item.key==='openai');
  assert.equal(group.accountFit,6);
});

test('H/B/P/S/D/F由服务端公式计算', () => {
  const source={candidateId:'C001',title:'事件',category:'🤖 AI/技术动态',poolRole:'核心8条',credibleScoop:0,riskLevel:'低'};
  const cards=[{candidateId:'C001',status:'PASS',source,bScores:{angleUniqueness:4,emotionSpread:4,titleHook:4,audienceRelevance:4,factSupport:4},
    hProfile:{historicalType:'bigtech',fiveSenseCount:4,fiveQuestionCount:3,recommendationFit:6,emotionTheme:4,searchFriendly:3}}];
  const result=scoreCards(cards,{items:[{candidateId:'C001',saturationPenalty:5,duplicatePenalty:2,audienceRelevance:4,reason:'测试'}]})[0];
  assert.equal(result.b,80); assert.equal(result.p,40); assert.equal(result.s,5); assert.equal(result.d,0);
  assert.equal(result.f,62.4);
});

test('GitHub、开源和开发工具使用独立配置加分，不依赖泛 AI 分类', () => {
  const clusters=clusterItems([dimensionHotspot(1,{who:'tool',what:'开源开发工具',actionType:'开源',object:'开发工具',labels:{who:'Tool'}})]);
  const ranking=preselection(clusters);
  const pool=selectDimensionPool(clusters,ranking,{accountContext:{contentPillars:[],scoring:{toolEngineeringBonus:12}}});
  assert.equal(pool.groups[0].accountFit,0);
  assert.equal(pool.groups[0].toolEngineeringBonus,12);
  assert.equal(resolveScoring({scoring:{toolEngineeringBonus:14}}).toolEngineeringBonus,14);
});

test('核心候选按配置保留最低工具工程席位，工具不足时不伪造补位', () => {
  const generic=Array.from({length:6},(_,index)=>dimensionHotspot(index+1,{who:`主体${index}`,what:'行业动态',actionType:'争议回应'}));
  const tools=[
    dimensionHotspot(20,{who:'tool-a',what:'开源开发工具',actionType:'开源',object:'开发工具'}),
    dimensionHotspot(21,{who:'tool-b',what:'发布代码助手',actionType:'发布',object:'代码助手'}),
  ];
  const clusters=clusterItems([...generic,...tools]);
  const ranking=preselection(clusters).map((item)=>({...item,finalPreScore:item.hotspotId>=20?35:90}));
  const pool=selectDimensionPool(clusters,ranking,{coreLimit:4,blackLimit:0,backupLimit:0,accountContext:{contentPillars:[],scoring:{toolEngineeringBonus:5,minimumToolCandidates:2}}});
  assert.equal(pool.selected.filter((group)=>group.toolEngineering).length,2);
});

test('选题评分贯通分发池与读者利益并拦截伪通知', () => {
  const source={candidateId:'C001',title:'平台规则变化',category:'💼 职场生态',poolRole:'核心8条',credibleScoop:0,riskLevel:'低'};
  const base={candidateId:'C001',status:'PASS',source,bScores:{angleUniqueness:4,emotionSpread:4,titleHook:4,audienceRelevance:4,factSupport:4},
    hProfile:{historicalType:'worker_social',fiveSenseCount:3,fiveQuestionCount:3,recommendationFit:5,emotionTheme:5,searchFriendly:2}};
  const downgraded=scoreCards([{...base,packaging:{distributionLane:'通知池',readerStake:'影响开发者岗位选择',notificationFit:5}}],{items:[]})[0];
  assert.equal(downgraded.distributionLane,'实验池');
  assert.equal(downgraded.readerStake,'影响开发者岗位选择');
  assert.equal(downgraded.notificationEligible,false);
  const qualified=scoreCards([{...base,packaging:{distributionLane:'通知池',readerStake:'平台开发者必须在8月前迁移接口，否则发布流程会中断并增加维护成本',notificationFit:4}}],{items:[]})[0];
  assert.equal(qualified.distributionLane,'通知池');
  const report=markdownRanked([qualified],{items:[],metaNarratives:[],combination:{}});
  assert.match(report,/\| 通知池 \|/);
  assert.match(report,/读者利益：平台开发者必须在8月前迁移接口/);
});

test('通知池按最终分最多保留两条，非法推荐技能回退到可路由枚举', () => {
  const cards=[1,2,3].map((id)=>({candidateId:`C00${id}`,status:'PASS',source:{title:`平台变更${id}`,category:'🤖 AI/技术动态',poolRole:'核心8条',credibleScoop:0,riskLevel:'低'},
    angle:'接口迁移',thesis:'平台变更要求迁移',recommendedSkill:'tool-review',
    packaging:{distributionLane:'通知池',readerStake:`使用旧接口的开发者必须在8月前迁移，否则发布流程会中断并增加维护成本${id}`,notificationFit:5},
    bScores:{angleUniqueness:4,emotionSpread:4,titleHook:4,audienceRelevance:4,factSupport:5},
    hProfile:{historicalType:'bigtech',fiveSenseCount:4,fiveQuestionCount:3,recommendationFit:6,emotionTheme:4,searchFriendly:3}}));
  const scored=scoreCards(cards,{items:[]});
  assert.deepEqual(scored.map((item)=>item.distributionLane),['通知池','通知池','实验池']);
  assert.ok(scored[2].notificationBlockers.includes('batch-notification-quota'));
  assert.ok(scored.every((item)=>item.recommendedSkill==='wechat-mp-tech-hotspot'));
});

test('图文推荐优先采用模型贴图建议并识别工具类候选', () => {
  const safe = { status:'PASS', writeReadiness:'READY_PUBLIC_ANALYSIS', source:{ riskLevel:'低' } };
  assert.equal(isSocialCardCandidate({ ...safe, format:'贴图', hProfile:{ historicalType:'bigtech' } }), true);
  assert.equal(isSocialCardCandidate({ ...safe, format:'文章', hProfile:{ historicalType:'github_tool' } }), true);
  assert.equal(isSocialCardCandidate({ ...safe, format:'文章', hProfile:{ historicalType:'bigtech' }, materialType:'行业新闻' }), false);
  assert.equal(isSocialCardCandidate({ ...safe, format:'贴图', source:{ riskLevel:'高' } }), false);
});

test('图文预选从全量事件独立选择 GitHub 工具，不受文章前十限制', () => {
  const ranking = [
    { hotspotId:1,title:'普通行业新闻',riskLevel:'低',category:'📈 行业趋势',keywords:[],articles:[{hotspot_id:1,title:'普通行业新闻',url:'https://example.com/news'}],preScores:{informationGain:15},chinaRelevance:10,saturationPenalty:0,finalPreScore:95 },
    { hotspotId:2,title:'Useful open source workflow',riskLevel:'低',category:'🤖 AI/技术动态',keywords:['GitHub trending','开源工具'],articles:[{hotspot_id:2,title:'Useful open source workflow',url:'https://github.com/example/tool'}],preScores:{informationGain:8},chinaRelevance:4,saturationPenalty:2,finalPreScore:55 },
  ];
  const selected = selectSocialCandidates(ranking);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].hotspotId, 2);
  assert.ok(selected[0].socialScore >= 45);
  assert.equal(selected[0].socialScoreDetails.scoreStage,'discovery');
  assert.equal(selected[0].socialScoreDetails.finalScore,selected[0].socialScore);
});

test('探索脑暴输出截断时自动从双卡拆成单卡', async () => {
  const invalid=[]; let calls=0;
  const store={updateModelCall(id,fields){invalid.push({id,...fields});}};
  const gateway={config:{defaultProvider:'deepseek',providers:{deepseek:{maxOutputTokens:8192}}},async complete(input){
    calls+=1; const text=input.messages[1].content; const ids=[...text.matchAll(/"candidateId":"(C\d+)"/g)].map((m)=>m[1]);
    if(ids.length>1)return {callId:calls,content:'{"items":[',finishReason:'length'};
    const candidateId=ids[0]; return {callId:calls,finishReason:'stop',content:JSON.stringify({items:[{candidateId,status:'PASS',angle:'角度',thesis:'命题',hypotheses:[],packaging:{},bScores:{},hProfile:{}}]})};
  }};
  const selected=[1,2].map((id)=>({hotspotId:id,title:`热点${id}`,category:'🤖 AI/技术动态',poolRole:'核心8条'}));
  const cards=await brainstorm(gateway,store,selected,[{label:'降级',content:'无'}],'b1','deepseek',()=>{});
  assert.equal(calls,3); assert.equal(cards.length,2); assert.equal(invalid[0].status,'invalid_output');
});

test('事件卡生成：截断自动拆分，单事件失败不阻塞整批', async () => {
  const clusters = clusterItems([
    hotspot(11,'事件A','主体|发布|模型'), hotspot(12,'事件B','主体|裁员|团队'), hotspot(13,'事件C','主体|融资|公司'),
  ]);
  const invalid = []; let calls = 0;
  const store = { updateModelCall(id, fields) { invalid.push({ id, ...fields }); } };
  const gateway = { config:{ defaultProvider:'deepseek', providers:{ deepseek:{ maxOutputTokens:8192 } } }, async complete(input) {
    calls += 1;
    const text = input.messages[1].content.replace(/^【极简重试】[^\n]*\n/, '');
    const events = JSON.parse(text);
    if (events.length > 1) return { callId:calls, content:'{"items":[', finishReason:'length', context:{}, usage:{} };
    const id = events[0].event_id;
    if (id === clusters[2].event_id) return { callId:calls, content:'not json', finishReason:'stop', context:{}, usage:{} };
    return { callId:calls, finishReason:'stop', context:{}, usage:{},
      content: JSON.stringify({ items:[{ event_id:id, conclusion:`结论${id}`, background:'背景', confirmed_facts:['事实一'], source_increment:[{source:'晚点',adds:'独家信息'}], disagreements:[], timeline:[{time:'周一',fact:'发生'}], unverified:['待核'], angles:['角度'] }] }) };
  }};
  const result = await generateEventCards({ gateway, store, clusters, batchId:'b1', provider:'deepseek' });
  assert.equal(result.cards.size, 2);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].event_id, clusters[2].event_id);
  assert.equal(clusters[0].card.conclusion, `结论${clusters[0].event_id}`);
  assert.equal(clusters[0].card.confirmed_facts[0], '事实一');
  assert.equal(clusters[2].card, undefined);
  assert.ok(invalid.some((entry) => entry.status === 'invalid_output'));
});

test('事件卡生成：模型返回合法 JSON 但漏项时自动极简重试', async () => {
  const clusters = clusterItems([hotspot(21,'事件漏项','主体|发布|产品')]);
  let calls = 0;
  const gateway = { config:{ defaultProvider:'deepseek', providers:{ deepseek:{ maxOutputTokens:8192 } } }, async complete(input) {
    calls += 1;
    const events = JSON.parse(input.messages[1].content.replace(/^【极简重试】[^\n]*\n/, ''));
    if (calls === 1) return { callId:calls, finishReason:'stop', content:'{"items":[]' + '}', context:{}, usage:{} };
    return { callId:calls, finishReason:'stop', context:{}, usage:{}, content:JSON.stringify({items:[{
      event_id:events[0].event_id, conclusion:'补回的事件卡', confirmed_facts:[], source_increment:[], disagreements:[], timeline:[], unverified:[], angles:[],
    }]}) };
  }};
  const result = await generateEventCards({ gateway, store:{updateModelCall(){}}, clusters, batchId:'b1', provider:'deepseek' });
  assert.equal(calls, 2);
  assert.equal(result.cards.size, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(clusters[0].card.conclusion, '补回的事件卡');
});

test('事件卡大批量生成使用持续补位工作池和服务商并发配置', async () => {
  const clusters = clusterItems(Array.from({ length: 8 }, (_, i) => hotspot(i + 1, `事件${i + 1}`, `主体${i + 1}|动作|对象`)));
  let active = 0; let maxActive = 0; let calls = 0;
  const store = { updateModelCall() {} };
  const gateway = { config:{ defaultProvider:'deepseek', providers:{ deepseek:{ maxOutputTokens:8192, eventCardChunkSize:2, eventCardConcurrency:3 } } }, async complete(input) {
    calls += 1; active += 1; maxActive = Math.max(maxActive, active);
    const events = JSON.parse(input.messages[1].content);
    await new Promise((resolve) => setTimeout(resolve, events[0].event_id === clusters[2].event_id ? 12 : 3));
    active -= 1;
    return { callId:calls, finishReason:'stop', context:{}, usage:{},
      content: JSON.stringify({ items: events.map((event) => ({ event_id:event.event_id, conclusion:`结论${event.event_id}`, confirmed_facts:[], source_increment:[], disagreements:[], timeline:[], unverified:[], angles:[] })) }) };
  }};
  const result = await generateEventCards({ gateway, store, clusters, batchId:'b1', provider:'deepseek' });
  assert.equal(calls, 4);
  assert.equal(maxActive, 3);
  assert.equal(result.cards.size, 8);
  assert.equal(result.failed.length, 0);
});

test('议题热度加成：多事件议题中的事件获得加成，孤立事件不加成', () => {
  function keyworded(id, keyword) {
    return { id, title:`报道${id}`, source:'rsshub', url:`https://example.com/${id}`, category:'🤖 AI/技术动态', market_scope:'国内', score:80,
      raw_json:JSON.stringify({ aiTags:{ eventKey:`主体${id}|动作|对象`, chinaRelevance:8, relevanceReason:'相关', riskLevel:'低', keywords:[keyword],
        preScores:{ conflict:10, audience:10, informationGain:10, emotion:5, timeliness:5, impact:5, sourceReliability:5 }, blackHorseSignals:[] } }) };
  }
  const clusters = clusterItems([keyworded(1,'大模型'), keyworded(2,'大模型'), keyworded(3,'大模型'), keyworded(4,'冷门词')]);
  const ranking = preselection(clusters, '2026-07-23');
  const hot = ranking.find((item) => item.title === '报道1');
  const solo = ranking.find((item) => item.title === '报道4');
  assert.equal(hot.topicHeatBonus, 4);
  assert.equal(solo.topicHeatBonus, 0);
  assert.ok(hot.finalPreScore > solo.finalPreScore);
});

function dimensionHotspot(id, parts) {
  const { labels, ...rest } = parts;
  return { id, title:`报道${id}`, source:'rsshub', url:`https://example.com/${id}`, category:'🤖 AI/技术动态', market_scope:'国内', score:80,
    raw_json:JSON.stringify({ aiTags:{ eventKey:`${rest.who}|${rest.what}`, eventParts:{ ...rest, labels:labels || {} }, chinaRelevance:8, relevanceReason:'相关', riskLevel:'低', keywords:[],
      preScores:{ conflict:10, audience:10, informationGain:10, emotion:5, timeliness:5, impact:5, sourceReliability:5 }, blackHorseSignals:[] } }) };
}

test('who 维度：多事件主体成组，minWhoEvents=1 时单事件主体也成候选', () => {
  const clusters = clusterItems([
    dimensionHotspot(1, { who:'openai', what:'发布gpt5', actionType:'发布', labels:{ who:'OpenAI' } }),
    dimensionHotspot(2, { who:'openai', what:'回应安全争议', actionType:'争议回应', labels:{ who:'OpenAI' } }),
    dimensionHotspot(3, { who:'google', what:'发布gemini', actionType:'发布', labels:{ who:'Google' } }),
  ]);
  const ranking = preselection(clusters, '2026-07-23');
  const groups = dimensionSelections(clusters, ranking);
  const whoGroups = groups.filter((group) => group.dimension === 'who');
  assert.equal(whoGroups.length, 1);
  assert.equal(whoGroups[0].key, 'openai');
  assert.equal(whoGroups[0].title, 'OpenAI近期动态');
  assert.equal(whoGroups[0].events.length, 2);
  assert.equal(DIMENSION_POOL_ROLES.who, '主体动态');
  const withSingles = dimensionSelections(clusters, ranking, { minWhoEvents: 1 });
  assert.equal(withSingles.filter((group) => group.dimension === 'who').length, 2);
});

test('跨维度组共享一半以上事件时只占一个 8+2 席位，维度分不再封顶 100', () => {
  const clusters=clusterItems([
    dimensionHotspot(1,{who:'openai',what:'发布agent',actionType:'发布',object:'agent',labels:{who:'OpenAI',object:'Agent'}}),
    dimensionHotspot(2,{who:'openai',what:'发布模型',actionType:'发布',object:'model',labels:{who:'OpenAI'}}),
    dimensionHotspot(3,{who:'google',what:'发布agent',actionType:'发布',object:'agent',labels:{who:'Google',object:'Agent'}}),
  ]);
  const ranking=preselection(clusters).map((item)=>({...item,finalPreScore:98}));
  const pool=selectDimensionPool(clusters,ranking,{coreLimit:8,blackLimit:0,backupLimit:0,accountContext:{contentPillars:['AI 行业热点：x'],scoring:{accountFitBonus:6}}});
  assert.ok(pool.groups.some((group)=>group.score>100));
  assert.ok(pool.groups.some((group)=>group.duplicateOf));
  const selectedIds=pool.selected.flatMap((group)=>group.events.map((event)=>event.event_id));
  assert.equal(new Set(selectedIds).size,selectedIds.length);
});

test('过宽的发布或开源动作组不生成维度候选，避免吞掉具体主体与对象题', () => {
  const clusters=clusterItems(Array.from({length:9},(_,index)=>dimensionHotspot(index+1,{
    who:`主体${index+1}`,what:`发布项目${index+1}`,actionType:'发布',object:`项目${index+1}`,
  })));
  const groups=dimensionSelections(clusters,preselection(clusters),{minWhoEvents:1,whoLimit:20,whatLimit:20});
  assert.equal(groups.some((group)=>group.key==='action:发布'),false);
  assert.equal(groups.filter((group)=>group.dimension==='who').length,9);
});

test('what 维度：object 组要求至少两个不同主体，actionType 同理', () => {
  const clusters = clusterItems([
    dimensionHotspot(1, { who:'openai', what:'发布agent框架', actionType:'发布', object:'agent框架', labels:{ who:'OpenAI', object:'Agent 框架' } }),
    dimensionHotspot(2, { who:'anthropic', what:'开源agent框架', actionType:'开源', object:'agent框架', labels:{ who:'Anthropic', object:'Agent 框架' } }),
    dimensionHotspot(3, { who:'google', what:'发布gemini', actionType:'发布', object:'gemini', labels:{ who:'Google', object:'Gemini' } }),
  ]);
  const ranking = preselection(clusters, '2026-07-23');
  const whatGroups = dimensionSelections(clusters, ranking).filter((group) => group.dimension === 'what');
  assert.deepEqual(whatGroups.map((group) => group.key).sort(), ['action:发布', 'object:agent框架']);
  const objectGroup = whatGroups.find((group) => group.key === 'object:agent框架');
  assert.equal(objectGroup.title, '近期“Agent 框架”汇总');
  assert.equal(objectGroup.events.length, 2);
});

test('where 维度：仅命名场合成组，缺 occasion 的旧数据自动跳过', () => {
  const clusters = clusterItems([
    dimensionHotspot(1, { who:'openai', what:'waic发布新模型', actionType:'发布', occasion:'waic', labels:{ occasion:'WAIC' } }),
    dimensionHotspot(2, { who:'google', what:'waic展示机器人', actionType:'发布', occasion:'waic', labels:{ occasion:'WAIC' } }),
    dimensionHotspot(3, { who:'meta', what:'发布llama', actionType:'发布' }),
  ]);
  const ranking = preselection(clusters, '2026-07-23');
  const whereGroups = dimensionSelections(clusters, ranking).filter((group) => group.dimension === 'where');
  assert.equal(whereGroups.length, 1);
  assert.equal(whereGroups[0].title, '“WAIC”场合盘点');
  assert.equal(whereGroups[0].events.length, 2);
});

test('事件卡复用：已生成的不重复调用模型，缺失时补生成，可强制重建', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'event-cards-'));
  const hotspots = [1, 2, 3].map((id) => hotspot(id, `事件${id}`, `主体${id}|动作|对象`));
  const batch = { id:'b1', batch_date:'2026-07-23', hotspots };
  const store = { getBatch: () => batch, updateModelCall() {}, upsertArtifact() {} };
  let calls = 0;
  const gateway = { config:{ defaultProvider:'deepseek', providers:{ deepseek:{ maxOutputTokens:8192 } } }, async complete(input) {
    calls += 1;
    const events = JSON.parse(input.messages[1].content);
    return { callId:calls, finishReason:'stop', context:{}, usage:{},
      content: JSON.stringify({ items: events.map((event) => ({ event_id:event.event_id, conclusion:`结论${event.event_id}`, confirmed_facts:[], source_increment:[], disagreements:[], timeline:[], unverified:[], angles:[] })) }) };
  }};
  const first = await ensureBatchEventCards({ gateway, store, batchId:'b1', provider:'deepseek', workspaceRoot:root });
  assert.equal(first.total, 3);
  assert.equal(first.generated, 3);
  assert.ok(fs.existsSync(first.path));
  const callsAfterFirst = calls;
  const second = await ensureBatchEventCards({ gateway, store, batchId:'b1', provider:'deepseek', workspaceRoot:root });
  assert.equal(second.generated, 0);
  assert.equal(second.cached, 3);
  assert.equal(calls, callsAfterFirst);
  const third = await ensureBatchEventCards({ gateway, store, batchId:'b1', provider:'deepseek', workspaceRoot:root, regenerate:true });
  assert.equal(third.generated, 3);
  assert.ok(calls > callsAfterFirst);
});

test('选题报告合并维度候选一节', () => {
  const source = { candidateId:'C001', title:'事件', category:'🤖 AI/技术动态', poolRole:'核心8条', credibleScoop:0, riskLevel:'低' };
  const scored = scoreCards([{ candidateId:'C001', status:'PASS', source,
    bScores:{ angleUniqueness:4, emotionSpread:4, titleHook:4, audienceRelevance:4, factSupport:4 },
    hProfile:{ historicalType:'bigtech', fiveSenseCount:4, fiveQuestionCount:3, recommendationFit:6, emotionTheme:4, searchFriendly:3 } }], { items: [] });
  const withDimensions = markdownRanked(scored, { items: [], metaNarratives: [], combination: {} }, [
    { dimension:'who', key:'kimi', title:'Kimi近期动态', score: 94, riskLevel:'中', events:[{},{},{}], leads:['Kimi 发布新模型', 'Kimi 融资传闻'] },
  ]);
  assert.match(withDimensions, /## 维度候选/);
  assert.match(withDimensions, /主体动态 \| Kimi近期动态 \| 94 \| 中 \| 3/);
  const without = markdownRanked(scored, { items: [], metaNarratives: [], combination: {} });
  assert.ok(!without.includes('维度候选'));
});

test('评分权重可通过 scoring 配置覆盖', () => {
  const source={candidateId:'C001',title:'事件',category:'🤖 AI/技术动态',poolRole:'核心8条',credibleScoop:0,riskLevel:'低'};
  const cards=[{candidateId:'C001',status:'PASS',source,bScores:{angleUniqueness:4,emotionSpread:4,titleHook:4,audienceRelevance:4,factSupport:4},
    hProfile:{historicalType:'bigtech',fiveSenseCount:4,fiveQuestionCount:3,recommendationFit:6,emotionTheme:4,searchFriendly:3}}];
  const synthesis={items:[{candidateId:'C001',saturationPenalty:5,duplicatePenalty:2,audienceRelevance:4,reason:'测试'}]};
  const defaults=scoreCards(cards,synthesis)[0];
  assert.equal(defaults.f,62.4);
  // H=69,B=80,P=40,S=5：默认 69×.6+80×.25+40×.15-5=62.4；自定义权重只改聚合比例
  const custom=resolveScoring({scoring:{weights:{h:0.5,b:0.3,p:0.2}}});
  const adjusted=scoreCards(cards,synthesis,custom)[0];
  assert.equal(adjusted.h,69); assert.equal(adjusted.b,80); assert.equal(adjusted.p,40); assert.equal(adjusted.s,5);
  assert.equal(adjusted.f,Number((69*0.5+80*0.3+40*0.2-5).toFixed(1)));
});

test('scoring 覆盖分类偏好与账号契合加分，非法值回退默认', () => {
  const scoring=resolveScoring({scoring:{categoryPreference:{'📰 综合资讯':-8},accountFitBonus:12,weights:{h:'abc'}}});
  assert.equal(scoring.categoryPreference['📰 综合资讯'],-8);
  assert.equal(scoring.categoryPreference['🏢 大厂战略'],6);
  assert.equal(scoring.accountFitBonus,12);
  assert.equal(scoring.weights.h,0.6);
  const events=clusterItems([hotspot(1,'A报道','主体|发布|模型')]);
  const ranking=preselection(events,'2026-07-23',scoring);
  assert.equal(ranking[0].categoryPreference,4);
  const pool=selectDimensionPool(events,ranking,{accountContext:{contentPillars:['AI 行业热点：x'],scoring:{accountFitBonus:12}}});
  assert.equal(pool.groups.find((g)=>g.accountFit>0).accountFit,12);
});

test('选题报告公式文案跟随实际权重', () => {
  const source={candidateId:'C001',title:'事件',category:'🤖 AI/技术动态',poolRole:'核心8条',credibleScoop:0,riskLevel:'低'};
  const scored=scoreCards([{candidateId:'C001',status:'PASS',source,bScores:{angleUniqueness:4,emotionSpread:4,titleHook:4,audienceRelevance:4,factSupport:4},
    hProfile:{historicalType:'bigtech',fiveSenseCount:4,fiveQuestionCount:3,recommendationFit:6,emotionTheme:4,searchFriendly:3}}],{items:[]});
  const custom=resolveScoring({scoring:{weights:{h:0.5,b:0.3,p:0.2}}});
  assert.match(markdownRanked(scored,{items:[],metaNarratives:[],combination:{}},[],custom),/F = H×50% \+ B×30% \+ P×20% - S/);
  assert.match(markdownRanked(scored,{items:[],metaNarratives:[],combination:{}}),/F = H×60% \+ B×25% \+ P×15% - S/);
});
