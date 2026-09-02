import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {Store} from '../server/platform/core/store.mjs';
import {ToolRegistry} from '../server/platform/tools/registry.mjs';
import {runEditorialAgentTurn} from '../server/features/articles/application/agent/editorial-adapter.mjs';
import {applyEditorialResult,buildEditorialMessages,reconcileEditorialAnswer} from '../server/features/articles/llm/editorial-room.mjs';
import {mergeAppendEditorialField,mergeSingleEditorialField} from '../server/features/articles/domain/editorial-patch.mjs';

function registry(){const value=new ToolRegistry();value.register({manifest:{id:'mock-url',name:'网页读取',version:'1.0.0',capabilities:['content.url.fetch'],riskLevel:'network-read',pathInputs:['root'],inputSchema:{type:'object',required:['targetUrl','root'],properties:{targetUrl:{type:'string'},title:{type:'string'},root:{type:'string'}}},outputSchema:{type:'object'}},adapter:{async execute(input){return {status:'ok',data:{url:input.targetUrl,title:input.title,content:'原文证据：产品实测数据为 42。'},artifacts:[],warnings:[],provenance:{requestedUrl:input.targetUrl,finalUrl:input.targetUrl}};}}});value.register({manifest:{id:'mock-project',name:'本地项目读取',version:'1.0.0',capabilities:['filesystem.project.read'],riskLevel:'read-only',pathInputs:['path'],inputSchema:{type:'object',required:['path'],properties:{path:{type:'string'},options:{type:'object'}}},outputSchema:{type:'object'}},adapter:{async execute(input){return {status:'ok',data:{summary:'读取 1 个文件',files:[{path:'体验.md',size:20,excerpt:'本人安装运行后感觉交互一般',truncated:false}],totalFiles:1,totalChars:15,truncated:false,skipped:{}},artifacts:[],warnings:[],provenance:{root:input.path}};}}});return value;}
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'editorial-agent-'));fs.mkdirSync(path.join(root,'config'),{recursive:true});fs.copyFileSync(path.join(process.cwd(),'config','capability-consumers.json'),path.join(root,'config','capability-consumers.json'));const store=new Store(path.join(root,'test.db'));t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});const batch=store.createBatch({date:'2026-08-14',title:'Agent 试点'});store.addHotspots(batch.id,'manual',[{title:'测试事件',url:'https://example.com/source'}]);const hotspot=store.getBatch(batch.id).hotspots[0],candidate=store.addCandidates(batch.id,[hotspot.id],{tracks:['article']})[0];return {root,store,hotspot,candidate};}
// 填满就绪判定要求的全部字段（角度/命题/研判主线/事实基座/作者观点/命题边界）
function completeBrief(store,candidate){store.updateCandidate(candidate.id,{angle:'实测角度',thesis:'工具链需要产品验证',distribution_lane:'实验池',reader_stake:'开发者在选型时需要评估实测数据，否则会采信夸大宣传'});store.saveEditorial(candidate.id,{confirmed_facts:'来源显示实测数据为 42',research_basis:'采用事件内部反常主线：工具已经发布，但实测数据与宣传效果存在落差，需要解释原因',author_opinions:'作者主张实测优先',forbidden_claims:'不扩大样本',experience_required:0,brief_status:'WRITE_NOW'});}

test('编辑室消息把研判信号、关系证据和外部参考材料作为写作输入',async()=>{
  const messages=await buildEditorialMessages({
    hotspot_title:'候选命题',url:'https://example.com/source',category:'新闻事件',risk_level:'低',messages:[],editorial:{},
  },'',[],null,process.cwd(),{
    scope:{top_k:30,events:[{event_id:'E1',title:'事件一'},{event_id:'E2',title:'事件二'}]},event_value:88,
    topic_candidates:[{candidate_id:'T1',topic_type:'event_counterexample',candidate_title:'谁反驳了这个趋势？',core_question:'原有判断在哪些条件下不成立？',angle:'从反例切入',thesis_seed:'趋势存在边界',internal_signal_refs:['E1:anomaly:1'],relation_ids:['MR-001'],evidence_source_ids:['search:1'],evidence_levels:['full_text']}],
    internal_research:[{event_id:'E1',title:'事件一',internal_research:{anomalies:[{signal_id:'E1:anomaly:1',statement:'宣传与结果出现落差',evidence_source_ids:['search:1'],evidence_levels:['full_text']}],interest_conflicts:[],divergence_directions:[]}}],
    inter_event_research:[{relation_id:'MR-001',relation_kind:'counterexample',relation_label:'反例关系',event_ids:['E1','E2'],reference_event_ids:['REF-1'],relationship_statement:'事件二反驳了继续扩大的判断',differences:['动作方向相反'],evidence_source_ids:['search:1'],evidence_levels:['full_text']}],
    reference_events:[{reference_id:'REF-1',reference_only:true,title:'外部反例样本',evidence_level:'summary_only'}],
    evidence_boundary:{open_questions:['反例是否适用于当前主体'],note:'待编辑确认'},
  });
  const content=messages.map((item)=>String(item.content||'')).join('\n');
  assert.match(content,/谁反驳了这个趋势/);
  assert.match(content,/事件二反驳了继续扩大的判断/);
  assert.match(content,/外部反例样本/);
  assert.match(content,/反例关系/);
  assert.match(content,/外部参考事件只能作为关系研判的参考材料/);
});

test('编辑室使用统一 ToolRequest 读取原文，并在同轮基于结果提交决策',async(t)=>{const {root,store,hotspot,candidate}=fixture(t);let calls=0,sawToolResult=false;const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete({messages}){calls+=1;if(calls===1)return {callId:'m1',content:JSON.stringify({type:'tool_requests',assistant_note:'读取原文',requests:[{requestId:'tr_source',capability:'content.url.fetch',arguments:{resourceId:`source:${hotspot.id}`},reason:'核对实测数据'}]}),usage:{},model:'mock'};sawToolResult=messages.some((item)=>item.role==='tool'&&item.content.includes('产品实测数据为 42'));return {callId:'m2',content:JSON.stringify({type:'final',assistantReply:'证据已核对，你的判断是什么？',briefUpdates:{angle:'实测角度',thesis:'工具链需要产品验证',confirmed_facts:'来源显示实测数据为 42',forbidden_claims:'不扩大样本'}}),usage:{total_tokens:20},model:'mock'};}};const events=[{event_id:'E001',title:'测试事件',hotspots:[{...hotspot,sourceDoc:null}]}],stream=[];const result=await runEditorialAgentTurn({gateway,store,registry:registry(),candidateId:candidate.id,provider:'mock',events,workspaceRoot:root,onEvent:(event)=>stream.push(event)});assert.equal(calls,2);assert.equal(sawToolResult,true);assert.equal(result.toolCalls,1);assert.equal(result.editorial.confirmed_facts,'来源显示实测数据为 42');assert.ok(stream.some((event)=>event.type==='tool.completed'&&event.sources?.[0]?.url==='https://example.com/source'));assert.equal(store.getAgentRun(result.agentRunId).status,'completed');});

test('编辑室 Agent 拒绝读取不属于当前候选的资源，锁定候选不进入模型',async(t)=>{const {root,store,candidate}=fixture(t);store.saveEditorial(candidate.id,{brief_status:'LOCKED'});let called=false;await assert.rejects(runEditorialAgentTurn({gateway:{config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:10}}},async complete(){called=true;}},store,registry:registry(),candidateId:candidate.id,events:[],workspaceRoot:root}),/锁定/);assert.equal(called,false);});

test('编辑室对已缓存来源正文的 url.fetch 直接复用缓存，不触发插件执行',async(t)=>{
  const {root,store,hotspot,candidate}=fixture(t);
  const tools=registry(),original=tools.execute.bind(tools);let executions=0;
  tools.execute=async(...args)=>{executions+=1;return original(...args);};
  let calls=0,sawCached=false;
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete({messages}){calls+=1;if(calls===1)return {callId:'c1',content:JSON.stringify({type:'tool_requests',assistant_note:'再读原文',requests:[{requestId:'tr_source',capability:'content.url.fetch',arguments:{resourceId:`source:${hotspot.id}`},reason:'换理由再核对'}]}),usage:{},model:'mock'};sawCached=messages.some((item)=>item.role==='tool'&&item.content.includes('缓存正文'));return {callId:'c2',content:JSON.stringify({type:'final',assistantReply:'已复用缓存，你的判断？',briefUpdates:{confirmed_facts:'缓存正文事实'}}),usage:{},model:'mock'};}};
  const events=[{event_id:'E001',title:'测试事件',hotspots:[{...hotspot,sourceDoc:{url:'https://example.com/source',final_url:'https://example.com/source',title:'来源标题',content:'缓存正文：已抓取的热点原文。'}}]}];
  const result=await runEditorialAgentTurn({gateway,store,registry:tools,candidateId:candidate.id,provider:'mock',events,workspaceRoot:root});
  assert.equal(executions,0,'已缓存资源不应触发插件执行');
  assert.equal(sawCached,true,'缓存正文应进入模型上下文');
  assert.equal(result.toolCalls,1);
  assert.equal(result.editorial.confirmed_facts,'缓存正文事实');
});

test('编辑室 Agent 对非法 JSON 只执行一次结构修复并完成本轮',async(t)=>{
  const {root,store,candidate}=fixture(t);let calls=0,sawSignal=false;
  const output={type:'final',assistantReply:'已修复，你的判断是什么？',briefUpdates:{confirmed_facts:'事实'}};
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete(input){calls+=1;sawSignal=sawSignal||Boolean(input.signal);return calls===1?{callId:'bad',content:'{"type":"final" "assistantReply":}',usage:{},model:'mock'}:{callId:'fixed',content:JSON.stringify(output),usage:{total_tokens:12},model:'mock'};}};
  const controller=new AbortController();
  const result=await runEditorialAgentTurn({gateway,store,registry:registry(),candidateId:candidate.id,events:[],workspaceRoot:root,signal:controller.signal});
  assert.equal(calls,2);assert.equal(sawSignal,true);assert.equal(result.reply.includes('已修复'),true);assert.equal(store.getAgentRun(result.agentRunId).status,'completed');
});

test('编辑室 Agent 将模型 reasoning 作为统一 thinking 事件转发',async(t)=>{
  const {root,store,candidate}=fixture(t);const events=[];
  const output={type:'final',assistantReply:'完成，下一步？',briefUpdates:{confirmed_facts:'事实'}};
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async streamComplete(input,onDelta,onThinking){onThinking('正在核对事实');onThinking('与观点边界');return {callId:'streamed',content:JSON.stringify(output),usage:{},model:'mock'};},async complete(){throw new Error('主步骤不应退回非流式调用');}};
  await runEditorialAgentTurn({gateway,store,registry:registry(),candidateId:candidate.id,events:[],workspaceRoot:root,onEvent:(event)=>events.push(event)});
  assert.deepEqual(events.filter((event)=>event.type==='assistant.thinking').map((event)=>event.text),['正在核对事实','与观点边界']);
  assert.ok(events.filter((event)=>event.type==='assistant.thinking').every((event)=>event.agentRunId));
});

test('编辑室检测到本地项目后先确定性调用读取工具，再让模型判断体验',async(t)=>{
  const {root,store,candidate}=fixture(t);const project=path.join(root,'outputs');fs.mkdirSync(project);let modelCalls=0,sawProjectMaterial=false;
  const output={type:'final',assistantReply:'已核对本地材料，具体哪部分体验一般？',briefUpdates:{angle:'实际使用体验',author_opinions:'体验一般',confirmed_experiences:'本人已实际安装并运行；本地材料记录了运行结果',experience_required:true}};
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete({messages}){modelCalls+=1;sawProjectMaterial=messages.some((item)=>item.role==='tool'&&item.content.includes('本人安装运行后感觉交互一般'));return {callId:'project-final',content:JSON.stringify(output),usage:{},model:'mock'};}};
  const events=[];const result=await runEditorialAgentTurn({gateway,store,registry:registry(),candidateId:candidate.id,answer:`我的体验在 ${project}`,projectPath:project,events:[],workspaceRoot:root,onEvent:(event)=>events.push(event)});
  assert.equal(modelCalls,1);assert.equal(sawProjectMaterial,true);assert.equal(result.toolCalls,1);assert.match(result.editorial.confirmed_experiences,/实际安装并运行/);assert.ok(events.some((event)=>event.type==='tool.requested'&&event.capability==='filesystem.project.read'));
});

test('编辑室 Agent 直接接受打平的 final 信封（assistantReply+briefUpdates 平铺顶层），无需修复',async(t)=>{
  const {root,store,candidate}=fixture(t);let calls=0;
  const flat={type:'final',assistantReply:'已记录体验，具体哪里体验一般？',briefUpdates:{angle:'实际体验',author_opinions:'体验一般',confirmed_experiences:'已安装并运行'}};
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete(){calls+=1;return {callId:'m1',content:JSON.stringify(flat),usage:{},model:'mock'};}};
  const result=await runEditorialAgentTurn({gateway,store,registry:registry(),candidateId:candidate.id,events:[],workspaceRoot:root});
  assert.equal(calls,1,'打平格式应一次通过，不触发修复');assert.equal(result.editorial.confirmed_experiences,'已安装并运行');assert.equal(result.candidate.angle,'实际体验');
});

test('旧嵌套 final（output 层包裹 briefUpdates）仍被兼容展开',async(t)=>{
  const {root,store,candidate}=fixture(t);let calls=0;
  const nested={type:'final',assistantReply:'已记录体验，具体哪里体验一般？',output:{assistantReply:'已记录体验，具体哪里体验一般？',briefUpdates:{angle:'实际体验',confirmed_experiences:'已安装并运行'}}};
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete(){calls+=1;return {callId:'m1',content:JSON.stringify(nested),usage:{},model:'mock'};}};
  const result=await runEditorialAgentTurn({gateway,store,registry:registry(),candidateId:candidate.id,events:[],workspaceRoot:root});
  assert.equal(calls,1,'嵌套旧格式应被兼容，不触发修复');assert.equal(result.candidate.angle,'实际体验');assert.equal(result.editorial.confirmed_experiences,'已安装并运行');
});

test('编辑室业务 Prompt 定义打平的 final 信封（业务字段平铺顶层）',()=>{
  const skillSource=fs.readFileSync(new URL('../skills/editorial-room-chat/SKILL.md',import.meta.url),'utf8');
  assert.match(skillSource,/平铺在 final 信封顶层/);assert.match(skillSource,/不要再套 output 层/);
  assert.doesNotMatch(skillSource,/读取当前决策和对话后返回严格JSON/);
  assert.match(skillSource,/append.*追加并自动去重/);assert.match(skillSource,/remove.*明确列出/);assert.match(skillSource,/单值字段.*replace/);
  const codeSource=fs.readFileSync(new URL('../server/features/articles/llm/editorial-room.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(codeSource,/你是公众号编辑会主持人/,'编辑室 prompt 应只从技能加载，代码不再内联');
});

test('用户明确陈述亲身实践时，确定性沉淀进 confirmed_experiences（本地路径脱敏）',()=>{
  const result=reconcileEditorialAnswer({answer:'已经实际安装并运行过 DeepSeek Harness，但是感觉体验一般，我的使用体验在 C:\\Users\\Tester\\outputs 这里',current:{editorial:{confirmed_experiences:''}},parsed:{assistantReply:'仍需确认',briefUpdates:{}}});
  assert.match(result.briefUpdates.confirmed_experiences,/实际安装并运行过 DeepSeek Harness/);assert.doesNotMatch(result.briefUpdates.confirmed_experiences,/C:\\/);
});

test('用户说"实测了"也确定性沉淀进 confirmed_experiences',()=>{
  const result=reconcileEditorialAnswer({answer:'实测了，但是实测现在deepseek harness和v4pro搭配开发在win平台会遇到工具无法调用以及模型无法支持图片的问题',current:{editorial:{confirmed_experiences:''}},parsed:{assistantReply:'收到',briefUpdates:{}}});
  assert.match(result.briefUpdates.confirmed_experiences,/实测了/);
});

test('无亲身实践陈述时不改动体验字段',()=>{
  const parsed={assistantReply:'确认一下',briefUpdates:{author_opinions:'作者倾向批判'}};
  const result=reconcileEditorialAnswer({answer:'继续',current:{editorial:{confirmed_experiences:'作者已实际安装并运行 DSH'}},parsed});
  assert.equal(result.briefUpdates.confirmed_experiences,undefined,'不应凭空写入体验');
  assert.equal(result.briefUpdates.author_opinions,'作者倾向批判');
});

test('占位符值不写入候选也不覆盖已有实质观点（无补写器兜底，过滤发生在落库前）',async(t)=>{
  const {root,store,candidate}=fixture(t);
  store.updateCandidate(candidate.id,{angle:'已有实质角度'});
  store.saveEditorial(candidate.id,{author_opinions:'已有实质观点'});
  const placeholder={type:'final',assistantReply:'待定，主线？',briefUpdates:{angle:'待定：需作者明确',thesis:'未定',author_opinions:'暂无（尚未征询）'}};
  let calls=0;
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete(){calls+=1;return {callId:'p1',content:JSON.stringify(placeholder),usage:{},model:'mock'};}};
  const result=await runEditorialAgentTurn({gateway,store,registry:registry(),candidateId:candidate.id,provider:'mock',answer:'再想想',events:[],workspaceRoot:root});
  assert.equal(calls,1,'不再有决策补写等额外调用');
  assert.equal(result.candidate.angle,'已有实质角度','占位符不得覆盖已有角度');
  assert.equal(result.editorial.author_opinions,'已有实质观点','占位符不得覆盖已有观点');
});

test('用户作答且决策字段有更新：单次调用完成本轮',async(t)=>{
  const {root,store,candidate}=fixture(t);let calls=0;
  const normal={type:'final',assistantReply:'已记录，读者利益怎么落？',briefUpdates:{angle:'实测角度',author_opinions:'作者主张实测'}};
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete(){calls+=1;return {callId:'m1',content:JSON.stringify(normal),usage:{},model:'mock'};}};
  const result=await runEditorialAgentTurn({gateway,store,registry:registry(),candidateId:candidate.id,provider:'mock',answer:'从实测角度写',events:[],workspaceRoot:root});
  assert.equal(calls,1);assert.equal(result.candidate.angle,'实测角度');
});

test('无用户作答（开场）时单次调用完成本轮',async(t)=>{
  const {root,store,candidate}=fixture(t);let calls=0;
  const opening={type:'final',assistantReply:'开场，你的立场是什么？',briefUpdates:{}};
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete(){calls+=1;return {callId:'m1',content:JSON.stringify(opening),usage:{},model:'mock'};}};
  await runEditorialAgentTurn({gateway,store,registry:registry(),candidateId:candidate.id,provider:'mock',events:[],workspaceRoot:root});
  assert.equal(calls,1);
});

test('briefUpdates 空串不覆盖已有实践记录',async(t)=>{
  const {root,store,candidate}=fixture(t);
  store.saveEditorial(candidate.id,{confirmed_experiences:'作者已实际安装并运行 DSH'});
  const output={type:'final',assistantReply:'已记录，命题边界怎么划？',briefUpdates:{author_opinions:'作者倾向批判定性',confirmed_experiences:''}};
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete(){return {callId:'m1',content:JSON.stringify(output),usage:{},model:'mock'};}};
  const result=await runEditorialAgentTurn({gateway,store,registry:registry(),candidateId:candidate.id,provider:'mock',answer:'继续',events:[],workspaceRoot:root});
  assert.equal(result.editorial.confirmed_experiences,'作者已实际安装并运行 DSH','空串不得覆盖已有实践记录');
  assert.equal(result.editorial.author_opinions,'作者倾向批判定性');
});

test('模型以增量补丁更新编辑底稿时保留已有事实并去重',async(t)=>{
  const {root,store,candidate}=fixture(t);
  store.saveEditorial(candidate.id,{confirmed_facts:'事实 A\n事实 B',author_opinions:'已有观点'});
  const output={type:'final',assistantReply:'已补充事实。',briefUpdates:{confirmed_facts:{append:['事实 B','事实 C']},author_opinions:{append:['已有观点','新增观点']}}};
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete(){return {callId:'patch-1',content:JSON.stringify(output),usage:{},model:'mock'};}};
  const result=await runEditorialAgentTurn({gateway,store,registry:registry(),candidateId:candidate.id,answer:'补充一条事实',events:[],workspaceRoot:root});
  assert.equal(result.editorial.confirmed_facts,'事实 A\n事实 B\n事实 C');
  assert.equal(result.editorial.author_opinions,'已有观点\n新增观点');
});

test('信封层 assistantReply 为空时回退（旧嵌套 output.assistantReply 为空），不产生无声轮次',async(t)=>{
  const {root,store,candidate}=fixture(t);
  const envelope={type:'final',assistantReply:'信封层回复：事实基座已确认',output:{assistantReply:'',briefUpdates:{confirmed_facts:'事实'}}};
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete(){return {callId:'m1',content:JSON.stringify(envelope),usage:{},model:'mock'};}};
  const result=await runEditorialAgentTurn({gateway,store,registry:registry(),candidateId:candidate.id,provider:'mock',events:[],workspaceRoot:root});
  assert.match(result.reply,/信封层回复/);
});

test('底稿字段齐备时由代码推导 WRITE_NOW（不再由模型声明）',async(t)=>{
  const {root,store,candidate}=fixture(t);completeBrief(store,candidate);
  const output={type:'final',assistantReply:'继续讨论',briefUpdates:{author_opinions:'作者补充了新观点'}};
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete(){return {callId:'m1',content:JSON.stringify(output),usage:{},model:'mock'};}};
  const result=await runEditorialAgentTurn({gateway,store,registry:registry(),candidateId:candidate.id,provider:'mock',answer:'补充一点',events:[],workspaceRoot:root});
  assert.equal(result.editorial.brief_status,'WRITE_NOW','字段齐备应保持可成稿');
  assert.equal(result.editorial.open_questions,'','齐备时缺失项为空');
});

test('底稿字段不齐时保持 DISCUSS，缺失项由代码推导写入 open_questions 供展示',async(t)=>{
  const {root,store,candidate}=fixture(t);
  const premature={type:'final',assistantReply:'就写批判方向',briefUpdates:{author_opinions:'作者主张批判'}};
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete(){return {callId:'m1',content:JSON.stringify(premature),usage:{},model:'mock'};}};
  const result=await runEditorialAgentTurn({gateway,store,registry:registry(),candidateId:candidate.id,provider:'mock',answer:'就写批判方向',events:[],workspaceRoot:root});
  assert.equal(result.editorial.brief_status,'DISCUSS','底稿不齐不得成稿');
  assert.match(result.editorial.open_questions,/已确认事实/,'缺失项应包含已确认事实');
});

test('已有对话时留空作答不再触发开场分支，而是继续推进',async(t)=>{
  const {buildEditorialMessages}=await import('../server/features/articles/llm/editorial-room.mjs');
  const fresh=await buildEditorialMessages({editorial:{},messages:[]},'',[],null,'');
  assert.match(fresh.at(-1).content,/编辑会刚开始/);
  const ongoing=await buildEditorialMessages({editorial:{},messages:[{role:'user',content:'上轮回答'}]},'',[],null,'');
  assert.match(ongoing.at(-1).content,/未输入新内容/);assert.doesNotMatch(ongoing.at(-1).content,/编辑会刚开始/);
  // 历史对话展开为真实 user/assistant 回合，不再埋在不可信数据块里
  assert.equal(ongoing[2].role,'user');assert.equal(ongoing[2].content,'上轮回答');
});

test('编辑室把研判转成针对性提问输入，不把评分带入模型上下文',async()=>{
  const {buildEditorialMessages}=await import('../server/features/articles/llm/editorial-room.mjs');
  const messages=await buildEditorialMessages({editorial:{},messages:[]},'',[],null,'',{
    event_value:92,event_rank:1,
    topic_candidates:[{candidate_title:'AI 工具被强推后，开发者承担了什么成本？',core_question:'强推效率与实际负担是否冲突？',angle:'从开发者成本切入',thesis_seed:'不能只看效率宣传'}],
    internal_research:[{event_id:'E1',internal_research:{anomalies:[{statement:'发布后操作成本反而上升'}],interest_conflicts:[{statement:'平台与开发者承担的成本不同'}],divergence_directions:[]}}],
    relations:[{relation_id:'R1',relation_kind:'response',relationship_statement:'后续版本回应了上一版本暴露的操作问题',event_ids:['E1','E2']}],
    evidence_boundary:{open_questions:['实际成本仍需来源正文核验']},scope:{events:[{event_id:'E1',title:'AI 工具发布'}]},
  });
  const context=messages.find((item)=>item.content.includes('editorial-context'))?.content || '';
  const instruction=messages.at(-1).content;
  assert.match(context,/focus_topic/);assert.match(context,/发布后操作成本反而上升/);assert.match(context,/response/);
  assert.doesNotMatch(context,/event_value|event_rank/);
  assert.match(instruction,/必须以模型研判为提问主线/);assert.match(instruction,/不要让作者从空白开始泛泛回答/);
});

test('作者收窄事件范围只落表单字段（excluded_events 机制已回滚）',async(t)=>{
  const {root,store,candidate}=fixture(t);
  const output={type:'final',assistantReply:'已记录：聚焦 AI 收编主线，放弃支付与游戏事件。',briefUpdates:{author_opinions:'聚焦巨头收编 AI 资产主线',rejected_angles:'放弃阿里灵犀与 PayPal 事件',confirmed_facts:'仅保留 SpaceX-Cursor 与 Anthropic-Decart 事实'}};
  const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:4096}}},async complete(){return {callId:'m1',content:JSON.stringify(output),usage:{},model:'mock'};}};
  const result=await runEditorialAgentTurn({gateway,store,registry:registry(),candidateId:candidate.id,provider:'mock',answer:'放弃阿里灵犀与 PayPal，只保留 SpaceX-Cursor + Anthropic-Decart 主线',events:[],workspaceRoot:root});
  assert.equal(result.editorial.rejected_angles,'放弃阿里灵犀与 PayPal 事件');
  assert.equal(result.editorial.author_opinions,'聚焦巨头收编 AI 资产主线');
  assert.equal(result.editorial.confirmed_facts,'仅保留 SpaceX-Cursor 与 Anthropic-Decart 事实');
  assert.equal(result.editorial.excluded_events,'[]','不再写入结构化舍弃字段');
});

test('编辑室生产路由只使用统一 Agent 与共享工具事件渲染器',()=>{const source=fs.readFileSync(new URL('../server/platform/http/routes/article-routes.mjs',import.meta.url),'utf8'),client=fs.readFileSync(new URL('../public/src/core/stream-chat.js',import.meta.url),'utf8'),events=fs.readFileSync(new URL('../public/src/core/agent-events.js',import.meta.url),'utf8');assert.match(source,/runEditorialAgentTurn/);assert.doesNotMatch(source,/runEditorialTurnStream/);assert.match(source,/onEvent:send/);assert.match(client,/consumeAgentEvent/);assert.match(events,/tool\.requested/);assert.match(events,/assistant\.delta/);});

test('就绪判定：长文本中的事实状态描述（尚未完成）不被误判为占位符',async()=>{
  const {evaluateEditorialReadiness,substantiveDecision}=await import('../server/features/articles/index.mjs');
  assert.equal(substantiveDecision('待定'),false,'纯占位符仍判不合格');
  assert.equal(substantiveDecision('暂无（尚未征询）'),false,'短搪塞值仍判不合格');
  assert.equal(substantiveDecision('【Anthropic拟收购Decart】据虎嗅报道：Anthropic 拟以 60 亿美元收购 Decart（尚未完成）。'),true,'长文本中的"尚未完成"是事实状态，不是占位符');
  const readiness=evaluateEditorialReadiness({
    candidate:{angle:'从开发者视角看工具演进',thesis:'大厂收编加速工具演进'},
    editorial:{confirmed_facts:'据事件研判：SpaceX 于 8 月 14 日完成对 Cursor 的收购；据虎嗅报道：Anthropic 拟收购 Decart（尚未完成）。',research_basis:'采用事件间对比主线：一项收购已经完成，另一项仍处于拟议阶段，比较两种收编路径。',author_opinions:'作者判断是机会',forbidden_claims:'未证实内容不得写入'},
  });
  assert.equal(readiness.ready,true,'必填项齐备即可成稿');
});

test('就绪判定：没有禁止写入内容时允许该字段留空',async()=>{
  const {evaluateEditorialReadiness}=await import('../server/features/articles/index.mjs');
  const readiness=evaluateEditorialReadiness({
    candidate:{angle:'从开发者视角看工具演进',thesis:'大厂收编加速工具演进'},
    editorial:{confirmed_facts:'来源报道该功能已于本周上线，并记录了实际使用限制',research_basis:'采用事件内部反常：公开宣传与实际效果存在差异，文章解释造成差异的原因',author_opinions:'作者明确观点',forbidden_claims:''},
  });
  assert.equal(readiness.ready,true,'禁止写入为空表示没有额外禁写边界，不应阻塞成稿');
  assert.deepEqual(readiness.missing,[]);
});

test('就绪判定：没有采用的研判主线时不能锁定',async()=>{
  const {evaluateEditorialReadiness,researchBasisDecision,confirmedFactsDecision}=await import('../server/features/articles/index.mjs');
  assert.equal(researchBasisDecision('已融入「环境突变」维度，强调模型在开放环境中的行为突变与不可预测性'),false);
  assert.equal(researchBasisDecision('采用事件内部反常主线：7·30 与 8·4 连续发生未授权联网行动，文章追问配置错误是否暴露了开放环境中的对齐脆弱性'),true);
  assert.equal(confirmedFactsDecision('已确认该事件的事实链条'),false);
  const readiness=evaluateEditorialReadiness({
    candidate:{angle:'从开发者视角看工具演进',thesis:'大厂收编加速工具演进'},
    editorial:{confirmed_facts:'来源报道该功能已于本周上线，并记录了实际使用限制',author_opinions:'作者明确观点',forbidden_claims:''},
  });
  assert.equal(readiness.ready,false);
  assert.deepEqual(readiness.missing,['采用的研判主线']);
});

test('编辑室落表会清理命题末尾的流程状态文字',async(t)=>{
  const {store,candidate}=fixture(t);
  const current=store.getCandidate(candidate.id);
  const result=applyEditorialResult({store,candidateId:candidate.id,current,parsed:{assistantReply:'已记录',briefUpdates:{thesis:'文章要证明真实环境会放大对齐风险。命题与角度已对齐，依赖链上事实、观点、命题均已合格。'}},result:{usage:{},model:'mock'}});
  assert.equal(result.candidate.thesis,'文章要证明真实环境会放大对齐风险');
});

test('编辑室底稿多值字段默认追加去重，删除和清空必须显式操作',()=>{
  const valid=()=>true;
  assert.equal(mergeAppendEditorialField('事实 A\n事实 B',{append:['事实 B','事实 C']},valid),'事实 A\n事实 B\n事实 C');
  assert.equal(mergeAppendEditorialField('事实 A\n事实 B\n事实 C',{remove:['事实 B']},valid),'事实 A\n事实 C');
  assert.equal(mergeAppendEditorialField('事实 A',{replace:'暂无'},(value)=>value!=='暂无'),'事实 A');
  assert.equal(mergeAppendEditorialField('事实 A',{clear:true},valid),'');
});

test('编辑室底稿单值字段不会被隐式追加，只接受明确替换',()=>{
  assert.equal(mergeSingleEditorialField('原研判主线',{append:'补充说明'},()=>true),'原研判主线');
  assert.equal(mergeSingleEditorialField('原研判主线',{replace:'新研判主线'},()=>true),'新研判主线');
  assert.equal(mergeSingleEditorialField('原研判主线',{clear:true},()=>true),'');
});

test('编辑室前端门禁：长文本中的边界词不应被当作占位符',()=>{
  const source=fs.readFileSync(new URL('../public/src/views/editorial.js',import.meta.url),'utf8');
  assert.match(source,/text\.length\s*<=\s*30\s*&&\s*PLACEHOLDER\.test\(text\)/,'前端应与服务端按短文本范围判断占位符');
});
