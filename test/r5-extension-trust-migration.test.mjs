import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/platform/core/store.mjs';
import { applyLegacyConfigurationMigration, planLegacyConfigurationMigration } from '../server/platform/extensions/legacy-configuration-migrator.mjs';
import { installRemotePlugin, readRemotePluginCatalog, setRemotePluginStatus } from '../server/platform/tools/remote-package-manager.mjs';

const schema={type:'object',additionalProperties:false,properties:{endpoint:{type:'string'},apiKey:{type:'string',secret:true}},required:['endpoint','apiKey']};
const resource={type:'tool',id:'sample',name:'Sample',manifest:{id:'sample',configuration:schema}};
function workspace(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'r5-trust-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function remoteManifest(){return {schemaVersion:1,id:'remote-sample',name:'Remote sample',version:'1.0.0',type:'remote-api',capabilities:['content.search'],riskLevel:'network-read',endpoint:'https://example.com/tool',inputSchema:{type:'object'},outputSchema:{type:'object'},timeoutMs:5000,compatibleApp:'>=0.5.0'};}

test('R5.2 远程插件保存 Manifest 摘要并在启用前重新校验',t=>{
  const root=workspace(t),installed=installRemotePlugin(root,remoteManifest());
  assert.match(installed.manifestHash,/^sha256:[0-9a-f]{64}$/);
  const file=path.join(root,'data','remote-tool-plugins.json'),catalog=JSON.parse(fs.readFileSync(file,'utf8'));
  catalog.plugins['remote-sample'].manifest.endpoint='https://evil.example/tool';fs.writeFileSync(file,JSON.stringify(catalog));
  assert.throws(()=>setRemotePluginStatus(root,'remote-sample','enabled'),/完整性校验失败/);
  assert.throws(()=>installRemotePlugin(workspace(t),remoteManifest(),{expectedManifestHash:'sha256:'+'0'.repeat(64)}),/校验和不匹配/);
});

test('R5.2 legacy 跳过迁移前报告字段差异且秘密值改变配置摘要',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r5-trust-')),store=new Store(path.join(root,'workbench.db'));t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  store.saveExtensionSetting({extensionType:'tool',extensionId:'sample',value:{endpoint:'new'}});
  const skipped=planLegacyConfigurationMigration({resources:[resource],repository:store.repositories.extensionSettings,fallbackFor:()=>({endpoint:'old',apiKey:'secret-a'})})[0];
  assert.deepEqual(skipped.differences,[{field:'endpoint',kind:'value_differs'},{field:'apiKey',kind:'secret_legacy_present'}]);

  const hashes=[];
  for(const secret of ['secret-a','secret-b']){
    const id=`sample-${secret.at(-1)}`,item={...resource,id,manifest:{...resource.manifest,id}};
    const plan=planLegacyConfigurationMigration({resources:[item],repository:store.repositories.extensionSettings,fallbackFor:()=>({endpoint:'old',apiKey:secret})});
    applyLegacyConfigurationMigration({root,repository:store.repositories.extensionSettings,plan});hashes.push(store.getExtensionSetting('tool',id).config_hash);
  }
  assert.notEqual(hashes[0],hashes[1]);
});

test('R5.2 扩展变更路由统一要求 plugin-admin 确认并声明 fallback 下线版本',()=>{
  const source=fs.readFileSync(new URL('../server/platform/http/routes/system-routes.mjs',import.meta.url),'utf8');
  for(const marker of ['remoteStatusMatch','remoteFirstRunMatch','collectorConfirmMatch']){
    const start=source.indexOf(marker),segment=source.slice(start,start+900);assert.match(segment,/requirePluginAdmin\(request\)/,marker);
  }
  assert.match(source,/legacyFallbackRemovalVersion:LEGACY_CONFIGURATION_FALLBACK_REMOVAL_VERSION/);
});
