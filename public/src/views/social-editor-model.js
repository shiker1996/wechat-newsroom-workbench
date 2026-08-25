import { escapeHtml } from '../core/ui.js';

const CARD_ALLOWED_BLOCK_TYPES = ['text', 'list', 'code', 'note', 'stats', 'compare', 'steps', 'timeline', 'scenes', 'highlight'];
const CARD_STRUCTURED_BLOCK_TYPES = new Set(['stats', 'compare', 'steps', 'timeline', 'scenes']);
const CARD_BLOCK_TYPE_LABELS = { text: '正文', list: '列表', code: '代码', note: '提示', stats: '数据卡', compare: '对比卡', steps: '步骤卡', timeline: '时间线', scenes: '场景卡', highlight: '亮点' };
const CUSTOM_TYPE_LABELS = { tutorial: '教程', list: '清单', opinion: '观点' };
const CUSTOM_LEVEL_LABELS = { author_experience: '作者体验', user_material: '用户素材', model_suggestion: '模型建议' };

export function cardBlockTypeOptions(selected) {
  return CARD_ALLOWED_BLOCK_TYPES.map((type) => `<option value="${type}"${type === selected ? ' selected' : ''}>${CARD_BLOCK_TYPE_LABELS[type] || type}</option>`).join('');
}

export function isStructuredCardBlockType(type) {
  return CARD_STRUCTURED_BLOCK_TYPES.has(type);
}

export function cardBlockEditorHtml(block, index) {
  const type = CARD_ALLOWED_BLOCK_TYPES.includes(block?.type) ? block.type : 'text';
  const structured = isStructuredCardBlockType(type);
  const listPayload = type === 'list' && !String(block?.content || '').trim() && Array.isArray(block?.items)
    ? block.items.map((item) => typeof item === 'string' ? item : [item?.title || item?.label || item?.time || item?.date, item?.content || item?.text || item?.description].filter(Boolean).join('：')).filter(Boolean).join('\n')
    : String(block?.content || '');
  const payload = structured ? JSON.stringify({ items: block.items || [], headers: block.headers || [], rows: block.rows || [] }, null, 2) : listPayload;
  const factIds = Array.isArray(block?.fact_ids) ? block.fact_ids.map(String) : [];
  const sourceRefs = Array.isArray(block?.source_refs) ? block.source_refs.map(String) : [];
  const supplementSlot = String(block?.supplement_slot_id || '');
  const provenance = supplementSlot || factIds.length || sourceRefs.length
    ? `<small class="storyboard-block-provenance">${supplementSlot ? `自动补充槽位：${escapeHtml(supplementSlot)}` : '来源内容'}${factIds.length ? ` · ${factIds.length} 条事实候选` : ''}${sourceRefs.length ? ` · ${sourceRefs.length} 个来源` : ''}</small>`
    : '';
  return `<fieldset class="storyboard-block-editor" data-storyboard-block="${index}" data-supplement-slot-id="${escapeHtml(supplementSlot)}" data-fact-ids="${escapeHtml(JSON.stringify(factIds))}" data-source-refs="${escapeHtml(JSON.stringify(sourceRefs))}"><legend>内容块 ${index + 1}<select data-storyboard-block-type>${cardBlockTypeOptions(type)}</select></legend>${provenance}<label>小标题<input data-storyboard-block-title value="${escapeHtml(block.title || '')}"></label><label>${structured ? '结构化内容（JSON）' : '正文'}<textarea data-storyboard-block-content rows="${structured ? 6 : 3}">${escapeHtml(payload)}</textarea></label><button type="button" class="text-button" data-remove-storyboard-block>删除此块</button></fieldset>`;
}

export function isCustomOutput(mode) { return String(mode || '').includes('custom-cards'); }
export function isEventOutput(mode) { return String(mode || '').includes('event-cards'); }
export function socialContentTypeFromOutput(mode, contentClass = '') {
  if (contentClass === 'open_source_technology' || contentClass === 'open_source_trend' || String(mode || '').includes('technology-cards') || String(mode || '').includes('trend-cards')) return 'event';
  if (contentClass === 'github_project' || String(mode || '').includes('tool-cards')) return 'repository';
  if (isCustomOutput(mode)) return 'custom';
  if (isEventOutput(mode)) return 'event';
  return 'repository';
}
export function candidateMode(outputMode, contentClass = '') {
  const type = socialContentTypeFromOutput(outputMode, contentClass);
  return type === 'custom' ? 'custom' : type === 'event' ? 'event' : 'tools';
}

export function socialFactsHtml({ contentType, channelMode, facts, eventAnalysis }) {
  const fact = facts?.data;
  if (contentType === 'event') {
    const analysis = eventAnalysis?.analysis;
    if (!analysis) return '<div class="empty-state">突发事实基座尚未生成。</div>';
    const confirmed = analysis.factBase?.confirmedFacts || [];
    const claims = analysis.factBase?.claims || [];
    const sources = analysis.sources || [];
    return `<div class="repository-fact-grid"><span><b>${sources.filter((item) => item.status === 'ok').length}</b>可用来源</span><span><b>${confirmed.length}</b>确认事实</span><span><b>${claims.length}</b>待核主张</span><span><b>${analysis.sourceAudit?.independentSourceCount || 0}</b>独立来源</span></div><p>${escapeHtml(analysis.eventSummary || '')}</p>${(analysis.sourceAudit?.issues || []).length ? `<ul>${analysis.sourceAudit.issues.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}`;
  }
  if (contentType === 'custom') {
    if (!fact || fact.kind !== 'custom') return '<div class="empty-state">自定义事实基座尚未生成，请重新创建自定义图文。</div>';
    const points = fact.points || [];
    const materials = fact.materials || [];
    const materialsHtml = materials.length ? `<ul>${materials.map((item) => `<li>${escapeHtml(item.url)}（${item.status === 'ok' ? `抓取成功 ${item.content_chars} 字` : `抓取失败：${escapeHtml(item.error || '未知原因')}`}）</li>`).join('')}</ul>` : '';
    return `<div class="repository-fact-grid"><span><b>${escapeHtml(CUSTOM_TYPE_LABELS[fact.content_type] || fact.content_type)}</b>内容类型</span><span><b>${points.length}</b>核心要点</span><span><b>${materials.filter((item) => item.status === 'ok').length}/${materials.length}</b>素材抓取</span><span><b>${channelMode === 'xiaohongshu' ? '小红书' : '公众号'}</b>渠道</span></div><p>${escapeHtml(fact.topic || '')}</p><ul>${points.map((item) => `<li>[${escapeHtml(CUSTOM_LEVEL_LABELS[item.source_level] || item.source_level)}] ${escapeHtml(item.text)}</li>`).join('')}</ul>${materialsHtml}${fact.limitations ? `<small>限制：${escapeHtml(fact.limitations)}</small>` : ''}`;
  }
  if (!fact) return facts?.error ? `<div class="pipeline-error">${escapeHtml(facts.error)}</div>` : contentType === 'event' ? '<div class="empty-state">事件事实基座尚未生成，请先完成事件研判。</div>' : '<div class="empty-state">尚未核验仓库。点击“核验 / 刷新仓库”。</div>';
  return `<div class="repository-fact-grid"><span><b>${Number(fact.stars?.value || 0).toLocaleString()}</b>Stars</span><span><b>${escapeHtml(fact.license?.type || 'UNKNOWN')}</b>License</span><span><b>${escapeHtml(fact.latestRelease?.version || '未发现')}</b>Release</span><span><b>${escapeHtml(fact.maturity || 'unknown')}</b>成熟度</span></div><p>${escapeHtml(fact.description || '仓库未提供简介')}</p><small>核验时间：${escapeHtml(fact.stars?.checkedAt || facts.checked_at || '')}</small>${(fact.warnings || []).length ? `<ul>${fact.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}`;
}

export function socialScoreView(score, contentType) {
  const data = score?.score || {};
  const labels = data.scoreModel === 'g_social-v1'
    ? { factSupport: '事实支撑', visualPotential: '图文表现', readerValue: '读者价值', contentClarity: '内容清晰', productionReadiness: '生产就绪', saturationPenalty: '饱和扣分', riskPenalty: '风险扣分', missingEvidencePenalty: '证据扣分' }
    : contentType === 'event'
    ? { informationDensity: '信息密度', visualNarrative: '视觉叙事', conflictEmotion: '冲突情绪', timeliness: '时效性', audienceRelevance: '受众相关', evidenceCompleteness: '证据完整', singleSource: '单源扣分', unverifiedAllegation: '未核实扣分' }
    : contentType === 'custom' ? {}
      : { toolClarity: '工具明确', scenarioValue: '场景价值', demonstrability: '可演示', visualPotential: '拆页潜力', saveSearchValue: '收藏搜索', sourceCompleteness: '来源完整', factGapPenalty: '事实扣分', permissionRiskPenalty: '权限扣分' };
  return {
    finalScore: data.finalScore ?? '—',
    partsHtml: Object.entries(labels).map(([key, label]) => `<span>${label}<b>${data[key] ?? '—'}</b></span>`).join('') || '<span>自定义图文不参与选题评分</span>',
  };
}
