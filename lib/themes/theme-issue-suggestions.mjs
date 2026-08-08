// 主题门禁 issue 的修复建议生成。
// 目标：用户看到「哪个字段不合格」之外，还能直接知道「怎么改能通过」。
// 对比度类 issue 由门禁/校验器在 details 里携带 foreground/background/minimum，
// 这里算出当前比值和一组可通过的具体颜色；其余按 code 给出可操作指引。
import { colorContrast } from './theme-validator.mjs';
import { THEME_RECIPE_CATALOG } from './recipe-catalog.mjs';

const HEX=/^#[0-9a-f]{6}$/i;
const COLOR_ROLES=['text','muted','accent','accentSecondary','inverseText','background','surface'];

function get(root,path){return String(path||'').split('.').reduce((value,key)=>value?.[key],root);}

function mixHex(from,to,ratio){
  const parse=(value)=>[1,3,5].map((index)=>Number.parseInt(value.slice(index,index+2),16));
  const left=parse(from),right=parse(to);
  return `#${left.map((value,index)=>Math.round(value+(right[index]-value)*ratio).toString(16).padStart(2,'0')).join('').toUpperCase()}`;
}

// 把前景色向黑/白方向微调，直到对背景达到 minimum；返回 {color, ratio} 或 null
export function suggestContrastColor(foreground,background,minimum){
  if(!HEX.test(foreground||'')||!HEX.test(background||''))return null;
  const target=colorContrast(foreground,'#000000')>=colorContrast(foreground,'#FFFFFF')?'#000000':'#FFFFFF';
  for(let step=1;step<=100;step+=1){
    const candidate=mixHex(foreground,target,step/100);
    const ratio=colorContrast(candidate,background);
    if(ratio>=minimum)return {color:candidate,ratio:Math.round(ratio*100)/100};
  }
  return {color:target,ratio:Math.round(colorContrast(target,background)*100)/100};
}

const ENUM_HINTS={
  'tokens.typography.family':'可选 sans / serif / mono',
  'tokens.typography.headingFamily':'可选 sans / serif / mono',
  'tokens.shape.shadow':'可选 none / soft / hard / glow',
};

function enumSuggestion(field){
  if(ENUM_HINTS[field])return ENUM_HINTS[field];
  if(/colorRole$/i.test(field))return `可选颜色角色：${COLOR_ROLES.join(' / ')}`;
  const recipeMatch=field.match(/^(article|social)\.recipes\.(\w+)$/);
  if(recipeMatch){
    const allowed=THEME_RECIPE_CATALOG[recipeMatch[1]]?.[recipeMatch[2]];
    if(allowed)return `可选配方：${allowed.join(' / ')}`;
  }
  return '请选择白名单内的取值，不要自造名称';
}

// 为单条 issue 生成修复建议；无法给出时返回空串
export function suggestThemeIssueFix(item,definition){
  const {field='',code='',message=''}=item||{};
  const details=item.details||{};
  if(code==='LOW_CONTRAST'||code==='LOW_COMPONENT_CONTRAST'){
    const {foreground,background,minimum}=details;
    const current=HEX.test(foreground||'')&&HEX.test(background||'')?Math.round(colorContrast(foreground,background)*100)/100:null;
    const fix=suggestContrastColor(foreground,background,Number(minimum)||4.5);
    const role=/colorRole$/i.test(field)?'；也可以把颜色角色改为与底色对比更高的角色（如 inverseText 或 text）':'';
    if(fix)return `当前对比度 ${current??'不足'}:1（要求 ≥${minimum}:1）。建议把该颜色改为 ${fix.color}（可达 ${fix.ratio}:1）${role}`;
    return `当前对比度 ${current??'不足'}:1，要求 ≥${minimum}:1，请拉开前景与底色的明暗差${role}`;
  }
  if(code==='OUT_OF_RANGE'){
    const range=message.match(/必须是 ([\d.]+)–([\d.]+) /);
    const current=get(definition,field);
    if(range&&Number.isFinite(current)){
      const clamped=Math.min(Number(range[2]),Math.max(Number(range[1]),current));
      return `当前值 ${current}，可先调整为 ${clamped}（范围内），再按视觉效果微调`;
    }
    return '请把数值收进提示的允许范围';
  }
  if(code==='ENUM')return enumSuggestion(field);
  if(code==='REQUIRED')return '该字段不能为空，请补上取值（可参考内置主题同名字段）';
  if(code==='UNKNOWN_FIELD')return '该字段不在主题契约中，请删除它或检查是否拼错了字段名';
  if(code==='FORMAT'){
    if(/colors\./.test(field))return '颜色必须是六位十六进制（如 #1A2B3C），注意补满六位';
    if(field==='id')return 'ID 用小写字母、数字和连字符，如 my-dark-theme';
    if(field==='version')return '版本号用 x.y.z 形式，如 1.0.0';
    return '请按提示的格式要求调整';
  }
  if(code==='UNCONSUMED')return '该字段在正式渲染里不生效，请删除它；想调整的效果请改用编译器实际消费的字段';
  if(code==='TARGET_MISMATCH')return '该配置块与主题目标不一致，请移除或改到对应目标的配置里';
  return '';
}

// 批量为 issue 列表补充 suggestion 字段（不改原列表顺序，缺 definition 时仍可给通用建议）
export function enrichThemeIssues(issues=[],definition=null){
  return issues.map((item)=>{
    const suggestion=suggestThemeIssueFix(item,definition);
    return suggestion?{...item,suggestion}:item;
  });
}
