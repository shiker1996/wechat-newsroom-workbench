import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { auditCapabilityConsumers, buildToolCallBaseline } from '../lib/tools/dependency-baseline.mjs';

const root=path.resolve(import.meta.dirname,'..');
test('生产代码中的工具调用必须登记功能消费者和能力依赖',()=>{const result=auditCapabilityConsumers(root);assert.deepEqual(result.issues,[]);assert.ok(result.calls.length>0);});
test('工具调用链基线与仓库 Manifest 和调用标记保持同步',()=>{const expected=buildToolCallBaseline(root),saved=JSON.parse(fs.readFileSync(path.join(root,'docs','tool-call-chain-baseline.json'),'utf8'));assert.ok(expected.tools.length>0);assert.ok(expected.skills.length>0);assert.deepEqual(saved,expected);});
