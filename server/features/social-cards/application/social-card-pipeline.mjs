import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadSkillBundle, selectSkillPromptReferences } from '../../../platform/llm/skill-runtime.mjs';
import { evaluateCardGate, evaluateClassifiedCardGate, evaluateEventCardGate, evaluateCustomCardGate } from '../domain/social-card-gate.mjs';
import { customFactMarkdown } from './custom-fact-service.mjs';
import { candidateSocialCardDir } from '../../../platform/core/workspace-paths.mjs';
import { enrichEventAnalysis, eventGroupsForCandidate, resolveEventAnalysis } from '../../research/index.mjs';
import { bindGenerationSnapshot, bindPipelineHarnessGateway, prepareSkillRun } from '../../../platform/skills/pipeline-runtime.mjs';
import { configuredRepairAttempts, evaluateConfiguredGates } from '../../../platform/skills/configuration.mjs';
import { compileSocialTheme, socialThemeDefinition } from '../../../shared/themes/social-theme-compiler.mjs';
import { resolveWorkspaceTheme } from '../../../platform/application/themes/user-theme-service.mjs';
import { buildSocialThemeRoutingContext, resolveAutoTheme } from '../../../platform/application/themes/auto-theme-router.mjs';
import { budgetCardPlan, layoutAuditFailureMessage, normalizeCoverTitleLines, underfilledDensityTier } from '../../../shared/rendering/social-card-plan.mjs';
import { compileTemplateAwareCardPlan, estimateSocialCardPageLoad, normalizeEventStoryboardPages, normalizeOpenSourceTechnologyStoryboardPages, normalizeOpenSourceTrendStoryboardPages, normalizeRepositoryStoryboardPages, rebalanceContinuationPages, scaleSocialCardCapacityProfile } from '../../../shared/rendering/social-card-reflow.mjs';
import { applySocialCardRestructureOperations, buildDeterministicSocialCardRestructureOperations, cardPlanHash, socialCardRepairStateSignature, structuralLayoutPages } from '../../../shared/rendering/social-card-repair-policy.mjs';
import { applySocialCardContentPlannerOperations, applySocialCardContentPlannerOperationsPartial, buildSocialCardContentPlannerPrompt, buildSocialCardPlannerComponentPool, partitionSocialCardContentPlannerOperationsBySchema, validateSocialCardContentPlannerSchema } from './social-card-content-planner.mjs';
import { buildSocialCardFactIndex } from '../../../shared/rendering/social-card-fact-index.mjs';
import { SOCIAL_CARD_LAYOUTS } from '../../../shared/rendering/social-card-layout.mjs';
import { describeCardLayouts, normalizeCardComposition } from '../../../shared/rendering/social-card-composition.mjs';
import { cardPlanRepairStructureIssues, sanitizeCardPlan } from '../../../shared/rendering/storyboard-content.mjs';
import { renderStoryboardSections } from '../../../shared/rendering/storyboard-page-renderer.mjs';
import { renderStoryboardDocument } from '../../../shared/rendering/storyboard-document-renderer.mjs';
import { createSocialCardStoryboardThemeSnapshot, getSocialCardTemplateCapabilities, resolveSocialCardTemplateContext, validateSocialCardTemplateCompatibility } from '../../../shared/rendering/social-card-template-resolver.mjs';
import { buildSocialCardPlanBaseline } from '../../../shared/rendering/social-card-plan-baseline.mjs';
import { buildSocialCardContentAtomSnapshot, buildSocialCardSupplementUsageIndex, compareSocialCardContentAtomConservation } from '../../../shared/rendering/social-card-content-atoms.mjs';
import { auditSocialCardJointPacking, buildSocialCardComponentPackingOperations, buildSocialCardContentComponents, buildSocialCardContinuationSupplementOperations, sanitizeSocialCardPlanFactBindings, selectBestSocialCardJointPackingOperations, validateSocialCardContentComponents } from '../../../shared/rendering/social-card-content-components.mjs';
import { assessSocialCardDensityTargets } from '../../../shared/rendering/social-card-density-targets.mjs';
import { getSocialCardPlanRolloutProfile } from '../../../shared/rendering/social-card-plan-rollout.mjs';
import { socialCardPageBudget, socialCardPageBudgetMessage } from '../../../shared/rendering/social-card-page-budget.mjs';
import { acceptSoftDensityOnlyLayoutReport, adaptiveContentPageIndexes, buildSocialCardPlannerFactScope, buildSocialCardPlannerPageScope, layoutAuditPageSummary, softDensityPageIndexes, templateAuditFailurePayload, validateSocialCardDelivery } from '../../../shared/rendering/social-card-pipeline-contracts.mjs';
import { socialStoryboardClassForContentClass, socialStoryboardSkillForContentClass } from '../domain/social-routing.mjs';
import { generateSocialCardCopy } from './social-card-copy.mjs';
// 交付门禁继续报告“配套文案话题标签不足”，实现已下沉到渲染契约模块。
import { NEON_V1_CSS, renderNeonStoryboardSections } from '../../../shared/rendering/templates/social/neon-v1.mjs';
import { BRUTALIST_V1_CSS, renderBrutalistStoryboardSections } from '../../../shared/rendering/templates/social/brutalist-v1.mjs';
import { EDITORIAL_V1_CSS, renderEditorialStoryboardSections } from '../../../shared/rendering/templates/social/editorial-v1.mjs';
import { CLEAN_V1_CSS, renderCleanStoryboardSections } from '../../../shared/rendering/templates/social/clean-v1.mjs';
import { summarizeSocialTemplateRun, summarizeSocialCardPageRoles } from '../../../shared/rendering/social-card-template-metrics.mjs';
import { cleanCardPlanJson, renderStoryboardHtml } from '../rendering/presentation.mjs';

export { CARD_PLAN_BLOCK_BUDGET, CARD_PLAN_PAGE_ITEM_BUDGET, budgetCardPlan, cardPageDensity, deterministicCoverTitleLines, layoutAuditFailureMessage, normalizeCoverTitleLines, underfilledDensityTier, underfilledPageIndexes } from '../../../shared/rendering/social-card-plan.mjs';
export { resolveCardLayout, resolveCardLayoutDecision } from '../../../shared/rendering/social-card-layout.mjs';
export { SOCIAL_CARD_LAYOUTS };
export { inferCardPageRole, SOCIAL_CARD_COMPOSITION_MODES, SOCIAL_CARD_PAGE_ROLES, stableCardCompositionSeed } from '../../../shared/rendering/social-card-role.mjs';
export { describeCardLayouts, normalizeCardComposition, resolveCardCompositionDecision } from '../../../shared/rendering/social-card-composition.mjs';
export { cardPlanRepairStructureIssues } from '../../../shared/rendering/storyboard-content.mjs';
export { compileTemplateAwareCardPlan, estimateSocialCardPageLoad, normalizeEventStoryboardPages, normalizeOpenSourceTechnologyStoryboardPages, normalizeOpenSourceTrendStoryboardPages, normalizeRepositoryStoryboardPages, scaleSocialCardCapacityProfile } from '../../../shared/rendering/social-card-reflow.mjs';
export { applySocialCardRestructureOperations, buildDeterministicSocialCardRestructureOperations, buildDeterministicSocialCardPageCapOperations, cardPlanHash, classifySocialCardLayoutIssue, socialCardRepairStateSignature, structuralLayoutPages, validateSocialCardRestructureOperations } from '../../../shared/rendering/social-card-repair-policy.mjs';
export { socialCardPageBudget, socialCardPageBudgetMessage, socialCardPageBudgetStatus } from '../../../shared/rendering/social-card-page-budget.mjs';
export { applySocialCardContentPlannerOperations, applySocialCardContentPlannerOperationsPartial, buildSocialCardContentPlannerPrompt, buildSocialCardPlannerComponentPool, partitionSocialCardContentPlannerOperationsBySchema, validateSocialCardContentPlannerOperations, validateSocialCardContentPlannerSchema } from './social-card-content-planner.mjs';
export { acceptSoftDensityOnlyLayoutReport, adaptiveContentPageIndexes, softDensityPageIndexes } from '../../../shared/rendering/social-card-pipeline-contracts.mjs';
export { cleanCardPlanJson, renderStoryboardHtml };

const execFileAsync = promisify(execFile);


export const SOCIAL_CARD_STAGE_CONTRACT = Object.freeze([
  { id:'facts', skill:'fixed-program' },
  { id:'planning', skill:'storyboard-selection' },
  { id:'generation', skill:'xiaohongshu-article-generator' },
  { id:'layout-audit', skill:'xiaohongshu-article-generator' },
  { id:'screenshots', skill:'html-pages-to-images' },
  { id:'delivery-gate', skill:'fixed-program' },
]);

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive:true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, String(content).trimEnd() + '\n', 'utf8');
  fs.renameSync(temp, filePath);
  return fs.statSync(filePath);
}

function addArtifact(store, batchId, candidateId, kind, filePath) {
  const stat = fs.statSync(filePath);
  store.upsertArtifact({ batchId, candidateId, track:'social_cards', kind, name:path.basename(filePath), path:filePath, size:stat.size, modifiedAt:stat.mtime.toISOString() });
}

export async function runAudit(script, htmlPath, reportPath, cwd, { page = null } = {}) {
  if(fs.existsSync(reportPath))fs.unlinkSync(reportPath);
  try {
    const args = [script, htmlPath, '--json', reportPath];
    if(Number.isInteger(page) && page > 0) args.push('--page', String(page));
    await execFileAsync(process.execPath, args, { cwd, windowsHide:true, timeout:120000, maxBuffer:2_000_000 });
  } catch (error) {
    // 审计脚本对"布局未通过"以退出码 1 返回、但会先写出报告文件：
    // 报告已生成时不算执行失败，交给修复循环处理；只有连报告都没产出才是真失败
    if (!fs.existsSync(reportPath)) throw new Error(String(error.stderr || error.stdout || error.message).trim());
  }
  if(!fs.existsSync(reportPath))throw new Error('布局审计未生成本轮报告');
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

function socialCardUsageAudit(cardPlan = []) {
  const usage = buildSocialCardSupplementUsageIndex(cardPlan);
  const pageSlots = Object.fromEntries([...usage.pageUsage.entries()].map(([page, value]) => [String(page), [...value.slots]]));
  return {
    usedFactIds: [...new Set([...usage.coreFactIds, ...usage.supplementFactIds])],
    supplementFactIds: [...usage.supplementFactIds],
    usedSlots: pageSlots,
  };
}

function buildDynamicFillAudit({ beforePlan = [], afterPlan = [], report = null, targetPages = [], capacityProfile = null, acceptedOperations = [], rejectedOperations = [], fallbackCandidateCount = 0, changed = false, error = '' } = {}) {
  const reportPages = new Map((Array.isArray(report?.pages) ? report.pages : []).map((page) => [Number(page?.page), page]));
  const beforeUsage = socialCardUsageAudit(beforePlan);
  const afterUsage = socialCardUsageAudit(afterPlan);
  const operationPage = (operation) => Number(operation?.page || operation?.from_page || operation?.to_page) || null;
  const accepted = Array.isArray(acceptedOperations) ? acceptedOperations : [];
  const rejected = Array.isArray(rejectedOperations) ? rejectedOperations : [];
  const pages = (Array.isArray(targetPages) ? targetPages : []).map((target) => {
    const pageNumber = Number(target?.page);
    const beforePage = beforePlan[pageNumber - 1] || {};
    const afterPage = afterPlan[pageNumber - 1] || beforePage;
    const role = String(beforePage?.role || target?.role || '');
    const capacity = capacityProfile?.roles?.[role] || capacityProfile || {};
    const estimate = estimateSocialCardPageLoad(afterPage, capacity);
    const estimatedUtilization = Number(estimate?.bodyHeightPx) > 0
      ? Number(estimate?.estimatedHeightPx || 0) / Number(estimate.bodyHeightPx)
      : null;
    const measuredUtilization = Number(reportPages.get(pageNumber)?.utilization);
    const utilizationBefore = Number.isFinite(measuredUtilization) ? measuredUtilization / 100 : null;
    const utilizationAfter = Number.isFinite(estimatedUtilization) ? estimatedUtilization : utilizationBefore;
    const targetUtilization = Number(target?.targetUtilization);
    const targetRatio = Number.isFinite(targetUtilization) ? targetUtilization / 100 : null;
    const acceptedCount = accepted.filter((operation) => operationPage(operation) === pageNumber).length;
    const pageRejected = rejected.filter((item) => operationPage(item?.operation || item) === pageNumber);
    const remainingCapacity = target?.remainingBlockCapacity;
    let stopReason = '';
    if (!changed && error) stopReason = 'planner_error';
    else if (targetRatio != null && utilizationAfter != null && utilizationAfter >= targetRatio) stopReason = 'target_utilization_reached';
    else if (!changed && Number.isFinite(Number(remainingCapacity)) && Number(remainingCapacity) <= 0) stopReason = 'template_capacity_reached';
    else if (!changed && Number(fallbackCandidateCount) <= 0 && !acceptedCount) stopReason = 'no_safe_candidate';
    else if (!changed && pageRejected.length && !acceptedCount) stopReason = 'all_candidates_rejected';
    else if (changed) stopReason = 'continue_next_round';
    else stopReason = 'no_progress';
    return {
      page: pageNumber,
      role,
      stopReason,
      acceptedOperations: acceptedCount,
      rejectedOperations: pageRejected.map((item) => ({ operation: item?.operation || item, reason: item?.issues || item?.reason || 'rejected' })),
      utilizationBefore,
      utilizationAfter,
      estimatedUtilization: utilizationAfter,
      observedUtilization: Number.isFinite(measuredUtilization) ? measuredUtilization / 100 : null,
      targetUtilization: targetRatio,
      usedFactIdsBefore: [...beforeUsage.usedFactIds],
      usedFactIdsAfter: [...afterUsage.usedFactIds],
      usedSlotsBefore: beforeUsage.usedSlots[String(pageNumber)] || [],
      usedSlotsAfter: afterUsage.usedSlots[String(pageNumber)] || [],
    };
  });
  return {
    schemaVersion: 1,
    changed: Boolean(changed),
    pages,
    stopReason: pages.every((page) => page.stopReason === 'target_utilization_reached')
      ? 'target_utilization_reached'
      : pages.every((page) => page.stopReason === 'template_capacity_reached')
        ? 'template_capacity_reached'
        : pages.some((page) => page.stopReason === 'continue_next_round')
          ? 'continue_next_round'
          : pages.length ? pages[0].stopReason : (error ? 'planner_error' : 'no_target_page'),
  };
}

export function reconcileSocialCardDynamicFillAuditWithFinalReport(audit, report) {
  if (!audit || typeof audit !== 'object') return audit;
  const reportPages = new Map((Array.isArray(report?.pages) ? report.pages : []).map((page) => [Number(page?.page), page]));
  const pages = (Array.isArray(audit.pages) ? audit.pages : []).map((page) => {
    const observed = Number(reportPages.get(Number(page?.page))?.utilization);
    if (!Number.isFinite(observed)) return page;
    const observedUtilization = observed / 100;
    const target = Number(page?.targetUtilization);
    const targetReached = Number.isFinite(target) && observedUtilization >= target;
    const accepted = Number(page?.acceptedOperations) || 0;
    const rejected = Array.isArray(page?.rejectedOperations) ? page.rejectedOperations.length : 0;
    const stopReason = targetReached
      ? 'target_utilization_reached'
      : accepted > 0
        ? 'continue_next_round'
        : rejected > 0
          ? 'all_candidates_rejected'
          : 'no_safe_candidate';
    return {
      ...page,
      estimatedUtilization: Number.isFinite(Number(page?.estimatedUtilization)) ? Number(page.estimatedUtilization) : Number(page?.utilizationAfter),
      observedUtilization,
      utilizationAfter: observedUtilization,
      stopReason,
      stopReasonSource: 'final-layout-report',
    };
  });
  const stopReason = pages.length && pages.every((page) => page.stopReason === 'target_utilization_reached')
    ? 'target_utilization_reached'
    : pages.some((page) => page.stopReason === 'continue_next_round')
      ? 'continue_next_round'
      : pages.some((page) => page.stopReason === 'all_candidates_rejected')
        ? 'all_candidates_rejected'
        : pages.length && pages.every((page) => page.stopReason === 'no_safe_candidate')
          ? 'no_safe_candidate'
          : audit.stopReason || 'no_target_page';
  return { ...audit, pages, stopReason, observedFromFinalLayout: true };
}

export function reconcileSocialCardDynamicFillAuditsWithFinalReport(history, report) {
  for (const round of Array.isArray(history) ? history : []) {
    if (round?.dynamicFill) round.dynamicFill = reconcileSocialCardDynamicFillAuditWithFinalReport(round.dynamicFill, report);
  }
}

function eventFactMarkdown(analysis) {
  const facts=analysis.factBase||{};
  const claimText=(item)=>typeof item==='string'?item:String(item?.claim??item?.fact??item?.event??item?.value??item?.angle??item?.adds??item?.content??'').trim();
  const claimRefs=(item)=>[...(item?.source_ids||item?.sourceIds||[])].map(String).filter(Boolean);
  const renderClaims=(items, suffix='')=>(Array.isArray(items)?items:[]).map((item)=>{
    const refs=claimRefs(item); const status=item?.status&&item.status!=='supported'?`；${item.status}`:'';
    return `- ${claimText(item)}${suffix||status}（来源 ${refs.join('、')||'待补'}）`;
  }).filter((line)=>!/- \(来源/.test(line));
  const renderTimeline=(items)=>(Array.isArray(items)?items:[]).map((item)=>`- ${item?.time||'时间待核'}：${claimText(item)}（来源 ${claimRefs(item).join('、')||'待补'}）`);
  const lines=['# 事件图文事实清单','',analysis.eventSummary||'','',
    '## 背景','',...renderClaims(facts.context||facts.backgrounds),
    '','## 已确认事实','',...renderClaims(facts.confirmedFacts),
    '','## 来源增量','',...(Array.isArray(facts.sourceIncrements)?facts.sourceIncrements:[]).map((item)=>`- ${item.source||'来源'}：${item.adds||claimText(item)}（来源 ${claimRefs(item).join('、')||'待补'}）`),
    '','## 技术机制与影响','',...renderClaims([...(facts.mechanisms||[]),...(facts.architecture||[]),...(facts.impacts||[]) ]),
    '','## 尚未核实的主张','',...renderClaims(facts.claims||facts.openQuestions, '；待核'),
    '','## 时间线','',...renderTimeline(facts.timeline),
    '','## 风险、分歧与后续观察','',...renderClaims([...(facts.disagreements||[]),...(facts.risks||[]),...(facts.followUpSignals||[]) ]),
    '','## 来源风险与缺口','',...(analysis.sourceAudit?.issues||[]).map((item)=>`- ${item}`),...(analysis.sourceAudit?.neededMaterials||[]).map((item)=>`- 待补：${item}`)];
  return lines.join('\n').trim()+'\n';
}

export async function runSocialCardPipeline({ gateway, store, batchId, candidateId, provider, workspaceRoot, snapshotId=null, rootRunId=null, workflowRunId=null, onProgress=()=>{} }) {
  const candidate = store.getCandidate(candidateId);
  if (!candidate || candidate.batch_id !== batchId) throw new Error('候选不存在或不属于当前批次');
  const outputMode=candidate.tracks?.find((item)=>item.track==='social_cards')?.output_mode||'';
  const contentType=candidate.content_class==='github_project'||outputMode.includes('tool-cards')?'repository':outputMode.includes('custom-cards')?'custom':'event';
  const storyboardClass=contentType==='event'?socialStoryboardClassForContentClass(candidate.content_class):contentType;
  const channelMode=outputMode.startsWith('xiaohongshu')?'xiaohongshu':'wechat';
  const facts = store.getRepositoryFactSheet(candidateId);
  let eventAnalysisRecord=contentType==='event'?resolveEventAnalysis({store,workspaceRoot,candidate}):null;
  const editorial = store.getCardEditorial(candidateId);
  let themeRouting = null;
  let visualStyle = editorial.visual_style || 'auto';
  if (visualStyle === 'auto') {
    themeRouting = await resolveAutoTheme({
      gateway, provider, store, batchId, candidateId, target: 'social',
      context: buildSocialThemeRoutingContext({ candidate, contentType, channelMode, facts }),
      log: onProgress,
    });
    visualStyle = themeRouting?.themeId || 'ice-blue';
  }
  const themeDefinition=resolveWorkspaceTheme(store,visualStyle,'social')||socialThemeDefinition(visualStyle,{fallback:false});
  if(!themeDefinition)throw new Error(`未知图文视觉主题：${editorial.visual_style}`);
  const templateCapabilities=getSocialCardTemplateCapabilities({themeDefinition,channelMode,contentType});
  const rolloutProfile=getSocialCardPlanRolloutProfile(templateCapabilities.templatePack.id);
  store.recordThemeUsage?.({themeId:themeDefinition.id,version:themeDefinition.version,target:'social',source:themeDefinition.source,batchId,candidateId});
  const batch = store.getBatch(batchId);
  const workdir = candidateSocialCardDir(workspaceRoot, batch, candidate);
  fs.mkdirSync(workdir, { recursive:true });
  const themeSnapshotPath=path.join(workdir,'social-theme-snapshot.json');
  const generator = loadSkillBundle({ workspaceRoot, skillName:'xiaohongshu-article-generator' });
  const screenshotSkill = loadSkillBundle({ workspaceRoot, skillName:'html-pages-to-images' });
  const eventAnalysisSkill = contentType==='event' ? loadSkillBundle({ workspaceRoot, skillName:'event-research-analyzer' }) : null;
  if (generator.fallback) throw new Error('项目图文生成技能缺失');
  if (screenshotSkill.fallback) throw new Error('项目 HTML 截图技能缺失');
  if (eventAnalysisSkill?.fallback) throw new Error('事件深度分析技能缺失');
  const skillRuntime=await prepareSkillRun({gateway,store,batchId,candidateId,purpose:`social-cards-${contentType}`,bundles:[generator,screenshotSkill,...(eventAnalysisSkill?[eventAnalysisSkill]:[])],provider,snapshotId});
  gateway=bindGenerationSnapshot(gateway,skillRuntime.snapshotId);
  gateway=bindPipelineHarnessGateway(gateway,{store,batchId,candidateId,provider,generationSnapshotId:skillRuntime.snapshotId,
    rootRunId:rootRunId||`batch:${batchId}`,workflowRunId:workflowRunId||`social-card:${batchId}:${candidateId??'batch'}`,entryPoint:'social-card-pipeline'});
  provider=skillRuntime.provider;
  const maxLayoutAttempts=configuredRepairAttempts(skillRuntime.config,4)+1;
  if(contentType==='event'&&eventAnalysisRecord?.analysis){
    const groups=eventGroupsForCandidate({store,workspaceRoot,candidate,contentLimit:9000});
    eventAnalysisRecord=await enrichEventAnalysis({gateway,store,batchId,candidateId,provider,workspaceRoot,baseRecord:eventAnalysisRecord,groups,skillBundle:eventAnalysisSkill,cachePath:path.join(workdir,'event-analysis.json'),onProgress});
  }
  const gate = contentType==='event'?(storyboardClass==='technology'||storyboardClass==='trend'?evaluateClassifiedCardGate(candidate,storyboardClass,eventAnalysisRecord,editorial):evaluateEventCardGate(candidate,eventAnalysisRecord,editorial)):contentType==='custom'?evaluateCustomCardGate(candidate,facts,editorial):evaluateCardGate(candidate, facts, editorial);
  if (!gate.ready) throw new Error(`卡片故事板尚未就绪：${gate.issues.join('；')}`);
  store.saveCardEditorial?.(candidateId,{...editorial,storyboard_theme_snapshot_json:JSON.stringify(createSocialCardStoryboardThemeSnapshot({themeDefinition,channelMode,contentType}))});
  writeFile(themeSnapshotPath,JSON.stringify({schemaVersion:2,id:themeDefinition.id,label:themeDefinition.label,version:themeDefinition.version,source:themeDefinition.source,hash:themeDefinition.hash,autoRouting:themeRouting,templatePack:templateCapabilities.templatePack,templateSource:templateCapabilities.source,templateFallback:templateCapabilities.fallback,capacityProfileVersion:templateCapabilities.capacityProfileVersion,capacityProfile:templateCapabilities.capacityProfile,rolloutProfile},null,2));

  const stages = [];
  const storyboardSnapshot=store.findLatestGenerationSnapshot?.({
    batchId,candidateId,purposes:[`social-card-editorial-${contentType}`],
  });
  const storyboardSkillId=storyboardSnapshot?.snapshot?.selection?.stages?.storyboard?.selectedSkill
    ||storyboardSnapshot?.snapshot?.selection?.selectedSkill
    ||(contentType==='event'?socialStoryboardSkillForContentClass(candidate.content_class):contentType==='custom'?'custom-card-storyboard':'repository-card-storyboard');
  const storyboardSkillHash=storyboardSnapshot?.snapshot?.skills?.find((item)=>item.id===storyboardSkillId)?.promptHash||'';
  store.updateCandidateTrack(candidateId, 'social_cards', { status:'drafting' });
  const record = (stage, skill, output, detail='') => {
    const expected = SOCIAL_CARD_STAGE_CONTRACT[stages.length];
    const skillMatches=expected?.skill==='storyboard-selection'?skill===storyboardSkillId:expected?.skill===skill;
    if (!expected || expected.id !== stage || !skillMatches) throw new Error(`图文契约阶段不一致：${stage}/${skill}`);
    const skillHash=skill===generator.skillName?generator.hash
      :skill===screenshotSkill.skillName?screenshotSkill.hash
      :skill===storyboardSkillId?storyboardSkillHash:'';
    stages.push({ stage, skill, skillHash, output, detail, completedAt:new Date().toISOString() });
    writeFile(path.join(workdir, 'social-card-stage-executions.json'), JSON.stringify(stages, null, 2));
  };
  writeFile(path.join(workdir, 'social-card-skill-manifest.json'), JSON.stringify({
    generator:{ hash:generator.hash, files:generator.files, fallback:generator.fallback },
    screenshots:{ hash:screenshotSkill.hash, files:screenshotSkill.files, fallback:screenshotSkill.fallback },
    ...(eventAnalysisSkill ? { eventAnalysis:{ hash:eventAnalysisSkill.hash, files:eventAnalysisSkill.files, fallback:eventAnalysisSkill.fallback } } : {}),
    loadedAt:new Date().toISOString(),
  }, null, 2));

  onProgress(contentType==='event'?(storyboardClass==='technology'?'图文 1/6：读取开源技术事件事实基座':storyboardClass==='trend'?'图文 1/6：读取开源趋势事件事实基座':'图文 1/6：读取事件事实基座'):contentType==='custom'?'图文 1/6：读取自定义事实基座':'图文 1/6：读取已核验仓库事实');
  const factPath = path.join(workdir, 'fact-sheet.md');
  if(contentType==='event')writeFile(factPath,eventFactMarkdown(eventAnalysisRecord.analysis));
  if(contentType==='custom'){
    if(facts?.data?.kind!=='custom')throw new Error('自定义事实基座不存在，请重新创建自定义图文');
    writeFile(factPath,customFactMarkdown(facts.data));
  }
  if (!fs.existsSync(factPath)) throw new Error(contentType==='event'?'事件事实清单不存在，请重新执行事件研判':'fact-sheet.md 不存在，请重新核验仓库');
  record('facts', 'fixed-program', factPath);

  const factPayload = contentType==='event' ? eventAnalysisRecord.analysis : facts?.data || {};
  const factIndex = buildSocialCardFactIndex(factPayload, { contentType });
  const rawCardPlan = sanitizeCardPlan(JSON.parse(editorial.card_plan_json || '[]'));
  const factBindingSanitized = sanitizeSocialCardPlanFactBindings(rawCardPlan, factIndex);
  const originalCardPlan = factBindingSanitized.pages;
  if (factBindingSanitized.removed.length) {
    // 只清理模型错误绑定的 supplement block，不修改核心故事板内容。
    store.saveCardEditorial?.(candidateId, { ...editorial, card_plan_json: JSON.stringify(originalCardPlan), status: 'AI_READY' });
  }
  // technology/trend 仍复用 event 事实基座和模板，但页数预算按实际故事板类型计算。
  const pageBudgetType = contentType === 'event' ? storyboardClass : contentType;
  const pageBudget = socialCardPageBudget(pageBudgetType);
  const recommendedPagesForContent = pageBudget.recommended;
  const absoluteMaxPagesForContent = pageBudget.absolute;
  const assertAbsolutePageBudget = (pages) => {
    const message = socialCardPageBudgetMessage(Array.isArray(pages) ? pages.length : 0, pageBudgetType);
    if (!message) return;
    const error = new Error(message);
    error.code = 'SOCIAL_CARD_PAGE_BUDGET_EXCEEDED';
    error.pageCount = Array.isArray(pages) ? pages.length : 0;
    error.absoluteMaxPages = absoluteMaxPagesForContent;
    throw error;
  };
  // 各类故事板先做相邻职责归一化，再进入通用模板容量预检。
  const storyboardNormalization = contentType === 'event'
    ? storyboardClass === 'technology'
      ? normalizeOpenSourceTechnologyStoryboardPages({ pages: originalCardPlan, capacityProfile: templateCapabilities.capacityProfile, mergeSlack: 1.04 })
      : storyboardClass === 'trend'
        ? normalizeOpenSourceTrendStoryboardPages({ pages: originalCardPlan, capacityProfile: templateCapabilities.capacityProfile, mergeSlack: 1.04 })
        : normalizeEventStoryboardPages({ pages: originalCardPlan, capacityProfile: templateCapabilities.capacityProfile, mergeSlack: 1.04 })
    : contentType === 'repository'
      ? normalizeRepositoryStoryboardPages({ pages: originalCardPlan, capacityProfile: templateCapabilities.capacityProfile, mergeSlack: 1.04 })
    : { pages: originalCardPlan, operations: [], changed: false };
  // 阶段 2：先以模板容量做确定性预检和续页，避免旧预算器在渲染前静默截断事实。
  // budgetCardPlan 保留为历史兼容导出；生产链路不再用它直接裁剪列表。
  const reflowResult = compileTemplateAwareCardPlan({
    cardPlan: storyboardNormalization.pages,
    capacityProfile: templateCapabilities.capacityProfile,
    maxPages: recommendedPagesForContent,
    absoluteMaxPages: absoluteMaxPagesForContent,
    heightAdvisory: true,
  });
  let cardPlan = reflowResult.pages;
  const pageCapOperations = [];
  assertAbsolutePageBudget(cardPlan);
  let finalContentAtomSnapshot = null;
  // 渲染前的确定性续页也要回写故事板，否则编辑器仍显示原始页数，
  // 布局报告中的 P7/P8 等续页就无法被用户定位和修复。
  const persistEffectiveCardPlan = (plan, status = null) => store.saveCardEditorial?.(candidateId, {
    ...editorial,
    card_plan_json: JSON.stringify(plan),
    ...(status ? { status } : {}),
  });
  if (storyboardNormalization.changed || reflowResult.changed) persistEffectiveCardPlan(cardPlan, 'AI_READY');
  let templateCompatibility=validateSocialCardTemplateCompatibility(cardPlan,{themeDefinition,channelMode,contentType});
  const planPath = path.join(workdir, 'card-plan.json');
  const originalPlanPath = path.join(workdir, 'card-plan-original.json');
  const reflowPath = path.join(workdir, 'card-plan-reflow.json');
  const planBaselinePath = path.join(workdir, 'social-card-plan-baseline.json');
  const contentAtomsPath = path.join(workdir, 'social-card-content-atoms.json');
  const factIndexPath = path.join(workdir, 'social-card-fact-index.json');
  const contentComponentsPath = path.join(workdir, 'social-card-content-components.json');
  const contentPlanAdjustmentsPath = path.join(workdir, 'social-card-content-plan-adjustments.json');
  const jointPackingAuditPath = path.join(workdir, 'social-card-joint-packing-audit.json');
  writeFile(factIndexPath, JSON.stringify(factIndex, null, 2));
  // 阶段 1/2/3：记录核心组件与事实补充组件池；阶段 2 同时按有效页面
  // 生成 page/role/slot 绑定候选，拆页后的续页装箱仍可回退到全局来源池。
  const contentComponents = buildSocialCardContentComponents({ cardPlan, factIndex, contentType, capacityProfile: templateCapabilities.capacityProfile });
  const contentComponentsValidation = validateSocialCardContentComponents(contentComponents);
  writeFile(contentComponentsPath, JSON.stringify({ ...contentComponents, validation: contentComponentsValidation }, null, 2));
  const originalContentAtomSnapshot = buildSocialCardContentAtomSnapshot(originalCardPlan, { source: 'storyboard-original' });
  const persistContentAtomSnapshot = (source = 'effective-plan') => {
    finalContentAtomSnapshot = buildSocialCardContentAtomSnapshot(cardPlan, { source });
    const conservation=compareSocialCardContentAtomConservation(originalContentAtomSnapshot.atoms,finalContentAtomSnapshot.atoms);
    const beforeRefs=new Set(conservation.beforeSourceRefs);
    const afterRefs=new Set(conservation.afterSourceRefs);
    writeFile(contentAtomsPath, JSON.stringify({
      schemaVersion: 1,
      original: originalContentAtomSnapshot,
      final: finalContentAtomSnapshot,
      conservation: {
        originalAtomCount: originalContentAtomSnapshot.summary.atomCount,
        finalAtomCount: finalContentAtomSnapshot.summary.atomCount,
        sourceRefsAvailable: finalContentAtomSnapshot.validation.valid,
        sourceRefsPreserved: conservation.sourceRefsPreserved,
        sourceAtomLossCount: [...beforeRefs].filter((ref)=>!afterRefs.has(ref)).length,
      },
    }, null, 2));
    return finalContentAtomSnapshot;
  };
  persistContentAtomSnapshot('effective-plan');
  writeFile(originalPlanPath, JSON.stringify({ schemaVersion: 1, source: 'storyboard', topic: candidate.hotspot_title, pages: originalCardPlan }, null, 2));
  writeFile(reflowPath, JSON.stringify({ schemaVersion: 1, source: 'template-aware-deterministic', storyboardNormalization, ...reflowResult, pageCapOperations }, null, 2));
  const reflowOperations = [...storyboardNormalization.operations, ...reflowResult.operations, ...pageCapOperations];
  const reflowChanged = storyboardNormalization.changed || reflowResult.changed || pageCapOperations.length > 0;
  const reflowHistory = [{ phase: 'preflight', changed: reflowChanged, operations: reflowOperations, warnings: reflowResult.warnings, unresolved: reflowResult.unresolved }];
  const contentPlanAdjustmentHistory = [];
  let contentPlanAdjustmentCount = 0;
  let contentPlanAdjustmentAttemptCount = 0;
  // 计划调整产物在首次写入时也要带上无进展门禁状态；必须先初始化，
  // 否则首次 persistContentPlanAdjustments() 会触发 TDZ。
  let noProgressGuard={detected:false,states:[],reason:''};
  // 事实补充保留每轮的技术安全上限，但单页不再使用固定 1 个的业务上限；
  // 每轮按目标页的剩余块容量动态计算，容量试装失败的候选不会阻塞同一页
  // 或其他页继续尝试更短、语义相近的组件。
  const maxFactBlocksPerRound = Math.max(1, Math.min(2, Number(rolloutProfile.maxOperationsPerRound) || 2));
  let maxFactBlocksPerPage = 0;
  const maxContentPlanAttempts = rolloutProfile.maxPlanRounds + 2;
  const persistContentPlanAdjustments = () => writeFile(contentPlanAdjustmentsPath, JSON.stringify({
    schemaVersion: 1,
    maxRounds: rolloutProfile.maxPlanRounds,
    maxAttempts: maxContentPlanAttempts,
    appliedRounds: contentPlanAdjustmentCount,
    attempts: contentPlanAdjustmentAttemptCount,
    maxOperationsPerRound: rolloutProfile.maxOperationsPerRound,
    rolloutProfile,
    noProgressGuard,
    acceptedOperations: contentPlanAdjustmentHistory.flatMap((round) => Array.isArray(round?.operations) ? round.operations : []),
    rejectedOperations: contentPlanAdjustmentHistory.flatMap((round) => Array.isArray(round?.rejectedOperations) ? round.rejectedOperations : []),
    dynamicFill: contentPlanAdjustmentHistory.map((round) => round?.dynamicFill).filter(Boolean),
    rounds: contentPlanAdjustmentHistory,
  }, null, 2));
  persistContentPlanAdjustments();
  let planOperations = reflowOperations.map((item) => ({ ...item, source: item.source || 'deterministic-preflight' }));
  const planningMeta = { schemaVersion: 3, channel_mode:outputMode||editorial.output_mode || 'xiaohongshu', composition_mode:editorial.composition_mode||'template', layout_style:editorial.layout_style||'auto', template:{pack:templateCompatibility.templatePack.id,version:templateCompatibility.templatePack.version,source:templateCompatibility.source,fallback:templateCompatibility.fallback}, capacityProfileVersion:templateCapabilities.capacityProfileVersion, capacityProfile:templateCapabilities.capacityProfile, rolloutProfile, pageBudget: pageBudget, topic:candidate.hotspot_title, source_page_count: originalCardPlan.length, reflow: { changed: reflowChanged, operations: reflowOperations, warnings: reflowResult.warnings, unresolved: reflowResult.unresolved, history: reflowHistory }, pages:cardPlan };
  writeFile(planPath, JSON.stringify(planningMeta, null, 2));
  record('planning', storyboardSkillId, planPath, reflowChanged ? `模板感知重排：${reflowOperations.map((item)=>item.op==='merge_event_auxiliary_pages'?`事件辅助页合并为争议讨论页（${item.sourcePages.map((page)=>`P${page}`).join('、')}）`:item.op==='merge_event_timeline_into_summary'?`P${item.pages.join('/')} 合并主事实与时间线`:item.op==='merge_repository_problem_capability'?`P${item.pages.join('/')} 合并痛点与核心能力`:item.op==='merge_repository_capability_quickstart'?`P${item.pages.join('/')} 合并能力与上手路径`:item.op==='merge_repository_limitations_ending'?`P${item.pages.join('/')} 合并限制与结尾`:item.op.startsWith('merge_technology_')?`P${item.pages.join('/')} 开源技术职责合并`:item.op.startsWith('merge_trend_')?`P${item.pages.join('/')} 开源趋势职责合并`:item.op==='split_block'?`P${item.page} ${item.blockType} 拆为 ${item.createdChunks} 页`:item.op==='merge_pages'?`P${item.pages.join('/')} 合并过短续页`:item.op==='dedupe_duplicate_block'?`P${item.page} 去除与 P${item.duplicateOfPage} 重复的 ${item.blockType}`:item.op==='coalesce_code_blocks'?`P${item.page} 合并相关代码块`:item.op==='move_block'&&item.from_page?`P${item.from_page} ${item.blockType} 移至 P${item.to_page}`:`P${item.page} 移动 ${item.blockType}`).join('；')}${reflowResult.warnings.length?`；${reflowResult.warnings.join('；')}`:''}` : '模板容量预检通过，未触发续页');

  const providerConfig = skillRuntime.providerConfig;
  // 强调色块封面的标题断行交给 AI 做语义切分（英文单词、专有名词不拆开）；
  // 渲染层 normalizeCoverTitleLines 校验不过或调用失败时回退确定性断行
  let coverTitleLines=null;
  const coverPage=cardPlan.find((page)=>page.kind==='cover');
  if(compileSocialTheme(themeDefinition).recipes.coverTitle==='highlight-block'&&coverPage){
    const coverTitle=String(coverPage.title||candidate.hotspot_title||'').trim();
    try{
      const split=await gateway.complete({ provider, purpose:'social-card-cover-title-lines', batchId, candidateId, jsonMode:true,
        maxOutputTokens:Math.min(600,providerConfig.maxOutputTokens), messages:[
          { role:'system', protected:true, content:'你是中文排版编辑。把给定封面标题拆成多行，用于逐行色块堆叠的封面排版。规则：每行视觉宽度必须不超过 8 个汉字宽度——这是硬性限制，优先于其他目标（英文字母、数字、空格按约 0.55 个汉字宽度计，例如 "DeerFlow" 约 4.4、全角标点按 1 计）；按语气与语义边界断行；英文单词、数字、专有名词不得拆开；不得增删或改写任何字符；满足行宽后行数尽量少，通常 2–4 行。示例：标题 "DeerFlow：开源超级智能体框架，处理复杂长周期任务" → {"lines":["DeerFlow：","开源超级智能体","框架，处理复杂","长周期任务"]}。只输出 JSON：{"lines":["第一行","第二行"]}。' },
          { role:'user', protected:true, content:JSON.stringify({ title:coverTitle }) },
        ] });
      const parsed=cleanCardPlanJson(split.content);
      coverTitleLines=parsed?.lines??null;
      if(coverTitleLines!=null&&!normalizeCoverTitleLines(coverTitle,coverTitleLines)){
        onProgress(`封面标题 AI 断行未通过校验（${JSON.stringify(coverTitleLines)}），使用确定性断行兜底`);
        coverTitleLines=null;
      }
    }catch(error){ onProgress(`封面标题 AI 断行调用失败（${error.message}），使用确定性断行兜底`); coverTitleLines=null; }
  }
  const repairSkillPrompt=selectSkillPromptReferences(generator.prompt,{
    include:['DESIGN_SYSTEM.md','references\\layout-contract.md',...(contentType==='event'
      ? [storyboardClass==='technology'?'references\\copy-technology.md':storyboardClass==='trend'?'references\\copy-trend.md':'references\\copy-event.md','references\\wechat-event-cards.md']
      : contentType==='custom' ? ['references\\copy-custom.md','references\\custom-cards.md']
        : ['references\\copy-tool.md','references\\wechat-tool-cards.md'])],
  });
  onProgress('图文 2/6：按项目技能生成配套文案');
  const copyResult = await generateSocialCardCopy({ gateway, provider, providerConfig, batchId, candidateId,
    skillPrompt: generator.prompt, channelMode, outputMode, topic: candidate.hotspot_title, contentType, storyboardClass,
    factData: factPayload, sourceUrl: facts?.source_url || facts?.sourceUrl || '', eventAnalysis: contentType==='event' ? eventAnalysisRecord.analysis : null,
    editorial, cardPlan, disclosure: contentType==='event' ? '据公开素材整理；未核实主张必须保留边界表达' : contentType==='custom' ? '体验性表述来自作者确认；建议性内容未实测' : '基于项目文档整理，未实际运行',
  });
  const copy = copyResult.copy;
  const configuredGate=evaluateConfiguredGates(skillRuntime.config,{factBase:contentType==='event'?eventAnalysisRecord.analysis:facts?.data||{},output:copy});
  if(!configuredGate.pass)throw new Error(`图文配置门禁未通过：${configuredGate.issues.map((item)=>item.message).join('；')}`);

  onProgress('图文 2.5/6：按技能布局契约组装逐页 HTML');
  let safeCompositionApplied=false;
  let safeCompositionPages=new Set();
  const safeCompositionPageKey=(page)=>[page?.kind,page?.role,page?.page_group_id,page?.continuation_index,page?.title].map((value)=>String(value??'')).join('|');
  let safeCompositionPageKeys=new Set();
  const resolveSafeCompositionPages=()=>{
    if(!safeCompositionPageKeys.size) return [...safeCompositionPages];
    const indexes=cardPlan.map((page,index)=>safeCompositionPageKeys.has(safeCompositionPageKey(page))?index:-1).filter((index)=>index>=0);
    safeCompositionPages=new Set(indexes);
    return indexes;
  };
  let relaxedDensityPages=new Set();
  let expandedDensityPages=new Set();
  let fitContentPages=new Set();
  const renderCurrentStoryboard=()=>{
    // 每次渲染前只做结构兼容归一化；不在渲染阶段删除内容块，
    // 让浏览器审计看到的计划与持久化计划保持一致。
    cardPlan = sanitizeCardPlan(cardPlan);
    // 生成链路中的内容页统一按实际内容高度收缩并居中；
    // fitContentPages 仍保留在状态中，用于记录“补充后仍偏空”的额外处理。
    const adaptiveContentPages=adaptiveContentPageIndexes(cardPlan,fitContentPages);
    return renderStoryboardHtml({ topic:candidate.hotspot_title, repository:facts?.data?.repository, pages:cardPlan, visualStyle, themeDefinition, layoutStyle:editorial.layout_style, compositionMode:editorial.composition_mode||'template',
      compositionSeed:`${candidate.batch_id}|${candidate.id}`,forceSafeComposition:safeCompositionApplied?(safeCompositionPageKeys.size?resolveSafeCompositionPages():safeCompositionPages.size?[...safeCompositionPages]:true):false,relaxedDensityPages,expandedDensityPages,fitContentPages:adaptiveContentPages,contentType,channelMode,coverTitleLines,sourceLabel:contentType==='event'?(storyboardClass==='technology'?'事件专题 · 开源技术':storyboardClass==='trend'?'事件专题 · 开源趋势':'事件专题'):contentType==='custom'?facts?.data?.content_type_label||'自定义':'',disclosure:contentType==='event'?'据公开素材整理 · 未核实内容已标注':'' });
  };
  let html = renderCurrentStoryboard();
  if (!copy || !/<html\b/i.test(html) || !/class=["'][^"']*\bpage\b/i.test(html)) throw new Error('图文生成产物缺少文案、完整 HTML 或 .page');
  const copyPath = path.join(workdir, 'copy.txt');
  const htmlPath = path.join(workdir, 'my-design.html');
  writeFile(copyPath, copy); writeFile(htmlPath, html);
  record('generation', generator.skillName, [copyPath, htmlPath]);

  const auditScript = path.join(workspaceRoot, 'skills', 'xiaohongshu-article-generator', 'scripts', 'layout-audit.mjs');
  const reportPath = path.join(workdir, 'layout-report.json');
  let report;
  let repairCount = 0;
  let repairGuardIssues=[];
  let structuralReflowAttempted=false;
  let structureRepairAttempted=false;
  let structureRepairCount=0;
  const contentPlanAdjustmentSignatures=new Set();
  const continuationPackingSignatures=new Set();
  // 内容计划候选先应用、再由下一轮浏览器审计提交。若候选造成真实
  // overflow/clipped，则整批回滚到应用前计划；静态高度不参与这项裁决。
  let pendingBrowserCandidate=null;
  let lastStructuralSignature='';
  const noProgressStateSignatures=new Map();
  const repairPhaseHistory=[];
  let templateMetrics=null;
  const auditAttempts=[];
  const initialReportPath=path.join(workdir,'template-audit-initial.json');
  const failureReportPath=path.join(workdir,'template-failure-report.json');
  const templateMetricsPath=path.join(workdir, 'social-template-metrics.json');
  const persistPlanBaseline=()=>{
    const baseline=buildSocialCardPlanBaseline({
      originalPlan:originalCardPlan,
      finalPlan:cardPlan,
      template:{
        requested:{...templateCapabilities.templatePack,source:templateCapabilities.source},
        rendered:{...templateCompatibility.templatePack,source:templateCompatibility.source},
        themeId:themeDefinition.id,
        capacityProfileVersion:templateCapabilities.capacityProfileVersion,
      },
      capacityProfile:templateCapabilities.capacityProfile,
      operations:planOperations,
      report,
      auditAttempts,
      repair:{
        structuralReflowAttempted:structuralReflowAttempted || structureRepairAttempted,
        structureRepairCount,
        contentPlanAdjustmentCount,
        textRepairCount:repairCount,
        safeCompositionPages:[...safeCompositionPages],
        relaxedDensityPages:[...relaxedDensityPages],
        expandedDensityPages:[...expandedDensityPages],
        fitContentPages:[...fitContentPages],
        phaseHistory:repairPhaseHistory,
        noProgressGuard,
      },
    });
    writeFile(planBaselinePath,JSON.stringify(baseline,null,2));
    return baseline;
  };
  const recordRepairPhase=({attempt,phase,action,changed=false,rerender=false,details=''})=>{
    repairPhaseHistory.push({attempt:Number(attempt)||0,phase:String(phase||''),action:String(action||''),changed:Boolean(changed),rerender:Boolean(rerender),details:String(details||''),recordedAt:new Date().toISOString()});
  };
  const persistTemplateMetrics=()=>{
    if(templateMetrics)return templateMetrics;
    reconcileSocialCardDynamicFillAuditsWithFinalReport(contentPlanAdjustmentHistory, report);
    persistContentPlanAdjustments();
    const finalAtoms=finalContentAtomSnapshot || buildSocialCardContentAtomSnapshot(cardPlan,{source:'metrics-final'});
    const conservation=compareSocialCardContentAtomConservation(originalContentAtomSnapshot.atoms,finalAtoms.atoms);
    const beforeRefs=new Set(conservation.beforeSourceRefs);
    const afterRefs=new Set(conservation.afterSourceRefs);
    const sourceAtomLossCount=[...beforeRefs].filter((ref)=>!afterRefs.has(ref)).length;
    templateMetrics=summarizeSocialTemplateRun({
      requestedTemplate:{...templateCapabilities.templatePack,source:templateCapabilities.source},
      renderedTemplate:{...templateCompatibility.templatePack,source:templateCompatibility.source},
      channelMode,contentType,report,fallback:templateCompatibility.fallback,
      operation:'generation',success:report?.valid===true,
      initialLayoutPass:auditAttempts[0]?.valid === true,
      auditAttempts:auditAttempts.length,
      themeId:themeDefinition.id,
      pageRoleStats:summarizeSocialCardPageRoles(cardPlan,report),
      structuralReflowAttempted:structuralReflowAttempted || structureRepairAttempted,
      structuralReflowSuccess:(structuralReflowAttempted || structureRepairAttempted) && report?.valid===true,
      structureRepairCount,
      contentPlanAdjustmentCount,
      textRepairCount:repairCount,
      pagesAdded:Math.max(0,cardPlan.length-originalCardPlan.length),
      planOperations,
      sourceAtomLossCount,
      jointPackingAudit:auditAttempts.map((item)=>item.jointPackingAudit).filter(Boolean),
      dynamicFillAudits:contentPlanAdjustmentHistory.map((round)=>round?.dynamicFill).filter(Boolean),
      rolloutProfile,
      hardGateFailure:report?.valid!==true,
    });
    writeFile(templateMetricsPath,JSON.stringify(templateMetrics,null,2));
    store.recordSocialTemplateMetric?.({...templateMetrics,batchId,candidateId});
    return templateMetrics;
  };
  const failStrictLayout=(message)=>{
    const requestedTemplate={ id: templateCapabilities.templatePack.id, version: templateCapabilities.templatePack.version, source: templateCapabilities.source };
    const renderedTemplate={ id: templateCompatibility.templatePack.id, version: templateCompatibility.templatePack.version, source: templateCompatibility.source };
    const failurePayload=templateAuditFailurePayload({ requestedTemplate, renderedTemplate, auditAttempts, report, repairCount, safeCompositionPages, relaxedDensityPages, expandedDensityPages, phaseHistory:repairPhaseHistory, maxLayoutAttempts, noProgressGuard });
    writeFile(failureReportPath, JSON.stringify(failurePayload, null, 2));
    persistPlanBaseline();
    persistTemplateMetrics();
    addArtifact(store,batchId,candidateId,'图文模板初始布局审计',initialReportPath);
    addArtifact(store,batchId,candidateId,'图文布局审计',reportPath);
    addArtifact(store,batchId,candidateId,'图文内容原子快照',contentAtomsPath);
    addArtifact(store,batchId,candidateId,'图文内容计划调整记录',contentPlanAdjustmentsPath);
    addArtifact(store,batchId,candidateId,'图文内容计划基线',planBaselinePath);
    addArtifact(store,batchId,candidateId,'图文联合装箱审计',jointPackingAuditPath);
    addArtifact(store,batchId,candidateId,'图文模板指标',templateMetricsPath);
    addArtifact(store,batchId,candidateId,'图文模板严格失败报告',failureReportPath);
    throw new Error(message);
  };
  // 阶段 0：先落一份不含正文的计划基线，后续每次审计/修复都会覆盖更新。
  persistPlanBaseline();
  for (let attempt=0; attempt<maxLayoutAttempts; attempt += 1) {
    onProgress(`图文 3/6：浏览器布局审计${attempt ? `与第 ${attempt} 轮修复` : ''}`);
    report = await runAudit(auditScript, htmlPath, reportPath, workdir);
    recordRepairPhase({attempt:attempt + 1,phase:'audit',action:'browser-layout-audit',changed:false,rerender:false,details:`valid=${report.valid===true?'true':'false'}`});
    const jointPackingAudit=auditSocialCardJointPacking({cardPlan,report,capacityProfile:templateCapabilities.capacityProfile});
    writeFile(jointPackingAuditPath,JSON.stringify({schemaVersion:1,attempt:attempt + 1,template:{id:templateCompatibility.templatePack.id,version:templateCompatibility.templatePack.version},...jointPackingAudit},null,2));
    const densityCalibration=assessSocialCardDensityTargets(report,cardPlan,{templatePackId:templateCompatibility.templatePack.id});
    auditAttempts.push({ attempt: attempt + 1, template: { id: templateCompatibility.templatePack.id, version: templateCompatibility.templatePack.version, source: templateCompatibility.source }, valid: report.valid === true, densityCalibration, jointPackingAudit: jointPackingAudit.summary, pages: layoutAuditPageSummary(report) });
    const repairStateSignature=socialCardRepairStateSignature({
      cardPlan,
      report,
      densityCalibration,
      safeCompositionPages,
      relaxedDensityPages,
      expandedDensityPages,
      fitContentPages,
    });
    // 状态指纹仅用于诊断和复盘，不再提前中断。修复流程由固定轮数约束，
    // 重复状态仍继续走后续构图、装箱、容器与文字兜底，最终由布局门禁裁决。
    noProgressStateSignatures.set(repairStateSignature,attempt + 1);
    persistPlanBaseline();
    if (attempt === 0) writeFile(initialReportPath, JSON.stringify({ schemaVersion: 1, template: { id: templateCompatibility.templatePack.id, version: templateCompatibility.templatePack.version, source: templateCompatibility.source }, report }, null, 2));
    const structuralPages=structuralLayoutPages(report);
    const textVisibilityPages=structuralPages.filter((item)=>item.structural.includes('text_invisible'));
    if(textVisibilityPages.length){
      const details=textVisibilityPages.map((item)=>`P${item.page}`).join('、');
      failStrictLayout(`文字可见性门禁未通过：${details} 存在与背景不可区分的文字。请检查主题文字色、色块背景和模板覆盖规则。`);
    }
    if(pendingBrowserCandidate){
      if(structuralPages.length){
        const rejected=pendingBrowserCandidate;
        cardPlan=structuredClone(rejected.beforePages);
        contentPlanAdjustmentCount=Math.max(0,contentPlanAdjustmentCount-1);
        rejected.round.browserAccepted=false;
        rejected.round.browserRejectedIssues=structuralPages.map((item)=>({page:item.page,issues:[...(item.structural||item.issues||[])]}));
        rejected.round.rolledBack=true;
        planOperations.push({op:'rollback_content_plan_candidate',source:'browser-layout-audit',round:rejected.round.round,issues:rejected.round.browserRejectedIssues});
        pendingBrowserCandidate=null;
        persistEffectiveCardPlan(cardPlan,'AI_READY');
        persistContentAtomSnapshot('browser-candidate-rollback');
        persistContentPlanAdjustments();
        templateCompatibility=validateSocialCardTemplateCompatibility(cardPlan,{themeDefinition,channelMode,contentType});
        writeFile(planPath,JSON.stringify({...planningMeta,composition_safety:safeCompositionApplied?'safe':'standard',pages:cardPlan},null,2));
        recordRepairPhase({attempt:attempt + 1,phase:'content-plan',action:'browser-candidate-rollback',changed:true,rerender:true,details:`pages=${structuralPages.map((item)=>item.page).join(',')}`});
        onProgress(`浏览器实测否决内容补充候选并回滚：${structuralPages.map((item)=>`P${item.page} ${(item.structural||[]).join('、')}`).join('；')}`);
        html=renderCurrentStoryboard();
        writeFile(htmlPath,html);
        continue;
      }
      pendingBrowserCandidate.round.browserAccepted=true;
      pendingBrowserCandidate=null;
      persistContentPlanAdjustments();
    }
    if (report.valid && !densityCalibration.pages.length) break;
    if (report.valid && densityCalibration.pages.length) onProgress(`布局硬门禁已通过，继续校准视觉密度：${densityCalibration.pages.map((item)=>`P${item.page} ${item.utilization}%→${item.target}%`).join('、')}`);
    // 第一层结构修复先做构图退化：只切换审计失败页，并立即交给浏览器复审。
    // 稳定单栏仍失败时，下一轮才允许模板重排、移动、合并或拆页。
    if(structuralPages.length&&editorial.composition_mode==='smart'&&!safeCompositionApplied){
      const compositionSeedValue=`${candidate.batch_id}|${candidate.id}`;
      const failedIndexes=structuralPages.map((page)=>Number(page.page)-1).filter((index)=>index>=0);
      const rescuable=failedIndexes.filter((index)=>{
        const page=cardPlan[index];
        if(!page)return false;
        const current=normalizeCardComposition(page,{pageIndex:index,seed:compositionSeedValue}).composition;
        const safe=normalizeCardComposition(page,{pageIndex:index,seed:compositionSeedValue,forceSafe:true}).composition;
        return current.columns!==safe.columns||current.flow!==safe.flow;
      });
      if(rescuable.length){
        safeCompositionApplied=true;
        safeCompositionPages=new Set(rescuable);
        safeCompositionPageKeys=new Set(rescuable.map((index)=>safeCompositionPageKey(cardPlan[index])));
        recordRepairPhase({attempt:attempt + 1,phase:'composition',action:'safe-composition',changed:true,rerender:true,details:`pages=${rescuable.map((index)=>index+1).join(',')}`});
        onProgress(`结构修复先退化稳定构图：${rescuable.map((index)=>`P${index+1}`).join('、')}`);
        html=renderCurrentStoryboard();
        writeFile(htmlPath,html);
        continue;
      }
    }
    // 结构修复只能做“完整条目拆页”。当页数已达上限，或目标页没有可拆条目时，
    // 再调用 split_page 必然得到空操作；此时转入受控内容缩写，让布局修复处理文字密度。
    const structuralFallbackOperations=structuralPages.length
      ? buildDeterministicSocialCardRestructureOperations(cardPlan,structuralPages,{maxPages:absoluteMaxPagesForContent})
      : [];
    if(structuralPages.length&&!structuralReflowAttempted){
      structuralReflowAttempted=true;
      const conservativeProfile=scaleSocialCardCapacityProfile(templateCapabilities.capacityProfile,rolloutProfile.structuralReflowScale);
      const structuralReflow=compileTemplateAwareCardPlan({cardPlan,capacityProfile:conservativeProfile,maxPages:recommendedPagesForContent,absoluteMaxPages:absoluteMaxPagesForContent,heightAdvisory:true});
      if(structuralReflow.changed&&cardPlanHash(structuralReflow.pages)!==cardPlanHash(cardPlan)){
        let reflowPages=structuralReflow.pages;
        const reflowBudgetError=socialCardPageBudgetMessage(reflowPages.length,contentType);
        if(reflowBudgetError) throw new Error(reflowBudgetError);
        const appliedCapOperations=[];
        cardPlan=reflowPages;
        planOperations.push(...structuralReflow.operations.map((item)=>({ ...item, source:'deterministic-browser-reflow' })));
        planOperations.push(...appliedCapOperations.map((item)=>({ ...item, source:'deterministic-page-cap' })));
        persistEffectiveCardPlan(cardPlan, 'AI_READY');
        persistContentAtomSnapshot('browser-structural-reflow');
        reflowHistory.push({phase:'browser-structural-preflight',scale:rolloutProfile.structuralReflowScale,changed:true,operations:[...structuralReflow.operations,...appliedCapOperations],warnings:structuralReflow.warnings,unresolved:structuralReflow.unresolved});
        templateCompatibility=validateSocialCardTemplateCompatibility(cardPlan,{themeDefinition,channelMode,contentType});
        writeFile(planPath,JSON.stringify({...planningMeta,composition_safety:safeCompositionApplied?'safe':'standard',pages:cardPlan},null,2));
        recordRepairPhase({attempt:attempt + 1,phase:'structure',action:'template-aware-reflow',changed:true,rerender:true,details:`operations=${structuralReflow.operations.length}`});
        html=renderCurrentStoryboard();writeFile(htmlPath,html);continue;
      }
    }
    const supplementSlots=Object.fromEntries(Object.entries(templateCapabilities.roles||{}).map(([role,capability])=>[role,Array.isArray(capability?.supplementSlots)?capability.supplementSlots:[]]));
    const densityTargetsByPage=new Map(densityCalibration.pages.map((item)=>[Number(item.page),item]));
    const plannerPages=(Array.isArray(report?.pages)?report.pages:[])
      .filter((item)=>{
        const target=densityTargetsByPage.get(Number(item?.page));
        return (item?.valid!==true&&Array.isArray(item?.issues)&&item.issues.length)||Boolean(target);
      })
      .map((item)=>{
        const pageNumber=Number(item.page);
        const page=Number.isInteger(pageNumber)?cardPlan[pageNumber-1]:null;
        const densityTarget=densityTargetsByPage.get(pageNumber);
        const role=String(item.role||page?.role||'');
        const capability=templateCapabilities.roles?.[role]||{};
        const blocks=Array.isArray(page?.content_blocks)?page.content_blocks:[];
        return {
          page:pageNumber,
          kind:item.kind,
          role,
          valid:false,
          issues:[...(Array.isArray(item.issues)?item.issues.map(String):[]),...(densityTarget?['underfilled_target']:[])],
          utilization:item.utilization,
          targetUtilization:densityTarget?.target ?? null,
          content_blocks:structuredClone(blocks),
          allowedSupplementSlots:(supplementSlots[role]||[]).map((slot)=>({id:slot.id,blockTypes:[...(slot.blockTypes||[])],maxItems:slot.maxItems,priority:slot.priority})),
          allowedBlockTypes:Array.isArray(capability.supportedBlocks)?[...capability.supportedBlocks]:[...(templateCapabilities.allowedBlockTypes||[])],
          remainingBlockCapacity:Number.isFinite(Number(capability.maxBlocks))?Math.max(0,Number(capability.maxBlocks)-blocks.length):null,
        };
      });
    const remainingBlockCapacities=plannerPages
      .map((item)=>Number(item.remainingBlockCapacity))
      .filter((value)=>Number.isFinite(value));
    maxFactBlocksPerPage=remainingBlockCapacities.length
      ? Math.max(1,Math.max(...remainingBlockCapacities))
      : maxFactBlocksPerRound;
    const canFitFactBlock=({page,block,role,pageNumber:providedPageNumber})=>{
      const capacity=templateCapabilities.capacityProfile?.roles?.[role]||templateCapabilities.capacityProfile||{};
      const projected={...page,content_blocks:[...(Array.isArray(page?.content_blocks)?page.content_blocks:[]),block]};
      const estimate=estimateSocialCardPageLoad(projected,capacity);
      // 块数、条目数等模板结构上限仍是硬约束；估算高度仅作为候选排序信号，
      // 实际高度由候选应用后的浏览器布局审计负责裁决。
      const hardReasons=estimate.reasons.filter((reason)=>reason!=='estimated-height');
      return hardReasons.length===0;
    };
    const factSupplementCapacityGuard=({operation,pages})=>{
      if(operation?.op!=='add_fact_block') return [];
      const pageNumber=Number(operation.page);
      const page=Number.isInteger(pageNumber)?pages[pageNumber-1]:null;
      const role=String(page?.role||'');
      return page&&canFitFactBlock({page,pageNumber,block:operation.block,role})
        ? []
        : [`P${pageNumber||'?'} 补充事实块超过模板结构容量`];
    };
    const planOperationGuard=({operation,pages})=>{
      const factIssues=factSupplementCapacityGuard({operation,pages});
      if(factIssues.length) return factIssues;
      if(operation?.op!=='merge_pages') return [];
      const simulated=applySocialCardRestructureOperations(pages,[operation],{maxPages:pages.length,maxOperations:1});
      if(!simulated.valid||!simulated.changed) return simulated.issues||['页面合并未通过校验'];
      const first=Math.min(...operation.pages.map(Number))-1;
      const merged=simulated.pages[first];
      const capacity=templateCapabilities.capacityProfile?.roles?.[String(merged?.role||'')]||templateCapabilities.capacityProfile;
      const estimate=estimateSocialCardPageLoad(merged,capacity);
      const hardReasons=estimate.reasons.filter((reason)=>reason!=='estimated-height');
      return hardReasons.length?[`P${operation.pages.join('/')} 合并后超过模板结构容量，不执行合并`]:[];
    };
    // 续页是原始故事板就已经存在时，不会触发结构重排分支；仍需在
    // 首次布局审计后独立重排，但结构阶段只能移动/合并已有核心块，
    // 不能在这里添加事实补充组件。补充组件统一由内容计划阶段负责。
    const continuationSignature=cardPlanHash(cardPlan);
    if (!continuationPackingSignatures.has(continuationSignature)) {
      continuationPackingSignatures.add(continuationSignature);
      const continuationRepack=rebalanceContinuationPages({
        pages:cardPlan,
        capacityProfile:templateCapabilities.capacityProfile,
        underfillThreshold:0.9,
        heightAdvisory:true,
      });
      const continuationCandidates=continuationRepack.operations.slice(0,rolloutProfile.maxOperationsPerRound);
      if (continuationCandidates.length) {
          const packed=applySocialCardRestructureOperations(cardPlan,continuationCandidates,{maxPages:absoluteMaxPagesForContent,maxOperations:rolloutProfile.maxOperationsPerRound,operationGuard:planOperationGuard});
        if (packed.valid&&packed.changed) {
          cardPlan=packed.pages;
          planOperations.push(...continuationCandidates.map((item)=>({...item,source:'deterministic-continuation-packing'})));
          persistEffectiveCardPlan(cardPlan,'AI_READY');
          persistContentAtomSnapshot('deterministic-continuation-packing');
          reflowHistory.push({phase:'deterministic-continuation-packing',changed:true,operations:continuationCandidates,warnings:[],unresolved:[]});
          templateCompatibility=validateSocialCardTemplateCompatibility(cardPlan,{themeDefinition,channelMode,contentType});
          writeFile(planPath,JSON.stringify({...planningMeta,composition_safety:safeCompositionApplied?'safe':'standard',pages:cardPlan},null,2));
          html=renderCurrentStoryboard();writeFile(htmlPath,html);
          recordRepairPhase({attempt:attempt + 1,phase:'structure',action:'continuation-repack-core-blocks',changed:true,rerender:true,details:`operations=${continuationCandidates.length}`});
          onProgress(`续页核心块重新装箱已应用：${continuationCandidates.map((item)=>item.op==='merge_pages'?`P${item.pages.join('/')}`:`P${item.from_page}->P${item.to_page}`).join('、')}`);
          continue;
        }
      }
    }
    // 非结构性失败保留原有安全构图尝试；结构性失败已在第一层入口处理。
    if(!structuralPages.length&&editorial.composition_mode==='smart'&&!safeCompositionApplied){
      const compositionSeedValue=`${candidate.batch_id}|${candidate.id}`;
      const failedIndexes=(Array.isArray(report.pages)?report.pages:[]).filter((page)=>page?.valid!==true).map((page)=>Number(page.page)-1)
        .filter((index)=>index>=0);
      const rescuable=failedIndexes.filter((index)=>{
        const page=cardPlan[index];
        if(!page)return false;
        const current=normalizeCardComposition(page,{pageIndex:index,seed:compositionSeedValue}).composition;
        const safe=normalizeCardComposition(page,{pageIndex:index,seed:compositionSeedValue,forceSafe:true}).composition;
        return current.columns!==safe.columns||current.flow!==safe.flow;
      });
      if(rescuable.length){
        safeCompositionApplied=true;
        safeCompositionPages=new Set(rescuable);
        safeCompositionPageKeys=new Set(rescuable.map((index)=>safeCompositionPageKey(cardPlan[index])));
        recordRepairPhase({attempt:attempt + 1,phase:'composition',action:'safe-composition',changed:true,rerender:true,details:`pages=${rescuable.map((index)=>index+1).join(',')}`});
        onProgress(`构图修复切换安全版式：${rescuable.map((index)=>`P${index+1}`).join('、')}`);
        html=renderCurrentStoryboard();
        writeFile(htmlPath,html);
        continue;
      }
    }
    const factSupplementFallbackCandidatePool=structuralPages.length===0
      ? buildSocialCardComponentPackingOperations(cardPlan,plannerPages,contentComponents,{maxOperations:maxFactBlocksPerRound,maxComponentsPerPage:maxFactBlocksPerPage,maxBlocksByRole:Object.fromEntries(Object.entries(templateCapabilities.roles||{}).map(([role,capability])=>[role,capability.maxBlocks])),allowedBlockTypes:templateCapabilities.allowedBlockTypes||[],canApply:canFitFactBlock})
      : [];
    const factSupplementJointSelection=selectBestSocialCardJointPackingOperations(cardPlan,factSupplementFallbackCandidatePool,{capacityProfile:templateCapabilities.capacityProfile,maxOperations:maxFactBlocksPerRound});
    const factSupplementFallbackOperations=factSupplementJointSelection.operations;
    // 只在没有未解决的结构问题时调整内容计划。页数超过上限本身就是
    // 需要内容计划调整器处理的信号：它必须有机会合并相邻续页或移动
    // 完整内容块；此前用 cardPlan.length<=maxPagesForContent 直接跳过，
    // 会让“超页 + 某页偏空”的计划永远没有合并机会，最终误报为审计穷尽。
    // 结构问题仍优先于内容补充，避免“补事实→溢出→拆页→再补事实”。
    const plannerEligible=plannerPages.length>0&&structuralPages.length===0;
    const plannerSignature=cardPlanHash(cardPlan)+':'+JSON.stringify(plannerPages.map((item)=>({page:item.page,issues:item.issues})));
    if(plannerEligible&&contentPlanAdjustmentCount<rolloutProfile.maxPlanRounds&&contentPlanAdjustmentAttemptCount<maxContentPlanAttempts&&!contentPlanAdjustmentSignatures.has(plannerSignature)){
      contentPlanAdjustmentSignatures.add(plannerSignature);
      contentPlanAdjustmentAttemptCount+=1;
      const currentAtoms=buildSocialCardContentAtomSnapshot(cardPlan,{source:'content-planner-input'});
      const plannerRound={attempt:contentPlanAdjustmentAttemptCount,round:null,targetPages:plannerPages,operations:[],valid:false,changed:false,source:'ai-content-planner'};
      try{
          const plannerComponentPool=buildSocialCardPlannerComponentPool(contentComponents,{pages:plannerPages});
          const plannerCardPlan=buildSocialCardPlannerPageScope(cardPlan,plannerPages);
          const plannerFacts=buildSocialCardPlannerFactScope(factPayload,factIndex,plannerComponentPool,plannerCardPlan);
          const scopedFactIndex={...factIndex,candidateCount:plannerFacts.candidates.length,candidates:plannerFacts.candidates};
          const plannerPageNumbers=new Set(plannerCardPlan.map((page)=>Number(page.page_number)));
          const scopedAtoms=currentAtoms.atoms.filter((atom)=>plannerPageNumbers.has(Number(atom.page)));
          const scopedPlannerPrompt=buildSocialCardContentPlannerPrompt({facts:plannerFacts,layoutReport:{pages:plannerPages},cardPlan:plannerCardPlan,totalPageCount:cardPlan.length,contentAtoms:scopedAtoms,templateCapabilities:templateCapabilities.capacityProfile,factIndex:scopedFactIndex,contentComponents:plannerComponentPool,maxPages:absoluteMaxPagesForContent,recommendedPages:recommendedPagesForContent,absoluteMaxPages:absoluteMaxPagesForContent,maxOperations:rolloutProfile.maxOperationsPerRound,maxFactBlocksPerRound,maxFactBlocksPerPage});
        const plannerResult=await gateway.complete({provider,purpose:'social-card-content-planner',batchId,candidateId,jsonMode:true,maxOutputTokens:Math.min(6000,providerConfig.maxOutputTokens),messages:[
          {role:'system',protected:true,content:`${scopedPlannerPrompt}\n\n当前运行阶段：浏览器审计后的内容计划调整。只返回契约规定的 JSON。`},
          {role:'user',protected:true,content:'请根据系统消息中的目标页上下文返回受控 JSON 操作；操作中的 page 使用 card_plan.page_number 对应的真实页码。'},
        ]});
        const operationJson=cleanCardPlanJson(plannerResult.content);
        const schemaResult=validateSocialCardContentPlannerSchema(operationJson);
        let applied;
        if(!schemaResult.valid){
          plannerRound.schemaValid=false;
          const partitioned=partitionSocialCardContentPlannerOperationsBySchema(operationJson);
          plannerRound.schemaIssues=schemaResult.issues;
          plannerRound.schemaRejectedOperations=partitioned.rejectedOperations;
          plannerRound.operations=partitioned.operations;
          applied=partitioned.operations.length
            ? applySocialCardContentPlannerOperationsPartial(cardPlan,partitioned.operations,{maxPages:absoluteMaxPagesForContent,maxOperations:rolloutProfile.maxOperationsPerRound,maxFactBlocksAdded:maxFactBlocksPerRound,maxFactBlocksPerPage,contentAtoms:currentAtoms.atoms,supplementSlots,factIndex,contentComponents,operationGuard:planOperationGuard})
            : {valid:false,changed:false,pages:structuredClone(cardPlan),issues:schemaResult.issues};
        }else{
          const operations=Array.isArray(operationJson)?operationJson:operationJson?.operations;
          plannerRound.schemaValid=true;
          plannerRound.operations=operations;
          applied=applySocialCardContentPlannerOperations(cardPlan,plannerRound.operations,{maxPages:absoluteMaxPagesForContent,maxOperations:rolloutProfile.maxOperationsPerRound,maxFactBlocksAdded:maxFactBlocksPerRound,maxFactBlocksPerPage,contentAtoms:currentAtoms.atoms,supplementSlots,factIndex,contentComponents,operationGuard:planOperationGuard});
          // 计划调整按页面独立提交：某一页的事实槽位错误不能连带丢弃
          // 其他页面已经合法的补充/续页操作。
          if (!applied.valid && plannerRound.operations.length) {
            const partial=applySocialCardContentPlannerOperationsPartial(cardPlan,plannerRound.operations,{maxPages:absoluteMaxPagesForContent,maxOperations:rolloutProfile.maxOperationsPerRound,maxFactBlocksAdded:maxFactBlocksPerRound,maxFactBlocksPerPage,contentAtoms:currentAtoms.atoms,supplementSlots,factIndex,contentComponents,operationGuard:planOperationGuard});
            if (partial.changed) {
              applied=partial;
              plannerRound.operations=partial.operations;
              plannerRound.rejectedOperations=partial.rejectedOperations;
            }
          }
        }
        // AI 返回的操作可能格式不完整或不符合当前模板槽位。即使有返回值，
        // 也不能让它阻塞程序兜底；只有校验通过且确实改变计划时才算成功。
        if((!applied.valid||!applied.changed)&&structuralFallbackOperations.length){
          const fallback=applySocialCardRestructureOperations(cardPlan,structuralFallbackOperations,{maxPages:absoluteMaxPagesForContent});
          if(fallback.valid&&fallback.changed){
            applied=fallback;
            plannerRound.operations=structuralFallbackOperations;
            plannerRound.source='deterministic-structure-fallback';
            onProgress(`内容计划调整未通过校验，程序按安全拆页兜底 ${structuralFallbackOperations.length} 个操作`);
          }
        }
        if((!applied.changed)&&factSupplementFallbackOperations.length){
          const fallback=applySocialCardRestructureOperations(cardPlan,factSupplementFallbackOperations,{maxPages:absoluteMaxPagesForContent,maxFactBlocksAdded:maxFactBlocksPerRound,maxFactBlocksPerPage,knownSourceRefs:factIndex.candidates.flatMap((item)=>item.source_refs||[]),supplementSlots,factIndex,operationGuard:planOperationGuard});
          if(fallback.valid&&fallback.changed){
            applied=fallback;
            plannerRound.operations=factSupplementFallbackOperations;
            plannerRound.source='deterministic-fact-supplement';
            plannerRound.jointPacking=factSupplementJointSelection;
            onProgress(`内容计划调整未通过校验，程序按角色槽位补充 ${factSupplementFallbackOperations.length} 个事实块`);
          }
        }
        plannerRound.valid=applied.valid;
        plannerRound.changed=applied.changed===true;
        plannerRound.dynamicFill=buildDynamicFillAudit({
          beforePlan:cardPlan,
          afterPlan:applied.pages || cardPlan,
          report,
          targetPages:plannerPages,
          capacityProfile:templateCapabilities.capacityProfile,
          acceptedOperations:applied.changed ? (applied.operations || plannerRound.operations) : [],
          rejectedOperations:[...(Array.isArray(plannerRound.schemaRejectedOperations) ? plannerRound.schemaRejectedOperations : []), ...(Array.isArray(applied.rejectedOperations) ? applied.rejectedOperations : [])],
          fallbackCandidateCount:factSupplementFallbackCandidatePool.length,
          changed:applied.changed===true,
        });
        if(applied.changed){
          const beforeBrowserCandidatePages=structuredClone(cardPlan);
          contentPlanAdjustmentCount+=1;
          plannerRound.round=contentPlanAdjustmentCount;
          structureRepairAttempted=true;
          structureRepairCount+=1;
          const compiled=compileTemplateAwareCardPlan({cardPlan:applied.pages,capacityProfile:templateCapabilities.capacityProfile,maxPages:recommendedPagesForContent,absoluteMaxPages:absoluteMaxPagesForContent,heightAdvisory:true});
          assertAbsolutePageBudget(compiled.pages);
          cardPlan=compiled.pages;
          let continuationSupplementOperations=[];
          let continuationRecompileOperations=[];
          const splitTriggered=[...plannerRound.operations,...compiled.operations].some((item)=>['split_page','split_block','move_block'].includes(String(item?.op||'')));
          if(splitTriggered){
            const continuationCandidatePool=buildSocialCardContinuationSupplementOperations(cardPlan,contentComponents,{capacityProfile:templateCapabilities.capacityProfile,underfillThreshold:0.9,maxOperations:maxFactBlocksPerRound,maxComponentsPerPage:maxFactBlocksPerPage,maxBlocksByRole:Object.fromEntries(Object.entries(templateCapabilities.roles||{}).map(([role,capability])=>[role,capability.maxBlocks])),allowedBlockTypes:templateCapabilities.allowedBlockTypes||[],canApply:canFitFactBlock});
            const continuationJointSelection=selectBestSocialCardJointPackingOperations(cardPlan,continuationCandidatePool,{capacityProfile:templateCapabilities.capacityProfile,maxOperations:maxFactBlocksPerRound});
            const continuationCandidates=continuationJointSelection.operations;
            if(continuationCandidates.length){
              const packed=applySocialCardRestructureOperations(cardPlan,continuationCandidates,{maxPages:absoluteMaxPagesForContent,maxOperations:maxFactBlocksPerRound,maxFactBlocksAdded:maxFactBlocksPerRound,maxFactBlocksPerPage,knownSourceRefs:factIndex.candidates.flatMap((item)=>item.source_refs||[]),supplementSlots,factIndex,operationGuard:planOperationGuard});
              if(packed.valid&&packed.changed){
                continuationSupplementOperations=continuationCandidates;
                const repacked=compileTemplateAwareCardPlan({cardPlan:packed.pages,capacityProfile:templateCapabilities.capacityProfile,maxPages:recommendedPagesForContent,absoluteMaxPages:absoluteMaxPagesForContent,heightAdvisory:true});
                assertAbsolutePageBudget(repacked.pages);
                cardPlan=repacked.pages;
                continuationRecompileOperations=repacked.operations;
                plannerRound.continuationSupplementSource='deterministic-continuation-supplement';
                plannerRound.continuationJointPacking=continuationJointSelection;
              }
            }
          }
          const allRecompileOperations=[...compiled.operations,...continuationRecompileOperations];
          const appliedSource=plannerRound.source==='ai-content-planner'?'ai-content-planner':plannerRound.source==='deterministic-fact-supplement'?'deterministic-fact-supplement':'deterministic-structure-fallback';
          planOperations.push(...plannerRound.operations.map((item)=>({...item,source:appliedSource})));
          planOperations.push(...compiled.operations.map((item)=>({...item,source:'content-planner-recompile'})));
          planOperations.push(...continuationSupplementOperations.map((item)=>({...item,source:'deterministic-continuation-supplement'})));
          planOperations.push(...continuationRecompileOperations.map((item)=>({...item,source:'continuation-packing-recompile'})));
          persistEffectiveCardPlan(cardPlan,'AI_READY');
          persistContentAtomSnapshot('content-plan-adjustment');
          reflowHistory.push({phase:'content-plan-adjustment',round:contentPlanAdjustmentCount,attempt:plannerRound.attempt,changed:true,operations:plannerRound.operations,recompileOperations:allRecompileOperations,continuationSupplementOperations,warnings:[...compiled.warnings],unresolved:compiled.unresolved});
          plannerRound.recompileOperations=allRecompileOperations;
          plannerRound.continuationSupplementOperations=continuationSupplementOperations;
          plannerRound.finalPageCount=cardPlan.length;
          plannerRound.dynamicFill=buildDynamicFillAudit({
            beforePlan:beforeBrowserCandidatePages,
            afterPlan:cardPlan,
            report,
            targetPages:plannerPages,
            capacityProfile:templateCapabilities.capacityProfile,
            acceptedOperations:plannerRound.operations,
            rejectedOperations:plannerRound.rejectedOperations,
            fallbackCandidateCount:factSupplementFallbackCandidatePool.length,
            changed:true,
          });
          contentPlanAdjustmentHistory.push(plannerRound);
          pendingBrowserCandidate={beforePages:beforeBrowserCandidatePages,round:plannerRound};
          persistContentPlanAdjustments();
          recordRepairPhase({attempt:attempt + 1,phase:'content-plan',action:'apply-plan-operations',changed:true,rerender:true,details:`source=${plannerRound.source};operations=${plannerRound.operations.length};supplementOperations=${continuationSupplementOperations.length}`});
          templateCompatibility=validateSocialCardTemplateCompatibility(cardPlan,{themeDefinition,channelMode,contentType});
          writeFile(planPath,JSON.stringify({...planningMeta,composition_safety:safeCompositionApplied?'safe':'standard',pages:cardPlan},null,2));
          html=renderCurrentStoryboard();writeFile(htmlPath,html);continue;
        }
        plannerRound.issues=applied.issues||[];
      }catch(error){
        plannerRound.error=String(error.message||error);
        if(error?.code==='SOCIAL_CARD_PAGE_BUDGET_EXCEEDED'){
          plannerRound.valid=false;
          plannerRound.changed=false;
          plannerRound.pageBudgetBlocked=true;
        }
      }
      if(!plannerRound.dynamicFill) {
        plannerRound.dynamicFill=buildDynamicFillAudit({
          beforePlan:cardPlan,
          afterPlan:cardPlan,
          report,
          targetPages:plannerPages,
          capacityProfile:templateCapabilities.capacityProfile,
          fallbackCandidateCount:factSupplementFallbackCandidatePool.length,
          error:plannerRound.error || '',
        });
      }
      contentPlanAdjustmentHistory.push(plannerRound);
      persistContentPlanAdjustments();
      recordRepairPhase({attempt:attempt + 1,phase:'content-plan',action:'plan-adjustment',changed:false,rerender:false,details:plannerRound.error||plannerRound.issues?.join('；')||'no applicable operations'});
      const plannerTargetSummary=plannerPages.map((item)=>`P${item.page}`).join('、') || '目标页';
      const plannerFailureSummary=plannerRound.error?'模型响应异常':plannerRound.issues?.length?'AI 操作未通过模板校验':'未生成可应用操作';
      onProgress(`内容计划调整第 ${plannerRound.attempt} 次尝试未应用：${plannerTargetSummary}：${plannerFailureSummary}，已保留原计划并继续自动修复`);
    }
    if(densityCalibration.pages.length&&!structuralPages.length){
      const fitCandidates=report.valid
        ? densityCalibration.pages.map((item)=>Number(item.page)-1)
        : softDensityPageIndexes(report);
      const newlyFitPages=fitCandidates.filter((index)=>index>=0&&!fitContentPages.has(index));
      if(newlyFitPages.length){
        for(const index of newlyFitPages)fitContentPages.add(index);
        recordRepairPhase({attempt:attempt + 1,phase:'content-container',action:'fit-content-center',changed:true,rerender:true,details:`pages=${newlyFitPages.map((index)=>index+1).join(',')}`});
        onProgress(`补充组件仍不足目标密度，启用内容高度自适应并居中：${newlyFitPages.map((index)=>`P${index+1}`).join('、')}`);
        html=renderCurrentStoryboard();
        writeFile(htmlPath,html);
        continue;
      }
      // 第三层最后才允许软放行：续页重排、页面专属组件装箱和内容容器
      // 调整均已没有可应用方案，才接受纯 underfilled 页面。
      const acceptedSoftDensityReport=acceptSoftDensityOnlyLayoutReport(report,adaptiveContentPageIndexes(cardPlan,fitContentPages));
      if(acceptedSoftDensityReport){
        report=acceptedSoftDensityReport;
        writeFile(reportPath,JSON.stringify(report,null,2));
        recordRepairPhase({attempt:attempt + 1,phase:'content-container',action:'soft-density-accept',changed:true,rerender:false,details:`pages=${report.acceptedSoftDensityPages.join(',')}`});
        onProgress(`续页重排、组件装箱和容器调整均已穷尽，按软门禁通过：${report.acceptedSoftDensityPages.map((page)=>`P${page}`).join('、')}`);
        Object.assign(auditAttempts.at(-1),{valid:true,pages:layoutAuditPageSummary(report),acceptedSoftDensityPages:[...report.acceptedSoftDensityPages]});
      }else{
        onProgress(`视觉密度校准已达到当前安全上限：${densityCalibration.pages.map((item)=>`P${item.page}`).join('、')} 暂无可安全装箱组件，保留硬门禁通过结果`);
      }
      break;
    }
    if(structuralPages.length){
      const structuralSignature=JSON.stringify(structuralPages.map((item)=>({page:item.page,issues:item.issues})));
      if(structuralSignature===lastStructuralSignature&&structureRepairAttempted){
        throw new Error(`结构修复连续两轮未改善：${structuralPages.map((item)=>`P${item.page} ${item.structural.join('、')}`).join('；')}。请在故事板中调整内容计划或拆页后重新生成。`);
      }
      lastStructuralSignature=structuralSignature;
      throw new Error(`结构性布局问题未解决：${structuralPages.map((item)=>`P${item.page} ${item.structural.join('、')}`).join('；')}。内容计划调整已穷尽，未继续执行无效文字修复。`);
    }
    if(structuralPages.length&&!structuralFallbackOperations.length){
      onProgress(`结构问题暂不拆页：${cardPlan.length>=absoluteMaxPagesForContent?'已达到绝对安全上限':'目标页没有可安全拆分的完整条目'}，转入受控文字缩写修复`);
    }
    let deterministicRerender=false;
    if(editorial.composition_mode==='smart'&&!safeCompositionApplied){
      const compositionSeedValue=`${candidate.batch_id}|${candidate.id}`;
      const failedIndexes=(Array.isArray(report.pages)?report.pages:[]).filter((page)=>!page.valid).map((page)=>page.page-1).filter((index)=>index>=0);
      // 安全变体只改构图不改内容：当前已是单列堆叠的失败页，安全回退不会改变其版面高度，对它们直接跳过、留给内容修复
      const rescuable=failedIndexes.filter((index)=>{
        const page=cardPlan[index];
        if(!page)return false;
        const current=normalizeCardComposition(page,{pageIndex:index,seed:compositionSeedValue}).composition;
        const safe=normalizeCardComposition(page,{pageIndex:index,seed:compositionSeedValue,forceSafe:true}).composition;
        return current.columns!==safe.columns||current.flow!==safe.flow;
      });
      // 只对审计失败且安全回退确实会改变构图的页启用安全变体，其余页保留故事板/种子构图
      if(rescuable.length){
        safeCompositionApplied=true;
        safeCompositionPages=new Set(rescuable);
        safeCompositionPageKeys=new Set(rescuable.map((index)=>safeCompositionPageKey(cardPlan[index])));
        deterministicRerender=true;
      }
    }
    for(const pageReport of Array.isArray(report?.pages)?report.pages:[]){
      const index=Number(pageReport?.page)-1;
      const tier=underfilledDensityTier(pageReport);
      if(index<0||!tier||expandedDensityPages.has(index))continue;
      if(relaxedDensityPages.has(index)){
        relaxedDensityPages.delete(index);
        expandedDensityPages.add(index);
      }else if(tier==='relaxed'){
        relaxedDensityPages.add(index);
      }else{
        expandedDensityPages.add(index);
      }
      deterministicRerender=true;
    }
    if(deterministicRerender){
      recordRepairPhase({attempt:attempt + 1,phase:'content-container',action:'density-adjustment',changed:true,rerender:true,details:`relaxed=${[...relaxedDensityPages].map((index)=>index+1).join(',')};expanded=${[...expandedDensityPages].map((index)=>index+1).join(',')}`});
      html=renderCurrentStoryboard();
      writeFile(htmlPath,html);
      continue;
    }
    if (attempt === maxLayoutAttempts-1 || repairCount >= rolloutProfile.textRepairMaxRounds) {
      const requestedTemplate={ id: templateCapabilities.templatePack.id, version: templateCapabilities.templatePack.version, source: templateCapabilities.source };
      failStrictLayout(`模板 ${requestedTemplate.id} v${requestedTemplate.version} 严格渲染未通过，未自动回退到 standard-v1。${layoutAuditFailureMessage(report,auditAttempts.length)}`);
    }
    repairCount += 1;
    recordRepairPhase({attempt:attempt + 1,phase:'text-repair',action:'ai-rewrite',changed:false,rerender:false,details:`round=${repairCount}`});
    const repair = await gateway.complete({ provider, purpose:'social-card-layout-repair', batchId, candidateId,
      maxOutputTokens:Math.min(8000, providerConfig.maxOutputTokens), messages:[
        { role:'system', protected:true, content:`${repairSkillPrompt}\n\n当前是布局修复阶段。只允许调整现有内容块中的文字长度，事实、页面数量、页面顺序、页面类型、页面标题、页面目标、证据引用、内容块数量、内容块顺序、内容块 type 和内容块标题必须保持不变。禁止输出 HTML、CSS、解释或任何非 JSON 内容。\n\n按问题类型调整：\n- underfilled：在原有段落内适度扩写，只能补充事实基座已经提供、且与该段职责直接相关的细节；禁止增加要点、例子、列表条目或内容块，禁止把原段落改写成同义列表。\n- overfilled：缩写原有段落，删除赘述和重复表达；不得删除内容块、列表条目或拆页。\n- overflow/clipped：在原有内容块内缩短文字并合并重复表达；不得新增、拆分、移动或改变内容块。\n- invalid_page_grid_structure/missing_content_stack/empty_page_body：原样保留 card_plan；结构问题由确定性渲染器处理，不得重构内容。\n\n只允许修改 content，或 items/headers/rows 现有成员中的文字；不得增删数组成员。code 内容不得修改。stats 数据卡的 num 字段不超过 6 个字符。\n\n禁止：新增事实、要点、例子、内容块或列表项；隐藏溢出、缩放、伪元素、空白卡、space-between、小于 11px 正文；把指令性描述写入内容字段。\n\n只输出 JSON：可以直接是 card_plan 数组，也可以是包含 card_plan 字段的对象。` },
        { role:'user', protected:true, content:JSON.stringify({ report, card_plan:cardPlan, previous_repair_rejected:repairGuardIssues, copy, topic:candidate.hotspot_title, content_type:contentType }) },
      ] });
    let repairJson;
    try {
      repairJson = cleanCardPlanJson(repair.content);
    } catch (error) {
      throw new Error(`第 ${attempt + 1} 轮布局修复返回的 JSON 无法解析：${error.message}`);
    }
    const newPlan = sanitizeCardPlan(Array.isArray(repairJson) ? repairJson : repairJson.card_plan).map((page,index)=>({
      ...page,
      layout_style:SOCIAL_CARD_LAYOUTS.includes(cardPlan[index]?.layout_style)?cardPlan[index].layout_style:'auto',
    }));
    repairGuardIssues=cardPlanRepairStructureIssues(cardPlan,newPlan);
    if(repairGuardIssues.length){if(attempt>=maxLayoutAttempts-2)throw new Error(`第 ${attempt + 1} 轮布局修复修改了受保护的故事板结构：${repairGuardIssues.join('；')}。AI 修复反复越界，建议在「02 卡片故事板」中直接调整问题页结构后重新「生成整组图文」。`);continue;}
    repairGuardIssues=[];
    cardPlan = newPlan;
    planOperations.push({ op:'rewrite_text', source:'ai-layout-repair', attempt:attempt + 1 });
    persistEffectiveCardPlan(cardPlan, 'AI_READY');
    persistContentAtomSnapshot('ai-text-repair');
    templateCompatibility=validateSocialCardTemplateCompatibility(cardPlan,{themeDefinition,channelMode,contentType});
    writeFile(planPath, JSON.stringify({ ...planningMeta, composition_safety:safeCompositionApplied?'safe':'standard', pages:cardPlan }, null, 2));
    repairPhaseHistory.at(-1).changed=true;
    repairPhaseHistory.at(-1).rerender=true;
    html = renderCurrentStoryboard();
    writeFile(htmlPath, html);
  }
  writeFile(planPath, JSON.stringify({ ...planningMeta, composition_seed:`${candidate.batch_id}|${candidate.id}`, composition_safety:safeCompositionApplied?'safe':'standard', pages:cardPlan }, null, 2));
  persistEffectiveCardPlan(cardPlan, 'AI_READY');
  persistContentAtomSnapshot('final');
  writeFile(themeSnapshotPath, JSON.stringify({schemaVersion:2,id:themeDefinition.id,label:themeDefinition.label,version:themeDefinition.version,source:themeDefinition.source,hash:themeDefinition.hash,autoRouting:themeRouting,templatePack:templateCompatibility.templatePack,templateSource:templateCompatibility.source,templateFallback:templateCompatibility.fallback,capacityProfileVersion:templateCapabilities.capacityProfileVersion,capacityProfile:templateCapabilities.capacityProfile,rolloutProfile},null,2));
  recordRepairPhase({attempt:auditAttempts.length,phase:'final-gate',action:report?.valid===true?'pass':'fail',changed:false,rerender:false,details:`valid=${report?.valid===true?'true':'false'}`});
  persistPlanBaseline();
  persistTemplateMetrics();
  // 记录故事板构图被回退/补齐的页，避免 LLM 构图被静默丢弃
  const compositionNotes=editorial.composition_mode==='smart'
    ? describeCardLayouts(cardPlan,{channelMode,compositionMode:'smart',seed:`${candidate.batch_id}|${candidate.id}`})
      .filter((decision)=>decision.source==='fallback'||decision.adjusted)
      .map((decision)=>`P${decision.page}${decision.source==='fallback'?'构图非法回退':'构图字段补齐'}`)
    : [];
  record('layout-audit', generator.skillName, reportPath, `安全变体：${safeCompositionApplied?safeCompositionPages.size?`已启用（${[...safeCompositionPages].map((index)=>`P${index+1}`).sort().join('、')}）`:'已启用':'未触发'}；舒展排版：${relaxedDensityPages.size?`轻档（${[...relaxedDensityPages].map((index)=>`P${index+1}`).sort().join('、')}）`:'轻档未触发'}，${expandedDensityPages.size?`强档（${[...expandedDensityPages].map((index)=>`P${index+1}`).sort().join('、')}）`:'强档未触发'}；内容计划调整轮次：${contentPlanAdjustmentCount}；文字修复轮次：${repairCount}${compositionNotes.length?`；${compositionNotes.join('、')}`:''}`);

  onProgress('图文 4/6：逐页生成高清 PNG');
  const outputDir = path.join(workdir, 'output');
  fs.mkdirSync(outputDir, { recursive:true });
  for (const file of fs.readdirSync(outputDir).filter((name)=>/\.png$/i.test(name))) {
    fs.unlinkSync(path.join(outputDir, file));
  }
  const screenshotModule = path.join(workspaceRoot, 'skills', 'html-pages-to-images', 'index.js');
  const { execute } = await import(`${pathToFileURL(screenshotModule).href}?v=${Date.now()}`);
  // 小红书与公众号页型一致：375×667（技能布局契约的固定页型）
  const screenshotResult = await execute({ htmlFile:htmlPath, outputDir, selector:'.page', pageWidth:375, pageHeight:667, deviceScaleFactor:3 });
  if (!screenshotResult.success) throw new Error(screenshotResult.message);
  const images = screenshotResult.data.images.map((item) => typeof item === 'string' ? item : item.path || item.filePath).filter(Boolean);
  record('screenshots', screenshotSkill.skillName, images);

  onProgress('图文 5/6：执行产物一致性门禁');
  const delivery = validateSocialCardDelivery({ html:fs.readFileSync(htmlPath, 'utf8'), plan:cardPlan, copy, report, images });
  const deliveryPath = path.join(workdir, 'delivery-report.json');
  writeFile(deliveryPath, JSON.stringify(delivery, null, 2));
  if (!delivery.valid) throw new Error(`图文交付门禁未通过：${delivery.issues.join('；')}`);
  record('delivery-gate', 'fixed-program', deliveryPath);

  for (const [kind, file] of [['图文事实清单',factPath],['图文事实候选索引',factIndexPath],['图文原始卡片规划',originalPlanPath],['图文卡片重排记录',reflowPath],['图文内容原子快照',contentAtomsPath],['图文内容计划调整记录',contentPlanAdjustmentsPath],['图文内容计划基线',planBaselinePath],['图文联合装箱审计',jointPackingAuditPath],['图文卡片规划',planPath],['图文配套文案',copyPath],['图文设计 HTML',htmlPath],['图文初始布局审计',initialReportPath],['图文布局审计',reportPath],['图文交付报告',deliveryPath],['图文主题快照',themeSnapshotPath],['图文模板指标',templateMetricsPath]]) addArtifact(store,batchId,candidateId,kind,file);
  for (const image of images) addArtifact(store,batchId,candidateId,'图文卡片 PNG',image);
  store.updateCandidateTrack(candidateId, 'social_cards', { status:'completed' });
  onProgress(`图文 6/6：完成，共生成 ${images.length} 张卡片`);
  return { workdir, copy:copyPath, html:htmlPath, layoutReport:reportPath, deliveryReport:deliveryPath, templateMetrics:templateMetricsPath, contentPlanAdjustments:contentPlanAdjustmentsPath, jointPackingAudit:jointPackingAuditPath, theme:{id:themeDefinition.id,version:themeDefinition.version,hash:themeDefinition.hash}, themeRouting, template:{pack:templateCompatibility.templatePack,source:templateCompatibility.source,fallback:templateCompatibility.fallback,warnings:templateCompatibility.warnings,capacityProfileVersion:templateCapabilities.capacityProfileVersion,capacityProfile:templateCapabilities.capacityProfile,rolloutProfile}, pageBudget, themeSnapshot:themeSnapshotPath, images, pageCount:images.length };
}
