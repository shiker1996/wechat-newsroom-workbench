import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileThemePreview, ARTICLE_THEME_SPECIMEN, SOCIAL_THEME_SPECIMEN } from '../lib/themes/theme-preview.mjs';
import { articleThemeDefinition } from '../lib/themes/article-theme-compiler.mjs';
import { socialThemeDefinition } from '../lib/themes/social-theme-compiler.mjs';
import { markdownToHtml } from '../lib/llm/typeset-pipeline.mjs';
import { renderStoryboardHtml } from '../lib/llm/social-card-pipeline.mjs';
import { handleThemeRoutes } from '../lib/http/routes/theme-routes.mjs';

test('阶段 2 文章固定样稿直接包含正式排版编译结果',()=>{
  const definition=articleThemeDefinition('magazine-warm');
  const production=markdownToHtml(ARTICLE_THEME_SPECIMEN,{themeDefinition:definition,kicker:'PRODUCTION SPECIMEN'});
  const preview=compileThemePreview({target:'article',definition});
  assert.ok(preview.html.includes(production));
  assert.deepEqual(preview.usageMap,Object.fromEntries(Object.entries(preview.usageMap)));
  assert.equal(compileThemePreview({target:'article',definition}).html,preview.html);
});

test('阶段 2 图文固定样稿直接包含正式故事板编译结果',()=>{
  const definition=socialThemeDefinition('ice-blue');
  const production=renderStoryboardHtml({...SOCIAL_THEME_SPECIMEN,visualStyle:definition.id,themeDefinition:definition});
  const preview=compileThemePreview({target:'social',definition});
  for(const signature of ['--page:#f9fcff','class="page page-cover','class="stat-row"','class="content-block code-block"','class="page page-ending']){
    assert.ok(production.includes(signature),signature);
    assert.ok(preview.html.includes(signature),signature);
  }
  assert.match(preview.html,/class="page page-cover/);
  assert.match(preview.html,/class="page page-ending/);
});

test('阶段 2 字段影响位置使用预览外壳高亮且不改写生产 HTML',()=>{
  const definition=articleThemeDefinition('gossip-card');
  const plain=compileThemePreview({target:'article',definition});
  const highlighted=compileThemePreview({target:'article',definition,highlightField:'tokens.colors.codeBackground'});
  assert.doesNotMatch(plain.html,/outline:3px solid/);
  assert.match(highlighted.html,/code,pre\{outline:3px solid/);
});

test('阶段 2 提供不保存主题定义的正式预览接口',async()=>{
  const definition=structuredClone(articleThemeDefinition('magazine-warm'));definition.source='user';definition.id='unsaved-preview';delete definition.hash;
  let result;
  await handleThemeRoutes({request:{method:'POST'},response:{},pathname:'/api/themes/preview',searchParams:new URLSearchParams(),body:async()=>({target:'article',definition}),json:(_response,status,data)=>{result={status,data};}});
  assert.equal(result.status,200);
  assert.equal(result.data.theme.id,'unsaved-preview');
  assert.match(result.data.html,/production-preview/);
});

test('主题中心使用生产预览接口和隔离 iframe，不再手写样稿解释器',()=>{
  const ui=fs.readFileSync(new URL('../public/src/views/theme-manager.js',import.meta.url),'utf8');
  assert.match(ui,/request\('\/api\/themes\/preview'/);
  assert.match(ui,/frame\.srcdoc=result\.html/);
  assert.match(ui,/sandbox=""/);
  assert.doesNotMatch(ui,/allow-same-origin/);
  assert.doesNotMatch(ui,/colorContrast|FIXED SAMPLE|theme-live-bordered/);
});
