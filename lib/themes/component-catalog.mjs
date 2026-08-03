export const FONT_FAMILIES=Object.freeze(['inherit','sans','serif','mono']);
export const FONT_WEIGHTS=Object.freeze([500,600,700,800,900]);
export const SIZE_SCALES=Object.freeze(['compact','standard','display']);
export const TEXT_COLOR_ROLES=Object.freeze(['text','muted','accent','accentSecondary','inverseText']);
export const BORDER_COLOR_ROLES=Object.freeze(['line','text','accent','accentSecondary']);
export const SURFACE_ROLES=Object.freeze(['inherit','transparent','surface','page','accent','accentSecondary','codeBackground']);
export const BORDER_WEIGHTS=Object.freeze(['inherit','none','thin','medium','heavy']);

const OPTION_LABELS={inherit:'继承主题',sans:'无衬线',serif:'衬线',mono:'等宽',500:'纤细',600:'中等',700:'加粗',800:'特粗',900:'黑体',compact:'紧凑',standard:'标准',display:'展示',text:'正文色',muted:'弱化色',accent:'主强调色',accentSecondary:'次强调色',inverseText:'反白色',line:'边线色',transparent:'透明',surface:'内容表面',page:'页面底色',codeBackground:'深色表面',none:'无边框',thin:'细边框',medium:'中边框',heavy:'粗边框'};
const field=(label,values)=>Object.freeze({label,options:Object.freeze(values.map((value)=>Object.freeze({value,label:OPTION_LABELS[value]})))});

export const SOCIAL_COMPONENT_CATALOG=Object.freeze({
  coverTitle:Object.freeze({label:'封面主标题',specimenRole:'cover-title',hint:'配方决定造型；这里细调字体、字重、字号档位和语义颜色。',fields:Object.freeze({fontFamily:field('字体角色',FONT_FAMILIES),fontWeight:field('字重',FONT_WEIGHTS),sizeScale:field('字号档位',SIZE_SCALES),colorRole:field('文字颜色',TEXT_COLOR_ROLES),borderColorRole:field('装饰边线',BORDER_COLOR_ROLES)})}),
  eyebrow:Object.freeze({label:'封面眉题',specimenRole:'eyebrow',hint:'控制眉题字体语气与颜色，不改变印章或下划线造型。',fields:Object.freeze({fontFamily:field('字体角色',FONT_FAMILIES),fontWeight:field('字重',FONT_WEIGHTS),colorRole:field('文字颜色',TEXT_COLOR_ROLES)})}),
  lead:Object.freeze({label:'封面导语',specimenRole:'lead',hint:'使用安全字号档位和语义颜色，保持长标题画布稳定。',fields:Object.freeze({sizeScale:field('字号档位',SIZE_SCALES),colorRole:field('文字颜色',TEXT_COLOR_ROLES)})}),
  statValue:Object.freeze({label:'数据卡数字',specimenRole:'stat-value',hint:'控制关键数字的字体、字重、字号和颜色。',fields:Object.freeze({fontFamily:field('字体角色',FONT_FAMILIES),fontWeight:field('字重',FONT_WEIGHTS),sizeScale:field('字号档位',SIZE_SCALES),colorRole:field('文字颜色',TEXT_COLOR_ROLES)})}),
  statLabel:Object.freeze({label:'数据卡标签',specimenRole:'stat-label',hint:'控制数字下方标签的字号和颜色。',fields:Object.freeze({sizeScale:field('字号档位',SIZE_SCALES),colorRole:field('文字颜色',TEXT_COLOR_ROLES)})}),
  step:Object.freeze({label:'步骤组件',specimenRole:'step',hint:'分别控制步骤标题、正文和序号色块。',fields:Object.freeze({titleColorRole:field('标题颜色',TEXT_COLOR_ROLES),bodyColorRole:field('正文颜色',TEXT_COLOR_ROLES),markerSurfaceRole:field('序号底色',SURFACE_ROLES)})}),
  compareTable:Object.freeze({label:'对比表',specimenRole:'compare-table',hint:'控制表头与表格正文的颜色、底色和边线。',fields:Object.freeze({headerTextColorRole:field('表头文字',TEXT_COLOR_ROLES),headerSurfaceRole:field('表头底色',SURFACE_ROLES),bodyTextColorRole:field('正文颜色',TEXT_COLOR_ROLES),borderColorRole:field('边线颜色',BORDER_COLOR_ROLES)})}),
  list:Object.freeze({label:'列表卡片',specimenRole:'list',hint:'在列表配方之上细调文字、表面和边框。',fields:Object.freeze({textColorRole:field('文字颜色',TEXT_COLOR_ROLES),surfaceRole:field('卡片底色',SURFACE_ROLES),borderColorRole:field('边线颜色',BORDER_COLOR_ROLES),borderWeight:field('边线粗细',BORDER_WEIGHTS)})}),
  note:Object.freeze({label:'提示框',specimenRole:'note',hint:'控制提示框正文、表面和左侧强调边线。',fields:Object.freeze({textColorRole:field('文字颜色',TEXT_COLOR_ROLES),surfaceRole:field('提示底色',SURFACE_ROLES),borderColorRole:field('强调边线',BORDER_COLOR_ROLES),borderWeight:field('边线粗细',BORDER_WEIGHTS)})}),
  contentTitle:Object.freeze({label:'内容页标题',specimenRole:'content-title',hint:'独立控制非封面、非结尾页面的一级标题。',fields:Object.freeze({fontFamily:field('字体角色',FONT_FAMILIES),sizeScale:field('字号档位',SIZE_SCALES),colorRole:field('文字颜色',TEXT_COLOR_ROLES)})}),
  endingTitle:Object.freeze({label:'结尾页标题',specimenRole:'ending-title',hint:'独立控制结尾页标题，并保持反色表面的可读性。',fields:Object.freeze({fontFamily:field('字体角色',FONT_FAMILIES),sizeScale:field('字号档位',SIZE_SCALES),colorRole:field('文字颜色',TEXT_COLOR_ROLES)})}),
});

export const ARTICLE_COMPONENT_CATALOG=Object.freeze({
  title:Object.freeze({label:'文章主标题',specimenRole:'h1',hint:'在标题配方之上调整字体、字号档位与语义颜色。',fields:Object.freeze({fontFamily:field('字体角色',FONT_FAMILIES),sizeScale:field('字号档位',SIZE_SCALES),colorRole:field('文字颜色',TEXT_COLOR_ROLES)})}),
  lead:Object.freeze({label:'文章导语',specimenRole:'lead',hint:'控制首段导语的字号档位与文字颜色。',fields:Object.freeze({sizeScale:field('字号档位',SIZE_SCALES),colorRole:field('文字颜色',TEXT_COLOR_ROLES)})}),
  quote:Object.freeze({label:'引用块',specimenRole:'blockquote',hint:'在引用配方上调整文字、表面和强调边线。',fields:Object.freeze({textColorRole:field('文字颜色',TEXT_COLOR_ROLES),surfaceRole:field('引用底色',SURFACE_ROLES),borderColorRole:field('强调边线',BORDER_COLOR_ROLES)})}),
  list:Object.freeze({label:'文章列表',specimenRole:'list',hint:'分别控制列表正文和标记颜色。',fields:Object.freeze({textColorRole:field('文字颜色',TEXT_COLOR_ROLES),markerColorRole:field('标记颜色',TEXT_COLOR_ROLES)})}),
  table:Object.freeze({label:'文章表格',specimenRole:'table',hint:'控制表头文字、表头底色与表格边线。',fields:Object.freeze({headerTextColorRole:field('表头文字',TEXT_COLOR_ROLES),headerSurfaceRole:field('表头底色',SURFACE_ROLES),borderColorRole:field('表格边线',BORDER_COLOR_ROLES)})}),
  code:Object.freeze({label:'代码面板',specimenRole:'code',hint:'控制行内代码与代码块的文字和底色。',fields:Object.freeze({textColorRole:field('代码文字',TEXT_COLOR_ROLES),surfaceRole:field('代码底色',SURFACE_ROLES)})}),
  imageCaption:Object.freeze({label:'图片说明',specimenRole:'caption',hint:'控制图片替代说明的字号档位和文字颜色。',fields:Object.freeze({sizeScale:field('字号档位',SIZE_SCALES),colorRole:field('文字颜色',TEXT_COLOR_ROLES)})}),
});

export function socialComponentDefaults(recipes={}){
  const cover=recipes.coverTitle||'classic',eyebrow=recipes.eyebrow||'accent';
  return {
    coverTitle:{fontFamily:cover==='editorial'?'serif':'inherit',fontWeight:cover==='poster'?900:cover==='highlight-block'?800:cover==='editorial'?700:700,sizeScale:'standard',colorRole:cover==='highlight-block'?'inverseText':'text',borderColorRole:'accent'},
    eyebrow:{fontFamily:'inherit',fontWeight:800,colorRole:eyebrow==='plain'?'muted':'accentSecondary'},lead:{sizeScale:'standard',colorRole:'muted'},
    statValue:{fontFamily:'inherit',fontWeight:800,sizeScale:'standard',colorRole:'accent'},statLabel:{sizeScale:'standard',colorRole:'muted'},
    step:{titleColorRole:'text',bodyColorRole:'muted',markerSurfaceRole:'accent'},
    compareTable:{headerTextColorRole:'inverseText',headerSurfaceRole:'accent',bodyTextColorRole:'text',borderColorRole:'line'},
    list:{textColorRole:'text',surfaceRole:'inherit',borderColorRole:'line',borderWeight:'inherit'},
    note:{textColorRole:'text',surfaceRole:'inherit',borderColorRole:'accent',borderWeight:'inherit'},
    contentTitle:{fontFamily:'inherit',sizeScale:'standard',colorRole:'text'},endingTitle:{fontFamily:'inherit',sizeScale:'standard',colorRole:'inverseText'},
  };
}

export function resolveSocialComponents(definition){const defaults=socialComponentDefaults(definition?.social?.recipes||{}),components=definition?.social?.components||{};return Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,{...value,...components[key]}]));}
export function socialComponentEditorCatalog(recipes={}){return {groups:SOCIAL_COMPONENT_CATALOG,defaults:socialComponentDefaults(recipes)};}
export function articleComponentDefaults(recipes={}){return {title:{fontFamily:'inherit',sizeScale:'standard',colorRole:'text'},lead:{sizeScale:'standard',colorRole:'text'},quote:{textColorRole:recipes.quote==='dark-block'?'inverseText':'text',surfaceRole:'inherit',borderColorRole:'accent'},list:{textColorRole:'text',markerColorRole:'accentSecondary'},table:{headerTextColorRole:['dark-header','ink-header'].includes(recipes.table)?'inverseText':'text',headerSurfaceRole:'inherit',borderColorRole:'line'},code:{textColorRole:'inverseText',surfaceRole:'codeBackground'},imageCaption:{sizeScale:'standard',colorRole:'muted'}};}
export function resolveArticleComponents(definition){const defaults=articleComponentDefaults(definition?.article?.recipes||{}),components=definition?.article?.components||{};return Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,{...value,...components[key]}]));}
export function articleComponentEditorCatalog(recipes={}){return {groups:ARTICLE_COMPONENT_CATALOG,defaults:articleComponentDefaults(recipes)};}
