function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function hasMeaningfulCollectedContent(item) {
  if (!item || typeof item !== 'object') return false;
  return [item.title, item.summary, item.description, item.content, item.text, item.selftext]
    .some((value) => text(value));
}

export function filterCollectedItems(items) {
  const kept = [];
  const dropped = [];
  for (const item of Array.isArray(items) ? items : []) {
    (hasMeaningfulCollectedContent(item) ? kept : dropped).push(item);
  }
  return { kept, dropped };
}
