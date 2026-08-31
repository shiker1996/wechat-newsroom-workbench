import fs from 'node:fs';
import path from 'node:path';
import { buildWechatInsights } from './wechat-content-insights.mjs';

export const SOCIAL_CONTENT_FEATURE_VERSION = 'v1';

const CTA_WORDS = ['关注', '收藏', '留言', '评论', '欢迎', '后续', '下一篇', '如果你', '不妨'];
const BOUNDARY_WORDS = ['注意', '限制', '不适合', '前提', '风险', '未实际', '仅供', '建议先', '可能'];
const BENEFIT_WORDS = ['可以', '解决', '省', '提升', '降低', '减少', '自动', '一键', '不用', '帮助', '适合'];
const STORYBOARD_ROLES = ['cover', 'problem', 'capability', 'quickstart', 'scenario', 'limitation', 'ending'];

function readText(filePath, maxChars = 160000) {
  try { return fs.readFileSync(filePath, 'utf8').slice(0, maxChars); } catch { return ''; }
}

function readJson(filePath) {
  try { return JSON.parse(readText(filePath, 600000)); } catch { return null; }
}

function countMatches(value, pattern) { return (String(value || '').match(pattern) || []).length; }
function hasAny(value, words) { return words.some((word) => String(value || '').toLowerCase().includes(String(word).toLowerCase())); }

function plainText(value = '') {
  return String(value || '')
    .replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/```[\w-]*\s*/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function paragraphs(value = '') {
  return String(value || '').split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
}

function firstCopyLine(value = '') {
  return String(value || '').split(/\r?\n/).map((line) => line.trim())
    .map((line) => line.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '').trim())
    .find((line) => line && !/^[-*_]{3,}$/.test(line) && !/^(好的|以下|根据|我将|本次)/.test(line)) || '';
}

function directoryFor(filePath) {
  if (!filePath) return '';
  try { return fs.statSync(filePath).isDirectory() ? filePath : path.dirname(filePath); } catch { return path.dirname(filePath); }
}

function planPages(plan) {
  if (Array.isArray(plan)) return plan;
  return Array.isArray(plan?.pages) ? plan.pages : [];
}

function pageBlocks(page = {}) {
  return Array.isArray(page.content_blocks) ? page.content_blocks
    : Array.isArray(page.blocks) ? page.blocks : [];
}

function safeAverage(values) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length) : 0;
}

function performance(items = []) {
  const reads = items.reduce((sum, item) => sum + Number(item.reads || 0), 0);
  const shares = items.reduce((sum, item) => sum + Number(item.shares || 0), 0);
  const follows = items.reduce((sum, item) => sum + Number(item.follows_after_read || 0), 0);
  return {
    sample_count: items.length,
    total_reads: reads,
    avg_reads: items.length ? Math.round(reads / items.length) : 0,
    total_shares: shares,
    avg_shares: items.length ? Math.round(shares / items.length) : 0,
    total_follows: follows,
    follows_per_thousand_reads: reads ? Number((follows / reads * 1000).toFixed(2)) : 0,
    metric_ids: items.map((item) => Number(item.metric_id)).filter(Boolean),
  };
}

function confidence(sampleCount) { return sampleCount >= 8 ? 'high' : sampleCount >= 3 ? 'medium' : 'low'; }

function comparison(items, { id, label, test, hypothesis }) {
  const present = items.filter((item) => test(item.features));
  const absent = items.filter((item) => !test(item.features));
  const presentPerformance = performance(present);
  const absentPerformance = performance(absent);
  return {
    id, label, hypothesis, confidence: confidence(present.length),
    sample_count: present.length, coverage_rate: items.length ? Number((present.length / items.length).toFixed(2)) : 0,
    present: presentPerformance, absent: absentPerformance,
    read_delta: presentPerformance.avg_reads - absentPerformance.avg_reads,
    follow_delta: Number((presentPerformance.follows_per_thousand_reads - absentPerformance.follows_per_thousand_reads).toFixed(2)),
  };
}

function compactSample(item) {
  const { features } = item;
  return {
    metric_id: Number(item.metric_id) || null,
    title: String(item.metric_title || item.artifact_title || '').slice(0, 100),
    reads: Number(item.reads || 0),
    shares: Number(item.shares || 0),
    follows_after_read: Number(item.follows_after_read || 0),
    copy: {
      opening: features.copy.opening.slice(0, 100),
      excerpt: features.copy.excerpt,
      chars: features.copy.content_chars,
      paragraphs: features.copy.paragraph_count,
      sections: features.copy.section_count,
      has_cta: features.copy.has_cta,
      has_boundary: features.copy.has_boundary,
      title_hook: features.copy.title_hook,
    },
    storyboard: {
      page_count: features.storyboard.page_count,
      kinds: features.storyboard.kinds,
      pages: features.storyboard.pages,
      missing_roles: features.storyboard.missing_roles,
      avg_blocks_per_page: features.storyboard.avg_blocks_per_page,
      evidence_refs: features.storyboard.evidence_ref_count,
      layout_valid: features.layout.valid,
      layout_issue_count: features.layout.issue_count,
      avg_utilization: features.layout.avg_utilization,
    },
  };
}

export function extractSocialContentFeatures(row = {}) {
  const directory = directoryFor(row.file_path || '');
  const copyContent = directory ? readText(path.join(directory, 'copy.txt')) : '';
  const cardPlan = directory ? readJson(path.join(directory, 'card-plan.json')) || readJson(path.join(directory, 'card-plan-original.json')) : null;
  const layoutReport = directory ? readJson(path.join(directory, 'layout-report.json')) : null;
  const stageExecutions = directory ? readJson(path.join(directory, 'social-card-stage-executions.json')) : null;
  const pages = planPages(cardPlan);
  const copyText = plainText(copyContent);
  const copyParagraphs = paragraphs(copyContent);
  const opening = firstCopyLine(copyContent);
  const firstThreeParagraphs = copyParagraphs.slice(0, 3).join(' ');
  const title = String(row.metric_title || row.artifact_title || '').trim();
  const titleHook = /\d|[?？]|为什么|如何|怎么|谁懂|谁知道|[!！🔥🚀📊]/.test(opening);
  const pageKinds = pages.map((page) => String(page?.kind || '').trim()).filter(Boolean);
  const uniqueKinds = [...new Set(pageKinds)];
  const contentBlockCount = pages.reduce((sum, page) => sum + pageBlocks(page).length, 0);
  const pageTextChars = pages.reduce((sum, page) => sum + pageBlocks(page).reduce((pageSum, block) => pageSum + plainText(block?.content || '').length, 0), 0);
  const evidenceRefCount = pages.reduce((sum, page) => sum + (Array.isArray(page?.evidence) ? page.evidence.length : 0), 0);
  const missingRoles = STORYBOARD_ROLES.filter((role) => !pageKinds.includes(role));
  const reportPages = Array.isArray(layoutReport?.pages) ? layoutReport.pages : [];
  const layoutIssues = reportPages.flatMap((page) => Array.isArray(page?.issues) ? page.issues : []);
  const validPages = reportPages.filter((page) => page?.valid !== false);
  const averageUtilization = safeAverage(reportPages.map((page) => Number(page?.utilization || 0)).filter((value) => value > 0));
  const stageList = Array.isArray(stageExecutions) ? stageExecutions : [];
  const planningSkill = stageList.find((item) => item.stage === 'planning')?.skill || '';
  const copySkill = stageList.find((item) => item.stage === 'generation')?.skill || '';
  return {
    extraction_version: SOCIAL_CONTENT_FEATURE_VERSION,
    artifact_directory: directory,
    files: {
      copy: Boolean(copyContent),
      storyboard: pages.length > 0,
      layout_report: Boolean(layoutReport),
      stage_executions: stageList.length > 0,
    },
    copy: {
      content_chars: copyText.length,
      line_count: copyContent ? copyContent.split(/\r?\n/).length : 0,
      paragraph_count: copyParagraphs.length,
      section_count: countMatches(copyContent, /^(?:#{1,6}\s+|\*\*[^*]+\*\*)/gm),
      bullet_count: countMatches(copyContent, /^\s*(?:[-*•✅❌📌📊📦🎯🚀⚡🗄🔐📧💾🌐]\s+|\d+[.)]\s+)/gm),
      hashtag_count: countMatches(copyText, /#[\w\u4e00-\u9fff-]+/g),
      number_count: countMatches(copyText, /\d+(?:\.\d+)?\s*(?:万|千|个|篇|次|天|小时|分钟|秒|ms|倍|%|％)?/gi),
      question_count: countMatches(copyText, /[?？]|为什么|如何|怎么/g),
      opening,
      excerpt: copyText.slice(0, 900),
      title_hook: titleHook,
      has_problem: /[?？]|为什么|如何|怎么|痛点|还在|担心|头疼|问题/.test(firstThreeParagraphs),
      has_benefit: hasAny(firstThreeParagraphs, BENEFIT_WORDS),
      has_cta: hasAny(copyText, CTA_WORDS),
      has_boundary: hasAny(copyText, BOUNDARY_WORDS),
      title_fulfilled: title ? plainText(`${opening}\n${copyText}`).toLowerCase().includes(plainText(title).toLowerCase().slice(0, 12)) : false,
    },
    storyboard: {
      page_count: pages.length,
      kinds: uniqueKinds,
      kind_sequence: pageKinds,
      pages: pages.slice(0, 10).map((page) => ({
        kind: String(page?.kind || ''), title: String(page?.title || '').slice(0, 100), goal: String(page?.goal || '').slice(0, 160),
        block_types: pageBlocks(page).map((block) => String(block?.type || 'text')).slice(0, 8),
        block_titles: pageBlocks(page).map((block) => String(block?.title || '')).filter(Boolean).slice(0, 8),
      })),
      missing_roles: missingRoles,
      has_narrative_roles: ['cover', 'problem', 'capability'].every((role) => pageKinds.includes(role)),
      has_quickstart: pageKinds.includes('quickstart'),
      has_limitation: pageKinds.includes('limitation'),
      has_ending: pageKinds.includes('ending'),
      cover_has_promise: Boolean(pages[0]?.title && /\d|一键|免费|解决|省|提升|开源|工具|方案/.test(String(pages[0].title))),
      content_block_count: contentBlockCount,
      avg_blocks_per_page: pages.length ? Number((contentBlockCount / pages.length).toFixed(2)) : 0,
      page_text_chars: pageTextChars,
      evidence_ref_count: evidenceRefCount,
      has_evidence_bindings: evidenceRefCount > 0,
      page_count_in_range: pages.length >= 5 && pages.length <= 8,
    },
    layout: {
      report_present: Boolean(layoutReport),
      valid: Boolean(layoutReport) && layoutReport.valid !== false && validPages.length === reportPages.length,
      page_count: reportPages.length,
      issue_count: layoutIssues.length,
      overflow_page_count: reportPages.filter((page) => Number(page?.overflowPixels || 0) > 0 || Number(page?.clippedPixels || 0) > 0).length,
      avg_utilization: averageUtilization,
      underfilled_page_count: reportPages.filter((page) => Number(page?.utilization || 0) > 0 && Number(page?.utilization || 0) < 72).length,
    },
    execution: { storyboard_skill_id: planningSkill, copy_skill_id: copySkill },
  };
}

const COPY_SIGNALS = [
  { id: 'opening_hook', label: '开头有明确钩子', test: (f) => f.copy.title_hook || f.copy.has_problem, hypothesis: '开头更快交代问题、结果或悬念，可能更利于读者继续阅读。' },
  { id: 'early_benefit', label: '前段交代读者收益', test: (f) => f.copy.has_benefit, hypothesis: '前段明确说明能解决什么问题，可能降低读者判断成本。' },
  { id: 'structured_copy', label: '发布文案有分段结构', test: (f) => f.copy.section_count >= 3 || f.copy.bullet_count >= 3, hypothesis: '分段、列表和小标题可能帮助读者快速扫描长文案。' },
  { id: 'boundary_disclosure', label: '文案写明限制或适用边界', test: (f) => f.copy.has_boundary, hypothesis: '边界表达能帮助读者判断内容是否适合自己，也能减少过度承诺。' },
  { id: 'copy_cta', label: '文案有后续行动提示', test: (f) => f.copy.has_cta, hypothesis: '明确的关注、收藏或后续提示可能影响阅读后的行动。' },
];

const STORYBOARD_SIGNALS = [
  { id: 'narrative_roles', label: '故事板具备问题到能力的叙事链', test: (f) => f.storyboard.has_narrative_roles, hypothesis: '先交代问题再解释能力，可能让图文的信息顺序更容易理解。' },
  { id: 'quickstart', label: '故事板包含上手路径', test: (f) => f.storyboard.has_quickstart, hypothesis: '把开始使用的路径单独交代，可能提升内容的可执行性。' },
  { id: 'limitation', label: '故事板包含限制页', test: (f) => f.storyboard.has_limitation, hypothesis: '限制和适用边界可能帮助读者形成更准确的预期。' },
  { id: 'evidence_binding', label: '页面绑定事实证据', test: (f) => f.storyboard.has_evidence_bindings, hypothesis: '页面与事实证据绑定，可能增强内容的可核验性。' },
  { id: 'page_count_in_range', label: '页面数量处于当前常用区间', test: (f) => f.storyboard.page_count_in_range, hypothesis: '页面数量适中可能在信息完整和阅读负担之间取得平衡。' },
  { id: 'layout_valid', label: '布局审计通过且无溢出', test: (f) => f.layout.valid && f.layout.overflow_page_count === 0, hypothesis: '通过布局门禁只能说明交付可用，不代表视觉结构一定带来更好传播。' },
];

function recommendations(copySignals, storyboardSignals) {
  const result = [];
  const bestCopy = [...copySignals].filter((item) => item.sample_count >= 3).sort((a, b) => b.present.avg_reads - a.present.avg_reads)[0];
  const bestStoryboard = [...storyboardSignals].filter((item) => item.sample_count >= 3).sort((a, b) => b.present.avg_reads - a.present.avg_reads)[0];
  if (bestCopy) result.push({ type: 'copy', target: '文案成品', text: `下一轮可优先验证“${bestCopy.label}”，再观察阅读、分享和阅读后关注是否同步变化。`, basis: `${bestCopy.sample_count} 条图文样本`, confidence: bestCopy.confidence });
  if (bestStoryboard) result.push({ type: 'storyboard', target: '故事板', text: `下一轮可优先验证“${bestStoryboard.label}”，同时记录页面顺序和实际内容负担。`, basis: `${bestStoryboard.sample_count} 条图文样本`, confidence: bestStoryboard.confidence });
  return result;
}

export function buildSocialContentFeedbackSnapshot(rows = []) {
  const sourceRows = (Array.isArray(rows) ? rows : []).filter((row) => row && ['confirmed', 'auto_confirmed'].includes(row.status)
    && (row.content_type === 'social' || row.artifact_type === '图文发布文案'));
  const items = sourceRows.map((row) => ({ ...row, title: row.metric_title || row.artifact_title || '', features: extractSocialContentFeatures(row) }));
  const insights = buildWechatInsights(items);
  const copySignals = COPY_SIGNALS.map((signal) => comparison(items, signal));
  const storyboardSignals = STORYBOARD_SIGNALS.map((signal) => comparison(items, signal));
  const featureReady = items.filter((item) => item.features.files.copy || item.features.files.storyboard).length;
  const copyReady = items.filter((item) => item.features.files.copy).length;
  const storyboardReady = items.filter((item) => item.features.files.storyboard).length;
  const layoutReady = items.filter((item) => item.features.files.layout_report).length;
  const dates = items.map((item) => item.published_date).filter(Boolean).sort();
  const copySkillEvidence = [...new Set(items.map((item) => item.features.execution.copy_skill_id).filter(Boolean))].map((skillId) => ({ skill_id: skillId, ...performance(items.filter((item) => item.features.execution.copy_skill_id === skillId)) }));
  const storyboardSkillEvidence = [...new Set(items.map((item) => item.features.execution.storyboard_skill_id).filter(Boolean))].map((skillId) => ({ skill_id: skillId, ...performance(items.filter((item) => item.features.execution.storyboard_skill_id === skillId)) }));
  const unresolved = [];
  if (!items.length) unresolved.push('当前没有已确认的图文复盘样本。');
  if (copyReady < items.length) unresolved.push(`${items.length - copyReady} 条图文缺少 copy.txt，不能纳入文案成品分析。`);
  if (storyboardReady < items.length) unresolved.push(`${items.length - storyboardReady} 条图文缺少 card-plan.json，不能纳入完整故事板分析。`);
  if (layoutReady < items.length) unresolved.push(`${items.length - layoutReady} 条图文缺少 layout-report.json，布局结论只能覆盖部分样本。`);
  if (items.length < 3) unresolved.push('图文成品样本少于 3 条，特征对照只能作为低置信度提示。');
  unresolved.push('文案和故事板特征与阅读、分享、关注是历史相关性，不代表单个特征直接造成表现差异。');
  return {
    extraction_version: SOCIAL_CONTENT_FEATURE_VERSION,
    generated_at: new Date().toISOString(),
    metric_window_start: dates[0] || '', metric_window_end: dates.at(-1) || '',
    linked_social_count: items.length, feature_count: featureReady, copy_ready_count: copyReady, storyboard_ready_count: storyboardReady, layout_ready_count: layoutReady,
    confidence: confidence(items.length),
    topic_signals: insights.topics || [],
    title_signals: insights.title_structures || [],
    copy_summary: {
      avg_chars: safeAverage(items.map((item) => item.features.copy.content_chars).filter(Boolean)),
      avg_paragraphs: safeAverage(items.map((item) => item.features.copy.paragraph_count).filter(Boolean)),
      avg_sections: safeAverage(items.map((item) => item.features.copy.section_count)),
      cta_rate: items.length ? Number((items.filter((item) => item.features.copy.has_cta).length / items.length).toFixed(2)) : 0,
      boundary_rate: items.length ? Number((items.filter((item) => item.features.copy.has_boundary).length / items.length).toFixed(2)) : 0,
    },
    storyboard_summary: {
      avg_pages: safeAverage(items.map((item) => item.features.storyboard.page_count).filter(Boolean)),
      avg_blocks_per_page: items.length ? Number((items.reduce((sum, item) => sum + item.features.storyboard.avg_blocks_per_page, 0) / items.length).toFixed(2)) : 0,
      complete_narrative_rate: items.length ? Number((items.filter((item) => item.features.storyboard.has_narrative_roles).length / items.length).toFixed(2)) : 0,
      evidence_binding_rate: items.length ? Number((items.filter((item) => item.features.storyboard.has_evidence_bindings).length / items.length).toFixed(2)) : 0,
    },
    layout_summary: {
      valid_rate: layoutReady ? Number((items.filter((item) => item.features.layout.valid).length / layoutReady).toFixed(2)) : 0,
      avg_utilization: safeAverage(items.map((item) => item.features.layout.avg_utilization).filter(Boolean)),
      issue_count: items.reduce((sum, item) => sum + item.features.layout.issue_count, 0),
      overflow_page_count: items.reduce((sum, item) => sum + item.features.layout.overflow_page_count, 0),
    },
    copy_signals: copySignals,
    storyboard_signals: storyboardSignals,
    copy_skill_evidence: copySkillEvidence,
    storyboard_skill_evidence: storyboardSkillEvidence,
    samples: [...items].sort((left, right) => Number(right.reads || 0) - Number(left.reads || 0)).slice(0, 20).map(compactSample),
    recommendations: recommendations(copySignals, storyboardSignals),
    unresolved_questions: unresolved,
    source_metric_ids: items.map((item) => Number(item.metric_id)).filter(Boolean),
  };
}
