import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getToolRegistry } from '../server/platform/tools/index.mjs';

test('AI 视觉文档插件按 revision 原样追加并支持 requestId 幂等', async () => {
  const registry = await getToolRegistry();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-visual-writer-'));
  const target = path.join(root, 'ai-beautified.html');
  try {
    const context = { allowedRoots: [root], consumerId: 'test.ai-visual-document-writer' };
    const begin = await registry.execute('cap_filesystem_project_document_write', { operation: 'begin', sessionId: 'test-session', path: target }, context);
    assert.equal(begin.status, 'ok');
    assert.equal(begin.data.revision, 0);

    const first = await registry.execute('cap_filesystem_project_document_write', { operation: 'append', sessionId: 'test-session', requestId: 'chunk-1', expectedRevision: 0, path: target, content: '<style>.neon-card{gap:8px}</style>' }, context);
    assert.equal(first.status, 'ok');
    assert.equal(first.data.revision, 1);
    assert.equal(first.data.appendedBytes, Buffer.byteLength('<style>.neon-card{gap:8px}</style>'));

    const duplicate = await registry.execute('cap_filesystem_project_document_write', { operation: 'append', sessionId: 'test-session', requestId: 'chunk-1', expectedRevision: 0, path: target, content: '<style>SHOULD NOT DUPLICATE</style>' }, context);
    assert.equal(duplicate.status, 'ok');
    assert.equal(duplicate.data.alreadyApplied, true);

    const second = await registry.execute('cap_filesystem_project_document_write', { operation: 'append', sessionId: 'test-session', requestId: 'chunk-2', expectedRevision: 1, path: target, content: '<section class="page">P1</section>' }, context);
    assert.equal(second.status, 'ok');
    assert.equal(second.data.revision, 2);
    assert.equal(fs.readFileSync(target, 'utf8'), '<style>.neon-card{gap:8px}</style><section class="page">P1</section>');

    const finish = await registry.execute('cap_filesystem_project_document_write', { operation: 'finish', sessionId: 'test-session', expectedRevision: 2, path: target }, context);
    assert.equal(finish.status, 'ok');
    assert.equal(finish.data.status, 'finished');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AI 视觉文档插件接受 Agent 协议中的下划线 requestId', async () => {
  const registry = await getToolRegistry();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-visual-writer-request-'));
  const target = path.join(root, 'ai-beautified.html');
  try {
    const context = { allowedRoots: [root], consumerId: 'test.ai-visual-document-writer' };
    const begin = await registry.execute('cap_filesystem_project_document_write', { operation: 'begin', sessionId: 'test-session', path: target }, context);
    assert.equal(begin.status, 'ok');
    const append = await registry.execute('cap_filesystem_project_document_write', {
      operation: 'append', sessionId: 'test-session', requestId: 'tr_visual_append_3', expectedRevision: 0,
      path: target, content: '<!doctype html>',
    }, context);
    assert.equal(append.status, 'ok');
    assert.equal(append.data.revision, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('AI 视觉文档插件处理无效 requestId 时不会产生未处理拒绝', async () => {
  const registry = await getToolRegistry();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-visual-writer-rejection-'));
  const target = path.join(root, 'ai-beautified.html');
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    const context = { allowedRoots: [root], consumerId: 'test.ai-visual-document-writer' };
    const begin = await registry.execute('cap_filesystem_project_document_write', { operation: 'begin', sessionId: 'test-session', path: target }, context);
    assert.equal(begin.status, 'ok');
    const result = await registry.execute('cap_filesystem_project_document_write', {
      operation: 'append', sessionId: 'test-session', requestId: 'invalid request id', expectedRevision: 0,
      path: target, content: '<p>不会写入</p>',
    }, context);
    assert.equal(result.status, 'error');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(unhandled.length, 0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AI 视觉文档插件拒绝越过授权根目录', async () => {
  const registry = await getToolRegistry();
  const allowed = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-visual-writer-allowed-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-visual-writer-outside-'));
  try {
    const result = await registry.execute('cap_filesystem_project_document_write', { operation: 'begin', sessionId: 'test-session', path: path.join(outside, 'ai-beautified.html') }, { allowedRoots: [allowed] });
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'PATH_OUTSIDE_ALLOWED_ROOTS');
  } finally {
    fs.rmSync(allowed, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
