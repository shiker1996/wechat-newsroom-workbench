const PAGE_BUDGETS = Object.freeze({
  repository: Object.freeze({ recommended: 7, absolute: 12 }),
  event: Object.freeze({ recommended: 10, absolute: 16 }),
  technology: Object.freeze({ recommended: 5, absolute: 10 }),
  trend: Object.freeze({ recommended: 6, absolute: 10 }),
  custom: Object.freeze({ recommended: 10, absolute: 16 }),
});

/**
 * Social 页数分为“内容规划建议”和“渲染安全上限”两层：
 * - recommended 只影响 Prompt、利用率提示和默认推荐页数；
 * - absolute 才是程序硬门禁，超过后阻断但绝不静默截断事实。
 */
export function socialCardPageBudget(contentType = 'repository') {
  const budget = PAGE_BUDGETS[String(contentType || 'repository')] || PAGE_BUDGETS.repository;
  return { contentType: String(contentType || 'repository'), ...budget };
}

export function socialCardPageBudgetStatus(pageCount, contentType = 'repository') {
  const budget = socialCardPageBudget(contentType);
  const count = Math.max(0, Number(pageCount) || 0);
  return {
    ...budget,
    pageCount: count,
    withinRecommended: count <= budget.recommended,
    withinAbsolute: count <= budget.absolute,
    recommendedOverflow: Math.max(0, count - budget.recommended),
    absoluteOverflow: Math.max(0, count - budget.absolute),
  };
}

export function socialCardPageBudgetMessage(pageCount, contentType = 'repository') {
  const status = socialCardPageBudgetStatus(pageCount, contentType);
  if (status.withinAbsolute) return '';
  return `${status.contentType} 图文当前需要 ${status.pageCount} 页，超过绝对安全上限 ${status.absolute} 页；为避免静默丢失事实，已停止生成，请回到故事板合并或重新组织内容。`;
}
