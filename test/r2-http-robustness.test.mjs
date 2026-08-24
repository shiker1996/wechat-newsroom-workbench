import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { boundedLimit, createNdjsonSession } from '../server/platform/http/route-helpers.mjs';

test('limit 对 NaN、负数和超大值使用稳定边界',()=>{
  assert.equal(boundedLimit(new URLSearchParams('limit=NaN'),40,100),40);
  assert.equal(boundedLimit(new URLSearchParams('limit=-1'),40,100),40);
  assert.equal(boundedLimit(new URLSearchParams('limit=9999'),40,100),100);
  assert.equal(boundedLimit(new URLSearchParams('limit=25'),40,100),25);
});

test('NDJSON 会话在客户端断开后停止写入',()=>{
  const request=new EventEmitter();const response=new EventEmitter();
  Object.assign(response,{destroyed:false,writableEnded:false,writes:[],write(value){this.writes.push(value);return true;},end(){this.writableEnded=true;}});
  const stream=createNdjsonSession(request,response);
  assert.equal(stream.send({type:'ready'}),true);
  request.emit('aborted');
  assert.equal(stream.signal.aborted,true);
  assert.equal(stream.send({type:'late'}),false);
  assert.equal(response.writes.length,1);
});

test('请求体使用流式 UTF-8 解码且文件输出统一监听错误',()=>{
  const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
  const helpers=fs.readFileSync(new URL('../server/platform/http/route-helpers.mjs',import.meta.url),'utf8');
  assert.match(server,/decoder\.decode\(chunk, \{ stream: true \}\)/);
  assert.match(helpers,/source\.once\('error'/);
  assert.match(helpers,/response\.once\('close'/);
});
