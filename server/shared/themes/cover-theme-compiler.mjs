// 公众号封面图主题编译器：主题 token → 900×383 封面 HTML。
// 渲染出口复用 skills/html-pages-to-images（puppeteer 截图），与 article-image-generator 同一模式。

import { getBuiltinThemeRegistry } from './theme-registry.mjs';
import { colorContrast } from './theme-validator.mjs';
import { COVER_WIDTH, COVER_HEIGHT } from './cover-components.mjs';
import { escapeHtml } from '../rendering/html-utils.mjs';
import { mixHex } from './color-utils.mjs';
import { fontStack as sharedFontStack } from './font-utils.mjs';

export const DEFAULT_COVER_THEME='cover-navy-gold';

export function coverThemeDefinition(themeId,{fallback=true}={}){
  const registry=getBuiltinThemeRegistry();
  const theme=registry.get(themeId);
  if(theme?.targets.includes('cover'))return theme;
  if(fallback)return registry.require(DEFAULT_COVER_THEME);
  return null;
}

// 字族值用于 inline style 属性，引号统一为单引号，避免截断 style 属性
const fontStack=(role)=>sharedFontStack(role,{singleQuotes:true});
const lower=(value)=>String(value).toLowerCase();

// 对比度不足时向黑/白方向混合直到达标（与 ai-theme-generator 的 bestContrast 同思路）
function ensureContrast(foreground,background,minimum=4.5){
  if(!/^#[0-9a-f]{6}$/i.test(foreground||'')||!/^#[0-9a-f]{6}$/i.test(background||''))return foreground;
  if(colorContrast(foreground,background)>=minimum)return foreground;
  const target=colorContrast(foreground,'#000000')>=colorContrast(foreground,'#FFFFFF')?'#000000':'#FFFFFF';
  for(let step=1;step<=100;step+=1){const candidate=mixHex(foreground,target,step/100);if(colorContrast(candidate,background)>=minimum)return candidate;}
  return target;
}

// 色块布局参数：每个 position 决定色块几何与内容区（main）的盒模型；留白来自 tokens.spacing
const blockLayout=(position,padX,padY)=>({
  'left-third':{block:{left:0,top:0,width:300,height:COVER_HEIGHT},main:{left:300,right:0,padding:`${padY}px ${padX}px`}},
  'left-half':{block:{left:0,top:0,width:450,height:COVER_HEIGHT},main:{left:450,right:0,padding:`${padY}px ${padX}px`}},
  'right-half':{block:{right:0,top:0,width:450,height:COVER_HEIGHT},main:{left:0,right:450,padding:`${padY}px 0 ${padY}px ${padX}px`}},
  'right-panel':{block:{right:0,top:0,width:240,height:COVER_HEIGHT},main:{left:0,right:264,padding:`${padY}px 0 ${padY}px ${padX}px`}},
  'top-band':{block:{left:0,top:0,width:COVER_WIDTH,height:96},main:{left:0,right:0,top:96,bottom:0,padding:`${Math.round(padY*.64)}px ${padX}px ${Math.round(padY*.9)}px`}},
  full:{block:{left:0,top:0,width:COVER_WIDTH,height:COVER_HEIGHT},main:{left:0,right:0,padding:`${padY}px ${padX+8}px`}},
}[position]);
const ARROW_EXTRA=90; // 箭头/斜切向左、右探入内容区的宽度
// 斜切色块：沿块缘切出平行四边形斜边；top-band/full 不适用时回退矩形
const DIAGONAL_LEAN=64;
const diagonalClip=(position,width)=>{
  if(position==='left-third'||position==='left-half')return `width:${width+DIAGONAL_LEAN}px;clip-path:polygon(0 0,100% 0,calc(100% - ${DIAGONAL_LEAN}px) 100%,0 100%)`;
  if(position==='right-panel'||position==='right-half')return `width:${width+DIAGONAL_LEAN}px;clip-path:polygon(${DIAGONAL_LEAN}px 0,100% 0,100% 100%,0 100%)`;
  return '';
};

// 封面 token 的消费点清单：发布门禁据此报告未被消费的字段
export const COVER_TOKEN_USAGE={
  'tokens.colors.page':['.cover'],'tokens.colors.text':['.cover-title'],'tokens.colors.muted':['.cover-subtitle,.cover-meta'],'tokens.colors.accent':['.cover-block,.cover-eyebrow,.cover-deco'],'tokens.colors.accentSecondary':['.cover-title em,.cover-eyebrow'],'tokens.colors.inverseText':['.cover-title,.eyebrow-badge'],'tokens.colors.codeBackground':['.cover-block,.eyebrow-badge'],
  'tokens.typography.family':['.cover'],'tokens.typography.headingFamily':['.cover-title'],'tokens.typography.titlePx':['.cover-title'],'tokens.typography.titleLineHeight':['.cover-title'],'tokens.typography.eyebrowPx':['.cover-eyebrow'],'tokens.typography.subtitlePx':['.cover-subtitle'],'tokens.typography.metaPx':['.cover-meta'],
  'tokens.spacing.paddingXPx':['.cover-main'],'tokens.spacing.paddingYPx':['.cover-main'],'tokens.spacing.gapPx':['.cover-main'],'tokens.spacing.metaBottomPx':['.cover-meta'],
  'tokens.shape.badgeRadiusPx':['.eyebrow-badge'],
  'cover.spec.components':['.cover'],'cover.spec.layout':['.cover'],
};

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
    if(html.includes(escaped))html=html.replace(escaped,`<em style="color:${highlightColor};font-weight:900;text-decoration:underline;text-decoration-thickness:3px;text-underline-offset:4px">${escaped}</em>`);
  }
  return `<span class="cover-title-line">${html}</span>`;
}

function decorationHtml(deco,accentColor){
  if(deco.kind==='bar')return `<div class="cover-deco deco-bar deco-${deco.position||'bottom-left'}" style="background:${accentColor}"></div>`;
  if(deco.kind==='dots')return `<div class="cover-deco deco-dots deco-${deco.position||'bottom-right'}" style="background-image:radial-gradient(${accentColor}59 3px,transparent 3px)"></div>`;
  if(deco.kind==='cross'){ // 十字丝点阵：4×3 的 + 号阵列，画册索引感
    const cells=Array.from({length:12},()=>`<span style="color:${accentColor}">+</span>`).join('');
    return `<div class="cover-deco deco-cross deco-${deco.position||'top-right'}">${cells}</div>`;
  }
  if(deco.kind==='grid')return `<div class="cover-deco deco-grid deco-${deco.position||'bottom-right'}" style="background-image:linear-gradient(${accentColor}2E 1px,transparent 1px),linear-gradient(90deg,${accentColor}2E 1px,transparent 1px)"></div>`;
  if(deco.kind==='corner-marks'){ // 裁切角标：固定在画布四角的 L 形线，忽略 position
    return ['tl','tr','bl','br'].map((corner)=>`<div class="cover-deco deco-corner corner-${corner}" style="border-color:${accentColor}"></div>`).join('');
  }
  return `<div class="cover-deco deco-ring deco-${deco.position||'top-right'}" style="border-color:${accentColor}"></div>`;
}

// 受控 SVG 视觉母题：只根据标题语义与主题签名选用内置图形，不把标题文本或模型输出直接写进 SVG。
const MOTIF_VARIANTS={
  tech:['circuit','network','brackets','signal'],
  data:['chart','network','orbit'],
  editorial:['orbit','brackets','signal','network'],
};
const MOTIF_SHAPES={
  circuit:'<path d="M18 42h62V18h58M80 42v46h62v34h54M142 18v30h46v48h46M80 88H38v44h42"/><circle cx="18" cy="42" r="6"/><circle cx="138" cy="18" r="6"/><circle cx="142" cy="122" r="6"/><circle cx="242" cy="96" r="6"/><circle cx="38" cy="132" r="6"/>',
  network:'<path d="M42 54 118 28l58 58 58-38M42 54l22 96 112-64 58 38M64 150l-4 42 116 8 58-50"/><circle cx="42" cy="54" r="9"/><circle cx="118" cy="28" r="9"/><circle cx="176" cy="86" r="9"/><circle cx="234" cy="48" r="9"/><circle cx="64" cy="150" r="9"/><circle cx="176" cy="86" r="5" fill="var(--motif-secondary)" stroke="none"/>',
  brackets:'<path d="M72 18 28 18 28 184 72 184M178 18h44v166h-44M92 52h66M92 84h44M92 116h66M92 148h34"/><path d="M96 18v18M154 166v18"/>',
  signal:'<path d="M28 180V34M28 180h220"/><path d="M48 142 84 126 118 136 152 98 184 108 222 54"/><path d="m208 54h14v14"/><circle cx="48" cy="142" r="5" fill="var(--motif-secondary)" stroke="none"/><circle cx="84" cy="126" r="5" fill="var(--motif-secondary)" stroke="none"/><circle cx="118" cy="136" r="5" fill="var(--motif-secondary)" stroke="none"/><circle cx="152" cy="98" r="5" fill="var(--motif-secondary)" stroke="none"/><circle cx="184" cy="108" r="5" fill="var(--motif-secondary)" stroke="none"/><circle cx="222" cy="54" r="6" fill="var(--motif-secondary)" stroke="none"/>',
  chart:'<path d="M28 184V42M28 184h220M62 158V112h28v46M108 158V76h28v82M154 158V52h28v106M200 158V96h28v62"/><path d="m62 88 46-28 46 16 46-34"/><circle cx="62" cy="88" r="5" fill="var(--motif-secondary)" stroke="none"/><circle cx="108" cy="60" r="5" fill="var(--motif-secondary)" stroke="none"/><circle cx="154" cy="76" r="5" fill="var(--motif-secondary)" stroke="none"/><circle cx="200" cy="42" r="5" fill="var(--motif-secondary)" stroke="none"/>',
  orbit:'<ellipse cx="136" cy="102" rx="96" ry="48"/><ellipse cx="136" cy="102" rx="48" ry="96" transform="rotate(36 136 102)"/><circle cx="136" cy="102" r="18"/><circle cx="224" cy="74" r="8" fill="var(--motif-secondary)" stroke="none"/><circle cx="74" cy="166" r="6" fill="var(--motif-secondary)" stroke="none"/>',
};

function motifKind(title,themeId,preferred=''){
  const text=String(title||'');
  if(MOTIF_SHAPES[preferred])return preferred;
  const family=/数据|指标|排行|对比|增长|成本|价格|性能/.test(text)?'data':/终止|依赖|供应|风险/.test(text)?'editorial':/AI|模型|开发|代码|API|工具|编程|Cursor|OpenAI/i.test(text)?'tech':'editorial';
  const variants=MOTIF_VARIANTS[family];
  const signature=`${themeId||''}|${text}`;let hash=0;
  for(const character of signature)hash=(hash*31+character.charCodeAt(0))>>>0;
  return variants[hash%variants.length];
}

function motifHtml({title,themeId,position,color,secondary,preferred}){
  const kind=motifKind(title,themeId,preferred),shape=MOTIF_SHAPES[kind];
  if(!shape)return '';
  const placement=position==='left'?'motif-left':position==='right'?'motif-right':'motif-canvas-right';
  return `<svg class="cover-motif motif-${kind} ${placement}" viewBox="0 0 272 204" aria-hidden="true" focusable="false" style="color:${color};--motif-secondary:${secondary}"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" stroke-linejoin="round" opacity=".72">${shape}</g></svg>`;
}

// 构建封面 HTML。spec 须先经 validateCoverSpec 校验（或 fallbackCoverSpec 产出）。
export function buildCoverHtml({theme,spec,coverSemantics=null}){
  const definition=typeof theme==='string'?coverThemeDefinition(theme):theme;
  const colors=resolveColors(definition);
  const t=definition.tokens.typography,s=definition.tokens.spacing||{},sh=definition.tokens.shape||{};
  // 新版封面 token；旧封面主题（文章字段集）缺失时回退到原硬编码值
  const titleMaxPx=t.titlePx??56,titleLineHeight=t.titleLineHeight??1.32,eyebrowPx=t.eyebrowPx??20,subtitlePx=t.subtitlePx??21,metaPx=t.metaPx??18;
  const padX=s.paddingXPx??48,padY=s.paddingYPx??44,gapPx=s.gapPx??18,metaBottom=s.metaBottomPx??28,badgeRadius=sh.badgeRadiusPx??4;
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
  // 画布渐变：page→深色块方向性过渡（主题级选择，克制场景建议 none）
  const canvasBackground=canvas.gradient==='diagonal'
    ?`linear-gradient(135deg,${canvasColor},${colors.code})`
    :canvas.gradient==='radial'?`radial-gradient(circle at 28% 24%,${canvasColor},${colors.code})`:canvasColor;
  // 画布纹理与描边内框
  const textureHtml=canvas.texture==='grid'
    ?`<div class="cover-texture texture-grid" style="background-image:linear-gradient(${colors.ink}14 1px,transparent 1px),linear-gradient(90deg,${colors.ink}14 1px,transparent 1px)"></div>`
    :canvas.texture==='scanlines'?`<div class="cover-texture texture-scanlines" style="background-image:linear-gradient(${colors.ink}12 1px,transparent 1px)"></div>`:'';
  const frame=byType('frame')[0]||null;
  const frameColor=frame?({ink:colors.ink,accent:colors.accent,muted:colors.muted}[frame.colorRole||'ink']||colors.ink):null;
  const frameHtml=frame
    ?(frame.style==='double'
      ?`<div class="cover-frame" style="inset:14px;border-width:2px;border-color:${frameColor}"></div><div class="cover-frame" style="inset:20px;border-width:1px;border-color:${frameColor}"></div>`
      :`<div class="cover-frame" style="inset:18px;border-width:2px;border-color:${frameColor}"></div>`)
    :'';
  const layout=block?blockLayout(block.position,padX,padY)||blockLayout('full',padX,padY):null;
  const blockColor=block?roleColor(colors,block.colorRole):null;

  // 颜色决策：从主题角色候选中挑对比度最高且达标的，都不达标再向黑/白修正
  const pick=(candidates,bg,minimum)=>{
    const valid=candidates.filter((value)=>/^#[0-9a-f]{6}$/i.test(value||''));
    const best=valid.sort((a,b)=>colorContrast(b,bg)-colorContrast(a,bg))[0];
    if(best&&colorContrast(best,bg)>=minimum)return best;
    return ensureContrast(best||candidates[0],bg,minimum);
  };
  // 区域配色板：给定底色（画布或色块），产出该区域内全部文字元素的用色；全部来自主题角色
  const paletteFor=(bg)=>{
    const badgeBg=colorContrast(colors.accent,bg)>=1.6?colors.accent:colors.code;
    return {title:pick([colors.ink,colors.inverse],bg,4.5),highlight:pick([colors.accent,colors.accent2,colors.inverse,colors.page],bg,3),muted:pick([colors.muted,colors.ink,colors.inverse],bg,3),eyebrow:pick([colors.accent,colors.accent2,colors.ink,colors.inverse],bg,3),badgeBg,badgeText:pick([colors.inverse,colors.ink],badgeBg,4.5)};
  };
  const canvasPalette=paletteFor(canvasColor),blockPalette=block?paletteFor(blockColor):null;

  // 装饰可能落在色块上，不能固定使用 accent，否则会与纯色色块撞色而「生成了但看不见」。
  // 按装饰位置估算局部底色，再从主题角色中挑一个足够醒目的颜色。
  const decorationBackground=(position)=>{
    if(!block)return [canvasColor];
    if(block.position==='full')return [blockColor];
    if(block.position==='top-band')return [/^top-/.test(position||'')?blockColor:canvasColor];
    const leftBlock=block.position==='left-third'||block.position==='left-half';
    const onBlock=leftBlock?/left/.test(position||''):/right/.test(position||'');
    return [onBlock?blockColor:canvasColor];
  };
  const decorationColor=(deco)=>{
    const backgrounds=deco.kind==='corner-marks'&&block?[canvasColor,blockColor]:decorationBackground(deco.position);
    const candidates=[colors.accent2,colors.ink,colors.inverse,colors.muted,colors.page,colors.accent];
    const valid=candidates.filter((value)=>/^#[0-9a-f]{6}$/i.test(value||''));
    const best=valid.sort((a,b)=>Math.min(...backgrounds.map((bg)=>colorContrast(b,bg)))-Math.min(...backgrounds.map((bg)=>colorContrast(a,bg))))[0];
    return best||colors.accent;
  };
  const motifPosition=block&&String(block.position).startsWith('left')?'left':block&&String(block.position).startsWith('right')?'right':'canvas';
  const motifPositionKey=motifPosition==='left'?'middle-left':motifPosition==='right'?'middle-right':'bottom-right';
  const motifBackground=decorationBackground(motifPositionKey)[0];
  const motifColor=pick([colors.accent2,colors.ink,colors.inverse,colors.muted,colors.page],motifBackground,3);
  const motifSecondary=pick([colors.accent,colors.accent2,colors.ink,colors.inverse,colors.muted],motifBackground,2.2);
  const motif=motifHtml({title:title.lines.join(''),themeId:definition.id,position:motifPosition,color:motifColor,secondary:motifSecondary,preferred:coverSemantics?.motifKind});

  // 文字与色块的关系：avoid（默认，内容区避开色块）、hold（内容区落进色块，整块用色块配色板）、
  // span（内容横跨色块分界线，双层渲染各自 clip 到自己区域着色——同一标题在块上/画布上两种颜色）
  const sidePositions=['left-third','left-half','right-half','right-panel'];
  const textMode=block?.position==='full'?'hold':block&&sidePositions.includes(block.position)&&(block.text==='hold'||block.text==='span')?block.text:'avoid';

  // 标题字号：按内容区宽度与最长行字数自适应，上限取主题 titlePx；
  // 下限 22px——半屏色块等窄内容区需要更低下限才能保住「每行 ≤14 字不折行」
  const main=textMode==='hold'
    ?(layout.block.left!==undefined
      ?{left:0,right:COVER_WIDTH-layout.block.width,padding:`${padY}px ${padX}px`}
      :{left:COVER_WIDTH-layout.block.width,right:0,padding:`${padY}px ${padX}px`})
    :textMode==='span'?{left:0,right:0,padding:`${padY}px ${padX}px`}
    :layout?layout.main:{left:0,right:0,padding:`${padY}px ${padX+8}px`};
  const mainWidth=COVER_WIDTH-(main.left||0)-(main.right||0)-padX*2; // 近似减去两侧 padding
  const maxLineChars=Math.max(...title.lines.map((line)=>[...line].length),1);
  // 三行标题压到 40px 以内，给副标题与信息行留出垂直空间
  const titleCap=title.lines.length>=3?Math.min(titleMaxPx,40):titleMaxPx;
  const titlePx=Math.max(22,Math.min(titleCap,Math.floor(mainWidth/(maxLineChars*1.02))));

  const mainStyle=`left:${main.left||0}px;right:${main.right||0}px;top:${main.top||0}px;bottom:${main.bottom||0}px;padding:${main.padding}`;

  // span 模式的区域裁剪：色块多边形（含箭头/斜切的探出部分）与它的 evenodd 补集
  const spanClips=textMode==='span'?(()=>{
    const W=layout.block.width,H=COVER_HEIGHT,CW=COVER_WIDTH,pts=layout.block.left!==undefined
      ?(block.shape==='arrow'?[[0,0],[W,0],[W+ARROW_EXTRA,H/2],[W,H],[0,H]]:block.shape==='diagonal'?[[0,0],[W+DIAGONAL_LEAN,0],[W,H],[0,H]]:[[0,0],[W,0],[W,H],[0,H]])
      :(block.shape==='arrow'?[[CW-W,0],[CW,0],[CW,H],[CW-W,H],[CW-W-ARROW_EXTRA,H/2]]:block.shape==='diagonal'?[[CW-W,0],[CW,0],[CW,H],[CW-W-DIAGONAL_LEAN,H]]:[[CW-W,0],[CW,0],[CW,H],[CW-W,H]]);
    const polygon=pts.map((point)=>`${point[0]}px ${point[1]}px`).join(',');
    const path=`M0 0H${CW}V${H}H0Z ${pts.map((point,index)=>`${index?'L':'M'}${point[0]} ${point[1]}`).join('')}Z`;
    return {block:`clip-path:polygon(${polygon})`,canvas:`clip-path:path('${path}');clip-rule:evenodd`};
  })():null;
  const arrowClip=block?.shape==='arrow'
    ?(block.position==='right-panel'||block.position==='right-half'
      ?`width:${layout.block.width+ARROW_EXTRA}px;clip-path:polygon(${ARROW_EXTRA}px 0,100% 0,100% 100%,${ARROW_EXTRA}px 100%,0 50%)`
      :`width:${layout.block.width+ARROW_EXTRA}px;clip-path:polygon(0 0,calc(100% - ${ARROW_EXTRA}px) 0,100% 50%,calc(100% - ${ARROW_EXTRA}px) 100%,0 100%)`)
    :block?.shape==='diagonal'?diagonalClip(block.position,layout.block.width):'';

  // 背景大字：超大低透明度字符，压在色块/画布之下、内容之上
  const giant=byType('giant-char')[0]||null;
  const giantColor=giant?({ink:colors.ink,accent:colors.accent,accentSecondary:colors.accent2,inverseText:colors.inverse}[giant.colorRole||'ink']||colors.ink):null;
  const giantHtml=giant?`<div class="cover-giant giant-${giant.position||'right'}" style="color:${giantColor}">${escapeHtml(giant.text)}</div>`:'';

  // 内容区 HTML：眉题 + 标题 + 副标题按配色板渲染；span 模式会按画布/色块各渲染一层
  const contentHtml=(palette)=>{
    const eyebrowStyle=eyebrow?.form==='badge'
      ?`background:${palette.badgeBg};color:${palette.badgeText}`
      :`color:${palette.eyebrow}${eyebrow?.form==='numbering'?`;font-family:${fontStack('mono')}`:''}`;
    const eyebrowHtml=eyebrow?`<div class="cover-eyebrow eyebrow-${eyebrow.form||'text'}" style="${eyebrowStyle}">${escapeHtml(eyebrow.text)}</div>`:'';
    const subtitleHtml=subtitle?`<p class="cover-subtitle${subtitle.withBar?' with-bar':''}" style="color:${palette.muted}${subtitle.withBar?`;border-left-color:${palette.highlight}`:''}">${escapeHtml(subtitle.text)}</p>`:'';
    const titleHtml=`<h1 class="cover-title" style="font-family:${fontStack(t.headingFamily)};font-size:${titlePx}px;color:${palette.title};text-align:${title.align==='center'?'center':'left'}">${title.lines.map((line)=>titleLineHtml(line,title.highlights,palette.highlight)).join('')}</h1>`;
    return `${eyebrowHtml}${titleHtml}${subtitleHtml}`;
  };
  const mainLayers=textMode==='span'
    ?`<div class="cover-main" style="${mainStyle};${spanClips.canvas}">${contentHtml(canvasPalette)}</div>\n<div class="cover-main" aria-hidden="true" style="${mainStyle};${spanClips.block}">${contentHtml(blockPalette)}</div>`
    :`<div class="cover-main" style="${mainStyle}">${contentHtml(textMode==='hold'?blockPalette:canvasPalette)}</div>`;
  // 信息行对齐内容区左缘（而非画布左缘）；落在色块上的信息行用色块配色板
  const metaLeft=(main.left||0)+padX;
  const metaOnBlock=block&&textMode!=='avoid'&&(layout.block.left!==undefined?metaLeft<layout.block.width:metaLeft>COVER_WIDTH-layout.block.width);
  const metaHtml=meta?`<div class="cover-meta" style="color:${(metaOnBlock?blockPalette:canvasPalette).muted};left:${metaLeft}px;bottom:${metaBottom}px">${escapeHtml(meta.text)}</div>`:'';

  // 静态结构样式：所有封面完全相同，同页多封面共存时不冲突；动态值（颜色/几何/字号）全部 inline
  const css=`
    *{box-sizing:border-box}html,body{margin:0;padding:0}
    .cover{width:${COVER_WIDTH}px;height:${COVER_HEIGHT}px;overflow:hidden;position:relative}
    .cover-block{position:absolute}
    .cover-main{position:absolute;display:flex;flex-direction:column;justify-content:center;gap:${gapPx}px}
    .cover-eyebrow{font-size:${eyebrowPx}px;font-weight:700;letter-spacing:.18em;width:fit-content}
    .eyebrow-badge{padding:6px 16px;border-radius:${badgeRadius}px;letter-spacing:.1em}
    .eyebrow-numbering{font-size:${eyebrowPx-1}px;letter-spacing:.22em}
    .cover-title{margin:0;font-weight:800;line-height:${titleLineHeight};letter-spacing:-.01em}
    .cover-title-line{display:block;overflow-wrap:anywhere}
    .cover-title em{font-style:normal;font-weight:900}
    .cover-subtitle{margin:0;font-size:${subtitlePx}px;line-height:1.5}
    .cover-subtitle.with-bar{border-left:4px solid transparent;padding-left:16px}
    .cover-meta{position:absolute;font-size:${metaPx}px;letter-spacing:.06em}
    .cover-deco{position:absolute;pointer-events:none}
    .cover-texture{position:absolute;inset:0;pointer-events:none}
    .texture-grid{background-size:28px 28px}
    .texture-scanlines{background-size:100% 6px}
    .cover-frame{position:absolute;border-style:solid;pointer-events:none}
    .deco-bar{width:56px;height:8px}
    .deco-dots{width:180px;height:180px;background-size:24px 24px}
    .deco-ring{width:170px;height:170px;border:16px solid transparent;border-radius:50%;opacity:.9}
    .deco-cross{display:grid;grid-template-columns:repeat(4,26px);grid-auto-rows:26px;font:700 18px/26px ui-monospace,Consolas,monospace;text-align:center;opacity:.55}
    .deco-grid{width:200px;height:150px;background-size:22px 22px}
    .deco-corner{width:26px;height:26px;border:0 solid transparent;position:absolute}
    .corner-tl{left:24px;top:24px;border-top-width:2px;border-left-width:2px}
    .corner-tr{right:24px;top:24px;border-top-width:2px;border-right-width:2px}
    .corner-bl{left:24px;bottom:24px;border-bottom-width:2px;border-left-width:2px}
    .corner-br{right:24px;bottom:24px;border-bottom-width:2px;border-right-width:2px}
    .cover-giant{position:absolute;top:50%;transform:translateY(-50%);font-size:300px;font-weight:800;line-height:1;opacity:.1;pointer-events:none;white-space:nowrap;font-family:${fontStack(t.headingFamily)}}
    .giant-left{left:-24px}.giant-right{right:-24px}
    .giant-center{left:50%;transform:translate(-50%,-50%)}
    .deco-top-left{left:32px;top:32px}.deco-top-right{right:-48px;top:-48px}
    .deco-bottom-left{left:32px;bottom:32px}.deco-bottom-right{right:-40px;bottom:-40px}
    .deco-top-center{left:50%;top:32px;transform:translateX(-50%)}
    .deco-middle-left{left:32px;top:50%;transform:translateY(-50%)}
    .deco-middle-right{right:32px;top:50%;transform:translateY(-50%)}
    .deco-bottom-center{left:50%;bottom:32px;transform:translateX(-50%)}
    .deco-bar.deco-top-left,.deco-bar.deco-bottom-left{left:48px}
    .deco-bar.deco-top-left{top:48px}.deco-bar.deco-top-right{right:48px;top:48px}.deco-bar.deco-bottom-right{right:48px;bottom:48px}.deco-bar.deco-bottom-center{bottom:48px}
    .deco-cross.deco-top-left{left:32px;top:32px}.deco-cross.deco-top-right{right:32px;top:32px}.deco-cross.deco-bottom-left{left:32px;bottom:32px}.deco-cross.deco-bottom-right{right:32px;bottom:32px}
    .cover-motif{position:absolute;pointer-events:none;overflow:visible;z-index:0;opacity:.72}
    .cover-motif-left,.motif-left{left:14px;top:88px;width:272px;height:204px}.cover-motif-right,.motif-right{right:14px;top:88px;width:272px;height:204px}.cover-motif-canvas-right,.motif-canvas-right{right:22px;bottom:22px;width:272px;height:204px}
    .cover-motif>g{vector-effect:non-scaling-stroke}
  `;

  const blockGeometry=block?`${layout.block.left!==undefined?`left:${layout.block.left}px;`:''}${layout.block.right!==undefined?`right:${layout.block.right}px;`:''}top:${layout.block.top}px;width:${layout.block.width}px;height:${layout.block.height}px;`:'';
  const html=`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style></head>
<body><div class="page cover cover-theme-${definition.id}" style="background:${canvasBackground};font-family:${fontStack(t.family)}">
${block?`<div class="cover-block" style="${blockGeometry}background:${blockColor};${arrowClip}"></div>`:''}
${textureHtml}
${giantHtml}
${decorations.map((deco)=>decorationHtml(deco,decorationColor(deco))).join('\n')}
${motif}
${frameHtml}
${mainLayers}
${metaHtml}
</div></body></html>`;
  return {html,width:COVER_WIDTH,height:COVER_HEIGHT,themeId:definition.id};
}
