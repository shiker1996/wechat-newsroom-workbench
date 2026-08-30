import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildImagesMarkdown, imageManifestFile, parseImagePlaceholders, registerGeneratedImageAssets, registerGeneratedSlotImage, uploadImageToCdn } from './image-workflow.mjs';
import { generateArticleImage } from './article-image-generator.mjs';
import { loadSkillBundle } from '../../../platform/llm/skill-runtime.mjs';
import { batchArticlesDir, candidateArticleDir } from '../../../platform/core/workspace-paths.mjs';
import { executeCapability } from '../../../platform/tools/capability-runtime.mjs';
import { createStoreExecutionLogger } from '../../../platform/tools/execution-log.mjs';

// capability-call: diagram.mermaid.render, diagram.echarts.render
import { bindGenerationSnapshot, prepareSkillRun } from '../../../platform/skills/pipeline-runtime.mjs';
import { parseModelJson } from '../../../platform/llm/model-json.mjs';
import { articleThemeCompatibilityView, articleThemeDefinition, compileArticleTheme } from '../../../shared/themes/article-theme-compiler.mjs';
import { resolveWorkspaceTheme } from '../../../platform/application/themes/user-theme-service.mjs';
import { defaultTypesetTheme, enforceWechatFlowLayout, extractHtmlModelOutput, htmlPreservesStructure } from '../../../shared/rendering/typeset-output.mjs';
import { markdownToHtml, normalizeDesignTokens } from '../../../shared/rendering/markdown-renderer.mjs';
import { resolveAutoTheme } from '../../../platform/application/themes/auto-theme-router.mjs';

export { defaultTypesetTheme, enforceWechatFlowLayout, extractHtmlModelOutput, htmlPreservesStructure } from '../../../shared/rendering/typeset-output.mjs';
export { markdownToHtml } from '../../../shared/rendering/markdown-renderer.mjs';

const execFileAsync = promisify(execFile);

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, String(content).trimEnd() + '\n', 'utf8');
  fs.renameSync(temp, filePath);
  return fs.statSync(filePath);
}

function addArtifact(store, batchId, kind, name, filePath) {
  const stat = fs.statSync(filePath);
  store.upsertArtifact({ batchId, kind, name, path: filePath, size: stat.size, modifiedAt: stat.mtime.toISOString() });
}

function parseJson(result, store) {
  return parseModelJson(result,{store,label:'排版设计'});
}

const TYPESET_SKILLS = [
  'wechat-article-typeset', 'wechat-md-render', 'magazine-design-advisor',
  'mermaid-render', 'wechat-echarts-blocks-to-images',
  'wechat-md-to-draft', 'wechat-html-normalizer',
  'wechat-html-check-no-div',
];

export const TYPESET_STAGE_CONTRACT = Object.freeze([
  { id:'rendered', skill:'wechat-md-render' },
  { id:'design', skill:'magazine-design-advisor' },
  { id:'images', skill:'wechat-article-typeset' },
  { id:'draft', skill:'wechat-md-to-draft' },
  { id:'normalized', skill:'wechat-html-normalizer' },
  { id:'gate', skill:'wechat-html-check-no-div' },
]);

function loadTypesetSkills(workspaceRoot) {
  const bundles = Object.fromEntries(TYPESET_SKILLS.map((name) => [name, loadSkillBundle({ workspaceRoot, skillName:name })]));
  const required = ['wechat-article-typeset', 'wechat-md-render', 'magazine-design-advisor', 'wechat-md-to-draft', 'wechat-html-normalizer', 'wechat-html-check-no-div'];
  const missing = required.filter((name) => bundles[name].fallback);
  if (missing.length) throw new Error(`项目排版技能缺失：${missing.join('、')}，请检查 skills 目录`);
  return bundles;
}

function skillScript(bundle, ...segments) {
  const script = path.join(bundle.root, bundle.skillName, ...segments);
  if (!fs.existsSync(script)) throw new Error(`技能 ${bundle.skillName} 缺少执行脚本：${segments.join('/')}`);
  return script;
}

function writeExecutionFiles(workdir, bundles, stages) {
  const manifest = Object.fromEntries(Object.entries(bundles).map(([name, bundle]) => [name, {
    hash: bundle.hash, files: bundle.files.map((file) => path.relative(workdir, file)), fallback: bundle.fallback,
  }]));
  writeFile(path.join(workdir, 'typeset-skill-manifest.json'), JSON.stringify(manifest, null, 2));
  writeFile(path.join(workdir, 'typeset-stage-executions.json'), JSON.stringify(stages, null, 2));
}

// 兼容旧调用方的只读视图；生产主题来源已经切换为 themes/article/*.json。
export const TYPESET_THEMES = articleThemeCompatibilityView();



async function runScript(script, args, cwd) {
  try {
    return await execFileAsync(process.execPath, [script, ...args], { cwd, windowsHide: true, timeout: 120000, maxBuffer: 2_000_000 });
  } catch (error) {
    throw new Error(String(error.stderr || error.stdout || error.message).trim());
  }
}

export async function runTypesetPipeline({ gateway, store, batchId, candidateId, documentKind = null, provider, workspaceRoot, skillsWorkspaceRoot = workspaceRoot, snapshotId=null, draftMode = 'deterministic', theme = 'auto', autoUploadGeneratedImages = true, onProgress = () => {}, generateArticleImageFn = generateArticleImage, uploadImageToCdnFn = uploadImageToCdn }) {
  const candidate = candidateId==null?null:store.getCandidate(candidateId);
  const daily=documentKind==='daily-final';
  if ((!daily&&(!candidate||candidate.batch_id!==batchId))||(daily&&candidate)) throw new Error('待排版文稿不存在或不属于当前批次');
  let themeRouting = null;
  // auto 先由 AI 给出候选排序，再按近期使用情况受控轮换；AI 不可用时回退原有类型映射。
  if (theme === 'auto' || !theme) {
    themeRouting = await resolveAutoTheme({
      gateway, provider, store, batchId, candidateId, target: 'article',
      context: daily ? { title: '批次早报', category: '📰 综合资讯', contentType: 'daily' } : {
        title: candidate?.hotspot_title, category: candidate?.category, angle: candidate?.angle,
        thesis: candidate?.thesis, contentType: candidate?.content_route || 'article', composite: Boolean(candidate?.composite),
      },
      log: onProgress,
    });
    theme = themeRouting?.themeId || defaultTypesetTheme(daily ? { category: '📰 综合资讯' } : candidate);
  }
  const themeDefinition=resolveWorkspaceTheme(store,theme,'article')||articleThemeDefinition(theme,{fallback:false});
  if (!themeDefinition) throw new Error(`未知排版主题：${theme}（可选：auto、${Object.keys(TYPESET_THEMES).join('、')}）`);
  const compiledTheme=compileArticleTheme(themeDefinition);
  store.recordThemeUsage?.({themeId:themeDefinition.id,version:themeDefinition.version,target:'article',source:themeDefinition.source,batchId,candidateId});
  const batch = store.getBatch(batchId);
  const workdir = daily?path.join(batchArticlesDir(workspaceRoot,batch),'daily'):candidateArticleDir(workspaceRoot, batch, candidate);
  const finalPath = daily?path.join(workdir,'03-FINAL.md'):path.join(workdir, '09-FINAL.md');
  if (!fs.existsSync(finalPath)) throw new Error(`缺少 ${path.basename(finalPath)}，请先保存终稿`);
  const themeSnapshotPath=path.join(workdir,'article-theme-snapshot.json');
  writeFile(themeSnapshotPath,JSON.stringify({schemaVersion:1,id:themeDefinition.id,label:themeDefinition.label,version:themeDefinition.version,source:themeDefinition.source,hash:themeDefinition.hash,autoRouting:themeRouting},null,2));
  const skills = loadTypesetSkills(skillsWorkspaceRoot);
  const typesetRuntime=await prepareSkillRun({gateway,store,batchId,candidateId,purpose:'typeset',bundles:Object.values(skills),provider,snapshotId});
  gateway=bindGenerationSnapshot(gateway,typesetRuntime.snapshotId);
  provider=typesetRuntime.provider;
  const stages = [];
  const record = (stage, skill, output, status = 'completed', detail = '') => {
    const expected = TYPESET_STAGE_CONTRACT[stages.length];
    if (!expected || expected.id !== stage || expected.skill !== skill) {
      throw new Error(`排版契约阶段不一致：期望 ${expected?.id || '结束'}/${expected?.skill || '-'}，实际 ${stage}/${skill}`);
    }
    stages.push({ stage, skill, skillHash:skills[skill]?.hash || '', output, status, detail, completedAt:new Date().toISOString() });
    writeExecutionFiles(workdir, skills, stages);
  };
  const renderedPath = path.join(workdir, '09-FINAL.rendered.md');
  onProgress('排版 1/6：按总契约执行 wechat-md-render');
  await runScript(skillScript(skills['wechat-md-render'], 'scripts', 'md-render.js'), [finalPath, renderedPath], workdir);
  if (!fs.readFileSync(renderedPath, 'utf8').trim()) throw new Error('预渲染结果为空');
  record('rendered', 'wechat-md-render', renderedPath);
  addArtifact(store, batchId, '预渲染文章', path.basename(renderedPath), renderedPath);

  const providerConfig = typesetRuntime.providerConfig;
  onProgress('排版 2/6：按总契约执行 magazine-design-advisor');
  const designResult = await gateway.complete({ provider, purpose: 'magazine-design', batchId, candidateId, jsonMode: true,
    maxOutputTokens: Math.min(3200, providerConfig.maxOutputTokens), messages: [
      { role: 'system', protected: true, content: `${skills['wechat-article-typeset'].prompt}\n\n## 当前阶段子技能\n${skills['magazine-design-advisor'].prompt}\n\n执行契约：当前只执行 design 阶段，只返回 JSON，不得改写正文。格式为 {"schemeMarkdown":"完整 Markdown 设计方案","tokens":{"schema_version":1,"colors":{"background":"#FFFFFF","text":"#222222","muted":"#666666","accent":"#B42318"},"typography":{"body_px":16,"line_height":1.75,"h2_px":24},"spacing":{"section_px":28,"paragraph_px":14},"image":{"radius_px":0,"caption_px":13}}}。` },
      { role: 'user', protected: true, content: fs.readFileSync(renderedPath, 'utf8').slice(0, 16000) },
    ] });
  const design = parseJson(designResult, store);
  const schemePath = path.join(workdir, '09-FINAL.design-scheme.md');
  const tokensPath = path.join(workdir, 'magazine-design-tokens.json');
  writeFile(schemePath, design.schemeMarkdown || '# 杂志设计方案\n\n克制、清晰、移动端优先。');
  const htmlTokens = normalizeDesignTokens(design.tokens);
  writeFile(tokensPath, JSON.stringify(htmlTokens, null, 2));
  const chartTokensPath = path.join(workdir, 'chart-design-tokens.json');
  // 文章主题的完整颜色契约用于正文、结构化卡片和图表；设计模型只补充排版节奏，
  // 不应让它的简化颜色结果把 surface/line/accentSecondary 覆盖成另一套视觉语言。
  const themeColors = themeDefinition.tokens.colors;
  const chartThemeColors=themeDefinition.tokens.colors;
  const articleRenderTokens={...compiledTheme.tokens,...htmlTokens,colors:{...(htmlTokens.colors||{}),...themeColors},theme,themeDefinition};
  writeFile(chartTokensPath, JSON.stringify({ ...htmlTokens, colors:{ ...(htmlTokens.colors || {}), ...chartThemeColors }, theme, themeVersion:themeDefinition.version, themeHash:themeDefinition.hash }, null, 2));
  record('design', 'magazine-design-advisor', `${schemePath};${tokensPath}`);
  addArtifact(store, batchId, '杂志设计方案', path.basename(schemePath), schemePath);
  addArtifact(store, batchId, '杂志设计 Tokens', path.basename(tokensPath), tokensPath);
  addArtifact(store, batchId, '文章主题快照', path.basename(themeSnapshotPath), themeSnapshotPath);

  const rendered = fs.readFileSync(renderedPath, 'utf8');
  onProgress('排版 3/6：按总契约处理图片和显式视觉模块');
  // Mermaid / ECharts 围栏由确定性脚本渲染为本地 PNG 并替换为图片引用；
  // 渲染失败的围栏保留原文并报错，绝不静默丢图
  const chartSteps = [
    [/```\s*mermaid\b/i, 'diagram.mermaid.render', 'Mermaid', '09-FINAL.mermaid.md'],
    [/```\s*echarts\b/i, 'diagram.echarts.render', 'ECharts', '09-FINAL.echarts.md'],
  ];
  const chartNotes = [];
  let chartReadyPath = renderedPath;
  for (const [pattern, capability, label, fileName] of chartSteps) {
    if (!pattern.test(fs.readFileSync(chartReadyPath, 'utf8'))) continue;
    const chartPath = path.join(workdir, fileName);
    let chartReport = null;
    const toolResult = await executeCapability({consumerId:'feature.wechat-typeset',capability,input:{
      inputPath:chartReadyPath, outputPath:chartPath, imageDir:path.join(workdir, 'images'), tokensPath:chartTokensPath,
    },context:{allowedRoots:[workdir],allowedCapabilities:typesetRuntime.allowedCapabilities,cwd:workdir,timeoutMs:180000,executionLog:createStoreExecutionLogger(store,{batchId,candidateId,generationSnapshotId:typesetRuntime.snapshotId,skillId:'wechat-article-typeset'})}});
    if (toolResult.status === 'error') {
      const detail = toolResult.error.message;
      record('images', 'wechat-article-typeset', '', 'blocked', `${label} 渲染失败：${detail}`);
      throw new Error(`${label} 图表渲染失败，已停止排版以避免丢图：${detail}`);
    }
    chartReport = toolResult.data;
    chartReadyPath = chartPath;
    const generatedWorkspace = registerGeneratedImageAssets(workdir, label, chartReport.images || []);
    const generatedPaths = new Set((chartReport.images || []).map((item) => String(item).replaceAll('\\', '/')));
    const pendingUploads = generatedWorkspace.items.filter((item) =>
      item.generated && generatedPaths.has(String(item.relativePath || '').replaceAll('\\', '/')) && item.status !== 'cdn');
    for (const item of autoUploadGeneratedImages ? pendingUploads : []) {
      onProgress(`排版 3/6：${label} 图片已更新，正在上传 CDN`);
      await uploadImageToCdn(workdir, item.id, { authorizedExternalWrite:true, allowedCapabilities:typesetRuntime.allowedCapabilities,
        store,batchId,candidateId,generationSnapshotId:typesetRuntime.snapshotId,skillId:'wechat-article-typeset' });
    }
    addArtifact(store, batchId, `${label} 转图文章`, path.basename(chartPath), chartPath);
    chartNotes.push(`${label} ${chartReport.converted} 张${pendingUploads.length ? '（已重新上传 CDN）' : '（内容未变，复用 CDN）'}`);
  }
  // 统计卡/时间线与 Mermaid/ECharts 走同一条排版期生成链：每次排版都按当前主题
  // 重新截图，随后自动上传 CDN，工作台不再要求逐张点击“生成图片”。
  const structuredImages = parseImagePlaceholders(fs.readFileSync(chartReadyPath, 'utf8')).filter((item) => item.generate);
  for (const item of structuredImages) {
    const label = item.generate.kind === 'timeline' ? '时间线' : '统计卡';
    try {
      onProgress(`排版 3/6：${label}「${item.content}」按当前主题生成`);
      const generated = await generateArticleImageFn({
        workspaceRoot, workdir, slotId:item.id, generate:item.generate, ratio:item.ratio,
        theme, tokens:articleRenderTokens,
      });
      registerGeneratedSlotImage(workdir, item.id, generated.localPath);
      if (autoUploadGeneratedImages) {
        onProgress(`排版 3/6：${label}「${item.content}」图片已更新，正在上传 CDN`);
        await uploadImageToCdnFn(workdir, item.id, { authorizedExternalWrite:true, allowedCapabilities:typesetRuntime.allowedCapabilities,
          store,batchId,candidateId,generationSnapshotId:typesetRuntime.snapshotId,skillId:'wechat-article-typeset' });
      }
      chartNotes.push(`${label} 1 张（按 ${theme} 主题生成${autoUploadGeneratedImages ? '并已上传 CDN' : ''}）`);
    } catch (error) {
      record('images', 'wechat-article-typeset', '', 'blocked', `${label} 生成失败：${error.message}`);
      throw new Error(`${label} 图片生成失败，已停止排版以避免使用旧图：${error.message}`);
    }
  }
  const imageResult = buildImagesMarkdown(workdir, fs.readFileSync(chartReadyPath, 'utf8'));
  if (imageResult.unresolved.length) throw new Error(`配图尚未就绪：${imageResult.unresolved.join('、')}，请先提供图片并上传 CDN`);
  const imagesPath = path.join(workdir, '09-FINAL.images.md');
  writeFile(imagesPath, imageResult.content);
  addArtifact(store, batchId, '图片就绪文章', path.basename(imagesPath), imagesPath);
  const manifestPath = imageManifestFile(workdir);
  if (fs.existsSync(manifestPath)) addArtifact(store, batchId, '配图资产清单', path.basename(manifestPath), manifestPath);
  record('images', 'wechat-article-typeset', imagesPath, 'completed', chartNotes.length ? `显式视觉模块已转图并使用 CDN 地址：${chartNotes.join('、')}` : '最终 HTML 图片均已取得可公开访问的 HTTPS 地址');

  onProgress('排版 4/6：按总契约执行 wechat-md-to-draft');
  const draftHtml = path.join(workdir, 'article.ai.draft.html');
  let draftDetail;
  // 默认确定性渲染：HTML 拼装是机械工作，直接按 tokens 输出内联样式，
  // 不调用模型，也就不存在结构保真回退。draftMode 'llm' 保留旧路径用于实验对比。
  if (draftMode === 'llm') {
    const htmlGenSystem = `${skills['wechat-article-typeset'].prompt}\n\n## 当前阶段子技能\n${skills['wechat-md-to-draft'].prompt}\n\n执行契约：当前只执行 draft 阶段，只输出 UTF-8 HTML，不附说明或 Markdown 围栏。严格保留正文、标题、数字、来源、链接、图片与章节顺序；样式只能来自给定 tokens。`;
    const { provider: providerConfig2 } = gateway.resolve(provider);
    const htmlGenResult = await gateway.complete({ provider, purpose: 'typeset-html', batchId, candidateId,
      maxOutputTokens: Math.min(8000, providerConfig2.maxOutputTokens), messages: [
        { role: 'system', content: htmlGenSystem, protected: true },
        { role: 'user', content: JSON.stringify({
          designScheme: fs.readFileSync(schemePath, 'utf8'), tokens: htmlTokens, markdown: imageResult.content,
        }), protected: true },
      ] });
    const htmlContent = extractHtmlModelOutput(htmlGenResult.content);
    // If AI output lacks basic HTML structure, fallback to deterministic converter
    const useModelHtml = /<\/?h[1-3]/i.test(htmlContent) && htmlPreservesStructure(imageResult.content, htmlContent);
    writeFile(draftHtml, enforceWechatFlowLayout(useModelHtml ? htmlContent : markdownToHtml(imageResult.content, articleRenderTokens)));
    draftDetail = useModelHtml ? '模型初稿通过结构保真门禁' : '模型初稿不合格，使用确定性转换器';
  } else {
    // 眉题取账号名（没有账号配置时省略）；主题 tokens 作底色，LLM tokens 叠加覆盖
    let kicker = '';
    try { kicker = String(JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'account-context.json'), 'utf8')).name || '').trim(); } catch { /* 无账号配置 */ }
    writeFile(draftHtml, markdownToHtml(imageResult.content, { ...articleRenderTokens, kicker }));
    draftDetail = `确定性渲染：主题 ${theme}@${themeDefinition.version}（${themeDefinition.hash}），按 JSON 主题和 design tokens 输出内联样式，未调用模型`;
  }
  if (!htmlPreservesStructure(imageResult.content, fs.readFileSync(draftHtml, 'utf8'))) throw new Error('HTML 初稿未完整保留标题、章节、链接或图片');
  record('draft', 'wechat-md-to-draft', draftHtml, 'completed', draftDetail);
  addArtifact(store, batchId, 'HTML 初稿', path.basename(draftHtml), draftHtml);

  onProgress('排版 5/6：按总契约执行 wechat-html-normalizer');
  const finalHtml = path.join(workdir, 'article.ai.html');
  if (draftMode === 'llm') {
    // 模型初稿样式写在 <style> 里，需浏览器计算级联并物化为内联样式
    await runScript(skillScript(skills['wechat-html-normalizer'], 'scripts', 'normalize-html.mjs'), [draftHtml, finalHtml], workdir);
    record('normalized', 'wechat-html-normalizer', finalHtml);
  } else {
    // 确定性初稿天生是内联样式，跳过浏览器内联化
    fs.copyFileSync(draftHtml, finalHtml);
    record('normalized', 'wechat-html-normalizer', finalHtml, 'completed', '确定性初稿已是内联样式，跳过浏览器内联化');
  }

  onProgress('排版 6/6：按总契约执行 wechat-html-check-no-div');
  const gate = await runScript(skillScript(skills['wechat-html-check-no-div'], 'scripts', 'check-html.mjs'), [finalHtml], workdir);
  let gateResult;
  try { gateResult = JSON.parse(gate.stdout.trim().split(/\r?\n/).at(-1)); } catch { throw new Error(`无法解析排版门禁结果：${gate.stdout}`); }
  if (!gateResult.valid) throw new Error(`排版门禁未通过：${(gateResult.issues || []).join('、')}`);
  record('gate', 'wechat-html-check-no-div', finalHtml, 'completed', JSON.stringify(gateResult));
  addArtifact(store, batchId, '门禁后 HTML', path.basename(finalHtml), finalHtml);

  if (stages.length !== TYPESET_STAGE_CONTRACT.length) throw new Error('排版契约未完整执行');
  onProgress('排版完成：article.ai.html 已生成并通过门禁');
  store.updateBatch(batchId, { stage: 'typeset', status: 'completed' });
  return { workdir, finalHtml, gate: gateResult, theme:{id:themeDefinition.id,version:themeDefinition.version,hash:themeDefinition.hash}, themeRouting, themeSnapshot:themeSnapshotPath, skillManifest:path.join(workdir, 'typeset-skill-manifest.json'), stageExecutions:path.join(workdir, 'typeset-stage-executions.json') };
}
