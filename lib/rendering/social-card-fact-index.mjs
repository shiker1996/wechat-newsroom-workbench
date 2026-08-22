import { createHash } from 'node:crypto';
import { findSocialCardSupplementSlot, getSocialCardSupplementSlots } from './social-card-supplement-slots.mjs';
import { inferCardPageRole } from './social-card-role.mjs';
import {
  SOCIAL_CARD_SLOT_SEMANTIC_TAGS,
  socialCardFactComponentPresentation,
} from './social-card-page-component-contract.mjs';

export const SOCIAL_CARD_FACT_INDEX_SCHEMA_VERSION = 1;

const SKIP_KEYS = new Set(['readmeMarkdown', 'markdown', 'html', 'raw', 'contentHtml']);
const UNVERIFIED_PATH = /\b(?:claims?|unverified|openQuestions?|unknowns?)\b/i;
const TAG_RULES = Object.freeze([
  ['install', /install|installation|setup|getting.?started|quick.?start|安装|配置|部署/i],
  ['run', /usage|use.?case|run|command|workflow|example|shortcut|ssh|使用|运行|命令|流程|示例|快捷键/i],
  ['capability', /capabilit|feature|function|what|ability|能力|功能|特性/i],
  ['context', /overview|description|background|context|intro|介绍|背景|概览/i],
  ['limitation', /limit|boundar|constraint|warning|caveat|shortcut|windows|限制|边界|风险|注意|快捷键/i],
  ['permission', /permission|auth|access|credential|权限|授权|登录/i],
  ['network', /network|internet|api|remote|online|网络|联网|远程/i],
  ['metric', /star|fork|count|number|metric|score|指标|数量|统计/i],
  ['source', /source|readme|license|url|reference|来源|文档|许可/i],
  ['release', /release|version|publish|tag|发布|版本/i],
  ['timeline', /timeline|time|date|event|时间|阶段|事件/i],
  ['maturity', /maturity|status|stable|alpha|beta|archived|成熟|状态/i],
  ['platform', /platform|os|language|topic|环境|平台|系统|语言/i],
  ['security', /security|safe|privacy|secret|安全|隐私/i],
  ['output', /output|result|artifact|生成|输出|结果|产物/i],
]);

const SLOT_TAGS = SOCIAL_CARD_SLOT_SEMANTIC_TAGS;

const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const CJK_RE = /[\u3400-\u9fff]/u;
const LATIN_RE = /[A-Za-z]/g;
const COMMAND_RE = /^(?:(?:npm|pnpm|yarn|npx|pip|uv|docker|git|curl|wget)\s+|[.$]?[\\/]?[\w.-]+\s+--?[\w-]+)/iu;

/**
 * 事实索引中的 text 是来源证据，不等于可以直接放进中文卡片的展示文案。
 * 所有事实都必须先由内容计划调整器生成 display_text；source_text 只作为
 * 来源证据。显式 display_text 可作为外部已生成文案，但默认索引候选统一
 * 标记 pending，避免中文原文和英文原文走两套质量标准。
 */
export function socialCardFactDisplaySpec(candidate = {}) {
  const sourceText = String(candidate?.source_text ?? candidate?.text ?? '').trim();
  const explicitDisplay = String(candidate?.display_text ?? '').trim();
  if (explicitDisplay) return { sourceText, displayText: explicitDisplay, status: 'provided', displayLanguage: CJK_RE.test(explicitDisplay) ? 'zh' : 'technical' };
  if (!sourceText) return { sourceText: '', displayText: '', status: 'missing', displayLanguage: 'unknown' };
  if (candidate?.display_text_status === 'pending' || candidate?.display_text_status === 'needs-localization') return { sourceText, displayText: '', status: 'pending', displayLanguage: 'unknown' };
  // 兼容直接传入组件的旧测试/调用方；正式事实索引会显式写入 pending，
  // 因此不会走这里把 source_text 当成展示内容。
  if (/^```[\s\S]*```$/u.test(sourceText) || COMMAND_RE.test(sourceText)) return { sourceText, displayText: sourceText, status: 'provided', displayLanguage: 'technical' };
  const cjkCount = (sourceText.match(/[\u3400-\u9fff]/gu) || []).length;
  const latinCount = (sourceText.match(LATIN_RE) || []).length;
  if (cjkCount > 0 && cjkCount >= Math.max(1, Math.floor(latinCount * 0.15))) {
    return { sourceText, displayText: sourceText, status: 'provided', displayLanguage: 'zh' };
  }
  return { sourceText, displayText: '', status: 'pending', displayLanguage: 'unknown' };
}

export function socialCardFactDisplayText(candidate = {}) {
  return socialCardFactDisplaySpec(candidate).displayText;
}
// 普通事实可以压成单行，但完整 fenced code 必须保留换行；否则后续
// 组件候选无法判断它是代码，也无法按代码块渲染。
const factText = (value) => {
  const raw = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (/^```[^\n`]*\n[\s\S]*\n?```$/u.test(raw)) return raw;
  return raw.replace(/\s+/g, ' ').trim();
};
const refs = (value) => [...new Set((Array.isArray(value) ? value : value == null ? [] : [value]).map(text).filter(Boolean))];

function sourceRefsFromNode(node, inherited = []) {
  if (!node || typeof node !== 'object') return inherited;
  const direct = refs(node.source_refs ?? node.sourceRefs ?? node.sourceIds);
  if (direct.length) return direct;
  const source = node.source;
  if (typeof source === 'string' && source.trim()) return [source.trim()];
  if (source && typeof source === 'object') {
    const nested = refs(source.url ?? source.html_url ?? source.id ?? source.ref);
    if (nested.length) return nested;
  }
  return inherited;
}

function addTags(path, label, value = '') {
  // 语义槽位只依赖结构化路径/字段名/章节标题，不依赖英文正文中的偶然
  // 关键词。正文保留在 source_text 里供 AI 做受控转述，但不能改变槽位匹配。
  const haystack = `${path} ${label} ${value}`;
  return [...new Set(TAG_RULES.filter(([, pattern]) => pattern.test(haystack)).map(([tag]) => tag))];
}

function candidateId(path, value) {
  // ID 继续按旧版折叠空白计算，避免仅因保留 fenced code 换行就让
  // 已保存故事板里的 fact_ids 全部失效；展示文本本身仍保留代码换行。
  const stableValue = String(value ?? '').replace(/\s+/g, ' ').trim();
  return `fact-${createHash('sha1').update(`${path}|${stableValue}`).digest('hex').slice(0, 12)}`;
}

function scalarText(value) {
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return factText(value);
}

function shouldKeep(value) {
  const valueText = scalarText(value);
  return valueText.length >= 2 && valueText.length <= 1200 && !/^https?:\/\/\S+$/.test(valueText);
}

function labelFor(path, key) {
  return text(key || String(path).split('.').at(-1) || '事实');
}

function collectFacts(value, path, inheritedRefs, output, rootRefs) {
  if (value == null || SKIP_KEYS.has(String(path).split('.').at(-1))) return;
  const localRefs = sourceRefsFromNode(value, inheritedRefs);
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectFacts(item, `${path}[${index}]`, localRefs, output, rootRefs));
    return;
  }
  if (typeof value !== 'object') {
    if (!shouldKeep(value)) return;
    const claim = scalarText(value);
    const key = String(path).split('.').at(-1)?.replace(/\[\d+\]$/, '') || 'fact';
    const tags = addTags(path, key);
    output.push({ id: candidateId(path, claim), path, label: labelFor(path, key), text: claim, source_refs: localRefs.length ? localRefs : rootRefs, tags, source_status: localRefs.length || rootRefs.length ? 'provided' : 'missing', priority: tags.includes('capability') || tags.includes('install') || tags.includes('run') ? 'core' : 'supporting' });
    return;
  }
  const objectRefs = sourceRefsFromNode(value, localRefs);
  const directText = value.claim ?? value.fact ?? value.content ?? value.text ?? value.event ?? value.adds ?? value.conclusion;
  if (shouldKeep(directText)) {
    const key = String(path).split('.').at(-1)?.replace(/\[\d+\]$/, '') || 'fact';
    const claim = scalarText(directText);
    const titleHint = value.title ?? value.label ?? value.name ?? '';
    const tags = addTags(path, `${key} ${text(titleHint)}`);
    output.push({ id: candidateId(path, claim), path, label: labelFor(path, key), text: claim, source_refs: objectRefs.length ? objectRefs : rootRefs, tags, source_status: objectRefs.length || rootRefs.length ? 'provided' : 'missing', priority: tags.includes('capability') || tags.includes('install') || tags.includes('run') ? 'core' : 'supporting' });
  }
  for (const [key, child] of Object.entries(value)) {
    if (['source_refs', 'sourceRefs', 'sourceIds', 'source', 'claim', 'fact', 'content', 'text', 'event', 'adds', 'conclusion'].includes(key)) continue;
    collectFacts(child, `${path}.${key}`, objectRefs, output, rootRefs);
  }
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((item) => {
    const key = `${item.text}|${item.source_refs.join('|')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildSocialCardFactIndex(facts = {}, { contentType = 'repository' } = {}) {
  const root = facts && typeof facts === 'object' ? facts : {};
  const listedSources = [root.sources, root.materials, root.web_search, root.news_search]
    .flatMap((items) => Array.isArray(items) ? items : [])
    .flatMap((item) => item && typeof item === 'object' ? [item.url ?? item.final_url ?? item.source_url] : [item]);
  const rootRefs = [...new Set([
    ...[root.verifiedSources, root.source_refs, root.sourceRefs, root.sourceUrl, root.source_url].flatMap((value) => refs(value)),
    ...refs(listedSources),
  ])];
  const candidates = [];
  collectFacts(root, 'facts', [], candidates, rootRefs);
  const normalized = dedupeCandidates(candidates)
    .filter((item) => !UNVERIFIED_PATH.test(item.path))
    .map((item, index) => {
      const presentation = socialCardFactComponentPresentation(item);
      const display = socialCardFactDisplaySpec(item);
      return {
        ...item,
        index: index + 1,
        // text/source_text 永远是来源证据；display_text 由内容计划 AI
        // 生成后才允许进入卡片内容块。索引阶段不直接复用任何原文。
        source_text: item.text,
        display_text: '',
        display_text_status: display.status === 'missing' ? 'missing' : 'pending',
        display_language: display.displayLanguage,
        display_label: presentation.displayLabel,
        semantic_intent: presentation.semanticIntent,
        semantic_intent_candidates: presentation.semanticIntentCandidates,
        component_eligible: presentation.componentEligible,
        component_exclusion_reason: presentation.componentExclusionReason,
      };
    });
  return { schemaVersion: SOCIAL_CARD_FACT_INDEX_SCHEMA_VERSION, contentType: String(contentType || 'repository'), candidateCount: normalized.length, candidates: normalized };
}

export function knownSourceRefsFromSocialCardFactIndex(index = {}) {
  return [...new Set((Array.isArray(index?.candidates) ? index.candidates : []).flatMap((item) => Array.isArray(item?.source_refs) ? item.source_refs : []).map(String).filter(Boolean))];
}

export function selectSocialCardFactCandidates(index = {}, { role = 'feature', slotId = '', blockType = '', existingFactIds = [], existingSourceRefs = [], limit = 4 } = {}) {
  const slot = findSocialCardSupplementSlot(role, slotId);
  const allowedTags = new Set(SLOT_TAGS[`${role}.${slotId}`] || []);
  const excludedIds = new Set((Array.isArray(existingFactIds) ? existingFactIds : []).map(String));
  const excludedRefs = new Set((Array.isArray(existingSourceRefs) ? existingSourceRefs : []).map(String));
  const candidates = Array.isArray(index?.candidates) ? index.candidates : [];
  return candidates.map((candidate) => {
    let score = candidate.priority === 'core' ? 4 : 1;
    score += candidate.tags.filter((tag) => allowedTags.has(tag)).length * 5;
    if (blockType && slot?.blockTypes?.includes(blockType)) score += 1;
    if (candidate.source_status !== 'provided') score -= 20;
    if (excludedIds.has(candidate.id)) score -= 100;
    if (candidate.source_refs.some((ref) => excludedRefs.has(String(ref)))) score -= 2;
    return { ...candidate, score, match_reasons: candidate.tags.filter((tag) => allowedTags.has(tag)) };
  }).filter((candidate) => candidate.score > 0 && candidate.source_refs.length).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, Math.max(0, Number(limit) || 0));
}

export function buildSocialCardFactCandidatePrompt(index = {}, { roles = null, maxCandidates = 40 } = {}) {
  const list = (Array.isArray(index?.candidates) ? index.candidates : [])
    .filter((item) => item.source_status === 'provided' && item.component_eligible !== false)
    .slice(0, Math.max(0, Number(maxCandidates) || 0));
  const roleText = roles || {};
  return JSON.stringify({ schemaVersion: SOCIAL_CARD_FACT_INDEX_SCHEMA_VERSION, roleSlots: roleText, candidates: list.map((item) => {
    const display = socialCardFactDisplaySpec(item);
    const result = {
      id: item.id,
      label: item.label,
      display_label: item.display_label,
      display_text: display.displayText || null,
      display_text_status: display.status,
      source_text: item.source_text || item.text,
      source_refs: item.source_refs,
      tags: item.tags,
      semantic_intent: item.semantic_intent,
      semantic_intent_candidates: item.semantic_intent_candidates,
      priority: item.priority,
    };
    // 只有显式外部 display_text 才保留兼容 text；索引候选的 source_text
    // 不再以 text 字段暴露，避免模型把任何原文误当成可直接渲染内容。
    if (display.displayText) result.text = display.displayText;
    return result;
  }) });
}

export function buildSocialCardFactBlockFromCandidates(index = {}, { role = 'feature', slotId = '', blockType = 'note', factIds = [], title = '' } = {}) {
  const ids = new Set((Array.isArray(factIds) ? factIds : []).map(String));
  const selected = (Array.isArray(index?.candidates) ? index.candidates : []).filter((item) => ids.has(String(item.id)) && item.source_status === 'provided');
  const slot = findSocialCardSupplementSlot(role, slotId);
  if (!selected.length || !slot || !slot.blockTypes.includes(blockType)) return null;
  const source_refs = [...new Set(selected.flatMap((item) => item.source_refs))];
  const values = selected.slice(0, slot.maxItems).map((item) => socialCardFactDisplayText(item)).filter(Boolean);
  if (!values.length) return null;
  const block = { type: blockType, title: String(title || slot.label), source_refs, fact_ids: selected.map((item) => item.id), supplement_slot_id: slotId };
  if (['list', 'steps', 'timeline', 'scenes'].includes(blockType)) block.items = values;
  else if (blockType === 'compare') block.rows = values.map((value) => [value]);
  else block.content = values.join('；');
  return block;
}

export function buildDeterministicSocialCardFactSupplementOperations(cardPlan = [], layoutPages = [], index = {}, { maxFactBlocksAdded = 1, maxBlocksByRole = {}, allowedBlockTypes = [], canApply = null } = {}) {
  if (!Array.isArray(cardPlan) || !Array.isArray(layoutPages) || Number(maxFactBlocksAdded) < 1) return [];
  const existingFactIds = cardPlan.flatMap((page) => (Array.isArray(page?.content_blocks) ? page.content_blocks : []).flatMap((block) => Array.isArray(block?.fact_ids) ? block.fact_ids : [])).map(String);
  const existingSourceRefs = cardPlan.flatMap((page) => (Array.isArray(page?.content_blocks) ? page.content_blocks : []).flatMap((block) => Array.isArray(block?.source_refs) ? block.source_refs : [])).map(String);
  const operations = [];
  const targets = [...layoutPages].sort((a, b) => {
    const aUtil = Number.isFinite(Number(a?.utilization)) ? Number(a.utilization) : 1;
    const bUtil = Number.isFinite(Number(b?.utilization)) ? Number(b.utilization) : 1;
    return aUtil - bUtil || Number(a?.page || 0) - Number(b?.page || 0);
  });
  for (const layoutPage of targets) {
    if (operations.length >= Number(maxFactBlocksAdded)) break;
    if (!Array.isArray(layoutPage?.issues) || !layoutPage.issues.some((issue) => String(issue) === 'underfilled')) continue;
    const pageNumber = Number(layoutPage.page);
    const page = Number.isInteger(pageNumber) ? cardPlan[pageNumber - 1] : null;
    if (!page || page.kind === 'cover' || page.kind === 'ending') continue;
    const role = String(page.role || inferCardPageRole(page));
    const maxBlocks = Number(maxBlocksByRole?.[role]);
    const blocks = Array.isArray(page.content_blocks) ? page.content_blocks : [];
    if (Number.isFinite(maxBlocks) && blocks.length >= maxBlocks) continue;
    const usedSlots = new Set(blocks.map((block) => String(block?.supplement_slot_id || '')).filter(Boolean));
    const slots = getSocialCardSupplementSlots(role).filter((slot) => !usedSlots.has(slot.id)).sort((a, b) => b.priority - a.priority);
    for (const slot of slots) {
      const blockType = slot.blockTypes.find((type) => !allowedBlockTypes.length || allowedBlockTypes.includes(type));
      if (!blockType) continue;
      const selected = selectSocialCardFactCandidates(index, { role, slotId: slot.id, blockType, existingFactIds, existingSourceRefs, limit: Math.min(slot.maxItems, 4) });
      if (!selected.length) continue;
      // 事实补充不是“把候选全部塞进去”：从最多 4 条候选开始逐步缩小，
      // 每次都交给调用方做完整页面容量模拟，取第一个安全组合。
      let accepted = null;
      for (let count = selected.length; count >= 1; count -= 1) {
        const subset = selected.slice(0, count);
        const block = buildSocialCardFactBlockFromCandidates(index, { role, slotId: slot.id, blockType, factIds: subset.map((item) => item.id) });
        if (!block) continue;
        const operation = { op: 'add_fact_block', page: pageNumber, slot_id: slot.id, fact_ids: subset.map((item) => item.id), source_refs: block.source_refs, block };
        if (typeof canApply === 'function' && !canApply({ operation, page, block, role, slot })) continue;
        accepted = operation;
        break;
      }
      if (!accepted) continue;
      operations.push(accepted);
      break;
    }
  }
  return operations;
}
