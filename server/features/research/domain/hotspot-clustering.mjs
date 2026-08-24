import crypto from 'node:crypto';

const CATEGORIES = ['🤖 AI/技术动态', '📰 综合资讯', '🏢 大厂战略', '📈 行业趋势', '💼 职场生态'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export function tagsOf(item) {
  try { return JSON.parse(item?.raw_json || '{}').aiTags ?? {}; } catch { return {}; }
}

function summaryOf(item, maxLength = 800) {
  let raw = {};
  try { raw = JSON.parse(item?.raw_json || '{}'); } catch {}
  return String(raw.summary || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function repositoryMetaOf(item) {
  let raw = {};
  try { raw = JSON.parse(item?.raw_json || '{}'); } catch {}
  const isRepository = item?.source_group === 'github'
    || item?.source === 'github'
    || /^https:\/\/github\.com\//i.test(String(item?.url || ''));
  if (!isRepository) return null;
  return {
    repository: raw.repository || item.title,
    description: raw.description || '',
    language: raw.language || '',
    stars: Number.isFinite(Number(raw.stars)) ? Number(raw.stars) : null,
    topics: Array.isArray(raw.topics) ? raw.topics : [],
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
    discoveryChannels: Array.isArray(raw.discoveryChannels) ? raw.discoveryChannels : [],
    primaryDiscovery: raw.primaryDiscovery || item.source_type || '',
    trendingPeriods: Array.isArray(raw.periods) ? raw.periods : raw.period ? [raw.period] : [],
    mentionedBy: Array.isArray(raw.mentionedBy) ? raw.mentionedBy : [],
  };
}

function provenanceOf(item) {
  let raw = {};
  try { raw = JSON.parse(item?.raw_json || '{}'); } catch {}
  if (item?.source_name) return { source: item.source_name, channel: raw.route || item.source_name };
  if ((item?.source_group === 'rsshub' || item?.source === 'rsshub') && raw.route) {
    const slug = String(raw.route).split('?')[0].split('/').filter(Boolean)[0] || 'rsshub';
    const labels = {
      latepost: '晚点 LatePost', huxiu: '虎嗅', techcrunch: 'TechCrunch', anthropic: 'Anthropic',
      jiemian: '界面新闻', readhub: 'ReadHub', solidot: 'Solidot', openai: 'OpenAI', '36kr': '36氪',
    };
    return { source: labels[slug] || `RSSHub · ${slug}`, channel: String(raw.route).split('?')[0] };
  }
  if (item?.source_group === 'reddit' || item?.source === 'reddit') {
    return { source: 'Reddit', channel: raw.subreddit ? `r/${raw.subreddit}` : 'Reddit' };
  }
  return { source: item?.source, channel: item?.source };
}

function safeKey(value, id) {
  return String(value || `singleton-${id}`).trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isFreshForBatch(item, batchDate, maxAgeHours = 168) {
  const published = Date.parse(item?.published_at || '');
  if (!Number.isFinite(published)) return true;
  // 优先按实际抓取时间划定有效窗口；缺失抓取时间时回退到批次日期。
  const collected = Date.parse(item?.created_at || '');
  const reference = Number.isFinite(collected) ? collected : Date.parse(`${batchDate}T23:59:59+08:00`);
  if (!Number.isFinite(reference)) return true;
  return published >= reference - maxAgeHours * 60 * 60 * 1000
    && published <= reference + 6 * 60 * 60 * 1000;
}

export function clusterItems(items = []) {
  const groups = new Map();
  for (const item of items) {
    const tags = tagsOf(item);
    const key = safeKey(tags.eventKey, item.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ item, tags });
  }
  return [...groups.entries()].map(([key, members]) => {
    // event_id 由事件指纹派生，与输入顺序和成员增减无关。
    members.sort((a, b) => Number(b.item.score || 0) - Number(a.item.score || 0) || a.item.id - b.item.id);
    const lead = members[0];
    const provenances = members.map(({ item }) => provenanceOf(item));
    const repositoryMember = members.find(({ item }) => repositoryMetaOf(item));
    return {
      event_id: `E${crypto.createHash('sha1').update(key).digest('hex').slice(0, 10).toUpperCase()}`,
      representative_title: lead.item.title,
      representativeHotspotId: lead.item.id,
      market_scope: lead.item.market_scope,
      china_relevance_score: clamp(lead.tags.chinaRelevance, 0, 12),
      china_relevance_reason: lead.tags.relevanceReason || '模型未提供具体理由，需编辑核验',
      global_exception: Boolean(lead.tags.globalException),
      topic_category: CATEGORIES.includes(lead.item.category) ? lead.item.category : '📰 综合资讯',
      keywords: [...new Set(members.flatMap((member) => member.tags.keywords || []))].slice(0, 8),
      source_count: new Set(provenances.map((source) => source.source)).size,
      report_count: members.length,
      peak_source_percentile: null,
      latest_time: members.map((member) => member.item.published_at).filter(Boolean).sort().at(-1) || null,
      cluster_confidence: members.length > 1 ? 'medium' : 'low',
      articles: members.map(({ item, tags }, articleIndex) => ({
        category_id: `G${String(item.id).padStart(5, '0')}`,
        hotspot_id: item.id,
        title: item.title,
        source: provenances[articleIndex].source,
        channel: provenances[articleIndex].channel,
        url: item.url,
        heat: item.score,
        time: item.published_at,
        risk_level: tags.riskLevel || '待评估',
        summary: summaryOf(item),
      })),
      tags: lead.tags,
      repositoryMeta: repositoryMember ? repositoryMetaOf(repositoryMember.item) : null,
    };
  });
}
