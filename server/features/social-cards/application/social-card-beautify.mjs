import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { candidateSocialCardDir } from '../../../platform/core/workspace-paths.mjs';
import { loadSkillBundle } from '../../../platform/llm/skill-runtime.mjs';
import { bindGenerationSnapshot, prepareSkillRun } from '../../../platform/skills/pipeline-runtime.mjs';
import { buildConversationToolCatalog } from '../../../platform/agent/tool-catalog.mjs';
import { getToolRegistry } from '../../../platform/tools/index.mjs';
import { applyCatalogSchemas, registerProjectResource, resolveResourceArguments, sanitizeCapabilityResult } from '../../../platform/agent/resource-adaptation.mjs';
import { writeSocialCardAiVisualBaseline } from './social-card-ai-visual-baseline.mjs';
import { compileSocialTheme, socialThemeDefinition } from '../../../shared/themes/social-theme-compiler.mjs';
import { resolveWorkspaceTheme } from '../../../platform/application/themes/user-theme-service.mjs';
import { createSocialCardStoryboardThemeSnapshot, getSocialCardTemplateCapabilities } from '../../../shared/rendering/social-card-template-resolver.mjs';
import { createSocialCardAiVisualStageRecorder, writeSocialCardAiVisualSkillManifest } from './social-card-ai-visual-pipeline.mjs';
import { AI_VISUAL_DOCUMENT_WRITE, runSocialCardAiVisualGenerationAgent } from './social-card-ai-visual-agent.mjs';
import { generateSocialCardCopy, validateSocialCardCopy } from './social-card-copy.mjs';
import { socialStoryboardClassForContentClass } from '../domain/social-routing.mjs';

const execFileAsync = promisify(execFile);
export const SOCIAL_CARD_BEAUTIFY_HTML = 'ai-beautified.html';
export const SOCIAL_CARD_BEAUTIFY_OUTPUT = 'ai-beautified-output';
export const SOCIAL_CARD_BEAUTIFY_REPORT = 'ai-beautify-report.json';
export const SOCIAL_CARD_BEAUTIFY_DELIVERY_GATE = 'ai-beautified-delivery-gate.json';
const AI_VISUAL_SKILL_NAME = 'social-card-ai-visual-generator';
const AI_INTERNAL_FIELDS = new Set(['source_refs', 'source_urls', 'source_url', 'fact_ids', 'evidence_refs']);
const SOCIAL_CARD_PROJECT_READ_CAPABILITY = 'cap_filesystem_project_read';
const AI_VISUAL_BUNDLED_REFERENCE_FILES = Object.freeze(['layout-guide.md', 'xhs-visual-contract.md', 'visual-component-mapping.md']);
const AI_VISUAL_INPUT_INSTRUCTION = '必须先一次读取 workspace.files 中列出的全部本次运行输入，再开始视觉策划和写入。workspace.files 只包含 card-plan.json、ai-visual-card-plan.json、原始事实 JSON、social-theme-design-spec.md、social-theme-snapshot.json 和 copy.txt；它们分别负责故事板事实、视觉语义索引、事实核对、主题配方、运行元数据和只读文案。layout-guide.md、xhs-visual-contract.md、visual-component-mapping.md 已随本技能作为内置参考注入，不属于 workspace.files，不要重复读取或把它们当成候选内容。所有输入只控制设计和事实边界，不能把路径、来源 ID、技术字段或规范说明展示为页面正文。';
const AI_VISUAL_THEME_LAYOUT_FIELDS = Object.freeze([
  'bodyPx', 'h1Px', 'h2Px', 'captionPx', 'codePx', 'lineHeight', 'letterSpacingEm',
  'articlePaddingPx', 'sectionPx', 'paragraphPx', 'cardGapPx',
]);
// 生成完成后直接截图，方便人工查看原始视觉产物。
const ENABLE_AI_VISUAL_SCREENSHOTS = true;
// 只检查交付文件是否真实存在且完整。
const ENABLE_AI_VISUAL_DELIVERY_GATE = true;

function htmlPageCount(html) {
  return [...String(html || '').matchAll(/class=["']([^"']+)["']/gi)]
    .filter((match) => match[1].split(/\s+/).includes('page')).length;
}

export function createAiVisualDocumentWriteSessionId(batchId, candidateId) {
  const runToken = randomUUID().replaceAll('-', '').slice(0, 16);
  return `ai-visual-${String(batchId).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 54)}-${String(candidateId).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 24)}-${runToken}`;
}

export function validateAiVisualGenerationCompletion({ agent = null, generatedPageCount = 0, requiredPageCount = 0 } = {}) {
  const expected = Number(requiredPageCount) || 0;
  const actual = Number(generatedPageCount) || 0;
  const issues = [];
  if (agent?.type !== 'final') issues.push(`Agent 未正常完成（${agent?.type || 'unknown'}）`);
  if (agent?.documentFinished !== true) issues.push('文档未成功 finish');
  if (actual !== expected) issues.push(`页面数不完整（应为 ${expected}，实际 ${actual}）`);
  return { valid: issues.length === 0, expectedPageCount: expected, pageCount: actual, issues };
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function bodyData(html, name) {
  const match = String(html || '').match(new RegExp(`data-${name}=["']([^"']+)["']`, 'i'));
  return match ? match[1] : '';
}

function bodyClass(html) {
  const match = String(html || '').match(/<body\b[^>]*class=["']([^"']+)["']/i);
  return match ? match[1] : '';
}

function sourceUrls(html) {
  return [...String(html || '').matchAll(/(?:href|src)=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((value) => /^https?:\/\//i.test(value));
}

function collectSourceUrls(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectSourceUrls(item, output);
    return [...output];
  }
  if (!value || typeof value !== 'object') return [...output];
  for (const [key, item] of Object.entries(value)) {
    if (['source_refs', 'source_urls', 'source_url', 'url'].includes(key)) {
      const values = Array.isArray(item) ? item : [item];
      for (const candidate of values) if (/^https?:\/\//i.test(String(candidate || ''))) output.add(String(candidate));
    } else if (item && typeof item === 'object') collectSourceUrls(item, output);
  }
  return [...output];
}

function factText(value) {
  if (Array.isArray(value)) return value.map(factText).join(' ');
  if (!value || typeof value !== 'object') return String(value ?? '');
  return Object.entries(value)
    .filter(([key]) => !['visual', 'source_refs', 'source_urls', 'source_url', 'fact_ids', 'evidence_refs', 'composition'].includes(key))
    .map(([, item]) => factText(item))
    .join(' ');
}

function stripAiInternalFields(value) {
  if (Array.isArray(value)) return value.map(stripAiInternalFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !AI_INTERNAL_FIELDS.has(key))
    .map(([key, item]) => [key, stripAiInternalFields(item)]));
}

function normalizedChannelMode(value) {
  return String(value || '').toLowerCase().startsWith('xiaohongshu') ? 'xiaohongshu' : 'wechat';
}

function factFileForContentType(contentType) {
  return contentType === 'repository'
    ? 'repository-fact-sheet.json'
    : contentType === 'custom'
      ? 'custom-fact-sheet.json'
      : 'event-analysis.json';
}

function canonicalAiVisualWorkspaceFiles(factFile) {
  return ['card-plan.json', 'ai-visual-card-plan.json', factFile, 'social-theme-snapshot.json', 'social-theme-design-spec.md', 'copy.txt'];
}

export function buildAiVisualThemeSnapshot(snapshot = {}) {
  const output = structuredClone(snapshot && typeof snapshot === 'object' ? snapshot : {});
  const themeMetrics = output?.capacityProfile?.theme;
  if (themeMetrics && typeof themeMetrics === 'object') {
    for (const field of AI_VISUAL_THEME_LAYOUT_FIELDS) delete themeMetrics[field];
  }
  return output;
}

function hasBundledVisualReference(skillBundle, referenceName) {
  return (Array.isArray(skillBundle?.files) ? skillBundle.files : [])
    .some((filePath) => path.basename(String(filePath)).toLowerCase() === referenceName.toLowerCase());
}

function beautifyContentType(candidate, planEnvelope = null) {
  if (planEnvelope?.pageBudget?.contentType) return String(planEnvelope.pageBudget.contentType);
  if (candidate?.content_class === 'github_project') return 'repository';
  if (candidate?.content_class === 'custom') return 'custom';
  return 'event';
}

function syncAiThemeSnapshot({ workdir, store, editorial, candidate }) {
  const planEnvelope = readJsonFile(path.join(workdir, 'card-plan.json'), null);
  const previousSnapshot = readJsonFile(path.join(workdir, 'social-theme-snapshot.json'), {});
  const requestedThemeId = String(editorial?.visual_style || 'auto');
  const themeId = requestedThemeId === 'auto' ? String(previousSnapshot.id || 'ice-blue') : requestedThemeId;
  const contentType = beautifyContentType(candidate, planEnvelope);
  const channelMode = normalizedChannelMode(planEnvelope?.channel_mode || editorial?.output_mode || 'wechat');
  const themeDefinition = resolveWorkspaceTheme(store, themeId, 'social')
    || socialThemeDefinition(themeId, { fallback: false });
  if (!themeDefinition) throw new Error(`未知图文视觉主题：${themeId}`);
  const capabilities = getSocialCardTemplateCapabilities({ themeDefinition, channelMode, contentType });
  const storyboardSnapshot = createSocialCardStoryboardThemeSnapshot({ themeDefinition, channelMode, contentType });
  const snapshot = {
    ...storyboardSnapshot,
    id: themeDefinition.id,
    label: themeDefinition.label,
    version: themeDefinition.version,
    source: themeDefinition.source,
    hash: themeDefinition.hash,
    templateSource: capabilities.source,
    templateFallback: capabilities.fallback,
  };
  const aiVisualSnapshot = buildAiVisualThemeSnapshot(snapshot);
  writeFile(path.join(workdir, 'social-theme-snapshot.json'), JSON.stringify(aiVisualSnapshot, null, 2));
  return aiVisualSnapshot;
}

function compactStoryboardPage(page, index) {
  const blocks = Array.isArray(page?.content_blocks) ? page.content_blocks : [];
  return {
    page: index + 1,
    kind: String(page?.kind || 'content'),
    role: String(page?.role || 'concept'),
    title: String(page?.title || ''),
    lead: String(page?.lead || ''),
    summary: String(page?.summary || ''),
    evidence: Array.isArray(page?.evidence) ? page.evidence : [],
    layout_style: String(page?.layout_style || ''),
    layout_intent: String(page?.layout_intent || ''),
    page_group_id: page?.page_group_id || null,
    continuation_index: page?.continuation_index || null,
    composition: page?.composition || null,
    visual: page?.visual || null,
    content_blocks: blocks,
  };
}

function compactThemeContract(themeSnapshot, original) {
  const themeId = String(themeSnapshot?.id || themeSnapshot?.themeId || bodyData(original, 'visual-style') || 'ice-blue');
  const definition = socialThemeDefinition(themeId, { fallback: true });
  const compiled = definition ? compileSocialTheme(definition) : null;
  const capacity = themeSnapshot?.capacityProfile || {};
  const roles = capacity.roles && typeof capacity.roles === 'object'
    ? Object.fromEntries(Object.entries(capacity.roles).map(([role, value]) => [role, {
      role,
      template: value?.template || '',
      structural: value?.structural || null,
      visual: value?.visual || null,
      split: value?.split || null,
    }]))
    : {};
  return {
    id: themeId,
    label: themeSnapshot?.label || definition?.label || themeId,
    version: themeSnapshot?.version || definition?.version || '',
    canvas: capacity.canvas || { width: 375, height: 667 },
    templatePack: themeSnapshot?.templatePack || capacity.templatePack || null,
    colors: definition?.tokens?.colors || null,
    typography: definition?.tokens?.typography || null,
    spacing: definition?.tokens?.spacing || null,
    shape: definition?.tokens?.shape || null,
    recipes: compiled?.recipes || definition?.social?.recipes || null,
    effects: definition?.social?.effects || null,
    roles,
  };
}

export function buildBeautifyContext({ workdir, original, candidate, editorial }) {
  const planEnvelope = readJsonFile(path.join(workdir, 'card-plan.json'), null);
  let editorialPlan = [];
  try { editorialPlan = JSON.parse(editorial?.card_plan_json || '[]'); } catch {}
  const pages = Array.isArray(planEnvelope?.pages) && planEnvelope.pages.length
    ? planEnvelope.pages
    : Array.isArray(editorialPlan) ? editorialPlan : [];
  const themeSnapshot = readJsonFile(path.join(workdir, 'social-theme-snapshot.json'), {});
  const effectiveThemeSnapshot = editorial?.visual_style && editorial.visual_style !== 'auto'
    ? { ...themeSnapshot, id: String(editorial.visual_style) }
    : themeSnapshot;
  const rawChannelMode = planEnvelope?.channel_mode || themeSnapshot?.channelMode || bodyData(original, 'channel') || String(editorial?.output_mode || 'wechat');
  const candidateContentType = candidate?.content_class === 'github_project'
    ? 'repository'
    : candidate?.content_class === 'custom'
      ? 'custom'
      : 'event';
  const contentType = String(planEnvelope?.pageBudget?.contentType || themeSnapshot?.contentType || candidateContentType);
  const requiredPageCount = pages.length || htmlPageCount(original);
  return {
    topic: String(candidate?.hotspot_title || ''),
    contentType,
    channelMode: normalizedChannelMode(rawChannelMode),
    bodyClass: bodyClass(original),
    compositionMode: String(planEnvelope?.composition_mode || editorial?.composition_mode || 'template'),
    layoutStyle: String(planEnvelope?.layout_style || editorial?.layout_style || 'auto'),
    sourceLabel: String(themeSnapshot?.sourceLabel || ''),
    disclosure: contentType === 'event' ? '据公开素材整理 · 未核实内容已标注' : '',
    requiredPageCount,
    storyboardPageCount: pages.length,
    storyboard: pages.map(compactStoryboardPage),
    theme: compactThemeContract(effectiveThemeSnapshot, original),
    sourceUrls: collectSourceUrls(pages).length ? collectSourceUrls(pages) : sourceUrls(original),
    layoutContract: {
      pageWidth: 375,
      pageHeight: 667,
      requiredPageSelector: '.page',
      requiredPageKinds: ['cover', 'content', 'ending'],
      requiredInnerStructure: ['.page-cover|.page-inner', '.page-body', '.bottom-strip'],
      minBodyTextPx: 11,
    },
  };
}

export function buildAiRenderRequest(context = {}, {
  workspaceResourceId = 'project:current',
  workspaceFiles = canonicalAiVisualWorkspaceFiles(factFileForContentType(context.contentType)),
} = {}) {
  const files = Array.isArray(workspaceFiles) && workspaceFiles.length
    ? [...new Set(workspaceFiles.map((file) => String(file)).filter(Boolean))]
    : canonicalAiVisualWorkspaceFiles(factFileForContentType(context.contentType));
  const request = {
    workspace: {
      resourceId: workspaceResourceId,
      files,
      instruction: AI_VISUAL_INPUT_INSTRUCTION,
    },
    channelMode: context.channelMode || 'wechat',
    requiredPageCount: Number(context.requiredPageCount) || 0,
  };
  return request;
}

function buildAiVisualGenerationBrief({ context, workspaceFiles, styleBrief = '' }) {
  const theme = context?.theme || {};
  const fileList = (Array.isArray(workspaceFiles) ? workspaceFiles : []).join('、');
  const pageCount = Number(context?.requiredPageCount) || 0;
  const themeLabel = [theme.id, theme.label, theme.version].filter(Boolean).join(' · ') || '由 social-theme-design-spec.md 确定';
  const brief = String(styleBrief || '').trim().slice(0, 800);
  return `

## 本次运行参数

- 目标页数：${pageCount}
- 冻结输入文件：${fileList}
- 当前主题：${themeLabel}
- 额外设计意图：${brief || '无，按主题规范和视觉技能自行决定。'}

以上仅补充本次运行的动态参数；生成规则、布局规范、主题执行、分块写入协议和阶段边界以已加载的技能及当前阶段指令为准。
`;
}

function compactAiVisualValue(value) {
  if (Array.isArray(value)) {
    const items = value.map(compactAiVisualValue).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, compactAiVisualValue(item)])
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  if (value === null || value === undefined || value === '') return undefined;
  return value;
}

function compactAiVisualBlock(block = {}) {
  return compactAiVisualValue({
    type: block.type,
    title: block.title,
    content: block.content,
    text: block.text,
    items: block.items,
    headers: block.headers,
    rows: block.rows,
    source_refs: block.source_refs,
  }) || null;
}

export function buildAiVisualCardPlan(plan = {}) {
  const pages = (Array.isArray(plan?.pages) ? plan.pages : []).map((page, index) => compactAiVisualValue({
    page: index + 1,
    kind: page?.kind,
    role: page?.role,
    title: page?.title,
    goal: page?.goal,
    evidence: page?.evidence,
    content_blocks: (Array.isArray(page?.content_blocks) ? page.content_blocks : [])
      .map(compactAiVisualBlock)
      .filter(Boolean),
  }));
  return compactAiVisualValue({
    schemaVersion: 1,
    topic: plan?.topic,
    channel_mode: plan?.channel_mode,
    requiredPageCount: pages.length,
    pages,
  }) || { schemaVersion: 1, requiredPageCount: 0, pages: [] };
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, String(content).trimEnd() + '\n', 'utf8');
  fs.renameSync(temporary, filePath);
  return fs.statSync(filePath);
}

async function renderBeautifiedImages({ workspaceRoot, htmlPath, outputDir }) {
  const script = path.join(workspaceRoot, 'skills', 'html-pages-to-images', 'index.js');
  await execFileAsync(process.execPath, [script, '--htmlFile', htmlPath, '--outputDir', outputDir, '--selector', '.page', '--pageWidth', '375', '--pageHeight', '667', '--deviceScaleFactor', '3'], {
    cwd: workspaceRoot, windowsHide: true, timeout: 120_000, maxBuffer: 2_000_000,
  });
  const images = fs.existsSync(outputDir)
    ? fs.readdirSync(outputDir).filter((name) => name.toLowerCase().endsWith('.png')).sort().map((name) => path.join(outputDir, name))
    : [];
  if (!images.length) throw new Error('AI 美化 HTML 未生成任何页面图片');
  return images;
}

export function validateAiVisualScreenshotSet(imagePaths, expectedPageCount) {
  const images = Array.isArray(imagePaths) ? imagePaths.filter(Boolean) : [];
  const expected = Number(expectedPageCount) || 0;
  const issues = [];
  if (images.length !== expected) issues.push(`截图数量不一致（应为 ${expected}，实际 ${images.length}）`);
  for (let index = 0; index < expected; index += 1) {
    const imagePath = images[index];
    const expectedName = `page-${String(index + 1).padStart(2, '0')}.png`;
    if (!imagePath || path.basename(imagePath).toLowerCase() !== expectedName) {
      issues.push(`缺少 ${expectedName}`);
      continue;
    }
    try {
      if (fs.statSync(imagePath).size <= 0) issues.push(`${expectedName} 文件为空`);
    } catch {
      issues.push(`${expectedName} 文件不存在`);
    }
  }
  return { valid: issues.length === 0, expectedPageCount: expected, pageCount: images.length, images, issues };
}

function buildAiVisualSkillPrompt({ workspaceRoot, requiredPageCount, styleBrief = '', skillBundle = null }) {
  const skill = skillBundle || loadSkillBundle({ workspaceRoot, skillName: AI_VISUAL_SKILL_NAME });
  if (skill.fallback || !skill.prompt.trim()) throw new Error(`技能缺失或被禁用：skills/${AI_VISUAL_SKILL_NAME}/SKILL.md 无法加载`);
  return skill.prompt
    .replaceAll('{{REQUIRED_PAGE_COUNT}}', String(requiredPageCount))
    .replaceAll('{{STYLE_BRIEF}}', String(styleBrief || '突出核心矛盾和关键事实，增加少量有语义的图标、徽章和箭头，保持清晰克制。').slice(0, 800));
}

function aiHtmlScaffold() {
  // 这里只建立文件容器，不注入主题 CSS、页面壳或任何视觉修补。
  // 主题表达、页面结构和组件样式必须由视觉 Agent 依据 prompt 生成。
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=375, initial-scale=1"></head><body data-render-mode="ai-visual"></body></html>';
}

async function runAiVisualScreenshotDeliveryOnly({
  workspaceRoot,
  workdir,
  htmlPath,
  outputDir,
  deliveryGatePath,
  copyPath,
  context,
  stageRecorder,
  generationAgent,
  lastModelResult,
  resolvedModel,
  provider,
  styleBrief,
  batchId,
  candidateId,
  store,
  skillManifest,
  onProgress,
  enableScreenshots,
  enableDeliveryGate,
}) {
  const generatedHtml = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
  const pageCount = htmlPageCount(generatedHtml);
  const screenshotsStage = stageRecorder.start('screenshots', {
    skill: 'html-pages-to-images',
    inputArtifacts: [SOCIAL_CARD_BEAUTIFY_HTML],
    outputArtifact: SOCIAL_CARD_BEAUTIFY_OUTPUT,
  });
  let imagePaths = [];
  let screenshotCheck = {
    valid: !enableScreenshots,
    expectedPageCount: context.requiredPageCount,
    pageCount: 0,
    images: [],
    issues: [],
  };
  const screenshotAttempts = [];
  if (!enableScreenshots) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    screenshotsStage.finish({ status: 'skipped', gate: 'skipped', detail: '截图开关关闭' });
    screenshotCheck.status = 'skipped';
  } else {
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(outputDir, { recursive: true });
    onProgress('根据 AI 视觉 HTML 生成逐页 PNG…');
    let screenshotFailure = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        if (attempt > 1) {
          fs.rmSync(outputDir, { recursive: true, force: true });
          fs.mkdirSync(outputDir, { recursive: true });
          onProgress(`截图失败，重试截图阶段（第 ${attempt} 次；不重新调用 AI）…`);
        }
        imagePaths = await renderBeautifiedImages({ workspaceRoot, htmlPath, outputDir });
        screenshotCheck = validateAiVisualScreenshotSet(imagePaths, context.requiredPageCount);
        screenshotAttempts.push({ attempt, status: screenshotCheck.valid ? 'passed' : 'blocked', pageCount: screenshotCheck.pageCount, issues: screenshotCheck.issues });
        if (screenshotCheck.valid) {
          screenshotFailure = null;
          break;
        }
        throw new Error(screenshotCheck.issues.join('；'));
      } catch (error) {
        screenshotFailure = error;
        if (attempt === 2) break;
      }
    }
    if (screenshotFailure) {
      fs.rmSync(outputDir, { recursive: true, force: true });
      screenshotsStage.fail(screenshotFailure, { detail: `PNG 截图失败（已重试 ${screenshotAttempts.length} 次）：${screenshotFailure.message}` });
      const failedDeliveryStage = stageRecorder.start('delivery-gate', {
        skill: 'fixed-program',
        inputArtifacts: [SOCIAL_CARD_BEAUTIFY_HTML, SOCIAL_CARD_BEAUTIFY_REPORT],
        outputArtifact: SOCIAL_CARD_BEAUTIFY_DELIVERY_GATE,
      });
      const failedGate = {
        schemaVersion: 1,
        status: enableDeliveryGate ? 'blocked' : 'skipped',
        registered: false,
        reason: 'screenshots-failed',
        checkedAt: new Date().toISOString(),
      };
      writeFile(deliveryGatePath, JSON.stringify(failedGate, null, 2));
      failedDeliveryStage.finish({ status: enableDeliveryGate ? 'blocked' : 'skipped', gate: enableDeliveryGate ? 'blocked' : 'skipped', detail: 'PNG 截图失败，未登记正式交付', metadata: { registered: false } });
      throw new Error(`AI 美化截图阶段失败：${screenshotFailure.message}。已重试截图，未重新调用 AI，未登记正式交付。`);
    }
    screenshotsStage.finish({ outputArtifact: SOCIAL_CARD_BEAUTIFY_OUTPUT, metadata: { imageCount: imagePaths.length, attempts: screenshotAttempts } });
    screenshotCheck.status = 'passed';
  }

  const htmlCheck = {
    valid: fs.existsSync(htmlPath) && pageCount === context.requiredPageCount,
    pageCount,
    issues: [
      ...(!fs.existsSync(htmlPath) ? ['AI 视觉 HTML 不存在'] : []),
      ...(pageCount !== context.requiredPageCount ? [`页面数量不一致（应为 ${context.requiredPageCount}，实际 ${pageCount}）`] : []),
    ],
  };
  const copyCheck = fs.existsSync(copyPath) ? validateSocialCardCopy(fs.readFileSync(copyPath, 'utf8')) : { valid: false, issues: ['copy.txt 不存在'] };
  const deliveryStage = stageRecorder.start('delivery-gate', {
    skill: 'fixed-program',
    inputArtifacts: [SOCIAL_CARD_BEAUTIFY_HTML, 'copy.txt', SOCIAL_CARD_BEAUTIFY_OUTPUT],
    outputArtifact: SOCIAL_CARD_BEAUTIFY_DELIVERY_GATE,
  });
  const deliveryValid = htmlCheck.valid && copyCheck.valid && (!enableScreenshots || screenshotCheck.valid);
  const deliveryGate = {
    schemaVersion: 1,
    status: enableDeliveryGate ? (deliveryValid ? 'passed' : 'blocked') : 'skipped',
    registered: false,
    checkedAt: new Date().toISOString(),
    checks: { html: htmlCheck, copy: copyCheck, screenshots: screenshotCheck },
    artifacts: { html: SOCIAL_CARD_BEAUTIFY_HTML, copy: 'copy.txt', screenshots: SOCIAL_CARD_BEAUTIFY_OUTPUT },
  };
  writeFile(deliveryGatePath, JSON.stringify(deliveryGate, null, 2));

  const report = {
    schemaVersion: 5,
    status: enableDeliveryGate ? (deliveryValid ? 'passed' : 'delivery-blocked') : enableScreenshots ? 'screenshots-passed' : 'generation-only',
    source: 'storyboard-theme-ai-visual',
    renderMode: 'full-html-agent',
    generatedAt: new Date().toISOString(),
    originalHtml: null,
    sourceStoryboard: 'ai-visual-card-plan.json',
    originalStoryboard: 'card-plan.json',
    beautifiedHtml: SOCIAL_CARD_BEAUTIFY_HTML,
    pageCount,
    storyboardPageCount: context.storyboardPageCount,
    theme: { id: context.theme.id, label: context.theme.label, version: context.theme.version, templatePack: context.theme.templatePack },
    styleBrief: String(styleBrief || '').slice(0, 800),
    changedByModel: true,
    modelSteps: generationAgent?.modelSteps || 0,
    toolCalls: generationAgent?.toolCalls || 0,
    agentRuns: {
      generation: { agentRunId: generationAgent?.agentRunId || null, modelSteps: generationAgent?.modelSteps || 0, toolCalls: generationAgent?.toolCalls || 0, pageCount: generationAgent?.pageCount || 0 },
    },
    screenshots: { status: screenshotCheck.status || 'skipped', expectedPageCount: context.requiredPageCount, pageCount: imagePaths.length, attempts: screenshotAttempts, issues: screenshotCheck.issues || [] },
    deliveryGate: { status: enableDeliveryGate ? (deliveryValid ? 'passed' : 'blocked') : 'skipped', registered: false, path: path.basename(deliveryGatePath) },
    model: { provider: lastModelResult?.provider || provider || '', model: lastModelResult?.model || resolvedModel, callId: lastModelResult?.callId || null },
    skillManifest: path.basename(skillManifest.path),
    stageExecutions: path.basename(stageRecorder.path),
  };
  writeFile(path.join(workdir, SOCIAL_CARD_BEAUTIFY_REPORT), JSON.stringify(report, null, 2));
  if (enableDeliveryGate && !deliveryValid) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    deliveryStage.finish({ status: 'blocked', gate: 'blocked', detail: '截图/HTML/copy 交付文件检查未通过，未登记正式交付', metadata: { registered: false } });
    throw new Error(`AI 美化交付门禁未通过：${[...htmlCheck.issues, ...copyCheck.issues, ...(screenshotCheck.issues || [])].join('；')}`);
  }
  if (!enableDeliveryGate) {
    deliveryStage.finish({ status: 'skipped', gate: 'skipped', detail: '交付门禁开关关闭，保留截图产物' });
  } else {
    deliveryGate.registered = true;
    writeFile(deliveryGatePath, JSON.stringify(deliveryGate, null, 2));
    report.deliveryGate = { status: 'passed', registered: true, path: path.basename(deliveryGatePath) };
    writeFile(path.join(workdir, SOCIAL_CARD_BEAUTIFY_REPORT), JSON.stringify(report, null, 2));
    deliveryStage.finish({ detail: 'AI 视觉 HTML、发布文案、PNG 和交付门禁已登记', metadata: { imageCount: imagePaths.length, deliveryGate: path.basename(deliveryGatePath), copy: 'copy.txt', registered: true } });
  }
  const registerArtifact = (kind, name, artifactPath) => {
    if (!fs.existsSync(artifactPath)) return;
    const stat = fs.statSync(artifactPath);
    store.upsertArtifact?.({ batchId, candidateId, track: 'social_cards', kind, name, path: artifactPath, size: stat.size, modifiedAt: stat.mtime.toISOString() });
  };
  registerArtifact('AI 视觉 HTML', SOCIAL_CARD_BEAUTIFY_HTML, htmlPath);
  registerArtifact('图文配套文案', 'copy.txt', copyPath);
  for (const artifactPath of [skillManifest.path, stageRecorder.path, deliveryGatePath]) registerArtifact('AI 视觉运行记录', path.basename(artifactPath), artifactPath);
  for (const imagePath of imagePaths) registerArtifact('AI 视觉 PNG', path.join(SOCIAL_CARD_BEAUTIFY_OUTPUT, path.basename(imagePath)), imagePath);
  return { html: SOCIAL_CARD_BEAUTIFY_HTML, outputDir: SOCIAL_CARD_BEAUTIFY_OUTPUT, images: imagePaths.map((item) => path.basename(item)), status: report.status };
}

function aiVisualDocumentWriteCatalogItem(registry) {
  const resolved = registry.resolve(AI_VISUAL_DOCUMENT_WRITE);
  const manifest = resolved?.manifest;
  if (!manifest) throw new Error(`缺少 AI 视觉分块写入能力：${AI_VISUAL_DOCUMENT_WRITE}`);
  return {
    capability: AI_VISUAL_DOCUMENT_WRITE,
    name: manifest.name || 'AI 视觉文档分块写入',
    description: '在当前候选目录内原样分块追加完整 HTML/CSS；不解析、不改写、不拼接视觉内容。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      // resourceId、path、sessionId 属于当前 AI 视觉运行上下文，由入口服务端注入；
      // 模型只需要决定写入操作和实际内容。
      required: ['operation'],
      properties: {
        resourceId: { type: 'string', enum: ['project:current'] },
        path: { type: 'string', enum: [SOCIAL_CARD_BEAUTIFY_HTML] },
        operation: { type: 'string', enum: ['begin', 'append', 'finish', 'abort'] },
        sessionId: { type: 'string', minLength: 1, maxLength: 120 },
        requestId: { type: 'string', minLength: 1, maxLength: 120 },
        expectedRevision: { type: 'integer', minimum: 0 },
        content: { type: 'string', maxLength: 12_000 },
      },
    },
    implementations: [{ plugin: manifest.id, version: manifest.version, riskLevel: manifest.riskLevel }],
  };
}

export async function runSocialCardBeautify({ gateway, store, batchId, candidateId, provider, workspaceRoot, onProgress = () => {}, onEvent = () => {}, styleBrief = '', enableAiVisualScreenshots = ENABLE_AI_VISUAL_SCREENSHOTS, enableAiVisualDeliveryGate = ENABLE_AI_VISUAL_DELIVERY_GATE }) {
  const aiVisualScreenshotsEnabled = enableAiVisualScreenshots === true;
  const aiVisualDeliveryGateEnabled = enableAiVisualDeliveryGate === true;
  const batch = store.getBatch(batchId);
  const candidate = store.getCandidate(candidateId);
  if (!batch || !candidate) throw new Error('图文候选不存在');
  const workdir = candidateSocialCardDir(workspaceRoot, batch, candidate);
  const originalPath = path.join(workdir, 'my-design.html');
  const originalHtml = fs.existsSync(originalPath) ? fs.readFileSync(originalPath, 'utf8') : '';
  const editorial = store.getCardEditorial?.(candidateId) || {};
  syncAiThemeSnapshot({ workdir, store, editorial, candidate });
  const context = buildBeautifyContext({ workdir, original: originalHtml, candidate, editorial });
  if (!context.storyboardPageCount) throw new Error('请先生成故事板，再使用 AI 视觉生成');

  const baseline = writeSocialCardAiVisualBaseline({
    workdir,
    candidateId,
    batchId,
    contentType: context.contentType,
    channelMode: context.channelMode,
    themeId: context.theme?.id,
    requiredPageCount: context.requiredPageCount,
    storyboardPageCount: context.storyboardPageCount,
  });
  store.upsertArtifact?.({
    batchId,
    candidateId,
    track: 'social_cards',
    kind: 'AI 视觉基线',
    name: 'ai-visual-baseline.json',
    path: baseline.path,
    size: fs.statSync(baseline.path).size,
    modifiedAt: fs.statSync(baseline.path).mtime.toISOString(),
  });
  const stageRecorder = createSocialCardAiVisualStageRecorder({ workdir, batchId, candidateId });
  const factFile = factFileForContentType(context.contentType);
  const workspaceFilesBeforeCopy = canonicalAiVisualWorkspaceFiles(factFile).filter((file) => file !== 'copy.txt');
  const inputsStage = stageRecorder.start('inputs', {
    skill: 'fixed-program',
    inputArtifacts: workspaceFilesBeforeCopy,
    outputArtifact: 'ai-visual-card-plan.json',
  });

  onProgress('准备数据库故事板、原始事实和主题设计规范…');
  let editorialPages = [];
  try { editorialPages = JSON.parse(editorial.card_plan_json || '[]'); } catch {}
  if (!Array.isArray(editorialPages) || !editorialPages.length) throw new Error('数据库故事板为空，请先重新生成故事板');
  const sourcePlan = {
    schemaVersion: 1,
    topic: String(candidate?.angle || candidate?.thesis || ''),
    channel_mode: context.channelMode,
    content_type: context.contentType,
    pages: editorialPages,
  };
  // 故事板的权威来源是 card_editorial_sessions.card_plan_json。这里落盘只是给
  // 文件型 Agent 读取，不依赖程序化图文 Pipeline 预先生成 card-plan.json。
  writeFile(path.join(workdir, 'card-plan.json'), JSON.stringify(sourcePlan, null, 2));

  if (!fs.existsSync(path.join(workdir, factFile))) throw new Error(`AI 视觉生成缺少原始事实文件：${factFile}`);
  const aiVisualPlanPath = path.join(workdir, 'ai-visual-card-plan.json');
  const aiVisualPlan = buildAiVisualCardPlan(sourcePlan);
  writeFile(aiVisualPlanPath, JSON.stringify(aiVisualPlan, null, 2));
  const themeSpecSource = path.join(workspaceRoot, 'themes', 'social', context.theme.id, 'AI_DESIGN_SPEC.md');
  const themeSpecCandidatePath = path.join(workdir, 'social-theme-design-spec.md');
  if (!fs.existsSync(themeSpecSource)) throw new Error(`AI 视觉生成缺少主题设计规范：${context.theme.id}/AI_DESIGN_SPEC.md`);
  writeFile(themeSpecCandidatePath, fs.readFileSync(themeSpecSource, 'utf8'));
  const htmlPath = path.join(workdir, SOCIAL_CARD_BEAUTIFY_HTML);
  const outputDir = path.join(workdir, SOCIAL_CARD_BEAUTIFY_OUTPUT);
  // 新一轮 AI 视觉生成开始前清理旧 PNG 和旧运行报告，避免人工看到上一轮残留结果。
  fs.rmSync(outputDir, { recursive: true, force: true });
  for (const staleReport of [path.join(workdir, SOCIAL_CARD_BEAUTIFY_REPORT)]) {
    fs.rmSync(staleReport, { force: true });
  }
  writeFile(htmlPath, aiHtmlScaffold(context));

  const resources = new Map();
  registerProjectResource(resources, workdir);
  const registry = await getToolRegistry();
  const baseCatalog = applyCatalogSchemas(
    buildConversationToolCatalog({ registry, entryCapabilities: [SOCIAL_CARD_PROJECT_READ_CAPABILITY] }),
    [SOCIAL_CARD_PROJECT_READ_CAPABILITY],
    workspaceRoot,
  );
  const catalog = [...baseCatalog.filter((item) => item.capability === SOCIAL_CARD_PROJECT_READ_CAPABILITY), aiVisualDocumentWriteCatalogItem(registry)];
  const visualSkillBundle = loadSkillBundle({ workspaceRoot, skillName: AI_VISUAL_SKILL_NAME });
  const screenshotSkillBundle = loadSkillBundle({ workspaceRoot, skillName: 'html-pages-to-images' });
  const copySkillBundle = loadSkillBundle({ workspaceRoot, skillName: 'xiaohongshu-article-generator' });
  if (visualSkillBundle.fallback || !visualSkillBundle.prompt.trim()) throw new Error(`技能缺失或被禁用：skills/${AI_VISUAL_SKILL_NAME}/SKILL.md 无法加载`);
  const missingVisualReferences = AI_VISUAL_BUNDLED_REFERENCE_FILES.filter((referenceName) => !hasBundledVisualReference(visualSkillBundle, referenceName));
  if (missingVisualReferences.length) throw new Error(`AI 视觉生成缺少技能内置参考：${missingVisualReferences.join('、')}`);
  if (copySkillBundle.fallback || !copySkillBundle.prompt.trim()) throw new Error('技能缺失或被禁用：skills/xiaohongshu-article-generator/SKILL.md 无法加载');
  const skillRuntime = await prepareSkillRun({
    gateway,
    store,
    batchId,
    candidateId,
    purpose: 'social-card-ai-visual',
    bundles: [visualSkillBundle, screenshotSkillBundle, copySkillBundle],
    provider,
    selection: {
      entryPoint: 'social-card-ai-visual',
      stages: { copy: 'xiaohongshu-article-generator', generation: AI_VISUAL_SKILL_NAME, screenshots: 'html-pages-to-images' },
    },
  });
  gateway = bindGenerationSnapshot(gateway, skillRuntime.snapshotId);
  provider = skillRuntime.provider;
  const providerId = provider || gateway.config?.defaultProvider || '';
  const providerMaxOutputTokens = Number(skillRuntime.providerConfig?.maxOutputTokens || skillRuntime.providerConfig?.provider?.maxOutputTokens) || 7000;
  const resolvedModel = skillRuntime.providerConfig?.model || skillRuntime.providerConfig?.provider?.model || '';
  const skillManifest = writeSocialCardAiVisualSkillManifest({ workdir, runtime: skillRuntime, bundles: skillRuntime.bundles, catalog });
  inputsStage.finish({
    outputArtifact: aiVisualPlanPath,
    detail: `已生成 AI 视觉精简故事板，并冻结 ${skillRuntime.snapshotId || '当前运行'} 的技能、模型和工具快照`,
    metadata: { snapshotId: skillRuntime.snapshotId, provider, model: resolvedModel, skillManifest: skillManifest.path },
  });
  const copyStage = stageRecorder.start('copy', {
    skill: 'xiaohongshu-article-generator',
    inputArtifacts: ['card-plan.json', factFile],
    outputArtifact: 'copy.txt',
  });
  const copyPath = path.join(workdir, 'copy.txt');
  try {
    const factDocument = readJsonFile(path.join(workdir, factFile), {});
    const factData = context.contentType === 'event' ? (factDocument.analysis || factDocument) : (factDocument.data || factDocument);
    const copyResult = await generateSocialCardCopy({
      gateway,
      provider,
      providerConfig: skillRuntime.providerConfig,
      batchId,
      candidateId,
      skillPrompt: skillRuntime.bundles.find((bundle) => bundle.skillName === 'xiaohongshu-article-generator')?.prompt || copySkillBundle.prompt,
      channelMode: context.channelMode,
      topic: candidate.hotspot_title,
      contentType: context.contentType,
      storyboardClass: context.contentType === 'event' ? socialStoryboardClassForContentClass(candidate.content_class) : undefined,
      factData,
      sourceUrl: factDocument.sourceUrl || factDocument.source_url || '',
      eventAnalysis: context.contentType === 'event' ? factData : null,
      editorial,
      cardPlan: editorialPages,
      disclosure: context.contentType === 'event' ? '据公开素材整理；未核实主张必须保留边界表达' : context.contentType === 'custom' ? '体验性表述来自作者确认；建议性内容未实测' : '基于项目文档整理，未实际运行',
    });
    const copyCheck = validateSocialCardCopy(copyResult.copy);
    if (!copyCheck.valid) throw new Error(`配套文案门禁未通过：${copyCheck.issues.join('；')}`);
    writeFile(copyPath, copyResult.copy);
    copyStage.finish({
      outputArtifact: 'copy.txt',
      detail: `已生成配套发布文案（${copyCheck.tagCount} 个话题标签）`,
      metadata: { purpose: 'social-card-copy', tagCount: copyCheck.tagCount },
    });
    store.upsertArtifact?.({ batchId, candidateId, track: 'social_cards', kind: '图文配套文案', name: 'copy.txt', path: copyPath, size: fs.statSync(copyPath).size, modifiedAt: fs.statSync(copyPath).mtime.toISOString() });
  } catch (error) {
    copyStage.fail(error);
    throw error;
  }
  const workspaceFiles = canonicalAiVisualWorkspaceFiles(factFile);
  // 文案生成完成后再构造 render_request，确保模型首条消息与实际读取清单完全一致。
  const renderRequest = buildAiRenderRequest(context, { workspaceResourceId: 'project:current', workspaceFiles });
  const resolveAiArguments = async (argumentsValue, request) => {
    const args = argumentsValue && typeof argumentsValue === 'object' ? argumentsValue : {};
    if (request.capability === AI_VISUAL_DOCUMENT_WRITE) {
      const { resourceId: _resourceId, path: _path, sessionId: _sessionId, ...documentArgs } = args;
      // ToolRequest 的 requestId 是 Agent 本轮调用的幂等键。模型通常只在
      // 外层信封提供它，应用层必须传给文档插件，否则 append 会被插件当成
      // 缺少 requestId 而拒绝，且内容不会落盘。
      if (String(documentArgs.operation || '') === 'append' && !String(documentArgs.requestId || '').trim()) {
        documentArgs.requestId = String(request.requestId || '').trim();
      }
      // resourceId 只用于 Agent 层的能力路由，不属于文档写入插件的实际入参；
      // 插件只接收 path、sessionId 以及 operation/content/revision 等写入字段。
      return { ...documentArgs, path: htmlPath, sessionId: documentWriteSessionId };
    }
    return resolveResourceArguments(args, request, { resources, workspaceRoot });
  };
  const generationCatalog = [...baseCatalog.filter((item) => item.capability === SOCIAL_CARD_PROJECT_READ_CAPABILITY), aiVisualDocumentWriteCatalogItem(registry)];
  const generationSystem = `${buildAiVisualSkillPrompt({ workspaceRoot, requiredPageCount: context.requiredPageCount, styleBrief, skillBundle: skillRuntime.bundles.find((bundle) => bundle.skillName === AI_VISUAL_SKILL_NAME) || visualSkillBundle })}${buildAiVisualGenerationBrief({ context, workspaceFiles, styleBrief })}\n\n当前可用工具目录：${JSON.stringify(generationCatalog)}`;
  const generationStage = stageRecorder.start('generation', {
    skill: AI_VISUAL_SKILL_NAME,
    inputArtifacts: workspaceFiles,
    outputArtifact: SOCIAL_CARD_BEAUTIFY_HTML,
    metadata: { agentEntryPoint: 'social-card-ai-visual-generation', auditToolsVisible: false },
  });
  let generationAgent;
  const documentWriteSessionId = createAiVisualDocumentWriteSessionId(batchId, candidateId);
  try {
    generationAgent = await runSocialCardAiVisualGenerationAgent({
      gateway,
      store,
      batchId,
      candidateId,
      provider,
      registry,
      catalog: generationCatalog,
      agentSystem: generationSystem,
      renderRequest,
      workspaceFiles,
      requiredPageCount: context.requiredPageCount,
      getPageCount: () => htmlPageCount(fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : ''),
      documentWriteSessionId,
      resolveArguments: resolveAiArguments,
      sanitizeToolResult: (toolResult, request) => sanitizeCapabilityResult(toolResult, request),
      toolContext: { batchId, candidateId, skillId: AI_VISUAL_SKILL_NAME, provider: providerId, workspaceRoot, allowedRoots: [workdir], allowedCapabilities: [SOCIAL_CARD_PROJECT_READ_CAPABILITY, AI_VISUAL_DOCUMENT_WRITE] },
      maxOutputTokens: providerMaxOutputTokens,
      onProgress,
      onEvent,
    });
    const generatedHtml = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
    const generatedPageCount = htmlPageCount(generatedHtml);
    const generationCheck = validateAiVisualGenerationCompletion({
      agent: generationAgent,
      generatedPageCount,
      requiredPageCount: context.requiredPageCount,
    });
    if (!generationCheck.valid) {
      const error = new Error(`AI 视觉生成未完成：${generationCheck.issues.join('；')}。未进入截图阶段。`);
      generationStage.fail(error, {
        detail: error.message,
        metadata: {
          agentRunId: generationAgent?.agentRunId || null,
          agentType: generationAgent?.type || null,
          modelSteps: generationAgent?.modelSteps || 0,
          toolCalls: generationAgent?.toolCalls || 0,
          pageCount: generatedPageCount,
          documentFinished: generationAgent?.documentFinished === true,
        },
      });
      throw error;
    }
    generationStage.finish({
      status: 'completed',
      detail: `已独立写入 ${generatedPageCount}/${context.requiredPageCount} 页`,
      metadata: {
        agentRunId: generationAgent.agentRunId || null,
        agentType: generationAgent.type || null,
        modelSteps: generationAgent.modelSteps || 0,
        toolCalls: generationAgent.toolCalls || 0,
        pageCount: generatedPageCount,
        documentFinished: generationAgent.documentFinished === true,
      },
    });
  } catch (error) {
    generationStage.fail(error);
    throw error;
  }
  return runAiVisualScreenshotDeliveryOnly({
    workspaceRoot,
    workdir,
    htmlPath,
    outputDir,
    deliveryGatePath: path.join(workdir, SOCIAL_CARD_BEAUTIFY_DELIVERY_GATE),
    copyPath,
    context,
    stageRecorder,
    generationAgent,
    lastModelResult: generationAgent.lastModelResult || null,
    resolvedModel,
    provider,
    styleBrief,
    batchId,
    candidateId,
    store,
    skillManifest,
    onProgress,
    enableScreenshots: aiVisualScreenshotsEnabled,
    enableDeliveryGate: aiVisualDeliveryGateEnabled,
  });

}
