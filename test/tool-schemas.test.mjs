import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInput } from '../server/platform/tools/schemas.mjs';

test('可选对象字段显式传 undefined 视为缺省，不触发类型校验', () => {
  const schema = { type: 'object', required: ['targetUrl'], properties: { targetUrl: { type: 'string' }, sourceFetch: { type: 'object' } } };
  assert.equal(validateInput(schema, { targetUrl: 'https://github.com/a/b', sourceFetch: undefined }), '');
  assert.equal(validateInput(schema, { targetUrl: 'https://github.com/a/b', sourceFetch: { upgradeThreshold: 55 } }), '');
  assert.equal(validateInput(schema, { targetUrl: 'https://github.com/a/b', sourceFetch: 'yes' }), 'sourceFetch必须是对象');
});

test('必填字段传 undefined 仍按缺失处理', () => {
  const schema = { type: 'object', required: ['targetUrl'], properties: { targetUrl: { type: 'string' } } };
  assert.equal(validateInput(schema, { targetUrl: undefined }), '缺少必要参数：targetUrl');
});
