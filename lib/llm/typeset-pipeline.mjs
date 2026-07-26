import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildImagesMarkdown, imageManifestFile } from './image-workflow.mjs';
import { loadSkillBundle } from './skill-runtime.mjs';
import { candidateArticleDir } from '../core/workspace-paths.mjs';

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
  try {
    return JSON.parse(String(result.content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch (error) {
    const reason = result.finishReason === 'length' ? '排版设计输出达到上限，JSON 被截断' : `排版设计返回无效 JSON：${error.message}`;
    store.updateModelCall(result.callId, { status: 'invalid_output', error: reason });
    throw new Error(reason);
  }
}

const TYPESET_SKILLS = [
  'wechat-article-typeset', 'wechat-md-render', 'magazine-design-advisor',
  'mermaid-render', 'wechat-inline-modules-to-images', 'wechat-echarts-blocks-to-images',
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

function normalizeDesignTokens(input = {}) {
  const legacy = input || {};
  const colors = legacy.colors || {};
  const hex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
  const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
  return {
    schema_version: 1,
    colors: {
      background: hex(colors.background, '#FFFFFF'),
      text: hex(colors.text || legacy.textColor, '#202522'),
      muted: hex(colors.muted || legacy.mutedColor, '#6C736E'),
      accent: hex(colors.accent || legacy.accentColor, '#C4473A'),
    },
    typography: {
      body_px: number(input.typography?.body_px, 16, 15, 18),
      line_height: number(input.typography?.line_height, 1.8, 1.5, 2.1),
      h2_px: number(input.typography?.h2_px, 22, 19, 28),
    },
    spacing: {
      section_px: number(input.spacing?.section_px, 30, 20, 42),
      paragraph_px: number(input.spacing?.paragraph_px, 16, 10, 24),
    },
    image: {
      radius_px: number(input.image?.radius_px, 0, 0, 16),
      caption_px: number(input.image?.caption_px, 13, 11, 15),
    },
  };
}

function markdownStructure(markdown) {
  return {
    headings: [...String(markdown).matchAll(/^#{1,3}\s+(.+)$/gm)].map((match) => match[1].replace(/[*_`]/g, '').trim()),
    links: [...String(markdown).matchAll(/(?<!!)\[[^\]]+\]\([^)]+\)/g)].length,
    images: [...String(markdown).matchAll(/!\[[^\]]*\]\([^)]+\)/g)].length,
  };
}

function htmlPreservesStructure(markdown, html) {
  const source = markdownStructure(markdown);
  const visible = String(html).replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const headingCount = (String(html).match(/<h[1-3]\b/gi) || []).length;
  const linkCount = (String(html).match(/<a\b[^>]*href=/gi) || []).length;
  const imageCount = (String(html).match(/<img\b[^>]*src=/gi) || []).length;
  return headingCount === source.headings.length && linkCount >= source.links && imageCount >= source.images && source.headings.every((heading) => visible.includes(heading));
}

export function enforceWechatFlowLayout(html) {
  const source = String(html || '');
  const override = '<style data-wechat-flow-guard>body>article,body>main{width:auto!important;max-width:none!important;margin-left:0!important;margin-right:0!important}</style>';
  if (/<\/head>/i.test(source)) return source.replace(/<\/head>/i, `${override}</head>`);
  return `${override}${source}`;
}

export function extractHtmlModelOutput(value) {
  const raw = String(value || '').trim();
  const fenced = raw.match(/```html\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/);
  let html = fenced ? fenced[1].trim() : raw;
  const start = html.search(/<!doctype\s+html|<html\b|<(?:article|main)\b/i);
  if (start > 0) html = html.slice(start);
  const htmlEnd = html.toLowerCase().lastIndexOf('</html>');
  if (htmlEnd >= 0) html = html.slice(0, htmlEnd + 7);
  return html.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function writeExecutionFiles(workdir, bundles, stages) {
  const manifest = Object.fromEntries(Object.entries(bundles).map(([name, bundle]) => [name, {
    hash: bundle.hash, files: bundle.files.map((file) => path.relative(workdir, file)), fallback: bundle.fallback,
  }]));
  writeFile(path.join(workdir, 'typeset-skill-manifest.json'), JSON.stringify(manifest, null, 2));
  writeFile(path.join(workdir, 'typeset-stage-executions.json'), JSON.stringify(stages, null, 2));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function inline(text) {
  let value = escapeHtml(text);
  value = value.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<img src="$2" alt="$1">');
  value = value.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<a href="$2">$1</a>');
  value = value.replace(/`([^`]+)`/g, '<code>$1</code>');
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  value = value.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  return value;
}

export function markdownToHtml(markdown, tokens = {}) {
  const lines = String(markdown).replace(/\r/g, '').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;
  const flushParagraph = () => { if (paragraph.length) { blocks.push(`<p>${paragraph.map(inline).join('<br>')}</p>`); paragraph = []; } };
  const flushList = () => { if (list) { blocks.push(`<${list.type}>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${list.type}>`); list = null; } };
  for (const line of lines) {
    if (/^<!--/.test(line.trim())) { flushParagraph(); flushList(); blocks.push(line); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (heading) { flushParagraph(); flushList(); blocks.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); }
    else if (bullet || ordered) {
      flushParagraph(); const type = bullet ? 'ul' : 'ol';
      if (list?.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push((bullet || ordered)[1]);
    } else if (/^>\s?/.test(line)) { flushParagraph(); flushList(); blocks.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); }
    else if (/^---+$/.test(line.trim())) { flushParagraph(); flushList(); blocks.push('<hr>'); }
    else if (!line.trim()) { flushParagraph(); flushList(); }
    else paragraph.push(line);
  }
  flushParagraph(); flushList();
  const design = normalizeDesignTokens(tokens);
  const accent = design.colors.accent;
  const ink = design.colors.text;
  const muted = design.colors.muted;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>公众号文章</title><style>
body{margin:0;background:#fff;color:${ink};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:16px;line-height:1.85;letter-spacing:.02em}article{box-sizing:border-box;width:auto;max-width:none;padding:24px 18px;margin:0}h1{font-size:28px;line-height:1.35;margin:0 0 28px;font-weight:800}h2{font-size:21px;line-height:1.45;margin:34px 0 16px;padding-left:12px;border-left:4px solid ${accent}}h3{font-size:18px;margin:26px 0 12px}p{margin:0 0 18px}strong{color:${accent}}blockquote{margin:22px 0;padding:14px 16px;background:#f6f4ef;color:${muted};border-left:3px solid ${accent}}ul,ol{margin:12px 0 20px;padding-left:25px}li{margin:7px 0}a{color:${accent};text-decoration:none;border-bottom:1px solid ${accent}}img{display:block;max-width:100%;height:auto;margin:24px auto}hr{border:0;border-top:1px solid #dedbd3;margin:32px 0}code{font-family:Consolas,monospace;background:#f3f1ec;padding:2px 5px;border-radius:3px}
</style></head><body><article>${blocks.join('\n')}</article></body></html>`;
}

async function runScript(script, args, cwd) {
  try {
    return await execFileAsync(process.execPath, [script, ...args], { cwd, windowsHide: true, timeout: 120000, maxBuffer: 2_000_000 });
  } catch (error) {
    throw new Error(String(error.stderr || error.stdout || error.message).trim());
  }
}

export async function runTypesetPipeline({ gateway, store, batchId, candidateId, provider, workspaceRoot, skillsWorkspaceRoot = workspaceRoot, onProgress = () => {} }) {
  const candidate = store.getCandidate(candidateId);
  if (!candidate || candidate.batch_id !== batchId) throw new Error('候选不存在或不属于当前批次');
  const batch = store.getBatch(batchId);
  const workdir = candidateArticleDir(workspaceRoot, batch, candidate);
  const finalPath = path.join(workdir, '09-FINAL.md');
  if (!fs.existsSync(finalPath)) throw new Error('缺少 09-FINAL.md，请先运行完整成稿链');
  const skills = loadTypesetSkills(skillsWorkspaceRoot);
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

  const { provider: providerConfig } = gateway.resolve(provider);
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
  record('design', 'magazine-design-advisor', `${schemePath};${tokensPath}`);
  addArtifact(store, batchId, '杂志设计方案', path.basename(schemePath), schemePath);
  addArtifact(store, batchId, '杂志设计 Tokens', path.basename(tokensPath), tokensPath);

  const rendered = fs.readFileSync(renderedPath, 'utf8');
  onProgress('排版 3/6：按总契约处理图片和显式视觉模块');
  const visualRequirements = [
    [/```\s*mermaid\b/i, 'mermaid-render', 'Mermaid'],
    [/<(?:section|div)\b[^>]*(?:stats-grid|timeline)/i, 'wechat-inline-modules-to-images', '内联视觉模块'],
    [/```\s*echarts\b/i, 'wechat-echarts-blocks-to-images', 'ECharts'],
  ].filter(([pattern]) => pattern.test(rendered));
  if (visualRequirements.length) {
    const names = visualRequirements.map(([, skill, label]) => `${label}（${skill}）`).join('、');
    record('images', 'wechat-article-typeset', '', 'blocked', `检测到 ${names}；项目技能未提供可直接调用的渲染脚本`);
    throw new Error(`文章含 ${names}，对应项目技能当前只有执行契约、没有渲染脚本，已停止排版以避免丢图`);
  }
  const imageResult = buildImagesMarkdown(workdir, rendered);
  if (imageResult.unresolved.length) throw new Error(`配图尚未就绪：${imageResult.unresolved.join('、')}，请先提供图片并上传 CDN`);
  const imagesPath = path.join(workdir, '09-FINAL.images.md');
  writeFile(imagesPath, imageResult.content);
  addArtifact(store, batchId, '图片就绪文章', path.basename(imagesPath), imagesPath);
  const manifestPath = imageManifestFile(workdir);
  if (fs.existsSync(manifestPath)) addArtifact(store, batchId, '配图资产清单', path.basename(manifestPath), manifestPath);
  record('images', 'wechat-article-typeset', imagesPath, 'completed', '项目内最终 HTML 允许引用可解析的本地图片路径');

  onProgress('排版 4/6：按总契约执行 wechat-md-to-draft');
  const draftHtml = path.join(workdir, 'article.ai.draft.html');
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
  writeFile(draftHtml, enforceWechatFlowLayout(useModelHtml ? htmlContent : markdownToHtml(imageResult.content, htmlTokens)));
  if (!htmlPreservesStructure(imageResult.content, fs.readFileSync(draftHtml, 'utf8'))) throw new Error('HTML 初稿未完整保留标题、章节、链接或图片');
  record('draft', 'wechat-md-to-draft', draftHtml, 'completed', useModelHtml ? '模型初稿通过结构保真门禁' : '模型初稿不合格，使用确定性转换器');
  addArtifact(store, batchId, 'HTML 初稿', path.basename(draftHtml), draftHtml);

  onProgress('排版 5/6：按总契约执行 wechat-html-normalizer');
  const finalHtml = path.join(workdir, 'article.ai.html');
  await runScript(skillScript(skills['wechat-html-normalizer'], 'scripts', 'normalize-html.mjs'), [draftHtml, finalHtml], workdir);
  record('normalized', 'wechat-html-normalizer', finalHtml);

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
  return { workdir, finalHtml, gate: gateResult, skillManifest:path.join(workdir, 'typeset-skill-manifest.json'), stageExecutions:path.join(workdir, 'typeset-stage-executions.json') };
}
