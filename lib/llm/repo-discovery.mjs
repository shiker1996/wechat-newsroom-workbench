/**
 * AI 兴趣仓库发现（LLM 侧）
 * 1) planRepoDiscoveryQueries：按账号内容支柱/读者画像生成 GitHub Search 查询组，
 *    结果缓存到 data/repo-discovery-queries.json，refreshDays 内复用，失败回退缓存或空数组；
 * 2) filterRepositoriesByInterest：对 AI 查询组搜到的仓库做兴趣相关性打分过滤，
 *    分数与理由随热点入库，供研判评分与推荐理由复用。
 * 采集执行层（plugins/github-discovery/collector.mjs）只做搜索与归并，不感知 LLM。
 */
import fs from 'node:fs';
import path from 'node:path';

const QUERIES_FILE = 'repo-discovery-queries.json';

function parseJsonLoose(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch {}
  const brace = text.match(/(\{[\s\S]*\})/);
  if (brace) try { return JSON.parse(brace[1]); } catch {}
  return null;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// 查询组消毒：只保留可用字段并夹紧范围，防止模型输出跑偏后直接进 Search API
export function sanitizeQueries(parsed, { maxQueries = 6 } = {}) {
  const list = Array.isArray(parsed?.queries) ? parsed.queries : [];
  const out = [];
  for (const item of list) {
    const label = String(item?.label || '').trim().slice(0, 40);
    const query = String(item?.query || '').trim().slice(0, 200);
    if (!label || !query) continue;
    out.push({
      label, query,
      language: String(item?.language || '').trim().slice(0, 30),
      createdWithinDays: clampNumber(item?.createdWithinDays, 7, 180, 60),
      minStars: clampNumber(item?.minStars, 10, 5000, 50),
    });
    if (out.length >= maxQueries) break;
  }
  return out;
}

function queriesPath(workspaceRoot) {
  return path.join(workspaceRoot, 'data', QUERIES_FILE);
}

export function loadCachedQueries(workspaceRoot, refreshDays = 7) {
  try {
    const file = queriesPath(workspaceRoot);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ageMs = Date.now() - new Date(parsed.generatedAt || 0).getTime();
    if (!Number.isFinite(ageMs) || ageMs > refreshDays * 86400000) return null;
    const queries = sanitizeQueries(parsed);
    return queries.length ? { queries, generatedAt: parsed.generatedAt, cached: true } : null;
  } catch { return null; }
}

function accountInterestText(accountContext) {
  const pillars = (accountContext?.contentPillars || []).map((p, i) => `${i + 1}. ${p}`).join('\n');
  return `- 账号：${accountContext?.name || ''}（${accountContext?.description || ''}）
- 核心读者：${accountContext?.readerProfile || ''}
- 内容支柱：\n${pillars}`;
}

export async function planRepoDiscoveryQueries({ workspaceRoot, gateway, accountContext, refreshDays = 7, maxQueries = 6, provider = '', log = () => {} }) {
  const cached = loadCachedQueries(workspaceRoot, refreshDays);
  if (cached) return cached;
  if (!gateway) return { queries: [], generatedAt: null, cached: false };
  const system = `你是技术公众号的开源选题策划。根据账号内容支柱与读者画像，设计 GitHub Search 查询组，用于发现最近活跃、值得公众号写成实操/解读图文的开源项目。
要求：
- 输出 3~${maxQueries} 组查询，严格按内容支柱与读者画像分配：让各组覆盖内容支柱中读者价值最高的方向，每个内容支柱至少分配 1 组，按支柱价值占比分配余下组数；
- 不得自行偏袒或默认某类方向（例如不要默认以 AI/Agent 为主，不要引入内容支柱里没有的方向）；每个查询方向必须能从内容支柱中找到依据；
- query 字段只写 GitHub Search 的关键词部分（可含 topic: 限定符），不要写 stars:/created:/fork: 等限定符，系统会统一追加；
- minStars 按领域热度给 50~1000，小众方向放低、大众方向放高；
- 返回严格 JSON：{"queries":[{"label":"方向名（10 字内）","query":"关键词","language":"可选，留空表示不限","createdWithinDays":30到90,"minStars":数字}]}`;
  const user = accountInterestText(accountContext);
  try {
    const result = await gateway.complete({
      provider, purpose: 'repo-discovery-queries', jsonMode: true, maxOutputTokens: 2000,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    const queries = sanitizeQueries(parseJsonLoose(result.content), { maxQueries });
    if (!queries.length) throw new Error('模型未返回可用查询组');
    const generatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(queriesPath(workspaceRoot)), { recursive: true });
    fs.writeFileSync(queriesPath(workspaceRoot), JSON.stringify({ generatedAt, queries }, null, 2), 'utf8');
    log(`AI 兴趣查询组已生成 ${queries.length} 组：${queries.map((q) => q.label).join('、')}`);
    return { queries, generatedAt, cached: false };
  } catch (error) {
    log(`AI 兴趣查询组生成失败，本次跳过兴趣发现：${error.message}`);
    return { queries: [], generatedAt: null, cached: false };
  }
}

// 兴趣相关性过滤：对 AI 查询组发现的仓库逐条打分，保留 >= threshold 的。
// 失败时放行全量（fail-open）并记日志——宁可多进热点，不让一次模型故障清空发现通道。
export async function filterRepositoriesByInterest({ gateway, accountContext, repos, threshold = 6, provider = '', log = () => {} }) {
  const list = (repos || []).filter((repo) => repo?.repository);
  if (!list.length || !gateway) return repos || [];
  const catalog = list.map((repo, i) => `${i + 1}. ${repo.repository}｜${repo.description || '无简介'}｜topics:${(repo.topics || []).join(',') || '无'}｜${repo.language || '未知'}｜⭐${repo.stars ?? '?'}`).join('\n');
  const system = `你是技术公众号的选题编辑。按"核心读者是否会想读一篇该仓库的实操/解读图文"为每个仓库打 0~10 分，并给一句 20 字内的中文理由。
评分锚点：9-10 分=读者会立刻想试用的工具/框架；7-8 分=与内容支柱强相关；5-6 分=相关但受众窄或同质严重；0-4 分=与账号定位基本无关。
返回严格 JSON：{"results":[{"repository":"owner/name","score":数字,"reason":"理由"}]}，必须覆盖全部输入仓库。`;
  const user = `${accountInterestText(accountContext)}\n\n候选仓库：\n${catalog}`;
  let parsed = null;
  try {
    const result = await gateway.complete({
      provider, purpose: 'repo-interest-filter', jsonMode: true, maxOutputTokens: 4000,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    parsed = parseJsonLoose(result.content);
  } catch (error) {
    log(`兴趣相关性过滤失败，本次放行全部 ${list.length} 个仓库：${error.message}`);
    return repos;
  }
  const scores = new Map((Array.isArray(parsed?.results) ? parsed.results : [])
    .map((r) => [String(r?.repository || '').toLowerCase(), { score: clampNumber(r?.score, 0, 10, 0), reason: String(r?.reason || '').slice(0, 60) }]));
  const kept = []; const dropped = [];
  for (const repo of repos) {
    const hit = repo?.repository ? scores.get(repo.repository.toLowerCase()) : null;
    if (!repo?.repository || !hit || hit.score >= threshold) {
      kept.push(hit ? { ...repo, interestScore: hit.score, interestReason: hit.reason } : repo);
    } else {
      dropped.push(`${repo.repository}(${hit.score})`);
    }
  }
  log(`兴趣相关性过滤：保留 ${kept.length}/${repos.length}（阈值 ${threshold} 分）${dropped.length ? `，过滤：${dropped.slice(0, 5).join('、')}${dropped.length > 5 ? ' 等' : ''}` : ''}`);
  return kept;
}
