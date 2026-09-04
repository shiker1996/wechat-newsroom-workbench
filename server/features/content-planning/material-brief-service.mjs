// 素材简报服务：素材提炼结果的确定性派生与三档来源映射。
// 三档来源等级与自定义图文/自主写作共用：author_experience / user_material / model_suggestion，
// 分别对应正文行前缀【体验】/【素材】/【建议】。模型生成的候选一律落到【建议】，
// 只有作者显式确认的真实经历才进入【体验】。

export function selectedMainline(brief = {}, mainlineId) {
  const candidates = Array.isArray(brief.mainlineCandidates) ? brief.mainlineCandidates : [];
  const id = mainlineId || brief.selectedMainlineId;
  return candidates.find((item) => String(item.id) === String(id)) || candidates[0] || null;
}

// 锁定门槛的确定性判断：仅用于“锁定供复用”这个可选动作，不是进入自主写作的前置。
// 目标读者、具体观点由自主写作阶段在对话中提议并由作者确认，因此不计入门槛；
// 只有“明确选择了一条候选主线 + 有素材证据 + 补齐边界”才可锁定，避免把半成品当成可复用命题。
export function materialBriefReadiness(brief = {}) {
  const candidates = Array.isArray(brief.mainlineCandidates) ? brief.mainlineCandidates : [];
  const selectedId = String(brief.selectedMainlineId || '').trim();
  const mainline = selectedId ? candidates.find((item) => String(item.id) === selectedId) || null : null;
  const facts = Array.isArray(brief.factSummary) ? brief.factSummary.filter((item) => item && String(item.text || '').trim()) : [];
  const evidenceRefs = Array.isArray(brief.evidenceRefs) ? brief.evidenceRefs.filter((item) => String(item || '').trim()) : [];
  const missing = Array.isArray(brief.missingEvidence) ? brief.missingEvidence.filter((item) => String(item || '').trim()) : [];
  const flags = [];
  const add = (flag) => { if (!flags.includes(flag)) flags.push(flag); };
  if (!mainline) add('待补主线');
  if (missing.length || (!facts.length && !evidenceRefs.length)) add('待补证据');
  if (mainline && !String(mainline.counter_argument || '').trim() && !missing.length) add('待补边界');
  return { flags, ready: flags.length === 0, mainline };
}

// 简报 → 三档来源点行。已确认作者经历写入【体验】，素材事实写入【素材】，论据方向写入【建议】。
export function materialBriefPointLines(brief = {}, { limit = 24 } = {}) {
  const lines = [];
  const push = (line) => { const text = String(line || '').trim(); if (text && !lines.includes(text)) lines.push(text); };
  if (brief.authorExperienceConfirmed && String(brief.confirmedThesis || '').trim()) push(`【体验】${String(brief.confirmedThesis).trim()}`);
  for (const fact of Array.isArray(brief.factSummary) ? brief.factSummary : []) {
    if (!fact || !String(fact.text || '').trim()) continue;
    push(`【素材】${String(fact.text).trim().slice(0, 900)}`);
  }
  const mainline = selectedMainline(brief);
  for (const arg of Array.isArray(mainline?.argument) ? mainline.argument : []) {
    if (!String(arg || '').trim()) continue;
    push(`【建议】${String(arg).trim().slice(0, 900)}`);
  }
  return lines.slice(0, limit);
}

// 简报的已确认前导信息，用于预填文章/图文表单。
export function materialBriefPrelude(brief = {}) {
  const mainline = selectedMainline(brief);
  return {
    topic: String(brief.confirmedTopic || mainline?.title || '').trim(),
    thesis: String(brief.confirmedThesis || mainline?.thesis || '').trim(),
    audience: String(brief.audience || '').trim(),
    discussionQuestion: String(brief.discussionQuestion || '').trim(),
  };
}

// 锁定门槛提示的文案说明，用于页面提示。
export function readinessHint(flags = []) {
  const hints = {
    待补主线: '还没有选择一条候选主线',
    待补证据: '还缺少素材证据或来源，可先在写作阶段补充',
    待补边界: '可补充适用边界、反例或不确定性，避免结论说死',
  };
  return flags.map((flag) => hints[flag] || flag);
}
