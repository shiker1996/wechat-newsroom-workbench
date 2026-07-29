import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getToolRegistry, PHASE_A_PLUGINS } from '../lib/tools/index.mjs';
import { ToolRegistry } from '../lib/tools/registry.mjs';
import { ok } from '../lib/tools/schemas.mjs';
import { readToolPluginSettings, writeToolPluginSetting } from '../lib/tools/settings.mjs';

test('阶段 A 插件通过白名单加载并暴露稳定能力', async () => {
  const registry = await getToolRegistry();
  assert.deepEqual(PHASE_A_PLUGINS, ['local-project-reader', 'mermaid-render', 'echarts-render']);
  assert.deepEqual(registry.listCapabilities().map((item) => item.capability).sort(), [
    'content.repository.inspect', 'content.url.fetch', 'diagram.echarts.render', 'diagram.mermaid.render', 'filesystem.project.read', 'image.cdn.upload',
  ]);
});

test('阶段 B URL 插件保留抓取方法与来源信息', async () => {
  const registry = await getToolRegistry();
  const root = process.cwd();
  const summary = 'RSS 已提供完整正文。'.repeat(120);
  const result = await registry.execute('content.url.fetch', {
    targetUrl:'https://example.com/article', title:'示例', root,
    hotspot:{ source_type:'rsshub', raw_json:JSON.stringify({ summary }) },
  }, { allowedRoots:[root] });
  assert.equal(result.status, 'ok');
  assert.equal(result.data.fetch_method, 'rss-content');
  assert.equal(result.provenance.fetchMethod, 'rss-content');
  assert.equal(result.provenance.requestedUrl, 'https://example.com/article');
});

test('全部工具能力提供标准健康检查结果', async () => {
  const registry=await getToolRegistry();
  const results=await Promise.all(registry.listCapabilities().map((item)=>registry.health(item.capability)));
  assert.equal(results.length,6);
  for(const result of results)assert.ok(['ok','error'].includes(result.status));
});

test('插件健康检查异常被标准化而不拖垮能力列表',async()=>{
  const registry=new ToolRegistry().register({
    manifest:{id:'health-test',version:'1.0.0',capabilities:['test.health'],riskLevel:'read-only',
      enabledByDefault:true,inputSchema:{type:'object'},outputSchema:{type:'object'}},
    adapter:{execute:async()=>ok(),health:async()=>{throw new Error('health exploded');}},
  });
  const result=await registry.health('test.health');
  assert.equal(result.status,'error');
  assert.equal(result.error.code,'OUTPUT_INVALID');
  assert.match(result.error.message,/health exploded/);
});

test('外部上传能力没有明确授权时在执行前被拦截', async () => {
  const registry = await getToolRegistry();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-upload-'));
  const localPath = path.join(root, 'image.png');
  try {
    fs.writeFileSync(localPath, 'not-an-image');
    const result = await registry.execute('image.cdn.upload', { localPath }, { allowedRoots:[root] });
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'PERMISSION_DENIED');
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('权限拒绝和输入错误也写入工具执行审计', async () => {
  const registry=await getToolRegistry();const records=[];
  const result=await registry.execute('image.cdn.upload',{},{
    allowedRoots:[],executionLog:(record)=>records.push(record),
  });
  assert.equal(result.error.code,'INVALID_INPUT');
  assert.equal(records.length,1);
  assert.equal(records[0].status,'error');
  assert.equal(records[0].errorCode,'INVALID_INPUT');
});

test('插件输出必须通过 manifest 声明的输出契约', async () => {
  const registry=new ToolRegistry().register({
    manifest:{id:'contract-test',version:'1.0.0',capabilities:['test.contract'],riskLevel:'read-only',
      enabledByDefault:true,inputSchema:{type:'object'},outputSchema:{type:'object',required:['value'],properties:{value:{type:'string'}}}},
    adapter:{execute:async()=>ok({value:42})},
  });
  const result=await registry.execute('test.contract',{});
  assert.equal(result.status,'error');
  assert.equal(result.error.code,'OUTPUT_INVALID');
  assert.match(result.error.message,/value 必须是字符串/);
});

test('技能工具白名单在策略层阻止未授权能力执行', async () => {
  const registry=await getToolRegistry();
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tool-capability-policy-'));
  try{
    const inputPath=path.join(root,'input.md'),outputPath=path.join(root,'output.md'),imageDir=path.join(root,'images');
    fs.writeFileSync(inputPath,'# no chart','utf8');
    const result=await registry.execute('diagram.mermaid.render',{inputPath,outputPath,imageDir},{
      allowedRoots:[root],allowedCapabilities:['content.url.fetch'],
    });
    assert.equal(result.status,'error');
    assert.equal(result.error.code,'PERMISSION_DENIED');
    assert.equal(fs.existsSync(outputPath),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('注册中心拒绝越过授权根目录的本地读取', async () => {
  const registry = await getToolRegistry();
  const allowed = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-allowed-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-outside-'));
  try {
    const result = await registry.execute('filesystem.project.read', { path:outside }, { allowedRoots:[allowed] });
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'PATH_OUTSIDE_ALLOWED_ROOTS');
  } finally {
    fs.rmSync(allowed, { recursive:true, force:true });
    fs.rmSync(outside, { recursive:true, force:true });
  }
});

test('授权目录内的符号链接不能绕过真实路径边界', async (t) => {
  const registry=await getToolRegistry();
  const allowed=fs.mkdtempSync(path.join(os.tmpdir(),'tool-link-allowed-'));
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'tool-link-outside-'));
  const link=path.join(allowed,'linked-project');
  try{
    try{fs.symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');}
    catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('当前环境不允许创建目录链接');return;}throw error;}
    const result=await registry.execute('filesystem.project.read',{path:link},{allowedRoots:[allowed]});
    assert.equal(result.status,'error');
    assert.equal(result.error.code,'PATH_OUTSIDE_ALLOWED_ROOTS');
  }finally{
    fs.rmSync(allowed,{recursive:true,force:true});
    fs.rmSync(outside,{recursive:true,force:true});
  }
});

test('本地读取插件返回标准结果、版本和来源', async () => {
  const registry = await getToolRegistry();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-project-'));
  try {
    fs.writeFileSync(path.join(root, 'README.md'), '# demo', 'utf8');
    const result = await registry.execute('filesystem.project.read', { path:root }, { allowedRoots:[root] });
    assert.equal(result.status, 'ok');
    assert.equal(result.data.files[0].path, 'README.md');
    assert.equal(result.provenance.plugin, 'local-project-reader');
    assert.equal(result.provenance.version, '1.0.0');
    assert.ok(result.metrics.durationMs >= 0);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('输入契约错误返回 INVALID_INPUT', async () => {
  const registry = await getToolRegistry();
  const result = await registry.execute('filesystem.project.read', {}, { allowedRoots:[] });
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'INVALID_INPUT');
});

test('执行日志只记录参数名和插件版本，不复制输入正文', async () => {
  const registry = await getToolRegistry();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-log-'));
  const records = [];
  try {
    await registry.execute('filesystem.project.read', { path:root }, { allowedRoots:[root], executionLog:(record) => records.push(record) });
    assert.equal(records[0].plugin, 'local-project-reader');
    assert.equal(records[0].version, '1.0.0');
    assert.deepEqual(records[0].inputKeys, ['path']);
    assert.equal('input' in records[0], false);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('图表能力经注册中心调用适配器并返回标准报告', async () => {
  const registry = await getToolRegistry();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-chart-'));
  try {
    const inputPath = path.join(root, 'input.md');
    const outputPath = path.join(root, 'output.md');
    const imageDir = path.join(root, 'images');
    fs.writeFileSync(inputPath, '# 无图表正文\n', 'utf8');
    for (const capability of ['diagram.mermaid.render', 'diagram.echarts.render']) {
      const result = await registry.execute(capability, { inputPath, outputPath, imageDir }, { allowedRoots:[root], cwd:root });
      assert.equal(result.status, 'ok');
      assert.equal(result.data.converted, 0);
      assert.match(result.provenance.plugin, /render/);
    }
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('插件管理设置持久化启停和优先级并限制数值范围', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tool-plugin-settings-'));
  try{
    writeToolPluginSetting(root,'plugin-a',{enabled:false,priority:250});
    assert.deepEqual(readToolPluginSettings(root)['plugin-a'],{enabled:false,priority:100});
    writeToolPluginSetting(root,'plugin-a',{enabled:true,priority:-20});
    assert.deepEqual(readToolPluginSettings(root)['plugin-a'],{enabled:true,priority:-20});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('注册中心按管理设置排除停用实现并按优先级选择默认实现', async () => {
  const adapter={execute:async()=>ok({})};
  const manifest=(id)=>({id,version:'1.0.0',capabilities:['test.managed'],riskLevel:'read-only',
    enabledByDefault:true,inputSchema:{type:'object'},outputSchema:{type:'object'}});
  const registry=new ToolRegistry({settings:{
    low:{enabled:true,priority:1},high:{enabled:true,priority:9},off:{enabled:false,priority:100},
  }}).register({manifest:manifest('low'),adapter})
    .register({manifest:manifest('high'),adapter})
    .register({manifest:manifest('off'),adapter});
  assert.equal(registry.resolve('test.managed').manifest.id,'high');
  assert.deepEqual(registry.listCapabilities().map((item)=>item.plugin),['low','high']);
  assert.equal(registry.listCapabilities({includeDisabled:true}).find((item)=>item.plugin==='off').enabled,false);
  const preferred=registry.resolve('test.managed',{plugin:'low'});
  assert.equal(preferred.manifest.id,'low');
});
