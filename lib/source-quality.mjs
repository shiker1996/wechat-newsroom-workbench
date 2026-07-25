// 启发式来源质量评分（待办 7-P1）：不调用模型，用于抓取路由决策——
// 免费途径（RSS 内容 / GitHub API / Python 本地）优先，质量不足才升级 Firecrawl（计费）。
const BLOCKED_PATTERNS = [
  /登录后(查看|阅读|继续)/, /立即登录/, /登录(即|后)可/,
  /sign in to (continue|read)/i, /log in to (continue|read)/i,
  /subscribe to (continue|read)/i, /already a subscriber/i,
  /关注公众号(后|查看)/, /解锁全文/, /开通会员/, /付费(订阅|阅读)/, /加入知识星球/,
];
const ERROR_PAGE_PATTERNS = [
  /\b404\b/, /page not found/i, /页面不存在|页面已删除|内容不存在/,
  /access denied/i, /访问被拒绝|拒绝访问/, /captcha|验证您是人类|安全验证|人机验证/i, /cloudflare/i,
];

export const FETCH_UPGRADE_THRESHOLD = 55;

function plainText(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/[#>*`()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function assessSourceQuality({ title = '', content = '', status = 'ok' } = {}, { threshold = FETCH_UPGRADE_THRESHOLD } = {}) {
  if (status !== 'ok') return { score: 0, level: 'error', issues: ['抓取失败'] };
  const text = plainText(content);
  if (BLOCKED_PATTERNS.some((re) => re.test(text))) return { score: 5, level: 'blocked', issues: ['命中登录墙或付费墙特征'] };
  if (ERROR_PAGE_PATTERNS.some((re) => re.test(text.slice(0, 600)))) return { score: 5, level: 'error-page', issues: ['疑似错误页或人机验证页'] };

  const chars = text.length;
  const paragraphs = String(content || '').split(/\n+/).map((line) => plainText(line)).filter((line) => line.length >= 30);
  // 标题相关性：中文取二字以上片段及其二字滑窗（整句往往不会原样出现在正文中），英文取单词，统计正文命中率
  const tokens = [];
  for (const piece of String(title).match(/[一-龥]{2,}|[A-Za-z0-9]{3,}/g) || []) {
    if (/^[一-龥]+$/.test(piece) && piece.length > 2) {
      for (let i = 0; i + 2 <= piece.length; i += 1) tokens.push(piece.slice(i, i + 2));
    } else tokens.push(piece);
  }
  const uniqueTokens = [...new Set(tokens)].slice(0, 16);
  const hits = uniqueTokens.filter((token) => text.includes(token)).length;
  const relevance = uniqueTokens.length ? hits / uniqueTokens.length : 0.5;

  const issues = [];
  let score = 0;
  score += Math.min(40, Math.round(chars / 50)); // 约 2000 字拿满长度分
  score += Math.min(20, paragraphs.length * 2);  // 10 个有效段落拿满结构分
  score += Math.round(relevance * 20);
  if (chars >= 200 && paragraphs.length === 0) { score = Math.min(score, 25); issues.push('正文缺少有效段落，疑似导航噪声'); }
  if (relevance < 0.3 && uniqueTokens.length >= 3) { score = Math.min(score, 35); issues.push('正文与标题相关性低'); }

  let level = 'thin';
  if (chars >= 800 && score >= threshold) level = 'full-text';
  else if (chars >= 200 && score >= 35) level = 'partial';
  else issues.push('正文过短');
  return { score, level, issues };
}
