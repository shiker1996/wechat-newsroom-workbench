function text(value) { return String(value ?? '').trim(); }

export function normalizeResearchCoverageResult(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const rawStatus = text(source.status || source.result).toLowerCase().replace(/[-\s]/g, '_');
  const items = Array.isArray(source.items) ? source.items.map((item) => ({
    point_id: text(item?.point_id || item?.id),
    status: text(item?.status || 'omitted').toLowerCase().replace(/[-\s]/g, '_'),
    coverage: text(item?.coverage),
    explanation: text(item?.explanation || item?.reason),
    article_excerpt: text(item?.article_excerpt),
  })) : [];
  const status = rawStatus === 'needs_revision' || rawStatus === 'needsrevision' ? 'needs_revision' : rawStatus === 'skipped' ? 'skipped' : 'pass';
  return {
    status,
    summary: text(source.summary),
    items,
    omitted_points: Array.isArray(source.omitted_points) ? source.omitted_points.map(text).filter(Boolean) : [],
    contradicted_points: Array.isArray(source.contradicted_points) ? source.contradicted_points.map(text).filter(Boolean) : [],
    rejected_point_leakage: Array.isArray(source.rejected_point_leakage || source.rejectedPointLeakage)
      ? (source.rejected_point_leakage || source.rejectedPointLeakage).map((item) => typeof item === 'string' ? text(item) : text(item?.statement || item?.point || item?.reason)).filter(Boolean)
      : [],
    repair_suggestions: Array.isArray(source.repair_suggestions) ? source.repair_suggestions.map(text).filter(Boolean) : [],
  };
}

export function researchCoverageNeedsRevision(report) {
  return report?.status === 'needs_revision'
    || (report?.items || []).some((item) => ['omitted', 'contradicted', 'partial_core'].includes(item.status))
    || (report?.rejected_point_leakage || []).length > 0;
}
