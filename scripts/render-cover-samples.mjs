// 渲染封面样张：全部内置封面主题 × 若干固定规格，供人工验收视觉效果。
// 用法：node scripts/render-cover-samples.mjs [输出目录]
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import { fileURLToPath } from 'node:url';
import { getBuiltinThemeRegistry } from '../lib/themes/theme-registry.mjs';
import { buildCoverHtml } from '../lib/themes/cover-theme-compiler.mjs';
import { validateCoverSpec, fallbackCoverSpec } from '../lib/themes/cover-components.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const outputDir=path.resolve(process.argv[2]||path.join(root,'output','cover-samples'));

const TITLE='字节游戏再收缩：朝夕光年与沐瞳的沉没成本';
const SPECS=[
  {name:'full-dark',components:[
    {type:'canvas',colorRole:'page'},
    {type:'color-block',position:'full',shape:'rect',colorRole:'accent'},
    {type:'eyebrow',form:'badge',text:'深度观察'},
    {type:'title',lines:['字节游戏再收缩：','朝夕光年与沐瞳的沉没成本'],highlights:['朝夕光年','沐瞳'],align:'left'},
    {type:'subtitle',text:'从自研到收缩，一场 300 亿级别的战略试错复盘',withBar:true},
    {type:'decoration',kind:'dots',position:'bottom-right'},
  ]},
  {name:'left-block',components:[
    {type:'canvas',colorRole:'page'},
    {type:'color-block',position:'left-third',shape:'rect',colorRole:'accent'},
    {type:'eyebrow',form:'text',text:'AI 深一度'},
    {type:'title',lines:['字节游戏再收缩：','朝夕光年与沐瞳的沉没成本'],highlights:['朝夕光年','沐瞳'],align:'left'},
    {type:'meta',text:'公众号名 · 2026.08'},
    {type:'decoration',kind:'bar',position:'top-left'},
  ]},
  {name:'right-arrow',components:[
    {type:'canvas',colorRole:'page'},
    {type:'color-block',position:'right-panel',shape:'arrow',colorRole:'accent'},
    {type:'eyebrow',form:'numbering',text:'NO.012·行业复盘'},
    {type:'title',lines:['字节游戏再收缩：','朝夕光年与沐瞳的沉没成本'],highlights:[],align:'left'},
    {type:'meta',text:'公众号名 · 2026 年 8 月'},
  ]},
  {name:'fallback',...fallbackCoverSpec(TITLE,{brand:'公众号名 · 2026.08',subtitle:'从自研到收缩，一场 300 亿级别的战略试错复盘'})},
];

const registry=getBuiltinThemeRegistry();
const themes=registry.list({target:'cover'});

// 每个主题×规格一页：拼到一个 HTML，样式随页内联
const pages=[];
for(const theme of themes){
  for(const spec of SPECS){
    const validation=validateCoverSpec(spec);
    const finalSpec=validation.ok?validation.spec:fallbackCoverSpec(TITLE);
    const {html}=buildCoverHtml({theme,spec:finalSpec});
    const style=(html.match(/<style>([\s\S]*?)<style>/)||html.match(/<style>([\s\S]*?)<\/style>/))?.[1]||'';
    const body=(html.match(/<body>([\s\S]*?)<\/body>/)||[])[1]||'';
    pages.push(`<style>${style}</style><div class="sample-wrap"><div class="sample-label">${theme.id} · ${spec.name}</div>${body}</div>`);
  }
}
const htmlPath=path.join(outputDir,'samples.html');
fs.mkdirSync(outputDir,{recursive:true});
fs.writeFileSync(htmlPath,`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{margin:0;background:#333}.sample-wrap{width:900px;margin:24px auto}.sample-label{color:#999;font:12px sans-serif;padding:4px 0}</style></head><body>${pages.join('\n')}</body></html>`,'utf8');

const { execute }=await import(url.pathToFileURL(path.join(root,'skills','html-pages-to-images','index.js')).href);
const result=await execute({htmlFile:htmlPath,outputDir,pageWidth:900,pageHeight:430,deviceScaleFactor:2,selector:'.sample-wrap'});
console.log(result.success?`样张 ${result.data.count} 张 → ${result.data.outputDir}`:`失败：${result.message}`);
