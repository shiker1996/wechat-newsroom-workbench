import { fetchUrlContent } from '../../../platform/integrations/source-fetcher.mjs';
import { CUSTOM_CONTENT_TYPES, CUSTOM_SOURCE_LEVELS } from '../domain/social-card-gate.mjs';

// 自定义图文事实基座（待办 1+6 设计评审拍板：复用 repository_fact_sheets 表，data_json 带 kind:'custom'）
// 体验真实性三来源等级贯穿：每条要点必须标注 author_experience / user_material / model_suggestion，
// 故事板与文案阶段只允许把 author_experience 写成亲历，model_suggestion 不得写成亲测。

const LEVEL_PREFIX = { '体验':'author_experience', '素材':'user_material', '建议':'model_suggestion' };

export function customSourceUrl(candidateId) { return `custom://${candidateId}`; }

export function parsePointLine(line) {
  const text = String(line || '').trim();
  if (!text) return null;
  const match = text.match(/^【(体验|素材|建议)】\s*/);
  const sourceLevel = match ? LEVEL_PREFIX[match[1]] : 'model_suggestion';
  const body = match ? text.slice(match[0].length).trim() : text;
  if (!body) return null;
  const urlMatch = body.match(/(https?:\/\/[^\s]+)\s*$/);
  return { text: urlMatch ? body.slice(0, urlMatch.index).trim() : body, source_level: sourceLevel, source_url: urlMatch ? urlMatch[1] : '' };
}

export function parseLines(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.replace(/^[-*•\d.、)\s]+/, '').trim()).filter(Boolean);
}

export async function buildCustomFactSheet({ input, root, fetchImpl = fetchUrlContent, hasUserMaterialContext = false, materialCache = null }) {
  const contentType = String(input.content_type || '').trim();
  if (!CUSTOM_CONTENT_TYPES[contentType]) throw new Error('内容类型必须是 tutorial（教程）/ list（清单）/ opinion（观点）之一');
  const topic = String(input.topic || '').trim();
  if (!topic) throw new Error('主题不能为空');
  const rawPoints = Array.isArray(input.points) ? input.points : parseLines(input.points);
  const points = rawPoints.map((item) => (typeof item === 'string' ? parsePointLine(item) : {
    text: String(item?.text || '').trim(),
    source_level: String(item?.source_level || '').trim(),
    source_url: String(item?.source_url || '').trim(),
  })).filter((item) => item?.text);
  for (const point of points) {
    if (!CUSTOM_SOURCE_LEVELS[point.source_level]) throw new Error(`要点「${point.text.slice(0, 20)}…」的来源等级无效：${point.source_level || '未填写'}`);
  }
  if (points.length < 3) throw new Error('核心要点至少需要 3 条（每行一条，可用【体验】/【素材】/【建议】前缀标注来源等级）');
  if (!points.some((item) => item.source_level !== 'model_suggestion') && !hasUserMaterialContext) throw new Error('至少需要一条要点来自作者真实体验（【体验】）或用户提供素材（【素材】）');
  const materialUrls = [...new Set((Array.isArray(input.materialUrls) ? input.materialUrls : parseLines(input.materialUrls)).map((value) => String(value || '').trim()).filter(Boolean))];
  for (const value of materialUrls) {
    let parsed; try { parsed = new URL(value); } catch { throw new Error(`素材链接无效：${value}`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`素材链接仅支持 HTTP/HTTPS：${value}`);
  }
  const materials = [];
  for (const url of materialUrls) {
    const cached=materialCache instanceof Map?materialCache.get(url):null;
    if(cached){materials.push({url,status:'ok',title:cached.title||'',content_chars:Number(cached.content_chars||String(cached.content||'').length),excerpt:String(cached.content||cached.excerpt||'').slice(0,4000),error:''});continue;}
    try {
      const parsed = await fetchImpl({ targetUrl: url, root });
      materials.push({ url, status: parsed.status === 'ok' ? 'ok' : 'error', title: parsed.title || '', content_chars: Number(parsed.content_chars || 0), excerpt: String(parsed.content || '').slice(0, 4000), error: parsed.error || '' });
    } catch (error) {
      materials.push({ url, status: 'error', title: '', content_chars: 0, excerpt: '', error: error.message });
    }
  }
  return {
    kind: 'custom',
    content_type: contentType,
    content_type_label: CUSTOM_CONTENT_TYPES[contentType],
    topic,
    audience: String(input.audience || '').trim(),
    scenario: String(input.scenario || '').trim(),
    thesis: String(input.thesis || '').trim(),
    points,
    has_user_material_context: hasUserMaterialContext,
    steps: parseLines(Array.isArray(input.steps) ? input.steps.join('\n') : input.steps),
    items: parseLines(Array.isArray(input.items) ? input.items.join('\n') : input.items),
    materials,
    limitations: String(input.limitations || '').trim(),
    expected_pages: Math.max(4, Math.min(10, Number(input.expected_pages) || 6)),
    built_at: new Date().toISOString(),
  };
}

export function customFactMarkdown(fact) {
  const levelLabel = (level) => CUSTOM_SOURCE_LEVELS[level] || level || '未标注';
  const lines = [
    '# 自定义图文事实清单', '',
    `内容类型：${fact.content_type_label || fact.content_type}`,
    `主题：${fact.topic}`,
  ];
  if (fact.audience) lines.push(`目标受众：${fact.audience}`);
  if (fact.scenario) lines.push(`使用场景：${fact.scenario}`);
  if (fact.thesis) lines.push(`核心观点：${fact.thesis}`);
  lines.push('', '## 核心要点（含来源等级）', '',
    ...(fact.points || []).map((item) => `- ${item.text}（${levelLabel(item.source_level)}${item.source_url ? `；来源 ${item.source_url}` : ''}）`));
  if ((fact.steps || []).length) lines.push('', '## 教程步骤', '', ...fact.steps.map((item, index) => `${index + 1}. ${item}`));
  if ((fact.items || []).length) lines.push('', '## 清单条目', '', ...fact.items.map((item) => `- ${item}`));
  if ((fact.materials || []).length) lines.push('', '## 素材抓取', '', ...fact.materials.map((item) => `- ${item.url}（${item.status === 'ok' ? `成功 ${item.content_chars} 字` : `失败：${item.error || '未知原因'}`}）`));
  if (fact.limitations) lines.push('', '## 限制说明', '', fact.limitations);
  lines.push('', '## 体验真实性边界', '',
    '- 「作者真实体验」可写成第一人称亲历；',
    '- 「用户提供素材」必须保留来源归属；',
    '- 「模型建议」不得写成亲测、效果或收益。');
  return lines.join('\n') + '\n';
}
