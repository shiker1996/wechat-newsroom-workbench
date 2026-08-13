import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStaticPage, assistStaticPage } from '../lib/collectors/static-page-assistant.mjs';

const html=`<!doctype html><html><body><main>
  <article class="news-entry"><h2><a href="/one">第一条新闻</a></h2><p class="summary">摘要一</p><time datetime="2026-01-01">一月一日</time></article>
  <article class="news-entry"><h2><a href="/two">第二条新闻</a></h2><p class="summary">摘要二</p><time datetime="2026-01-02">一月二日</time></article>
  <article class="news-entry"><h2><a href="/three">第三条新闻</a></h2><p class="summary">摘要三</p><time datetime="2026-01-03">一月三日</time></article>
  <article class="news-entry"><h2><a href="/four">第四条新闻</a></h2><p class="summary">摘要四</p><time datetime="2026-01-04">一月四日</time></article>
</main></body></html>`;

test('静态页面助手识别重复文章并生成可真实提取的配置',()=>{
  const candidates=analyzeStaticPage(html,'https://example.com/news');
  assert.ok(candidates.length>=1);
  assert.equal(candidates[0].config.itemSelector,'article.news-entry');
  assert.equal(candidates[0].config.titleSelector,'h2');
  assert.equal(candidates[0].config.linkSelector,'a');
  assert.equal(candidates[0].preview.length,4);
  assert.equal(candidates[0].preview[0].url,'https://example.com/one');
});

test('AI 可选字段经二次真实提取验证后写入候选',async()=>{const gateway={complete:async(input)=>input.purpose==='source-field-enrichment'?{content:'{"items":[{"index":0,"summarySelector":"p.summary","dateSelector":"time","dateAttribute":"datetime"}]}' }:{content:'{"order":[0],"reason":"唯一候选"}'}};const result=await assistStaticPage({pluginId:'declarative-web-page',url:'https://example.com/news'},{fetchPage:async()=>({html,url:'https://example.com/news'}),gateway});assert.equal(result.aiFieldsApplied,true);assert.equal(result.candidates[0].config.summarySelector,'p.summary');assert.equal(result.candidates[0].config.dateSelector,'time');assert.equal(result.candidates[0].preview[0].summary,'摘要一');assert.equal(result.candidates[0].preview[0].publishedAt,'2026-01-01T00:00:00.000Z');});

test('静态页面助手只接受静态网页采集器并返回验证候选',async()=>{
  await assert.rejects(()=>assistStaticPage({pluginId:'browser-web-page',url:'https://example.com'}),/仅支持静态/);
  const result=await assistStaticPage({pluginId:'declarative-web-page',url:'https://example.com/news'},{fetchPage:async()=>({html,url:'https://example.com/news'})});
  assert.equal(result.status,'ok');assert.equal(result.candidates[0].validation.passed,true);
});

test('静态页面没有列表时降级到浏览器渲染并转换为动态采集配置',async()=>{
  const result=await assistStaticPage({pluginId:'declarative-web-page',url:'https://example.com/news'}, {
    fetchPage:async()=>({html:'<html><body><div id="app"></div></body></html>',url:'https://example.com/news'}),
    renderPage:async()=>({html,url:'https://example.com/news',title:'动态新闻'}),
  });
  assert.equal(result.page.mode,'dynamic');assert.equal(result.targetPluginId,'browser-web-page');
  assert.equal(result.candidates[0].config.waitForSelector,'article.news-entry');
  assert.equal(result.candidates[0].config.profileId,'default');
});
