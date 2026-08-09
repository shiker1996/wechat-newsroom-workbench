function publishedTimestamp(item) {
  const value = Date.parse(item.published_at || item.created_at || '');
  return Number.isFinite(value) ? value : 0;
}

function newestFirst(left, right) {
  return publishedTimestamp(right) - publishedTimestamp(left)
    || Number(right.score ?? -1) - Number(left.score ?? -1)
    || right.id - left.id;
}

export class BatchQueryService {
  constructor(db) {
    this.db = db;
  }

  getBatch(id) {
    const batch = this.db.prepare('SELECT * FROM batches WHERE id=?').get(id);
    if (!batch) return null;
    try { batch.requested_tracks_list = JSON.parse(batch.requested_tracks || '["article"]'); }
    catch { batch.requested_tracks_list = ['article']; }
    batch.sources = this.db.prepare('SELECT * FROM source_runs WHERE batch_id=? ORDER BY id DESC').all(id);
    batch.subscription_runs = this.db.prepare('SELECT * FROM subscription_runs WHERE batch_id=? ORDER BY id DESC').all(id);
    batch.hotspots = this.db.prepare('SELECT * FROM hotspots WHERE batch_id=?').all(id).sort(newestFirst)
      .map((item) => ({
        ...item,
        materials: this.db.prepare('SELECT * FROM hotspot_materials WHERE hotspot_id=? ORDER BY position,id').all(item.id),
      }));
    batch.artifacts = this.db.prepare('SELECT * FROM artifacts WHERE batch_id=? ORDER BY modified_at DESC').all(id);
    batch.ai_runs = this.db.prepare('SELECT * FROM ai_runs WHERE batch_id=? ORDER BY created_at DESC LIMIT ?').all(id, 20);
    batch.ai_status = {
      tagged: batch.hotspots.filter((item) => {
        try { return Boolean(JSON.parse(item.raw_json).aiTags?.eventKey); } catch { return false; }
      }).length,
      total: batch.hotspots.length,
      latestResearch: this.db.prepare("SELECT * FROM ai_runs WHERE batch_id=? AND type IN ('research','auto') ORDER BY created_at DESC LIMIT 1")
        .get(id) ?? null,
    };
    return batch;
  }

  getOverview(batchId) {
    const items = this.db.prepare('SELECT * FROM hotspots WHERE batch_id=?').all(batchId).sort(newestFirst);
    const channels = new Map();
    const sources = new Map();
    const exactUrls = new Map();
    const wordCounts = new Map();
    const stop = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was', 'you', 'your', 'new',
      'how', 'why', 'what', 'into', 'about', 'after', 'before', 'more', '一个', '这个', '如何', '什么', '为什么',
      '以及', '最新', '发布', '消息', '公司', '进行']);
    for (const item of items) {
      const sourceGroup = item.source_group || item.source;
      sources.set(sourceGroup, (sources.get(sourceGroup) ?? 0) + 1);
      let raw = {};
      try { raw = JSON.parse(item.raw_json); } catch {}
      const channel = item.source_name || raw.feedLabel || (raw.subreddit ? `r/${raw.subreddit}` : raw.route) || item.source;
      channels.set(channel, (channels.get(channel) ?? 0) + 1);
      if (item.url) {
        const entry = exactUrls.get(item.url) ?? { url: item.url, titles: new Set(), sources: new Set(), count: 0 };
        entry.titles.add(item.title); entry.sources.add(channel); entry.count += 1; exactUrls.set(item.url, entry);
      }
      const latin = item.title.toLowerCase().match(/[a-z][a-z0-9+.#-]{2,}/g) ?? [];
      const cjkRuns = item.title.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
      const cjk = cjkRuns.flatMap((run) => run.length <= 4 ? [run]
        : [...Array(run.length - 1)].map((_, index) => run.slice(index, index + 2)));
      for (const word of [...latin, ...cjk]) if (!stop.has(word)) wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }
    const sortMap = (map, limit) => [...map.entries()].map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)).slice(0, limit);
    return {
      total: items.length,
      sources: sortMap(sources, 20),
      channels: sortMap(channels, 30),
      keywords: sortMap(wordCounts, 36),
      exactCoverage: [...exactUrls.values()].filter((item) => item.count > 1).map((item) => ({
        url: item.url, title: [...item.titles][0], count: item.count, sourceCount: item.sources.size,
      })).sort((left, right) => right.sourceCount - left.sourceCount || right.count - left.count).slice(0, 20),
      latest: items.slice(0, 30),
    };
  }
}
