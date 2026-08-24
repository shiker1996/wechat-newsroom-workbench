import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root=path.resolve(import.meta.dirname,'..');

test('内置 Collector 实现物理收敛到插件目录',()=>{
  for(const relative of [
    'plugins/reddit/collector.mjs',
    'plugins/rsshub/collector.mjs',
    'plugins/github-discovery/collector.mjs',
    'plugins/reddit/cdp-client.mjs',
  ])assert.equal(fs.existsSync(path.join(root,relative)),true,`${relative} 不存在`);
  for(const legacy of ['reddit.mjs','rsshub.mjs','github-discovery.mjs','cdp-client.mjs']){
    assert.equal(fs.existsSync(path.join(root,'collectors',legacy)),false,`旧实现仍残留：collectors/${legacy}`);
  }
});

test('每个内置 Collector 目录都由 Manifest 自描述',()=>{
  const pluginRoot=path.join(root,'plugins');
  const collectorDirectories=fs.readdirSync(pluginRoot,{withFileTypes:true})
    .filter((item)=>item.isDirectory()&&!item.name.startsWith('_'))
    .filter((directory)=>{
      const manifestFile=path.join(pluginRoot,directory.name,'manifest.json');
      return fs.existsSync(manifestFile)&&JSON.parse(fs.readFileSync(manifestFile,'utf8')).kind==='collector';
    });
  assert.deepEqual(collectorDirectories.map((item)=>item.name).sort(),['browser-web-page','declarative-web-page','feed','github-discovery','reddit','rsshub']);
  for(const directory of collectorDirectories){
    const manifestFile=path.join(pluginRoot,directory.name,'manifest.json');
    const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
    assert.equal(manifest.kind,'collector');
    assert.equal(fs.existsSync(path.resolve(path.dirname(manifestFile),manifest.entry)),true,`${manifest.id} 入口不存在`);
  }
  const registry=fs.readFileSync(path.join(root,'server','platform','collectors','builtin-registry.mjs'),'utf8');
  assert.doesNotMatch(registry,/BUILTIN_COLLECTOR_MANIFESTS\s*=\s*Object\.freeze\(\[/);
  assert.match(registry,/discoverBuiltinCollectorManifests/);
  assert.match(registry,/manifest\.kind!==['"]collector['"]\)continue/);
  const toolRegistry=fs.readFileSync(path.join(root,'server','platform','tools','index.mjs'),'utf8');
  assert.match(toolRegistry,/\.kind===['"]tool['"]/);
});
