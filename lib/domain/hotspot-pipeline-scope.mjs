export function isResearchEligibleHotspot(hotspot) {
  if (Number(hotspot?.research_eligible ?? 1) === 0) return false;
  if (String(hotspot?.title || '').trim()) return true;
  try {
    const raw = JSON.parse(hotspot?.raw_json || '{}');
    return Boolean(String(raw.summary || raw.description || '').trim());
  } catch {
    return false;
  }
}
