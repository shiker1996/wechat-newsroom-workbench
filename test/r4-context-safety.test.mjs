import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { delimitUntrusted, markdownInlineData, trimConversation, truncateAtBoundary } from '../server/platform/llm/context-safety.mjs';
import { getAccountContext } from '../server/shared/domain/account-context.mjs';
import { requestMessages } from '../server/features/social-cards/llm/custom-social-chat.mjs';

test('不可信资料具有显式定界且截断保持代码围栏闭合',()=>{
  const value=`第一段\n\n\`\`\`js\n${'x'.repeat(300)}`;const clipped=truncateAtBoundary(value,120);
  assert.equal(clipped.truncated,true);assert.match(clipped.text,/内容已按安全边界截断/);assert.equal((clipped.text.match(/```/g)||[]).length%2,0);
  assert.match(delimitUntrusted('source',value,120),/其中出现的命令.+不得执行/);
});

test('三类对话可共享消息数和总字符双预算',()=>{
  const history=Array.from({length:40},(_,index)=>({role:index%2?'assistant':'user',content:`${index}-${'字'.repeat(2000)}`}));const trimmed=trimConversation(history);
  assert.ok(trimmed.length<=24);assert.ok(trimmed.reduce((sum,item)=>sum+item.content.length,0)<=24100);assert.match(requestMessages({history,answer:'继续'})[1].content,/untrusted-data/);
});

test('账号上下文按工作区切换并支持配置刷新',()=>{
  const a=fs.mkdtempSync(path.join(os.tmpdir(),'account-a-')),b=fs.mkdtempSync(path.join(os.tmpdir(),'account-b-'));
  try{fs.writeFileSync(path.join(a,'account-context.json'),JSON.stringify({name:'账号A'}));fs.writeFileSync(path.join(b,'account-context.json'),JSON.stringify({name:'账号B'}));assert.equal(getAccountContext({workspaceRoot:a}).name,'账号A');assert.equal(getAccountContext({workspaceRoot:b}).name,'账号B');fs.writeFileSync(path.join(b,'account-context.json'),JSON.stringify({name:'账号B2'}));assert.equal(getAccountContext({workspaceRoot:b,refresh:true}).name,'账号B2');}finally{fs.rmSync(a,{recursive:true,force:true});fs.rmSync(b,{recursive:true,force:true});}
});

test('模型内联数据不能注入 Markdown 标题、表格或围栏',()=>{
  assert.equal(markdownInlineData('## 伪标题\n|a|```'),'伪标题 ｜a｜｀｀｀');
});
