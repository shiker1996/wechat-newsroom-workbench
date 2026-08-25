import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectArticleQuality } from '../server/features/articles/domain/article-quality.mjs';
import { resolveArticleLength } from '../server/platform/core/config.mjs';
import { brainstorm, breakingSynthesis } from '../server/features/research/application/research-pipeline.mjs';
import { hasScoreScaleContradiction } from '../server/features/articles/llm/breaking-analysis-pipeline.mjs';
import { runAudit } from '../server/features/social-cards/application/social-card-pipeline.mjs';

test('普通有序列表不再被当作来源脚注',()=>{
  const report=inspectArticleQuality('# 标题\n\n1. 第一步\n2. 第二步');
  assert.equal(report.footnoteCount,0);
  assert.ok(report.issues.includes('关键事实没有来源链接或脚注'));
});

test('文章字数配置拒绝 NaN、倒置和非正上限',()=>{
  assert.throws(()=>resolveArticleLength({articleLength:{minVisibleChars:'NaN',maxVisibleChars:2000}}),/字数配置无效/);
  assert.throws(()=>resolveArticleLength({articleLength:{minVisibleChars:2000,maxVisibleChars:1000}}),/字数配置无效/);
  assert.throws(()=>resolveArticleLength({articleLength:{minVisibleChars:0,maxVisibleChars:0}}),/字数配置无效/);
});

test('突发受众相关度保留合法零分且量纲检测不依赖理由数量',()=>{
  assert.equal(breakingSynthesis([{candidateId:'C001',bScores:{audienceRelevance:0}}]).items[0].audienceRelevance,0);
  assert.equal(hasScoreScaleContradiction({baseScore:20},'技术热点快评'),true);
  assert.equal(hasScoreScaleContradiction({baseScore:20},'暂不生产'),false);
});

test('布局审计执行失败时删除旧报告且不得复用为通过',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r4-layout-audit-'));const report=path.join(root,'layout-report.json');const script=path.join(root,'fail.mjs');const html=path.join(root,'x.html');
  try{fs.writeFileSync(report,JSON.stringify({valid:true}));fs.writeFileSync(script,"process.exit(2);\n");fs.writeFileSync(html,'<html></html>');await assert.rejects(()=>runAudit(script,html,report,root));assert.equal(fs.existsSync(report),false);}finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('脑暴单卡连续失败写入台账并继续处理下一张',async()=>{
  const failures=[];let calls=0;const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:8000}}},async complete(){calls+=1;return {callId:calls,content:'{bad',finishReason:'stop'};}};
  const store={updateModelCall(){},recordPipelineFailure(input){failures.push(input);}};
  const selected=[1,2].map((n)=>({candidateId:`C00${n}`,title:`候选${n}`}));
  const cards=await brainstorm(gateway,store,selected,[],'b1','mock',()=>{},process.cwd());
  assert.deepEqual(cards,[]);assert.equal(failures.length,2);assert.deepEqual(failures.map((item)=>item.objectKey),['C001','C002']);assert.equal(calls,5);
});

test('脑暴合法 JSON 但无有效 items 时重试并记录失败',async()=>{
  const failures=[];let calls=0;const gateway={config:{defaultProvider:'mock',providers:{mock:{maxOutputTokens:8000}}},async complete(){calls+=1;return {callId:calls,content:'{"items":[]}',finishReason:'stop'};}};
  const store={updateModelCall(){},recordPipelineFailure(input){failures.push(input);}};
  const selected=[{title:'候选1'}];
  const cards=await brainstorm(gateway,store,selected,[],'b1','mock',()=>{},process.cwd());
  assert.deepEqual(cards,[]);assert.equal(failures.length,1);assert.equal(failures[0].errorCode,'empty_output');assert.equal(calls,2);
});
