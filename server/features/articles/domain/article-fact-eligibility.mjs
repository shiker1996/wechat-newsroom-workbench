const CONTENT_CLASSES = new Set(['github_project', 'open_source_technology', 'open_source_trend', 'news_event']);

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizedClass(classification = {}) {
  const value = String(classification.contentClass || classification.content_class || '').trim();
  return CONTENT_CLASSES.has(value) ? value : 'news_event';
}

function verifiedClaims(factBase = {}) {
  return list(factBase.claims).filter((claim) => claim && claim.status === 'verified');
}

function evidenceRoles(classification = {}) {
  return new Set(list(classification.evidence).map((item) => String(item?.role || '').trim()));
}

/**
 * Article fact gate shared by automatic candidates and the final writing entry.
 * Classification decides which evidence is necessary; the model cannot waive it.
 */
export function evaluateArticleFactEligibility({ classification = {}, factBase = null, eventCard = null } = {}) {
  const contentClass = normalizedClass(classification);
  const features = classification.features || classification.classification_features || {};
  const verified = verifiedClaims(factBase || {});
  const roles = evidenceRoles(classification);
  const missing = [];
  if (contentClass === 'github_project') {
    missing.push('纯项目必须先人工晋级为 open_source_technology 或 open_source_trend');
    return { eligible: false, contentClass, verifiedCount: verified.length, missing, status: 'blocked', reason: 'github_project 默认只进入图文路线' };
  }
  if (!factBase) return { eligible: true, contentClass, verifiedCount: null, missing: [], status: 'pending', reason: '' };
  if (!verified.length) missing.push('至少 1 条 status=verified 的事实');
  if (contentClass === 'open_source_technology') {
    const mechanismEvidence = Boolean(features.hasTechnicalDocs || features.hasPaper || features.hasBenchmark)
      || roles.has('technical_mechanism') || roles.has('performance_evidence')
      || list(eventCard?.confirmed_facts).some((fact) => /原理|机制|架构|性能|基准|benchmark|实现/i.test(String(fact)));
    if (!mechanismEvidence) missing.push('技术机制、架构、论文或基准测试证据');
  }
  if (contentClass === 'open_source_trend') {
    const breadthEvidence = Number(features.independentSourceCount) >= 2 || Number(features.subjectCount) >= 2
      || features.hasAdoptionSignal || features.hasMigrationSignal || features.hasCompatibilitySignal
      || features.hasPolicyOrStandardSignal || features.hasTimeline || roles.has('trend_breadth') || roles.has('ecosystem_change')
      || list(eventCard?.timeline).length >= 2;
    if (!breadthEvidence) missing.push('多来源、多主体、跨时间或生态变化证据');
  }
  return {
    eligible: missing.length === 0,
    contentClass,
    verifiedCount: verified.length,
    missing,
    status: missing.length ? 'blocked' : 'ready',
    reason: missing.length ? `文章事实门禁未通过：${missing.join('；')}` : '分类与事实证据满足文章路线最低要求',
  };
}

export function classificationSnapshot(classification = {}) {
  const contentClass = normalizedClass(classification);
  return {
    content_class: contentClass,
    classification_status: String(classification.status || classification.classification_status || 'needs_review'),
    classification_confidence: Number.isFinite(Number(classification.confidence)) ? Number(classification.confidence) : null,
    classification_reason: String(classification.reason || '').trim(),
    classification_evidence: list(classification.evidence),
    classification_features: classification.features || classification.classification_features || {},
    article_eligible: classification.article_eligible !== false && classification.articleEligible !== false && contentClass !== 'github_project',
    article_eligibility_reason: String(classification.article_eligibility_reason || classification.articleEligibilityReason || '').trim(),
  };
}

