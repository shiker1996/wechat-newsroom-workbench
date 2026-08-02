import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadSkillBundle, selectSkillPromptReferences } from './skill-runtime.mjs';
import { evaluateCardGate, evaluateEventCardGate, evaluateCustomCardGate } from '../domain/social-card-gate.mjs';
import { customFactMarkdown } from '../domain/custom-fact-builder.mjs';
import { candidateSocialCardDir } from '../core/workspace-paths.mjs';
import { resolveEventAnalysis } from '../domain/event-fact-base.mjs';
import { bindGenerationSnapshot, prepareSkillRun } from '../skills/pipeline-runtime.mjs';
import { configuredRepairAttempts, evaluateConfiguredGates } from '../skills/configuration.mjs';
import { compileSocialTheme, socialThemeDefinition } from '../themes/social-theme-compiler.mjs';
import { resolveWorkspaceTheme } from '../themes/user-theme-service.mjs';

const execFileAsync = promisify(execFile);

export const SOCIAL_CARD_LAYOUTS = Object.freeze(['auto', 'poster', 'editorial', 'data', 'checklist', 'steps', 'minimal']);
export const SOCIAL_CARD_COMPOSITION_MODES = Object.freeze(['smart', 'template']);
export const SOCIAL_CARD_PAGE_ROLES = Object.freeze(['cover','concept','feature','steps','data','compare','evidence','timeline','risk','ending']);

const SMART_VARIANTS = Object.freeze({
  cover:[
    {id:'hero-stack',columns:'single',flow:'stack',alignment:'end',decoration:'orbit',overlap:'title-card'},
    {id:'hero-frame',columns:'single',flow:'stack',alignment:'center',decoration:'index-line',overlap:'accent-edge'},
  ],
  concept:[
    {id:'concept-split',columns:'split-wide',flow:'alternate',alignment:'center',decoration:'index-line',overlap:'none'},
    {id:'concept-offset',columns:'split-narrow',flow:'alternate',alignment:'start',decoration:'stamp',overlap:'accent-edge'},
  ],
  feature:[
    {id:'feature-ledger',columns:'split-even',flow:'alternate',alignment:'start',decoration:'index-line',overlap:'none'},
    {id:'feature-stack',columns:'single',flow:'stack',alignment:'start',decoration:'stamp',overlap:'accent-edge'},
  ],
  steps:[
    {id:'sequence-rail',columns:'single',flow:'stack',alignment:'start',decoration:'index-line',overlap:'none'},
    {id:'sequence-offset',columns:'split-narrow',flow:'alternate',alignment:'start',decoration:'orbit',overlap:'accent-edge'},
  ],
  data:[
    {id:'metric-board',columns:'single',flow:'stack',alignment:'start',decoration:'index-line',overlap:'none'},
    {id:'metric-split',columns:'split-even',flow:'alternate',alignment:'center',decoration:'orbit',overlap:'accent-edge'},
  ],
  compare:[
    {id:'comparison-board',columns:'single',flow:'stack',alignment:'start',decoration:'index-line',overlap:'none'},
    {id:'comparison-split',columns:'split-even',flow:'alternate',alignment:'center',decoration:'stamp',overlap:'none'},
  ],
  evidence:[
    {id:'evidence-ledger',columns:'split-wide',flow:'alternate',alignment:'start',decoration:'index-line',overlap:'none'},
    {id:'evidence-frame',columns:'split-narrow',flow:'alternate',alignment:'center',decoration:'stamp',overlap:'accent-edge'},
  ],
  timeline:[
    {id:'timeline-rail',columns:'single',flow:'stack',alignment:'start',decoration:'index-line',overlap:'none'},
    {id:'timeline-offset',columns:'split-narrow',flow:'alternate',alignment:'start',decoration:'orbit',overlap:'none'},
  ],
  risk:[
    {id:'risk-sidebar',columns:'split-narrow',flow:'alternate',alignment:'center',decoration:'stamp',overlap:'accent-edge'},
    {id:'risk-frame',columns:'single',flow:'stack',alignment:'start',decoration:'index-line',overlap:'none'},
  ],
  ending:[
    {id:'closing-focus',columns:'single',flow:'stack',alignment:'center',decoration:'orbit',overlap:'title-card'},
    {id:'closing-note',columns:'single',flow:'stack',alignment:'end',decoration:'stamp',overlap:'accent-edge'},
  ],
});
const SMART_ENUMS={
  columns:new Set(['single','split-wide','split-even','split-narrow']),
  flow:new Set(['stack','alternate']),
  alignment:new Set(['start','center','end']),
  decoration:new Set(['none','orbit','index-line','stamp']),
  overlap:new Set(['none','title-card','accent-edge']),
};

export function stableCardCompositionSeed(page={},pageIndex=0,seed='') {
  const value=`${seed}|${pageIndex}|${page.kind||''}|${page.title||''}|${(page.content_blocks||[]).map((block)=>block?.type||'').join(',')}`;
  let hash=2166136261;
  for(let index=0;index<value.length;index+=1){hash^=value.charCodeAt(index);hash=Math.imul(hash,16777619);}
  return hash>>>0;
}

export function inferCardPageRole(page={}) {
  if(page.kind==='cover')return 'cover';
  if(page.kind==='ending')return 'ending';
  const kind=String(page.kind||'').toLowerCase();
  const types=(Array.isArray(page.content_blocks)?page.content_blocks:[]).map((block)=>block?.type);
  if(types.includes('timeline')||/timeline|what-happened/.test(kind))return 'timeline';
  if(types.includes('steps')||/quickstart|step|howto|tutorial/.test(kind))return 'steps';
  if(types.includes('stats'))return 'data';
  if(types.includes('compare')||/positions/.test(kind))return 'compare';
  if(/evidence/.test(kind))return 'evidence';
  if(/risk|limitation|boundary/.test(kind))return 'risk';
  if(/capability|feature|scenario|item/.test(kind))return 'feature';
  return 'concept';
}

// 安全变体：优先取该角色本身的单列构图；两个变体都是分列的角色则把 variants[0] 降为单列堆叠
function safeCardComposition(role) {
  const variants=SMART_VARIANTS[role];
  const base=variants.find((variant)=>variant.columns==='single')||variants[0];
  const composition={...base,decoration:'none',overlap:'none'};
  if(composition.columns!=='single'){composition.columns='single';composition.flow='stack';}
  return composition;
}

// 内容块的体量估计：标题+正文字数；列表/步骤/数据卡等条目型块按条目文本累计并加固定视觉开销
// （序号圆点、卡片边框、行间距等占高但字数很少）；compare 表格的表头与每行也计入。
const CARD_ITEM_OVERHEAD=24;
function cardBlockVolume(block) {
  if(!block||typeof block!=='object')return 0;
  const text=(value)=>String(value||'').length;
  const itemText=(item)=>typeof item==='string'?text(item):text(item?.title)+text(item?.content)+text(item?.num)+text(item?.label)+text(item?.time);
  let volume=text(block.title);
  if(block.type==='list'){
    const values=listBlockValues(block);
    // items 缺失时列表文本来自 content，两者取较大值避免重复计数
    volume+=Math.max(text(block.content),values.reduce((sum,item)=>sum+itemText(item),0))+values.length*CARD_ITEM_OVERHEAD;
    return volume;
  }
  volume+=text(block.content);
  if(Array.isArray(block.items))volume+=block.items.reduce((sum,item)=>sum+itemText(item)+CARD_ITEM_OVERHEAD,0);
  if(block.type==='compare'){
    volume+=(Array.isArray(block.headers)?block.headers:[]).reduce((sum,cell)=>sum+text(cell),0);
    volume+=(Array.isArray(block.rows)?block.rows:[]).reduce((sum,row)=>sum+(Array.isArray(row)?row:[]).reduce((cellSum,cell)=>cellSum+text(cell),0)+CARD_ITEM_OVERHEAD,0);
  }
  return volume;
}

// 多个内容块但体量悬殊（最大块占比 ≥65%）时，分列会让两侧一高一低，不适合左右构图
function imbalancedCardBlocks(blocks) {
  if(blocks.length<2)return false;
  const volumes=blocks.map(cardBlockVolume);
  const total=volumes.reduce((sum,value)=>sum+value,0);
  return total>0&&Math.max(...volumes)/total>=0.65;
}

const AUXILIARY_CARD_BLOCK_TYPES=new Set(['note','highlight']);
function isAuxiliaryCardBlock(block) {
  return AUXILIARY_CARD_BLOCK_TYPES.has(block?.type)||block?.role==='auxiliary'||block?.importance==='secondary';
}

function peerGroupPrefersEven(blocks) {
  // 3 个块走等宽双列只能拆成两个半栏加一个跨栏块，构图破碎且容易和块内网格嵌套出四列观感，回归单列；
  // 2 个同级块、4 个及以上同类型且体量均衡的块才使用等宽双列
  if(blocks.length===3)return false;
  if(blocks.length!==2&&blocks.length<4)return false;
  const type=blocks[0]?.type,volumes=blocks.map(cardBlockVolume);
  if(!type||blocks.some((block)=>block?.type!==type))return false;
  return Math.max(...volumes)/Math.max(1,Math.min(...volumes))<=1.6;
}

function primaryAuxiliaryColumns(blocks) {
  if(blocks.length!==2)return null;
  const firstAuxiliary=isAuxiliaryCardBlock(blocks[0]),secondAuxiliary=isAuxiliaryCardBlock(blocks[1]);
  if(firstAuxiliary===secondAuxiliary)return null;
  return firstAuxiliary?'split-narrow':'split-wide';
}

function semanticCardColumns(page,blocks) {
  if(blocks.length<=1||cardPageDensity(page)==='compact')return 'single';
  if(peerGroupPrefersEven(blocks))return 'split-even';
  if(imbalancedCardBlocks(blocks))return 'single';
  return primaryAuxiliaryColumns(blocks)||'single';
}

export function normalizeCardComposition(page={}, {pageIndex=0,seed='',forceSafe=false,avoidIds=[]}={}) {
  const role=SOCIAL_CARD_PAGE_ROLES.includes(page.role)?page.role:inferCardPageRole(page);
  const variants=SMART_VARIANTS[role];
  let picked=variants[stableCardCompositionSeed(page,pageIndex,seed)%variants.length];
  // 同组卡片中同角色已用过的变体不再重复推荐，保证整组视觉多样（仅影响种子推荐路径）
  if(!forceSafe&&avoidIds.includes(picked.id)){
    const alternative=variants.find((variant)=>!avoidIds.includes(variant.id));
    if(alternative)picked=alternative;
  }
  const recommended=forceSafe?safeCardComposition(role):picked;
  const input=page.composition&&typeof page.composition==='object'?page.composition:{};
  const registered=variants.find((variant)=>variant.id===input.id);
  // id 命中注册变体时部分接受：合法字段保留，缺失或非法字段用注册值补齐，不再整体丢弃故事板构图
  const partial=!forceSafe&&Boolean(registered);
  const field=(key)=>partial&&SMART_ENUMS[key].has(input[key])?input[key]:registered?.[key];
  const invalidInputAdjusted=partial&&['columns','flow','alignment','decoration','overlap'].some((key)=>input[key]!=null&&!SMART_ENUMS[key].has(input[key]));
  const resolved=partial
    ? {id:registered.id,columns:field('columns'),flow:field('flow'),alignment:field('alignment'),decoration:field('decoration'),overlap:field('overlap')}
    : {...recommended};
  const blocks=Array.isArray(page.content_blocks)?page.content_blocks:[];
  const columns=forceSafe?'single':semanticCardColumns(page,blocks),flow=columns==='single'?'stack':'alternate';
  const composition={...resolved,columns,flow};
  const semanticAdjusted=partial&&(resolved.columns!==columns||resolved.flow!==flow),adjusted=invalidInputAdjusted||semanticAdjusted;
  return {role,composition,variantIndex:variants.findIndex((variant)=>variant.id===composition.id),variantCount:variants.length,source:forceSafe?'safe':partial?'storyboard':'recommended',fallback:!partial&&Boolean(page.composition),adjusted};
}

export function resolveCardCompositionDecision(page,{compositionMode='smart',layoutStyle='auto',channelMode='wechat',pageIndex=0,seed='',forceSafe=false,avoidIds=[]}={}) {
  if(compositionMode!=='smart'){
    const template=resolveCardLayoutDecision(page,layoutStyle,channelMode);
    return {...template,mode:'template',role:inferCardPageRole(page),composition:null};
  }
  const smart=normalizeCardComposition(page,{pageIndex,seed,forceSafe,avoidIds});
  return {mode:'smart',role:smart.role,composition:smart.composition,variantIndex:smart.variantIndex,variantCount:smart.variantCount,layout:recommendedCardLayout(page,channelMode),source:smart.fallback?'fallback':smart.source,adjusted:smart.adjusted,reason:forceSafe?'布局审计触发安全变体':smart.fallback?'故事板构图参数不合法，已按内容关系确定列宽':smart.adjusted?'故事板构图已按内容关系修正列宽或补齐非法字段':`按内容关系确定列宽，并为${smart.role}页面选择稳定视觉变体`};
}

function recommendedCardLayout(page, channelMode='wechat') {
  if (page?.kind === 'cover') return 'poster';
  if (page?.kind === 'ending') return 'minimal';
  const types = (Array.isArray(page?.content_blocks) ? page.content_blocks : []).map((block) => block?.type);
  const semanticKind = String(page?.kind || '').toLowerCase();
  const text = (Array.isArray(page?.content_blocks) ? page.content_blocks : [])
    .map((block) => `${block?.title || ''}\n${block?.content || ''}`).join('\n');
  if (types.some((type) => type === 'stats' || type === 'compare')) return 'data';
  if (
    types.some((type) => type === 'steps' || type === 'timeline')
    || /^(quickstart|step|steps|howto|tutorial|process|timeline)$/.test(semanticKind)
    || (text.match(/(?:^|\s)\d+(?:\.\s+|、\s*)/g) || []).length >= 2
  ) return 'steps';
  if (types.some((type) => type === 'list' || type === 'scenes')) return 'checklist';
  if (types.some((type) => type === 'highlight') || /^(highlight|conclusion|summary)$/.test(semanticKind)) return 'minimal';
  return 'editorial';
}

function numberedTextSteps(content='') {
  const text = String(content).trim();
  // 只识别行首编号；小数（27.8、3436.9）不是步骤标记。
  const starts = [...text.matchAll(/(?:^|\s)(\d+)(?:\.\s+|、\s*)/g)];
  if (starts.length < 2) return [];
  return starts.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < starts.length ? starts[index + 1].index : text.length;
    const value = text.slice(start, end).trim();
    const [first, ...rest] = value.split(/[：:]\s*/);
    return { title: rest.length ? first : `第 ${index + 1} 步`, content: rest.length ? rest.join('：').trim() : value };
  }).filter((item) => item.content);
}

function layoutFitsPage(layout, page) {
  const types = (Array.isArray(page?.content_blocks) ? page.content_blocks : []).map((block) => block?.type);
  if (layout === 'data') return types.some((type) => type === 'stats' || type === 'compare');
  if (layout === 'steps') return types.some((type) => type === 'steps' || type === 'timeline');
  if (layout === 'checklist') return types.some((type) => type === 'list' || type === 'scenes');
  return true;
}

export function resolveCardLayoutDecision(page, requested='auto', channelMode='wechat') {
  const pageChoice = SOCIAL_CARD_LAYOUTS.includes(page?.layout_style) ? page.layout_style : 'auto';
  const globalChoice = SOCIAL_CARD_LAYOUTS.includes(requested) ? requested : 'auto';
  const desired = pageChoice !== 'auto' ? pageChoice : globalChoice;
  const recommended = recommendedCardLayout(page, channelMode);
  if (desired === 'auto') return { layout:recommended, source:'recommended', reason:channelMode === 'xiaohongshu' ? '按小红书内容节奏推荐' : '按公众号信息密度推荐' };
  if (!layoutFitsPage(desired, page)) return { layout:recommended, source:'fallback', requested:desired, reason:`${desired} 与当前内容块不匹配，已安全降级` };
  return { layout:desired, source:pageChoice !== 'auto' ? 'manual' : 'group', reason:pageChoice !== 'auto' ? '逐页手动指定' : '整组版式指定' };
}

export function resolveCardLayout(page, requested='auto', channelMode='wechat') {
  return resolveCardLayoutDecision(page, requested, channelMode).layout;
}

// 同组卡片按角色收集已用变体 id，供后续同角色页面避开重复构图
function trackUsedComposition(usedByRole, role, compositionId) {
  if(!role||!compositionId)return;
  if(!usedByRole.has(role))usedByRole.set(role,[]);
  usedByRole.get(role).push(compositionId);
}

export function describeCardLayouts(pages, { layoutStyle='auto', channelMode='wechat', compositionMode='template', seed='' }={}) {
  const usedByRole=new Map();
  return (Array.isArray(pages) ? pages : []).map((page, index) => {
    const role=SOCIAL_CARD_PAGE_ROLES.includes(page?.role)?page.role:inferCardPageRole(page);
    const decision=resolveCardCompositionDecision(page,{compositionMode,layoutStyle,channelMode,pageIndex:index,seed,avoidIds:usedByRole.get(role)||[]});
    trackUsedComposition(usedByRole, decision.role, decision.composition?.id);
    return { page:index + 1, ...decision, density:cardPageDensity(page) };
  });
}

function listBlockValues(block) {
  if (Array.isArray(block?.items) && block.items.length) return block.items;
  const lines = String(block?.content || '').split(/\n+/).filter((item) => item.trim());
  return lines.length === 1 && (lines[0].match(/、/g) || []).length >= 2 ? lines[0].split('、') : lines;
}

export function cardPageDensity(page) {
  const blocks = Array.isArray(page?.content_blocks) ? page.content_blocks : [];
  const itemCount = blocks.reduce((total, block) => {
    if (block?.type === 'list') return total + listBlockValues(block).length;
    if (Array.isArray(block?.items) && block.items.length) return total + block.items.length;
    return total;
  }, 0);
  const textLength = blocks.reduce((total, block) => total + String(block?.content || '').length, 0);
  return itemCount > 8 || textLength > 520 ? 'compact' : 'normal';
}

// 故事板密度预算：审计修复循环禁止改动块结构，超高密度故事板无法自愈，
// 因此在规划阶段对 LLM 产出做确定性裁剪（只执行一次，裁剪内容写入执行记录）。
export const CARD_PLAN_BLOCK_BUDGET = Object.freeze({ cover:2, content:3, ending:2 });
export const CARD_PLAN_PAGE_ITEM_BUDGET = 9;

export function budgetCardPlan(cardPlan) {
  const trims = [];
  const pages = (Array.isArray(cardPlan) ? cardPlan : []).map((page, pageIndex) => {
    const prefix = `P${pageIndex + 1}`;
    const kind = page?.kind === 'cover' ? 'cover' : page?.kind === 'ending' ? 'ending' : 'content';
    const cap = CARD_PLAN_BLOCK_BUDGET[kind];
    let blocks = Array.isArray(page?.content_blocks) ? [...page.content_blocks] : [];
    if (blocks.length > cap) {
      // 优先从尾部删辅助块（note/highlight），再删尾部普通块，始终保留至少 1 个
      const drop = new Set();
      for (let index = blocks.length - 1; index >= 0 && blocks.length - drop.size > cap; index -= 1) {
        if (blocks.length - drop.size <= 1) break;
        if (isAuxiliaryCardBlock(blocks[index])) drop.add(index);
      }
      for (let index = blocks.length - 1; index >= 0 && blocks.length - drop.size > cap; index -= 1) {
        if (blocks.length - drop.size <= 1) break;
        if (!drop.has(index)) drop.add(index);
      }
      const removed = blocks.filter((_, index) => drop.has(index));
      blocks = blocks.filter((_, index) => !drop.has(index));
      trims.push(`${prefix} 超出${kind === 'cover' ? '封面' : kind === 'ending' ? '结尾页' : '内容页'}块数上限 ${cap}，移除 ${removed.length} 个内容块（${removed.map((block) => block?.title || block?.type || '未命名').join('、')}）`);
    }
    // 单页列表条目合计不超过预算，超出从尾部列表块截断
    let itemCount = blocks.reduce((total, block) => total + (block?.type === 'list' ? listBlockValues(block).length : 0), 0);
    if (itemCount > CARD_PLAN_PAGE_ITEM_BUDGET) {
      const next = [...blocks];
      for (let index = next.length - 1; index >= 0 && itemCount > CARD_PLAN_PAGE_ITEM_BUDGET; index -= 1) {
        const block = next[index];
        if (block?.type !== 'list') continue;
        const values = listBlockValues(block);
        const keep = Math.max(2, values.length - (itemCount - CARD_PLAN_PAGE_ITEM_BUDGET));
        if (keep >= values.length) continue;
        itemCount -= values.length - keep;
        next[index] = Array.isArray(block.items) && block.items.length
          ? { ...block, items: block.items.slice(0, keep) }
          : { ...block, content: values.slice(0, keep).join('\n') };
        trims.push(`${prefix} 列表条目超出单页上限 ${CARD_PLAN_PAGE_ITEM_BUDGET}，截断「${block?.title || '列表'}」${values.length - keep} 条`);
      }
      blocks = next;
    }
    return { ...page, content_blocks: blocks };
  });
  return { pages, trims };
}

const EXPANSION_BLOCKING_ISSUES=new Set([
  'overflow','clipped','horizontal_overflow','overfilled','text_too_small',
  'invalid_page_grid_structure','missing_content_stack','empty_page_body',
]);

export function underfilledPageIndexes(report,excluded=new Set()) {
  return (Array.isArray(report?.pages)?report.pages:[])
    .filter((page)=>{
      const issues=Array.isArray(page?.issues)?page.issues:[];
      const index=Number(page?.page)-1;
      return index>=0&&!excluded.has(index)&&issues.includes('underfilled')&&!issues.some((issue)=>EXPANSION_BLOCKING_ISSUES.has(issue));
    })
    .map((page)=>Number(page.page)-1);
}

export function underfilledDensityTier(page) {
  const issues=Array.isArray(page?.issues)?page.issues:[];
  if(page?.kind!=='content'||!issues.includes('underfilled')||issues.some((issue)=>EXPANSION_BLOCKING_ISSUES.has(issue)))return null;
  return Number(page?.utilization)>=48?'relaxed':'expanded';
}

// AI 语义断行结果校验：行数 1–4、拼接后与原标题一致（忽略空白）、每行视觉宽度 ≤9 字宽
// （CJK 计 1，拉丁字符/数字/空白计 0.55），不满足则回退代码断行
export function normalizeCoverTitleLines(title,lines) {
  if(!Array.isArray(lines)||!lines.length||lines.length>4)return null;
  const cleaned=lines.map((line)=>String(line??'').trim()).filter(Boolean);
  if(!cleaned.length||cleaned.length!==lines.length)return null;
  const strip=(text)=>String(text||'').replace(/\s+/g,'');
  if(strip(cleaned.join(''))!==strip(title))return null;
  const visualWidth=(text)=>Array.from(text).reduce((width,char)=>width+(/[^\x00-\xff]/.test(char)?1:0.55),0);
  if(cleaned.some((line)=>visualWidth(line)>9))return null;
  return cleaned;
}

const LAYOUT_ISSUE_LABELS=Object.freeze({
  underfilled:'内容不足',overfilled:'内容过多',overflow:'内容溢出',clipped:'内容被裁切',
  horizontal_overflow:'横向溢出',vertical_imbalance:'垂直失衡',text_too_small:'文字过小',
  invalid_page_grid_structure:'页面结构异常',missing_content_stack:'页面结构异常',empty_page_body:'页面无内容',
});

// 审计轮次穷尽后的失败信息：带逐页明细和故事板编辑指引，让用户知道下一步怎么人工处理
export function layoutAuditFailureMessage(report,maxLayoutAttempts) {
  const failed=(Array.isArray(report?.pages)?report.pages:[]).filter((page)=>!page.valid);
  const details=failed.map((page)=>{
    const labels=(Array.isArray(page?.issues)?page.issues:[]).map((issue)=>LAYOUT_ISSUE_LABELS[issue]||issue).join('、');
    const utilization=Number.isFinite(Number(page?.utilization))?`（版面利用率 ${page.utilization}%）`:'';
    return `P${page.page} ${labels}${utilization}`;
  }).join('；');
  const hasIssue=(names)=>failed.some((page)=>(Array.isArray(page?.issues)?page.issues:[]).some((issue)=>names.includes(issue)));
  const advice=[];
  if(hasIssue(['underfilled']))advice.push('内容不足的页：补充内容块、增加列表条目或扩写段落');
  if(hasIssue(['overfilled','overflow','clipped','horizontal_overflow']))advice.push('内容放不下的页：删减、拆分或缩短文字');
  if(!advice.length)advice.push('调整问题页的内容或构图');
  return `布局审计 ${maxLayoutAttempts} 轮后仍未通过：${details}。自动修复（构图回退、舒展排版、AI 改写）已穷尽，请打开该候选的图文编辑器，在「02 卡片故事板」中修改对应页面后重新「生成整组图文」——${advice.join('；')}。`;
}

export const SOCIAL_CARD_STAGE_CONTRACT = Object.freeze([
  { id:'facts', skill:'fixed-program' },
  { id:'planning', skill:'storyboard-selection' },
  { id:'generation', skill:'xiaohongshu-article-generator' },
  { id:'layout-audit', skill:'xiaohongshu-article-generator' },
  { id:'screenshots', skill:'html-pages-to-images' },
  { id:'delivery-gate', skill:'fixed-program' },
]);

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive:true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, String(content).trimEnd() + '\n', 'utf8');
  fs.renameSync(temp, filePath);
  return fs.statSync(filePath);
}

function cleanCardPlanJson(value) {
  const raw = String(value || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let json = fenced ? fenced[1].trim() : raw;
  const start = Math.min(
    json.includes('{') ? json.indexOf('{') : Infinity,
    json.includes('[') ? json.indexOf('[') : Infinity,
  );
  const end = Math.max(json.lastIndexOf('}'), json.lastIndexOf(']'));
  if (!Number.isFinite(start) || end < 0) throw new Error('布局修复未返回可解析的 card_plan JSON');
  return JSON.parse(json.slice(start, end + 1));
}

function escapeHtml(value='') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}

function sanitizeCardPlan(cardPlan) {
  const instructionPatterns = [
    /^让读者(?:一眼)?知道/,
    /^让读者/,
    /^读者(?:能|会|可以|理解|了解|知道)/,
    /^本页(?:旨在|希望|要|应该|目的(?:是|为))?/,
    /^这一页(?:旨在|希望|要|应该|目的(?:是|为))?/,
    /^本卡(?:旨在|希望|要|应该|目的(?:是|为))?/,
    /^本章节(?:旨在|希望|要|应该|目的(?:是|为))?/,
    /^请/,
  ];
  function clean(text) {
    if (typeof text !== 'string') return text;
    let s = text.trim();
    for (const re of instructionPatterns) s = s.replace(re, '').trim();
    return s.replace(/^[，。；、:：\s]+/, '').trim();
  }
  return (Array.isArray(cardPlan) ? cardPlan : []).map((page,pageIndex) => {
    const smart=normalizeCardComposition(page,{pageIndex});
    return ({
    ...page,
    role:smart.role,
    composition:smart.composition,
    title: clean(page.title),
    goal: clean(page.goal),
    evidence: (Array.isArray(page.evidence) ? page.evidence : []).map(clean),
    content_blocks: (Array.isArray(page.content_blocks) ? page.content_blocks : []).map((block) => ({
      ...block,
      title: clean(block.title),
      content: clean(block.content),
      items: (Array.isArray(block.items) ? block.items : []).map((item) => typeof item === 'string' ? clean(item) : Object.fromEntries(Object.entries(item || {}).map(([key, value]) => [key, typeof value === 'string' ? clean(value) : value]))),
      headers: (Array.isArray(block.headers) ? block.headers : []).map(clean),
      rows: (Array.isArray(block.rows) ? block.rows : []).map((row) => (Array.isArray(row) ? row : []).map(clean)),
    })),
  })});
}

export function cardPlanRepairStructureIssues(previousPlan,nextPlan) {
  const issues=[];
  if(!Array.isArray(nextPlan)||nextPlan.length!==previousPlan.length)return [`页面数量必须保持为 ${previousPlan.length}`];
  const arrayLength=(value)=>Array.isArray(value)?value.length:0,lineCount=(value)=>String(value||'').split(/\n+/).filter((line)=>line.trim()).length;
  for(let pageIndex=0;pageIndex<previousPlan.length;pageIndex+=1){
    const previous=previousPlan[pageIndex]||{},next=nextPlan[pageIndex]||{},prefix=`P${pageIndex+1}`;
    if(next.kind!==previous.kind)issues.push(`${prefix} 页面类型不能修改`);
    if(next.title!==previous.title)issues.push(`${prefix} 页面标题不能修改`);
    if(next.goal!==previous.goal)issues.push(`${prefix} 页面目标不能修改`);
    if(JSON.stringify(next.evidence||[])!==JSON.stringify(previous.evidence||[]))issues.push(`${prefix} 证据引用不能修改`);
    const previousBlocks=Array.isArray(previous.content_blocks)?previous.content_blocks:[],nextBlocks=Array.isArray(next.content_blocks)?next.content_blocks:[];
    if(nextBlocks.length!==previousBlocks.length){issues.push(`${prefix} 内容块数量必须保持为 ${previousBlocks.length}`);continue;}
    for(let blockIndex=0;blockIndex<previousBlocks.length;blockIndex+=1){
      const before=previousBlocks[blockIndex]||{},after=nextBlocks[blockIndex]||{},blockPrefix=`${prefix}B${blockIndex+1}`;
      if(after.type!==before.type)issues.push(`${blockPrefix} 类型不能修改`);
      if(after.title!==before.title)issues.push(`${blockPrefix} 标题不能修改`);
      for(const key of ['items','headers','rows'])if(arrayLength(after[key])!==arrayLength(before[key]))issues.push(`${blockPrefix} ${key} 条目数量不能修改`);
      if(before.type==='list'&&!arrayLength(before.items)&&lineCount(after.content)!==lineCount(before.content))issues.push(`${blockPrefix} 列表条目数量不能修改`);
      if(before.type==='code'&&after.content!==before.content)issues.push(`${blockPrefix} 代码内容不能修改`);
      if(arrayLength(before.rows)&&before.rows.some((row,index)=>arrayLength(after.rows?.[index])!==arrayLength(row)))issues.push(`${blockPrefix} rows 列数不能修改`);
    }
  }
  return issues;
}

export function renderStoryboardHtml({ topic, repository, pages, visualStyle='ice-blue', themeDefinition:providedTheme=null, layoutStyle='auto', compositionMode='template', compositionSeed='', forceSafeComposition=false, relaxedDensityPages=false, expandedDensityPages=false, contentType='repository', sourceLabel='', disclosure='', channelMode='wechat', coverTitleLines=null }) {
  const themeDefinition=providedTheme||socialThemeDefinition(visualStyle,{fallback:false});
  if(!themeDefinition)throw new Error(`未知图文视觉主题：${visualStyle}`);
  const compiledTheme=compileSocialTheme(themeDefinition);
  const coverTitleMarkup=(title)=>{const value=String(title||topic);if(compiledTheme.recipes.coverTitle!=='highlight-block')return escapeHtml(value);let lines=normalizeCoverTitleLines(value,coverTitleLines);if(!lines){const chars=Array.from(value),lineCount=Math.max(1,Math.ceil(chars.length/8)),size=Math.max(4,Math.ceil(chars.length/lineCount));lines=[];for(let index=0;index<chars.length;index+=size)lines.push(chars.slice(index,index+size).join(''));}return lines.map((line)=>`<span class="cover-title-line">${escapeHtml(line)}</span>`).join('');};
  const skeleton=compiledTheme.recipes.skeleton||'stacked',coverSupport=compiledTheme.recipes.coverSupport||'none';
  const coverSupportText=(page)=>String(page.lead||page.summary||(Array.isArray(page.evidence)?page.evidence[0]:'')||'').trim();
  const coverSupportMarkup=(page)=>{if(page.kind!=='cover'||coverSupport==='none')return '';if(Array.isArray(page.content_blocks)&&page.content_blocks.length)return '';let text=coverSupportText(page);if(!text)return '';if(text.length>60)text=`${text.slice(0,59)}…`;if(coverSupport==='metric')return `<div class="cover-support cover-support-metric"><b>01</b><span>${escapeHtml(text)}</span></div>`;if(coverSupport==='statement')return `<aside class="cover-support cover-support-statement"><small>CORE TAKEAWAY</small><p>${escapeHtml(text)}</p></aside>`;return `<p class="cover-support cover-support-lead">${escapeHtml(text)}</p>`;};
  const theme=compiledTheme.id,themeClass=compiledTheme.className;
  // forceSafeComposition 支持 true（全部页安全回退）或页码索引数组/Set（仅审计失败的页回退）
  const isForceSafePage=(index)=>forceSafeComposition===true
    ||(Array.isArray(forceSafeComposition)&&forceSafeComposition.includes(index))
    ||(forceSafeComposition instanceof Set&&forceSafeComposition.has(index));
  const isExpandedDensityPage=(index)=>expandedDensityPages===true
    ||(Array.isArray(expandedDensityPages)&&expandedDensityPages.includes(index))
    ||(expandedDensityPages instanceof Set&&expandedDensityPages.has(index));
  const isRelaxedDensityPage=(index)=>relaxedDensityPages===true
    ||(Array.isArray(relaxedDensityPages)&&relaxedDensityPages.includes(index))
    ||(relaxedDensityPages instanceof Set&&relaxedDensityPages.has(index));
  const safePages = Array.isArray(pages) ? pages : [];
  const usedCompositionByRole=new Map();
  const sections = safePages.map((page, index) => {
    const pageKind = page.kind === 'cover' ? 'cover' : page.kind === 'ending' ? 'ending' : 'content';
    const pageRole=SOCIAL_CARD_PAGE_ROLES.includes(page?.role)?page.role:inferCardPageRole(page);
    const compositionDecision = resolveCardCompositionDecision(page, { compositionMode, layoutStyle, channelMode, pageIndex:index, seed:compositionSeed||topic, forceSafe:isForceSafePage(index), avoidIds:usedCompositionByRole.get(pageRole)||[] });
    trackUsedComposition(usedCompositionByRole, compositionDecision.role, compositionDecision.composition?.id);
    const layoutDecision = compositionDecision.mode === 'template' ? compositionDecision : resolveCardLayoutDecision(page, 'auto', channelMode);
    const pageLayout = layoutDecision.layout;
    const layoutClass = compositionDecision.mode === 'smart' ? 'layout-smart' : `layout-${pageLayout}`;
    const composition = compositionDecision.composition;
    const pageBlocks=Array.isArray(page.content_blocks)?page.content_blocks:[];
    const triSpanClass=compositionDecision.mode==='smart'&&pageBlocks.length===3&&composition.columns!=='single'&&composition.flow==='alternate'
      ? ' tri-span-last'
      : '';
    const compositionClasses = compositionDecision.mode === 'smart'
      ? `composition-smart role-${compositionDecision.role} comp-${composition.id} comp-cols-${composition.columns} comp-flow-${composition.flow} comp-align-${composition.alignment} decor-${composition.decoration} overlap-${composition.overlap}${triSpanClass}`
      : 'composition-template';
    const pageDensity = cardPageDensity(page);
    const blockCount = pageBlocks.length;
    const listItemCount = (Array.isArray(page.content_blocks) ? page.content_blocks : []).reduce((total, block) => {
      if (block?.type !== 'list') return total;
      return total + listBlockValues(block).length;
    }, 0);
    const itemCountClass = `items-${Math.min(9, listItemCount)}`;
    const evidence = (Array.isArray(page.evidence) ? page.evidence : []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    const blocks = (Array.isArray(page.content_blocks) ? page.content_blocks : []).map((block) => {
      const title=block.title?`<h2>${escapeHtml(block.title)}</h2>`:''; const content=String(block.content||'').trim();
      const items=Array.isArray(block.items)?block.items:[];
      const inferredSteps=pageLayout==='steps'&&compositionDecision.role==='steps'&&block.type==='text'?numberedTextSteps(content):[];
      if(inferredSteps.length)return `<div class="content-block steps-block">${title}<div class="step-col">${inferredSteps.map((item,index)=>`<div class="step"><b>${index+1}</b><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.content)}</p></div></div>`).join('')}</div></div>`;
      if(block.type==='code')return `<div class="content-block code-block">${title}<pre><code>${escapeHtml(content)}</code></pre></div>`;
      if(block.type==='list'){const cleanListItem=(item)=>String(item).replace(/^[-*+•·✓✔✅☑]\uFE0F?\s*/u,'').trim();const lines=listBlockValues(block).map((item)=>cleanListItem(typeof item==='string'?item:[item?.title,item?.content].filter(Boolean).join('：')));return `<div class="content-block list-block">${title}<ul>${lines.filter(Boolean).map((item)=>`<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`;}
      if(block.type==='note')return `<aside class="content-block note-block">${title}<p>${escapeHtml(content)}</p></aside>`;
      if(block.type==='stats'&&items.length)return `<div class="content-block stats-block">${title}<div class="stat-row">${items.map((item)=>`<div class="stat"><b>${escapeHtml(item.num||'')}</b><span data-text-role="auxiliary">${escapeHtml(item.label||'')}</span></div>`).join('')}</div></div>`;
      if(block.type==='compare'&&(Array.isArray(block.headers)&&block.headers.length||Array.isArray(block.rows)&&block.rows.length)){const headers=Array.isArray(block.headers)?block.headers:[];const rows=Array.isArray(block.rows)?block.rows:[];return `<div class="content-block compare-block">${title}<table><thead><tr>${headers.map((cell)=>`<th data-text-role="auxiliary">${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row)=>`<tr>${(Array.isArray(row)?row:[]).map((cell)=>`<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
      if(block.type==='steps'&&items.length)return `<div class="content-block steps-block">${title}<div class="step-col">${items.map((item,index)=>`<div class="step"><b>${index+1}</b><div><h3>${escapeHtml(item.title||'')}</h3><p>${escapeHtml(item.content||'')}</p></div></div>`).join('')}</div></div>`;
      if(block.type==='timeline'&&items.length)return `<div class="content-block timeline-block">${title}<div class="tl">${items.map((item)=>`<div class="tl-node"><span class="tl-time" data-text-role="auxiliary">${escapeHtml(item.time||'')}</span><h3>${escapeHtml(item.title||'')}</h3><p>${escapeHtml(item.content||'')}</p></div>`).join('')}</div></div>`;
      if(block.type==='scenes'&&items.length)return `<div class="content-block scenes-block">${title}<div class="scene-row">${items.map((item)=>`<div class="scene"><h3>${escapeHtml(item.title||'')}</h3><p>${escapeHtml(item.content||'')}</p></div>`).join('')}</div></div>`;
      if(block.type==='highlight')return `<div class="content-block highlight-block">${title}<p>${escapeHtml(content)}</p></div>`;
      // 新版式块缺少 items/rows 时退化为列表或文本块，避免渲染出空版式
      if((block.type==='steps'||block.type==='timeline')&&content)return `<div class="content-block list-block">${title}<ul>${content.split(/\n+/).map((item)=>item.replace(/^[-*+]\s*/, '').trim()).filter(Boolean).map((item)=>`<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`;
      return `<div class="content-block text-block">${title}<p>${escapeHtml(content)}</p></div>`;
    }).join('');
    const toolLabels={cover:'TOOL RADAR',problem:'WHY IT MATTERS',capability:'CORE FEATURES',quickstart:'QUICK START',scenario:'USE CASES',limitation:'BEFORE YOU USE',ending:'SAVE FOR LATER'};
    const eventLabels={cover:'BREAKING FOCUS','what-happened':'WHAT HAPPENED',timeline:'TIMELINE',evidence:'EVIDENCE CHECK',positions:'WHO SAID WHAT',impact:'WHY IT MATTERS',risk:'FACT BOUNDARY',ending:'KEEP WATCHING'};
    const customLabels={cover:'NEW NOTE',highlight:'KEY POINTS',step:'HOW TO',item:'THE LIST',boundary:'FACT BOUNDARY',ending:'SAVE FOR LATER'};
    const pageLabels=contentType==='event'?eventLabels:contentType==='custom'?customLabels:toolLabels;
    const label = pageLabels[page.kind] || (contentType==='event'?'EVENT CARD':contentType==='custom'?'CUSTOM CARD':'TOOL CARD');
    const brand=contentType==='event'?(channelMode==='xiaohongshu'?`小红书 · ${sourceLabel||topic}`:`EVENT DESK / ${sourceLabel||topic}`):contentType==='custom'?(channelMode==='xiaohongshu'?`小红书 · ${sourceLabel||topic}`:`CUSTOM / ${sourceLabel||topic}`):(channelMode==='xiaohongshu'?`小红书 · ${repository||topic}`:`OPEN SOURCE / ${repository||topic}`);
    const footer=disclosure||(contentType==='event'?'据公开素材整理 · 未核实内容已标注':contentType==='custom'?'内容整理自作者素材 · 建议性内容未实测':'基于项目文档整理 · 未实际运行');
    // goal 是本页的生成目标（供文案与布局阶段理解意图），不作为展示文本渲染到卡片上
    const densityAdjustment=isExpandedDensityPage(index)?'expanded':isRelaxedDensityPage(index)?'relaxed':'none';
    const densityAdjustmentClass=densityAdjustment==='none'?'':` density-${densityAdjustment}`;
    const skeletonClass=skeleton==='stacked'?'':` skeleton-${skeleton}`;
    return `<section class="page page-${pageKind}${skeletonClass} ${layoutClass} density-${pageDensity}${densityAdjustmentClass} blocks-${blockCount} ${itemCountClass} ${compositionClasses}" data-page-kind="${pageKind}" data-page-role="${compositionDecision.role}" data-composition-mode="${compositionDecision.mode}" data-composition-id="${composition?.id||''}" data-layout="${pageLayout}" data-layout-source="${compositionDecision.source}" data-density="${pageDensity}" data-density-adjustment="${densityAdjustment}" data-block-count="${blockCount}" data-list-item-count="${listItemCount}" data-page-number="${index + 1}"><div class="page-inner"><header class="page-header"><span class="brand">${escapeHtml(brand)}</span><span class="page-number">${String(index + 1).padStart(2, '0')}</span></header><main class="page-body" data-valign="center"><div class="page-content-stack" data-card-index="${String(index + 1).padStart(2, '0')}"><span class="eyebrow">${label}</span><h1>${pageKind==='cover'?coverTitleMarkup(page.title||topic):escapeHtml(page.title||topic)}</h1>${coverSupportMarkup(page)}${blocks || (evidence ? `<ul>${evidence}</ul>` : '')}</div></main><footer class="page-footer"><span>${escapeHtml(footer)}</span><i></i></footer></div></section>`;
  }).join('\n');
  const baseHtml=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(topic)} · ${contentType==='event'?'事件图文':contentType==='custom'?'自定义图文':'工具卡'}</title><style>
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:"Noto Sans SC","Microsoft YaHei",sans-serif}.page{width:375px;height:667px;overflow:hidden;background:var(--page);color:var(--ink);position:relative}.page:after{content:"";position:absolute;width:190px;height:190px;border:1px solid var(--line);border-radius:var(--radius);right:-88px;top:-70px;opacity:var(--decoration-opacity)}.page-inner{height:100%;padding:27px 25px 23px;display:grid;grid-template-rows:auto 1fr auto}.page-header,.page-footer{display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1}.brand{max-width:270px;font-size:11px;font-weight:750;letter-spacing:.12em;color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.brand[data-text-role="auxiliary"]{font-size:9px}.page-number{font:700 11px ui-monospace,Consolas,monospace;color:var(--accent)}.page-body{min-height:0;display:flex;align-items:center}.page-content-stack{width:100%;min-height:76%;padding:24px 21px;border:var(--border-width) solid var(--line);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow);display:flex;flex-direction:column;justify-content:center;gap:12px;position:relative;z-index:1}.eyebrow{font-size:10px;font-weight:800;letter-spacing:.16em;color:var(--accent2)}.page h1{font-size:27px;line-height:1.18;letter-spacing:-.035em;margin:0;overflow-wrap:anywhere}.page-cover h1{font-size:34px}.cover-support{margin:0;overflow-wrap:anywhere}.cover-support-lead{font-size:13px;line-height:1.5;color:var(--muted);max-width:92%}.cover-support-statement{padding:10px 12px;border-left:3px solid var(--accent2);background:color-mix(in srgb,var(--accent2) 12%,var(--surface))}.cover-support-statement small{display:block;font:800 9px/1.2 ui-monospace,Consolas,monospace;letter-spacing:.12em;color:var(--accent2)}.cover-support-statement p{margin:4px 0 0;font-size:11px;line-height:1.45}.cover-support-metric{display:flex;align-items:baseline;gap:9px;padding-top:8px;border-top:1px solid var(--line);color:var(--muted)}.cover-support-metric b{font-size:26px;line-height:1;color:var(--accent)}.cover-support-metric span{font-size:11px;line-height:1.4}.lead{font-size:13px;line-height:1.55;color:var(--muted);margin:0}.content-block{display:grid;gap:5px;min-width:0}.content-block h2{font-size:12px;line-height:1.35;margin:0;color:var(--accent);overflow-wrap:anywhere}.content-block p{font-size:11px;line-height:1.55;margin:0;overflow-wrap:anywhere}.text-block p{white-space:pre-line}.page ul{list-style:none;padding:0;margin:0;display:grid;gap:7px}.page li{font-size:11px;line-height:1.45;padding:7px 9px 7px 24px;border-radius:calc(var(--radius)/2);background:color-mix(in srgb,var(--accent) 12%,var(--surface));position:relative;overflow-wrap:anywhere}.page li:before{content:"";position:absolute;left:9px;top:12px;width:6px;height:6px;border-radius:50%;background:var(--accent2)}.code-block pre{margin:0;padding:10px;border-radius:calc(var(--radius)/2);background:var(--code);color:var(--inverse);white-space:pre-wrap;overflow-wrap:anywhere}.code-block code{font:10px/1.45 ui-monospace,Consolas,monospace}.note-block{padding:9px 11px;border-left:3px solid var(--accent);background:var(--surface);border-radius:0 calc(var(--radius)/2) calc(var(--radius)/2) 0}.page-footer{font-size:9px;color:var(--muted);letter-spacing:.04em}.page-footer i{width:38px;height:2px;background:var(--accent2);border-radius:2px}.page-ending .page-content-stack{background:var(--accent);color:var(--inverse)}.page-ending .lead,.page-ending li,.page-ending .content-block h2{color:var(--inverse)}.page-ending li{background:rgba(0,0,0,.1)}.page-ending .note-block,.page-ending .highlight-block,.page-ending .scene,.page-ending .stat,.page-ending .compare-block td{color:var(--ink)}.page-ending .note-block h2,.page-ending .note-block p,.page-ending .highlight-block h2,.page-ending .highlight-block p,.page-ending .scene h3,.page-ending .scene p,.page-ending .stat b,.page-ending .stat span{color:inherit}
.stat-row{display:flex;gap:8px}.stat{flex:1;min-width:0;padding:10px 8px;border:1px solid var(--line);border-radius:12px;background:var(--surface);text-align:center}.stat b{display:block;font-size:19px;line-height:1.2;color:var(--accent);overflow-wrap:anywhere}.stat span{font-size:9px;color:var(--muted)}
.compare-block table{width:100%;border-collapse:collapse}.compare-block th{background:var(--accent);color:var(--inverse);padding:6px 8px;text-align:left;font-size:9px;font-weight:700}.compare-block td{padding:6px 8px;border-bottom:1px solid var(--line);font-size:11px;line-height:1.45;color:var(--ink);overflow-wrap:anywhere}
.step-col{display:grid;gap:8px}.step{display:flex;gap:9px;align-items:flex-start}.step>b{flex:0 0 22px;height:22px;border-radius:50%;background:var(--accent);color:var(--inverse);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}.step h3{font-size:11px;margin:0;color:var(--ink);overflow-wrap:anywhere}.step p{font-size:11px;line-height:1.45;margin:2px 0 0;color:var(--muted);overflow-wrap:anywhere}
.tl{display:grid}.tl-node{position:relative;margin-left:5px;padding:0 0 9px 12px;border-left:2px solid var(--accent2)}.tl-node:last-child{padding-bottom:0}.tl-node:before{content:"";position:absolute;left:-5px;top:3px;width:8px;height:8px;border-radius:50%;background:var(--accent2)}.tl-time{font-size:9px;font-weight:800;color:var(--accent2)}.tl-node h3{font-size:11px;margin:1px 0;color:var(--ink)}.tl-node p{font-size:11px;line-height:1.45;margin:0;color:var(--muted)}
.scene-row{display:flex;gap:8px}.scene{flex:1;min-width:0;padding:9px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}.scene h3{font-size:11px;margin:0 0 3px;color:var(--accent)}.scene p{font-size:11px;line-height:1.45;margin:0;color:var(--muted)}
.highlight-block{padding:12px 14px;border-left:4px solid var(--accent2);border-radius:0 12px 12px 0;background:var(--surface)}.highlight-block h2{font-size:13px}.highlight-block p{font-size:11px}
.layout-poster .page-content-stack{min-height:88%;justify-content:flex-end;padding:30px 24px}.layout-poster .eyebrow{order:-2}.layout-poster h1{font-size:38px;line-height:1.08;max-width:92%;margin-bottom:auto;padding-top:12px}.layout-poster .content-block{border-left-width:5px}.layout-poster.page-cover:before{content:"";position:absolute;inset:82px 22px 92px;border:1px solid var(--accent);opacity:.18;transform:rotate(-2deg)}
.layout-editorial .page-content-stack{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,.92fr);align-content:center;gap:12px 14px}.layout-editorial .eyebrow,.layout-editorial h1{grid-column:1/-1}.layout-editorial h1{font-family:Georgia,"Noto Serif SC","Songti SC",serif;font-size:30px;border-bottom:1px solid var(--line,rgba(27,109,152,.2));padding-bottom:12px}.layout-editorial .content-block:nth-child(odd){grid-column:1}.layout-editorial .content-block:nth-child(even){grid-column:2}
.layout-editorial.blocks-1 .page-content-stack{grid-template-columns:minmax(0,.92fr) minmax(0,1.08fr);grid-template-rows:auto auto;align-content:center;align-items:center}.layout-editorial.blocks-1 .eyebrow{grid-column:1/-1;grid-row:1}.layout-editorial.blocks-1 h1{grid-column:1;grid-row:2;border-bottom:0;padding:0;font-size:29px}.layout-editorial.blocks-1 .content-block{grid-column:2!important;grid-row:2;align-self:center;padding-left:13px;border-left:1px solid var(--line,rgba(27,109,152,.24))}
.layout-data .page-content-stack{justify-content:flex-start}.layout-data h1{font-size:25px}.layout-data .content-block:has(.stat-row),.layout-data .compare-block{padding:12px;border:1px solid var(--line);background:color-mix(in srgb,var(--surface) 88%,var(--accent))}.layout-data .stat-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.layout-data .stat{text-align:left}.layout-data .stat b{font-size:25px}
.layout-checklist .page-content-stack{justify-content:flex-start}.layout-checklist h1{font-size:29px}.layout-checklist .list-block ul{counter-reset:item;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.layout-checklist .page li{min-height:62px;padding:12px 10px 10px 34px;display:flex;align-items:center}.layout-checklist .page li:before{counter-increment:item;content:counter(item);width:18px;height:18px;left:9px;top:50%;transform:translateY(-50%);display:grid;place-items:center;color:var(--inverse);font-size:9px;font-weight:800}
.layout-checklist.items-0 .list-block ul,.layout-checklist.items-1 .list-block ul,.layout-checklist.items-2 .list-block ul,.layout-checklist.items-3 .list-block ul,.layout-checklist.items-4 .list-block ul,.layout-checklist.items-5 .list-block ul{grid-template-columns:1fr}.layout-checklist.items-0 .page li,.layout-checklist.items-1 .page li,.layout-checklist.items-2 .page li,.layout-checklist.items-3 .page li,.layout-checklist.items-4 .page li,.layout-checklist.items-5 .page li{min-height:48px}
.layout-checklist.density-compact .page-content-stack{padding:20px 18px;gap:9px}.layout-checklist.density-compact h1{font-size:25px}.layout-checklist.density-compact .list-block ul{gap:6px 8px}.layout-checklist.density-compact .page li{min-height:46px;padding:7px 7px 7px 29px;font-size:10px;line-height:1.3}.layout-checklist.density-compact .page li:before{left:7px;width:16px;height:16px;font-size:8px}
.layout-steps .page-content-stack{justify-content:flex-start}.layout-steps h1{font-size:27px}.layout-steps .step-col{gap:11px}.layout-steps .step{display:grid;grid-template-columns:38px 1fr;gap:12px;padding-bottom:10px;border-bottom:1px solid var(--line)}.layout-steps .step>b{width:36px;height:36px;font-size:15px}.layout-steps .step h3{font-size:13px}.layout-steps .tl-node{padding-left:18px;padding-bottom:13px}.layout-steps .tl-time{font-size:11px}
.layout-minimal .page-content-stack{min-height:48%;padding:20px 4px;border:0;background:transparent;box-shadow:none;justify-content:center;gap:16px}.layout-minimal .page-content-stack h1{font-family:Georgia,"Noto Serif SC","Songti SC",serif;font-size:34px;line-height:1.12}.layout-minimal .content-block{max-width:92%}.layout-minimal .note-block,.layout-minimal .highlight-block{background:transparent;border-top:1px solid currentColor;border-left:0;border-radius:0;padding:12px 0}
.composition-smart .page-content-stack{display:grid;align-content:center;gap:12px 14px}.composition-smart .eyebrow,.composition-smart h1{grid-column:1/-1}.composition-smart.comp-cols-single .page-content-stack{grid-template-columns:minmax(0,1fr)}.composition-smart.comp-cols-split-wide .page-content-stack{grid-template-columns:minmax(0,1.18fr) minmax(0,.82fr)}.composition-smart.comp-cols-split-even .page-content-stack{grid-template-columns:repeat(2,minmax(0,1fr))}.composition-smart.comp-cols-split-narrow .page-content-stack{grid-template-columns:minmax(0,.72fr) minmax(0,1.28fr)}.composition-smart.comp-flow-stack .content-block{grid-column:1/-1}.composition-smart.comp-flow-alternate .content-block:nth-child(odd){grid-column:1}.composition-smart.comp-flow-alternate .content-block:nth-child(even){grid-column:2}.composition-smart.comp-align-start .page-content-stack{align-content:start}.composition-smart.comp-align-center .page-content-stack{align-content:center}.composition-smart.comp-align-end .page-content-stack{align-content:end}.composition-smart.comp-hero-stack .page-content-stack,.composition-smart.comp-hero-frame .page-content-stack{display:flex;min-height:88%;justify-content:flex-end}.composition-smart.comp-hero-stack h1,.composition-smart.comp-hero-frame h1{font-size:38px;margin-bottom:auto;padding-top:12px}.composition-smart.comp-closing-focus .page-content-stack,.composition-smart.comp-closing-note .page-content-stack{display:flex;min-height:52%;justify-content:center;text-align:center}.composition-smart.comp-closing-focus .content-block,.composition-smart.comp-closing-note .content-block{max-width:92%;margin-inline:auto}.composition-smart.comp-sequence-rail .page-content-stack,.composition-smart.comp-sequence-offset .page-content-stack,.composition-smart.comp-metric-board .page-content-stack,.composition-smart.comp-metric-split .page-content-stack,.composition-smart.comp-comparison-board .page-content-stack,.composition-smart.comp-comparison-split .page-content-stack,.composition-smart.comp-timeline-rail .page-content-stack,.composition-smart.comp-timeline-offset .page-content-stack{justify-content:start}.composition-smart.comp-risk-sidebar .content-block,.composition-smart.comp-risk-frame .content-block{padding-left:12px;border-left:3px solid var(--accent2)}.composition-smart.decor-orbit .page-content-stack:after{content:"";position:absolute;width:92px;height:92px;border:1px solid var(--accent);border-radius:50%;right:-32px;top:-34px;opacity:.22;pointer-events:none}.composition-smart.decor-index-line .page-content-stack:before{content:"";position:absolute;right:16px;top:14px;width:44px;border-top:2px solid var(--accent2);opacity:.45}.composition-smart.decor-stamp .eyebrow{width:max-content;padding:5px 8px;border:1px solid currentColor;transform:rotate(-2deg)}.composition-smart.overlap-title-card h1{position:relative;z-index:2;margin-right:18px;padding:10px 12px;color:var(--ink);background:color-mix(in srgb,var(--surface) 88%,transparent);box-shadow:6px 6px 0 color-mix(in srgb,var(--accent2) 45%,transparent)}.composition-smart.overlap-accent-edge .content-block:nth-child(3){position:relative;z-index:2;transform:translateX(7px);margin-right:7px}.composition-smart[data-layout-source="safe"] .page-content-stack:after,.composition-smart[data-layout-source="safe"] .page-content-stack:before{display:none}.composition-smart[data-layout-source="safe"] .content-block{transform:none}
.composition-smart.blocks-3.comp-flow-alternate.tri-span-last:not(.comp-cols-single) .content-block:last-child{grid-column:1/-1}
.composition-smart.blocks-3.comp-flow-alternate.tri-span-first:not(.comp-cols-single) .content-block:first-of-type{grid-column:1/-1}
.composition-smart.blocks-3.comp-flow-alternate.tri-span-first:not(.comp-cols-single) .content-block:nth-last-child(2){grid-column:1}
.composition-smart.blocks-3.comp-flow-alternate.tri-span-first:not(.comp-cols-single) .content-block:last-child{grid-column:2}
.composition-smart.overlap-accent-edge .content-block:nth-child(3){transform:none;margin-right:0}
.composition-smart.items-4 .list-block ul{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.composition-smart.comp-cols-single.items-6 .list-block ul,.composition-smart.comp-cols-single.items-7 .list-block ul,.composition-smart.comp-cols-single.items-8 .list-block ul,.composition-smart.comp-cols-single.items-9 .list-block ul{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.composition-smart.density-compact .page-content-stack{padding:20px 18px;gap:9px}.composition-smart.density-compact .page li{padding:7px 8px 7px 22px;font-size:10px;line-height:1.35}.theme-palette .composition-smart.page-ending .page-content-stack{background:var(--accent);color:var(--page)}.theme-palette .composition-smart.page-ending h1,.theme-palette .composition-smart.page-ending .text-block,.theme-palette .composition-smart.page-ending .text-block h2,.theme-palette .composition-smart.page-ending .text-block p{color:var(--page)}.theme-palette .composition-smart.page-ending.overlap-title-card h1{background:var(--surface);color:var(--ink)}.composition-smart.page-ending.overlap-title-card h1{color:var(--ink)}
.page.density-relaxed .page-content-stack{gap:calc(var(--card-gap) + 3px)}.page.density-relaxed .content-block{padding-block:3px}
.page.density-expanded .page-content-stack{gap:calc(var(--card-gap) + 12px)}.page.density-expanded h1{font-size:max(var(--h1-size),min(calc(var(--h1-size) + 6px),36px))}.page.density-expanded .content-block h2{font-size:max(var(--h2-size),min(calc(var(--h2-size) + 3px),19px))}.page.density-expanded .content-block p,.page.density-expanded li{font-size:max(var(--body-size),min(calc(var(--body-size) + 2px),14px));line-height:max(var(--line-height),1.6)}.page.density-expanded .content-block{gap:calc(var(--paragraph-gap) + 5px);padding-block:14px}
.page.density-expanded.blocks-1 .page-content-stack,.page.density-expanded.blocks-2 .page-content-stack{gap:calc(var(--card-gap) + 24px)}.page.density-expanded.blocks-1 .content-block,.page.density-expanded.blocks-2 .content-block{padding-block:22px}
</style></head><body class="${themeClass}" data-visual-style="${theme}" data-theme-version="${compiledTheme.version}" data-theme-hash="${compiledTheme.hash}" data-channel="${channelMode}">${sections}</body></html>`;
  return baseHtml.replace('</style>',`${compiledTheme.css}</style>`);
}

function addArtifact(store, batchId, candidateId, kind, filePath) {
  const stat = fs.statSync(filePath);
  store.upsertArtifact({ batchId, candidateId, track:'social_cards', kind, name:path.basename(filePath), path:filePath, size:stat.size, modifiedAt:stat.mtime.toISOString() });
}

async function runAudit(script, htmlPath, reportPath, cwd) {
  try {
    await execFileAsync(process.execPath, [script, htmlPath, '--json', reportPath], { cwd, windowsHide:true, timeout:120000, maxBuffer:2_000_000 });
  } catch (error) {
    if (!fs.existsSync(reportPath)) throw new Error(String(error.stderr || error.stdout || error.message).trim());
  }
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

function validateDelivery({ html, plan, copy, report, images }) {
  const pageCount = [...String(html).matchAll(/class=["']([^"']*)["']/gi)]
    .filter((match) => match[1].split(/\s+/).includes('page')).length;
  const planned = Array.isArray(plan) ? plan.length : 0;
  const issues = [];
  if (!report.valid) issues.push('布局审计未通过');
  if (!planned || pageCount !== planned) issues.push(`HTML 页数 ${pageCount} 与规划页数 ${planned} 不一致`);
  if (images.length !== pageCount) issues.push(`PNG 数量 ${images.length} 与页面数 ${pageCount} 不一致`);
  if (!String(copy || '').trim()) issues.push('配套文案为空');
  const copyTagCount = (String(copy || '').match(/#[^#\s]{1,30}/g) || []).length;
  if (String(copy || '').trim() && copyTagCount < 3) issues.push(`配套文案话题标签不足（检测到 ${copyTagCount} 个，末尾应有 6–8 个）`);
  if (images.some((file) => !fs.existsSync(file) || fs.statSync(file).size === 0)) issues.push('存在空 PNG');
  return { valid:issues.length === 0, issues, pageCount, pngCount:images.length };
}

function eventFactMarkdown(analysis) {
  const facts=analysis.factBase||{},lines=['# 事件图文事实清单','',analysis.eventSummary||'','',
    '## 已确认事实','',...(facts.confirmedFacts||[]).map((item)=>`- ${item.claim}（来源 ${(item.sourceIds||[]).join('、')||'待补'}）`),
    '','## 尚未核实的主张','',...(facts.claims||[]).map((item)=>`- ${item.speaker?`${item.speaker}：`:''}${item.claim}（${item.status||'unverified'}；来源 ${(item.sourceIds||[]).join('、')||'待补'}）`),
    '','## 时间线','',...(facts.timeline||[]).map((item)=>`- ${item.time||'时间待核'}：${item.event}（来源 ${(item.sourceIds||[]).join('、')||'待补'}）`),
    '','## 来源风险与缺口','',...(analysis.sourceAudit?.issues||[]).map((item)=>`- ${item}`),...(analysis.sourceAudit?.neededMaterials||[]).map((item)=>`- 待补：${item}`)];
  return lines.join('\n').trim()+'\n';
}

export async function runSocialCardPipeline({ gateway, store, batchId, candidateId, provider, workspaceRoot, snapshotId=null, onProgress=()=>{} }) {
  const candidate = store.getCandidate(candidateId);
  if (!candidate || candidate.batch_id !== batchId) throw new Error('候选不存在或不属于当前批次');
  const outputMode=candidate.tracks?.find((item)=>item.track==='social_cards')?.output_mode||'';
  const contentType=outputMode.includes('event-cards')?'event':outputMode.includes('custom-cards')?'custom':'repository';
  const channelMode=outputMode.startsWith('xiaohongshu')?'xiaohongshu':'wechat';
  const facts = store.getRepositoryFactSheet(candidateId);
  const eventAnalysisRecord=contentType==='event'?resolveEventAnalysis({store,workspaceRoot,candidate}):null;
  const editorial = store.getCardEditorial(candidateId);
  const themeDefinition=resolveWorkspaceTheme(store,editorial.visual_style||'ice-blue','social')||socialThemeDefinition(editorial.visual_style||'ice-blue',{fallback:false});
  if(!themeDefinition)throw new Error(`未知图文视觉主题：${editorial.visual_style}`);
  store.recordThemeUsage?.({themeId:themeDefinition.id,version:themeDefinition.version,target:'social',source:themeDefinition.source,batchId,candidateId});
  const gate = contentType==='event'?evaluateEventCardGate(candidate,eventAnalysisRecord,editorial):contentType==='custom'?evaluateCustomCardGate(candidate,facts,editorial):evaluateCardGate(candidate, facts, editorial);
  if (!gate.ready) throw new Error(`卡片故事板尚未就绪：${gate.issues.join('；')}`);
  const batch = store.getBatch(batchId);
  const workdir = candidateSocialCardDir(workspaceRoot, batch, candidate);
  fs.mkdirSync(workdir, { recursive:true });
  const themeSnapshotPath=path.join(workdir,'social-theme-snapshot.json');
  writeFile(themeSnapshotPath,JSON.stringify({schemaVersion:1,id:themeDefinition.id,label:themeDefinition.label,version:themeDefinition.version,source:themeDefinition.source,hash:themeDefinition.hash},null,2));

  const generator = loadSkillBundle({ workspaceRoot, skillName:'xiaohongshu-article-generator' });
  const screenshotSkill = loadSkillBundle({ workspaceRoot, skillName:'html-pages-to-images' });
  if (generator.fallback) throw new Error('项目图文生成技能缺失');
  if (screenshotSkill.fallback) throw new Error('项目 HTML 截图技能缺失');
  const skillRuntime=await prepareSkillRun({gateway,store,batchId,candidateId,purpose:`social-cards-${contentType}`,bundles:[generator,screenshotSkill],provider,snapshotId});
  gateway=bindGenerationSnapshot(gateway,skillRuntime.snapshotId);
  provider=skillRuntime.provider;
  const maxLayoutAttempts=configuredRepairAttempts(skillRuntime.config,4)+1;
  const stages = [];
  const storyboardSnapshot=store.findLatestGenerationSnapshot?.({
    batchId,candidateId,purposes:[`social-card-editorial-${contentType}`],
  });
  const storyboardSkillId=storyboardSnapshot?.snapshot?.selection?.stages?.storyboard?.selectedSkill
    ||storyboardSnapshot?.snapshot?.selection?.selectedSkill
    ||(contentType==='event'?'event-card-storyboard':contentType==='custom'?'custom-card-storyboard':'repository-card-storyboard');
  const storyboardSkillHash=storyboardSnapshot?.snapshot?.skills?.find((item)=>item.id===storyboardSkillId)?.promptHash||'';
  store.updateCandidateTrack(candidateId, 'social_cards', { status:'drafting' });
  const record = (stage, skill, output, detail='') => {
    const expected = SOCIAL_CARD_STAGE_CONTRACT[stages.length];
    const skillMatches=expected?.skill==='storyboard-selection'?skill===storyboardSkillId:expected?.skill===skill;
    if (!expected || expected.id !== stage || !skillMatches) throw new Error(`图文契约阶段不一致：${stage}/${skill}`);
    const skillHash=skill===generator.skillName?generator.hash
      :skill===screenshotSkill.skillName?screenshotSkill.hash
      :skill===storyboardSkillId?storyboardSkillHash:'';
    stages.push({ stage, skill, skillHash, output, detail, completedAt:new Date().toISOString() });
    writeFile(path.join(workdir, 'social-card-stage-executions.json'), JSON.stringify(stages, null, 2));
  };
  writeFile(path.join(workdir, 'social-card-skill-manifest.json'), JSON.stringify({
    generator:{ hash:generator.hash, files:generator.files, fallback:generator.fallback },
    screenshots:{ hash:screenshotSkill.hash, files:screenshotSkill.files, fallback:screenshotSkill.fallback },
    loadedAt:new Date().toISOString(),
  }, null, 2));

  onProgress(contentType==='event'?'图文 1/6：读取突发事件事实基座':contentType==='custom'?'图文 1/6：读取自定义事实基座':'图文 1/6：读取已核验仓库事实');
  const factPath = path.join(workdir, 'fact-sheet.md');
  if(contentType==='event')writeFile(factPath,eventFactMarkdown(eventAnalysisRecord.analysis));
  if(contentType==='custom'){
    if(facts?.data?.kind!=='custom')throw new Error('自定义事实基座不存在，请重新创建自定义图文');
    writeFile(factPath,customFactMarkdown(facts.data));
  }
  if (!fs.existsSync(factPath)) throw new Error(contentType==='event'?'事件事实清单不存在，请重新执行突发分析':'fact-sheet.md 不存在，请重新核验仓库');
  record('facts', 'fixed-program', factPath);

  let cardPlan = sanitizeCardPlan(JSON.parse(editorial.card_plan_json || '[]'));
  const budgetResult = budgetCardPlan(cardPlan);
  cardPlan = budgetResult.pages;
  const planPath = path.join(workdir, 'card-plan.json');
  writeFile(planPath, JSON.stringify({ channel_mode:outputMode||editorial.output_mode || 'xiaohongshu', composition_mode:editorial.composition_mode||'template', layout_style:editorial.layout_style||'auto', topic:candidate.hotspot_title, pages:cardPlan }, null, 2));
  record('planning', storyboardSkillId, planPath, budgetResult.trims.length ? `密度预算裁剪：${budgetResult.trims.join('；')}` : '');

  const providerConfig = skillRuntime.providerConfig;
  // 强调色块封面的标题断行交给 AI 做语义切分（英文单词、专有名词不拆开）；
  // 渲染层 normalizeCoverTitleLines 校验不过或调用失败时回退确定性断行
  let coverTitleLines=null;
  const coverPage=cardPlan.find((page)=>page.kind==='cover');
  if(compileSocialTheme(themeDefinition).recipes.coverTitle==='highlight-block'&&coverPage){
    const coverTitle=String(coverPage.title||candidate.hotspot_title||'').trim();
    try{
      const split=await gateway.complete({ provider, purpose:'social-card-cover-title-lines', batchId, candidateId, jsonMode:true,
        maxOutputTokens:Math.min(600,providerConfig.maxOutputTokens), messages:[
          { role:'system', protected:true, content:'你是中文排版编辑。把给定封面标题拆成 1–4 行，用于逐行色块堆叠的封面排版。规则：按语气与语义边界断行；英文单词、数字、专有名词不得拆开；每行视觉宽度不超过 8 个汉字宽度（英文字母、数字、空格按约 0.55 个汉字宽度计）；不得增删或改写任何字符；行数尽量少。只输出 JSON：{"lines":["第一行","第二行"]}。' },
          { role:'user', protected:true, content:JSON.stringify({ title:coverTitle }) },
        ] });
      const parsed=JSON.parse(cleanCardPlanJson(split.content));
      coverTitleLines=parsed?.lines??null;
    }catch{ coverTitleLines=null; }
  }
  const copyReference=contentType==='event'?'references\\copy-event.md'
    :contentType==='custom'?'references\\copy-custom.md':'references\\copy-tool.md';
  const legacyCopyReference=contentType==='event'?'references\\wechat-event-cards.md'
    :contentType==='custom'?'references\\custom-cards.md':'references\\wechat-tool-cards.md';
  const copySkillPrompt=selectSkillPromptReferences(generator.prompt,{
    include:['COPY_GUIDE.md',copyReference,legacyCopyReference],
  });
  const repairSkillPrompt=selectSkillPromptReferences(generator.prompt,{
    include:['DESIGN_SYSTEM.md','references\\layout-contract.md',copyReference,legacyCopyReference],
  });
  const input = {
    channel_mode:outputMode||editorial.output_mode || 'xiaohongshu', topic:candidate.hotspot_title,
    content_type:contentType,custom_content_type:contentType==='custom'?facts.data.content_type:undefined,source_url:contentType==='event'?(eventAnalysisRecord.analysis.sources||[]).map((item)=>item.url):contentType==='custom'?(facts.data.materials||[]).map((item)=>item.url):facts.source_url,
    repository_facts:contentType==='repository'?facts.data:undefined,event_analysis:contentType==='event'?eventAnalysisRecord.analysis:undefined,custom_facts:contentType==='custom'?facts.data:undefined,
    editorial_decisions:editorial,card_plan:cardPlan,
    disclosure:contentType==='event'?'据公开素材整理；未核实主张必须保留边界表达':contentType==='custom'?'体验性表述来自作者确认；建议性内容未实测':'基于项目文档整理，未实际运行', workdir,
  };
  onProgress('图文 2/6：按项目技能生成配套文案');
  const copyResult = await gateway.complete({ provider, purpose:'social-card-copy', batchId, candidateId,
    maxOutputTokens:Math.min(2400, providerConfig.maxOutputTokens), messages:[
      { role:'system', protected:true, content:`${copySkillPrompt}\n\n## 当前运行阶段\n只生成可直接发布的配套文案。输出纯文本，不要 JSON、Markdown 围栏、页码或布局指令；严格遵守事实与禁用表达。${channelMode==='xiaohongshu'?' 小红书渠道：文案口语化、段落短，适度使用 emoji，末尾带 6–8 个话题标签，标签不得含夸大功效词。':' 公众号渠道：文案信息密度优先，结构清晰，末尾带 6–8 个准确话题标签，标签须与内容严格相关。'}${contentType==='event'?' 未核实主张必须注明说话者和“尚未获独立证实”等边界；不得号召网暴或把争议定性为事实。':''}${contentType==='custom'?' 体验性表述只能来自 source_level=author_experience 的要点；user_material 必须保留来源归属；model_suggestion 只能写成建议或参考，禁止写成亲测、效果或收益。':''}` },
      { role:'user', protected:true, content:JSON.stringify(input) },
    ] });
  let copy = String(copyResult.content || '').trim().replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/i, '');
  const configuredGate=evaluateConfiguredGates(skillRuntime.config,{factBase:contentType==='event'?eventAnalysisRecord.analysis:facts?.data||{},output:copy});
  if(!configuredGate.pass)throw new Error(`图文配置门禁未通过：${configuredGate.issues.map((item)=>item.message).join('；')}`);

  onProgress('图文 2.5/6：按技能布局契约组装逐页 HTML');
  let safeCompositionApplied=false;
  let safeCompositionPages=new Set();
  let relaxedDensityPages=new Set();
  let expandedDensityPages=new Set();
  const renderCurrentStoryboard=()=>renderStoryboardHtml({ topic:candidate.hotspot_title, repository:facts?.data?.repository, pages:cardPlan, visualStyle:editorial.visual_style, themeDefinition, layoutStyle:editorial.layout_style, compositionMode:editorial.composition_mode||'template',
    compositionSeed:`${candidate.batch_id}|${candidate.id}`,forceSafeComposition:safeCompositionApplied?(safeCompositionPages.size?[...safeCompositionPages]:true):false,relaxedDensityPages,expandedDensityPages,contentType,channelMode,coverTitleLines,sourceLabel:contentType==='event'?'事件专题':contentType==='custom'?facts?.data?.content_type_label||'自定义':'',disclosure:contentType==='event'?'据公开素材整理 · 未核实内容已标注':'' });
  let html = renderCurrentStoryboard();
  if (!copy || !/<html\b/i.test(html) || !/class=["'][^"']*\bpage\b/i.test(html)) throw new Error('图文生成产物缺少文案、完整 HTML 或 .page');
  const copyPath = path.join(workdir, 'copy.txt');
  const htmlPath = path.join(workdir, 'my-design.html');
  writeFile(copyPath, copy); writeFile(htmlPath, html);
  record('generation', generator.skillName, [copyPath, htmlPath]);

  const auditScript = path.join(workspaceRoot, 'skills', 'xiaohongshu-article-generator', 'scripts', 'layout-audit.mjs');
  const reportPath = path.join(workdir, 'layout-report.json');
  let report;
  let repairCount = 0;
  let repairGuardIssues=[];
  for (let attempt=0; attempt<maxLayoutAttempts; attempt += 1) {
    onProgress(`图文 3/6：浏览器布局审计${attempt ? `与第 ${attempt} 轮修复` : ''}`);
    report = await runAudit(auditScript, htmlPath, reportPath, workdir);
    if (report.valid) break;
    let deterministicRerender=false;
    if(editorial.composition_mode==='smart'&&!safeCompositionApplied){
      const compositionSeedValue=`${candidate.batch_id}|${candidate.id}`;
      const failedIndexes=(Array.isArray(report.pages)?report.pages:[]).filter((page)=>!page.valid).map((page)=>page.page-1).filter((index)=>index>=0);
      // 安全变体只改构图不改内容：当前已是单列堆叠的失败页，安全回退不会改变其版面高度，对它们直接跳过、留给内容修复
      const rescuable=failedIndexes.filter((index)=>{
        const page=cardPlan[index];
        if(!page)return false;
        const current=normalizeCardComposition(page,{pageIndex:index,seed:compositionSeedValue}).composition;
        const safe=normalizeCardComposition(page,{pageIndex:index,seed:compositionSeedValue,forceSafe:true}).composition;
        return current.columns!==safe.columns||current.flow!==safe.flow;
      });
      // 只对审计失败且安全回退确实会改变构图的页启用安全变体，其余页保留故事板/种子构图
      if(rescuable.length){
        safeCompositionApplied=true;
        safeCompositionPages=new Set(rescuable);
        deterministicRerender=true;
      }
    }
    for(const pageReport of Array.isArray(report?.pages)?report.pages:[]){
      const index=Number(pageReport?.page)-1;
      const tier=underfilledDensityTier(pageReport);
      if(index<0||!tier||expandedDensityPages.has(index))continue;
      if(relaxedDensityPages.has(index)){
        relaxedDensityPages.delete(index);
        expandedDensityPages.add(index);
      }else if(tier==='relaxed'){
        relaxedDensityPages.add(index);
      }else{
        expandedDensityPages.add(index);
      }
      deterministicRerender=true;
    }
    if(deterministicRerender){
      html=renderCurrentStoryboard();
      writeFile(htmlPath,html);
      continue;
    }
    if (attempt === maxLayoutAttempts-1) throw new Error(layoutAuditFailureMessage(report,maxLayoutAttempts));
    repairCount += 1;
    const repair = await gateway.complete({ provider, purpose:'social-card-layout-repair', batchId, candidateId,
      maxOutputTokens:Math.min(8000, providerConfig.maxOutputTokens), messages:[
        { role:'system', protected:true, content:`${repairSkillPrompt}\n\n当前是布局修复阶段。只允许调整现有内容块中的文字长度，事实、页面数量、页面顺序、页面类型、页面标题、页面目标、证据引用、内容块数量、内容块顺序、内容块 type 和内容块标题必须保持不变。禁止输出 HTML、CSS、解释或任何非 JSON 内容。\n\n按问题类型调整：\n- underfilled：在原有段落内适度扩写，只能补充事实基座已经提供、且与该段职责直接相关的细节；禁止增加要点、例子、列表条目或内容块，禁止把原段落改写成同义列表。\n- overfilled：缩写原有段落，删除赘述和重复表达；不得删除内容块、列表条目或拆页。\n- overflow/clipped：在原有内容块内缩短文字并合并重复表达；不得新增、拆分、移动或改变内容块。\n- invalid_page_grid_structure/missing_content_stack/empty_page_body：原样保留 card_plan；结构问题由确定性渲染器处理，不得重构内容。\n\n只允许修改 content，或 items/headers/rows 现有成员中的文字；不得增删数组成员。code 内容不得修改。stats 数据卡的 num 字段不超过 6 个字符。\n\n禁止：新增事实、要点、例子、内容块或列表项；隐藏溢出、缩放、伪元素、空白卡、space-between、小于 11px 正文；把指令性描述写入内容字段。\n\n只输出 JSON：可以直接是 card_plan 数组，也可以是包含 card_plan 字段的对象。` },
        { role:'user', protected:true, content:JSON.stringify({ report, card_plan:cardPlan, previous_repair_rejected:repairGuardIssues, copy, topic:candidate.hotspot_title, content_type:contentType }) },
      ] });
    let repairJson;
    try {
      repairJson = cleanCardPlanJson(repair.content);
    } catch (error) {
      throw new Error(`第 ${attempt + 1} 轮布局修复返回的 JSON 无法解析：${error.message}`);
    }
    const newPlan = sanitizeCardPlan(Array.isArray(repairJson) ? repairJson : repairJson.card_plan).map((page,index)=>({
      ...page,
      layout_style:SOCIAL_CARD_LAYOUTS.includes(cardPlan[index]?.layout_style)?cardPlan[index].layout_style:'auto',
    }));
    repairGuardIssues=cardPlanRepairStructureIssues(cardPlan,newPlan);
    if(repairGuardIssues.length){if(attempt>=maxLayoutAttempts-2)throw new Error(`第 ${attempt + 1} 轮布局修复修改了受保护的故事板结构：${repairGuardIssues.join('；')}。AI 修复反复越界，建议在「02 卡片故事板」中直接调整问题页结构后重新「生成整组图文」。`);continue;}
    repairGuardIssues=[];
    cardPlan = newPlan;
    writeFile(planPath, JSON.stringify({ channel_mode:editorial.output_mode || 'xiaohongshu', composition_mode:editorial.composition_mode||'template', composition_safety:safeCompositionApplied?'safe':'standard', layout_style:editorial.layout_style||'auto', topic:candidate.hotspot_title, pages:cardPlan }, null, 2));
    html = renderCurrentStoryboard();
    writeFile(htmlPath, html);
  }
  writeFile(planPath, JSON.stringify({ channel_mode:editorial.output_mode || 'xiaohongshu', composition_mode:editorial.composition_mode||'template', composition_seed:`${candidate.batch_id}|${candidate.id}`, composition_safety:safeCompositionApplied?'safe':'standard', layout_style:editorial.layout_style||'auto', topic:candidate.hotspot_title, pages:cardPlan }, null, 2));
  // 记录故事板构图被回退/补齐的页，避免 LLM 构图被静默丢弃
  const compositionNotes=editorial.composition_mode==='smart'
    ? describeCardLayouts(cardPlan,{channelMode,compositionMode:'smart',seed:`${candidate.batch_id}|${candidate.id}`})
      .filter((decision)=>decision.source==='fallback'||decision.adjusted)
      .map((decision)=>`P${decision.page}${decision.source==='fallback'?'构图非法回退':'构图字段补齐'}`)
    : [];
  record('layout-audit', generator.skillName, reportPath, `安全变体：${safeCompositionApplied?safeCompositionPages.size?`已启用（${[...safeCompositionPages].map((index)=>`P${index+1}`).sort().join('、')}）`:'已启用':'未触发'}；舒展排版：${relaxedDensityPages.size?`轻档（${[...relaxedDensityPages].map((index)=>`P${index+1}`).sort().join('、')}）`:'轻档未触发'}，${expandedDensityPages.size?`强档（${[...expandedDensityPages].map((index)=>`P${index+1}`).sort().join('、')}）`:'强档未触发'}；内容修复轮次：${repairCount}${compositionNotes.length?`；${compositionNotes.join('、')}`:''}`);

  onProgress('图文 4/6：逐页生成高清 PNG');
  const outputDir = path.join(workdir, 'output');
  fs.mkdirSync(outputDir, { recursive:true });
  for (const file of fs.readdirSync(outputDir).filter((name)=>/\.png$/i.test(name))) {
    fs.unlinkSync(path.join(outputDir, file));
  }
  const screenshotModule = path.join(workspaceRoot, 'skills', 'html-pages-to-images', 'index.js');
  const { execute } = await import(`${pathToFileURL(screenshotModule).href}?v=${Date.now()}`);
  // 小红书与公众号页型一致：375×667（技能布局契约的固定页型）
  const screenshotResult = await execute({ htmlFile:htmlPath, outputDir, selector:'.page', pageWidth:375, pageHeight:667, deviceScaleFactor:3 });
  if (!screenshotResult.success) throw new Error(screenshotResult.message);
  const images = screenshotResult.data.images.map((item) => typeof item === 'string' ? item : item.path || item.filePath).filter(Boolean);
  record('screenshots', screenshotSkill.skillName, images);

  onProgress('图文 5/6：执行产物一致性门禁');
  const delivery = validateDelivery({ html:fs.readFileSync(htmlPath, 'utf8'), plan:cardPlan, copy, report, images });
  const deliveryPath = path.join(workdir, 'delivery-report.json');
  writeFile(deliveryPath, JSON.stringify(delivery, null, 2));
  if (!delivery.valid) throw new Error(`图文交付门禁未通过：${delivery.issues.join('；')}`);
  record('delivery-gate', 'fixed-program', deliveryPath);

  for (const [kind, file] of [['图文事实清单',factPath],['图文卡片规划',planPath],['图文配套文案',copyPath],['图文设计 HTML',htmlPath],['图文布局审计',reportPath],['图文交付报告',deliveryPath],['图文主题快照',themeSnapshotPath]]) addArtifact(store,batchId,candidateId,kind,file);
  for (const image of images) addArtifact(store,batchId,candidateId,'图文卡片 PNG',image);
  store.updateCandidateTrack(candidateId, 'social_cards', { status:'completed' });
  onProgress(`图文 6/6：完成，共生成 ${images.length} 张卡片`);
  return { workdir, copy:copyPath, html:htmlPath, layoutReport:reportPath, deliveryReport:deliveryPath, theme:{id:themeDefinition.id,version:themeDefinition.version,hash:themeDefinition.hash}, themeSnapshot:themeSnapshotPath, images, pageCount:images.length };
}
