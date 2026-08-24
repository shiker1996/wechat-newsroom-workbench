import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const files=[
  '../server/platform/http/routes/article-routes.mjs',
  '../server/platform/plugin-sdk/github-client.mjs',
  '../plugins/mermaid-render/scripts/render-mermaid.mjs',
  '../plugins/echarts-render/scripts/render-echarts.mjs',
  '../plugins/url-fetch/scripts/fetch-hotspot-url.py',
];
const suspicious=/\?{4,}|锛|锟|鍥存爮|澶辫触|涓嶆敮鎸|鏈壘鍒|鍚姩|闂ㄧ/;

test('R2 关键生产文件不再引入已知乱码模式',()=>{
  for(const relative of files){
    const source=fs.readFileSync(new URL(relative,import.meta.url),'utf8');
    assert.doesNotMatch(source,suspicious,relative);
  }
});
