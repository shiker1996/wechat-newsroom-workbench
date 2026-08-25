import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeStableEvents, resolveEventShadow, structuredMatch, buildEventTitle } from '../server/features/research/index.mjs';

function hotspot(id, title, { who, what, actionType = '争议回应', object = '', keywords = [], date = '2026-08-23' } = {}) {
  const eventKey = `${who}|${what}`;
  return {
    id, title, published_at: `${date}T08:00:00Z`,
    raw_json: JSON.stringify({ aiTags: { eventKey, keywords,
      eventParts: { who, what, actionType, object } } }),
  };
}

test('阶段0影子归并：同一争议的不同标题合并且报道守恒', () => {
  const first = hotspot(1, '灵活就业是福利引发争议', {
    who: '张丹丹', what: '称灵活就业是福利引发争议', object: '灵活就业社保', keywords: ['灵活就业', '社保'], date: '2026-08-22',
  });
  const second = hotspot(2, '张丹丹失言背后，真问题是谁来缴社保', {
    who: '张丹丹', what: '失言背后谁缴社保', actionType: '评论', object: '灵活就业社保', keywords: ['灵活就业', '社保'],
  });
  const result = resolveEventShadow({
    batch: { id: 'batch-1', batch_date: '2026-08-23' },
    hotspots: [first, second],
    legacyClusters: [{ event_id: 'E1', articles: [{ hotspot_id: 1 }] }, { event_id: 'E2', articles: [{ hotspot_id: 2 }] }],
  });
  assert.equal(result.shadow.event_count, 1);
  assert.equal(result.conservation.ok, true);
  assert.equal(result.differences.merges.length, 1);
  assert.deepEqual(result.differences.review_queue, []);
});

test('阶段0影子归并：同主体不同对象不自动合并', () => {
  const result = resolveEventShadow({
    batch: { id: 'batch-2', batch_date: '2026-08-23' },
    hotspots: [
      hotspot(1, '张丹丹谈灵活就业', { who: '张丹丹', what: '谈灵活就业', object: '灵活就业社保', keywords: ['灵活就业'] }),
      hotspot(2, '张丹丹发布新课程', { who: '张丹丹', what: '发布新课程', actionType: '发布', object: '课程', keywords: ['课程'] }),
    ],
  });
  assert.equal(result.shadow.event_count, 2);
  assert.equal(result.differences.merges.length, 0);
});

test('阶段0影子归并：历史高置信事件复用稳定事件ID', () => {
  const current = hotspot(3, '灵活就业争议最新回应', {
    who: '张丹丹', what: '灵活就业争议最新回应', object: '灵活就业社保', keywords: ['灵活就业', '社保'],
  });
  const result = resolveEventShadow({
    batch: { id: 'batch-3', batch_date: '2026-08-23' },
    hotspots: [current],
    history: [{ event_id: 'S-HISTORY-1', normalized: {
      whoKey: '张丹丹', objectKey: '灵活就业社保', triggerKey: '福利争议', actionType: '争议回应',
      timeWindow: '2026-08', entityKeys: ['张丹丹', '灵活就业', '社保'], eventKey: '',
    } }],
  });
  assert.equal(result.events[0].event_id, 'S-HISTORY-1');
  assert.equal(result.events[0].historical_match.event_id, 'S-HISTORY-1');
});

test('结构化匹配输出自动合并、复核和新事件三个区间', () => {
  const base = { whoKey: 'a', objectKey: 'x', triggerKey: 'y', actionType: '发布', timeWindow: '2026-08', entityKeys: ['a', 'x', 'y'], eventKey: '' };
  assert.ok(structuredMatch(base, { ...base }).score >= 82);
  assert.ok(structuredMatch(base, { ...base, triggerKey: 'z', entityKeys: ['a', 'x'] }).score >= 65);
  assert.ok(structuredMatch(base, { ...base, whoKey: 'b', objectKey: 'z', triggerKey: 'q', entityKeys: ['b', 'z'] }).score < 65);
});

test('事件标题来自主体、动作和对象，不继承报道噱头标题', () => {
  const result = resolveEventShadow({
    batch: { id: 'batch-title', batch_date: '2026-08-23' },
    hotspots: [hotspot(9, '震惊！这项决定让网友吵翻了', { who: 'Open AI', what: '周末 API 计费规则', actionType: '更新', object: 'API 计费规则' })],
  });
  assert.equal(result.events[0].title, 'OpenAI更新API 计费');
  assert.doesNotMatch(result.events[0].title, /震惊|吵翻/);
  assert.equal(buildEventTitle({ whoKey: 'Anthropic', actionType: '发布', objectLabel: '新模型' }), 'Anthropic发布新模型');
});

test('稳定事件装配保留 GitHub 仓库元数据供后续评分使用', () => {
  const hotspots = [{
    id: 10,
    title: 'openai/codex',
    source_group: 'github',
    source: 'github',
    source_type: 'trending',
    url: 'https://github.com/openai/codex',
    raw_json: JSON.stringify({
      repository: 'openai/codex',
      description: '轻量级终端编程代理',
      language: 'Rust',
      stars: 117765,
      topics: ['ai', 'cli'],
      createdAt: '2025-04-01T00:00:00Z',
      updatedAt: '2026-08-25T00:00:00Z',
      discoveryChannels: ['trending'],
    }),
  }];
  const [event] = materializeStableEvents({
    hotspots,
    shadowEvents: [{ event_id: 'S-REPO-1', title: 'OpenAI发布Codex', hotspot_ids: [10], normalized: {} }],
  });
  assert.equal(event.repositoryMeta.repository, 'openai/codex');
  assert.equal(event.repositoryMeta.language, 'Rust');
  assert.equal(event.repositoryMeta.stars, 117765);
  assert.deepEqual(event.repositoryMeta.topics, ['ai', 'cli']);
  assert.equal(event.articles[0].repositoryMeta.description, '轻量级终端编程代理');
});
