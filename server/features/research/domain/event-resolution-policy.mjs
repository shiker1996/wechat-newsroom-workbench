export const EVENT_RESOLUTION_POLICY = Object.freeze({
  autoMergeScore: 82,
  reviewScore: 65,
  maxEntityKeys: 24,
  maxHistoryCandidates: 50,
  staleDuplicatePenalty: 15,
  repeatPenaltyCap: 12,
  repeatPenaltyPerDay: 4,
});

export function duplicatePenaltyForHeat({ state = '', repeatDays = 0 } = {}) {
  if (state === 'stale') return EVENT_RESOLUTION_POLICY.staleDuplicatePenalty;
  return Math.min(
    EVENT_RESOLUTION_POLICY.repeatPenaltyCap,
    Math.max(0, Number(repeatDays || 0) - 1) * EVENT_RESOLUTION_POLICY.repeatPenaltyPerDay,
  );
}
