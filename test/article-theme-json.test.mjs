import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { TYPESET_THEMES, markdownToHtml } from '../server/features/articles/application/typeset-pipeline.mjs';
import { articleThemeDefinition, compileArticleTheme } from '../server/shared/themes/article-theme-compiler.mjs';
import { getBuiltinThemeRegistry } from '../server/shared/themes/theme-registry.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('阶段 2 旧 TYPESET_THEMES 仅是 JSON 注册中心的兼容只读视图', () => {
  const registry=getBuiltinThemeRegistry();
  assert.equal(Object.keys(TYPESET_THEMES).length,6);
  for(const [id,legacy] of Object.entries(TYPESET_THEMES)){
    const definition=registry.require(id);
    assert.equal(legacy.label,definition.label);
    assert.equal(legacy.version,definition.version);
    assert.equal(legacy.hash,definition.hash);
    assert.ok(Object.isFrozen(legacy));
  }
  assert.ok(Object.isFrozen(TYPESET_THEMES));
});

test('阶段 2 文章配方由 JSON 编译为确定性渲染契约', () => {
  const tech=compileArticleTheme(articleThemeDefinition('tech-wire',{fallback:false}));
  assert.equal(tech.variants.frame,'terminal-frame');
  assert.equal(tech.variants.h2,'terminal');
  assert.equal(tech.variants.list,'chevron');
  assert.equal(tech.definition.tokens.typography.headingFamily,'mono');
  assert.equal(tech.tokens.colors.accent,'#39D353');
  assert.match(tech.hash,/^sha256:/);
  assert.equal(articleThemeDefinition('missing',{fallback:false}),null);
  assert.equal(articleThemeDefinition('missing').id,'magazine-warm');
});

test('阶段 2 内置文章主题使用可落地的 Windows 中文字体角色', () => {
  const registry=getBuiltinThemeRegistry();
  assert.equal(registry.require('career-essay').tokens.typography.family,'kai');
  assert.equal(registry.require('career-essay').tokens.typography.headingFamily,'kai');
  assert.equal(registry.require('magazine-warm').tokens.typography.family,'song');
  assert.equal(registry.require('magazine-warm').tokens.typography.headingFamily,'song');
  assert.equal(registry.require('gossip-card').tokens.typography.family,'hei');
  assert.equal(registry.require('gossip-card').tokens.typography.headingFamily,'hei');
  assert.equal(registry.require('news-digest').tokens.typography.family,'hei');
  assert.equal(registry.require('news-digest').tokens.typography.headingFamily,'hei');
  assert.equal(registry.require('research-report').tokens.typography.family,'song');
  assert.equal(registry.require('research-report').tokens.typography.headingFamily,'song');
  assert.equal(registry.require('tech-wire').tokens.typography.headingFamily,'mono');
});

test('阶段 2 生产渲染模块不再内置主题色或按主题 ID 分支样式', () => {
  const source=fs.readFileSync(path.join(root,'server','features','articles','application','typeset-pipeline.mjs'),'utf8');
  assert.doesNotMatch(source,/const LEGACY_TYPESET_THEMES/);
  assert.doesNotMatch(source,/themeName\s*===/);
  for(const color of ['#F5EFE3','#FF6B35','#0D1117','#0F2B4C','#F6EFDF','#D61F26'])assert.doesNotMatch(source,new RegExp(color,'i'));
  const chartSource=fs.readFileSync(path.join(root,'server','features','articles','rendering','chart-theme.mjs'),'utf8');
  assert.doesNotMatch(chartSource,/const surfaces\s*=/);
  assert.doesNotMatch(chartSource,/'(?:gossip-card|news-digest|tech-wire|research-report|career-essay|magazine-warm)'\s*:/);
});

test('阶段 2 JSON 切换后六套文章主题继续通过固定结构渲染', () => {
  const markdown='# 标题\n\n## 章节\n\n正文。\n\n> 引述\n\n- 要点\n\n---';
  for(const id of Object.keys(TYPESET_THEMES)){
    const html=markdownToHtml(markdown,{theme:id});
    assert.match(html,/<article style=/);
    assert.match(html,/<h1 style=/);
    assert.match(html,/<h2 style=/);
    assert.match(html,/<section style=/);
  }
});
