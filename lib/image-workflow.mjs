import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const TYPES = new Set(['来源', '资料', '参考']);
const MIME_EXT = new Map([
  ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/gif', 'gif'], ['image/webp', 'webp'],
]);
const PLACEHOLDER_RE = /<!--\s*IMG:([^:|\s]+):(\d+)\s*\|\s*内容:([^|]+)\|\s*建议位置:([^|]+)\|\s*比例:([^|]+)\|\s*出处:([^|]+)\|\s*版权:([^>]+?)\s*-->/g;
const SUPPLY_LIST_RE = /\n*<!--\s*IMAGE-SUPPLY-LIST[\s\S]*?-->\s*$/i;
const PLAN_NONE_RE = /\n*<!--\s*IMAGE-PLAN:none\s*-->\s*$/i;

export const IMAGE_PLAN_SYSTEM = `你是文章配图编辑。只识别必须由作者或编辑提供、且确有阅读或证据价值的来源图、资料图和参考图；不要建议纯装饰图、氛围图、可自动绘制的示意图，也不要为已有图片重复留位。
返回严格 JSON：{"placements":[{"type":"来源|资料|参考","content":"需要提供的具体图片","afterExact":"原文中用于定位插入点的连续原句，20到80字，必须逐字存在","ratio":"16:9|4:3|1:1|自适应","suggestedSource":"待确认或明确建议来源","copyrightAction":"待确认或需要完成的授权动作"}]}。
最多4项；没有必要图片时返回空数组。不得改写文章，不得编造图片、URL、来源或授权状态，不要输出 JSON 之外的文字。`;

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive:true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

function manifestPath(workdir) { return path.join(workdir, 'image-assets.json'); }

function readManifest(workdir) {
  const filePath = manifestPath(workdir);
  if (!fs.existsSync(filePath)) return { version:1, items:{} };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { version:1, items:parsed.items && typeof parsed.items === 'object' ? parsed.items : {} };
  } catch { return { version:1, items:{} }; }
}

export function parseImagePlaceholders(markdown) {
  return [...String(markdown).matchAll(PLACEHOLDER_RE)].map((match) => ({
    id:`${match[1]}:${match[2]}`, type:match[1], number:match[2], content:match[3].trim(),
    position:match[4].trim(), ratio:match[5].trim(), suggestedSource:match[6].trim(),
    copyrightAction:match[7].trim(), placeholder:match[0],
  }));
}

export function applyImagePlan(markdown, placements = []) {
  const original = String(markdown).replace(SUPPLY_LIST_RE, '').replace(PLAN_NONE_RE, '').trim();
  if (parseImagePlaceholders(original).length) return original;
  const counters = { 来源:0, 资料:0, 参考:0 };
  const accepted = [];
  let output = original;
  for (const raw of Array.isArray(placements) ? placements.slice(0, 4) : []) {
    const type = TYPES.has(raw?.type) ? raw.type : null;
    const exact = String(raw?.afterExact || '').trim();
    const content = String(raw?.content || '').trim();
    if (!type || !exact || !content || !output.includes(exact)) continue;
    counters[type] += 1;
    const number = String(counters[type]).padStart(2, '0');
    const item = {
      id:`${type}:${number}`, type, number, content,
      position:`“${exact.slice(0, 36)}${exact.length > 36 ? '…' : ''}”段后`,
      ratio:String(raw.ratio || '自适应').trim(),
      suggestedSource:String(raw.suggestedSource || '待确认').trim(),
      copyrightAction:String(raw.copyrightAction || '待确认').trim(),
    };
    const marker = `<!-- IMG:${item.id} | 内容:${item.content} | 建议位置:${item.position} | 比例:${item.ratio} | 出处:${item.suggestedSource} | 版权:${item.copyrightAction} -->`;
    const anchor = output.indexOf(exact) + exact.length;
    const paragraphEnd = output.indexOf('\n\n', anchor);
    const insertAt = paragraphEnd < 0 ? output.length : paragraphEnd;
    output = `${output.slice(0, insertAt)}\n\n${marker}${output.slice(insertAt)}`;
    accepted.push(item);
  }
  if (!accepted.length) return `${original}\n\n<!-- IMAGE-PLAN:none -->`;
  const list = accepted.map((item) => `- ${item.id}｜${item.content}｜建议来源：${item.suggestedSource}｜版权动作：${item.copyrightAction}`).join('\n');
  return `${output.trim()}\n\n<!-- IMAGE-SUPPLY-LIST\n# 手动供图清单\n${list}\n-->`;
}

export async function planImagePlaceholders({ gateway, store, batchId, candidateId, provider, markdown, maxOutputTokens = 3000 }) {
  const result = await gateway.complete({ provider, purpose:'article-image-plan', batchId, candidateId, jsonMode:true, maxOutputTokens,
    messages:[{ role:'system', content:IMAGE_PLAN_SYSTEM, protected:true }, { role:'user', content:String(markdown), protected:true }] });
  let parsed;
  try { parsed = JSON.parse(String(result.content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch (error) {
    const reason = result.finishReason === 'length' ? '配图规划输出达到上限，JSON 被截断' : `配图规划返回无效 JSON：${error.message}`;
    store.updateModelCall(result.callId, { status:'invalid_output', error:reason });
    throw new Error(reason);
  }
  return applyImagePlan(markdown, parsed.placements);
}

export function getImageWorkspace(workdir) {
  const finalPath = path.join(workdir, '09-FINAL.md');
  const markdown = fs.existsSync(finalPath) ? fs.readFileSync(finalPath, 'utf8') : '';
  const placeholders = parseImagePlaceholders(markdown);
  const manifest = readManifest(workdir);
  const items = placeholders.map((item) => {
    const saved = manifest.items[item.id] || {};
    const cdnReady = /^https:\/\//i.test(saved.url || '');
    return { ...item, ...saved, id:item.id, status:cdnReady ? 'cdn' : saved.localPath && fs.existsSync(saved.localPath) ? 'local' : 'missing' };
  });
  const existingImages = [...markdown.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => ({ alt:match[1], url:match[2] }));
  return { planned:placeholders.length > 0 || PLAN_NONE_RE.test(markdown), total:items.length, ready:items.filter((item) => item.status === 'cdn').length,
    unresolved:items.filter((item) => item.status !== 'cdn').map((item) => item.id), items, existingImages,
    uploaderAvailable:fs.existsSync(path.join(process.env.USERPROFILE || 'C:\\Users\\Administrator', '.codex', 'skills', 'upyun-upload-image', 'upyun-upload-image.js')) };
}

export function saveImageMetadata(workdir, id, updates = {}) {
  const workspace = getImageWorkspace(workdir);
  const item = workspace.items.find((entry) => entry.id === id);
  if (!item) throw new Error('图片占位不存在');
  const manifest = readManifest(workdir);
  manifest.items[id] = { ...(manifest.items[id] || {}), source:String(updates.source ?? item.source ?? '').trim(),
    copyright:String(updates.copyright ?? item.copyright ?? '').trim(), updatedAt:new Date().toISOString() };
  writeJson(manifestPath(workdir), manifest);
  return getImageWorkspace(workdir).items.find((entry) => entry.id === id);
}

export function saveLocalImage(workdir, id, input) {
  const mimeType = String(input.mimeType || '').toLowerCase();
  const ext = MIME_EXT.get(mimeType);
  if (!ext) throw new Error('仅支持 PNG、JPEG、GIF 或 WebP 图片');
  const workspace = getImageWorkspace(workdir);
  if (!workspace.items.some((entry) => entry.id === id)) throw new Error('图片占位不存在');
  const bytes = Buffer.from(String(input.base64 || '').replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!bytes.length) throw new Error('图片文件为空');
  if (bytes.length > 8 * 1024 * 1024) throw new Error('单张图片不能超过 8MB');
  const imageDir = path.join(workdir, 'images'); fs.mkdirSync(imageDir, { recursive:true });
  const localPath = path.join(imageDir, `${id.replace(':', '-')}.${ext}`);
  const temp = `${localPath}.tmp`; fs.writeFileSync(temp, bytes); fs.renameSync(temp, localPath);
  const manifest = readManifest(workdir);
  manifest.items[id] = { ...(manifest.items[id] || {}), localPath, originalName:path.basename(String(input.fileName || localPath)), mimeType,
    source:String(input.source || manifest.items[id]?.source || '').trim(), copyright:String(input.copyright || manifest.items[id]?.copyright || '').trim(),
    url:'', key:'', updatedAt:new Date().toISOString() };
  writeJson(manifestPath(workdir), manifest);
  return getImageWorkspace(workdir).items.find((entry) => entry.id === id);
}

export async function uploadImageToCdn(workdir, id) {
  const workspace = getImageWorkspace(workdir);
  const item = workspace.items.find((entry) => entry.id === id);
  if (!item?.localPath || !fs.existsSync(item.localPath)) throw new Error('请先选择并保存本地图片');
  const skillRoot = path.join(process.env.USERPROFILE || 'C:\\Users\\Administrator', '.codex', 'skills', 'upyun-upload-image');
  const script = path.join(skillRoot, 'upyun-upload-image.js');
  if (!fs.existsSync(script)) throw new Error('未安装 upyun-upload-image 技能');
  let stdout;
  try { ({ stdout } = await execFileAsync(process.execPath, [script, item.localPath], { cwd:skillRoot, windowsHide:true, timeout:120000, maxBuffer:1_000_000 })); }
  catch (error) { throw new Error(`CDN 上传失败：${String(error.stdout || error.stderr || error.message).trim()}`); }
  let result;
  try { result = JSON.parse(String(stdout).trim().split(/\r?\n/).at(-1)); } catch { throw new Error('CDN 上传器没有返回有效结果'); }
  if (!result.success || !/^https:\/\//i.test(result.data?.url || '') || !result.data?.key) throw new Error(result.message || 'CDN 上传未返回有效 HTTPS URL');
  const manifest = readManifest(workdir);
  manifest.items[id] = { ...(manifest.items[id] || {}), url:result.data.url, key:result.data.key, uploadedAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
  writeJson(manifestPath(workdir), manifest);
  return getImageWorkspace(workdir).items.find((entry) => entry.id === id);
}

export function buildImagesMarkdown(workdir, markdown) {
  const manifest = readManifest(workdir);
  const placeholders = parseImagePlaceholders(markdown);
  const unresolved = [];
  let output = String(markdown).replace(SUPPLY_LIST_RE, '').replace(PLAN_NONE_RE, '').trim();
  for (const item of placeholders) {
    const saved = manifest.items[item.id] || {};
    if (!/^https:\/\//i.test(saved.url || '')) { unresolved.push(item.id); continue; }
    output = output.replace(item.placeholder, `![${item.content.replace(/[\[\]]/g, '')}](${saved.url})`);
  }
  const nonHttpsImages = [...output.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]).filter((url) => !/^https:\/\//i.test(url));
  return { content:`${output.trim()}\n`, unresolved, nonHttpsImages };
}

export function imageManifestFile(workdir) { return manifestPath(workdir); }
