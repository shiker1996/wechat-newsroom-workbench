import { parseModelJson as parseSharedModelJson } from '../../../../platform/llm/model-json.mjs';
import { selectionPrompt } from '../../llm/selection-prompts.mjs';

function parseModelJson(result, store) {
  return parseSharedModelJson(result, { store, label: '研判模型' });
}

export async function brainstorm(gateway, store, selected, account, batchId, provider, onProgress, workspaceRoot) {
  const { prompt: brainstormSystem } = selectionPrompt({ workspaceRoot, skillName: 'hotspot-brainstorm' });
  const cards = [];
  const providerConfig = gateway.config.providers[provider || gateway.config.defaultProvider];
  const candidates = selected.map((item, index) => ({ ...item, candidateId: `C${String(index + 1).padStart(3, '0')}` }));
  async function processGroup(group, label, retry = false) {
    onProgress(`探索脑暴 ${label}（已完成 ${cards.length}/${selected.length}）`);
    const result = await gateway.complete({ provider, purpose: 'hotspot-brainstorm-explore', batchId, jsonMode: true,
      messages: [{ role: 'system', content: brainstormSystem, protected: true },
        { role: 'user', content: `${retry ? '【极简重试】每个字符串不超过40个汉字，严格闭合JSON。\n' : ''}【账号与作者资产】\n${account.map((x) => `${x.label}:\n${x.content}`).join('\n\n')}\n\n【候选】\n${JSON.stringify(group)}`, protected: true }],
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
    for (const raw of parsed.items ?? []) {
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
