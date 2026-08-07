import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitizeQueries, loadCachedQueries, planRepoDiscoveryQueries, filterRepositoriesByInterest } from '../lib/llm/repo-discovery.mjs';
import { discoverGitHubRepositories } from '../collectors/github-discovery.mjs';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'repo-discovery-'));
}

const accountContext = {
  name: '橙序员', description: 'AI 与科技商业观察',
  readerProfile: '程序员、AI 创业者',
  contentPillars: ['开源与工程实践：AI Agent、MCP、Codex、开发工具'],
};

function fakeGateway(payload) {
  return {
    calls: [],
    async complete(input) {
      this.calls.push(input);
      return { content: typeof payload === 'function' ? payload(input) : payload };
    },
  };
}

test('sanitizeQueries 校验字段并夹紧范围', () => {
  const queries = sanitizeQueries({
    queries: [
      { label: 'AI Agent 框架', query: 'agent framework', language: 'TypeScript', createdWithinDays: 3, minStars: 99999 },
      { label: '', query: '无标签应丢弃' },
      { label: '超长查询', query: `x`.repeat(500), createdWithinDays: 60, minStars: 50 },
      { label: '无查询应丢弃' },
    ],
  }, { maxQueries: 6 });
  assert.equal(queries.length, 2);
  assert.equal(queries[0].createdWithinDays, 7);
  assert.equal(queries[0].minStars, 5000);
  assert.equal(queries[1].query.length, 200);
});

test('planRepoDiscoveryQueries 生成查询组并落缓存，缓存期内不再调模型', async () => {
  const root = tmpRoot();
  const gateway = fakeGateway('{"queries":[{"label":"MCP 工具","query":"mcp server","createdWithinDays":60,"minStars":100}]}');
  const first = await planRepoDiscoveryQueries({ workspaceRoot: root, gateway, accountContext, refreshDays: 7 });
  assert.equal(first.queries.length, 1);
  assert.equal(first.cached, false);
  assert.equal(gateway.calls.length, 1);
  assert.ok(fs.existsSync(path.join(root, 'data', 'repo-discovery-queries.json')));

  const second = await planRepoDiscoveryQueries({ workspaceRoot: root, gateway, accountContext, refreshDays: 7 });
  assert.equal(second.cached, true);
  assert.equal(gateway.calls.length, 1, '缓存命中不应再调模型');
  // 无网关时缓存仍可用
  const third = await planRepoDiscoveryQueries({ workspaceRoot: root, gateway: null, accountContext });
  assert.equal(third.queries.length, 1);
});

test('planRepoDiscoveryQueries 模型失败时优雅降级为空数组', async () => {
  const root = tmpRoot();
  const gateway = { async complete() { throw new Error('模型不可用'); } };
  const planned = await planRepoDiscoveryQueries({ workspaceRoot: root, gateway, accountContext });
  assert.deepEqual(planned.queries, []);
  const badJson = await planRepoDiscoveryQueries({ workspaceRoot: root, gateway: fakeGateway('不是 JSON'), accountContext });
  assert.deepEqual(badJson.queries, []);
});

test('filterRepositoriesByInterest 按阈值过滤并附分数理由，失败放行', async () => {
  const repos = [
    { repository: 'a/agent', description: 'AI Agent 框架', topics: ['agent'], language: 'TypeScript', stars: 800 },
    { repository: 'b/cookbook', description: '菜谱应用', topics: [], language: 'JavaScript', stars: 50 },
  ];
  const gateway = fakeGateway('{"results":[{"repository":"a/agent","score":9,"reason":"读者会想用"},{"repository":"b/cookbook","score":2,"reason":"与定位无关"}]}');
  const kept = await filterRepositoriesByInterest({ gateway, accountContext, repos, threshold: 6 });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].repository, 'a/agent');
  assert.equal(kept[0].interestScore, 9);
  assert.equal(kept[0].interestReason, '读者会想用');

  const failing = { async complete() { throw new Error('超时'); } };
  const all = await filterRepositoriesByInterest({ gateway: failing, accountContext, repos, threshold: 6 });
  assert.equal(all.length, 2, '模型故障应放行全量');
});

test('discoverGitHubRepositories 执行 AI 查询组并按优先级归并通道', async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(decodeURIComponent(url));
    const isAi = decodeURIComponent(url).includes('mcp');
    return {
      ok: true, status: 200, headers: new Map(),
      async json() {
        return {
          items: [
            isAi
              ? { full_name: 'x/mcp-server', html_url: 'https://github.com/x/mcp-server', description: 'MCP server', language: 'TypeScript', stargazers_count: 500, topics: ['mcp'], created_at: '2026-08-01', updated_at: '2026-08-06' }
              : { full_name: 'y/hot', html_url: 'https://github.com/y/hot', description: '热门', language: 'Go', stargazers_count: 9000, topics: [], created_at: '2026-08-01', updated_at: '2026-08-06' },
          ],
        };
      },
    };
  };
  const sourceResults = [];
  const items = await discoverGitHubRepositories([], {
    enabled: true, minStars: 1000, createdWithinDays: 30, limit: 5,
    aiQueries: [{ label: 'MCP 工具', query: 'mcp server', createdWithinDays: 60, minStars: 100, limit: 10 }],
    fetchImpl,
  }, () => {}, (r) => sourceResults.push(r));

  const aiRepo = items.find((i) => i.repository === 'x/mcp-server');
  assert.ok(aiRepo, 'AI 查询组结果应入归并');
  assert.equal(aiRepo.primaryDiscovery, 'ai-search');
  assert.equal(aiRepo.sourceType, 'ai-search');
  assert.equal(aiRepo.sourceName, 'AI 兴趣发现 · MCP 工具');
  assert.deepEqual(aiRepo.topics, ['mcp']);
  // publishedAt 必须是发现时间而非仓库创建时间，否则会被批次新鲜度窗口过滤（isFreshForBatch）
  const ageHours = (Date.now() - Date.parse(aiRepo.publishedAt)) / 3600000;
  assert.ok(ageHours < 1, `ai-search publishedAt 应为发现时间，实际距现在 ${ageHours.toFixed(1)} 小时`);
  assert.equal(aiRepo.createdAt, '2026-08-01', '仓库创建时间保留在 createdAt 字段');
  const searchRepo = items.find((i) => i.repository === 'y/hot');
  assert.ok((Date.now() - Date.parse(searchRepo.publishedAt)) / 3600000 < 1, 'search publishedAt 同样应为发现时间');
  assert.ok(sourceResults.some((r) => r.sourceType === 'ai-search' && r.status === 'success' && r.itemCount === 1));

  // trending 通道优先级高于 ai-search：同仓库被两通道发现时保持 trending 身份
  const trending = [{ sourceGroup: 'github', sourceType: 'trending', repository: 'x/mcp-server', url: 'https://github.com/x/mcp-server', sourceName: 'GitHub Trending · 日榜' }];
  const merged = await discoverGitHubRepositories(trending, {
    enabled: false, aiQueries: [{ label: 'MCP 工具', query: 'mcp', minStars: 10, limit: 5 }], fetchImpl,
  }, () => {}, () => {});
  const repo = merged.find((i) => i.repository === 'x/mcp-server');
  assert.equal(repo.primaryDiscovery, 'trending');
  assert.ok(repo.discoveryChannels.includes('ai-search') === false || repo.sourceType === 'trending');
});
