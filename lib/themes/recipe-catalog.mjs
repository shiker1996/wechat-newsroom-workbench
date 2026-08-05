export const ARTICLE_THEME_RECIPES=Object.freeze({
  frame:['warm-frame','gossip-frame','terminal-frame','report-frame','letter-frame','news-frame'],
  rhythm:['airy','standard','dense'],
  kicker:['none','chip','mono-line','center-label'],
  h1:['editorial-serif','gossip-title','terminal-title','center-double','serif-display','invert-block'],
  h2:['numbered-rule','eyebrow-border','terminal','center-double','cn-number','invert-tag'],
  lead:['none','rule-bottom'],quote:['warm-card','dark-block','terminal-panel','boxed','quote-marks','plain-bar'],
  divider:['ornament','hairline','mono-comment','rule-mark','stars','thick-bar'],
  list:['default','chevron','news-panel'],table:['tinted-header','dark-header','ink-header'],image:['plain','rounded','framed'],
});

export const SOCIAL_THEME_RECIPES=Object.freeze({
  surface:['base','palette','neon','brutalist'],frame:['soft-orbit','palette-frame','neon-frame','brutalist-frame'],
  decoration:['orbit','scanlines','paper-offset','soft-blur','circle','none'],eyebrow:['plain','accent','stamp','underline'],
  coverTitle:['classic','editorial','poster','highlight-block'],skeleton:['stacked','editorial-split','terminal-rail','paper-offset','impact-band'],coverSupport:['none','lead','statement','metric'],
  ending:['dark-fill','accent-fill','hard-fill'],list:['soft-card','tinted-card','outlined-card','hard-card','hard-accent'],code:['dark-panel','terminal-panel','hard-panel','accent-panel','ink-panel'],
});

export const THEME_RECIPE_CATALOG=Object.freeze({article:ARTICLE_THEME_RECIPES,social:SOCIAL_THEME_RECIPES});

const GROUP_META={article:{frame:['文章框架','article'],rhythm:['阅读节奏','article'],kicker:['眉题','kicker'],h1:['一级标题','h1'],h2:['二级标题','h2'],lead:['导语','lead'],quote:['引用块','blockquote'],divider:['分隔线','hr'],list:['列表','list'],table:['表格','table'],image:['图片','image']},social:{surface:['内容表面','page'],frame:['页面边框','page'],decoration:['装饰元素','page'],eyebrow:['眉题','eyebrow'],coverTitle:['封面标题','cover-title'],skeleton:['页面骨架','page'],coverSupport:['封面承载','cover-support'],ending:['结尾页','ending'],list:['列表卡片','list'],code:['代码面板','code']}};
const VALUE_LABELS={
  airy:'舒展长文',standard:'标准叙事',dense:'高密度快讯',stacked:'标准堆叠','editorial-split':'编辑双栏','terminal-rail':'终端轨道','paper-offset':'纸艺错位','impact-band':'冲击色带',lead:'导语承载',statement:'结论承载',metric:'数据承载',none:'无',classic:'经典标题',editorial:'杂志标题',poster:'海报大字','highlight-block':'强调色块',
  'warm-frame':'暖纸框架','gossip-frame':'吃瓜卡框','terminal-frame':'终端框架','report-frame':'研究框架','letter-frame':'书信框架','news-frame':'快讯框架',chip:'色块标签','mono-line':'命令行','center-label':'居中标签','editorial-serif':'杂志衬线','gossip-title':'卡片大标题','terminal-title':'终端标题','center-double':'双线居中','serif-display':'书刊标题','invert-block':'反白标题','numbered-rule':'编号引线','eyebrow-border':'眉题边线',terminal:'终端式','cn-number':'中文序号','invert-tag':'反白标签','rule-bottom':'底线导语','warm-card':'暖色卡片','dark-block':'深色块','terminal-panel':'终端面板',boxed:'方框','quote-marks':'引号装饰','plain-bar':'简洁边线',ornament:'刊物花饰',hairline:'细线','mono-comment':'代码注释','rule-mark':'规则标记',stars:'星号分隔','thick-bar':'粗线',default:'默认列表',chevron:'箭头列表','news-panel':'新闻面板','tinted-header':'浅色表头','dark-header':'深色表头','ink-header':'墨色表头',plain:'普通',rounded:'圆角',framed:'带框',base:'基础表面',palette:'配色表面',neon:'霓虹表面',brutalist:'野兽派表面','soft-orbit':'柔和环线','palette-frame':'配色边框','neon-frame':'霓虹边框','brutalist-frame':'野兽边框',orbit:'轨道圆环',scanlines:'扫描线','soft-blur':'柔光',circle:'几何圆',accent:'强调色',stamp:'印章',underline:'下划线','dark-fill':'深色结尾','accent-fill':'强调色结尾','hard-fill':'硬边结尾','soft-card':'柔和卡片','tinted-card':'染色卡片','outlined-card':'描边卡片','hard-card':'硬边卡片','hard-accent':'硬边强调色卡片','dark-panel':'深色代码','terminal-panel':'终端面板','hard-panel':'硬边代码','accent-panel':'强调色代码面板','ink-panel':'正文色代码',
};

export function themeRecipeEditorCatalog(target){
  const catalog=THEME_RECIPE_CATALOG[target];
  if(!catalog)throw new Error(`Unknown theme target: ${target}`);
  return Object.fromEntries(Object.entries(catalog).map(([group,values])=>[group,{label:GROUP_META[target][group]?.[0]||group,specimenRole:GROUP_META[target][group]?.[1]||group,options:values.map((value)=>({value,label:VALUE_LABELS[value]||value,description:`应用“${VALUE_LABELS[value]||value}”视觉方案`}))}]));
}
