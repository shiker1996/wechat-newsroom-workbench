import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSocialCardPageTitle } from '../lib/rendering/social-card-title.mjs';

test('内容页标题去掉冒号后的解释句', () => {
  assert.equal(normalizeSocialCardPageTitle('三步上手：安装、打开、发送反馈'), '三步上手');
  assert.equal(normalizeSocialCardPageTitle('可视化编辑：直接改，不用打字描述'), '可视化编辑');
});

test('标题清理不误伤封面标题和短标题', () => {
  assert.equal(normalizeSocialCardPageTitle('告别逐条打字：可视化编辑让反馈更快', { kind: 'cover' }), '告别逐条打字：可视化编辑让反馈更快');
  assert.equal(normalizeSocialCardPageTitle('能力概览'), '能力概览');
  assert.equal(normalizeSocialCardPageTitle('  核心能力：  ', { kind: 'content' }), '核心能力');
});
