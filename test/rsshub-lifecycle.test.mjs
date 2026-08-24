import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/platform/core/config.mjs';
import { normalizeRssHubLifecycleConfig } from '../plugins/rsshub/collector.mjs';

test('RSSHub 生命周期路径相对项目根目录解析', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-rsshub-config-'));
  try {
    const config=loadConfig(root);
    assert.equal(config.workspaceRoot,root);
    assert.equal(config.rsshub.rootDir,path.join(root,'RSSHub'));
    assert.equal(config.rsshub.startScript,path.join(root,'scripts','runtime','rsshub-start.ps1'));
    assert.equal(config.rsshub.stopScript,path.join(root,'scripts','runtime','rsshub-stop.ps1'));
    assert.equal(config.rsshub.pidFile,path.join(root,'data','rsshub.pid'));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('RSSHub 兼容迁移旧启停脚本路径', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'newsroom-rsshub-legacy-config-'));
  try {
    fs.writeFileSync(path.join(root,'config.local.json'),JSON.stringify({rsshub:{
      startScript:'scripts/rsshub-start.ps1',
      stopScript:path.join(root,'scripts','rsshub-stop.ps1'),
    }}));
    const config=loadConfig(root);
    assert.equal(config.rsshub.startScript,path.join(root,'scripts','runtime','rsshub-start.ps1'));
    assert.equal(config.rsshub.stopScript,path.join(root,'scripts','runtime','rsshub-stop.ps1'));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('RSSHub 采集器归一化统一配置中的旧绝对路径和 HTML 空格实体', () => {
  const config=normalizeRssHubLifecycleConfig({
    startScript:'E:\\Documents\\write-assistant\\scripts\\rsshub-start.ps1 &#x20;',
    stopScript:'scripts/rsshub-stop.ps1',
  });
  assert.equal(config.startScript,'E:\\Documents\\write-assistant\\scripts\\runtime\\rsshub-start.ps1');
  assert.equal(config.stopScript,'scripts\\runtime\\rsshub-stop.ps1');
});

test('RSSHub 启停脚本不依赖 OpenClaw 或机器绝对路径', () => {
  const projectRoot=path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)),'..');
  const start=fs.readFileSync(path.join(projectRoot,'scripts','runtime','rsshub-start.ps1'),'utf8');
  const stop=fs.readFileSync(path.join(projectRoot,'scripts','runtime','rsshub-stop.ps1'),'utf8');
  assert.doesNotMatch(start+stop,/openclaw/i);
  assert.doesNotMatch(start+stop,/[A-Z]:\\Documents\\write-assistant/i);
  assert.match(start,/\$PSScriptRoot/);
  assert.match(start,/lib\\index\.ts/);
  assert.match(start,/node_modules\\tsx\\dist\\cli\.mjs/);
  assert.doesNotMatch(start,/Split-Path -Parent \$PSScriptRoot/);
  assert.match(start,/\[System\.IO\.Path\]::GetFullPath/);
  assert.doesNotMatch(stop,/Split-Path -Parent \$PSScriptRoot/);
  assert.match(stop,/\[System\.IO\.Path\]::GetFullPath/);
  assert.doesNotMatch(start,/npx\.cmd/i);
  assert.doesNotMatch(start,/Verifying routes|huxiu\/article/);
});
