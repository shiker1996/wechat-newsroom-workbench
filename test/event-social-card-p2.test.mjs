import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateEventCardGate } from '../lib/domain/social-card-gate.mjs';
import { renderStoryboardHtml } from '../lib/llm/social-card-pipeline.mjs';
import { Store } from '../lib/core/store.mjs';
import { routeBreakingAnalysis } from '../lib/llm/breaking-analysis-pipeline.mjs';
import { socialThemeDefinition } from '../lib/themes/social-theme-compiler.mjs';

test('事件图文门禁要求事实边界、来源审计和故事板',()=>{
  const analysis={eventSummary:'事件摘要',sources:[{status:'ok'}],factBase:{confirmedFacts:[{claim:'事实'}],claims:[]},sourceAudit:{issues:[]}};
  const editorial={card_plan_json:JSON.stringify(Array.from({length:6},(_,index)=>({kind:index?'timeline':'cover'}))),must_disclose:'未核实内容已标注',forbidden_claims:'不得写成已定性事实',target_reader:'科技从业者',pain_point:'信息真假难辨'};
  const gate=evaluateEventCardGate({},analysis,editorial);
  assert.equal(gate.ready,true);assert.equal(gate.contentType,'event');
});

test('事件故事板 HTML 使用事件标签和事实边界页脚',()=>{
  const legacyTheme=structuredClone(socialThemeDefinition('peach')); delete legacyTheme.social.templatePack; delete legacyTheme.hash; delete legacyTheme.file;
  const html=renderStoryboardHtml({topic:'突发事件',contentType:'event',sourceLabel:'突发专题',visualStyle:'peach',themeDefinition:legacyTheme,pages:[
    {kind:'cover',title:'发生了什么',goal:'核心事件',content_blocks:[{type:'text',content:'确认事实'}]},
    {kind:'evidence',title:'证据核验',content_blocks:[{type:'note',content:'该主张尚未获独立证实'}]},
    {kind:'risk',title:'事实边界',content_blocks:[{type:'list',content:'来源单一\n等待回应'}]},
    {kind:'ending',title:'继续关注',content_blocks:[{type:'text',content:'等待更多公开信息'}]},
  ]});
  assert.match(html,/BREAKING FOCUS/);assert.match(html,/EVIDENCE CHECK/);assert.match(html,/据公开素材整理 · 未核实内容已标注/);assert.doesNotMatch(html,/OPEN SOURCE/);
});

test('事件图文分流设置正式输出模式和默认视觉主题',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'event-social-route-'));const store=new Store(path.join(root,'test.db'));
  try{
    const batch=store.createBreakingBatch({date:'2026-07-23',title:'事件',urls:['https://example.com'],requestedTracks:['social_cards']});
    store.saveBreakingAnalysis(batch.id,{eventSummary:'摘要',sourceAudit:{issues:[],neededMaterials:[]},article:{finalScore:60,baseScore:60,penalty:0,dimensions:{audienceRelevance:12,sourceReliability:3},angle:'',thesis:'',risks:[]},social:{finalScore:80,recommendedPages:7,dimensions:{informationDensity:18},penalties:{},recommendation:'recommend'}});
    const {candidate}=routeBreakingAnalysis({store,batchId:batch.id,tracks:['social_cards']});
    const track=store.listCandidateTracks(candidate.id).find((item)=>item.track==='social_cards');
    const editorial=store.getCardEditorial(candidate.id);
    assert.equal(track.output_mode,'wechat-event-cards');assert.equal(editorial.output_mode,'wechat-event-cards');assert.equal(editorial.visual_style,'charcoal');assert.equal(editorial.recommended_pages,7);
  }finally{store.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('事件故事板规则与后续生成交付规则职责分离',()=>{
  const storyboard=fs.readFileSync(new URL('../skills/event-card-storyboard/SKILL.md',import.meta.url),'utf8');
  const planning=fs.readFileSync(new URL('../skills/event-card-storyboard/references/storyboard.md',import.meta.url),'utf8');
  const delivery=fs.readFileSync(new URL('../skills/xiaohongshu-article-generator/references/copy-event.md',import.meta.url),'utf8');
  assert.match(storyboard,/突发事件/);
  assert.match(planning,/至少一页说明事实边界/);
  assert.match(delivery,/传播张力不得高于证据强度/);
});
