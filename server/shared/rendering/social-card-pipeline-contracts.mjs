import fs from 'node:fs';

const SOFT_DENSITY_ISSUES = new Set(['underfilled']);

export function layoutAuditPageSummary(report) {
  return (Array.isArray(report?.pages) ? report.pages : []).map((page) => ({
    page: Number(page?.page) || 0,
    kind: String(page?.kind || ''),
    valid: page?.valid === true,
    utilization: Number.isFinite(Number(page?.utilization)) ? Number(page.utilization) : null,
    issues: Array.isArray(page?.issues) ? page.issues.map(String) : [],
    overflowPixels: Number(page?.overflowPixels) || 0,
    clippedPixels: Number(page?.clippedPixels) || 0,
    horizontalOverflowPixels: Number(page?.horizontalOverflowPixels) || 0,
    acceptedIssues: Array.isArray(page?.acceptedIssues) ? page.acceptedIssues.map(String) : [],
  }));
}

export function buildSocialCardPlannerPageScope(cardPlan = [], plannerPages = []) {
  const pages = Array.isArray(cardPlan) ? cardPlan : [];
  const targetNumbers = new Set((Array.isArray(plannerPages) ? plannerPages : [])
    .map((item) => Number(item?.page)).filter((page) => Number.isInteger(page) && page > 0));
  const scopedNumbers = new Set();
  for (const pageNumber of targetNumbers) {
    for (const candidate of [pageNumber - 1, pageNumber, pageNumber + 1]) {
      if (candidate >= 1 && candidate <= pages.length) scopedNumbers.add(candidate);
    }
  }
  const scopedGroups = new Set([...targetNumbers]
    .map((pageNumber) => pages[pageNumber - 1]?.page_group_id || pages[pageNumber - 1]?.continuation_of)
    .filter(Boolean).map(String));
  pages.forEach((page, index) => {
    const group = page?.page_group_id || page?.continuation_of;
    if (group && scopedGroups.has(String(group))) scopedNumbers.add(index + 1);
  });
  return pages
    .map((page, index) => ({ page, pageNumber: index + 1 }))
    .filter(({ pageNumber }) => scopedNumbers.has(pageNumber))
    .map(({ page, pageNumber }) => ({ ...structuredClone(page), page_number: pageNumber }));
}

export function buildSocialCardPlannerFactScope(factPayload = {}, factIndex = {}, contentComponents = null, scopedPlan = []) {
  const pageCandidates = contentComponents?.pageCandidates && typeof contentComponents.pageCandidates === 'object'
    ? contentComponents.pageCandidates : {};
  const factIds = new Set();
  Object.values(pageCandidates).forEach((scope) => (Array.isArray(scope?.supplements) ? scope.supplements : [])
    .forEach((component) => (component?.factIds || []).forEach((id) => factIds.add(String(id)))));
  scopedPlan.forEach((page) => (Array.isArray(page?.content_blocks) ? page.content_blocks : [])
    .forEach((block) => (block?.fact_ids || []).forEach((id) => factIds.add(String(id)))));
  const candidates = (Array.isArray(factIndex?.candidates) ? factIndex.candidates : [])
    .filter((candidate) => factIds.has(String(candidate.id)))
    .map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      display_label: candidate.display_label,
      display_text: candidate.display_text || null,
      display_text_status: candidate.display_text_status || 'pending',
      source_text: candidate.source_text || candidate.text,
      ...(candidate.display_text ? { text: candidate.display_text } : {}),
      source_refs: candidate.source_refs,
      tags: candidate.tags,
      priority: candidate.priority,
      semantic_intent: candidate.semantic_intent,
    }));
  const repository = [factPayload?.repository, factPayload?.repo, factPayload?.name, factPayload?.title]
    .find((value) => typeof value === 'string' && value.trim());
  return {
    scope: 'target-pages-only',
    repository: repository ? String(repository).slice(0, 240) : '',
    candidate_ids: candidates.map((candidate) => candidate.id),
    candidates,
  };
}

export function softDensityPageIndexes(report) {
  return (Array.isArray(report?.pages) ? report.pages : [])
    .filter((page) => {
      const issues = Array.isArray(page?.issues) ? page.issues.map(String) : [];
      return page?.kind === 'content'
        && issues.includes('underfilled')
        && issues.every((issue) => SOFT_DENSITY_ISSUES.has(issue));
    })
    .map((page) => Number(page.page) - 1)
    .filter((index) => index >= 0);
}

export function acceptSoftDensityOnlyLayoutReport(report, fitContentPages = []) {
  const softIndexes = softDensityPageIndexes(report);
  if (!softIndexes.length) return null;
  const fitValues = fitContentPages === true
    ? softIndexes
    : Array.isArray(fitContentPages) ? fitContentPages : [...(fitContentPages || [])];
  const fitIndexes = new Set(fitValues.map(Number));
  if (!softIndexes.every((index) => fitIndexes.has(index))) return null;
  const softSet = new Set(softIndexes);
  const pages = (Array.isArray(report?.pages) ? report.pages : []).map((page) => {
    const index = Number(page?.page) - 1;
    if (!softSet.has(index)) return page;
    return {
      ...page,
      valid: true,
      issues: (Array.isArray(page.issues) ? page.issues : []).filter((issue) => !SOFT_DENSITY_ISSUES.has(String(issue))),
      acceptedIssues: [...new Set([...(Array.isArray(page.acceptedIssues) ? page.acceptedIssues : []), 'underfilled'])],
    };
  });
  if (pages.some((page) => page?.valid !== true)) return null;
  return { ...report, valid: true, pages, acceptedSoftDensityPages: softIndexes.map((index) => index + 1) };
}

export function adaptiveContentPageIndexes(cardPlan = [], fitContentPages = []) {
  return new Set([
    ...(Array.isArray(cardPlan) ? cardPlan : []).map((page, index) => page?.kind === 'content' || !['cover', 'ending'].includes(String(page?.kind || '')) ? index : -1).filter((index) => index >= 0),
    ...(fitContentPages === true ? [] : Array.isArray(fitContentPages) || fitContentPages instanceof Set ? [...fitContentPages] : []),
  ]);
}

export function templateAuditFailurePayload({ requestedTemplate, renderedTemplate, auditAttempts, report, repairCount, safeCompositionPages, relaxedDensityPages, expandedDensityPages, phaseHistory = [], maxLayoutAttempts, noProgressGuard = null }) {
  return {
    schemaVersion: 1,
    mode: 'strict-template',
    requestedTemplate,
    renderedTemplate,
    maxLayoutAttempts,
    auditAttempts,
    finalReport: { valid: report?.valid === true, pages: layoutAuditPageSummary(report) },
    repairCount,
    safeCompositionPages: [...safeCompositionPages].map((index) => Number(index) + 1).sort((a, b) => a - b),
    relaxedDensityPages: [...relaxedDensityPages].map((index) => Number(index) + 1).sort((a, b) => a - b),
    expandedDensityPages: [...expandedDensityPages].map((index) => Number(index) + 1).sort((a, b) => a - b),
    phaseHistory: Array.isArray(phaseHistory) ? phaseHistory : [],
    noProgressGuard: noProgressGuard || { detected: false, states: [] },
    recordedAt: new Date().toISOString(),
  };
}

export function validateSocialCardDelivery({ html, plan, copy, report, images }) {
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
  return { valid: issues.length === 0, issues, pageCount, pngCount: images.length };
}
