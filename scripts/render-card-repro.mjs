// 用指定代码基线渲染 social-cards 任务的故事板并输出 HTML，用于回归对比。
// 用法：node scripts/render-card-repro.mjs <card-plan.json> <输出.html> [代码根目录]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [planPath, outPath, codeRoot = process.cwd()] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const { renderStoryboardHtml } = await import(pathToFileURL(path.join(codeRoot, 'lib/llm/social-card-pipeline.mjs')).href);
const html = renderStoryboardHtml({
  topic: plan.topic,
  repository: 'bytedance/deer-flow',
  pages: plan.pages,
  visualStyle: 'lavender',
  layoutStyle: plan.layout_style || 'auto',
  compositionMode: plan.composition_mode || 'template',
  contentType: 'repository',
  channelMode: plan.channel_mode || 'xiaohongshu',
  sourceLabel: '',
  disclosure: '',
});
fs.writeFileSync(outPath, html, 'utf8');
console.log(`rendered -> ${outPath} (${codeRoot})`);
