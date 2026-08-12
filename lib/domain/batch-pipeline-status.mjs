export function buildBatchPipelineStatus({ hotspotCount = 0, tagged = 0, total = 0, cardsCount = 0, cardsTotal = 0, latestResearch = null, failures = [] } = {}) {
  const pending=new Set(failures.filter((item)=>item.status==='open'||item.status==='retrying').map((item)=>item.stage));
  const researchDone = latestResearch?.status === 'completed';
  const collectDone = hotspotCount > 0 && !pending.has('collect');
  const tagDone = !pending.has('collect')&&!pending.has('tag')&&(researchDone || (total > 0 && tagged >= total));
  const cardsDone = !pending.has('collect')&&!pending.has('tag')&&!pending.has('event-card')&&(researchDone || (cardsTotal > 0 && cardsCount >= cardsTotal));
  const steps = {
    collect: { status: collectDone ? 'completed' : 'active' },
    tag: { status: tagDone ? 'completed' : collectDone ? 'active' : 'pending', current: tagged, total },
    eventCards: { status: cardsDone ? 'completed' : tagDone ? 'active' : 'pending', current: cardsCount, total: cardsTotal },
    research: { status: researchDone ? 'completed' : cardsDone ? 'active' : 'pending' },
  };
  if (researchDone&&!pending.size) {
    steps.collect.status = 'completed';
    steps.tag.status = 'completed';
    steps.eventCards.status = 'completed';
  }
  return { completed: researchDone, steps };
}
