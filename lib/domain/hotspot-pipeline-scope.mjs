export function isResearchEligibleHotspot(hotspot) {
  return Number(hotspot?.research_eligible ?? 1) !== 0;
}
