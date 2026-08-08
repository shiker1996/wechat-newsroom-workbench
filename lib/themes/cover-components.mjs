// 公众号封面图组件目录与规格校验。
// 设计文档：docs/2026-08-07-cover-image-design.md
// 理念：AI 只做组件组合与排版决策（产出规格 JSON），渲染由确定性 HTML/CSS 完成；
// 规格任一不合规时整体回退到 fallbackCoverSpec，保证永远出图。

export const COVER_WIDTH=900, COVER_HEIGHT=383;

export const COVER_COMPONENT_CATALOG=Object.freeze({
  canvas:{label:'背景底色',required:true,max:1,fields:{colorRole:['page','ink','accent']}},
  'color-block':{label:'几何色块',max:1,fields:{position:['left-third','left-half','right-half','right-panel','top-band','full'],shape:['rect','arrow','diagonal'],colorRole:['accent','ink','code']}},
  title:{label:'主标题',required:true,max:1,fields:{lines:'string[]',highlights:'string[]',align:['left','center']}},
  eyebrow:{label:'标签',max:1,fields:{form:['text','badge','numbering'],text:'string'}},
  subtitle:{label:'副标题',max:1,fields:{text:'string',withBar:'boolean'}},
  meta:{label:'信息行',max:1,fields:{text:'string'}},
  'giant-char':{label:'背景大字',max:1,fields:{text:'string',position:['left','right','center'],colorRole:['ink','accent','accentSecondary','inverseText']}},
  decoration:{label:'装饰',max:2,fields:{kind:['bar','dots','ring','cross','grid','corner-marks'],position:['top-left','top-center','top-right','middle-left','middle-right','bottom-left','bottom-center','bottom-right']}},
});

export const COVER_LIMITS=Object.freeze({titleLines:2,lineChars:14,highlights:2,eyebrowChars:12,subtitleChars:30,metaChars:30,giantChars:4,components:7});

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
  if(subtitle)components.push({type:'subtitle',text:subtitle.slice(0,COVER_LIMITS.subtitleChars),withBar:true});
  if(brand)components.push({type:'meta',text:brand.slice(0,COVER_LIMITS.metaChars)});
  return {components};
}

// 标题两行均分：优先在标点处断行，否则按字数均分；超长截断到约束内。
export function splitTitleLines(title){
  const text=String(title||'').trim();
  if(charLength(text)<=COVER_LIMITS.lineChars)return [text];
  const breakables=[...text.matchAll(/[：:，,。.！!？?—\-·\s]/g)].map((match)=>match.index+1);
  const half=charLength(text)/2;
  const at=breakables.find((index)=>index>=Math.floor(half)-2&&charLength(text.slice(0,index))<=COVER_LIMITS.lineChars&&charLength(text.slice(index))<=COVER_LIMITS.lineChars);
  if(at)return [text.slice(0,at).trim(),text.slice(at).trim()];
  const chars=[...text];
  const first=chars.slice(0,COVER_LIMITS.lineChars).join('');
  let rest=chars.slice(COVER_LIMITS.lineChars).join('');
  if(charLength(rest)>COVER_LIMITS.lineChars)rest=`${[...rest].slice(0,COVER_LIMITS.lineChars-1).join('')}…`;
  return [first,rest];
}

// 主题内置构图：封面主题在创建时固化组件搭配，生成封面时不再由 AI 自由组合。
// 构图只含布局与样式决策；标题断行、副标题与信息行文案在生成时按文章填充。
export const COVER_THEME_SPEC_FIELDS=Object.freeze({
  canvas:{colorRole:['page','ink','accent']},
  'color-block':{position:['left-third','left-half','right-half','right-panel','top-band','full'],shape:['rect','arrow','diagonal'],colorRole:['accent','ink','code']},
  title:{align:['left','center']},
  eyebrow:{form:['text','badge','numbering']},
  subtitle:{withBar:'boolean'},
  meta:{},
  'giant-char':{text:'string',position:['left','right','center'],colorRole:['ink','accent','accentSecondary','inverseText']},
  decoration:{kind:['bar','dots','ring','cross','grid','corner-marks'],position:['top-left','top-center','top-right','middle-left','middle-right','bottom-left','bottom-center','bottom-right']},
});

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
  return issues.length?{clean:null,issues}:{clean,issues:[]};
}

// 校验并规范化主题构图。canvas 必选；eyebrow 必须带静态文案（主题级组件，生成时不改写）。
export function validateCoverThemeSpec(input){
  const issues=[];
  const source=Array.isArray(input?.components)?input.components:Array.isArray(input)?input:null;
  if(!source)return {ok:false,issues:[issue('spec','构图必须是 {components:[…]} 或组件数组')],spec:null};
  const counts={},components=[];
  for(const [index,component] of source.entries()){
    const meta=COVER_COMPONENT_CATALOG[component?.type];
    if(meta){counts[component.type]=(counts[component.type]||0)+1;if(counts[component.type]>meta.max){issues.push(issue(`components[${index}].type`,`${meta.label}最多 ${meta.max} 个`));continue;}}
    const {clean,issues:componentIssues}=validateThemeSpecComponent(component,index);
    issues.push(...componentIssues);
    if(clean)components.push(clean);
  }
  if(!counts.canvas)issues.push(issue('canvas','背景底色必须提供'));
  if(issues.length)return {ok:false,issues,spec:null};
  return {ok:true,issues:[],spec:{components}};
}

// 宽容模式：逐个组件校验，丢弃不合规的组件，缺失 canvas/title 时补默认项。
// 用于 AI 主题归一化——单个组件笔误不应让整套构图回退成素底标题。
export function sanitizeCoverThemeSpec(input){
  const source=Array.isArray(input?.components)?input.components:Array.isArray(input)?input:[];
  const counts={},components=[],dropped=[];
  for(const [index,component] of source.entries()){
    const meta=COVER_COMPONENT_CATALOG[component?.type];
    if(meta&&(counts[component.type]||0)>=meta.max){dropped.push({field:`components[${index}].type`,message:`${meta.label}最多 ${meta.max} 个`});continue;}
    const {clean,issues}=validateThemeSpecComponent(component,index);
    if(!clean){dropped.push(...issues);continue;}
    counts[clean.type]=(counts[clean.type]||0)+1;
    components.push(clean);
  }
  if(!counts.canvas)components.unshift({type:'canvas',colorRole:'page'});
  if(!counts.title)components.push({type:'title',align:'left'});
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
      if(text)components.push({...component,text:text.slice(0,COVER_LIMITS.subtitleChars)});
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
