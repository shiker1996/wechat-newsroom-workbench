import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectSetup } from '../scripts/setup.mjs';

test('inspectSetup 只检查依赖、基础配置和 RSSHub，不再要求根 .env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-test-'));
  try {
    const before = inspectSetup(dir);
    assert.equal(before.deps, 'pending');
    assert.equal(before.config, 'pending');
    assert.equal(before.rsshub, 'optional-missing');
    assert.equal('env' in before, false);

    fs.mkdirSync(path.join(dir, 'node_modules', 'markdown-it'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.local.json'), '{}');
    fs.mkdirSync(path.join(dir, 'RSSHub', 'lib'), { recursive: true });
    assert.equal(inspectSetup(dir).rsshub, 'deps-missing');

    fs.mkdirSync(path.join(dir, 'RSSHub', 'node_modules', 'tsx', 'dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'RSSHub', 'node_modules', 'tsx', 'dist', 'cli.mjs'), '');
    const after = inspectSetup(dir);
    assert.equal(after.deps, 'done');
    assert.equal(after.config, 'done');
    assert.equal(after.rsshub, 'done');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('安装向导不再创建或写入根 .env', () => {
  const source = fs.readFileSync(new URL('../scripts/setup.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /DEEPSEEK_API_KEY|MINIMAX_API_KEY|MOONSHOT_API_KEY/);
  assert.doesNotMatch(source, /path\.join\(root, '\.env'\)/);
  assert.match(source, /\[3\/3\].*RSSHub/);
});

test('RSSHub 缺失时安装向导提供 GitHub 浅克隆并安装依赖', () => {
  const source = fs.readFileSync(new URL('../scripts/setup.mjs', import.meta.url), 'utf8');
  assert.match(source, /git['"], \['clone', '--depth', '1', 'https:\/\/github\.com\/DIYgod\/RSSHub\.git', 'RSSHub'/);
  assert.match(source, /npm['"], \['install', '--legacy-peer-deps'\], \{ cwd: path\.join\(root, 'RSSHub'\)/);
});
