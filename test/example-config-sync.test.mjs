import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/platform/core/config.mjs';
import { APP_FIELDS } from '../server/platform/integrations/runtime-settings.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('项目不再提供根 .env 配置模板', () => {
  assert.equal(fs.existsSync(path.join(root, '.env.example')), false);
});

function leafEntries(value, prefix = '', into = new Map()) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) leafEntries(item, prefix ? `${prefix}.${key}` : key, into);
  } else {
    into.set(prefix, value);
  }
  return into;
}

test('config.example.json 与内置默认配置结构一致', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'config-defaults-'));
  try {
    const defaults = loadConfig(tempRoot);
    const example = JSON.parse(fs.readFileSync(path.join(root, 'config.example.json'), 'utf8'));
    // 路径类字段会被 loadConfig 解析为绝对路径，只比结构不比值
    const pathFields = new Set(['workspaceRoot', 'contentRoots', 'rsshub.rootDir', 'rsshub.startScript', 'rsshub.stopScript', 'rsshub.pidFile']);
    // 模型服务商、默认模型及其能力字段已迁入 extension_settings，示例文件只覆盖部署/运行参数。
    const databaseFields = (key) => key === 'llm.defaultProvider' || key.startsWith('llm.providers.');
    const defaultLeaves = leafEntries(defaults);
    const exampleLeaves = leafEntries(example);
    const onlyDefault = [...defaultLeaves.keys()].filter((key) => !databaseFields(key) && !exampleLeaves.has(key));
    const onlyExample = [...exampleLeaves.keys()].filter((key) => !databaseFields(key) && !defaultLeaves.has(key));
    assert.deepEqual({ onlyDefault, onlyExample }, { onlyDefault: [], onlyExample: [] }, '示例配置与默认配置键集合漂移');
    for (const [key, value] of exampleLeaves) {
      if (pathFields.has(key) || databaseFields(key)) continue;
      assert.deepEqual(value, defaultLeaves.get(key), `config.example.json 的 ${key} 与默认值不一致`);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
