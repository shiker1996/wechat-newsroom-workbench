import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSourceQuality, FETCH_UPGRADE_THRESHOLD } from '../lib/source-quality.mjs';
import { fetchUrlContent } from '../lib/source-fetcher.mjs';

const ROOT = process.cwd();

function hotspot({ summary = '', sourceType = 'rsshub' } = {}) {
  return { id: 1, source_type: sourceType, raw_json: JSON.stringify({ summary }) };
}

function goodArticle({ title = '国产大模型进展', chars = 1400 } = {}) {
  // 10 段、每段含标题词、总长达标 → full-text
  const para = `国产大模型在这一轮迭代中表现突出，`.repeat(3) + '模型能力持续增强，社区反馈积极。';
  const paragraphs = [];
  let total = 0;
  while (total < chars) { paragraphs.push(para); total += para.length; }
  return paragraphs.join('\n\n');
}

function pythonResult({ title = '', content = '', status = 'ok' } = {}) {
  return {
    stdout: JSON.stringify({
      status, url: 'https://example.com/a', final_url: 'https://example.com/a',
      title, description: '', author: '', published_at: '',
      content, content_chars: content.length, fetched_at: '', error: '',
    }),
  };
}

test('质量评分：长正文+多段落+标题相关 → full-text', () => {
  const q = assessSourceQuality({ title: '国产大模型进展', content: goodArticle(), status: 'ok' });
  assert.equal(q.level, 'full-text');
  assert.ok(q.score >= FETCH_UPGRADE_THRESHOLD, `score=${q.score}`);
});

test('质量评分：登录墙特征 → blocked，5 分', () => {
  const q = assessSourceQuality({ title: '某文章', content: '登录后查看完整内容，更多精彩内容等你发现', status: 'ok' });
  assert.equal(q.level, 'blocked');
  assert.equal(q.score, 5);
});

test('质量评分：404 错误页 → error-page，5 分', () => {
  const q = assessSourceQuality({ title: '某文章', content: '404 Page Not Found. The page you requested does not exist.', status: 'ok' });
  assert.equal(q.level, 'error-page');
  assert.equal(q.score, 5);
});

test('质量评分：有字无段落 → 导航噪声，封顶 25 分', () => {
  const noise = '首页\n关于我们\n产品中心\n新闻动态\n联系方式\n'.repeat(20); // 多行短文本，无有效段落
  const q = assessSourceQuality({ title: '公司动态', content: noise, status: 'ok' });
  assert.ok(q.score <= 25, `score=${q.score}`);
  assert.ok(q.issues.some((i) => i.includes('导航噪声')));
});

test('质量评分：标题与正文相关性低 → 封顶 35 分', () => {
  const unrelated = '完全无关的内容段落，讲的是另一件事情。'.repeat(30);
  const q = assessSourceQuality({ title: '国产大模型发布', content: unrelated, status: 'ok' });
  assert.ok(q.score <= 35, `score=${q.score}`);
});

test('路由：twitter 热点直接用 RSS 摘要，不调任何抓取', async () => {
  let firecrawlCalled = 0; let pythonCalled = 0;
  const result = await fetchUrlContent({
    targetUrl: 'https://x.com/someone/status/1', title: '一条推文', root: ROOT,
    hotspot: hotspot({ summary: '这是推文正文内容，RSS 已经给全了不需要二次抓取。', sourceType: 'twitter' }),
    firecrawlImpl: async () => { firecrawlCalled += 1; return null; },
    pythonImpl: async () => { pythonCalled += 1; return pythonResult({}); },
  });
  assert.equal(result.fetch_method, 'rss-tweet');
  assert.equal(result.status, 'ok');
  assert.equal(result.evidence_level, 'full-text');
  assert.equal(firecrawlCalled, 0);
  assert.equal(pythonCalled, 0);
  assert.ok(result.quality);
});

test('路由：非 twitter 但摘要 ≥800 字 → rss-content 免抓', async () => {
  let pythonCalled = 0;
  const result = await fetchUrlContent({
    targetUrl: 'https://example.com/long', title: '长文', root: ROOT,
    hotspot: hotspot({ summary: '摘要正文内容。'.repeat(120), sourceType: 'rsshub' }),
    pythonImpl: async () => { pythonCalled += 1; return pythonResult({}); },
  });
  assert.equal(result.fetch_method, 'rss-content');
  assert.equal(pythonCalled, 0);
});

test('路由：GitHub 仓库 URL 走 inspect，不调 Python/Firecrawl', async () => {
  let inspectCalled = 0; let firecrawlCalled = 0;
  const readme = '# 示例项目\n\n这是一个示例开源项目的 README 内容。'.repeat(10);
  const result = await fetchUrlContent({
    targetUrl: 'https://github.com/owner/repo', title: 'repo', root: ROOT,
    inspectImpl: async () => { inspectCalled += 1; return { repository: 'owner/repo', description: '示例', readme: { markdown: readme } }; },
    firecrawlImpl: async () => { firecrawlCalled += 1; return null; },
    pythonImpl: async () => { throw new Error('不应被调用'); },
  });
  assert.equal(inspectCalled, 1);
  assert.equal(firecrawlCalled, 0);
  assert.equal(result.fetch_method, 'github-api');
  assert.equal(result.status, 'ok');
});

test('路由：Python 拿到好内容 → 不升级 Firecrawl', async () => {
  let firecrawlCalled = 0;
  const content = goodArticle({});
  const result = await fetchUrlContent({
    targetUrl: 'https://example.com/a', title: '国产大模型进展', root: ROOT,
    firecrawlImpl: async () => { firecrawlCalled += 1; return null; },
    pythonImpl: async () => pythonResult({ title: '国产大模型进展', content }),
  });
  assert.equal(firecrawlCalled, 0);
  assert.equal(result.fetch_method, 'python');
  assert.equal(result.status, 'ok');
});

test('路由：Python 薄内容 → 升级 Firecrawl 并保留更好一份', async () => {
  let firecrawlCalled = 0;
  const good = goodArticle({});
  const result = await fetchUrlContent({
    targetUrl: 'https://example.com/paywalled', title: '国产大模型进展', root: ROOT,
    pythonImpl: async () => pythonResult({ title: '国产大模型进展', content: '登录后查看完整内容' }),
    firecrawlImpl: async () => {
      firecrawlCalled += 1;
      return { status: 'ok', url: 'https://example.com/paywalled', final_url: 'https://example.com/paywalled',
        title: '国产大模型进展', description: '', author: '', published_at: '',
        content: good, content_chars: good.length, fetched_at: '', error: '', fetch_method: 'firecrawl-mcp' };
    },
  });
  assert.equal(firecrawlCalled, 1);
  assert.equal(result.fetch_method, 'firecrawl-mcp');
  assert.equal(result.status, 'ok');
  assert.ok(result.content.length > 800);
});

test('路由：抓取全失败 + 摘要 ≥200 字 → rss-summary-fallback 兜底', async () => {
  const result = await fetchUrlContent({
    targetUrl: 'https://example.com/dead', title: '失败页', root: ROOT,
    hotspot: hotspot({ summary: '这是一条足够长的摘要内容，用于兜底降级。'.repeat(15), sourceType: 'rsshub' }),
    pythonImpl: async () => { throw new Error('python 挂了'); },
    firecrawlImpl: async () => { throw new Error('firecrawl 也挂了'); },
  });
  assert.equal(result.fetch_method, 'rss-summary-fallback');
  assert.equal(result.status, 'ok');
});

test('路由：抓取全失败且无摘要 → error', async () => {
  const result = await fetchUrlContent({
    targetUrl: 'https://example.com/dead2', title: '失败页', root: ROOT,
    pythonImpl: async () => { throw new Error('python 挂了'); },
    firecrawlImpl: async () => { throw new Error('firecrawl 也挂了'); },
  });
  assert.equal(result.status, 'error');
  assert.ok(result.error.length > 0);
  assert.equal(result.quality.level, 'error');
});

test('路由：sourceFetch 自定义阈值生效（rssContentMinChars 调高 → 走抓取）', async () => {
  let pythonCalled = 0;
  const summary = '摘要正文内容。'.repeat(120); // 840 字，默认免抓
  const direct = await fetchUrlContent({
    targetUrl: 'https://example.com/long', title: '长文', root: ROOT,
    hotspot: hotspot({ summary, sourceType: 'rsshub' }),
    pythonImpl: async () => { pythonCalled += 1; return pythonResult({}); },
  });
  assert.equal(direct.fetch_method, 'rss-content');
  assert.equal(pythonCalled, 0);

  const overridden = await fetchUrlContent({
    targetUrl: 'https://example.com/long', title: '长文', root: ROOT,
    hotspot: hotspot({ summary, sourceType: 'rsshub' }),
    sourceFetch: { rssContentMinChars: 2000 },
    pythonImpl: async () => { pythonCalled += 1; return pythonResult({ title: '长文', content: goodArticle({ title: '长文' }) }); },
    firecrawlImpl: async () => null,
  });
  assert.equal(overridden.fetch_method, 'python');
  assert.equal(pythonCalled, 1);
});
