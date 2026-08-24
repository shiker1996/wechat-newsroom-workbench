import path from 'node:path';
import { auditPluginBoundaries } from '../../server/platform/plugins/boundary-audit.mjs';

const root=path.resolve(import.meta.dirname,'..','..'),result=auditPluginBoundaries(root);
if(process.argv.includes('--json'))console.log(JSON.stringify(result,null,2));
else{
  console.log(`插件边界：${result.actual.length} 项现有违规，${result.newViolations.length} 项新增，${result.resolved.length} 项已解决`);
  for(const item of result.newViolations)console.error(`新增 ${item.id} (${item.evidence})`);
  for(const item of result.invalidBaseline)console.error(`基线缺少治理字段 ${item.id}`);
  for(const item of result.resolved)console.log(`可从基线移除 ${item.id}`);
}
if(!result.pass)process.exitCode=1;
