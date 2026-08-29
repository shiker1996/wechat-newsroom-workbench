import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const MAX_CHUNK_BYTES = 16 * 1024;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
// 与 Agent ToolRequest 协议保持一致：模型生成的 requestId 允许下划线，
// 例如 tr_visual_append_3。插件不能比上层协议更严格，否则合法请求会被误拒绝。
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const locks = new Map();

function fallbackResult() {
  return {
    ok: (data = {}, extras = {}) => ({ status: 'ok', data, artifacts: [], provenance: {}, warnings: [], metrics: { durationMs: 0 }, ...extras }),
    failure: (code, message, options = {}) => ({ status: 'error', error: { code, message: String(message), retryable: Boolean(options.retryable) } }),
  };
}

function canonical(candidate) {
  let current = path.resolve(candidate);
  const missing = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(path.basename(current));
    current = parent;
  }
  const base = fs.existsSync(current) ? fs.realpathSync.native(current) : current;
  return path.resolve(base, ...missing);
}

function inside(candidate, root) {
  const relative = path.relative(canonical(root), canonical(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeIdentifier(value, pattern, label) {
  const text = String(value || '');
  if (!pattern.test(text)) throw new Error(`${label} 格式无效`);
  return text;
}

function targetPath(input, context) {
  const target = String(input.path || '');
  if (!path.isAbsolute(target)) throw new Error('path 必须是绝对路径');
  const roots = Array.isArray(context.allowedRoots) ? context.allowedRoots.filter(Boolean) : [];
  if (!roots.length) {
    const error = new Error('未授权访问写入路径');
    error.code = 'PERMISSION_DENIED';
    throw error;
  }
  const resolved = canonical(target);
  if (!roots.some((root) => inside(resolved, root))) {
    const error = new Error(`路径超出授权目录：${target}`);
    error.code = 'PATH_OUTSIDE_ALLOWED_ROOTS';
    throw error;
  }
  return resolved;
}

function statePath(target, sessionId) {
  return path.join(path.dirname(target), '.ai-visual-document-writer', `${sessionId}.json`);
}

function readState(file) {
  if (!fs.existsSync(file)) return null;
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!state || state.schemaVersion !== 1) throw new Error('写入会话状态版本无效');
  return state;
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

function documentDigest(target) {
  if (!fs.existsSync(target)) return { totalBytes: 0, sha256: crypto.createHash('sha256').update('').digest('hex') };
  const stat = fs.statSync(target);
  if (!stat.isFile()) throw new Error('目标路径不是普通文件');
  if (stat.size > MAX_DOCUMENT_BYTES) throw new Error(`文档超过 ${MAX_DOCUMENT_BYTES} 字节上限`);
  return {
    totalBytes: stat.size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),
  };
}

function resultData(operation, sessionId, target, state, extra = {}) {
  const digest = documentDigest(target);
  return {
    operation,
    sessionId,
    path: target,
    status: state.status,
    revision: Number(state.revision) || 0,
    appendedBytes: 0,
    totalBytes: digest.totalBytes,
    sha256: digest.sha256,
    ...extra,
  };
}

async function withLock(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  const cleanup = current.finally(() => {
    if (locks.get(key) === cleanup) locks.delete(key);
  });
  // current 的拒绝会由 execute() await 后转换为受控的插件错误；
  // finally() 会另外创建一个 Promise，必须显式接住它，否则一次合法的
  // 参数错误也可能变成 unhandled rejection，直接终止 Node 工作台。
  cleanup.catch(() => {});
  locks.set(key, cleanup);
  return current;
}

function requireActiveState(state, sessionId, target) {
  if (!state) throw new Error(`写入会话不存在：${sessionId}`);
  if (state.targetPath !== target) throw new Error('写入会话与目标路径不匹配');
  if (state.status !== 'active') throw new Error(`写入会话当前状态不可追加：${state.status}`);
}

function validateRevision(input, state) {
  if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== Number(state.revision)) {
    const error = new Error(`写入版本冲突：期望 ${input.expectedRevision}，当前 ${state.revision}`);
    error.code = 'OUTPUT_INVALID';
    throw error;
  }
}

async function executeLocked(input, context) {
  const { ok } = context.result || fallbackResult();
  const target = targetPath(input, context);
  const sessionId = safeIdentifier(input.sessionId, SESSION_ID, 'sessionId');
  const operation = String(input.operation || '');
  const metadata = statePath(target, sessionId);
  let state = readState(metadata);

  if (operation === 'begin') {
    if (state?.status === 'active') {
      if (state.targetPath !== target) throw new Error('活动写入会话目标不一致');
      return ok(resultData(operation, sessionId, target, state, { alreadyApplied: true }));
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '', 'utf8');
    state = {
      schemaVersion: 1,
      sessionId,
      targetPath: target,
      status: 'active',
      revision: 0,
      requestIds: {},
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeState(metadata, state);
    return ok(resultData(operation, sessionId, target, state));
  }

  requireActiveState(state, sessionId, target);
  if (operation === 'append') {
    const requestId = safeIdentifier(input.requestId, REQUEST_ID, 'requestId');
    if (state.requestIds?.[requestId]) {
      return ok(resultData(operation, sessionId, target, state, { ...state.requestIds[requestId], alreadyApplied: true }));
    }
    validateRevision(input, state);
    const content = String(input.content ?? '');
    const bytes = Buffer.byteLength(content, 'utf8');
    if (!bytes) throw new Error('append 操作缺少 content');
    if (bytes > MAX_CHUNK_BYTES) throw new Error(`单个分块不能超过 ${MAX_CHUNK_BYTES} 字节`);
    const current = documentDigest(target);
    if (current.totalBytes + bytes > MAX_DOCUMENT_BYTES) throw new Error(`文档不能超过 ${MAX_DOCUMENT_BYTES} 字节`);
    fs.appendFileSync(target, content, 'utf8');
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    const digest = documentDigest(target);
    const applied = { revision: state.revision, appendedBytes: bytes, totalBytes: digest.totalBytes, sha256: digest.sha256 };
    state.requestIds = { ...(state.requestIds || {}), [requestId]: applied };
    writeState(metadata, state);
    return ok(resultData(operation, sessionId, target, state, applied));
  }

  if (operation === 'finish') {
    validateRevision(input, state);
    state.status = 'finished';
    state.updatedAt = new Date().toISOString();
    state.finishedAt = state.updatedAt;
    writeState(metadata, state);
    return ok(resultData(operation, sessionId, target, state));
  }

  if (operation === 'abort') {
    validateRevision(input, state);
    state.status = 'aborted';
    state.updatedAt = new Date().toISOString();
    state.abortedAt = state.updatedAt;
    writeState(metadata, state);
    return ok(resultData(operation, sessionId, target, state));
  }

  throw new Error(`不支持的写入操作：${operation}`);
}

export async function execute(input, context = {}) {
  const { ok: okResult, failure: failureResult } = context.result || fallbackResult();
  const operation = String(input?.operation || '');
  try {
    const target = targetPath(input || {}, context);
    const sessionId = safeIdentifier(input?.sessionId, SESSION_ID, 'sessionId');
    const key = `${target}\0${sessionId}`;
    const result = await withLock(key, () => executeLocked(input, context));
    return result;
  } catch (error) {
    const code = error?.code === 'PERMISSION_DENIED' ? 'PERMISSION_DENIED'
      : error?.code === 'PATH_OUTSIDE_ALLOWED_ROOTS' ? 'PATH_OUTSIDE_ALLOWED_ROOTS'
        : 'OUTPUT_INVALID';
    return failureResult(code, error?.message || String(error));
  }
}

export async function health(context = {}) {
  const { ok: okResult } = context.result || fallbackResult();
  return okResult({ available: true, provider: 'local-ai-visual-document-writer', maxChunkBytes: MAX_CHUNK_BYTES, maxDocumentBytes: MAX_DOCUMENT_BYTES });
}
