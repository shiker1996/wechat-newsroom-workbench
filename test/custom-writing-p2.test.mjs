import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../server/platform/http/routes/candidate-routes.mjs',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const tutorial=fs.readFileSync(new URL('../public/src/views/tutorial.js',import.meta.url),'utf8');
const editorial=fs.readFileSync(new URL('../public/src/views/editorial.js',import.meta.url),'utf8');

test('自主写作项目统一输出四种可恢复状态',()=>{
  assert.match(server,/draft_ready/);
  assert.match(server,/generating/);
  assert.match(server,/failed/);
  assert.match(server,/ready_to_generate/);
  assert.match(tutorial,/project_status/);
});

test('自主写作项目列表提供加载播报、错误恢复、原项目重试和编辑入口',()=>{
  assert.match(html,/id="custom-writing-project-list"[^>]+aria-live="polite"[^>]+aria-busy="true"/);
  assert.match(tutorial,/data-reload-custom-writing/);
  assert.match(tutorial,/custom-article-runs/);
  assert.match(tutorial,/data-custom-writing-open/);
});

test('自主写作重试从文章轨道读取 output_mode 并以创建记录兜底识别',()=>{
  assert.match(server,/candidate\.tracks\?\.find\(\(item\) => item\.track === 'article'\)\?\.output_mode/);
  assert.match(server,/if \(!creation && !\['wechat-experience', 'wechat-tutorial'\]\.includes\(outputMode\)\)/);
});

test('热点事件创作由服务端过滤自主写作候选',()=>{
  assert.match(editorial,/candidates\?kind=hotspot/);
  assert.match(server,/kind === 'independent'/);
  assert.match(server,/kind === 'hotspot'/);
});

test('导航与文章池使用单一职责命名并提供类型筛选',()=>{
  assert.match(html,/data-view="topics">文章选题池/);
  assert.match(html,/data-view="editorial">热点事件/);
  assert.match(html,/选题管理[\s\S]*data-view="topics"[\s\S]*主动写作[\s\S]*data-view="material-inbox"[\s\S]*data-view="editorial"[\s\S]*data-view="daily"[\s\S]*data-view="tutorial"[\s\S]*统一编辑与交付/);
  assert.match(html,/data-article-type="hotspot">热点事件/);
  assert.match(html,/data-article-type="independent">自主写作/);
});
