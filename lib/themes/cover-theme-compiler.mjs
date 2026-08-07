// 公众号封面图主题编译器：主题 token → 900×383 封面 HTML。
// 渲染出口复用 skills/html-pages-to-images（puppeteer 截图），与 article-image-generator 同一模式。

import { getBuiltinThemeRegistry } from './theme-registry.mjs';
import { colorContrast } from './theme-validator.mjs';
import { COVER_WIDTH, COVER_HEIGHT } from './cover-components.mjs';

export const DEFAULT_COVER_THEME='cover-navy-gold';

export function coverThemeDefinition(themeId,{fallback=true}={}){
  const registry=getBuiltinThemeRegistry();
  const theme=registry.get(themeId);
  if(theme?.targets.includes('cover'))return theme;
  if(fallback)return registry.require(DEFAULT_COVER_THEME);
  return null;
}

// 字族值用于 inline style 属性，引号统一为单引号，避免截断 style 属性
const fontStack=(role)=>(role==='mono'?'ui-monospace,Consolas,"Microsoft YaHei",monospace':role==='serif'?'Georgia,"Noto Serif SC","Microsoft YaHei",serif':'"Noto Sans SC","Microsoft YaHei",sans-serif').replace(/"/g,"'");
const lower=(value)=>String(value).toLowerCase();

function escapeHtml(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function mixHex(a,b,ratio){
  const pa=[1,3,5].map((i)=>parseInt(a.slice(i,i+2),16)),pb=[1,3,5].map((i)=>parseInt(b.slice(i,i+2),16));
  return `#${pa.map((value,index)=>Math.round(value+(pb[index]-value)*ratio).toString(16).padStart(2,'0')).join('')}`.toUpperCase();
}

// 对比度不足时向黑/白方向混合直到达标（与 ai-theme-generator 的 bestContrast 同思路）
function ensureContrast(foreground,background,minimum=4.5){
  if(!/^#[0-9a-f]{6}$/i.test(foreground||'')||!/^#[0-9a-f]{6}$/i.test(background||''))return foreground;
  if(colorContrast(foreground,background)>=minimum)return foreground;
  const target=colorContrast(foreground,'#000000')>=colorContrast(foreground,'#FFFFFF')?'#000000':'#FFFFFF';
  for(let step=1;step<=100;step+=1){const candidate=mixHex(foreground,target,step/100);if(colorContrast(candidate,background)>=minimum)return candidate;}
  return target;
}

// 色块布局参数：每个 position 决定色块几何与内容区（main）的盒模型
const BLOCK_LAYOUTS={
  'left-third':{block:{left:0,top:0,width:300,height:COVER_HEIGHT},main:{left:300,right:0,padding:'44px 48px'}},
  'right-panel':{block:{right:0,top:0,width:240,height:COVER_HEIGHT},main:{left:0,right:264,padding:'44px 0 44px 48px'}},
  'top-band':{block:{left:0,top:0,width:COVER_WIDTH,height:96},main:{left:0,right:0,top:96,bottom:0,padding:'28px 48px 40px'}},
  full:{block:{left:0,top:0,width:COVER_WIDTH,height:COVER_HEIGHT},main:{left:0,right:0,padding:'44px 56px'}},
};
const ARROW_EXTRA=90; // 箭头向左/右探入内容区的宽度

function resolveColors(theme){
  const c=theme.tokens.colors;
  return {page:lower(c.page||c.background),surface:lower(c.surface),ink:lower(c.text),muted:lower(c.muted),accent:lower(c.accent),accent2:lower(c.accentSecondary),line:lower(c.line),inverse:lower(c.inverseText),code:lower(c.codeBackground)};
}

const roleColor=(colors,role)=>({page:colors.page,ink:colors.ink,accent:colors.accent,code:colors.code}[role]||colors.page);

// 标题高亮：把 highlights 中的词包成 <em>（只替换每行首次出现，保持确定性）
function titleLineHtml(line,highlights,highlightColor){
  let html=escapeHtml(line);
  for(const word of highlights||[]){
    const escaped=escapeHtml(word);
    if(html.includes(escaped))html=html.replace(escaped,`<em style="color:${highlightColor}">${escaped}</em>`);
  }
  return `<span class="cover-title-line">${html}</span>`;
}

function decorationHtml(deco,accentColor){
  if(deco.kind==='bar')return `<div class="cover-deco deco-bar deco-${deco.position||'bottom-left'}" style="background:${accentColor}"></div>`;
  if(deco.kind==='dots')return `<div class="cover-deco deco-dots deco-${deco.position||'bottom-right'}" style="background-image:radial-gradient(${accentColor}59 3px,transparent 3px)"></div>`;
  return `<div class="cover-deco deco-ring deco-${deco.position||'top-right'}" style="border-color:${accentColor}"></div>`;
}

// 构建封面 HTML。spec 须先经 validateCoverSpec 校验（或 fallbackCoverSpec 产出）。
export function buildCoverHtml({theme,spec}){
  const definition=typeof theme==='string'?coverThemeDefinition(theme):theme;
  const colors=resolveColors(definition);
  const t=definition.tokens.typography;
  const components=spec.components;
  const byType=(type)=>components.filter((component)=>component.type===type);
  const canvas=byType('canvas')[0]||{colorRole:'page'};
  const block=byType('color-block')[0]||null;
  const title=byType('title')[0];
  const eyebrow=byType('eyebrow')[0]||null;
  const subtitle=byType('subtitle')[0]||null;
  const meta=byType('meta')[0]||null;
  const decorations=byType('decoration');

  const canvasColor=roleColor(colors,canvas.colorRole);
  const layout=block?BLOCK_LAYOUTS[block.position]||BLOCK_LAYOUTS.full:null;
  const blockColor=block?roleColor(colors,block.colorRole):null;
  // 标题所在区域的底色：整版色块 → 色块色；其余 → 画布色
  const underlay=block?.position==='full'?blockColor:canvasColor;

  // 颜色决策：从候选中挑对比度最高且达标的，都不达标再向黑/白修正
  const pick=(candidates,bg,minimum)=>{
    const valid=candidates.filter((value)=>/^#[0-9a-f]{6}$/i.test(value||''));
    const best=valid.sort((a,b)=>colorContrast(b,bg)-colorContrast(a,bg))[0];
    if(best&&colorContrast(best,bg)>=minimum)return best;
    return ensureContrast(best||candidates[0],bg,minimum);
  };
  const titleColor=pick([colors.ink,colors.inverse],underlay,4.5);
  const highlightColor=pick([colors.accent,colors.accent2,colors.inverse,colors.page],underlay,3);
  const mutedColor=pick([colors.muted,colors.ink,colors.inverse],underlay,3);
  const eyebrowColor=pick([colors.accent,colors.accent2,colors.ink,colors.inverse],underlay,3);
  // badge 底色避开与所在区域同色（整版 accent 色块上换成 code 底色）
  const badgeBg=colorContrast(colors.accent,underlay)>=1.6?colors.accent:colors.code;
  const badgeText=pick([colors.inverse,colors.ink],badgeBg,4.5);

  // 标题字号：按内容区宽度与最长行字数自适应，30–56px
  const main=layout?layout.main:{left:0,right:0,padding:'44px 56px'};
  const mainWidth=COVER_WIDTH-(main.left||0)-(main.right||0)-96; // 近似减去两侧 padding
  const maxLineChars=Math.max(...title.lines.map((line)=>[...line].length),1);
  const titlePx=Math.max(30,Math.min(56,Math.floor(mainWidth/(maxLineChars*1.02))));

  const mainStyle=`left:${main.left||0}px;right:${main.right||0}px;top:${main.top||0}px;bottom:${main.bottom||0}px;padding:${main.padding}`;
  const arrowClip=block?.shape==='arrow'
    ?(block.position==='right-panel'
      ?`width:${240+ARROW_EXTRA}px;clip-path:polygon(${ARROW_EXTRA}px 0,100% 0,100% 100%,${ARROW_EXTRA}px 100%,0 50%)`
      :`width:${300+ARROW_EXTRA}px;clip-path:polygon(0 0,calc(100% - ${ARROW_EXTRA}px) 0,100% 50%,calc(100% - ${ARROW_EXTRA}px) 100%,0 100%)`)
    :'';

  const eyebrowStyle=eyebrow?.form==='badge'
    ?`background:${badgeBg};color:${badgeText}`
    :`color:${eyebrowColor}${eyebrow?.form==='numbering'?`;font-family:${fontStack('mono')}`:''}`;
  const eyebrowHtml=eyebrow?`<div class="cover-eyebrow eyebrow-${eyebrow.form||'text'}" style="${eyebrowStyle}">${escapeHtml(eyebrow.text)}</div>`:'';
  const subtitleHtml=subtitle?`<p class="cover-subtitle${subtitle.withBar?' with-bar':''}" style="color:${mutedColor}${subtitle.withBar?`;border-left-color:${highlightColor}`:''}">${escapeHtml(subtitle.text)}</p>`:'';
  // 信息行对齐内容区左缘（而非画布左缘），避免压到左侧色块
  const metaLeft=(main.left||0)+48;
  const metaHtml=meta?`<div class="cover-meta" style="color:${mutedColor};left:${metaLeft}px">${escapeHtml(meta.text)}</div>`:'';

  // 静态结构样式：所有封面完全相同，同页多封面共存时不冲突；动态值（颜色/几何/字号）全部 inline
  const css=`
    *{box-sizing:border-box}html,body{margin:0;padding:0}
    .cover{width:${COVER_WIDTH}px;height:${COVER_HEIGHT}px;overflow:hidden;position:relative}
    .cover-block{position:absolute}
    .cover-main{position:absolute;display:flex;flex-direction:column;justify-content:center;gap:18px}
    .cover-eyebrow{font-size:20px;font-weight:700;letter-spacing:.18em;width:fit-content}
    .eyebrow-badge{padding:6px 16px;border-radius:4px;letter-spacing:.1em}
    .eyebrow-numbering{font-size:19px;letter-spacing:.22em}
    .cover-title{margin:0;font-weight:800;line-height:1.32;letter-spacing:-.01em}
    .cover-title-line{display:block;overflow-wrap:anywhere}
    .cover-title em{font-style:normal}
    .cover-subtitle{margin:0;font-size:21px;line-height:1.5}
    .cover-subtitle.with-bar{border-left:4px solid transparent;padding-left:16px}
    .cover-meta{position:absolute;bottom:28px;font-size:18px;letter-spacing:.06em}
    .cover-deco{position:absolute;pointer-events:none}
    .deco-bar{width:56px;height:8px}
    .deco-dots{width:180px;height:180px;background-size:24px 24px}
    .deco-ring{width:170px;height:170px;border:16px solid transparent;border-radius:50%;opacity:.9}
    .deco-top-left{left:32px;top:32px}.deco-top-right{right:-48px;top:-48px}
    .deco-bottom-left{left:32px;bottom:32px}.deco-bottom-right{right:-40px;bottom:-40px}
    .deco-bar.deco-top-left,.deco-bar.deco-bottom-left{left:48px}
  `;

  const blockGeometry=block?`${layout.block.left!==undefined?`left:${layout.block.left}px;`:''}${layout.block.right!==undefined?`right:${layout.block.right}px;`:''}top:${layout.block.top}px;width:${layout.block.width}px;height:${layout.block.height}px;`:'';
  const html=`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style></head>
<body><div class="page cover cover-theme-${definition.id}" style="background:${canvasColor};font-family:${fontStack(t.family)}">
${block?`<div class="cover-block" style="${blockGeometry}background:${blockColor};${arrowClip}"></div>`:''}
${decorations.map((deco)=>decorationHtml(deco,colors.accent)).join('\n')}
<div class="cover-main" style="${mainStyle}">
${eyebrowHtml}
<h1 class="cover-title" style="font-family:${fontStack(t.headingFamily)};font-size:${titlePx}px;color:${titleColor};text-align:${title.align==='center'?'center':'left'}">${title.lines.map((line)=>titleLineHtml(line,title.highlights,highlightColor)).join('')}</h1>
${subtitleHtml}
</div>
${metaHtml}
</div></body></html>`;
  return {html,width:COVER_WIDTH,height:COVER_HEIGHT,themeId:definition.id};
}
