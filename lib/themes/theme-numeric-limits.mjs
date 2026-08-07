export const THEME_NUMERIC_LIMITS={
  'tokens.typography.bodyPx':[9,18,1],
  'tokens.typography.h1Px':[22,44,1],
  'tokens.typography.h2Px':[11,28,1],
  'tokens.typography.captionPx':[8,15,1],
  'tokens.typography.codePx':[8,15,1],
  'tokens.typography.lineHeight':[1.2,2.1,.05],
  'tokens.typography.letterSpacingEm':[-.08,.2,.005],
  'tokens.spacing.articlePaddingPx':[0,40,1],
  'tokens.spacing.sectionPx':[12,48,1],
  'tokens.spacing.paragraphPx':[6,28,1],
  'tokens.spacing.cardGapPx':[0,28,1],
  'tokens.shape.radiusPx':[0,32,1],
  'tokens.shape.borderWidthPx':[0,8,1],
};

export const SOCIAL_USER_NUMERIC_LIMITS={
  ...THEME_NUMERIC_LIMITS,
  'tokens.typography.bodyPx':[9,13,1],
  'tokens.typography.h1Px':[22,34,1],
  'tokens.typography.h2Px':[11,18,1],
  'tokens.typography.captionPx':[8,11,1],
  'tokens.typography.codePx':[8,13,1],
  'tokens.typography.lineHeight':[1.2,1.55,.05],
  'tokens.spacing.articlePaddingPx':[0,28,1],
  'tokens.spacing.sectionPx':[12,28,1],
  'tokens.spacing.paragraphPx':[6,12,1],
  'tokens.spacing.cardGapPx':[0,14,1],
};

export const SOCIAL_DENSITY_THRESHOLDS={
  'tokens.typography.bodyPx':12,
  'tokens.typography.h1Px':32,
  'tokens.typography.h2Px':16,
  'tokens.typography.captionPx':10,
  'tokens.typography.lineHeight':1.5,
  'tokens.spacing.articlePaddingPx':24,
  'tokens.spacing.sectionPx':24,
  'tokens.spacing.paragraphPx':8,
  'tokens.spacing.cardGapPx':12,
};

export const SOCIAL_DENSITY_MAX_HIGH_VALUES=3;

function valueAt(root,path){return path.split('.').reduce((value,key)=>value?.[key],root);}

export function themeNumericLimits({target='',source='builtin'}={}){
  return target==='social'&&source!=='builtin'?SOCIAL_USER_NUMERIC_LIMITS:THEME_NUMERIC_LIMITS;
}

export function socialDensityHighFields(definition){
  return Object.entries(SOCIAL_DENSITY_THRESHOLDS).filter(([field,threshold])=>valueAt(definition,field)>threshold).map(([field])=>field);
}
