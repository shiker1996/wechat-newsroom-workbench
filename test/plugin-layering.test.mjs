import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root=path.resolve(import.meta.dirname,'..');

test('插件不依赖项目 server，collector 框架不混入具体实现',()=>{
  const pluginFiles=[];
  const visit=(directory)=>{
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())visit(file);
      else if(entry.isFile()&&entry.name.endsWith('.mjs'))pluginFiles.push(file);
    }
  };
  visit(path.join(root,'plugins'));
  for(const file of pluginFiles){
    assert.doesNotMatch(fs.readFileSync(file,'utf8'),/(?:\.\.\/)+server\/|(?:^|["'])server\//m,`${path.relative(root,file)} 反向依赖项目 server`);
  }
  for(const concrete of ['declarative-web-page.mjs','browser-page-runner.mjs','browser-page-worker.mjs']){
    assert.equal(fs.existsSync(path.join(root,'server','collectors',concrete)),false,`collector 具体实现仍位于 server：${concrete}`);
  }
});
