import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root=path.resolve(import.meta.dirname,'..');

test('内置 Collector 实现物理收敛到插件目录',()=>{
  for(const relative of [
    'plugins/collectors/reddit/collector.mjs',
    'plugins/collectors/rsshub/collector.mjs',
    'plugins/collectors/github-discovery/collector.mjs',
    'plugins/collectors/_shared/cdp-client.mjs',
  ])assert.equal(fs.existsSync(path.join(root,relative)),true,`${relative} 不存在`);
  for(const legacy of ['reddit.mjs','rsshub.mjs','github-discovery.mjs','cdp-client.mjs']){
    assert.equal(fs.existsSync(path.join(root,'collectors',legacy)),false,`旧实现仍残留：collectors/${legacy}`);
  }
});

test('每个内置 Collector 目录都由 Manifest 自描述',()=>{
  for(const directory of fs.readdirSync(path.join(root,'plugins','collectors'),{withFileTypes:true}).filter((item)=>item.isDirectory()&&!item.name.startsWith('_'))){
    const manifestFile=path.join(root,'plugins','collectors',directory.name,'manifest.json');
    assert.equal(fs.existsSync(manifestFile),true,`${directory.name} 缺少 manifest.json`);
    const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
    assert.equal(manifest.kind,'collector');
    assert.equal(fs.existsSync(path.resolve(path.dirname(manifestFile),manifest.entry)),true,`${manifest.id} 入口不存在`);
  }
  const registry=fs.readFileSync(path.join(root,'lib','collectors','builtin-registry.mjs'),'utf8');
  assert.doesNotMatch(registry,/BUILTIN_COLLECTOR_MANIFESTS\s*=\s*Object\.freeze\(\[/);
  assert.match(registry,/discoverBuiltinCollectorManifests/);
});
