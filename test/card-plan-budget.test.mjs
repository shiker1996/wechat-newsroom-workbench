import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetCardPlan, CARD_PLAN_BLOCK_BUDGET, CARD_PLAN_PAGE_ITEM_BUDGET } from '../server/features/social-cards/application/social-card-pipeline.mjs';

const textBlock=(title)=>({type:'text',title,content:`${title}的正文说明`});

test('封面超出块数上限时优先从尾部删除辅助块',()=>{
  const plan=[{kind:'cover',title:'封面',content_blocks:[textBlock('要点'),{type:'note',title:'提示',content:'补充'},{type:'highlight',title:'强调',content:'补充'}]}];
  const {pages,trims}=budgetCardPlan(plan);
  assert.equal(pages[0].content_blocks.length,CARD_PLAN_BLOCK_BUDGET.cover);
  assert.deepEqual(pages[0].content_blocks.map((block)=>block.type),['text','note']);
  assert.ok(trims.some((item)=>item.includes('P1')&&item.includes('强调')));
});

test('内容页超出块数上限时从尾部删除普通块且始终保留至少一个',()=>{
  const plan=[{kind:'capability',title:'能力',content_blocks:[textBlock('一'),textBlock('二'),textBlock('三'),textBlock('四'),textBlock('五')]}];
  const {pages,trims}=budgetCardPlan(plan);
  assert.equal(pages[0].content_blocks.length,CARD_PLAN_BLOCK_BUDGET.content);
  assert.deepEqual(pages[0].content_blocks.map((block)=>block.title),['一','二','三']);
  assert.equal(trims.length,1);
  const single={kind:'ending',content_blocks:[textBlock('唯一')]};
  assert.equal(budgetCardPlan([single]).pages[0].content_blocks.length,1);
});

test('单页列表条目合计超出预算时从尾部列表块截断且每块至少保留两条',()=>{
  const plan=[{kind:'capability',title:'能力',content_blocks:[
    {type:'list',title:'清单A',items:['a1','a2','a3','a4','a5']},
    {type:'list',title:'清单B',content:'b1\nb2\nb3\nb4\nb5\nb6'},
  ]}];
  const {pages,trims}=budgetCardPlan(plan);
  const [first,second]=pages[0].content_blocks;
  assert.equal(first.items.length,5,'前块不被截断');
  assert.equal(String(second.content).split('\n').length,CARD_PLAN_PAGE_ITEM_BUDGET-5);
  assert.ok(trims.some((item)=>item.includes('清单B')));
  // 极端情况：单块 12 条，截断后仍不少于 2 条
  const extreme=[{kind:'capability',content_blocks:[{type:'list',title:'长清单',items:Array.from({length:12},(_,index)=>`项${index+1}`)}]}];
  assert.equal(budgetCardPlan(extreme).pages[0].content_blocks[0].items.length,CARD_PLAN_PAGE_ITEM_BUDGET);
});

test('符合预算的故事板原样通过且不产生裁剪记录',()=>{
  const plan=[
    {kind:'cover',title:'封面',content_blocks:[textBlock('导语')]},
    {kind:'capability',title:'能力',content_blocks:[textBlock('一'),{type:'list',title:'要点',items:['a','b','c']}]},
    {kind:'ending',title:'结束',content_blocks:[textBlock('收束')]},
  ];
  const {pages,trims}=budgetCardPlan(plan);
  assert.deepEqual(pages,plan);
  assert.deepEqual(trims,[]);
});
