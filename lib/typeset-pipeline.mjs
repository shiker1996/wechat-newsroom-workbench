import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildImagesMarkdown, imageManifestFile } from './image-workflow.mjs';

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
  const accent = /^#[0-9a-f]{6}$/i.test(tokens.accentColor) ? tokens.accentColor : '#c4473a';
  const ink = /^#[0-9a-f]{6}$/i.test(tokens.textColor) ? tokens.textColor : '#202522';
  const muted = /^#[0-9a-f]{6}$/i.test(tokens.mutedColor) ? tokens.mutedColor : '#6c736e';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>公众号文章</title><style>
body{margin:0;background:#fff;color:${ink};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:16px;line-height:1.85;letter-spacing:.02em}article{box-sizing:border-box;padding:24px 18px;margin:0 auto}h1{font-size:28px;line-height:1.35;margin:0 0 28px;font-weight:800}h2{font-size:21px;line-height:1.45;margin:34px 0 16px;padding-left:12px;border-left:4px solid ${accent}}h3{font-size:18px;margin:26px 0 12px}p{margin:0 0 18px}strong{color:${accent}}blockquote{margin:22px 0;padding:14px 16px;background:#f6f4ef;color:${muted};border-left:3px solid ${accent}}ul,ol{margin:12px 0 20px;padding-left:25px}li{margin:7px 0}a{color:${accent};text-decoration:none;border-bottom:1px solid ${accent}}img{display:block;max-width:100%;height:auto;margin:24px auto}hr{border:0;border-top:1px solid #dedbd3;margin:32px 0}code{font-family:Consolas,monospace;background:#f3f1ec;padding:2px 5px;border-radius:3px}
</style></head><body><article>${blocks.join('\n')}</article></body></html>`;
}

async function runScript(script, args, cwd) {
  try {
    return await execFileAsync(process.execPath, [script, ...args], { cwd, windowsHide: true, timeout: 120000, maxBuffer: 2_000_000 });
  } catch (error) {
    throw new Error(String(error.stderr || error.stdout || error.message).trim());
  }
}

export async function runTypesetPipeline({ gateway, store, batchId, candidateId, provider, workspaceRoot, mode = 'local', onProgress = () => {} }) {
  const candidate = store.getCandidate(candidateId);
  if (!candidate || candidate.batch_id !== batchId) throw new Error('候选不存在或不属于当前批次');
  const batch = store.getBatch(batchId);
  const workdir = path.join(workspaceRoot, 'articles', `${batch.batch_date}-${candidate.candidate_id.toLowerCase()}`);
  const finalPath = path.join(workdir, '09-FINAL.md');
  if (!fs.existsSync(finalPath)) throw new Error('缺少 09-FINAL.md，请先运行完整成稿链');
  const skillRoot = path.join(process.env.USERPROFILE || 'C:\\Users\\Administrator', '.codex', 'skills');
  const renderedPath = path.join(workdir, '09-FINAL.rendered.md');
  onProgress('排版 1/6：按 wechat-md-render 建立预渲染副本');
  await runScript(path.join(skillRoot, 'wechat-md-render', 'scripts', 'md-render.js'), [finalPath, renderedPath], workdir);
  addArtifact(store, batchId, '预渲染文章', path.basename(renderedPath), renderedPath);

  const { provider: providerConfig } = gateway.resolve(provider);
  onProgress('排版 2/6：生成克制的杂志设计方案与设计 tokens');
  const designResult = await gateway.complete({ provider, purpose: 'magazine-design', batchId, candidateId, jsonMode: true,
    maxOutputTokens: Math.min(3200, providerConfig.maxOutputTokens), messages: [
      { role: 'system', protected: true, content: '你是公众号杂志设计顾问。根据文章语气制定克制、可实现的排版，不改变正文。只返回JSON：{"schemeMarkdown":"Markdown设计说明","tokens":{"accentColor":"#RRGGBB","textColor":"#RRGGBB","mutedColor":"#RRGGBB","designTone":"字符串","headingStyle":"字符串","blockquoteStyle":"字符串"}}。颜色必须是六位十六进制。' },
      { role: 'user', protected: true, content: fs.readFileSync(renderedPath, 'utf8').slice(0, 16000) },
    ] });
  const design = parseJson(designResult, store);
  const schemePath = path.join(workdir, '09-FINAL.design-scheme.md');
  const tokensPath = path.join(workdir, 'magazine-design-tokens.json');
  writeFile(schemePath, design.schemeMarkdown || '# 杂志设计方案\n\n克制、清晰、移动端优先。');
  writeFile(tokensPath, JSON.stringify(design.tokens || {}, null, 2));
  addArtifact(store, batchId, '杂志设计方案', path.basename(schemePath), schemePath);
  addArtifact(store, batchId, '杂志设计 Tokens', path.basename(tokensPath), tokensPath);

  const rendered = fs.readFileSync(renderedPath, 'utf8');
  if (/```\s*(?:mermaid|echarts)\b/i.test(rendered) || /<(?:section|div)\b[^>]*(?:stats-grid|timeline)/i.test(rendered)) {
    throw new Error('文章含图表或内联视觉模块，需先完成对应转图子流水线，不能冒充已排版');
  }
  const imageResult = buildImagesMarkdown(workdir, rendered);
  if (imageResult.unresolved.length) throw new Error(`配图尚未就绪：${imageResult.unresolved.join('、')}，请先提供图片并上传 CDN`);
  if (imageResult.nonHttpsImages.length) throw new Error(`存在本地或非 HTTPS 图片，不能生成可复制的正式排版：${imageResult.nonHttpsImages.join('、')}`);
  const imagesPath = path.join(workdir, '09-FINAL.images.md');
  writeFile(imagesPath, imageResult.content);
  addArtifact(store, batchId, '图片就绪文章', path.basename(imagesPath), imagesPath);
  const manifestPath = imageManifestFile(workdir);
  if (fs.existsSync(manifestPath)) addArtifact(store, batchId, '配图资产清单', path.basename(manifestPath), manifestPath);

  onProgress('排版 3/6：AI 根据文章正文与设计 tokens 生成草稿 HTML');
  const draftHtml = path.join(workdir, 'article.ai.draft.html');
  const htmlGenSystem = '你是公众号排版助手。根据文章正文和设计 tokens 生成干净、移动端优先的 HTML。' +
    '使用符合规范的标准 HTML 标签（h1-h3、p、ul、ol、li、blockquote、figure、figcaption、img、table、thead、tbody、th、td、code）。' +
    '所有标签必须正确闭合。所有图片用 <figure><img src="..."><figcaption>图注</figcaption></figure> 包裹。' +
    '在公众号复制编辑器中可用。样式内联到标签 style 属性。' +
    '只输出 HTML，不附说明或 Markdown 包裹。';
  const htmlTokens = design.tokens || {};
  const { provider: providerConfig2 } = gateway.resolve(provider);
  const htmlGenResult = await gateway.complete({ provider, purpose: 'typeset-html', batchId, candidateId,
    maxOutputTokens: Math.min(8000, providerConfig2.maxOutputTokens), messages: [
      { role: 'system', content: htmlGenSystem, protected: true },
      { role: 'user', content: JSON.stringify({
        tokens: htmlTokens, markdown: imageResult.content,
      }), protected: true },
    ] });
  const htmlContent = String(htmlGenResult.content || '').trim().replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '');
  // If AI output lacks basic HTML structure, fallback to deterministic converter
  const hasBasicStructure = /<\/?figure|<\/?table|<\/?h[1-3]/i.test(htmlContent);
  writeFile(draftHtml, hasBasicStructure ? htmlContent : markdownToHtml(imageResult.content, htmlTokens));

  onProgress('排版 4/6：执行 wechat-html-normalizer 内联化与净化');
  const finalHtml = path.join(workdir, 'article.ai.html');
  await runScript(path.join(skillRoot, 'wechat-html-normalizer', 'scripts', 'normalize-html.mjs'), [draftHtml, finalHtml], workdir);

  onProgress('排版 5/6：执行 wechat-html-check-no-div 确定性门禁');
  const gate = await runScript(path.join(skillRoot, 'wechat-html-check-no-div', 'scripts', 'check-html.mjs'), [finalHtml], workdir);
  let gateResult;
  try { gateResult = JSON.parse(gate.stdout.trim().split(/\r?\n/).at(-1)); } catch { throw new Error(`无法解析排版门禁结果：${gate.stdout}`); }
  if (!gateResult.valid) throw new Error(`排版门禁未通过：${(gateResult.issues || []).join('、')}`);
  addArtifact(store, batchId, '门禁后 HTML', path.basename(finalHtml), finalHtml);

  let previewUrl = null;
  if (mode === 'preview') {
    onProgress('排版 6/6：提交 wechat-html-to-preview 生成复制页');
    await runScript(path.join(skillRoot, 'wechat-html-to-preview', 'scripts', 'html-to-preview.mjs'), [finalHtml], workdir);
    const previewPath = path.join(workdir, 'wechat-preview-url.txt');
    if (!fs.existsSync(previewPath)) throw new Error('预览服务未生成 wechat-preview-url.txt');
    previewUrl = fs.readFileSync(previewPath, 'utf8').trim();
    addArtifact(store, batchId, '微信复制页', path.basename(previewPath), previewPath);
    store.updateBatch(batchId, { stage: 'preview', status: 'completed' });
  } else {
    onProgress('排版 6/6：本地正式 HTML 已生成；未执行外部上传');
    store.updateBatch(batchId, { stage: 'typeset', status: 'review' });
  }
  return { workdir, finalHtml, previewUrl, gate: gateResult };
}
