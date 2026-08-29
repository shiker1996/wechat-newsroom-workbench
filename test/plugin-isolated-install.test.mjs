import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { stageAllBuiltinPluginPackages } from '../server/platform/plugins/distribution.mjs';
import { installToolPlugin, readToolPluginCatalog, setInstalledToolPluginStatus, uninstallToolPlugin, validateToolPluginDirectory } from '../server/platform/tools/package-manager.mjs';
import { installCollectorPlugin, readCollectorPluginCatalog, setCollectorPluginStatus, uninstallCollectorPlugin, validateCollectorPluginDirectory } from '../server/platform/collectors/package-manager.mjs';

const projectRoot=path.resolve(import.meta.dirname,'..');
function workspace(t,prefix){const root=fs.mkdtempSync(path.join(os.tmpdir(),prefix));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}

test('全部内置插件可作为不携带其他源码的第三方包独立校验、加载和卸载',async t=>{
  const packagesRoot=workspace(t,'builtin-plugin-packages-'),runtimeRoot=workspace(t,'builtin-plugin-runtime-');
  const packages=stageAllBuiltinPluginPackages(path.join(projectRoot,'plugins'),packagesRoot);
  assert.equal(packages.length,17);
  for(const item of packages){
    const files=fs.readdirSync(item.directory);
    assert.equal(files.includes('manifest.json'),true);
    assert.equal(files.includes('data'),false,`${item.manifest.id} 分发包携带了运行数据`);
    assert.equal(files.includes('node_modules'),false,`${item.manifest.id} 分发包携带了依赖目录`);
    if(item.manifest.kind==='collector'){
      validateCollectorPluginDirectory(item.directory);
      const module=await import(pathToFileURL(path.join(item.directory,item.manifest.entry)).href);
      assert.equal(typeof module.createAdapter,'function',`${item.manifest.id} 无法加载 Collector 入口`);
      installCollectorPlugin(runtimeRoot,item.directory,[]);
      setCollectorPluginStatus(runtimeRoot,item.manifest.id,'enabled');
      uninstallCollectorPlugin(runtimeRoot,item.manifest.id);
      assert.equal(readCollectorPluginCatalog(runtimeRoot).plugins[item.manifest.id].status,'uninstalled');
    }else{
      validateToolPluginDirectory(item.directory);
      const module=await import(pathToFileURL(path.join(item.directory,item.manifest.entry)).href);
      assert.equal(typeof module.execute,'function',`${item.manifest.id} 无法加载工具入口`);
      if(typeof module.health==='function')assert.ok(await module.health({result:{ok:(data)=>({status:'ok',data}),failure:(code,message)=>({status:'error',error:{code,message}})}}));
      installToolPlugin({workspaceRoot:runtimeRoot,directory:item.directory,builtinIds:[]});
      setInstalledToolPluginStatus(runtimeRoot,item.manifest.id,'enabled');
      uninstallToolPlugin(runtimeRoot,item.manifest.id);
      assert.equal(readToolPluginCatalog(runtimeRoot).plugins[item.manifest.id].status,'uninstalled');
    }
  }
  assert.equal(fs.existsSync(path.join(projectRoot,'plugins','shared')),false);
});

test('插件代码卸载不删除独立运行数据',t=>{
  const packagesRoot=workspace(t,'plugin-data-package-'),runtimeRoot=workspace(t,'plugin-data-runtime-');
  const [item]=stageAllBuiltinPluginPackages(path.join(projectRoot,'plugins'),packagesRoot).filter(({manifest})=>manifest.kind==='tool');
  installToolPlugin({workspaceRoot:runtimeRoot,directory:item.directory,builtinIds:[]});
  const dataFile=path.join(runtimeRoot,'data','plugin-runtime',item.manifest.id,'state','state.json');
  fs.mkdirSync(path.dirname(dataFile),{recursive:true});fs.writeFileSync(dataFile,'{}');
  uninstallToolPlugin(runtimeRoot,item.manifest.id);
  assert.equal(fs.existsSync(dataFile),true);
});
