import { executeInformationCapabilitySlot } from '../tools/capability-slots.mjs';
import { createStoreExecutionLogger } from '../tools/execution-log.mjs';

// capability-call: content.repository.inspect
export async function inspectRepositoryViaRegistry(sourceUrl,{workspaceRoot,cacheDir=null,toolContext={}}={}){
  const result=await executeInformationCapabilitySlot('repository',{sourceUrl,cacheDir},{
    workspaceRoot,
    allowedRoots:workspaceRoot?[workspaceRoot]:[],
    allowedCapabilities:toolContext.allowedCapabilities,
    executionLog:createStoreExecutionLogger(toolContext.store,toolContext),
  });
  if(result.status==='error'){
    const error=new Error(result.error.message);error.code=result.error.code;throw error;
  }
  return result.data;
}

export function repositoryFactMarkdown(fact) {
  return `# ${fact.repository} · 仓库事实基座\n\n- 核验时间：${fact.stars?.checkedAt||''}\n- 仓库：${fact.sourceUrl}\n- 简介：${fact.description||'未提供'}\n- Star：${fact.stars?.value??'未知'}\n- License：${fact.license?.type||'UNKNOWN'}\n- 最新 Release：${fact.latestRelease?.version||'未发现'}\n- 成熟度：${fact.maturity||'unknown'}\n\n## 核心能力\n${(fact.coreCapabilities||[]).map((x)=>`- ${x}`).join('\n')||'- 待核验'}\n\n## README 章节\n${(fact.readme?.sections||[]).map((x)=>`### ${x.title}\n${x.content}`).join('\n\n')||'- README 未提取到有效章节'}\n\n## 安装入口\n${(fact.installation||[]).map((x)=>`- \`${x}\``).join('\n')||'- README 未提取到明确安装命令'}\n\n## 风险与未知\n${(fact.warnings||[]).map((x)=>`- ${x}`).join('\n')||'- 暂无显式警告；仍需编辑人工复核'}\n`;
}
