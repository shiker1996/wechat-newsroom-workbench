import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { markdownToHtml, runTypesetPipeline } from '../lib/typeset-pipeline.mjs';

test('公众号 Markdown 转换保留结构并应用设计 token', () => {
  const html = markdownToHtml(`# 标题

## 判断

正文有**重点**和[来源](https://example.com)。

> 边界提示

- 第一项
- 第二项`, { accentColor:'#123456', textColor:'#202020', mutedColor:'#666666' });
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<h2>判断<\/h2>/);
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /<a href="https:\/\/example\.com">来源<\/a>/);
  assert.match(html, /<blockquote>边界提示<\/blockquote>/);
  assert.match(html, /<ul><li>第一项<\/li><li>第二项<\/li><\/ul>/);
  assert.match(html, /#123456/);
  assert.doesNotMatch(html, /<script\b/i);
});

test('本地排版调用技能脚本并通过无 div 门禁', async (t) => {
  const normalizer = path.join(process.env.USERPROFILE || '', '.codex', 'skills', 'wechat-html-normalizer', 'scripts', 'normalize-html.mjs');
  if (!fs.existsSync(normalizer)) return t.skip('本机未安装公众号排版技能脚本');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-assistant-typeset-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const workdir = path.join(root, 'articles', '2026-07-19-c01');
  fs.mkdirSync(workdir, { recursive:true });
  fs.writeFileSync(path.join(workdir, '09-FINAL.md'), '# 测试文章\n\n## 一个判断\n\n这是正文，包含**重点**。\n', 'utf8');
  const artifacts = [];
  const store = {
    getCandidate: () => ({ id:1, batch_id:'batch-1', candidate_id:'C01' }),
    getBatch: () => ({ id:'batch-1', batch_date:'2026-07-19' }),
    upsertArtifact: (item) => artifacts.push(item), updateBatch: () => {}, updateModelCall: () => {},
  };
  const gateway = {
    resolve: () => ({ provider:{ maxOutputTokens:4096 } }),
    complete: async () => ({ content:JSON.stringify({ schemeMarkdown:'# 设计方案', tokens:{ accentColor:'#c4473a', textColor:'#202522', mutedColor:'#6c736e' } }), finishReason:'stop', callId:1 }),
  };
  const result = await runTypesetPipeline({ gateway, store, batchId:'batch-1', candidateId:1, provider:'fake', workspaceRoot:root, mode:'local' });
  const html = fs.readFileSync(result.finalHtml, 'utf8');
  assert.doesNotMatch(html, /<div\b/i);
  assert.doesNotMatch(html, /<style\b/i);
  assert.match(html, /<h1[^>]*>测试文章<\/h1>/);
  assert.ok(artifacts.some((item) => item.name === 'article.ai.html'));
});
