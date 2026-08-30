import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { getBuiltinThemeRegistry } from '../server/shared/themes/theme-registry.mjs';
import { AiThemeCandidateStore, AiThemeRateLimiter } from '../server/shared/themes/ai-theme-candidate-store.mjs';
import { generateAiThemeCandidate, normalizeAiThemeCandidate, AI_THEME_PROMPT_VERSION } from '../server/platform/application/themes/ai-theme-generator.mjs';
import { AI_THEME_ERROR_CODES } from '../server/shared/themes/ai-theme-contract.mjs';
import { handleThemeRoutes } from '../server/platform/http/routes/theme-routes.mjs';

const registry=getBuiltinThemeRegistry();
function candidateFrom(id){const definition=registry.get(id),target=definition.targets[0];return {label:definition.label,description:definition.description,tags:definition.tags,tokens:structuredClone(definition.tokens),targetConfig:structuredClone(definition[target]),designSummary:[{title:'视觉方向',description:'使用受控配色和组件配方建立清晰稳定的阅读层级'}]};}
function input(target='article'){return {target,prompt:target==='article'?'适合技术深度文章的深色编辑主题，层级明确并优先保证长文阅读舒适度。':'适合职场经验分享的温暖图文主题，信息清晰并保持克制的编辑感。',preferences:{brightness:target==='article'?'dark':'light',tone:['restrained'],readingPriority:'long-form'}};}
function gatewayFor(replies){const calls=[];return {calls,config:{defaultProvider:'fake',providers:{fake:{model:'fake-theme-model',maxOutputTokens:6000}}},async complete(request){calls.push(request);const content=replies.shift();if(content instanceof Error)throw content;return {content,provider:'fake',model:'fake-theme-model',callId:calls.length};}};}
function workspace(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ai-theme-stage2-')),store=new Store(path.join(dir,'themes.db'));t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return store;}

test('阶段 1 生成候选通过规范化、五项门禁和正式样稿且不写入主题数据库',async()=>{
  const gateway=gatewayFor([JSON.stringify(candidateFrom('magazine-warm'))]),store=new AiThemeCandidateStore();
  const result=await generateAiThemeCandidate({gateway,input:input(),candidateStore:store});
  assert.equal(result.target,'article');assert.equal(result.audit.valid,true);assert.match(result.preview.html,/<h1/);assert.ok(result.preview.usageMap);assert.equal(result.promptVersion,AI_THEME_PROMPT_VERSION);assert.equal(result.model.model,'fake-theme-model');assert.equal(result.comparison.nearestTheme.id,'magazine-warm');assert.equal(result.comparison.recommendRegenerate,true);assert.equal(gateway.calls[0].purpose,'theme-create');assert.equal(gateway.calls[0].jsonMode,true);assert.equal(gateway.calls[0].thinking,false);assert.ok(store.get(result.id));
});

test('阶段 1 模型 JSON 格式错误只执行一次结构修复',async()=>{
  const gateway=gatewayFor(['{"label":',JSON.stringify(candidateFrom('ice-blue'))]);
  const result=await generateAiThemeCandidate({gateway,input:input('social')});
  assert.deepEqual(gateway.calls.map((call)=>call.purpose),['theme-create','theme-create-format-repair']);assert.equal(result.repairs[0].reason,'执行一次模型格式修复');assert.equal(result.audit.valid,true);
});

test('阶段 1 确定性修复颜色格式、数值边界与步进并记录差异',()=>{
  const candidate=candidateFrom('magazine-warm');candidate.tokens.colors.accent='#369';candidate.tokens.typography.letterSpacingEm=.024;candidate.tokens.shape.radiusPx=99;
  const result=normalizeAiThemeCandidate(candidate,{target:'article'});
  assert.equal(result.candidate.tokens.colors.accent,'#336699');assert.equal(result.candidate.tokens.typography.letterSpacingEm,.025);assert.equal(result.candidate.tokens.shape.radiusPx,32);assert.ok(result.repairs.some((item)=>item.field==='tokens.shape.radiusPx'));
});

test('深色科技主题自动协调代码背景、亮强调色与反白文字的对比度',async()=>{
  const candidate=candidateFrom('ice-blue');
  Object.assign(candidate.tokens.colors,{background:'#07111F',surface:'#10233A',page:'#0B1728',text:'#EAF2FF',muted:'#91A4BD',accent:'#32D6FF',accentSecondary:'#7C8CFF',line:'#23415F',inverseText:'#FFFFFF',codeBackground:'#050B14'});
  const result=await generateAiThemeCandidate({gateway:gatewayFor([JSON.stringify(candidate)]),input:input('social')});
  assert.equal(result.audit.valid,true);
  assert.equal(result.definition.tokens.colors.inverseText,'#FFFFFF');
  assert.notEqual(result.definition.tokens.colors.accent,'#32D6FF');
  assert.ok(result.repairs.some((item)=>item.field==='tokens.colors.accent'&&item.reason.includes('反白组件')));
});

test('AI 图文候选收紧字号与间距上限并自动降低组合密度',()=>{
  const candidate=candidateFrom('ice-blue');Object.assign(candidate.tokens.typography,{bodyPx:18,h1Px:44,h2Px:28,captionPx:15,lineHeight:2.1});Object.assign(candidate.tokens.spacing,{articlePaddingPx:40,sectionPx:48,paragraphPx:28,cardGapPx:28});
  const result=normalizeAiThemeCandidate(candidate,{target:'social'}),tokens=result.candidate.tokens;
  assert.ok(tokens.typography.bodyPx<=13);assert.ok(tokens.typography.h1Px<=34);assert.ok(tokens.typography.h2Px<=18);assert.ok(tokens.typography.captionPx<=11);assert.ok(tokens.typography.lineHeight<=1.55);assert.ok(tokens.spacing.articlePaddingPx<=28);assert.ok(tokens.spacing.sectionPx<=28);assert.ok(tokens.spacing.paragraphPx<=12);assert.ok(tokens.spacing.cardGapPx<=14);
  assert.ok(result.repairs.some((item)=>item.reason.includes('组合密度')));
});

test('designSummary 缺失或格式异常时自动合成合规摘要',()=>{
  const candidate=candidateFrom('magazine-warm');delete candidate.designSummary;
  const missing=normalizeAiThemeCandidate(candidate,{target:'article'});
  assert.equal(missing.candidate.designSummary.length,1);assert.equal(missing.candidate.designSummary[0].title,'设计说明');assert.ok(missing.candidate.designSummary[0].description.length>=1);assert.ok(missing.repairs.some((item)=>item.field==='designSummary'));
  const malformed=candidateFrom('magazine-warm');malformed.designSummary=['不是对象',{title:'  ',description:'x'.repeat(150)},{title:'配色',description:'克制配色'}];
  const fixed=normalizeAiThemeCandidate(malformed,{target:'article'});
  assert.ok(fixed.candidate.designSummary.every((item)=>item.title.length>=1&&item.title.length<=20&&item.description.length>=1&&item.description.length<=100));assert.equal(fixed.candidate.designSummary[1].title,'配色');
  const many=candidateFrom('magazine-warm');many.designSummary=Array.from({length:9},(_,index)=>({title:`条目${index}`,description:'说明'}));
  assert.equal(normalizeAiThemeCandidate(many,{target:'article'}).candidate.designSummary.length,6);
});

test('文章与封面候选自动移除不消费的 page 颜色并记录修复',()=>{
  const candidate=candidateFrom('magazine-warm');candidate.tokens.colors.page='#F5F1EA';
  const article=normalizeAiThemeCandidate(candidate,{target:'article'});
  assert.equal(article.candidate.tokens.colors.page,undefined);assert.ok(article.repairs.some((item)=>item.field==='tokens.colors.page'&&item.reason.includes('不消费')));
  const social=normalizeAiThemeCandidate(structuredClone(candidate),{target:'social'});
  assert.equal(social.candidate.tokens.colors.page,'#F5F1EA');
});

test('AI 候选修复模型常见的颜色别名、缺失枚举和误放行为字段',async()=>{
  const candidate=candidateFrom('magazine-warm'),colors=candidate.tokens.colors,behavior=candidate.targetConfig.behavior;
  colors.codeText=colors.inverseText;colors.border=colors.line;delete colors.inverseText;delete colors.line;delete candidate.tokens.typography.family;delete candidate.tokens.typography.headingFamily;delete candidate.tokens.shape.shadow;
  behavior.readingPriority='long-form';behavior.codeTheme='dark';behavior.brightness='dark';delete behavior.justify;delete behavior.numberSections;delete behavior.highlightStrong;
  const gateway=gatewayFor([JSON.stringify(candidate)]),result=await generateAiThemeCandidate({gateway,input:input()});
  assert.equal(result.audit.valid,true);assert.equal(result.definition.tokens.colors.line,'#D8CDBF');assert.equal(result.definition.tokens.colors.inverseText,'#FFFFFF');assert.equal(result.definition.tokens.colors.border,undefined);assert.equal(result.definition.tokens.colors.codeText,undefined);assert.equal(result.definition.tokens.typography.family,'sans');assert.equal(result.definition.tokens.typography.headingFamily,'serif');assert.equal(result.definition.tokens.shape.shadow,'none');assert.deepEqual(result.definition.article.behavior,{justify:true,numberSections:false,highlightStrong:'accent'});assert.ok(result.repairs.some((item)=>item.field==='tokens.colors.line'));assert.ok(result.repairs.some((item)=>item.field==='targetConfig.behavior.readingPriority'));
});

test('阶段 1 候选仓库按 TTL 过期且限流器使用稳定错误码',()=>{
  let now=1000;const store=new AiThemeCandidateStore({ttlMs:100,maxEntries:2,now:()=>now}),saved=store.put({target:'article'});assert.equal(store.get(saved.id).target,'article');now=1101;assert.throws(()=>store.get(saved.id),(error)=>error.code===AI_THEME_ERROR_CODES.CANDIDATE_EXPIRED);
  const limiter=new AiThemeRateLimiter({limit:2,windowMs:1000,now:()=>now});limiter.assert();limiter.assert();assert.throws(()=>limiter.assert(),(error)=>error.code===AI_THEME_ERROR_CODES.RATE_LIMITED);
});

test('阶段 1 取消信号阻止模型调用和候选持久化',async()=>{
  const gateway=gatewayFor([JSON.stringify(candidateFrom('magazine-warm'))]),store=new AiThemeCandidateStore(),controller=new AbortController();controller.abort();
  await assert.rejects(generateAiThemeCandidate({gateway,input:input(),candidateStore:store,signal:controller.signal}),(error)=>error.code===AI_THEME_ERROR_CODES.GENERATION_CANCELLED);assert.equal(gateway.calls.length,0);assert.equal(store.items.size,0);
});

test('阶段 1 HTTP 生成接口返回临时候选且透传结构化错误码',async()=>{
  const gateway=gatewayFor([JSON.stringify(candidateFrom('magazine-warm'))]),request=Object.assign(new EventEmitter(),{method:'POST'}),responses=[];
  const handled=await handleThemeRoutes({request,response:{},pathname:'/api/themes/ai/generate',searchParams:new URLSearchParams(),json:(_response,status,value)=>responses.push({status,value}),store:{},body:async()=>input(),models:gateway,candidateStore:new AiThemeCandidateStore(),rateLimiter:new AiThemeRateLimiter()});
  assert.equal(handled,true);assert.equal(responses[0].status,200);assert.ok(responses[0].value.candidateId);assert.equal(responses[0].value.audit.valid,true);assert.equal(responses[0].value.id,undefined);
});

test('阶段 2 确认接口只从服务端候选创建草稿并在成功后消费候选',async t=>{
  const store=workspace(t),candidateStore=new AiThemeCandidateStore(),gateway=gatewayFor([JSON.stringify(candidateFrom('magazine-warm'))]),candidate=await generateAiThemeCandidate({gateway,input:input(),candidateStore}),request=Object.assign(new EventEmitter(),{method:'POST'}),responses=[];
  const handled=await handleThemeRoutes({request,response:{},pathname:`/api/themes/ai/candidates/${candidate.id}/create`,searchParams:new URLSearchParams(),json:(_response,status,value)=>responses.push({status,value}),store,body:async()=>({label:'AI 暖纸技术版',description:'确认后的用户主题草稿'}),models:gateway,candidateStore,rateLimiter:new AiThemeRateLimiter()});
  assert.equal(handled,true);assert.equal(responses[0].status,201);assert.match(responses[0].value.theme.id,/^ai-article-[a-f0-9]{8}$/);assert.equal(responses[0].value.theme.label,'AI 暖纸技术版');assert.equal(responses[0].value.theme.status,'draft');assert.equal(store.listUserThemes({includeArchived:true}).length,1);assert.throws(()=>candidateStore.get(candidate.id),(error)=>error.code===AI_THEME_ERROR_CODES.CANDIDATE_EXPIRED);
});

test('阶段 2 主题中心提供 AI 创建、候选确认、重新生成与正式样稿交互',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),ui=fs.readFileSync(new URL('../public/src/views/theme-manager.js',import.meta.url),'utf8'),styles=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
  for(const id of ['open-ai-theme-creator','ai-theme-prompt','generate-ai-theme','ai-theme-candidate-frame','regenerate-ai-theme','create-ai-theme-draft'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(ui,/\/api\/themes\/ai\/generate/);assert.match(ui,/\/api\/themes\/ai\/candidates\/\$\{encodeURIComponent\(aiCandidate\.candidateId\)\}\/create/);assert.match(ui,/aiGenerationController\?\.abort/);assert.match(ui,/ai-theme-generation-issues/);assert.match(ui,/ai-theme-comparison/);assert.match(ui,/renderAiGenerationIssues\(error\.issues\)/);assert.match(ui,/mountAiCandidatePreview\(result\.preview\?\.html\)/);assert.match(styles,/\.ai-theme-candidate\{display:grid/);assert.match(styles,/\.ai-theme-comparison\[data-tone="warning"\]/);
});
