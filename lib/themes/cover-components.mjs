// 公众号封面图组件目录与规格校验。
// 设计文档：docs/2026-08-07-cover-image-design.md
// 理念：AI 只做组件组合与排版决策（产出规格 JSON），渲染由确定性 HTML/CSS 完成；
// 规格任一不合规时整体回退到 fallbackCoverSpec，保证永远出图。

export const COVER_WIDTH=900, COVER_HEIGHT=383;

export const COVER_COMPONENT_CATALOG=Object.freeze({
  canvas:{label:'背景底色',required:true,max:1,fields:{colorRole:['page','ink','accent'],texture:['none','grid','scanlines'],gradient:['none','diagonal','radial']}},
  'color-block':{label:'几何色块',max:1,fields:{position:['left-third','left-half','right-half','right-panel','top-band','full'],shape:['rect','arrow','diagonal'],colorRole:['accent','ink','code'],text:['hold','span']}},
  frame:{label:'描边内框',max:1,fields:{style:['single','double'],colorRole:['ink','accent','muted']}},
  title:{label:'主标题',required:true,max:1,fields:{lines:'string[]',highlights:'string[]',align:['left','center']}},
  eyebrow:{label:'标签',max:1,fields:{form:['text','badge','numbering'],text:'string'}},
  subtitle:{label:'副标题',max:1,fields:{text:'string',withBar:'boolean'}},
  meta:{label:'信息行',max:1,fields:{text:'string'}},
  'giant-char':{label:'背景大字',max:1,fields:{text:'string',position:['left','right','center'],colorRole:['ink','accent','accentSecondary','inverseText']}},
  decoration:{label:'装饰',max:2,fields:{kind:['bar','dots','ring','cross','grid','corner-marks'],position:['top-left','top-center','top-right','middle-left','middle-right','bottom-left','bottom-center','bottom-right']}},
});

export const COVER_LIMITS=Object.freeze({titleLines:3,lineChars:14,highlights:2,eyebrowChars:12,subtitleChars:30,metaChars:30,giantChars:4,components:8});

// 构图骨架：把内置主题验证过的版式抽象成 5 套 layout，主题创建时先选骨架再在其约束内组合组件。
// block=null 表示该骨架不允许色块；require 列出骨架必含的组件类型；forbid 列出不允许的组件类型。
export const COVER_LAYOUT_RECIPES=Object.freeze({
  'side-panel':{label:'侧边面板',block:{positions:['left-third','left-half','right-half','right-panel'],shapes:['rect','diagonal','arrow']},require:[],forbid:['giant-char'],decoKinds:['bar','dots','cross','corner-marks']},
  'top-band':{label:'顶部色带',block:{positions:['top-band'],shapes:['rect']},require:[],forbid:['giant-char','frame'],decoKinds:['bar','dots','cross','corner-marks']},
  'diagonal-split':{label:'斜切分割',block:{positions:['left-third','left-half','right-half','right-panel'],shapes:['diagonal','arrow']},require:[],forbid:['frame'],decoKinds:['bar','dots','ring','cross','grid','corner-marks']},
  'centered-frame':{label:'居中框景',block:null,require:['frame'],forbid:['color-block','giant-char'],decoKinds:['corner-marks','dots','cross']},
  minimal:{label:'极简大字',block:null,require:[],forbid:['color-block','frame'],decoKinds:['bar','dots','ring','cross','grid','corner-marks']},
});

// 按骨架约束构图：返回 { components, changes }；changes 记录被丢弃/纠正的组件原因（宽容模式用）
export function enforceCoverLayout(components,layout){
  const recipe=COVER_LAYOUT_RECIPES[layout],changes=[];
  if(!recipe)return {components,changes};
  const kept=[];
  for(const component of components){
    if(recipe.forbid.includes(component.type)){changes.push({field:`components.${component.type}`,message:`${recipe.label}骨架不允许 ${COVER_COMPONENT_CATALOG[component.type].label}组件`});continue;}
    if(component.type==='color-block'&&recipe.block){
      const clean={...component};
      if(!recipe.block.positions.includes(clean.position)){changes.push({field:'components.color-block.position',message:`色块位置纠正为 ${recipe.block.positions[0]}（${recipe.label}骨架约束）`});clean.position=recipe.block.positions[0];}
      if(!recipe.block.shapes.includes(clean.shape||'rect')){changes.push({field:'components.color-block.shape',message:`色块形状纠正为 ${recipe.block.shapes[0]}（${recipe.label}骨架约束）`});clean.shape=recipe.block.shapes[0];}
      if(COVER_WIDE_BLOCK_POSITIONS.has(clean.position)&&clean.text!=='span'){changes.push({field:'components.color-block.text',message:'色块占画布一半，已自动改为 span（标题跨布局）'});clean.text='span';}
      kept.push(clean);continue;
    }
    if(component.type==='decoration'&&component.kind&&!recipe.decoKinds.includes(component.kind)){changes.push({field:'components.decoration.kind',message:`装饰样式纠正为 ${recipe.decoKinds[0]}（${recipe.label}骨架约束）`});kept.push({...component,kind:recipe.decoKinds[0]});continue;}
    kept.push(component);
  }
  for(const type of recipe.require)if(!kept.some((component)=>component.type===type))kept.push({type:'frame',style:'single',colorRole:'ink'});
  return {components:kept,changes};
}

// 骨架合规检查（严格模式）：构图必须满足骨架约束，否则给出门禁 issue
export function checkCoverLayout(components,layout){
  const recipe=COVER_LAYOUT_RECIPES[layout];
  if(!recipe)return [];
  const issues=[];
  for(const component of components){
    if(recipe.forbid.includes(component.type))issues.push(issue(`components.${component.type}`,`${recipe.label}骨架不允许 ${COVER_COMPONENT_CATALOG[component.type].label}组件`));
    if(component.type==='color-block'&&recipe.block){
      if(!recipe.block.positions.includes(component.position))issues.push(issue('components.color-block.position',`${recipe.label}骨架的色块位置必须是 ${recipe.block.positions.join(' / ')}`));
      if(!recipe.block.shapes.includes(component.shape||'rect'))issues.push(issue('components.color-block.shape',`${recipe.label}骨架的色块形状必须是 ${recipe.block.shapes.join(' / ')}`));
    }
    if(component.type==='decoration'&&component.kind&&!recipe.decoKinds.includes(component.kind))issues.push(issue('components.decoration.kind',`${recipe.label}骨架的装饰样式必须是 ${recipe.decoKinds.join(' / ')}`));
  }
  for(const type of recipe.require)if(!components.some((component)=>component.type===type))issues.push(issue(type,`${recipe.label}骨架必须包含${COVER_COMPONENT_CATALOG[type].label}组件`));
  return issues;
}

const charLength=(value)=>[...String(value||'')].length;

function issue(field,message){return {field,code:'INVALID',message};}

// 校验并规范化封面规格。返回 { ok, issues, spec }；ok=false 时调用方应使用 fallbackCoverSpec。
// expectedTitle 非空时启用标题保真校验：title.lines 拼接（去空白后）必须与文章原题一致，防止 AI 改写或编造标题。
export function validateCoverSpec(input,expectedTitle=''){
  const issues=[];
  if(!input||typeof input!=='object'||Array.isArray(input))return {ok:false,issues:[issue('spec','必须是对象')],spec:null};
  if(!Array.isArray(input.components)||!input.components.length||input.components.length>COVER_LIMITS.components)return {ok:false,issues:[issue('components',`必须是 1–${COVER_LIMITS.components} 个组件的数组`)],spec:null};
  const counts={},normalized=[];
  for(const [index,component] of input.components.entries()){
    const field=`components[${index}]`;
    if(!component||typeof component!=='object'||Array.isArray(component)){issues.push(issue(field,'组件必须是对象'));continue;}
    const meta=COVER_COMPONENT_CATALOG[component.type];
    if(!meta){issues.push(issue(`${field}.type`,'未知组件类型'));continue;}
    counts[component.type]=(counts[component.type]||0)+1;
    if(counts[component.type]>meta.max){issues.push(issue(`${field}.type`,`${meta.label}最多 ${meta.max} 个`));continue;}
    const clean={type:component.type};let valid=true;
    for(const [key,rule] of Object.entries(meta.fields)){
      const value=component[key];
      if(Array.isArray(rule)){
        if(value!==undefined&&!rule.includes(value)){issues.push(issue(`${field}.${key}`,`必须是 ${rule.join(' / ')}`));valid=false;}
        else if(value!==undefined)clean[key]=value;
      }else if(rule==='string'){
        if(value!==undefined&&typeof value!=='string'){issues.push(issue(`${field}.${key}`,'必须是字符串'));valid=false;}
        else if(typeof value==='string'&&value.trim())clean[key]=value.trim();
      }else if(rule==='string[]'){
        if(value!==undefined&&(!Array.isArray(value)||value.some((item)=>typeof item!=='string'))){issues.push(issue(`${field}.${key}`,'必须是字符串数组'));valid=false;}
        else if(Array.isArray(value))clean[key]=value.map((item)=>item.trim()).filter(Boolean);
      }else if(rule==='boolean'){
        if(value!==undefined&&typeof value!=='boolean'){issues.push(issue(`${field}.${key}`,'必须是布尔值'));valid=false;}
        else if(typeof value==='boolean')clean[key]=value;
      }
    }
    // 组件级约束
    if(clean.type==='title'){
      if(!clean.lines?.length||clean.lines.length>COVER_LIMITS.titleLines){issues.push(issue(`${field}.lines`,`必须提供 1–${COVER_LIMITS.titleLines} 行标题`));valid=false;}
      else if(clean.lines.some((line)=>!line||charLength(line)>COVER_LIMITS.lineChars)){issues.push(issue(`${field}.lines`,`每行 1–${COVER_LIMITS.lineChars} 字`));valid=false;}
      if(clean.highlights){
        const full=(clean.lines||[]).join('');
        if(clean.highlights.length>COVER_LIMITS.highlights){issues.push(issue(`${field}.highlights`,'高亮词最多 2 处'));valid=false;}
        else if(clean.highlights.some((word)=>!word||!full.includes(word))){issues.push(issue(`${field}.highlights`,'高亮词必须是标题原文子串'));valid=false;}
      }
      if(expectedTitle){
        const squash=(value)=>String(value||'').replace(/\s+/g,'');
        if(squash((clean.lines||[]).join(''))!==squash(expectedTitle)){issues.push(issue(`${field}.lines`,'断行拼接后必须与文章原题一致，不得改写或删减'));valid=false;}
      }
    }
    if(clean.type==='eyebrow'&&(!clean.text||charLength(clean.text)>COVER_LIMITS.eyebrowChars)){issues.push(issue(`${field}.text`,`标签文案 1–${COVER_LIMITS.eyebrowChars} 字`));valid=false;}
    if(clean.type==='giant-char'&&(!clean.text||charLength(clean.text)>COVER_LIMITS.giantChars)){issues.push(issue(`${field}.text`,`背景大字 1–${COVER_LIMITS.giantChars} 字`));valid=false;}
    if(clean.type==='subtitle'&&(!clean.text||charLength(clean.text)>COVER_LIMITS.subtitleChars)){issues.push(issue(`${field}.text`,`副标题 1–${COVER_LIMITS.subtitleChars} 字`));valid=false;}
    if(clean.type==='meta'&&(!clean.text||charLength(clean.text)>COVER_LIMITS.metaChars)){issues.push(issue(`${field}.text`,`信息行 1–${COVER_LIMITS.metaChars} 字`));valid=false;}
    if(valid)normalized.push(clean);
  }
  for(const [type,meta] of Object.entries(COVER_COMPONENT_CATALOG))if(meta.required&&!counts[type])issues.push(issue(type,`${meta.label}必须提供`));
  if(issues.length)return {ok:false,issues,spec:null};
  return {ok:true,issues:[],spec:{components:normalized}};
}

// 兜底构图：标题按标点/字数两行均分、无高亮、无装饰，对应效果图 v2 的极简形态。
export function fallbackCoverSpec(title,{brand='',subtitle=''}={}){
  const text=String(title||'未命名文章').trim()||'未命名文章';
  const lines=splitTitleLines(text);
  const components=[
    {type:'canvas',colorRole:'ink'},
    {type:'title',lines,highlights:[],align:'left'},
  ];
  if(subtitle)components.push({type:'subtitle',text:clampChars(subtitle,COVER_LIMITS.subtitleChars),withBar:true});
  if(brand)components.push({type:'meta',text:clampChars(brand,COVER_LIMITS.metaChars)});
  return {components};
}

// 超长文案截断：保留省略号标记截断，避免句子无声断尾。
function clampChars(text,max){
  const chars=[...String(text||'').trim()];
  return chars.length>max?`${chars.slice(0,max-1).join('')}…`:chars.join('');
}

// 标题断行：优先在标点处断，每行 ≤14 字；最多 3 行（42 字），仍超出才截断省略。
export function splitTitleLines(title){
  const text=String(title||'').trim();
  if(charLength(text)<=COVER_LIMITS.lineChars)return [text];
  const lines=[];let rest=text;
  while(charLength(rest)>COVER_LIMITS.lineChars&&lines.length<COVER_LIMITS.titleLines-1){
    const window=[...rest].slice(0,COVER_LIMITS.lineChars+1).join('');
    // 可用断点：标点后；小数点（后随数字的 .）不算断点，避免切散 1.4 这类数值。
    // 强标点（逗号句号等）允许稍短的半行，弱断点（空格/连接号）太短不如硬切，保住每行信息量
    const breaks=[...window.matchAll(/[：:，,。.！!？?—\-·\s]/g)]
      .filter((match)=>!(match[0]==='.'&&/\d/.test(window[match.index+1]||'')))
      .map((match)=>({cut:match.index+1,strong:/[：:，,。！!？?]/.test(match[0])}))
      .filter(({cut,strong})=>cut>=(strong?7:COVER_LIMITS.lineChars-3))
      .map(({cut})=>cut);
    const cut=breaks.length?breaks.at(-1):COVER_LIMITS.lineChars;
    lines.push(rest.slice(0,cut).trim());
    rest=rest.slice(cut).trim();
  }
  if(charLength(rest)>COVER_LIMITS.lineChars)rest=`${[...rest].slice(0,COVER_LIMITS.lineChars-1).join('')}…`;
  lines.push(rest);
  return lines;
}

// 主题内置构图：封面主题在创建时固化组件搭配，生成封面时不再由 AI 自由组合。
// 构图只含布局与样式决策；标题断行、副标题与信息行文案在生成时按文章填充。
export const COVER_THEME_SPEC_FIELDS=Object.freeze({
  canvas:{colorRole:['page','ink','accent'],texture:['none','grid','scanlines'],gradient:['none','diagonal','radial']},
  'color-block':{position:['left-third','left-half','right-half','right-panel','top-band','full'],shape:['rect','arrow','diagonal'],colorRole:['accent','ink','code'],text:['hold','span']},
  frame:{style:['single','double'],colorRole:['ink','accent','muted']},
  title:{align:['left','center']},
  eyebrow:{form:['text','badge','numbering']},
  subtitle:{withBar:'boolean'},
  meta:{},
  'giant-char':{text:'string',position:['left','right','center'],colorRole:['ink','accent','accentSecondary','inverseText']},
  decoration:{kind:['bar','dots','ring','cross','grid','corner-marks'],position:['top-left','top-center','top-right','middle-left','middle-right','bottom-left','bottom-center','bottom-right']},
});

// 占画布一半的侧边色块位置：这些布局下标题必须跨缝（span）。
// full 不在此列——色块铺满画布时编译器本就按 hold 处理，没有缝可跨。
const COVER_WIDE_BLOCK_POSITIONS=new Set(['left-half','right-half']);

// 主题构图的组件级校验：返回 { clean, issues }；clean 为 null 表示该组件不合规
function validateThemeSpecComponent(component,index){
  const field=`components[${index}]`,issues=[];
  if(!component||typeof component!=='object'||Array.isArray(component))return {clean:null,issues:[issue(field,'组件必须是对象')]};
  const meta=COVER_COMPONENT_CATALOG[component?.type],rules=COVER_THEME_SPEC_FIELDS[component?.type];
  if(!meta||!rules)return {clean:null,issues:[issue(`${field}.type`,'未知或不允许的组件类型')]};
  const clean={type:component.type};
  for(const [key,rule] of Object.entries(rules)){
    const value=component[key];
    if(Array.isArray(rule)){
      if(value!==undefined&&!rule.includes(value))issues.push(issue(`${field}.${key}`,`必须是 ${rule.join(' / ')}`));
      else if(value!==undefined)clean[key]=value;
    }else if(rule==='boolean'){
      if(value!==undefined&&typeof value!=='boolean')issues.push(issue(`${field}.${key}`,'必须是布尔值'));
      else if(value!==undefined)clean[key]=value;
    }else if(rule==='string'){
      if(value!==undefined&&typeof value!=='string')issues.push(issue(`${field}.${key}`,'必须是字符串'));
      else if(typeof value==='string'&&value.trim())clean[key]=value.trim();
    }
  }
  if(clean.type==='eyebrow'){
    const text=String(component.text||'').trim();
    if(!text||charLength(text)>COVER_LIMITS.eyebrowChars)issues.push(issue(`${field}.text`,`标签文案 1–${COVER_LIMITS.eyebrowChars} 字`));
    else clean.text=text;
  }
  if(clean.type==='giant-char'&&clean.text&&charLength(clean.text)>COVER_LIMITS.giantChars)issues.push(issue(`${field}.text`,`背景大字最多 ${COVER_LIMITS.giantChars} 字`));
  // 色块占画布一半及以上时，标题必须跨布局（span），否则文字窝在色块一侧、另半边沦为纯装饰
  if(clean.type==='color-block'&&COVER_WIDE_BLOCK_POSITIONS.has(clean.position)&&clean.text!=='span'){
    issues.push(issue(`${field}.text`,'色块占画布一半（left-half / right-half）时 text 必须为 span（标题跨布局）'));
  }
  return issues.length?{clean:null,issues}:{clean,issues:[]};
}

// 校验并规范化主题构图。canvas 必选；eyebrow 必须带静态文案（主题级组件，生成时不改写）。
// spec.layout 可选：声明构图骨架后，组件搭配必须满足骨架约束（COVER_LAYOUT_RECIPES）。
export function validateCoverThemeSpec(input){
  const issues=[];
  const source=Array.isArray(input?.components)?input.components:Array.isArray(input)?input:null;
  if(!source)return {ok:false,issues:[issue('spec','构图必须是 {components:[…]} 或组件数组')],spec:null};
  const layout=input?.layout;
  if(layout!==undefined&&!COVER_LAYOUT_RECIPES[layout])issues.push(issue('layout',`构图骨架必须是 ${Object.keys(COVER_LAYOUT_RECIPES).join(' / ')}`));
  const counts={},components=[];
  for(const [index,component] of source.entries()){
    const meta=COVER_COMPONENT_CATALOG[component?.type];
    if(meta){counts[component.type]=(counts[component.type]||0)+1;if(counts[component.type]>meta.max){issues.push(issue(`components[${index}].type`,`${meta.label}最多 ${meta.max} 个`));continue;}}
    const {clean,issues:componentIssues}=validateThemeSpecComponent(component,index);
    issues.push(...componentIssues);
    if(clean)components.push(clean);
  }
  if(!counts.canvas)issues.push(issue('canvas','背景底色必须提供'));
  if(COVER_LAYOUT_RECIPES[layout])issues.push(...checkCoverLayout(components,layout));
  if(issues.length)return {ok:false,issues,spec:null};
  return {ok:true,issues:[],spec:{...(layout?{layout}:{}) ,components}};
}

// 宽容模式：逐个组件校验，丢弃不合规的组件，缺失 canvas/title 时补默认项。
// 用于 AI 主题归一化——单个组件笔误不应让整套构图回退成素底标题。
export function sanitizeCoverThemeSpec(input){
  const source=Array.isArray(input?.components)?input.components:Array.isArray(input)?input:[];
  const counts={},components=[],dropped=[];
  if(input?.layout&&!COVER_LAYOUT_RECIPES[input.layout])dropped.push({field:'layout',message:'未知构图骨架，已移除'});
  for(const [index,component] of source.entries()){
    const meta=COVER_COMPONENT_CATALOG[component?.type];
    if(meta&&(counts[component.type]||0)>=meta.max){dropped.push({field:`components[${index}].type`,message:`${meta.label}最多 ${meta.max} 个`});continue;}
    // 宽色块未声明跨布局时自动纠正为 span，避免因规则被整体丢弃
    const candidate=(component?.type==='color-block'&&COVER_WIDE_BLOCK_POSITIONS.has(component?.position)&&component?.text!=='span')
      ?{...component,text:'span'}:component;
    if(candidate!==component)dropped.push({field:`components[${index}].text`,message:'色块占画布一半，已自动改为 span（标题跨布局）'});
    const {clean,issues}=validateThemeSpecComponent(candidate,index);
    if(!clean){dropped.push(...issues);continue;}
    counts[clean.type]=(counts[clean.type]||0)+1;
    components.push(clean);
  }
  if(!counts.canvas)components.unshift({type:'canvas',colorRole:'page'});
  if(!counts.title)components.push({type:'title',align:'left'});
  // 声明了骨架的构图按骨架约束收尾：丢弃禁入组件、纠正越界属性
  const layout=COVER_LAYOUT_RECIPES[input?.layout]?input.layout:null;
  if(layout){
    const enforced=enforceCoverLayout(components,layout);
    dropped.push(...enforced.changes);
    return {spec:{layout,components:enforced.components},dropped,kept:enforced.components.length};
  }
  return {spec:{components},dropped,kept:components.length};
}

// 按主题构图产出文章封面规格：标题确定性断行，副标题取文章摘要，信息行取品牌行。
export function coverSpecFromTheme(themeSpec,{title,subtitle='',brand=''}={}){
  const validation=validateCoverThemeSpec(themeSpec);
  if(!validation.ok)return null;
  const components=[];
  for(const component of validation.spec.components){
    if(component.type==='title'){
      components.push({type:'title',lines:splitTitleLines(title),highlights:[],align:component.align||'left'});
      continue;
    }
    if(component.type==='subtitle'){
      const text=String(subtitle||'').trim();
      if(text)components.push({...component,text:clampChars(text,COVER_LIMITS.subtitleChars)});
      continue;
    }
    if(component.type==='meta'){
      const text=String(brand||'').trim();
      if(text)components.push({...component,text:text.slice(0,COVER_LIMITS.metaChars)});
      continue;
    }
    // 背景大字：主题未指定静态字符时取标题首字
    if(component.type==='giant-char'&&!component.text){
      const first=[...String(title||'').trim()][0];
      if(first)components.push({...component,text:first});
      continue;
    }
    components.push(component);
  }
  const spec={components};
  return validateCoverSpec(spec).ok?spec:null;
}
