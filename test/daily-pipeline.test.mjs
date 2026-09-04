import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dailyFocusOptions, dailyVisibleChars, normalizeDailyQuality, selectDailyEvents } from '../server/features/articles/llm/daily-pipeline.mjs';

test('批次早报执行标题、自然化、审阅与 SEO 完整阶段',()=>{
  const source=fs.readFileSync(new URL('../server/features/articles/llm/daily-pipeline.mjs',import.meta.url),'utf8');
  for(const skill of ['title-generator','humanizer-zh','article-reviewer','seo-content-optimizer']){
    assert.match(source,new RegExp(skill));
  }
  for(const artifact of ['02-titles.md','03-humanized.md','04-reviewed.md','05-seo-optimized.md']){
    assert.match(source,new RegExp(artifact.replace('.','\\.')));
  }
  assert.match(source,/03-FINAL\.md/);
  assert.match(source,/callDecisionTool/);
  assert.match(source,/decision\.daily_quality_gate/);
});

test('批次早报按主体关系选择全部关联事实卡事件', () => {
  const clusters = [
    { event_id:'e1', representative_title:'一', tags:{eventParts:{who:'openai',labels:{who:'OpenAI'}}}, card:{ conclusion:'结论一' }, articles:[{ title:'来源一', url:'https://example.com/1' }] },
    { event_id:'e2', representative_title:'二', tags:{eventParts:{who:'other'}}, card:null, articles:[] },
    { event_id:'e3', representative_title:'三', tags:{eventParts:{who:'openai',labels:{who:'OpenAI'}}}, card:{ conclusion:'结论三' }, articles:[{ title:'来源三', url:'https://example.com/3' }] },
  ];
  const options=dailyFocusOptions(clusters);
  assert.equal(options[0].label,'OpenAI近期动态');
  const selected = selectDailyEvents(clusters, [{dimension:'who',key:'openai'}]);
  assert.deepEqual(selected.map((item)=>item.event_id), ['e1','e3']);
  assert.equal(selected[1].sources[0].url, 'https://example.com/3');
});

test('动作关系要求至少两个不同主体', () => {
  const clusters = ['甲','乙'].map((who,index)=>({
    event_id:`e${index}`, representative_title:`事件${index}`,
    tags:{eventParts:{who,actionType:'发布',labels:{actionType:'发布'}}},
    card:{conclusion:`结论${index}`},articles:[],
  }));
  const option=dailyFocusOptions(clusters).find((item)=>item.dimension==='what');
  assert.equal(option.key,'action:发布');
  assert.equal(option.eventIds.length,2);
});

test('早报字数统计忽略 H1 与链接 URL', () => {
  assert.equal(dailyVisibleChars('# 标题\n\n[来源](https://example.com)\n正文'), 4);
});

test('多选关系对关联事件取并集并去重', () => {
  const clusters=[
    {event_id:'e1',representative_title:'一',tags:{eventParts:{who:'甲',actionType:'发布'}},card:{conclusion:'一'},articles:[]},
    {event_id:'e2',representative_title:'二',tags:{eventParts:{who:'甲',actionType:'融资'}},card:{conclusion:'二'},articles:[]},
    {event_id:'e3',representative_title:'三',tags:{eventParts:{who:'乙',actionType:'发布'}},card:{conclusion:'三'},articles:[]},
  ];
  const selected=selectDailyEvents(clusters,[{dimension:'who',key:'甲'},{dimension:'what',key:'action:发布'}]);
  assert.deepEqual(selected.map((item)=>item.event_id),['e1','e2','e3']);
});

test('质量门禁忽略推测字数和逐事件ID引用要求', () => {
  const quality=normalizeDailyQuality({pass:false,issues:[
    {message:'未完全覆盖所有事件ID：缺少 E123 的独立引用'},
    {message:'可见字符可能超过1800限制'},
  ]},980);
  assert.equal(quality.pass,true);
  assert.deepEqual(quality.issues,[]);
});
