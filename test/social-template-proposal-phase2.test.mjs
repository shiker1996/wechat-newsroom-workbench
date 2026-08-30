import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSocialTemplateProposalMessages, generateSocialTemplateProposal, sanitizeSocialTemplateProposal, validateSocialTemplateProposal, validateSocialTemplateProposalRequest, SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES, SocialTemplateProposalError } from '../server/shared/themes/social-template-proposal.mjs';
import { SocialTemplateProposalStore } from '../server/shared/themes/social-template-proposal-store.mjs';
import { getSocialCardTemplatePack } from '../server/shared/rendering/social-card-template-registry.mjs';
import { handleThemeRoutes } from '../server/platform/http/routes/theme-routes.mjs';
import fs from 'node:fs';

function candidate(overrides={}){
  const roles=Object.fromEntries(['cover','concept','feature','steps','data','compare','evidence','timeline','risk','ending'].map((role)=>[role,{layout:`${role}-proposal`,maxBlocks:role==='cover'?2:4,maxItems:9,supportedBlocks:['text','list','note'],notes:`${role} 的承载建议`}]));
  return {label:'终端实验室',description:'为技术工具设计的深色网格 Social 模板提案',visualDirection:['terminal','grid','mono'],baseTemplatePack:'neon-v1',roles,surface:{density:'standard',decoration:'grid-line',headingTreatment:'accent-bar'},...overrides};
}

function gatewayFor(content){const calls=[];return {calls,config:{defaultProvider:'fake',providers:{fake:{model:'proposal-model',maxOutputTokens:9000}}},async complete(input){calls.push(input);return {content,provider:'fake',model:'proposal-model',callId:calls.length};}};}

test('Phase 2 模板提案请求和输出使用受控 JSON 契约',()=>{
  assert.deepEqual(validateSocialTemplateProposalRequest({prompt:'创建一套适合开发工具的终端风 Social 模板',baseTemplatePack:'neon-v1'}).baseTemplatePack,'neon-v1');
  assert.throws(()=>validateSocialTemplateProposalRequest({prompt:'太短',baseTemplatePack:'neon-v1'}),SocialTemplateProposalError);
  assert.throws(()=>validateSocialTemplateProposal({...candidate(),proposalId:'model-controlled'}),/服务端生成/);
  assert.doesNotThrow(()=>validateSocialTemplateProposal(candidate()));
});

test('Phase 2 提案提示词携带基础模板能力且禁止模型直接写生产代码',()=>{
  const messages=buildSocialTemplateProposalMessages({prompt:'为工具介绍创建差异化的终端模板',baseTemplatePack:'neon-v1',draftMode:'json'},{basePack:getSocialCardTemplatePack('neon-v1')});
  assert.match(messages[0].content,/基础模板包：neon-v1/);
  assert.match(messages[0].content,/十个角色必须全部出现/);
  assert.match(messages[0].content,/visualDirection.*terminal.*grid.*mono/);
  assert.match(messages[0].content,/surface\.density.*compact、standard 或 airy/);
  assert.match(messages[0].content,/不要输出 draft、HTML、CSS/);
  assert.match(messages[0].content,/不是故事板内容/);
});

test('Phase 2 归一化常见 AI 语义变体，补齐角色并保留受控契约',()=>{
  const value=candidate({
    visualDirection:'terminal、grid、mono、grid',
    roles:{cover:candidate().roles.cover},
    surface:{density:'dense',decoration:'grid',headingTreatment:'highlight'},
  });
  const result=sanitizeSocialTemplateProposal(value,{basePack:getSocialCardTemplatePack('neon-v1')});
  assert.deepEqual(result.proposal.visualDirection,['terminal','grid','mono']);
  assert.equal(result.proposal.surface.density,'compact');
  assert.equal(result.proposal.surface.decoration,'grid-line');
  assert.equal(result.proposal.surface.headingTreatment,'highlight-block');
  assert.deepEqual(Object.keys(result.proposal.roles),['cover','concept','feature','steps','data','compare','evidence','timeline','risk','ending']);
  assert.equal(result.proposal.roles.concept.layout,'problem-stack');
  assert.ok(result.repairs.some((item)=>item.field==='roles.concept'));
  assert.doesNotThrow(()=>validateSocialTemplateProposal(result.proposal));
});

test('Phase 2 敏感字段清理并将 HTML/CSS 草稿标为仅隔离预览',()=>{
  const result=sanitizeSocialTemplateProposal({...candidate(),proposalId:'bad',status:'published',draft:{html:'<script>alert(1)</script><div onclick="x">安全</div>',css:'@import url(https://evil.example/x.css); .x{background:url(https://evil.example/x.png)}'}},{draftMode:'html-css'});
  assert.equal(result.proposal.proposalId,undefined);
  assert.equal(result.proposal.status,undefined);
  assert.equal(result.proposal.draft.sandboxOnly,true);
  assert.equal(result.proposal.draft.sanitized,true);
  assert.doesNotMatch(result.proposal.draft.html,/<script|onclick|https?:/i);
  assert.doesNotMatch(result.proposal.draft.css,/@import|url\(|https?:/i);
  assert.ok(result.repairs.length>=2);
});

test('Phase 2 AI 生成返回短期提案并支持一次 JSON 格式修复',async()=>{
  const gateway=gatewayFor(JSON.stringify(candidate()));
  const store=new SocialTemplateProposalStore({ttlMs:1000});
  const result=await generateSocialTemplateProposal({gateway,request:{prompt:'创建一套终端风格的 Social 模板提案',baseTemplatePack:'neon-v1'},candidateStore:store,basePack:getSocialCardTemplatePack('neon-v1')});
  assert.match(result.proposal.proposalId,/^proposal-social-/);
  assert.equal(result.proposal.status,'draft');
  assert.equal(result.proposal.source,'ai-proposal');
  assert.equal(result.proposal.baseTemplatePack,'neon-v1');
  assert.equal(gateway.calls[0].purpose,'social-template-proposal');
  assert.equal(gateway.calls[0].jsonMode,true);
  assert.ok(store.get(result.id));
  const repaired=gatewayFor('not-json');let repairCalls=0;repaired.complete=async(input)=>{repairCalls+=1;return {content:repairCalls===1?'not-json':JSON.stringify(candidate()),provider:'fake',model:'proposal-model',callId:repairCalls};};
  const repairedResult=await generateSocialTemplateProposal({gateway:repaired,request:{prompt:'创建一套终端风格的 Social 模板提案',baseTemplatePack:'neon-v1'},candidateStore:new SocialTemplateProposalStore(),basePack:getSocialCardTemplatePack('neon-v1')});
  assert.equal(repairedResult.repairs[0].field,'proposal');
  assert.equal(repairCalls,2);
});

test('Phase 2 AI 生成可接受字符串关键词、缺失角色和密度别名',async()=>{
  const malformed=candidate({visualDirection:'terminal, grid, mono',roles:{cover:candidate().roles.cover},surface:{density:'comfortable',decoration:'orbit',headingTreatment:'underline'}});
  const result=await generateSocialTemplateProposal({gateway:gatewayFor(JSON.stringify(malformed)),request:{prompt:'创建一套终端风格的 Social 模板提案',baseTemplatePack:'neon-v1'},candidateStore:new SocialTemplateProposalStore(),basePack:getSocialCardTemplatePack('neon-v1')});
  assert.deepEqual(result.proposal.visualDirection,['terminal','grid','mono']);
  assert.equal(result.proposal.surface.density,'airy');
  assert.equal(Object.keys(result.proposal.roles).length,10);
  assert.ok(result.repairs.some((item)=>item.field==='surface.density'));
  assert.ok(result.repairs.some((item)=>item.field==='roles.concept'));
});

test('Phase 2 提案草稿按 TTL 过期且过期错误可定位',()=>{
  let now=0;const store=new SocialTemplateProposalStore({ttlMs:10,now:()=>now}),saved=store.put({proposal:candidate()});now=11;
  assert.throws(()=>store.get(saved.id),(error)=>error.code===SOCIAL_TEMPLATE_PROPOSAL_ERROR_CODES.EXPIRED);
});

test('Phase 2 HTTP 路由生成并读取短期 Social 模板提案',async()=>{
  const gateway=gatewayFor(JSON.stringify(candidate()));let response;
  const json=(_response,status,data)=>{response={status,data};};
  const request={method:'POST',once(){}};
  const handled=await handleThemeRoutes({request,response:{},pathname:'/api/social/template-proposals',searchParams:new URLSearchParams(),json,store:{getUserTheme:()=>null,listUserThemes:()=>[]},body:async()=>({prompt:'创建一套终端风格的 Social 模板提案',baseTemplatePack:'neon-v1'}),models:gateway});
  assert.equal(handled,true);assert.equal(response.status,200);assert.ok(response.data.proposalId);assert.equal(response.data.proposal.status,'draft');
  let read;await handleThemeRoutes({request:{method:'GET'},response:{},pathname:`/api/social/template-proposals/${response.data.proposalId}`,searchParams:new URLSearchParams(),json:(_response,status,data)=>{read={status,data};},store:{getUserTheme:()=>null,listUserThemes:()=>[]}});
  assert.equal(read.status,200);assert.equal(read.data.proposal.proposalId,response.data.proposal.proposalId);
});

test('Phase 2 方案和 API 文档登记模板提案能力',()=>{
  const plan=fs.readFileSync(new URL('../docs/design/social-card-template-authoring-ai-assist-plan.md',import.meta.url),'utf8'),api=fs.readFileSync(new URL('../API.md',import.meta.url),'utf8'),ui=fs.readFileSync(new URL('../public/src/views/theme-manager.js',import.meta.url),'utf8');
  assert.match(plan,/阶段 2：AI 模板提案/);
  assert.match(api,/social\/template-proposals/);
  assert.match(ui,/request\('\/api\/social\/template-proposals'/);
  assert.match(ui,/TEMPLATE PROPOSAL JSON/);
});
