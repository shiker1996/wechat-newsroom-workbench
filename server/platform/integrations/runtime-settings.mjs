import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseEnv } from '../core/env.mjs';
import { resolveArticleLength } from '../core/config.mjs';

export const APP_FIELDS = [];
function quoteEnv(value) {
  const text = String(value ?? '');
  return /^[A-Za-z0-9_./:@-]*$/.test(text) ? text : JSON.stringify(text);
}

function readEnv(filePath) {
  return fs.existsSync(filePath) ? parseEnv(fs.readFileSync(filePath, 'utf8')) : {};
}

function writeEnv(filePath, fields, updates) {
  const allowed = new Set(fields.map(([key]) => key));
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = current ? current.split(/\r?\n/) : [];
  const touched = new Set();
  const next = lines.flatMap((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || !allowed.has(match[1]) || !(match[1] in updates)) return [line];
    const key = match[1]; touched.add(key);
    const value = updates[key];
    return value === null || value === '' ? [] : [`${key}=${quoteEnv(value)}`];
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!allowed.has(key) || touched.has(key) || value === null || value === '') continue;
    next.push(`${key}=${quoteEnv(value)}`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${next.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
}

function publicFields(filePath, fields) {
  const values = readEnv(filePath);
  return fields.map(([key, label, secret]) => ({
    key, label, secret, configured: Boolean(values[key]),
    value: secret ? '' : (values[key] ?? ''),
  }));
}

function publicRsshubFields(filePath) {
  return Object.keys(readEnv(filePath)).sort().map((key)=>({
    key, label:key, secret:true, configured:true, value:'',
  }));
}

export function getRuntimeSettings(root, config) {
  return {
    app: [],
    rsshub: publicRsshubFields(path.join(config.rsshub.rootDir, '.env')),
    paths: {
      workspaceRoot: config.workspaceRoot,
      rsshubRoot: config.rsshub.rootDir,
      rsshubUrl: config.rsshub.baseUrl,
      redditCdpUrl: config.reddit.cdpUrl,
    },
    // 成稿字数门禁（全局值；链路差异覆盖只影响对应 pipeline，编辑器按全局口径提示）
    articleLength: { minVisibleChars: resolveArticleLength(config).min, maxVisibleChars: resolveArticleLength(config).max },
  };
}

function normalizeUpdates(input, fields) {
  const allowed = new Set(fields.map(([key]) => key));
  const result = {};
  for (const item of Array.isArray(input) ? input : []) {
    if (!allowed.has(item?.key)) continue;
    if (item.clear === true) result[item.key] = null;
    else if (typeof item.value === 'string' && item.value.trim()) result[item.key] = item.value.trim();
  }
  return result;
}

function normalizeRsshubUpdates(input) {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(input) ? input : []) {
    const key=String(item?.key||'').trim();
    if(!key&&!String(item?.value||'').trim()&&item?.clear!==true)continue;
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))throw new Error(`RSSHub 环境变量名不合法：${key||'空值'}`);
    if(seen.has(key))throw new Error(`RSSHub 环境变量重复：${key}`);
    seen.add(key);
    if(item.clear===true)result.push({key,value:null});
    else if(typeof item.value==='string'&&item.value.trim())result.push({key,value:item.value.trim()});
  }
  return result;
}

function writeRsshubEnv(filePath, input) {
  const existing=readEnv(filePath);
  const updates=normalizeRsshubUpdates(input);
  const fields=[...new Set([...Object.keys(existing),...updates.map((item)=>item.key)])].map((key)=>[key,key,true]);
  writeEnv(filePath,fields,Object.fromEntries(updates.map((item)=>[item.key,item.value])));
}

export function updateRuntimeSettings(root, config, input) {
  writeRsshubEnv(path.join(config.rsshub.rootDir, '.env'), input.rsshub);
  return getRuntimeSettings(root, config);
}

export function runPowerShellScript(scriptPath, args = [], timeoutMs = 30000) {
  if (!fs.existsSync(scriptPath)) throw new Error(`管理脚本不存在：${scriptPath}`);
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('管理脚本执行超时')); }, timeoutMs);
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ message: stdout.trim() || '操作完成' });
      else reject(new Error(stderr.trim() || stdout.trim() || `脚本退出码 ${code}`));
    });
  });
}
