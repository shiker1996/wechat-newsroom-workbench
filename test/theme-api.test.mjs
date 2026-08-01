import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleThemeRoutes, themeCatalog } from '../lib/http/routes/theme-routes.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('阶段 4 主题目录 API 按前端契约返回两类主题与预览元数据',()=>{
  const article=themeCatalog('article'),social=themeCatalog('social');
  assert.equal(article.defaultTheme,'magazine-warm');assert.equal(article.items.length,6);assert.equal(article.items[0].id,'magazine-warm');
  assert.equal(social.defaultTheme,'ice-blue');assert.equal(social.items.length,14);assert.equal(social.items[0].id,'neon');
  for(const item of [...article.items,...social.items]){assert.match(item.version,/^\d+\.\d+\.\d+$/);assert.equal(item.source,'builtin');assert.match(item.hash,/^sha256:/);assert.ok(item.preview.background&&item.preview.surface&&item.preview.ink&&item.preview.accent);}
});

test('阶段 4 列表和详情路由拒绝非法目标及未知主题',async()=>{
  const call=async(pathname,target='')=>{let result;await handleThemeRoutes({request:{method:'GET'},response:{},pathname,searchParams:new URLSearchParams(target?{target}:{}),json:(_res,status,data)=>{result={status,data};}});return result;};
  assert.equal((await call('/api/themes','article')).data.items.length,6);
  assert.equal((await call('/api/themes/ice-blue','social')).data.label,'冰川冷调');
  assert.equal((await call('/api/themes','bad')).status,400);assert.equal((await call('/api/themes/missing','social')).status,404);
});

test('阶段 4 前端选择器不再写死主题清单并由动态目录补齐',()=>{
  const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');const source=fs.readFileSync(path.join(root,'public','src','core','theme-catalog.js'),'utf8');
  assert.doesNotMatch(html,/<option value="(?:magazine-warm|gossip-card|neon|tokyo-night|paper-craft)">/);
  assert.match(html,/id="typeset-theme-preview"/);assert.match(html,/id="social-theme-preview"/);
  assert.match(source,/\/api\/themes\?target=/);assert.match(source,/catalog\.items\.forEach/);assert.match(source,/theme\.version/);
});
