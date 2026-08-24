function itemCount(block = {}) {
  if (block.type === 'list' && Array.isArray(block.items)) return block.items.length;
  if (block.type === 'compare' && Array.isArray(block.rows)) return block.rows.length;
  if (Array.isArray(block.items)) return block.items.length;
  return block.content ? 1 : 0;
}

function pageSummary(page = {}, pageNumber = 0) {
  return {
    page: pageNumber,
    title: String(page.title || '').trim(),
    kind: page.kind || 'content',
    role: page.role || '',
    pageGroupId: page.page_group_id || '',
    continuationOf: Number(page.continuation_of) || null,
    continuationIndex: Number(page.continuation_index) || null,
    blocks: (Array.isArray(page.content_blocks) ? page.content_blocks : []).map((block) => ({
      type: block?.type || 'text',
      title: String(block?.title || '').trim(),
      itemCount: itemCount(block),
    })),
  };
}

/**
 * Builds a compact, UI-safe description of a storyboard structure change.
 * It deliberately contains no raw facts or generated copy; only page/block
 * structure is exposed so the editor can preview what will be re-rendered.
 */
export function buildSocialCardReflowPreview({ beforePlan = [], afterPlan = [], operations = [] } = {}) {
  const before = Array.isArray(beforePlan) ? beforePlan : [];
  const after = Array.isArray(afterPlan) ? afterPlan : [];
  const affected = [];
  const addedPages = [];
  for (const operation of Array.isArray(operations) ? operations : []) {
    const sourcePage = Number(operation?.page);
    const groups = Array.isArray(operation?.groups) ? operation.groups : [];
    const start = Math.max(0, sourcePage - 1);
    const summaries = groups.map((_, index) => pageSummary(after[start + index], start + index + 1));
    affected.push({ sourcePage, operation: operation?.op || '', pageCount: summaries.length, pages: summaries });
    addedPages.push(...summaries.slice(1));
  }
  return {
    type: 'storyboard-restructure',
    beforePageCount: before.length,
    afterPageCount: after.length,
    pageDelta: after.length - before.length,
    operationCount: Array.isArray(operations) ? operations.length : 0,
    affectedPages: affected,
    addedPages,
    requiresRegeneration: true,
    htmlUpdated: false,
    pngUpdated: false,
  };
}

export { pageSummary as summarizeSocialCardReflowPage };
