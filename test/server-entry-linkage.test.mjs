import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const serverUrl=new URL('../server.mjs',import.meta.url);
const source=fs.readFileSync(serverUrl,'utf8');

test('server 入口的本地命名导入均由目标模块真实导出',async()=>{
  const pattern=/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g;
  for(const match of source.matchAll(pattern)){
    const moduleUrl=new URL(match[2],serverUrl);
    const namespace=await import(moduleUrl);
    for(const item of match[1].split(',')){
      const imported=item.trim().split(/\s+as\s+/)[0];
      assert.ok(imported in namespace,`${match[2]} 未导出 ${imported}`);
    }
  }
});

test('server 不再注入 Phase 5 前的编辑室私有执行器',()=>{
  assert.doesNotMatch(source,/runEditorialTurn(?:Stream)?/);
  assert.match(source,/handleArticleRoutes\(\{/);
});

test('server 所有路由共享同一个已导入的 writeUtf8 绑定',()=>{
  assert.match(source,/import \{ createRouteHelpers, writeUtf8 \} from '\.\/server\/platform\/http\/route-helpers\.mjs'/);
  assert.doesNotMatch(source,/routeWriteUtf8/);
  assert.match(source,/handleMediaRoutes\(\{[^;]+writeUtf8/s);
  assert.match(source,/handleCandidateRoutes\(\{[^;]+writeUtf8/s);
});
