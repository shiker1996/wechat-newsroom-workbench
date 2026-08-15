import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalSecurity } from '../lib/http/local-security.mjs';

const request=(method='GET',headers={})=>({method,headers:{host:'127.0.0.1:3000',...headers}});

test('本地 HTTP 边界拒绝非回环 Host、跨站 Origin 与缺失 CSRF 的写请求',()=>{
  const security=createLocalSecurity();
  assert.equal(security.validateBoundary(request('GET',{host:'evil.example'})).code,'HOST_NOT_ALLOWED');
  assert.equal(security.validateBoundary(request('GET',{origin:'https://evil.example'})).code,'ORIGIN_NOT_ALLOWED');
  assert.equal(security.validateBoundary(request('POST')).code,'CSRF_INVALID');
  assert.equal(security.validateBoundary(request('POST',{'x-csrf-token':security.csrfToken})),null);
});

test('敏感操作确认 token 绑定动作且只能消费一次',()=>{
  const security=createLocalSecurity();
  const wrong=security.issue('local-project-read');
  assert.equal(security.consume(request('POST',{'x-action-confirm':wrong}),'plugin-admin'),false);
  const valid=security.issue('local-project-read');
  const validRequest=request('POST',{'x-action-confirm':valid});
  assert.equal(security.consume(validRequest,'local-project-read'),true);
  assert.equal(security.consume(validRequest,'local-project-read'),false);
});
