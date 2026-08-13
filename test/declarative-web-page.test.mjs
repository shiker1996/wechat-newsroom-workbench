import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicPageUrl, collectDeclarativePage, extractPageItems, fetchPublicPage } from '../plugins/declarative-web-page/collector.mjs';

const cards=`<!doctype html><main><article class="card"><h2><a href="/a">Alpha</a></h2><p class="summary">First story</p><time datetime="2026-08-12T08:00:00Z"></time></article><article class="card"><h2><a href="https://example.com/b">Beta</a></h2><p class="summary">Second story</p></article></main>`;
const list=`<ul id="news"><li data-entry><a class="headline" href="post/1">One</a><span class="by">Alice</span></li><li data-entry><a class="headline" href="post/2">Two</a><span class="by">Bob</span></li></ul>`;
const nested=`<section class="stream"><div class="entry"><header><a href="/same"><span>Nested title</span></a></header></div><div class="entry"><header><a href="/same">Duplicate</a></header></div></section>`;

test('声明式页面采集支持三种静态结构、相对 URL 和去重',()=>{
  const first=extractPageItems(cards,'https://example.com/news',{itemSelector:'.card',titleSelector:'h2 a',linkSelector:'h2 a',summarySelector:'.summary',dateSelector:'time',limit:10});
  assert.equal(first.items.length,2);assert.equal(first.items[0].url,'https://example.com/a');assert.equal(first.items[0].summary,'First story');assert.equal(first.items[0].publishedAt,'2026-08-12T08:00:00.000Z');
  const second=extractPageItems(list,'https://news.example/base/',{itemSelector:'#news [data-entry]',titleSelector:'.headline',linkSelector:'.headline',authorSelector:'.by',limit:10});
  assert.deepEqual(second.items.map((item)=>item.author),['Alice','Bob']);assert.equal(second.items[0].url,'https://news.example/base/post/1');
  const third=extractPageItems(nested,'https://example.com/',{itemSelector:'.entry',titleSelector:'header a',linkSelector:'header a',limit:10});assert.equal(third.matched,2);assert.equal(third.items.length,1);
});

test('条目选择器失效返回 SELECTOR_MISMATCH 而不是空成功',()=>{
  assert.throws(()=>extractPageItems(cards,'https://example.com/',{itemSelector:'.missing',limit:10}),(error)=>error.code==='SELECTOR_MISMATCH');
});

test('静态解析不会执行或提取脚本、样式及模板内容',()=>{
  const hostile=`<script><article><a href="/evil">Evil</a></article></script><style>.x{}</style><article><a href="/safe">Safe</a></article>`;
  const result=extractPageItems(hostile,'https://example.com/',{itemSelector:'article',titleSelector:'a',linkSelector:'a',limit:10});
  assert.deepEqual(result.items.map((item)=>item.title),['Safe']);
});

test('安全页面地址拒绝本机、内网和保留地址',async()=>{
  const lookup=async(host)=>[{address:host==='public.example'?'93.184.216.34':'127.0.0.1'}];
  await assert.rejects(()=>assertPublicPageUrl('http://localhost/private',lookup),/本机、内网或保留地址/);
  await assert.rejects(()=>assertPublicPageUrl('https://127.0.0.1/private',lookup),/本机、内网或保留地址/);
  assert.equal((await assertPublicPageUrl('https://public.example/news',lookup)).hostname,'public.example');
});

test('页面获取限制 HTML 类型、响应大小并逐跳校验重定向',async()=>{
  const lookup=async(host)=>[{address:host==='public.example'?'93.184.216.34':'10.0.0.2'}];
  const redirect=async()=>new Response('',{status:302,headers:{location:'http://internal.example/secret','content-type':'text/html'}});
  await assert.rejects(()=>fetchPublicPage('https://public.example/',{fetchImpl:redirect,dnsLookup:lookup}),/本机、内网或保留地址/);
  const binary=async()=>new Response('{}',{headers:{'content-type':'application/json'}});await assert.rejects(()=>fetchPublicPage('https://public.example/',{fetchImpl:binary,dnsLookup:lookup}),/不是 HTML/);
  const large=async()=>new Response('x'.repeat(50),{headers:{'content-type':'text/html'}});await assert.rejects(()=>fetchPublicPage('https://public.example/',{fetchImpl:large,dnsLookup:lookup,maxBytes:10}),/超过大小限制/);
});

test('有限分页抓取下一页并按 URL 去重',async()=>{
  const pages=new Map([['https://public.example/p1',`<article><a href="/a">A</a></article><a class="next" href="/p2">Next</a>`],['https://public.example/p2',`<article><a href="/a">A again</a></article><article><a href="/b">B</a></article>`]]);
  const fetchImpl=async(url)=>new Response(pages.get(url),{headers:{'content-type':'text/html'}}),dnsLookup=async()=>[{address:'93.184.216.34'}];
  const result=await collectDeclarativePage({url:'https://public.example/p1',itemSelector:'article',titleSelector:'a',linkSelector:'a',nextPageSelector:'.next',maxPages:3,limit:10},{fetchImpl,dnsLookup});
  assert.equal(result.provenance.pages,2);assert.deepEqual(result.items.map((item)=>item.url),['https://public.example/a','https://public.example/b']);
});
