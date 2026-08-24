import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizePlanningResult, selectWriterSkill } from '../server/features/articles/application/article-pipeline-contract.mjs';
import { stageSkillPackageRestore, stageWritingSkillRestore } from '../server/platform/http/routes/system-restore-transactions.mjs';
import { socialTokenLimits, targetLabel } from '../public/src/views/theme-manager-fields.js';

test('R5.4 文章流水线契约可脱离执行器独立使用',()=>{
  assert.deepEqual(normalizePlanningResult({coreKeywords:'Agent；ToolCall'}).coreKeywords,['Agent','ToolCall']);
  assert.equal(selectWriterSkill({hotspot_title:'Agent 架构',angle:'拆解推理成本和架构'}).skill,'wechat-mp-tech-deep');
});

test('R5.4 写作技能恢复事务支持交换和回滚',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'writing-restore-'));
  fs.mkdirSync(path.join(root,'writing-skills'),{recursive:true});
  fs.writeFileSync(path.join(root,'writing-skills','old.json'),'{}');
  const transaction=stageWritingSkillRestore(root,[['writing-skills/new.json',Buffer.from('{"ok":true}')]]);
  transaction.swap();
  assert.equal(fs.existsSync(path.join(root,'writing-skills','new.json')),true);
  transaction.rollback();
  assert.equal(fs.existsSync(path.join(root,'writing-skills','old.json')),true);
  fs.rmSync(root,{recursive:true,force:true});
});

test('R5.4 包恢复事务支持提交并保留新目录',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'package-restore-'));
  fs.mkdirSync(path.join(root,'data','installed-skills'),{recursive:true});
  fs.writeFileSync(path.join(root,'data','installed-skills','old.txt'),'old');
  const transaction=stageSkillPackageRestore(root,[['data/installed-skills/new.txt',Buffer.from('new')]]);
  transaction.swap();
  transaction.commit();
  assert.equal(fs.readFileSync(path.join(root,'data','installed-skills','new.txt'),'utf8'),'new');
  fs.rmSync(root,{recursive:true,force:true});
});

test('R5.4 主题字段元数据可脱离 DOM 独立加载',()=>{
  assert.equal(targetLabel('social'),'图文');
  assert.deepEqual(socialTokenLimits.bodyPx,[9,13]);
});
