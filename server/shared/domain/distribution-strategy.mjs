export const DISTRIBUTION_LANES = Object.freeze(['推荐池', '通知池', '实验池']);

export const DEFAULT_NOTIFICATION_POLICY = Object.freeze({
  minimumNotificationFit: 4,
  minimumFactSupport: 4,
  maxPerBatch: 2,
  blockedRiskLevels: Object.freeze(['高', '较高']),
  readerStakes: Object.freeze(['工作', '收入', '岗位', '效率', '成本', '选择']),
  uncertaintyMarkers: Object.freeze(['传闻', '未经证实', '未证实', '尚未确认', '待核实', '待核验', '需要官方确认', '需要官方回应', '缺少官方回应', '更多可靠报道']),
});

export function normalizeDistributionLane(value, fallback = '推荐池') {
  const lane = String(value || '').trim();
  return DISTRIBUTION_LANES.includes(lane) ? lane : fallback;
}

function finiteNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function resolveNotificationPolicy(context = {}) {
  const source = context?.notificationPolicy && typeof context.notificationPolicy === 'object'
    ? context.notificationPolicy : context;
  const list = (value, fallback) => Array.isArray(value) && value.length
    ? value.map((item) => String(item).trim()).filter(Boolean) : [...fallback];
  return {
    minimumNotificationFit: Math.max(0, Math.min(5, finiteNumber(source?.minimumNotificationFit, DEFAULT_NOTIFICATION_POLICY.minimumNotificationFit))),
    minimumFactSupport: Math.max(0, Math.min(5, finiteNumber(source?.minimumFactSupport, DEFAULT_NOTIFICATION_POLICY.minimumFactSupport))),
    maxPerBatch: Math.max(0, Math.floor(finiteNumber(source?.maxPerBatch, DEFAULT_NOTIFICATION_POLICY.maxPerBatch))),
    blockedRiskLevels: list(source?.blockedRiskLevels, DEFAULT_NOTIFICATION_POLICY.blockedRiskLevels),
    readerStakes: list(source?.readerStakes, DEFAULT_NOTIFICATION_POLICY.readerStakes),
    uncertaintyMarkers: list(source?.uncertaintyMarkers, DEFAULT_NOTIFICATION_POLICY.uncertaintyMarkers),
  };
}

export function isConcreteReaderStake(value, context = {}) {
  const stake = String(value || '').replace(/\s+/g, '').trim();
  if (!stake) return false;
  const policy = resolveNotificationPolicy(context);
  const hasAudience = /开发者|程序员|工程师|技术团队|从业者|员工|用户|管理者/.test(stake);
  const stakeTerms = [...policy.readerStakes, '薪资', '职位', '预算', '费用', '选型', '权限', '兼容', '发布', '部署'];
  const hasStake = stakeTerms.some((term) => term && stake.includes(term));
  const hasConcreteChange = /需|需要|必须|应当|应在|将无法|会增加|会减少|会导致|可节省|迁移|调整|停止|改用|升级|降级|支付|裁撤|招聘|涨薪|降薪|下线|失效|受限|中断|截止/.test(stake);
  return hasAudience && hasStake && hasConcreteChange;
}

export function resolveDistributionDecision(input = {}, context = {}) {
  const policy = resolveNotificationPolicy(context);
  const requestedLane = normalizeDistributionLane(input.distributionLane ?? input.distribution_lane);
  const readerStake = String(input.readerStake ?? input.reader_stake ?? '').trim();
  const rawFit = Number(input.notificationFit ?? input.notification_fit);
  const notificationFit = Number.isFinite(rawFit) ? Math.max(0, Math.min(5, rawFit)) : 0;
  const notificationReason = String(input.notificationReason ?? input.notification_reason ?? '').trim();
  const rawFactSupport = Number(input.factSupport ?? input.fact_support ?? input.bScores?.factSupport);
  const factSupport = Number.isFinite(rawFactSupport) ? Math.max(0, Math.min(5, rawFactSupport)) : 0;
  const riskLevel = String(input.riskLevel ?? input.risk_level ?? '').trim();
  const evidenceText = [input.title, input.angle, input.thesis, input.evidenceBoundary,
    input.materialGaps, input.packaging?.materialGaps, input.riskReason, input.risk_reason]
    .map((value) => String(value || '')).join(' ');
  const notificationBlockers = [];
  const strongUncertainty = /传闻|未经证实|未证实|尚未确认|需要官方确认|需要官方回应|缺少官方回应|更多可靠报道/.test(evidenceText);
  if (policy.blockedRiskLevels.includes(riskLevel)) notificationBlockers.push('risk-level-blocked');
  if (strongUncertainty) notificationBlockers.push('material-uncertainty');
  if (requestedLane === '通知池') {
    if (!isConcreteReaderStake(readerStake, policy)) notificationBlockers.push('reader-stake-not-specific');
    if (notificationFit < policy.minimumNotificationFit) notificationBlockers.push('notification-fit-below-minimum');
    if (factSupport < policy.minimumFactSupport) notificationBlockers.push('fact-support-below-minimum');
    if (policy.uncertaintyMarkers.some((marker) => marker && evidenceText.includes(marker))) notificationBlockers.push('material-uncertainty');
  }
  const uniqueBlockers = [...new Set(notificationBlockers)];
  const notificationEligible = uniqueBlockers.length === 0;
  return {
    requestedLane,
    distributionLane: notificationEligible ? requestedLane : '实验池',
    readerStake,
    notificationFit,
    factSupport,
    riskLevel,
    notificationReason,
    notificationEligible,
    notificationBlockers: uniqueBlockers,
  };
}

export function enforceNotificationQuota(items = [], context = {}) {
  const policy = resolveNotificationPolicy(context);
  let used = 0;
  return items.map((item) => {
    if (item.distributionLane !== '通知池') return item;
    used += 1;
    if (used <= policy.maxPerBatch) return item;
    return {
      ...item,
      distributionLane: '实验池',
      notificationEligible: false,
      notificationBlockers: [...new Set([...(item.notificationBlockers || []), 'batch-notification-quota'])],
    };
  });
}
