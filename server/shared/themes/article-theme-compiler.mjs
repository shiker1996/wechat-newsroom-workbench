import { getBuiltinThemeRegistry } from './theme-registry.mjs';
import { resolveArticleComponents } from './component-catalog.mjs';

const ARTICLE_THEME_ORDER=['magazine-warm','gossip-card','tech-wire','research-report','career-essay','news-digest'];

export function articleThemeDefinition(themeId,{fallback=true}={}){
  const registry=getBuiltinThemeRegistry();
  const theme=registry.get(themeId);
  if(theme?.targets.includes('article'))return theme;
  if(fallback)return registry.require('magazine-warm');
  return null;
}

export function compileArticleTheme(theme){
  const definition=typeof theme==='string'?articleThemeDefinition(theme):theme;
  if(!definition?.article)throw new Error(`主题不支持文章排版：${definition?.id||theme}`);
  const {tokens,article}=definition,behavior={justify:false,highlightStrong:'accent',numberSections:false,...article.behavior},recipes={rhythm:'standard',...article.recipes},components=resolveArticleComponents(definition);
  return Object.freeze({
    id:definition.id,label:definition.label,version:definition.version,hash:definition.hash,
    target:'article',definition,variables:tokens,
    tokens:{colors:{background:tokens.colors.background,text:tokens.colors.text,muted:tokens.colors.muted,accent:tokens.colors.accent},typography:{body_px:tokens.typography.bodyPx,line_height:tokens.typography.lineHeight,h2_px:tokens.typography.h2Px},spacing:{section_px:tokens.spacing.sectionPx,paragraph_px:tokens.spacing.paragraphPx},image:{radius_px:recipes.image==='rounded'?tokens.shape.radiusPx:0,caption_px:tokens.typography.captionPx}},
    variants:{frame:recipes.frame,rhythm:recipes.rhythm,kicker:recipes.kicker==='none'?null:recipes.kicker,h1:recipes.h1,h2:recipes.h2,lead:recipes.lead!=='none',quote:recipes.quote,divider:recipes.divider,list:recipes.list,table:recipes.table,image:recipes.image,serifHeadings:tokens.typography.headingFamily==='serif',justify:Boolean(behavior.justify),strong:behavior.highlightStrong,bodyFont:tokens.typography.family},
    components,
    recipes:{...recipes},
    usageMap:{
      'tokens.colors.background':['article'],'tokens.colors.surface':['blockquote','list','table'],'tokens.colors.text':['article','heading','paragraph'],
      'tokens.colors.muted':['kicker','divider','footnote'],'tokens.colors.accent':['frame','heading','link'],'tokens.colors.accentSecondary':['kicker','list-marker'],
      'tokens.colors.line':['frame','divider','table','code'],'tokens.colors.inverseText':['inverted-heading','quote','table-header'],
      'tokens.colors.codeBackground':['code','pre'],'tokens.typography.family':['article'],'tokens.typography.headingFamily':['h1','h2','h3'],
      'tokens.typography.bodyPx':['article'],'tokens.typography.h1Px':['h1'],'tokens.typography.h2Px':['h2'],'tokens.typography.captionPx':['kicker','caption','footnote'],
      'tokens.typography.lineHeight':['article','paragraph'],'tokens.typography.letterSpacingEm':['article'],'tokens.spacing.articlePaddingPx':['article'],
      'tokens.spacing.sectionPx':['section','heading'],'tokens.spacing.paragraphPx':['paragraph'],'tokens.spacing.cardGapPx':['blockquote','list','table'],
      'tokens.shape.radiusPx':['blockquote','code','image'],'tokens.shape.borderWidthPx':['frame','blockquote','table'],'tokens.shape.shadow':['blockquote','image'],
      'article.recipes.frame':['article'],'article.recipes.rhythm':['article','section','paragraph'],'article.recipes.kicker':['kicker'],'article.recipes.h1':['h1'],'article.recipes.h2':['h2'],
      'article.recipes.lead':['lead'],'article.recipes.quote':['blockquote'],'article.recipes.divider':['divider'],'article.recipes.list':['list'],
      'article.recipes.table':['table'],'article.recipes.image':['image'],'article.behavior.justify':['article','paragraph'],
      'article.behavior.highlightStrong':['strong'],'article.behavior.numberSections':['h2','section-counter'],
      'article.components.title.fontFamily':['h1'],'article.components.title.sizeScale':['h1'],'article.components.title.colorRole':['h1'],
      'article.components.lead.sizeScale':['lead'],'article.components.lead.colorRole':['lead'],
      'article.components.quote.textColorRole':['blockquote'],'article.components.quote.surfaceRole':['blockquote'],'article.components.quote.borderColorRole':['blockquote'],
      'article.components.list.textColorRole':['list'],'article.components.list.markerColorRole':['list-marker'],
      'article.components.table.headerTextColorRole':['table'],'article.components.table.headerSurfaceRole':['table'],'article.components.table.borderColorRole':['table'],
      'article.components.code.textColorRole':['code'],'article.components.code.surfaceRole':['code'],
      'article.components.imageCaption.sizeScale':['caption'],'article.components.imageCaption.colorRole':['caption']
    },
  });
}

export function articleThemeCompatibilityView(){
  const registry=getBuiltinThemeRegistry();
  return Object.freeze(Object.fromEntries(ARTICLE_THEME_ORDER.map((id)=>{const compiled=compileArticleTheme(registry.require(id));return [id,Object.freeze({label:compiled.label,tokens:compiled.tokens,variants:compiled.variants,version:compiled.version,hash:compiled.hash})];})));
}
