import { semanticCardColumns } from './social-card-columns.mjs';
import { cardPageDensity } from './social-card-plan.mjs';
import { recommendedCardLayout, resolveCardLayoutDecision } from './social-card-layout.mjs';
import { inferCardPageRole, SOCIAL_CARD_PAGE_ROLES, stableCardCompositionSeed } from './social-card-role.mjs';

const make = (id, columns, flow, alignment, decoration, overlap) => ({ id, columns, flow, alignment, decoration, overlap });
const SMART_VARIANTS = Object.freeze({
  cover:[make('hero-stack','single','stack','end','orbit','title-card'),make('hero-frame','single','stack','center','index-line','accent-edge')],
  concept:[make('concept-split','split-wide','alternate','center','index-line','none'),make('concept-offset','split-narrow','alternate','start','stamp','accent-edge')],
  feature:[make('feature-ledger','split-even','alternate','start','index-line','none'),make('feature-stack','single','stack','start','stamp','accent-edge')],
  steps:[make('sequence-rail','single','stack','start','index-line','none'),make('sequence-offset','split-narrow','alternate','start','orbit','accent-edge')],
  data:[make('metric-board','single','stack','start','index-line','none'),make('metric-split','split-even','alternate','center','orbit','accent-edge')],
  compare:[make('comparison-board','single','stack','start','index-line','none'),make('comparison-split','split-even','alternate','center','stamp','none')],
  evidence:[make('evidence-ledger','split-wide','alternate','start','index-line','none'),make('evidence-frame','split-narrow','alternate','center','stamp','accent-edge')],
  timeline:[make('timeline-rail','single','stack','start','index-line','none'),make('timeline-offset','split-narrow','alternate','start','orbit','none')],
  risk:[make('risk-sidebar','split-narrow','alternate','center','stamp','accent-edge'),make('risk-frame','single','stack','start','index-line','none')],
  ending:[make('closing-focus','single','stack','center','orbit','title-card'),make('closing-note','single','stack','end','stamp','accent-edge')],
});
const ENUMS={columns:new Set(['single','split-wide','split-even','split-narrow']),flow:new Set(['stack','alternate']),alignment:new Set(['start','center','end']),decoration:new Set(['none','orbit','index-line','stamp']),overlap:new Set(['none','title-card','accent-edge'])};

function safeComposition(role) { const variants=SMART_VARIANTS[role],base=variants.find((variant)=>variant.columns==='single')||variants[0],composition={...base,decoration:'none',overlap:'none'};if(composition.columns!=='single'){composition.columns='single';composition.flow='stack';}return composition; }

export function normalizeCardComposition(page={}, {pageIndex=0,seed='',forceSafe=false,avoidIds=[]}={}) {
  const role=SOCIAL_CARD_PAGE_ROLES.includes(page.role)?page.role:inferCardPageRole(page),variants=SMART_VARIANTS[role];
  let picked=variants[stableCardCompositionSeed(page,pageIndex,seed)%variants.length];
  if(!forceSafe&&avoidIds.includes(picked.id)){const alternative=variants.find((variant)=>!avoidIds.includes(variant.id));if(alternative)picked=alternative;}
  const recommended=forceSafe?safeComposition(role):picked,input=page.composition&&typeof page.composition==='object'?page.composition:{},registered=variants.find((variant)=>variant.id===input.id),partial=!forceSafe&&Boolean(registered);
  const field=(key)=>partial&&ENUMS[key].has(input[key])?input[key]:registered?.[key];
  const invalidInputAdjusted=partial&&['columns','flow','alignment','decoration','overlap'].some((key)=>input[key]!=null&&!ENUMS[key].has(input[key]));
  const resolved=partial?{id:registered.id,columns:field('columns'),flow:field('flow'),alignment:field('alignment'),decoration:field('decoration'),overlap:field('overlap')}:{...recommended};
  const blocks=Array.isArray(page.content_blocks)?page.content_blocks:[],columns=forceSafe?'single':semanticCardColumns(page,blocks),flow=columns==='single'?'stack':'alternate',composition={...resolved,columns,flow};
  const adjusted=invalidInputAdjusted||(partial&&(resolved.columns!==columns||resolved.flow!==flow));
  return {role,composition,variantIndex:variants.findIndex((variant)=>variant.id===composition.id),variantCount:variants.length,source:forceSafe?'safe':partial?'storyboard':'recommended',fallback:!partial&&Boolean(page.composition),adjusted};
}

export function resolveCardCompositionDecision(page,{compositionMode='smart',layoutStyle='auto',channelMode='wechat',pageIndex=0,seed='',forceSafe=false,avoidIds=[]}={}) {
  if(compositionMode!=='smart'){const template=resolveCardLayoutDecision(page,layoutStyle,channelMode);return {...template,mode:'template',role:inferCardPageRole(page),composition:null};}
  const smart=normalizeCardComposition(page,{pageIndex,seed,forceSafe,avoidIds});
  return {mode:'smart',role:smart.role,composition:smart.composition,variantIndex:smart.variantIndex,variantCount:smart.variantCount,layout:recommendedCardLayout(page,channelMode),source:smart.fallback?'fallback':smart.source,adjusted:smart.adjusted,reason:forceSafe?'布局审计触发安全变体':smart.fallback?'故事板构图参数不合法，已按内容关系确定列宽':smart.adjusted?'故事板构图已按内容关系修正列宽或补齐非法字段':`按内容关系确定列宽，并为${smart.role}页面选择稳定视觉变体`};
}

export function describeCardLayouts(pages,{layoutStyle='auto',channelMode='wechat',compositionMode='template',seed=''}={}) {
  const usedByRole=new Map();
  return (Array.isArray(pages)?pages:[]).map((page,index)=>{const role=SOCIAL_CARD_PAGE_ROLES.includes(page?.role)?page.role:inferCardPageRole(page),decision=resolveCardCompositionDecision(page,{compositionMode,layoutStyle,channelMode,pageIndex:index,seed,avoidIds:usedByRole.get(role)||[]});if(decision.role&&decision.composition?.id){if(!usedByRole.has(decision.role))usedByRole.set(decision.role,[]);usedByRole.get(decision.role).push(decision.composition.id);}return {page:index+1,...decision,density:cardPageDensity(page)};});
}
