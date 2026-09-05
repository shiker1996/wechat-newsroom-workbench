import { readStyles } from "./style-fixture.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVisualComplexity, normalizeVisualPlan, planArticleVisuals } from '../server/features/articles/llm/visual-planner.mjs';
import fs from 'node:fs';

test('visual plan keeps supported diagrams at existing headings', () => {
  const markdown = '# 标题\n\n## 流程\n\n正文\n\n## 数据\n';
  const plan = normalizeVisualPlan({ placements:[
    { type:'mermaid', afterHeading:'流程', code:'flowchart TB\nA[输入] --> B[输出]' },
    { type:'echarts', afterHeading:'数据', code:'{"xAxis":{"data":["A"]},"series":[{"type":"bar","data":[3]}]}' },
    { type:'mermaid', afterHeading:'不存在', code:'flowchart LR\nA-->B' },
  ] }, markdown, '{"verifiedValues":[3]}');
  assert.equal(plan.placements.length, 2);
  assert.match(plan.placements[0].fence, /^```mermaid/);
  assert.match(plan.placements[1].code, /"data": \[/);
});

test('visual plan accepts sequence/state Mermaid and rejects executable ECharts', () => {
  const markdown = '# 标题\n\n## 正文\n';
  const plan = normalizeVisualPlan({ placements:[
    { type:'mermaid', afterHeading:'正文', code:'sequenceDiagram\nparticipant A\nparticipant B\nA->>B: hi' },
    { type:'echarts', afterHeading:'正文', code:'{series: [{data: getData()}]}' },
  ] }, markdown);
  assert.equal(plan.placements.length, 1);
  assert.equal(plan.placements[0].type, 'mermaid');
});

test('visual plan can emphasize Mermaid focus nodes without fixing composition', () => {
  const plan = normalizeVisualPlan({ placements:[
    { type:'mermaid', afterHeading:'正文', focusNodes:['B','MISSING'], code:'flowchart LR\nA[输入] --> B[核心判断]\nB --> C[结果]' },
  ] }, '# 标题\n\n## 正文\n');
  assert.deepEqual(plan.placements[0].focusNodes, ['B']);
  assert.match(plan.placements[0].code, /classDef aiFocus/);
  assert.match(plan.placements[0].code, /class B aiFocus/);
});

test('mobile complexity flags oversized diagrams', () => {
  const code='flowchart TB\n'+Array.from({length:9},(_,index)=>`N${index}[节点${index}] --> N${index+1}[节点${index+1}]`).join('\n');
  const result=analyzeVisualComplexity('mermaid',code);
  assert.equal(result.mobileReady,false);
  assert.match(result.warning,/节点|复杂/);
});

test('visual plan tolerates numbered headings and common Mermaid graph syntax',()=>{
  const markdown='# 教程\n\n## 03 操作步骤\n\n正文';
  const plan=normalizeVisualPlan({summary:'建议在操作步骤章节添加流程图',placements:[
    {type:'mermaid',afterHeading:'操作步骤',code:'graph TD\nA[配置] --> B[发布]'},
  ]},markdown);
  assert.equal(plan.placements.length,1);
  assert.equal(plan.placements[0].afterHeading,'03 操作步骤');
  assert.match(plan.placements[0].code,/^flowchart TB/);
});

test('visual plan does not retain a positive summary when every suggestion is rejected',()=>{
  const plan=normalizeVisualPlan({summary:'建议添加流程图',placements:[
    {type:'mermaid',afterHeading:'不存在',code:'flowchart TB\nA-->B'},
  ]},'# 标题');
  assert.equal(plan.placements.length,0);
  assert.match(plan.summary,/暂时无法生成/);
  assert.equal(plan.rejections.length,1);
});

test('visual results use a full-width second row instead of squeezing the AI rewrite panel',()=>{
  const styles=readStyles();
  assert.match(styles,/\.editor-assist-grid\{display:block/);
  assert.match(styles,/\.ai-writing-bar\{[^}]*grid-template-columns:190px minmax\(0,1fr\)/);
  assert.doesNotMatch(styles,/:has\(\.visual-planner\.has-results\)/);
});

test('oversized Mermaid automatically retries as mobile-readable split diagrams',async()=>{
  const replies=[
    {content:JSON.stringify({summary:'完整流程',placements:[{type:'mermaid',afterHeading:'流程',purpose:'完整流程',code:`flowchart TB\n${Array.from({length:9},(_,i)=>`N${i}[${i}] --> N${i+1}[${i+1}]`).join('\n')}`}]})},
    {content:JSON.stringify({summary:'拆成两张图',placements:[
      {type:'mermaid',afterHeading:'流程',purpose:'前半段',code:'flowchart TB\nA[1] --> B[2]\nB --> C[3]'},
      {type:'mermaid',afterHeading:'流程',purpose:'后半段',code:'flowchart TB\nC[3] --> D[4]\nD --> E[5]'},
    ]})},
  ];
  const calls=[];
  const gateway={complete:async(input)=>{calls.push(input);return replies.shift();}};
  const plan=await planArticleVisuals({gateway,provider:'test',batchId:'b',candidateId:1,markdown:'# 标题\n\n## 流程\n',factBase:'facts'});
  assert.equal(calls.length,2);
  assert.equal(calls[1].purpose,'article-visual-plan-mobile-retry');
  assert.equal(plan.placements.length,2);
  assert.equal(plan.placements.every((item)=>item.complexity.mobileReady),true);
});
