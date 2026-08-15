import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadSkillBundle, selectSkillPromptReferences } from './skill-runtime.mjs';
import { evaluateCardGate, evaluateEventCardGate, evaluateCustomCardGate } from '../domain/social-card-gate.mjs';
import { customFactMarkdown } from '../domain/custom-fact-builder.mjs';
import { candidateSocialCardDir } from '../core/workspace-paths.mjs';
import { resolveEventAnalysis } from '../domain/event-fact-base.mjs';
import { bindGenerationSnapshot, prepareSkillRun } from '../skills/pipeline-runtime.mjs';
import { configuredRepairAttempts, evaluateConfiguredGates } from '../skills/configuration.mjs';
import { compileSocialTheme, socialThemeDefinition } from '../themes/social-theme-compiler.mjs';
import { resolveWorkspaceTheme } from '../themes/user-theme-service.mjs';
import { budgetCardPlan, layoutAuditFailureMessage, normalizeCoverTitleLines, underfilledDensityTier } from '../rendering/social-card-plan.mjs';
import { SOCIAL_CARD_LAYOUTS } from '../rendering/social-card-layout.mjs';
import { describeCardLayouts, normalizeCardComposition } from '../rendering/social-card-composition.mjs';
import { cardPlanRepairStructureIssues, sanitizeCardPlan } from '../rendering/storyboard-content.mjs';
import { renderStoryboardSections } from '../rendering/storyboard-page-renderer.mjs';
import { renderStoryboardDocument } from '../rendering/storyboard-document-renderer.mjs';

export { CARD_PLAN_BLOCK_BUDGET, CARD_PLAN_PAGE_ITEM_BUDGET, budgetCardPlan, cardPageDensity, layoutAuditFailureMessage, normalizeCoverTitleLines, underfilledDensityTier, underfilledPageIndexes } from '../rendering/social-card-plan.mjs';
export { resolveCardLayout, resolveCardLayoutDecision } from '../rendering/social-card-layout.mjs';
export { SOCIAL_CARD_LAYOUTS };
export { inferCardPageRole, SOCIAL_CARD_COMPOSITION_MODES, SOCIAL_CARD_PAGE_ROLES, stableCardCompositionSeed } from '../rendering/social-card-role.mjs';
export { describeCardLayouts, normalizeCardComposition, resolveCardCompositionDecision } from '../rendering/social-card-composition.mjs';
export { cardPlanRepairStructureIssues } from '../rendering/storyboard-content.mjs';

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

function cleanCardPlanJson(value) {
  const raw = String(value || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let json = fenced ? fenced[1].trim() : raw;
  const start = Math.min(
    json.includes('{') ? json.indexOf('{') : Infinity,
    json.includes('[') ? json.indexOf('[') : Infinity,
  );
  const end = Math.max(json.lastIndexOf('}'), json.lastIndexOf(']'));
  if (!Number.isFinite(start) || end < 0) throw new Error('布局修复未返回可解析的 card_plan JSON');
  return JSON.parse(json.slice(start, end + 1));
}

export function renderStoryboardHtml({ topic, repository, pages, visualStyle='ice-blue', themeDefinition:providedTheme=null, layoutStyle='auto', compositionMode='template', compositionSeed='', forceSafeComposition=false, relaxedDensityPages=false, expandedDensityPages=false, contentType='repository', sourceLabel='', disclosure='', channelMode='wechat', coverTitleLines=null }) {
  const themeDefinition=providedTheme||socialThemeDefinition(visualStyle,{fallback:false});
  if(!themeDefinition)throw new Error(`未知图文视觉主题：${visualStyle}`);
  const compiledTheme=compileSocialTheme(themeDefinition);
  const sections=renderStoryboardSections({topic,repository,pages,compiledTheme,layoutStyle,compositionMode,compositionSeed,forceSafeComposition,relaxedDensityPages,expandedDensityPages,contentType,sourceLabel,disclosure,channelMode,coverTitleLines});
  return renderStoryboardDocument({ topic, contentType, channelMode, compiledTheme, sections });
}

function addArtifact(store, batchId, candidateId, kind, filePath) {
  const stat = fs.statSync(filePath);
  store.upsertArtifact({ batchId, candidateId, track:'social_cards', kind, name:path.basename(filePath), path:filePath, size:stat.size, modifiedAt:stat.mtime.toISOString() });
}

export async function runAudit(script, htmlPath, reportPath, cwd) {
  if(fs.existsSync(reportPath))fs.unlinkSync(reportPath);
  try {
    await execFileAsync(process.execPath, [script, htmlPath, '--json', reportPath], { cwd, windowsHide:true, timeout:120000, maxBuffer:2_000_000 });
  } catch (error) {
    throw new Error(String(error.stderr || error.stdout || error.message).trim());
  }
  if(!fs.existsSync(reportPath))throw new Error('布局审计未生成本轮报告');
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

function validateDelivery({ html, plan, copy, report, images }) {
  const pageCount = [...String(html).matchAll(/class=["']([^"']*)["']/gi)]
    .filter((match) => match[1].split(/\s+/).includes('page')).length;
  const planned = Array.isArray(plan) ? plan.length : 0;
  const issues = [];
  if (!report.valid) issues.push('布局审计未通过');
  if (!planned || pageCount !== planned) issues.push(`HTML 页数 ${pageCount} 与规划页数 ${planned} 不一致`);
  if (images.length !== pageCount) issues.push(`PNG 数量 ${images.length} 与页面数 ${pageCount} 不一致`);
  if (!String(copy || '').trim()) issues.push('配套文案为空');
  const copyTagCount = (String(copy || '').match(/#[^#\s]{1,30}/g) || []).length;
  if (String(copy || '').trim() && copyTagCount < 3) issues.push(`配套文案话题标签不足（检测到 ${copyTagCount} 个，末尾应有 6–8 个）`);
  if (images.some((file) => !fs.existsSync(file) || fs.statSync(file).size === 0)) issues.push('存在空 PNG');
  return { valid:issues.length === 0, issues, pageCount, pngCount:images.length };
}

function eventFactMarkdown(analysis) {
  const facts=analysis.factBase||{},lines=['# 事件图文事实清单','',analysis.eventSummary||'','',
    '## 已确认事实','',...(facts.confirmedFacts||[]).map((item)=>`- ${item.claim}（来源 ${(item.sourceIds||[]).join('、')||'待补'}）`),
    '','## 尚未核实的主张','',...(facts.claims||[]).map((item)=>`- ${item.speaker?`${item.speaker}：`:''}${item.claim}（${item.status||'unverified'}；来源 ${(item.sourceIds||[]).join('、')||'待补'}）`),
    '','## 时间线','',...(facts.timeline||[]).map((item)=>`- ${item.time||'时间待核'}：${item.event}（来源 ${(item.sourceIds||[]).join('、')||'待补'}）`),
    '','## 来源风险与缺口','',...(analysis.sourceAudit?.issues||[]).map((item)=>`- ${item}`),...(analysis.sourceAudit?.neededMaterials||[]).map((item)=>`- 待补：${item}`)];
  return lines.join('\n').trim()+'\n';
}

export async function runSocialCardPipeline({ gateway, store, batchId, candidateId, provider, workspaceRoot, snapshotId=null, onProgress=()=>{} }) {
  const candidate = store.getCandidate(candidateId);
  if (!candidate || candidate.batch_id !== batchId) throw new Error('候选不存在或不属于当前批次');
  const outputMode=candidate.tracks?.find((item)=>item.track==='social_cards')?.output_mode||'';
  const contentType=outputMode.includes('event-cards')?'event':outputMode.includes('custom-cards')?'custom':'repository';
  const channelMode=outputMode.startsWith('xiaohongshu')?'xiaohongshu':'wechat';
  const facts = store.getRepositoryFactSheet(candidateId);
  const eventAnalysisRecord=contentType==='event'?resolveEventAnalysis({store,workspaceRoot,candidate}):null;
  const editorial = store.getCardEditorial(candidateId);
  const themeDefinition=resolveWorkspaceTheme(store,editorial.visual_style||'ice-blue','social')||socialThemeDefinition(editorial.visual_style||'ice-blue',{fallback:false});
  if(!themeDefinition)throw new Error(`未知图文视觉主题：${editorial.visual_style}`);
  store.recordThemeUsage?.({themeId:themeDefinition.id,version:themeDefinition.version,target:'social',source:themeDefinition.source,batchId,candidateId});
  const gate = contentType==='event'?evaluateEventCardGate(candidate,eventAnalysisRecord,editorial):contentType==='custom'?evaluateCustomCardGate(candidate,facts,editorial):evaluateCardGate(candidate, facts, editorial);
  if (!gate.ready) throw new Error(`卡片故事板尚未就绪：${gate.issues.join('；')}`);
  const batch = store.getBatch(batchId);
  const workdir = candidateSocialCardDir(workspaceRoot, batch, candidate);
  fs.mkdirSync(workdir, { recursive:true });
  const themeSnapshotPath=path.join(workdir,'social-theme-snapshot.json');
  writeFile(themeSnapshotPath,JSON.stringify({schemaVersion:1,id:themeDefinition.id,label:themeDefinition.label,version:themeDefinition.version,source:themeDefinition.source,hash:themeDefinition.hash},null,2));

  const generator = loadSkillBundle({ workspaceRoot, skillName:'xiaohongshu-article-generator' });
  const screenshotSkill = loadSkillBundle({ workspaceRoot, skillName:'html-pages-to-images' });
  if (generator.fallback) throw new Error('项目图文生成技能缺失');
  if (screenshotSkill.fallback) throw new Error('项目 HTML 截图技能缺失');
  const skillRuntime=await prepareSkillRun({gateway,store,batchId,candidateId,purpose:`social-cards-${contentType}`,bundles:[generator,screenshotSkill],provider,snapshotId});
  gateway=bindGenerationSnapshot(gateway,skillRuntime.snapshotId);
  provider=skillRuntime.provider;
  const maxLayoutAttempts=configuredRepairAttempts(skillRuntime.config,4)+1;
  const stages = [];
  const storyboardSnapshot=store.findLatestGenerationSnapshot?.({
    batchId,candidateId,purposes:[`social-card-editorial-${contentType}`],
  });
  const storyboardSkillId=storyboardSnapshot?.snapshot?.selection?.stages?.storyboard?.selectedSkill
    ||storyboardSnapshot?.snapshot?.selection?.selectedSkill
    ||(contentType==='event'?'event-card-storyboard':contentType==='custom'?'custom-card-storyboard':'repository-card-storyboard');
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
    loadedAt:new Date().toISOString(),
  }, null, 2));

  onProgress(contentType==='event'?'图文 1/6：读取突发事件事实基座':contentType==='custom'?'图文 1/6：读取自定义事实基座':'图文 1/6：读取已核验仓库事实');
  const factPath = path.join(workdir, 'fact-sheet.md');
  if(contentType==='event')writeFile(factPath,eventFactMarkdown(eventAnalysisRecord.analysis));
  if(contentType==='custom'){
    if(facts?.data?.kind!=='custom')throw new Error('自定义事实基座不存在，请重新创建自定义图文');
    writeFile(factPath,customFactMarkdown(facts.data));
  }
  if (!fs.existsSync(factPath)) throw new Error(contentType==='event'?'事件事实清单不存在，请重新执行突发分析':'fact-sheet.md 不存在，请重新核验仓库');
  record('facts', 'fixed-program', factPath);

  let cardPlan = sanitizeCardPlan(JSON.parse(editorial.card_plan_json || '[]'));
  const budgetResult = budgetCardPlan(cardPlan);
  cardPlan = budgetResult.pages;
  const planPath = path.join(workdir, 'card-plan.json');
  writeFile(planPath, JSON.stringify({ channel_mode:outputMode||editorial.output_mode || 'xiaohongshu', composition_mode:editorial.composition_mode||'template', layout_style:editorial.layout_style||'auto', topic:candidate.hotspot_title, pages:cardPlan }, null, 2));
  record('planning', storyboardSkillId, planPath, budgetResult.trims.length ? `密度预算裁剪：${budgetResult.trims.join('；')}` : '');

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
  const copyReference=contentType==='event'?'references\\copy-event.md'
    :contentType==='custom'?'references\\copy-custom.md':'references\\copy-tool.md';
  const legacyCopyReference=contentType==='event'?'references\\wechat-event-cards.md'
    :contentType==='custom'?'references\\custom-cards.md':'references\\wechat-tool-cards.md';
  const copySkillPrompt=selectSkillPromptReferences(generator.prompt,{
    include:['COPY_GUIDE.md',copyReference,legacyCopyReference],
  });
  const repairSkillPrompt=selectSkillPromptReferences(generator.prompt,{
    include:['DESIGN_SYSTEM.md','references\\layout-contract.md',copyReference,legacyCopyReference],
  });
  const input = {
    channel_mode:outputMode||editorial.output_mode || 'xiaohongshu', topic:candidate.hotspot_title,
    content_type:contentType,custom_content_type:contentType==='custom'?facts.data.content_type:undefined,source_url:contentType==='event'?(eventAnalysisRecord.analysis.sources||[]).map((item)=>item.url):contentType==='custom'?(facts.data.materials||[]).map((item)=>item.url):facts.source_url,
    repository_facts:contentType==='repository'?facts.data:undefined,event_analysis:contentType==='event'?eventAnalysisRecord.analysis:undefined,custom_facts:contentType==='custom'?facts.data:undefined,
    editorial_decisions:editorial,card_plan:cardPlan,
    disclosure:contentType==='event'?'据公开素材整理；未核实主张必须保留边界表达':contentType==='custom'?'体验性表述来自作者确认；建议性内容未实测':'基于项目文档整理，未实际运行', workdir,
  };
  onProgress('图文 2/6：按项目技能生成配套文案');
  const copyResult = await gateway.complete({ provider, purpose:'social-card-copy', batchId, candidateId,
    maxOutputTokens:Math.min(2400, providerConfig.maxOutputTokens), messages:[
      { role:'system', protected:true, content:`${copySkillPrompt}\n\n## 当前运行阶段\n只生成可直接发布的配套文案。输出纯文本，不要 JSON、Markdown 围栏、页码或布局指令；严格遵守事实与禁用表达。${channelMode==='xiaohongshu'?' 小红书渠道：文案口语化、段落短，适度使用 emoji，末尾带 6–8 个话题标签，标签不得含夸大功效词。':' 公众号渠道：文案信息密度优先，结构清晰，末尾带 6–8 个准确话题标签，标签须与内容严格相关。'}${contentType==='event'?' 未核实主张必须注明说话者和“尚未获独立证实”等边界；不得号召网暴或把争议定性为事实。':''}${contentType==='custom'?' 体验性表述只能来自 source_level=author_experience 的要点；user_material 必须保留来源归属；model_suggestion 只能写成建议或参考，禁止写成亲测、效果或收益。':''}` },
      { role:'user', protected:true, content:JSON.stringify(input) },
    ] });
  let copy = String(copyResult.content || '').trim().replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/i, '');
  const configuredGate=evaluateConfiguredGates(skillRuntime.config,{factBase:contentType==='event'?eventAnalysisRecord.analysis:facts?.data||{},output:copy});
  if(!configuredGate.pass)throw new Error(`图文配置门禁未通过：${configuredGate.issues.map((item)=>item.message).join('；')}`);

  onProgress('图文 2.5/6：按技能布局契约组装逐页 HTML');
  let safeCompositionApplied=false;
  let safeCompositionPages=new Set();
  let relaxedDensityPages=new Set();
  let expandedDensityPages=new Set();
  const renderCurrentStoryboard=()=>renderStoryboardHtml({ topic:candidate.hotspot_title, repository:facts?.data?.repository, pages:cardPlan, visualStyle:editorial.visual_style, themeDefinition, layoutStyle:editorial.layout_style, compositionMode:editorial.composition_mode||'template',
    compositionSeed:`${candidate.batch_id}|${candidate.id}`,forceSafeComposition:safeCompositionApplied?(safeCompositionPages.size?[...safeCompositionPages]:true):false,relaxedDensityPages,expandedDensityPages,contentType,channelMode,coverTitleLines,sourceLabel:contentType==='event'?'事件专题':contentType==='custom'?facts?.data?.content_type_label||'自定义':'',disclosure:contentType==='event'?'据公开素材整理 · 未核实内容已标注':'' });
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
  for (let attempt=0; attempt<maxLayoutAttempts; attempt += 1) {
    onProgress(`图文 3/6：浏览器布局审计${attempt ? `与第 ${attempt} 轮修复` : ''}`);
    report = await runAudit(auditScript, htmlPath, reportPath, workdir);
    if (report.valid) break;
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
      html=renderCurrentStoryboard();
      writeFile(htmlPath,html);
      continue;
    }
    if (attempt === maxLayoutAttempts-1) throw new Error(layoutAuditFailureMessage(report,maxLayoutAttempts));
    repairCount += 1;
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
    writeFile(planPath, JSON.stringify({ channel_mode:editorial.output_mode || 'xiaohongshu', composition_mode:editorial.composition_mode||'template', composition_safety:safeCompositionApplied?'safe':'standard', layout_style:editorial.layout_style||'auto', topic:candidate.hotspot_title, pages:cardPlan }, null, 2));
    html = renderCurrentStoryboard();
    writeFile(htmlPath, html);
  }
  writeFile(planPath, JSON.stringify({ channel_mode:editorial.output_mode || 'xiaohongshu', composition_mode:editorial.composition_mode||'template', composition_seed:`${candidate.batch_id}|${candidate.id}`, composition_safety:safeCompositionApplied?'safe':'standard', layout_style:editorial.layout_style||'auto', topic:candidate.hotspot_title, pages:cardPlan }, null, 2));
  // 记录故事板构图被回退/补齐的页，避免 LLM 构图被静默丢弃
  const compositionNotes=editorial.composition_mode==='smart'
    ? describeCardLayouts(cardPlan,{channelMode,compositionMode:'smart',seed:`${candidate.batch_id}|${candidate.id}`})
      .filter((decision)=>decision.source==='fallback'||decision.adjusted)
      .map((decision)=>`P${decision.page}${decision.source==='fallback'?'构图非法回退':'构图字段补齐'}`)
    : [];
  record('layout-audit', generator.skillName, reportPath, `安全变体：${safeCompositionApplied?safeCompositionPages.size?`已启用（${[...safeCompositionPages].map((index)=>`P${index+1}`).sort().join('、')}）`:'已启用':'未触发'}；舒展排版：${relaxedDensityPages.size?`轻档（${[...relaxedDensityPages].map((index)=>`P${index+1}`).sort().join('、')}）`:'轻档未触发'}，${expandedDensityPages.size?`强档（${[...expandedDensityPages].map((index)=>`P${index+1}`).sort().join('、')}）`:'强档未触发'}；内容修复轮次：${repairCount}${compositionNotes.length?`；${compositionNotes.join('、')}`:''}`);

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
  const delivery = validateDelivery({ html:fs.readFileSync(htmlPath, 'utf8'), plan:cardPlan, copy, report, images });
  const deliveryPath = path.join(workdir, 'delivery-report.json');
  writeFile(deliveryPath, JSON.stringify(delivery, null, 2));
  if (!delivery.valid) throw new Error(`图文交付门禁未通过：${delivery.issues.join('；')}`);
  record('delivery-gate', 'fixed-program', deliveryPath);

  for (const [kind, file] of [['图文事实清单',factPath],['图文卡片规划',planPath],['图文配套文案',copyPath],['图文设计 HTML',htmlPath],['图文布局审计',reportPath],['图文交付报告',deliveryPath],['图文主题快照',themeSnapshotPath]]) addArtifact(store,batchId,candidateId,kind,file);
  for (const image of images) addArtifact(store,batchId,candidateId,'图文卡片 PNG',image);
  store.updateCandidateTrack(candidateId, 'social_cards', { status:'completed' });
  onProgress(`图文 6/6：完成，共生成 ${images.length} 张卡片`);
  return { workdir, copy:copyPath, html:htmlPath, layoutReport:reportPath, deliveryReport:deliveryPath, theme:{id:themeDefinition.id,version:themeDefinition.version,hash:themeDefinition.hash}, themeSnapshot:themeSnapshotPath, images, pageCount:images.length };
}
