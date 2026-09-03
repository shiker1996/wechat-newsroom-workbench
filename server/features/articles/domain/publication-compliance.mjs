const HIGH_IMPACT_DEFINITIONS = Object.freeze([
  { category: 'financial', label: '财经/资本市场', pattern: /IPO|上市|估值|融资|募资|市值|破产|债务|清算|投资回报|回购/i },
  { category: 'reputation', label: '名誉/负面指控', pattern: /诈骗|造假|违法|违规|骗局|跑路|欺诈|行贿|贿赂|侵占|偷税|割韭菜|压榨|剥削|性骚扰|霸凌|犯罪/i },
  { category: 'sensitive_event', label: '伤害/敏感事件', pattern: /伤亡|死亡|自杀|事故|灾难|暴力|未成年人|个人隐私|隐私泄露/i },
  { category: 'sensational', label: '绝对化/煽动性表述', pattern: /最后一次|梦碎|彻底失败|必然|一定会|注定|崩盘|毁灭|惊天|实锤/i },
]);

const NUMBER_PATTERN = /\d+(?:\.\d+)?\s*(?:万亿美元|亿美元|万亿|亿元|万元|万美元|人民币|元|亿|美元|%|％)/g;

function text(value) { return String(value ?? '').trim(); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }

export function extractArticleTitle(article = '') {
  return text(text(article).match(/^#\s+(.+)$/m)?.[1] || '');
}

function claimText(item) {
  if (typeof item === 'string') return text(item);
  return text(item?.claim || item?.text || item?.statement);
}

function claimsOf(factBase = {}) {
  return Array.isArray(factBase?.claims) ? factBase.claims : [];
}

function verifiedClaims(factBase = {}) {
  return claimsOf(factBase).filter((item) => item && item.status === 'verified');
}

function normalizedClaimCorpus(factBase = {}) {
  return verifiedClaims(factBase).map(claimText).filter(Boolean).join('\n').replace(/\s+/g, '');
}

function numberTokens(value) {
  return [...text(value).matchAll(NUMBER_PATTERN)].map((match) => text(match[0]).replace(/\s+/g, ''));
}

export function buildPublicationClaimRegister(factBase = {}) {
  return claimsOf(factBase).map((item, index) => {
    const claim = claimText(item);
    const status = text(item?.status || (typeof item === 'string' ? 'unverified' : 'unverified')) || 'unverified';
    return {
      id: text(item?.id) || `claim-${index + 1}`,
      claim,
      status,
      evidence: text(item?.evidence),
      sourceUrl: text(item?.sourceUrl || item?.source_url),
      sourceTitle: text(item?.sourceTitle || item?.source_title),
      sourceType: text(item?.sourceType || item?.source_type),
      publishedAt: text(item?.publishedAt || item?.published_at),
      boundary: text(item?.boundary),
      publicationRule: status === 'verified' ? '可作为确定事实，但仍需保留来源归因' : '不得作为确定事实；只能降格、归因或删除',
    };
  }).filter((item) => item.claim);
}

export function publicationFactBaseIssues(factBase = {}) {
  return claimsOf(factBase).filter((item) => {
    if (!item || item.status !== 'verified') return false;
    const claim = claimText(item);
    const highImpact = HIGH_IMPACT_DEFINITIONS.some((definition) => ['financial', 'reputation', 'sensitive_event'].includes(definition.category) && definition.pattern.test(claim));
    if (!highImpact) return false;
    const sourceUrl = text(item.sourceUrl || item.source_url);
    const sourceType = text(item.sourceType || item.source_type);
    const evidence = text(item.evidence);
    return !sourceUrl && !/用户提供|内部材料/.test(`${sourceType} ${evidence}`);
  }).map((item) => `高影响事实“${claimText(item)}”已标为 verified，但没有直接来源 URL`);
}

export function scanPublicationRisk({ article = '', title = '', factBase = {} } = {}) {
  const articleText = text(article);
  const titleText = text(title) || extractArticleTitle(articleText);
  const leadText = articleText.split(/\n\s*\n/).slice(0, 3).join('\n').slice(0, 700);
  const verifiedCorpus = normalizedClaimCorpus(factBase);
  const indicators = [];

  for (const region of [
    { name: 'title', value: titleText },
    { name: 'lead', value: leadText },
    { name: 'body', value: articleText },
  ]) {
    for (const definition of HIGH_IMPACT_DEFINITIONS) {
      if (!definition.pattern.test(region.value)) continue;
      indicators.push({ region: region.name, category: definition.category, label: definition.label });
    }
  }

  const titleNumbers = numberTokens(titleText);
  const unsupportedTitleNumbers = titleNumbers.filter((value) => !verifiedCorpus.includes(value));
  const titleDefinitions = HIGH_IMPACT_DEFINITIONS.filter((definition) => definition.pattern.test(titleText));
  const unsupportedTitleCategories = titleDefinitions
    .filter((definition) => !verifiedCorpus || !definition.pattern.test(verifiedCorpus))
    .map((definition) => definition.category);

  const titleBlockers = unique([
    ...unsupportedTitleNumbers.map((value) => `标题数字“${value}”未出现在已核验事实中`),
    ...unsupportedTitleCategories
      .filter((category) => category === 'financial' || category === 'reputation')
      .map((category) => `标题包含${category === 'financial' ? '财经/资本市场' : '名誉负面'}高影响主张，但事实基座没有对应已核验事实`),
  ]);

  return {
    title: titleText,
    categories: unique(indicators.map((item) => item.category)),
    indicators: indicators.slice(0, 24),
    titleNumbers,
    unsupportedTitleNumbers,
    titleBlockers,
    requiresModelReview: indicators.length > 0,
    requiresHumanConfirmation: titleDefinitions.some((definition) => ['financial', 'reputation', 'sensitive_event'].includes(definition.category)),
  };
}

export function publicationCompliancePrompt({ factBase = {}, claimRegister = [], scan = {} } = {}) {
  return `发布合规专项要求：
- 不能把传闻、匿名爆料、单方说法、模型推断或搜索摘要写成确定事实。
- IPO、上市、估值、融资、破产、违法、诈骗、造假、压榨、性骚扰等高影响主张，必须检查直接证据、来源质量、日期和归因；证据不足时必须删除、降格或停止发布。
- 标题、摘要和前 200 字单独审核；正文中的限定语不能自动修复一个已经把传闻写成事实的标题。
- 不能用“最后一次”“梦碎”“彻底失败”“必然”等绝对化或贬损化表达制造冲突，除非它是明确归因的原话且不会误导读者。
- 争议内容应分别呈现各方说法，明确“谁说的”和“是否得到独立确认”；不要推断公司或个人动机。

程序风险扫描（只作为需要重点核查的信号，不是程序对文章的最终定性）：
${JSON.stringify(scan)}

可用的事实主张登记：
${JSON.stringify(claimRegister)}

请把风险问题写入门禁 issues，并区分：publication_compliance、fact、title、citation、reputation、financial、privacy、copyright。高影响事实无法核验时不得返回 pass。`;
}

export function publicationComplianceIssue({ scan = {}, gate = {} } = {}) {
  const issues = [];
  for (const blocker of scan.titleBlockers || []) issues.push(blocker);
  if (gate && gate.pass === false) {
    for (const issue of Array.isArray(gate.issues) ? gate.issues : []) {
      const value = typeof issue === 'string' ? issue : issue?.message;
      if (value) issues.push(value);
    }
  }
  return unique(issues);
}
