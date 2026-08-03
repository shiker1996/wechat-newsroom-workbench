import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildEnvContent, isValidApiKey, inspectSetup, readEnvFile } from '../scripts/setup.mjs';

const EXAMPLE = '# 注释\nDEEPSEEK_API_KEY=\nMINIMAX_API_KEY=\nWORKBENCH_PORT=\n';

test('buildEnvContent 写入用户提供的 Key，保留注释和空位', () => {
  const out = buildEnvContent(EXAMPLE, {}, { DEEPSEEK_API_KEY: 'sk-abc12345' });
  assert.ok(out.includes('# 注释'));
  assert.ok(out.includes('DEEPSEEK_API_KEY=sk-abc12345'));
  assert.ok(out.includes('MINIMAX_API_KEY='));
  assert.ok(!out.includes('MINIMAX_API_KEY=sk'));
});

test('buildEnvContent 保留已有值，空输入不覆盖', () => {
  const out = buildEnvContent(EXAMPLE, { MINIMAX_API_KEY: 'mm-existing' }, { DEEPSEEK_API_KEY: '  ' });
  assert.ok(out.includes('MINIMAX_API_KEY=mm-existing'));
  assert.ok(!/DEEPSEEK_API_KEY=\S/.test(out));
});

test('isValidApiKey 拒绝空值、过短和含空格的输入', () => {
  assert.equal(isValidApiKey(''), false);
  assert.equal(isValidApiKey('abc'), false);
  assert.equal(isValidApiKey('has space here'), false);
  assert.equal(isValidApiKey('sk-0123456789abcdef'), true);
  assert.equal(isValidApiKey('  sk-0123456789abcdef  '), true);
});

test('inspectSetup 幂等：缺失项 pending，补齐后 done', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-test-'));
  try {
    const before = inspectSetup(dir);
    assert.equal(before.deps, 'pending');
    assert.equal(before.config, 'pending');
    assert.equal(before.env, 'pending');
    assert.equal(before.rsshub, 'optional-missing');

    fs.mkdirSync(path.join(dir, 'node_modules', 'markdown-it'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.local.json'), '{}');
    fs.writeFileSync(path.join(dir, '.env'), 'DEEPSEEK_API_KEY=sk-abc12345\n');
    fs.mkdirSync(path.join(dir, 'RSSHub', 'lib'), { recursive: true });

    const partial = inspectSetup(dir);
    assert.equal(partial.deps, 'done');
    assert.equal(partial.config, 'done');
    assert.equal(partial.env, 'done');
    assert.equal(partial.rsshub, 'deps-missing');

    // 与 rsshub-start.ps1 一致：本地 tsx 运行时存在才算就绪
    fs.mkdirSync(path.join(dir, 'RSSHub', 'node_modules', 'tsx', 'dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'RSSHub', 'node_modules', 'tsx', 'dist', 'cli.mjs'), '');

    const after = inspectSetup(dir);
    assert.equal(after.deps, 'done');
    assert.equal(after.config, 'done');
    assert.equal(after.env, 'done');
    assert.equal(after.rsshub, 'done');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('inspectSetup 识别无 Key 的 .env 为 no-key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-test-'));
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'DEEPSEEK_API_KEY=\n');
    assert.equal(inspectSetup(dir).env, 'no-key');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('RSSHub 缺失时安装引导提供 GitHub 浅克隆并安装依赖', () => {
  const source = fs.readFileSync(new URL('../scripts/setup.mjs', import.meta.url), 'utf8');
  assert.match(source, /git['"], \['clone', '--depth', '1', 'https:\/\/github\.com\/DIYgod\/RSSHub\.git', 'RSSHub'/);
  assert.match(source, /npm['"], \['install', '--legacy-peer-deps'\], \{ cwd: path\.join\(root, 'RSSHub'\)/);
});

test('readEnvFile 忽略注释并剥离引号', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-test-'));
  try {
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, '# 注释\nA="quoted"\nB=plain\n', 'utf8');
    assert.deepEqual(readEnvFile(file), { A: 'quoted', B: 'plain' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
