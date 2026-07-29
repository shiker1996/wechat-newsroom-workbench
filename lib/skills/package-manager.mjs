import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { readSkillManifest } from './manifest.mjs';

const MAX_FILES = 100;
const MAX_TOTAL_BYTES = 5_000_000;
const ALLOWED_EXTENSIONS = new Set(['.md', '.json', '.txt']);
const APP_VERSION = '0.1.0';

function versionTuple(value) {
  const match=String(value).match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function supportsCurrentApp(range) {
  const minimum=versionTuple(range),current=versionTuple(APP_VERSION);
  if(!minimum||!current)return false;
  for(let index=0;index<3;index+=1){
    if(current[index]>minimum[index])return true;
    if(current[index]<minimum[index])return false;
  }
  return true;
}

function pathsFor(workspaceRoot) {
  return {
    installed:path.join(workspaceRoot, 'data', 'installed-skills'),
    archive:path.join(workspaceRoot, 'data', 'skill-package-archive'),
    catalog:path.join(workspaceRoot, 'data', 'skill-packages.json'),
    events:path.join(workspaceRoot, 'data', 'skill-install-events.jsonl'),
  };
}

function readJson(filePath, fallback) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive:true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

export function readSkillPackageCatalog(workspaceRoot) {
  const value = readJson(pathsFor(workspaceRoot).catalog, { schemaVersion:1, packages:{}, entryDefaults:{}, stageDefaults:{} });
  if (value.schemaVersion !== 1 || !value.packages || !value.entryDefaults) throw new Error('第三方技能目录无效');
  if (!value.stageDefaults || typeof value.stageDefaults !== 'object') value.stageDefaults = {};
  return value;
}

function saveCatalog(workspaceRoot, catalog) {
  writeJsonAtomic(pathsFor(workspaceRoot).catalog, catalog);
}

function recordEvent(workspaceRoot, event) {
  const filePath = pathsFor(workspaceRoot).events;
  fs.mkdirSync(path.dirname(filePath), { recursive:true });
  fs.appendFileSync(filePath, `${JSON.stringify({ createdAt:new Date().toISOString(), ...event })}\n`, 'utf8');
}

function isInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function listFiles(directory) {
  const files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes:true })) {
      const filePath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`技能包禁止符号链接：${path.relative(directory, filePath)}`);
      if (entry.isDirectory()) visit(filePath);
      else if (entry.isFile()) files.push(filePath);
      else throw new Error(`技能包包含不支持的文件类型：${entry.name}`);
    }
  }
  visit(directory);
  return files;
}

function validateMarkdownLinks(directory, files) {
  for (const filePath of files.filter((item) => path.extname(item).toLowerCase() === '.md')) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].trim().split(/\s+/)[0].replace(/^<|>$/g, '');
      if (!target || /^(?:https?:|mailto:|#)/i.test(target)) continue;
      const pathname = decodeURIComponent(target.split('#')[0]);
      if (!pathname) continue;
      const resolved = path.resolve(path.dirname(filePath), pathname);
      if (!isInside(resolved, directory)) throw new Error(`Markdown 引用超出技能包：${target}`);
      if (!fs.existsSync(resolved)) throw new Error(`Markdown 引用的文件不存在：${target}`);
    }
  }
}

export function validateSkillPackageDirectory(directory) {
  const root = fs.realpathSync.native(path.resolve(directory));
  if (!fs.statSync(root).isDirectory()) throw new Error('技能包路径必须是目录');
  const files = listFiles(root);
  if (!files.length || files.length > MAX_FILES) throw new Error(`技能包文件数必须为 1–${MAX_FILES}`);
  let totalBytes = 0;
  for (const filePath of files) {
    const relative = path.relative(root, filePath).replaceAll('\\', '/');
    if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('技能包文件路径越界');
    if (!ALLOWED_EXTENSIONS.has(path.extname(filePath).toLowerCase())) throw new Error(`技能包包含不允许的文件：${relative}`);
    totalBytes += fs.statSync(filePath).size;
  }
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`技能包总大小不能超过 ${MAX_TOTAL_BYTES} 字节`);
  if (!fs.existsSync(path.join(root, 'SKILL.md'))) throw new Error('技能包缺少 SKILL.md');
  if (!fs.existsSync(path.join(root, 'skill.json'))) throw new Error('技能包缺少 skill.json');
  const expectedId = readJson(path.join(root, 'skill.json'), {}).id || path.basename(root);
  const structured = readSkillManifest(root, expectedId);
  if (structured.status !== 'valid') throw new Error(structured.issues.map((item) => item.message).join('；'));
  if (structured.manifest.source.type !== 'installed') throw new Error('第三方技能 source.type 必须为 installed');
  if (!supportsCurrentApp(structured.manifest.compatibleApp)) throw new Error(`技能需要 ${structured.manifest.compatibleApp}，当前工作台为 ${APP_VERSION}`);
  validateMarkdownLinks(root, files);
  const digest = crypto.createHash('sha256');
  for (const filePath of [...files].sort()) {
    digest.update(path.relative(root, filePath).replaceAll('\\', '/'));
    digest.update(fs.readFileSync(filePath));
  }
  return {
    directory:root,
    manifest:structured.manifest,
    files:files.map((item) => path.relative(root, item).replaceAll('\\', '/')),
    totalBytes,
    contentHash:`sha256:${digest.digest('hex')}`,
  };
}

function findEocd(buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('ZIP 缺少中央目录');
}

export function readSkillZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('不是有效 ZIP');
  const eocd = findEocd(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (count > MAX_FILES) throw new Error(`技能包文件数不能超过 ${MAX_FILES}`);
  let offset = centralOffset;
  let totalBytes = 0;
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP 中央目录无效');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8').replaceAll('\\', '/');
    offset += 46 + nameLength + extraLength + commentLength;
    if (flags & 1) throw new Error('不支持加密 ZIP');
    if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) throw new Error(`ZIP 路径非法：${name}`);
    if (name.endsWith('/')) continue;
    if (!ALLOWED_EXTENSIONS.has(path.extname(name).toLowerCase())) throw new Error(`ZIP 包含不允许的文件：${name}`);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP 本地文件头无效');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(start, start + compressedSize);
    const data = method === 0 ? Buffer.from(compressed) : method === 8 ? zlib.inflateRawSync(compressed) : null;
    if (!data) throw new Error(`ZIP 使用不支持的压缩方法：${method}`);
    if (data.length !== size) throw new Error(`ZIP 文件大小不一致：${name}`);
    totalBytes += data.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`技能包总大小不能超过 ${MAX_TOTAL_BYTES} 字节`);
    if (entries.has(name)) throw new Error(`ZIP 包含重复文件：${name}`);
    entries.set(name, data);
  }
  return entries;
}

function materializeZip(buffer) {
  const entries = readSkillZip(buffer);
  const names = [...entries.keys()];
  const firstSegments = new Set(names.map((name) => name.split('/')[0]));
  const prefix = firstSegments.size === 1 && names.every((name) => name.includes('/')) ? `${[...firstSegments][0]}/` : '';
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-package-'));
  for (const [name, data] of entries) {
    const relative = prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
    if (!relative) continue;
    const target = path.resolve(temporary, relative);
    if (!isInside(target, temporary)) throw new Error(`ZIP 解包路径越界：${name}`);
    fs.mkdirSync(path.dirname(target), { recursive:true });
    fs.writeFileSync(target, data);
  }
  return temporary;
}

export function validateSkillZipPackage(buffer) {
  const temporary = materializeZip(buffer);
  try { return validateSkillPackageDirectory(temporary); }
  finally { fs.rmSync(temporary, { recursive:true, force:true }); }
}

function copyPackage(source, target, files) {
  fs.mkdirSync(target, { recursive:true });
  for (const relative of files) {
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive:true });
    fs.copyFileSync(path.join(source, relative), destination);
  }
}

export function installSkillPackage({ workspaceRoot, directory = null, zipBuffer = null }) {
  let extracted = null;
  let staging = null;
  let archived = null;
  let target = null;
  let identity = { skillId:'', version:'' };
  try {
    const source = directory || (extracted = materializeZip(zipBuffer));
    const validated = validateSkillPackageDirectory(source);
    const { id, version } = validated.manifest;
    identity = { skillId:id, version };
    if (fs.existsSync(path.join(workspaceRoot, 'skills', id))) throw new Error(`技能 ID 与内置技能冲突：${id}`);
    const locations = pathsFor(workspaceRoot);
    target = path.join(locations.installed, id);
    const catalog = readSkillPackageCatalog(workspaceRoot);
    const previous = catalog.packages[id] || null;
    if (previous?.version === version && previous.contentHash === validated.contentHash && previous.status === 'enabled') {
      return { ...previous, reused:true };
    }
    fs.mkdirSync(locations.installed, { recursive:true });
    staging = fs.mkdtempSync(path.join(locations.installed, `.install-${id}-`));
    copyPackage(validated.directory, staging, validated.files);
    if (fs.existsSync(target)) {
      const baseName = previous?.version || `unknown-${Date.now()}`;
      archived = path.join(locations.archive, id, baseName);
      if (fs.existsSync(archived)) {
        const suffix = String(previous?.contentHash || Date.now()).replace(/[^a-z0-9]/gi, '').slice(-12);
        archived = path.join(locations.archive, id, `${baseName}-${suffix}`);
      }
      if (fs.existsSync(archived)) throw new Error(`技能历史归档已存在：${path.relative(workspaceRoot, archived)}`);
      fs.mkdirSync(path.dirname(archived), { recursive:true });
      fs.renameSync(target, archived);
    }
    fs.renameSync(staging, target);
    staging = null;
    const installed = {
      id, version, name:validated.manifest.name, kind:validated.manifest.kind, status:'enabled',
      installPath:path.relative(workspaceRoot, target).replaceAll('\\', '/'),
      contentHash:validated.contentHash, manifest:validated.manifest, installedAt:new Date().toISOString(),
    };
    catalog.packages[id] = installed;
    saveCatalog(workspaceRoot, catalog);
    recordEvent(workspaceRoot, { ...identity, action:previous ? 'update' : 'install', result:'ok', contentHash:validated.contentHash });
    return installed;
  } catch (error) {
    if (target && archived && !fs.existsSync(target) && fs.existsSync(archived)) fs.renameSync(archived, target);
    recordEvent(workspaceRoot, { ...identity, action:'install', result:'error', error:error.message });
    throw error;
  } finally {
    if (staging && fs.existsSync(staging)) fs.rmSync(staging, { recursive:true, force:true });
    if (extracted) fs.rmSync(extracted, { recursive:true, force:true });
  }
}

export function setInstalledSkillStatus(workspaceRoot, skillId, status) {
  if (!['enabled', 'disabled'].includes(status)) throw new Error('技能状态无效');
  const catalog = readSkillPackageCatalog(workspaceRoot);
  const item = catalog.packages[skillId];
  if (!item || item.status === 'uninstalled') throw new Error('第三方技能不存在');
  item.status = status;
  item.updatedAt = new Date().toISOString();
  if(status==='disabled'){
    for(const [entryPoint,value] of Object.entries(catalog.entryDefaults))if(value===skillId)delete catalog.entryDefaults[entryPoint];
    for(const [entryPoint,stages] of Object.entries(catalog.stageDefaults)){
      for(const [slot,value] of Object.entries(stages||{}))if(value===skillId)delete stages[slot];
      if(!Object.keys(stages||{}).length)delete catalog.stageDefaults[entryPoint];
    }
  }
  saveCatalog(workspaceRoot, catalog);
  recordEvent(workspaceRoot, { skillId, version:item.version, action:status, result:'ok' });
  return item;
}

export function uninstallSkillPackage(workspaceRoot, skillId) {
  const catalog = readSkillPackageCatalog(workspaceRoot);
  const item = catalog.packages[skillId];
  if (!item) throw new Error('第三方技能不存在');
  item.status = 'uninstalled';
  item.updatedAt = new Date().toISOString();
  for (const [entryPoint, value] of Object.entries(catalog.entryDefaults)) {
    if (value === skillId) delete catalog.entryDefaults[entryPoint];
  }
  for(const [entryPoint,stages] of Object.entries(catalog.stageDefaults)){
    for(const [slot,value] of Object.entries(stages||{}))if(value===skillId)delete stages[slot];
    if(!Object.keys(stages||{}).length)delete catalog.stageDefaults[entryPoint];
  }
  saveCatalog(workspaceRoot, catalog);
  recordEvent(workspaceRoot, { skillId, version:item.version, action:'uninstall', result:'ok' });
  return item;
}

export function setSkillEntryDefault(workspaceRoot, entryPoint, skillId) {
  const catalog = readSkillPackageCatalog(workspaceRoot);
  if (skillId) {
    const item = catalog.packages[skillId];
    if (!item || item.status !== 'enabled' || !item.manifest.entryPoints.includes(entryPoint)) {
      throw new Error('技能未启用或不兼容该入口');
    }
    catalog.entryDefaults[entryPoint] = skillId;
  } else {
    delete catalog.entryDefaults[entryPoint];
  }
  saveCatalog(workspaceRoot, catalog);
  recordEvent(workspaceRoot, { skillId, version:catalog.packages[skillId]?.version || '', action:'set-default', result:'ok', entryPoint });
  return catalog.entryDefaults;
}

const STAGE_DEFAULT_CONTRACTS=Object.freeze({
  storyboard:{kind:'storyboard',inputContract:'social_card_fact_base',outputContract:'social_card_storyboard'},
  title:{kind:'title',inputContract:'article_fact_base',outputContract:'title_candidates'},
  reviewer:{kind:'reviewer',inputContract:'article_fact_base',outputContract:'reviewed_markdown'},
  humanizer:{kind:'humanizer',inputContract:'wechat_markdown',outputContract:'wechat_markdown'},
  seo:{kind:'seo',inputContract:'reviewed_markdown',outputContract:'wechat_markdown'},
});

export function setSkillStageDefault(workspaceRoot, entryPoint, slot, skillId) {
  const contract=STAGE_DEFAULT_CONTRACTS[slot];
  if(!contract)throw new Error('未知文章阶段');
  const catalog=readSkillPackageCatalog(workspaceRoot);
  if(skillId){
    const item=catalog.packages[skillId],manifest=item?.manifest;
    if(!item||item.status!=='enabled'||!manifest?.entryPoints?.includes(entryPoint)
      ||manifest.kind!==contract.kind||manifest.inputContract!==contract.inputContract
      ||manifest.outputContract!==contract.outputContract){
      throw new Error('技能未启用或不兼容该入口与阶段');
    }
    catalog.stageDefaults[entryPoint]={...(catalog.stageDefaults[entryPoint]||{}),[slot]:skillId};
  }else if(catalog.stageDefaults[entryPoint]){
    delete catalog.stageDefaults[entryPoint][slot];
    if(!Object.keys(catalog.stageDefaults[entryPoint]).length)delete catalog.stageDefaults[entryPoint];
  }
  saveCatalog(workspaceRoot,catalog);
  recordEvent(workspaceRoot,{skillId,version:catalog.packages[skillId]?.version||'',action:'set-stage-default',result:'ok',entryPoint,slot});
  return catalog.stageDefaults;
}

export function listSkillInstallEvents(workspaceRoot, limit = 100) {
  const filePath = pathsFor(workspaceRoot).events;
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean)
    .slice(-Math.max(1, Math.min(500, limit))).reverse().map((line) => JSON.parse(line));
}

export function installedSkillsRoot(workspaceRoot) {
  return pathsFor(workspaceRoot).installed;
}

export function isInstalledSkillEnabled(workspaceRoot, skillId) {
  const item = readSkillPackageCatalog(workspaceRoot).packages[skillId];
  return Boolean(item && item.status === 'enabled');
}
