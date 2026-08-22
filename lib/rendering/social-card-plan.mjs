const AUXILIARY_TYPES = new Set(['note', 'highlight']);
const isAuxiliary = (block) => AUXILIARY_TYPES.has(block?.type) || block?.role === 'auxiliary' || block?.importance === 'secondary';
export const listBlockValues = (block) => {
  if (Array.isArray(block?.items) && block.items.length) return block.items;
  const lines = String(block?.content || '').split(/\n+/).filter((item) => item.trim());
  return lines.length === 1 && (lines[0].match(/、/g) || []).length >= 2 ? lines[0].split('、') : lines;
};

export function cardPageDensity(page) {
  const blocks = Array.isArray(page?.content_blocks) ? page.content_blocks : [];
  const itemCount = blocks.reduce((total, block) => total + (block?.type === 'list' ? listBlockValues(block).length : Array.isArray(block?.items) ? block.items.length : 0), 0);
  const textLength = blocks.reduce((total, block) => total + String(block?.content || '').length, 0);
  return itemCount > 8 || textLength > 520 ? 'compact' : 'normal';
}

export const CARD_PLAN_BLOCK_BUDGET = Object.freeze({ cover: 2, content: 3, ending: 2 });
export const CARD_PLAN_PAGE_ITEM_BUDGET = 9;

const COVER_TITLE_MAX_WIDTH = 8;
const COVER_TITLE_CONNECTOR = /[._/+&-]/;
const COVER_TITLE_LATIN = /[A-Za-z0-9]/;
const COVER_TITLE_PUNCTUATION = /^[，。！？：；、,.!?;:）】》」』』”’)]/;

function coverTitleVisualWidth(text) {
  return Array.from(String(text || '')).reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 1 : 0.55), 0);
}

function coverTitleTokens(value) {
  const characters = Array.from(String(value || ''));
  const tokens = [];
  for (let index = 0; index < characters.length;) {
    const character = characters[index];
    if (/\s/.test(character)) {
      if (tokens.at(-1) !== ' ') tokens.push(' ');
      index += 1;
      continue;
    }
    if (COVER_TITLE_LATIN.test(character)) {
      let token = character;
      index += 1;
      while (index < characters.length) {
        const next = characters[index];
        if (COVER_TITLE_LATIN.test(next)) {
          token += next;
          index += 1;
          continue;
        }
        if (COVER_TITLE_CONNECTOR.test(next) && COVER_TITLE_LATIN.test(characters[index + 1] || '')) {
          token += next;
          index += 1;
          continue;
        }
        break;
      }
      tokens.push(token);
      continue;
    }
    tokens.push(character);
    index += 1;
  }
  return tokens;
}

/**
 * Deterministic fallback for AI cover-title splitting.
 * Keeps Latin/number runs (including HTML/Markdown, v1.2 and C++) intact,
 * while using whitespace and Chinese punctuation as natural break points.
 */
export function deterministicCoverTitleLines(title, maxWidth = COVER_TITLE_MAX_WIDTH) {
  const value = String(title || '').trim();
  if (!value) return [];
  const lines = [];
  let current = '';
  let width = 0;
  let breakAfterPunctuation = false;
  for (const token of coverTitleTokens(value)) {
    if (token === ' ') {
      if (current && !current.endsWith(' ')) {
        current += token;
        width += 0.55;
      }
      continue;
    }
    const tokenWidth = coverTitleVisualWidth(token);
    const punctuation = COVER_TITLE_PUNCTUATION.test(token);
    if (breakAfterPunctuation && current) {
      lines.push(current.trim());
      current = '';
      width = 0;
      breakAfterPunctuation = false;
    }
    if (current && width + tokenWidth > maxWidth && !punctuation) {
      lines.push(current.trimEnd());
      current = token;
      width = tokenWidth;
    } else {
      current += token;
      width += tokenWidth;
    }
    if (punctuation) breakAfterPunctuation = true;
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

export function budgetCardPlan(cardPlan) {
  const trims = [];
  const pages = (Array.isArray(cardPlan) ? cardPlan : []).map((page, pageIndex) => {
    const prefix = `P${pageIndex + 1}`; const kind = page?.kind === 'cover' ? 'cover' : page?.kind === 'ending' ? 'ending' : 'content'; const cap = CARD_PLAN_BLOCK_BUDGET[kind];
    let blocks = Array.isArray(page?.content_blocks) ? [...page.content_blocks] : [];
    if (blocks.length > cap) {
      const drop = new Set();
      for (let index = blocks.length - 1; index >= 0 && blocks.length - drop.size > cap; index -= 1) if (blocks.length - drop.size > 1 && isAuxiliary(blocks[index])) drop.add(index);
      for (let index = blocks.length - 1; index >= 0 && blocks.length - drop.size > cap; index -= 1) if (blocks.length - drop.size > 1 && !drop.has(index)) drop.add(index);
      const removed = blocks.filter((_, index) => drop.has(index)); blocks = blocks.filter((_, index) => !drop.has(index));
      trims.push(`${prefix} 超出${kind === 'cover' ? '封面' : kind === 'ending' ? '结尾页' : '内容页'}块数上限 ${cap}，移除 ${removed.length} 个内容块（${removed.map((block) => block?.title || block?.type || '未命名').join('、')}）`);
    }
    let itemCount = blocks.reduce((total, block) => total + (block?.type === 'list' ? listBlockValues(block).length : 0), 0);
    if (itemCount > CARD_PLAN_PAGE_ITEM_BUDGET) {
      const next = [...blocks];
      for (let index = next.length - 1; index >= 0 && itemCount > CARD_PLAN_PAGE_ITEM_BUDGET; index -= 1) {
        const block = next[index]; if (block?.type !== 'list') continue; const values = listBlockValues(block); const keep = Math.max(2, values.length - (itemCount - CARD_PLAN_PAGE_ITEM_BUDGET)); if (keep >= values.length) continue;
        itemCount -= values.length - keep; next[index] = Array.isArray(block.items) && block.items.length ? { ...block, items: block.items.slice(0, keep) } : { ...block, content: values.slice(0, keep).join('\n') };
        trims.push(`${prefix} 列表条目超出单页上限 ${CARD_PLAN_PAGE_ITEM_BUDGET}，截断「${block?.title || '列表'}」${values.length - keep} 条`);
      }
      blocks = next;
    }
    return { ...page, content_blocks: blocks };
  });
  return { pages, trims };
}

const BLOCKING = new Set(['overflow','clipped','horizontal_overflow','overfilled','text_too_small','invalid_page_grid_structure','missing_content_stack','empty_page_body']);
export function underfilledPageIndexes(report, excluded = new Set()) { return (Array.isArray(report?.pages) ? report.pages : []).filter((page) => { const issues=Array.isArray(page?.issues)?page.issues:[],index=Number(page?.page)-1;return index>=0&&!excluded.has(index)&&issues.includes('underfilled')&&!issues.some((issue)=>BLOCKING.has(issue)); }).map((page)=>Number(page.page)-1); }
export function underfilledDensityTier(page) { const issues=Array.isArray(page?.issues)?page.issues:[];if(page?.kind!=='content'||!issues.includes('underfilled')||issues.some((issue)=>BLOCKING.has(issue)))return null;return Number(page?.utilization)>=48?'relaxed':'expanded'; }
export function normalizeCoverTitleLines(title, lines) { if(!Array.isArray(lines)||!lines.length||lines.length>4)return null;const cleaned=lines.map((line)=>String(line??'').trim()).filter(Boolean);if(!cleaned.length||cleaned.length!==lines.length)return null;const strip=(text)=>String(text||'').replace(/\s+/g,'');if(strip(cleaned.join(''))!==strip(title))return null;const width=(text)=>Array.from(text).reduce((sum,char)=>sum+(/[^\x00-\xff]/.test(char)?1:0.55),0);return cleaned.some((line)=>width(line)>9)?null:cleaned; }

const LABELS={underfilled:'内容不足',overfilled:'内容过多',overflow:'内容溢出',clipped:'内容被裁切',horizontal_overflow:'横向溢出',vertical_imbalance:'垂直失衡',text_too_small:'文字过小',invalid_page_grid_structure:'页面结构异常',missing_content_stack:'页面结构异常',empty_page_body:'页面无内容'};
export function layoutAuditFailureMessage(report,maxLayoutAttempts) { const failed=(Array.isArray(report?.pages)?report.pages:[]).filter((page)=>!page.valid),details=failed.map((page)=>{const labels=(Array.isArray(page?.issues)?page.issues:[]).map((issue)=>LABELS[issue]||issue).join('、'),utilization=Number.isFinite(Number(page?.utilization))?`（版面利用率 ${page.utilization}%）`:'';return `P${page.page} ${labels}${utilization}`;}).join('；'),has=(names)=>failed.some((page)=>(Array.isArray(page?.issues)?page.issues:[]).some((issue)=>names.includes(issue))),advice=[];if(has(['underfilled']))advice.push('内容不足的页：补充内容块、增加列表条目或扩写段落');if(has(['overfilled','overflow','clipped','horizontal_overflow']))advice.push('内容放不下的页：删减、拆分或缩短文字');if(!advice.length)advice.push('调整问题页的内容或构图');return `布局审计 ${maxLayoutAttempts} 轮后仍未通过：${details}。自动修复（构图回退、舒展排版、AI 改写）已穷尽，请打开该候选的图文编辑器，在「02 卡片故事板」中修改对应页面后重新「生成整组图文」——${advice.join('；')}。`; }
