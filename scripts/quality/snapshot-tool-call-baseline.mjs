import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildToolCallBaseline } from '../../server/platform/tools/dependency-baseline.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..'),baseline=buildToolCallBaseline(root);
if(!baseline.audit.pass)throw new Error(`工具调用链审计失败：\n${baseline.audit.issues.join('\n')}`);
const output=path.join(root,'test','fixtures','tool-call-chain-baseline.json');fs.writeFileSync(output,`${JSON.stringify(baseline,null,2)}\n`,'utf8');
console.log(`已写入 ${path.relative(root,output)}：${baseline.tools.length} 个工具、${baseline.skills.length} 个技能、${baseline.features.length} 个功能消费者`);
