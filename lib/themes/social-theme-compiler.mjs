import { getBuiltinThemeRegistry } from './theme-registry.mjs';

const SHADOWS={none:'none',soft:'0 20px 45px rgba(36,91,122,.14)',hard:'9px 9px 0 var(--accent)',glow:'0 0 30px color-mix(in srgb,var(--accent) 30%,transparent)'};
const lower=(value)=>String(value).toLowerCase();
const fontStack=(role)=>role==='mono'?'ui-monospace,Consolas,"Microsoft YaHei",monospace':role==='serif'?'Georgia,"Noto Serif SC","Microsoft YaHei",serif':'"Noto Sans SC","Microsoft YaHei",sans-serif';

export function socialThemeDefinition(themeId,{fallback=false}={}){
  const registry=getBuiltinThemeRegistry(),theme=registry.get(themeId);
  if(theme?.targets.includes('social'))return theme;
  if(fallback)return registry.require('ice-blue');
  return null;
}

function variables(theme){
  const c=theme.tokens.colors,t=theme.tokens.typography,sp=theme.tokens.spacing,s=theme.tokens.shape,effects=theme.social?.effects||{};
  return `--bg:${lower(c.background)};--page:${lower(c.page||c.surface)};--surface:${lower(c.surface)};--ink:${lower(c.text)};--muted:${lower(c.muted)};--accent:${lower(c.accent)};--accent2:${lower(c.accentSecondary)};--line:${lower(c.line)};--inverse:${lower(c.inverseText)};--code:${lower(c.codeBackground)};--body-size:${t.bodyPx}px;--h1-size:${t.h1Px}px;--h2-size:${t.h2Px}px;--caption-size:${t.captionPx}px;--line-height:${t.lineHeight};--letter-spacing:${t.letterSpacingEm}em;--page-padding:${sp.articlePaddingPx}px;--section-gap:${sp.sectionPx}px;--paragraph-gap:${sp.paragraphPx}px;--card-gap:${sp.cardGapPx}px;--radius:${s.radiusPx}px;--border-width:${s.borderWidthPx}px;--shadow:${SHADOWS[s.shadow]};--decoration-opacity:${Number(effects.decorationOpacity)}`;
}

export function compileSocialTheme(theme){
  const definition=typeof theme==='string'?socialThemeDefinition(theme):theme;
  if(!definition?.social)throw new Error(`未知图文视觉主题：${definition?.id||theme}`);
  const id=definition.id,scope=`.theme-${id}`,recipes=definition.social.recipes,effects=definition.social.effects||{};
  const palette=recipes.surface==='palette';
  const className=`theme-${id}${palette?' theme-palette':''}`;
  let css=`${scope}{${variables(definition)}}`;
  css+=`${scope}{background:var(--bg);color:var(--ink);font-family:${fontStack(definition.tokens.typography.family)};font-size:var(--body-size);line-height:var(--line-height);letter-spacing:var(--letter-spacing)}${scope} h1,${scope} h2,${scope} h3{font-family:${fontStack(definition.tokens.typography.headingFamily)}}${scope} .page{background:var(--page);color:var(--ink)}${scope} .page-inner{padding:var(--page-padding)}${scope} .page-content-stack{gap:var(--card-gap);padding:var(--section-gap);border:var(--border-width) solid var(--line);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow)}${scope} .page h1{font-size:var(--h1-size);letter-spacing:var(--letter-spacing)}${scope} .content-block{gap:var(--paragraph-gap)}${scope} .content-block h2{font-size:var(--h2-size)}${scope} .content-block p,${scope} .page li{font-size:var(--body-size);line-height:var(--line-height)}${scope} .brand,${scope} .page-number,${scope} .content-block h2{color:var(--accent)}${scope} .brand,${scope} .page-number,${scope} .eyebrow,${scope} .page-footer{font-size:var(--caption-size)}${scope} .eyebrow{color:var(--accent2)}${scope} .lead,${scope} .page-footer{color:var(--muted)}${scope} .page ul{gap:var(--card-gap)}${scope} .page li{border:var(--border-width) solid var(--line);border-radius:calc(var(--radius)/2);background:color-mix(in srgb,var(--accent) 12%,var(--surface))}${scope} .page li:before,${scope} .page-footer i{background:var(--accent2)}${scope} .code-block pre{border-radius:calc(var(--radius)/2);background:var(--code);color:var(--inverse)}${scope} .code-block code{font-size:var(--caption-size);line-height:var(--line-height)}${scope} .note-block{border-left-color:var(--accent);border-radius:0 calc(var(--radius)/2) calc(var(--radius)/2) 0;background:color-mix(in srgb,var(--accent2) 14%,var(--surface))}${scope} .page-ending .page-content-stack{background:var(--accent);color:var(--inverse)}${scope} .page-ending .lead,${scope} .page-ending li,${scope} .page-ending .content-block h2{color:var(--inverse)}${scope} .page-ending li{background:rgba(0,0,0,.14)}${scope} .page-ending .note-block,${scope} .page-ending .highlight-block,${scope} .page-ending .scene,${scope} .page-ending .stat,${scope} .page-ending .compare-block td{color:var(--ink)}`;
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
  if(recipes.code==='dark-panel')css+=`${scope} .code-block pre{background:var(--code);color:var(--inverse);border:var(--border-width) solid var(--line)}`;
  if(recipes.code==='terminal-panel')css+=`${scope} .code-block pre{background:var(--code);color:var(--accent);border:var(--border-width) solid var(--accent);box-shadow:var(--shadow)}`;
  if(recipes.code==='hard-panel')css+=`${scope} .code-block pre{background:var(--code);color:var(--inverse);border:max(2px,var(--border-width)) solid var(--ink);box-shadow:4px 4px 0 var(--ink)}`;
  if(recipes.surface==='base')css+=`${scope} .page{background:linear-gradient(145deg,#f9fcff 0%,#e7f2fa 58%,#d8eaf5 100%)}${scope} .page-ending .page-content-stack{background:var(--code)}`;
  if(recipes.surface==='neon')css+=`${scope} .page{background-color:var(--bg);background-image:linear-gradient(color-mix(in srgb,var(--accent) 7%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--accent) 7%,transparent) 1px,transparent 1px);background-size:22px 22px}${scope} .page:after{border:2px solid var(--accent);border-radius:0;transform:rotate(18deg);box-shadow:0 0 32px color-mix(in srgb,var(--accent) 28%,transparent)}${scope} .page-content-stack{background:color-mix(in srgb,var(--surface) 91%,transparent);box-shadow:8px 8px 0 var(--accent2)}${scope} .note-block{background:color-mix(in srgb,var(--accent2) 14%,var(--surface))}`;
  if(recipes.surface==='brutalist')css+=`${scope} .page{background:color-mix(in srgb,var(--surface) 82%,var(--accent2))}${scope} .page:after{width:150px;height:150px;border:18px solid var(--accent);border-radius:0;right:-72px;top:-62px;transform:rotate(9deg)}${scope} .brand{padding:4px 7px;background:var(--ink);color:var(--inverse)}${scope} .page-number{font-size:15px;color:var(--ink)}${scope} .page-content-stack{border:4px solid var(--ink);box-shadow:10px 10px 0 var(--ink)}${scope} .eyebrow{width:max-content;padding:4px 7px;background:var(--accent2);color:var(--ink)}${scope} .page h1{font-weight:900}${scope} .content-block h2{text-decoration:underline;text-decoration-thickness:3px;text-decoration-color:var(--accent)}${scope} .page li{border:2px solid var(--ink);background:var(--accent2)}${scope} .code-block pre{border:3px solid var(--ink)}${scope} .note-block{border:3px solid var(--ink);border-left:10px solid var(--accent)}`;
  if(recipes.decoration==='scanlines')css+=`${scope} .page{background-image:repeating-linear-gradient(0deg,color-mix(in srgb,var(--accent) 3.5%,transparent) 0,color-mix(in srgb,var(--accent) 3.5%,transparent) 1px,transparent 1px,transparent 4px)}`;
  if(recipes.decoration==='paper-offset')css+=`${scope} .page-content-stack{transform:rotate(${Number(effects.contentTiltDeg)}deg)}`;
  if(effects.texture==='grid'&&recipes.surface!=='neon')css+=`${scope} .page{background-image:linear-gradient(color-mix(in srgb,var(--accent) 7%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--accent) 7%,transparent) 1px,transparent 1px);background-size:22px 22px}`;
  if(effects.texture==='paper-grain')css+=`${scope} .page{background-image:radial-gradient(color-mix(in srgb,var(--ink) 5%,transparent) .6px,transparent .7px);background-size:5px 5px}`;
  if(recipes.decoration==='soft-blur')css+=`${scope} .page:after{filter:blur(1px)}`;
  if(recipes.decoration==='circle')css+=`${scope} .page:after{border-radius:50%}`;
  if(recipes.decoration==='none')css+=`${scope} .page:after{display:none}`;
  if(recipes.eyebrow==='plain')css+=`${scope} .eyebrow{color:var(--muted);letter-spacing:normal}`;
  if(recipes.eyebrow==='accent')css+=`${scope} .eyebrow{color:var(--accent2)}`;
  if(recipes.eyebrow==='stamp')css+=`${scope} .eyebrow{width:max-content;padding:4px 7px;border:1px solid currentColor;transform:rotate(-2deg)}`;
  if(recipes.eyebrow==='underline')css+=`${scope} .eyebrow{border-bottom:1px solid var(--accent);padding-bottom:5px}`;
  return Object.freeze({id,label:definition.label,version:definition.version,hash:definition.hash,target:'social',className,css,definition,variables:definition.tokens,recipes:{...recipes},usageMap:{
    'tokens.colors.background':['body'],'tokens.colors.surface':['content-stack'],'tokens.colors.page':['page'],'tokens.colors.text':['page','content'],
    'tokens.colors.muted':['lead','footer'],'tokens.colors.accent':['brand','heading','ending'],'tokens.colors.accentSecondary':['eyebrow','marker'],
    'tokens.colors.line':['frame','list','table'],'tokens.colors.inverseText':['ending','code'],'tokens.colors.codeBackground':['code'],
    'tokens.typography.family':['body'],'tokens.typography.headingFamily':['heading'],'tokens.typography.bodyPx':['content'],'tokens.typography.h1Px':['h1'],
    'tokens.typography.h2Px':['h2'],'tokens.typography.captionPx':['eyebrow','footer'],'tokens.typography.lineHeight':['content'],'tokens.typography.letterSpacingEm':['body'],
    'tokens.spacing.articlePaddingPx':['page-inner'],'tokens.spacing.sectionPx':['page-content-stack'],'tokens.spacing.paragraphPx':['content-block'],
    'tokens.spacing.cardGapPx':['list','card-row'],'tokens.shape.radiusPx':['content-stack','list','code'],'tokens.shape.borderWidthPx':['content-stack'],
    'tokens.shape.shadow':['content-stack']
  }});
}
