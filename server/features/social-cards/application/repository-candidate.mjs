import { parseRepositoryUrl } from '../../../platform/integrations/repository-url.mjs';

// 手动添加仓库图文候选：仓库 URL → 手工热点 → social_cards 候选（工具图文通道）。
// 与管线自动产生的仓库候选同构，后续「仓库核验 → 故事板 → 生成」流程完全复用。
export function createRepositoryCandidate({ store, batchId, url, channel }) {
  const parsed = parseRepositoryUrl(url);
  if (!parsed) throw new Error('请输入有效的 GitHub 仓库地址（https://github.com/owner/repo）');
  const outputMode = String(channel || '').trim() === 'xiaohongshu' ? 'xiaohongshu-tool-cards' : 'wechat-tool-cards';
  const hotspot = store.addManualHotspot(batchId, {
    title: parsed.repository,
    url: parsed.sourceUrl,
    materialUrls: [parsed.sourceUrl],
    notes: '手动添加仓库',
    researchEligible: false,
  });
  if (!hotspot) throw new Error('手工热点创建失败');
  store.addCandidates(batchId, [hotspot.id], { tracks: ['social_cards'] });
  const candidate = store.listCandidates(batchId, 'social_cards').find((item) => Number(item.hotspot_id) === Number(hotspot.id));
  if (!candidate) throw new Error('仓库图文候选创建失败');
  store.updateCandidate(candidate.id, { angle: parsed.repository, thesis: parsed.repository });
  store.updateCandidateTrack(candidate.id, 'social_cards', { status: 'pooled', pool_role: '工具图文', output_mode: outputMode });
  store.saveCardEditorial(candidate.id, { ...store.getCardEditorial(candidate.id), output_mode: outputMode, status: 'DISCUSS' });
  return store.getCandidate(candidate.id);
}
