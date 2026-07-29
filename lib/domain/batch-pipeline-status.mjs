export function buildBatchPipelineStatus({ hotspotCount = 0, tagged = 0, total = 0, cardsCount = 0, cardsTotal = 0, latestResearch = null } = {}) {
  const researchDone = latestResearch?.status === 'completed';
  const collectDone = hotspotCount > 0;
  const tagDone = researchDone || (total > 0 && tagged >= total);
  const cardsDone = researchDone || (cardsTotal > 0 && cardsCount >= cardsTotal);
  const steps = {
    collect: { status: collectDone ? 'completed' : 'active' },
    tag: { status: tagDone ? 'completed' : collectDone ? 'active' : 'pending', current: tagged, total },
    eventCards: { status: cardsDone ? 'completed' : tagDone ? 'active' : 'pending', current: cardsCount, total: cardsTotal },
    research: { status: researchDone ? 'completed' : cardsDone ? 'active' : 'pending' },
  };
  if (researchDone) {
    steps.collect.status = 'completed';
    steps.tag.status = 'completed';
    steps.eventCards.status = 'completed';
  }
  return { completed: researchDone, steps };
}
