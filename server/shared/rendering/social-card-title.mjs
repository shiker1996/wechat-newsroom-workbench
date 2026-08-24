/**
 * Normalize a storyboard page title for the compact card heading.
 * Cover titles are intentionally left intact because they have a separate
 * semantic line-breaking flow; content/ending pages keep only the core title
 * before an explanatory colon clause.
 */
export const SOCIAL_CARD_PAGE_TITLE_MAX_CHARS = 14;

export function normalizeSocialCardPageTitle(value, { kind = 'content' } = {}) {
  let title = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!title || kind === 'cover') return title;
  const separator = title.search(/[：:]/);
  if (separator >= 2) title = title.slice(0, separator).trim();
  title = title.replace(/[，,；;。.!！?？]+$/u, '').trim();
  return title;
}
