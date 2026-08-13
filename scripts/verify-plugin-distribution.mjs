import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageAllBuiltinPluginPackages } from '../lib/plugins/distribution.mjs';
import { validateToolPluginDirectory } from '../lib/tools/package-manager.mjs';
import { validateCollectorPluginDirectory } from '../lib/collectors/package-manager.mjs';

const root=path.resolve(import.meta.dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'plugin-distribution-'));
try{
  const packages=stageAllBuiltinPluginPackages(path.join(root,'plugins'),temporary);
  for(const item of packages)(item.manifest.kind==='collector'?validateCollectorPluginDirectory:validateToolPluginDirectory)(item.directory);
  console.log(`插件分发验收完成：${packages.length} 个独立包`);
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
