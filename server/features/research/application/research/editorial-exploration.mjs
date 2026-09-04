import { parseModelJson as parseSharedModelJson } from '../../../../platform/llm/model-json.mjs';
import { selectionPrompt } from '../../llm/selection-prompts.mjs';

function parseModelJson(result, store) {
  return parseSharedModelJson(result, { store, label: '研判模型' });
}

const list = (value) => Array.isArray(value) ? value : [];
const text = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function compactResearchItem(item = {}) {
  return {
    event_id: item.event_id,
    signal_id: item.signal_id,
    kind: item.kind,
    status: item.status || item.research_status,
    statement: text(item.statement, 500),
    question: text(item.question, 400),
    expected: text(item.expected, 300),
    observed: text(item.observed, 300),
    gap: text(item.gap, 300),
    parties: list(item.parties).map((value) => text(value, 100)).filter(Boolean).slice(0, 6),
    issue: text(item.issue, 300),
    difference: text(item.difference, 300),
    baseline: text(item.baseline, 300),
    impact: text(item.impact, 400),
    writing_angles: list(item.writing_angles).map((value) => text(value, 240)).filter(Boolean).slice(0, 4),
    thesis_seeds: list(item.thesis_seeds).map((value) => text(value, 240)).filter(Boolean).slice(0, 4),
    evidence_source_ids: list(item.evidence_source_ids).map((value) => text(value, 120)).filter(Boolean).slice(0, 8),
    evidence_levels: list(item.evidence_levels).map((value) => text(value, 40)).filter(Boolean),
  };
}

function researchBasisForCandidate(item = {}) {
  const topic = item.topic_candidate || item.research_context?.topic_candidate || {};
  const context = item.research_context || {};
  const candidateEventIds = new Set([
    ...list(topic.event_ids),
    ...list(item.event_ids),
  ].map((value) => String(value ?? '').trim()).filter(Boolean));
  const signalRefs = new Set(list(topic.internal_signal_refs || topic.signal_refs).map((value) => String(typeof value === 'object' ? value.signal_id || value.id : value)));
  const relationIds = new Set(list(topic.relation_ids).map(String));
  const internalResearch = list(context.internal_signals).flatMap((eventResearch) => {
    const eventId = String(eventResearch?.event_id || '');
    return [
      ...list(eventResearch?.anomalies || eventResearch?.anomaly_points),
      ...list(eventResearch?.conflicts || eventResearch?.interest_conflicts),
      ...list(eventResearch?.divergences || eventResearch?.divergence_directions),
    ].map((signal) => ({ ...signal, event_id: eventId }));
  });
  const selectedSignals = internalResearch
    .filter((signal) => candidateEventIds.has(String(signal.event_id)) && (!signalRefs.size || signalRefs.has(String(signal.signal_id))))
    .map(compactResearchItem)
    .slice(0, 3);
  const allRelations = list(context.relations || context.inter_event_research);
  const selectedRelations = allRelations
    .filter((relation) => {
      const relationEventIds = list(relation.event_ids || relation.reference_event_ids).map(String);
      return relationEventIds.some((eventId) => candidateEventIds.has(eventId))
        && (!relationIds.size || relationIds.has(String(relation.relation_id)));
    })
    .map((relation) => ({
      relation_id: relation.relation_id,
      relation_kind: relation.relation_kind,
      status: relation.status,
      event_ids: list(relation.event_ids).map(String),
      reference_event_ids: list(relation.reference_event_ids).map(String),
      relationship_statement: text(relation.relationship_statement, 600),
      relationship_question: text(relation.relationship_question, 400),
      differences: list(relation.differences).map((value) => text(value, 240)).filter(Boolean).slice(0, 6),
      comparison_basis: list(relation.comparison_basis).slice(0, 6),
      insight: text(relation.insight, 500),
      writing_angles: list(relation.writing_angles).map((value) => text(value, 240)).filter(Boolean).slice(0, 4),
      thesis_seeds: list(relation.thesis_seeds).map((value) => text(value, 240)).filter(Boolean).slice(0, 4),
      refutes: text(relation.refutes, 300),
      evidence_source_ids: list(relation.evidence_source_ids).map((value) => text(value, 120)).filter(Boolean).slice(0, 8),
      evidence_levels: list(relation.evidence_levels).map((value) => text(value, 40)).filter(Boolean),
    }))
    .slice(0, 3);
  const materials = list(context.verified_research_materials)
    .filter((material) => {
      const materialIds = new Set(list(topic.material_ids).map(String));
      const anchorIds = list(material.anchor_event_ids || material.event_ids).map(String);
      return (materialIds.size && materialIds.has(String(material?.material_id)))
        || (!materialIds.size && anchorIds.some((eventId) => candidateEventIds.has(eventId)));
    })
    .map((material) => ({
      material_id: material.material_id,
      material_type: material.material_type,
      status: material.status,
      anchor_event_ids: list(material.anchor_event_ids).map(String),
      relation_kind: material.relation_kind,
      statement: text(material.statement, 600),
      interpretation: text(material.interpretation, 500),
      question: text(material.question, 400),
      writing_angles: list(material.writing_angles).map((value) => text(value, 240)).filter(Boolean).slice(0, 4),
      thesis_seeds: list(material.thesis_seeds).map((value) => text(value, 240)).filter(Boolean).slice(0, 4),
      evidence_source_ids: list(material.evidence_source_ids).map((value) => text(value, 120)).filter(Boolean).slice(0, 8),
      evidence_levels: list(material.evidence_levels).map((value) => text(value, 40)).filter(Boolean),
    }))
    .slice(0, 8);
  const evidenceSourceIds = [...new Set([
    ...list(topic.evidence_source_ids),
    ...selectedSignals.flatMap((signal) => signal.evidence_source_ids),
    ...selectedRelations.flatMap((relation) => relation.evidence_source_ids),
    ...materials.flatMap((material) => material.evidence_source_ids),
  ].map((value) => text(value, 120)).filter(Boolean))].slice(0, 8);
  const selectionReason = list(topic.internal_signal_refs || topic.signal_refs).length
    || list(topic.relation_ids).length
    || list(topic.material_ids).length
    ? 'explicit_candidate_research_ids'
    : 'candidate_event_scoped_research_fallback';
  return {
    rule: '选题只能从以下已验证/待复核研判素材发展；事件卡只作背景，不能替代研判依据。',
    basis_selection_reason: selectionReason,
    material_ids: materials.map((material) => String(material.material_id || '')).filter(Boolean),
    internal_signal_refs: selectedSignals.map((signal) => String(signal.signal_id || '')).filter(Boolean),
    relation_ids: selectedRelations.map((relation) => String(relation.relation_id || '')).filter(Boolean),
    evidence_source_ids: evidenceSourceIds,
    internal_research: selectedSignals,
    inter_event_research: selectedRelations,
    verified_research_materials: materials,
    evidence_boundary: text(context.evidence_boundary, 500) || null,
  };
}

export async function brainstorm(gateway, store, selected, account, batchId, provider, onProgress, workspaceRoot) {
  const { prompt: brainstormSystem } = selectionPrompt({ workspaceRoot, skillName: 'hotspot-brainstorm' });
  const cards = [];
  const providerConfig = gateway.config.providers[provider || gateway.config.defaultProvider];
  // 候选选题现在可能来自模型研判（candidate_id=MR-T-xxx），也可能来自旧的程序候选。
  // 对外仍给探索模型稳定的 Cxxx 编号，但匹配返回时同时接受服务端候选 ID，避免把有效结果误判为空。
  const candidates = selected.map((item, index) => ({
    ...item,
    candidateId: `C${String(index + 1).padStart(3, '0')}`,
    research_basis: researchBasisForCandidate(item),
    candidateAliases: [...new Set([item.candidateId, item.candidate_id, item.eventId].map((value) => String(value ?? '').trim()).filter(Boolean))],
  }));
  const compactAccount = account.map((entry) => ({
    label: text(entry?.label, 80),
    content: text(entry?.content, entry?.label === '账号上下文' ? 5000 : 3500),
  }));
  const candidateForOutput = (raw, group) => {
    const outputId = String(raw?.candidateId || raw?.candidate_id || raw?.id || '').trim();
    return group.find((item) => item.candidateId === outputId || item.candidateAliases.includes(outputId)) || null;
  };
  async function processGroup(group, label, retry = false) {
    onProgress(`探索脑暴 ${label}（已完成 ${cards.length}/${selected.length}）`);
    const promptCandidates = group.map((candidate) => ({
      candidateId: candidate.candidateId,
      candidate_id: candidate.candidate_id,
      title: text(candidate.title || candidate.hotspot_title, 260),
      category: text(candidate.category, 80),
      poolRole: text(candidate.poolRole, 40),
      event_ids: list(candidate.event_ids).map((value) => text(value, 100)).filter(Boolean).slice(0, 6),
      topic_type: text(candidate.topic_type || candidate.topic_candidate?.topic_type, 60),
      angle: text(candidate.angle, 260),
      thesis: text(candidate.thesis, 260),
      riskLevel: text(candidate.riskLevel, 40),
      research_basis: candidate.research_basis || researchBasisForCandidate(candidate),
    }));
    const result = await gateway.complete({ provider, purpose: 'hotspot-brainstorm-explore', batchId, jsonMode: true,
       messages: [{ role: 'system', content: brainstormSystem, protected: true },
        { role: 'user', content: `${retry ? '【极简重试】每个字符串不超过40个汉字，严格闭合JSON。\n' : ''}【账号与作者资产】\n${compactAccount.map((x) => `${x.label}:\n${x.content}`).join('\n\n')}\n\n【脑暴输入规则】\n只允许基于每条候选中的 research_basis 生成角度、命题和包装。research_basis 为空，或其中没有任何研判报告/研判素材时，不得把事件卡摘要自行改造成选题；应返回 NO_ANGLE，并说明缺少研判依据。候选本身未回填 material_ids、internal_signal_refs 或 relation_ids，不等于没有研判依据；只要 research_basis 中存在对应报告或素材即可继续脑暴。候选标题只是研判阶段的临时种子，不是新的事实来源。\n\n【候选】\n${JSON.stringify(promptCandidates)}`, protected: true }],
      maxOutputTokens: Math.min(6500, providerConfig.maxOutputTokens) });
    let parsed;
    try { parsed = parseModelJson(result, store); }
    catch (error) {
      if (group.length > 1) {
        const middle = Math.ceil(group.length / 2);
        onProgress(`脑暴输出被截断；自动拆分为 ${middle} + ${group.length - middle} 条重试`);
        await processGroup(group.slice(0, middle), `${label}.1`);
        await processGroup(group.slice(middle), `${label}.2`);
        return;
      }
      if (!retry) {
        onProgress('单张分析卡仍过长，切换极简结构重试');
        await processGroup(group, `${label}.R`, true);
        return;
      }
      const candidate = group[0];
      store.recordPipelineFailure?.({ batchId, stage: 'research', objectType: 'brainstorm-card', objectKey: candidate?.candidateId || label,
        title: candidate?.title || candidate?.hotspot_title || '', errorCode: 'invalid_output', errorMessage: error.message, detail: { label, retry: true } });
      onProgress(`单张分析卡 ${candidate?.candidateId || label} 失败，已记录并继续其余候选`);
      return;
    }
    const outputItems = Array.isArray(parsed?.items) ? parsed.items : [];
    const matchedItems = outputItems.map((raw) => {
      const source = candidateForOutput(raw, group);
      return source ? { ...raw, candidateId: source.candidateId } : null;
    }).filter(Boolean);
    if (!matchedItems.length) {
      const reason = '模型返回的 items 为空，或 candidateId 与输入候选不匹配';
      if (!retry) {
        onProgress('脑暴返回空候选，切换极简结构重试');
        await processGroup(group, `${label}.R`, true);
        return;
      }
      const candidate = group[0];
      store.recordPipelineFailure?.({ batchId, stage: 'research', objectType: 'brainstorm-card', objectKey: candidate?.candidateId || label,
        title: candidate?.title || candidate?.hotspot_title || '', errorCode: 'empty_output', errorMessage: reason, detail: { label, retry: true, outputItemCount: outputItems.length } });
      onProgress(`单张分析卡 ${candidate?.candidateId || label} 返回空候选，已记录并继续其余候选`);
      return;
    }
    for (const raw of matchedItems) {
      const source = group.find((item) => item.candidateId === raw.candidateId);
      if (source) cards.push({ ...raw, source });
    }
  }
  for (let i = 0; i < candidates.length; i += 2) {
    await processGroup(candidates.slice(i, i + 2), `${Math.floor(i / 2) + 1}/${Math.ceil(candidates.length / 2)}`);
  }
  return cards;
}

export function breakingSynthesis(cards) {
  return {
    items: cards.map((card) => {
      const readerStakeScore = Number(card.packaging?.readerStakeScore ?? card.bScores?.readerStakeScore ?? card.bScores?.audienceRelevance ?? 0);
      return { candidateId: card.candidateId, saturationPenalty: 0, readerStakeScore, audienceRelevance: readerStakeScore, reason: '突发单题不参与批次竞争' };
    }),
    metaNarratives: [],
    combination: {},
  };
}

export async function synthesize(gateway, store, cards, batchId, provider, onProgress, workspaceRoot) {
  const { prompt: synthesisSystem } = selectionPrompt({ workspaceRoot, skillName: 'hotspot-synthesis' });
  onProgress('执行全局竞争、受众与重复扫描');
  const compact = cards.map((card) => ({ candidateId: card.candidateId, title: card.source.title, category: card.source.category,
    poolRole: card.source.poolRole, angle: card.angle, thesis: card.thesis, packaging: card.packaging, bScores: card.bScores, riskLevel: card.source.riskLevel }));
  const providerConfig = gateway.config.providers[provider || gateway.config.defaultProvider];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await gateway.complete({ provider, purpose: 'hotspot-synthesis-provisional', batchId, jsonMode: true,
      maxOutputTokens: Math.min(5000, providerConfig.maxOutputTokens), messages: [{ role: 'system', content: synthesisSystem, protected: true },
        { role: 'user', content: `${attempt ? '极简重试：reason缩短到20字。\n' : ''}${JSON.stringify(compact)}`, protected: true }] });
    try { return parseModelJson(result, store); }
    catch (error) { if (attempt) throw error; onProgress('综合复排输出被截断，切换极简结构重试'); }
  }
}
