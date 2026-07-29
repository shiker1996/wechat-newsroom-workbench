import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadPluginManifests } from '../lib/tools/manifest-loader.mjs';
import {
  installToolPlugin, listToolPluginInstallEvents, listToolPluginVersions, readToolPluginCatalog,
  rollbackToolPlugin, setInstalledToolPluginStatus, uninstallToolPlugin, validateToolPluginDirectory,
} from '../lib/tools/package-manager.mjs';

function fixture(root,{id='trusted-demo',version='1.0.0',outsideImport=false}={}){
  const directory=path.join(root,`source-${id}-${version}`);
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'adapter.mjs'),outsideImport
    ? "import '../outside.mjs'; export async function execute(){return {status:'ok',data:{}}}"
    : "export async function health(){return {status:'ok',data:{available:true}}} export async function execute(){return {status:'ok',data:{value:1}}}",'utf8');
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({
    schemaVersion:1,id,name:'Trusted Demo',version,type:'local-adapter',capabilities:['demo.read'],
    entry:'./adapter.mjs',riskLevel:'read-only',inputSchema:{type:'object'},outputSchema:{type:'object'},
    source:{type:'reviewed-package',url:'https://example.com/trusted-demo'},
    compatibleApp:'>=0.1.0',permissions:{networkDomains:[],pathAccess:[],externalWrite:false,credentials:[]},
    enabledByDefault:false,
  },null,2),'utf8');
  return directory;
}

test('trusted local plugin lifecycle preserves versions and requires explicit enable',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tool-plugin-package-'));
  try{
    const source=fixture(root);
    assert.equal(validateToolPluginDirectory(source).manifest.id,'trusted-demo');
    const installed=installToolPlugin({workspaceRoot:root,directory:source,builtinIds:[]});
    assert.equal(installed.status,'disabled');
    assert.equal(installed.restartRequired,true);
    setInstalledToolPluginStatus(root,'trusted-demo','enabled');
    const activeRoot=path.join(root,'data','installed-tool-plugins');
    const loaded=await loadPluginManifests({pluginsRoot:activeRoot,allowlist:['trusted-demo']});
    assert.equal(loaded[0].manifest.source.type,'reviewed-package');
    installToolPlugin({workspaceRoot:root,directory:fixture(root,{version:'1.1.0'}),builtinIds:[]});
    assert.deepEqual(listToolPluginVersions(root,'trusted-demo'),['1.0.0']);
    const rolledBack=rollbackToolPlugin(root,'trusted-demo','1.0.0');
    assert.equal(rolledBack.version,'1.0.0');
    assert.equal(rolledBack.status,'disabled');
    uninstallToolPlugin(root,'trusted-demo');
    assert.equal(readToolPluginCatalog(root).plugins['trusted-demo'].status,'uninstalled');
    assert.ok(listToolPluginInstallEvents(root).length>=5);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('plugin validation rejects built-in collisions, escaping imports and incompatible app',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tool-plugin-policy-'));
  try{
    assert.throws(()=>installToolPlugin({workspaceRoot:root,directory:fixture(root),builtinIds:['trusted-demo']}),/内置插件冲突/);
    fs.writeFileSync(path.join(root,'outside.mjs'),'export default true','utf8');
    assert.throws(()=>validateToolPluginDirectory(fixture(root,{id:'escape-demo',outsideImport:true})),/import 超出插件包/);
    const incompatible=fixture(root,{id:'future-demo'});
    const manifest=JSON.parse(fs.readFileSync(path.join(incompatible,'manifest.json'),'utf8'));
    manifest.compatibleApp='>=9.0.0';
    fs.writeFileSync(path.join(incompatible,'manifest.json'),JSON.stringify(manifest),'utf8');
    assert.throws(()=>validateToolPluginDirectory(incompatible),/当前工作台/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
