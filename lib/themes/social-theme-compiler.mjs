import { getBuiltinThemeRegistry } from './theme-registry.mjs';
import { resolveSocialComponents } from './component-catalog.mjs';
import { fontStack } from './font-utils.mjs';

const SHADOWS={none:'none',soft:'0 20px 45px rgba(36,91,122,.14)',hard:'9px 9px 0 var(--accent)',glow:'0 0 30px color-mix(in srgb,var(--accent) 30%,transparent)'};
const lower=(value)=>String(value).toLowerCase();
const COLOR_VARS={text:'--ink',muted:'--muted',accent:'--accent',accentSecondary:'--accent2',inverseText:'--inverse',line:'--line'};
const colorVar=(role)=>`var(${COLOR_VARS[role]})`;
const SURFACE_VARS={surface:'--surface',page:'--page',accent:'--accent',accentSecondary:'--accent2',codeBackground:'--code'};
const surfaceValue=(role)=>role==='transparent'?'transparent':SURFACE_VARS[role]?`var(${SURFACE_VARS[role]})`:'';
const borderWidth=(weight)=>({none:'0',thin:'1px',medium:'2px',heavy:'4px'}[weight]||'');
const scaledSize=(base,scale,{compactDelta=-2,displayDelta=4,min=8,max=40}={})=>Math.min(max,Math.max(min,base+(scale==='compact'?compactDelta:scale==='display'?displayDelta:0)));
const DEFAULT_EFFECTS=Object.freeze({texture:'none',decorationOpacity:.35,contentTiltDeg:0});

export function socialThemeDefinition(themeId,{fallback=false}={}){
  const registry=getBuiltinThemeRegistry(),theme=registry.get(themeId);
  if(theme?.targets.includes('social'))return theme;
  if(fallback)return registry.require('ice-blue');
  return null;
}

function variables(theme){
  const c=theme.tokens.colors,t=theme.tokens.typography,sp=theme.tokens.spacing,s=theme.tokens.shape,effects={...DEFAULT_EFFECTS,...theme.social?.effects};
  return `--bg:${lower(c.background)};--page:${lower(c.page||c.surface)};--surface:${lower(c.surface)};--ink:${lower(c.text)};--muted:${lower(c.muted)};--accent:${lower(c.accent)};--accent2:${lower(c.accentSecondary)};--line:${lower(c.line)};--inverse:${lower(c.inverseText)};--code:${lower(c.codeBackground)};--body-size:${t.bodyPx}px;--h1-size:${t.h1Px}px;--h2-size:${t.h2Px}px;--caption-size:${t.captionPx}px;--code-size:${Number(t.codePx)||t.captionPx}px;--line-height:${t.lineHeight};--letter-spacing:${t.letterSpacingEm}em;--page-padding:${sp.articlePaddingPx}px;--section-gap:${sp.sectionPx}px;--paragraph-gap:${sp.paragraphPx}px;--card-gap:${sp.cardGapPx}px;--radius:${s.radiusPx}px;--border-width:${s.borderWidthPx}px;--shadow:${SHADOWS[s.shadow]};--decoration-opacity:${Number(effects.decorationOpacity)}`;
}

export function compileSocialTheme(theme){
  const definition=typeof theme==='string'?socialThemeDefinition(theme):theme;
  if(!definition?.social)throw new Error(`未知图文视觉主题：${definition?.id||theme}`);
  const id=definition.id,scope=`.theme-${id}`,baseRecipes=definition.social.recipes||{},skeleton=baseRecipes.skeleton||'stacked',recipes={coverTitle:'classic',skeleton,coverSupport:skeleton==='impact-band'?'statement':skeleton==='terminal-rail'?'metric':'lead',...baseRecipes},effects={...DEFAULT_EFFECTS,...definition.social.effects},components=resolveSocialComponents(definition);
  const palette=recipes.surface==='palette';
  const className=`theme-${id}${palette?' theme-palette':''}`;
  let css=`${scope}{${variables(definition)}}`;
  css+=`${scope}{background:var(--bg);color:var(--ink);font-family:${fontStack(definition.tokens.typography.family)};font-size:var(--body-size);line-height:var(--line-height);letter-spacing:var(--letter-spacing)}${scope} h1,${scope} h2,${scope} h3{font-family:${fontStack(definition.tokens.typography.headingFamily)}}${scope} .page{background:var(--page);color:var(--ink)}${scope} .page-inner{padding:var(--page-padding)}${scope} .page-content-stack{gap:var(--card-gap);padding:var(--section-gap);border:var(--border-width) solid var(--line);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow)}${scope} .page h1{font-size:var(--h1-size);letter-spacing:var(--letter-spacing)}${scope} .content-block{gap:var(--paragraph-gap)}${scope} .content-block h2{font-size:var(--h2-size)}${scope} .content-block p,${scope} .page li{font-size:var(--body-size);line-height:var(--line-height)}${scope} .brand,${scope} .page-number,${scope} .content-block h2{color:var(--accent)}${scope} .brand,${scope} .page-number,${scope} .eyebrow,${scope} .page-footer{font-size:var(--caption-size)}${scope} .eyebrow{color:var(--accent2)}${scope} .lead,${scope} .page-footer{color:var(--muted)}${scope} .page ul{gap:var(--card-gap)}${scope} .page li{border:var(--border-width) solid var(--line);border-radius:calc(var(--radius)/2);background:color-mix(in srgb,var(--accent) 12%,var(--surface))}${scope} .page li:before,${scope} .page-footer i{background:var(--accent2)}${scope} .code-block pre{border-radius:calc(var(--radius)/2);background:var(--code);color:var(--inverse)}${scope} .code-block code{font-size:var(--code-size);line-height:var(--line-height)}${scope} .note-block{border-left-color:var(--accent);border-radius:0 calc(var(--radius)/2) calc(var(--radius)/2) 0;background:color-mix(in srgb,var(--accent2) 14%,var(--surface))}${scope} .page-ending .page-content-stack{background:var(--accent);color:var(--inverse)}${scope} .page-ending .lead,${scope} .page-ending li,${scope} .page-ending .content-block h2{color:var(--inverse)}${scope} .page-ending li{background:rgba(0,0,0,.14)}${scope} .page-ending .note-block,${scope} .page-ending .highlight-block,${scope} .page-ending .scene,${scope} .page-ending .stat,${scope} .page-ending .compare-block td{color:var(--ink)}`;
  if(recipes.frame==='soft-orbit')css+=`${scope} .page-content-stack{border-color:color-mix(in srgb,var(--line) 72%,transparent)}`;
  if(recipes.frame==='palette-frame')css+=`${scope} .page-content-stack{outline:1px solid color-mix(in srgb,var(--accent2) 18%,transparent);outline-offset:3px}`;
  if(recipes.frame==='neon-frame')css+=`${scope} .page-content-stack{border-color:var(--accent);box-shadow:var(--shadow)}`;
  if(recipes.frame==='brutalist-frame')css+=`${scope} .page-content-stack{border-color:var(--ink);box-shadow:var(--shadow)}`;
  if(recipes.ending==='dark-fill')css+=`${scope} .page-ending .page-content-stack{background:var(--code);color:var(--inverse)}`;
  if(recipes.ending==='accent-fill')css+=`${scope} .page-ending .page-content-stack{background:var(--accent);color:var(--inverse)}`;
  if(recipes.ending==='hard-fill')css+=`${scope} .page-ending .page-content-stack{background:var(--accent);color:var(--inverse);border-color:var(--ink);box-shadow:var(--shadow)}`;
  if(recipes.list==='soft-card')css+=`${scope} .page li{border-color:transparent;background:color-mix(in srgb,var(--accent) 9%,var(--surface))}`;
  if(recipes.list==='tinted-card')css+=`${scope} .page li{background:color-mix(in srgb,var(--accent) 16%,var(--surface))}`;
  if(recipes.list==='outlined-card')css+=`${scope} .page li{background:transparent;border-color:var(--line)}`;
  if(recipes.list==='hard-card')css+=`${scope} .page li{background:var(--accent2);border-color:var(--ink);box-shadow:3px 3px 0 var(--ink)}`;
  if(recipes.list==='hard-accent')css+=`${scope} .page li{background:var(--accent);border-color:var(--ink);box-shadow:3px 3px 0 var(--ink)}`;
  if(recipes.code==='dark-panel')css+=`${scope} .code-block pre{background:var(--code);color:var(--inverse);border:var(--border-width) solid var(--line)}`;
  if(recipes.code==='terminal-panel')css+=`${scope} .code-block pre{background:var(--code);color:var(--accent);border:var(--border-width) solid var(--accent);box-shadow:var(--shadow)}`;
  if(recipes.code==='hard-panel')css+=`${scope} .code-block pre{background:var(--code);color:var(--inverse);border:max(2px,var(--border-width)) solid var(--ink);box-shadow:4px 4px 0 var(--ink)}`;
  if(recipes.code==='accent-panel')css+=`${scope} .code-block pre{background:var(--accent);color:var(--ink);border:max(2px,var(--border-width)) solid var(--ink);box-shadow:4px 4px 0 var(--ink)}`;
  if(recipes.code==='ink-panel')css+=`${scope} .code-block pre{background:var(--code);color:var(--ink);border:var(--border-width) solid var(--line)}`;
  if(recipes.surface==='base')css+=`${scope} .page{background:linear-gradient(145deg,var(--page) 0%,color-mix(in srgb,var(--page) 88%,var(--accent)) 58%,color-mix(in srgb,var(--page) 78%,var(--accent)) 100%)}${scope} .page-ending .page-content-stack{background:var(--code)}`;
  if(recipes.surface==='neon')css+=`${scope} .page{background-color:var(--page);background-image:linear-gradient(color-mix(in srgb,var(--accent) 7%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--accent) 7%,transparent) 1px,transparent 1px);background-size:22px 22px}${scope} .page:after{border:2px solid var(--accent);border-radius:0;transform:rotate(18deg);box-shadow:0 0 32px color-mix(in srgb,var(--accent) 28%,transparent)}${scope} .page-content-stack{background:color-mix(in srgb,var(--surface) 91%,transparent);box-shadow:8px 8px 0 var(--accent2)}${scope} .note-block{background:color-mix(in srgb,var(--accent2) 14%,var(--surface))}`;
  if(recipes.surface==='brutalist')css+=`${scope} .page{background:color-mix(in srgb,var(--page) 82%,var(--accent2))}${scope} .page:after{width:150px;height:150px;border:18px solid var(--accent);border-radius:0;right:-72px;top:-62px;transform:rotate(9deg)}${scope} .brand{padding:4px 7px;background:var(--ink);color:var(--inverse)}${scope} .page-number{font-size:15px;color:var(--ink)}${scope} .page-content-stack{border:4px solid var(--ink);box-shadow:10px 10px 0 var(--ink)}${scope} .eyebrow{width:max-content;padding:4px 7px;background:var(--accent2);color:var(--ink)}${scope} .page h1{font-weight:900}${scope} .content-block h2{text-decoration:underline;text-decoration-thickness:3px;text-decoration-color:var(--accent)}${scope} .page li{border:2px solid var(--ink);background:var(--accent2)}${scope} .code-block pre{border:3px solid var(--ink)}${scope} .note-block{border:3px solid var(--ink);border-left:10px solid var(--accent)}`;
  if(recipes.decoration==='scanlines')css+=`${scope} .page{background-image:repeating-linear-gradient(0deg,color-mix(in srgb,var(--accent) 3.5%,transparent) 0,color-mix(in srgb,var(--accent) 3.5%,transparent) 1px,transparent 1px,transparent 4px)}`;
  if(recipes.decoration==='paper-offset')css+=`${scope} .page-content-stack{transform:rotate(${Number(effects.contentTiltDeg)}deg)}`;
  if(effects.texture==='grid'&&recipes.surface!=='neon')css+=`${scope} .page{background-color:var(--page);background-image:linear-gradient(color-mix(in srgb,var(--accent) 7%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--accent) 7%,transparent) 1px,transparent 1px);background-size:22px 22px}`;
  if(effects.texture==='paper-grain')css+=`${scope} .page{background-image:radial-gradient(color-mix(in srgb,var(--ink) 5%,transparent) .6px,transparent .7px);background-size:5px 5px}`;
  if(recipes.decoration==='soft-blur')css+=`${scope} .page:after{filter:blur(1px)}`;
  if(recipes.decoration==='circle')css+=`${scope} .page:after{border-radius:50%}`;
  if(recipes.decoration==='none')css+=`${scope} .page:after{display:none}`;
  if(recipes.eyebrow==='plain')css+=`${scope} .eyebrow{color:var(--muted);letter-spacing:normal}`;
  if(recipes.eyebrow==='accent')css+=`${scope} .eyebrow{color:var(--accent2)}`;
  if(recipes.eyebrow==='stamp')css+=`${scope} .eyebrow{width:max-content;padding:4px 7px;border:1px solid currentColor;transform:rotate(-2deg)}`;
  if(recipes.eyebrow==='underline')css+=`${scope} .eyebrow{border-bottom:1px solid var(--accent);padding-bottom:5px}`;
  if(recipes.coverTitle==='classic')css+=`${scope} .page-cover h1{max-width:96%;padding-left:14px;border-left:2px solid var(--accent);line-height:1.2;letter-spacing:-.025em;text-wrap:balance}`;
  if(recipes.coverTitle==='editorial')css+=`${scope} .page-cover h1{font-family:${fontStack('serif')};font-weight:700;line-height:1.14;letter-spacing:-.025em;padding:14px 0 12px;border-top:4px double var(--ink);border-bottom:1px solid var(--accent);text-wrap:balance}`;
  if(recipes.coverTitle==='poster')css+=`${scope} .page-cover h1{font-weight:900;line-height:.98;letter-spacing:-.06em;padding-bottom:8px;border-bottom:4px solid var(--accent);text-wrap:balance;text-shadow:3px 3px 0 var(--accent2)}`;
  if(recipes.coverTitle==='highlight-block')css+=`${scope} .page-cover h1{width:100%;max-width:100%;padding:0;background:transparent;color:var(--inverse);font-weight:850;line-height:1.04;letter-spacing:-.04em}${scope} .page-cover h1 .cover-title-line{display:block;width:fit-content;max-width:100%;margin:3px 0;padding:5px 10px;background:var(--accent);color:inherit;box-shadow:4px 0 0 var(--accent2);transform:translateX(0);overflow-wrap:anywhere}${scope} .page-cover h1 .cover-title-line:nth-child(even){margin-left:8px;background:var(--code);color:var(--ink);box-shadow:-4px 0 0 var(--accent2)}${scope} .page-cover h1 .cover-title-line:nth-child(3n){margin-left:3px}`;
  if(recipes.skeleton==='editorial-split'){const splitPage=`${scope} .skeleton-editorial-split:not(.page-cover):not(.blocks-1):not(.blocks-3):not(.comp-cols-single)`;css+=`${splitPage} .page-content-stack{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,.92fr);align-content:center;gap:calc(var(--card-gap) + 2px) var(--section-gap)}${scope} .skeleton-editorial-split:not(.page-cover) .eyebrow,${scope} .skeleton-editorial-split:not(.page-cover) h1,${scope} .skeleton-editorial-split:not(.page-cover) .cover-support{grid-column:1/-1}${splitPage} .content-block:nth-child(odd){grid-column:1}${splitPage} .content-block:nth-child(even){grid-column:2}${splitPage} .content-block.stats-block,${splitPage} .content-block.compare-block,${splitPage} .content-block.code-block{grid-column:1/-1}`;}
  if(recipes.skeleton==='terminal-rail')css+=`${scope} .skeleton-terminal-rail .page-content-stack{border-left:max(3px,var(--border-width)) solid var(--accent);padding-left:calc(var(--section-gap) - 4px)}${scope} .skeleton-terminal-rail .content-block{padding-left:8px;border-left:1px dashed var(--line)}`;
  if(recipes.skeleton==='paper-offset')css+=`${scope} .skeleton-paper-offset .page-content-stack{transform:rotate(-.6deg);box-shadow:6px 6px 0 color-mix(in srgb,var(--accent2) 35%,transparent)}`;
  if(recipes.skeleton==='impact-band')css+=`${scope} .skeleton-impact-band .page-content-stack{border-radius:0;box-shadow:8px 8px 0 var(--accent2)}${scope} .skeleton-impact-band h1{font-weight:900;letter-spacing:-.06em}`;
  const cover=components.coverTitle,coverFont=cover.fontFamily==='inherit'?'':`font-family:${fontStack(cover.fontFamily)};`;
  css+=`${scope} .page-cover h1{${coverFont}font-weight:${cover.fontWeight};font-size:${scaledSize(definition.tokens.typography.h1Px,cover.sizeScale,{compactDelta:-3,displayDelta:4,min:22,max:38})}px;color:${colorVar(cover.colorRole)};border-color:${colorVar(cover.borderColorRole)}}`;
  const eyebrow=components.eyebrow,eyebrowFont=eyebrow.fontFamily==='inherit'?'':`font-family:${fontStack(eyebrow.fontFamily)};`;
  css+=`${scope} .eyebrow{${eyebrowFont}font-weight:${eyebrow.fontWeight};color:${colorVar(eyebrow.colorRole)}}`;
  const lead=components.lead;
  css+=`${scope} .page-cover .lead{font-size:${scaledSize(definition.tokens.typography.bodyPx,lead.sizeScale,{compactDelta:0,displayDelta:4,min:9,max:17})}px;color:${colorVar(lead.colorRole)}}`;
  const statValue=components.statValue,statFont=statValue.fontFamily==='inherit'?'':`font-family:${fontStack(statValue.fontFamily)};`;
  css+=`${scope} .stat b{${statFont}font-weight:${statValue.fontWeight};font-size:${scaledSize(19,statValue.sizeScale,{compactDelta:-2,displayDelta:5,min:15,max:28})}px;color:${colorVar(statValue.colorRole)}}`;
  const statLabel=components.statLabel;
  css+=`${scope} .stat span{font-size:${scaledSize(9,statLabel.sizeScale,{compactDelta:-1,displayDelta:2,min:8,max:12})}px;color:${colorVar(statLabel.colorRole)}}`;
  const step=components.step;
  css+=`${scope} .step h3{color:${colorVar(step.titleColorRole)}}${scope} .step p{color:${colorVar(step.bodyColorRole)}}${scope} .step>b{background:${surfaceValue(step.markerSurfaceRole)||'var(--accent)'}}`;
  const table=components.compareTable;
  css+=`${scope} .compare-block th{color:${colorVar(table.headerTextColorRole)};background:${surfaceValue(table.headerSurfaceRole)||'var(--accent)'}}${scope} .compare-block td{color:${colorVar(table.bodyTextColorRole)};border-color:${colorVar(table.borderColorRole)}}`;
  const list=components.list,listSurface=surfaceValue(list.surfaceRole),listBorder=borderWidth(list.borderWeight);
  css+=`${scope} .page li{color:${colorVar(list.textColorRole)};border-color:${colorVar(list.borderColorRole)};${listSurface?`background:${listSurface};`:''}${listBorder?`border-width:${listBorder};border-style:solid;`:''}}`;
  const note=components.note,noteSurface=surfaceValue(note.surfaceRole),noteBorder=borderWidth(note.borderWeight);
  css+=`${scope} .note-block,${scope} .note-block h2,${scope} .note-block p{color:${colorVar(note.textColorRole)}}${scope} .note-block{border-left-color:${colorVar(note.borderColorRole)};${noteSurface?`background:${noteSurface};`:''}${noteBorder?`border-left-width:${noteBorder};`:''}}`;
  const contentTitle=components.contentTitle,contentTitleFont=contentTitle.fontFamily==='inherit'?'':`font-family:${fontStack(contentTitle.fontFamily)};`;
  css+=`${scope} .page:not(.page-cover):not(.page-ending) h1{${contentTitleFont}font-size:${scaledSize(definition.tokens.typography.h1Px,contentTitle.sizeScale,{compactDelta:-3,displayDelta:4,min:20,max:38})}px;color:${colorVar(contentTitle.colorRole)}}`;
  const endingTitle=components.endingTitle,endingTitleFont=endingTitle.fontFamily==='inherit'?'':`font-family:${fontStack(endingTitle.fontFamily)};`;
  css+=`${scope} .page-ending h1{${endingTitleFont}font-size:${scaledSize(definition.tokens.typography.h1Px,endingTitle.sizeScale,{compactDelta:-3,displayDelta:4,min:20,max:38})}px;color:${colorVar(endingTitle.colorRole)}}`;
  return Object.freeze({id,label:definition.label,version:definition.version,hash:definition.hash,target:'social',className,css,definition,variables:definition.tokens,recipes:{...recipes},usageMap:{
    'tokens.colors.background':['body'],'tokens.colors.surface':['content-stack'],'tokens.colors.page':['page'],'tokens.colors.text':['page','content'],
    'tokens.colors.muted':['lead','footer'],'tokens.colors.accent':['brand','heading','ending'],'tokens.colors.accentSecondary':['eyebrow','marker'],
    'tokens.colors.line':['frame','list','table'],'tokens.colors.inverseText':['ending','code'],'tokens.colors.codeBackground':['code'],
    'tokens.typography.family':['body'],'tokens.typography.headingFamily':['heading'],'tokens.typography.bodyPx':['content'],'tokens.typography.h1Px':['h1'],
    'tokens.typography.h2Px':['h2'],'tokens.typography.captionPx':['eyebrow','footer'],'tokens.typography.codePx':['code'],'tokens.typography.lineHeight':['content'],'tokens.typography.letterSpacingEm':['body'],
    'tokens.spacing.articlePaddingPx':['page-inner'],'tokens.spacing.sectionPx':['page-content-stack'],'tokens.spacing.paragraphPx':['content-block'],
    'tokens.spacing.cardGapPx':['list','card-row'],'tokens.shape.radiusPx':['content-stack','list','code'],'tokens.shape.borderWidthPx':['content-stack'],
    'tokens.shape.shadow':['content-stack'],'social.recipes.surface':['page','content-stack'],'social.recipes.frame':['content-stack'],
    'social.recipes.decoration':['page-decoration'],'social.recipes.eyebrow':['eyebrow'],'social.recipes.coverTitle':['cover-title'],'social.recipes.skeleton':['page-skeleton'],'social.recipes.coverSupport':['cover-support'],
    'social.recipes.ending':['ending'],'social.recipes.list':['list'],'social.recipes.code':['code'],
    'social.effects.texture':['page'],'social.effects.decorationOpacity':['page-decoration'],'social.effects.contentTiltDeg':['content-stack'],
    'social.components.coverTitle.fontFamily':['cover-title'],'social.components.coverTitle.fontWeight':['cover-title'],
    'social.components.coverTitle.sizeScale':['cover-title'],'social.components.coverTitle.colorRole':['cover-title'],
    'social.components.coverTitle.borderColorRole':['cover-title'],'social.components.eyebrow.fontFamily':['eyebrow'],
    'social.components.eyebrow.fontWeight':['eyebrow'],'social.components.eyebrow.colorRole':['eyebrow'],
    'social.components.lead.sizeScale':['lead'],'social.components.lead.colorRole':['lead'],
    'social.components.statValue.fontFamily':['stat-value'],'social.components.statValue.fontWeight':['stat-value'],'social.components.statValue.sizeScale':['stat-value'],'social.components.statValue.colorRole':['stat-value'],
    'social.components.statLabel.sizeScale':['stat-label'],'social.components.statLabel.colorRole':['stat-label'],
    'social.components.step.titleColorRole':['step'],'social.components.step.bodyColorRole':['step'],'social.components.step.markerSurfaceRole':['step'],
    'social.components.compareTable.headerTextColorRole':['compare-table'],'social.components.compareTable.headerSurfaceRole':['compare-table'],'social.components.compareTable.bodyTextColorRole':['compare-table'],'social.components.compareTable.borderColorRole':['compare-table'],
    'social.components.list.textColorRole':['list'],'social.components.list.surfaceRole':['list'],'social.components.list.borderColorRole':['list'],'social.components.list.borderWeight':['list'],
    'social.components.note.textColorRole':['note'],'social.components.note.surfaceRole':['note'],'social.components.note.borderColorRole':['note'],'social.components.note.borderWeight':['note'],
    'social.components.contentTitle.fontFamily':['content-title'],'social.components.contentTitle.sizeScale':['content-title'],'social.components.contentTitle.colorRole':['content-title'],
    'social.components.endingTitle.fontFamily':['ending-title'],'social.components.endingTitle.sizeScale':['ending-title'],'social.components.endingTitle.colorRole':['ending-title']
  }});
}
