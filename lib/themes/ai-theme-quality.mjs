const COLOR_KEYS=['background','surface','page','text','muted','accent','accentSecondary','line','inverseText','codeBackground'];
const NUMBER_RANGES={bodyPx:[9,18],h1Px:[22,44],h2Px:[11,28],captionPx:[8,15],lineHeight:[1.2,2.1],letterSpacingEm:[-.08,.2],articlePaddingPx:[0,40],sectionPx:[12,48],paragraphPx:[6,28],cardGapPx:[0,28],radiusPx:[0,32],borderWidthPx:[0,8]};

function rgb(value){const match=String(value||'').match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);return match?match.slice(1).map((part)=>parseInt(part,16)):null;}
function colorSimilarity(a,b){const left=rgb(a),right=rgb(b);if(!left||!right)return 0;const distance=Math.sqrt(left.reduce((sum,value,index)=>sum+(value-right[index])**2,0));return Math.max(0,1-distance/441.673);}
function average(values){return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;}
function targetOf(theme){return theme?.targets?.[0]||'';}
function numberSimilarity(a,b,[min,max]){return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,1-Math.abs(a-b)/(max-min)):0;}
function entries(theme){return {...theme?.tokens?.typography,...theme?.tokens?.spacing,...theme?.tokens?.shape};}
function componentEntries(theme){const target=targetOf(theme);if(!['social','article'].includes(target))return {};const value=target==='social'?resolveSocialComponents(theme):resolveArticleComponents(theme);return Object.fromEntries(Object.entries(value).flatMap(([component,fields])=>Object.entries(fields).map(([key,fieldValue])=>[`${component}.${key}`,fieldValue])));}

export function themeVisualSimilarity(left,right){
  const target=targetOf(left);if(!target||target!==targetOf(right))return 0;
  const colors=average(COLOR_KEYS.filter((key)=>left.tokens?.colors?.[key]&&right.tokens?.colors?.[key]).map((key)=>colorSimilarity(left.tokens.colors[key],right.tokens.colors[key]))),leftValues=entries(left),rightValues=entries(right);
  const numbers=average(Object.entries(NUMBER_RANGES).map(([key,range])=>numberSimilarity(leftValues[key],rightValues[key],range)));
  const categorical=average(['family','headingFamily','shadow'].map((key)=>leftValues[key]===rightValues[key]?1:0));
  const recipeKeys=Object.keys(left[target]?.recipes||{}),recipes=recipeKeys.length?average(recipeKeys.map((key)=>left[target]?.recipes?.[key]===right[target]?.recipes?.[key]?1:0)):1,leftComponents=componentEntries(left),rightComponents=componentEntries(right),componentKeys=Object.keys(leftComponents),components=componentKeys.length?average(componentKeys.map((key)=>leftComponents[key]===rightComponents[key]?1:0)):1;
  return Number((colors*.4+numbers*.15+categorical*.1+recipes*.2+components*.15).toFixed(4));
}

function differences(candidate,reference){
  const target=targetOf(candidate),items=[],changedColors=COLOR_KEYS.filter((key)=>candidate.tokens.colors?.[key]&&reference.tokens.colors?.[key]&&candidate.tokens.colors[key]!==reference.tokens.colors[key]);
  if(changedColors.length)items.push({group:'配色',summary:`${changedColors.length} 个颜色角色不同`,fields:changedColors.map((key)=>`tokens.colors.${key}`)});
  const typeKeys=['family','headingFamily','bodyPx','h1Px','h2Px','lineHeight','letterSpacingEm'],changedType=typeKeys.filter((key)=>candidate.tokens.typography?.[key]!==reference.tokens.typography?.[key]);if(changedType.length)items.push({group:'字体与字阶',summary:`${changedType.length} 项阅读参数不同`,fields:changedType.map((key)=>`tokens.typography.${key}`)});
  const shapeKeys=['radiusPx','borderWidthPx','shadow'],changedShape=shapeKeys.filter((key)=>candidate.tokens.shape?.[key]!==reference.tokens.shape?.[key]);if(changedShape.length)items.push({group:'形状与层次',summary:`${changedShape.length} 项质感参数不同`,fields:changedShape.map((key)=>`tokens.shape.${key}`)});
  const changedRecipes=Object.keys(candidate[target]?.recipes||{}).filter((key)=>candidate[target].recipes[key]!==reference[target]?.recipes?.[key]);if(changedRecipes.length)items.push({group:'组件配方',summary:`${changedRecipes.length} 个组件样式不同`,fields:changedRecipes.map((key)=>`${target}.recipes.${key}`)});
  const candidateComponents=componentEntries(candidate),referenceComponents=componentEntries(reference),changedComponents=Object.keys(candidateComponents).filter((key)=>candidateComponents[key]!==referenceComponents[key]);if(changedComponents.length)items.push({group:'组件细节',summary:`${changedComponents.length} 个文字属性不同`,fields:changedComponents.map((key)=>`${target}.components.${key}`)});
  return items;
}

export function compareAiThemeCandidate(candidate,references=[]){
  const eligible=references.filter((theme)=>theme&&targetOf(theme)===targetOf(candidate)&&theme.id!==candidate.id),ranked=eligible.map((theme)=>({theme,similarity:themeVisualSimilarity(candidate,theme)})).sort((a,b)=>b.similarity-a.similarity),nearest=ranked[0];
  if(!nearest)return {nearestTheme:null,similarity:0,verdict:'unique',recommendRegenerate:false,differences:[]};
  const similarity=nearest.similarity,recommendRegenerate=similarity>=.94;return {nearestTheme:{id:nearest.theme.id,label:nearest.theme.label,source:nearest.theme.source},similarity,similarityPercent:Math.round(similarity*100),verdict:recommendRegenerate?'too-similar':similarity>=.82?'related':'distinct',recommendRegenerate,differences:differences(candidate,nearest.theme)};
}

export function compactThemeSignatures(themes,target){return themes.filter((theme)=>targetOf(theme)===target).map((theme)=>({id:theme.id,label:theme.label,colors:{background:theme.tokens.colors.background,surface:theme.tokens.colors.surface,text:theme.tokens.colors.text,accent:theme.tokens.colors.accent,accentSecondary:theme.tokens.colors.accentSecondary},type:{family:theme.tokens.typography.family,headingFamily:theme.tokens.typography.headingFamily,h1Px:theme.tokens.typography.h1Px},shape:theme.tokens.shape,...(theme[target]?{recipes:theme[target].recipes,components:target==='social'?resolveSocialComponents(theme):resolveArticleComponents(theme)}:{})}));}
import { resolveArticleComponents, resolveSocialComponents } from './component-catalog.mjs';
