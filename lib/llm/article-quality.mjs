export function inspectArticleQuality(markdown) {
  const text = String(markdown || '').trim();
  const issues = [];
  const blockingIssues = [];
  const h1 = text.match(/^#\s+.+$/gm) || [];
  const h2 = text.match(/^##\s+.+$/gm) || [];
  const links = text.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g) || [];
  const rawUrls = text.match(/https?:\/\/[^\s)>]+/g) || [];
  const footnotes = text.match(/(?:^|\n)\s*(?:\[?\d+\]?|来源[：:]|参考资料[：:]|Sources?[：:])/gim) || [];
  const body = text.replace(/^#.*$/gm, '').trim();
  const paragraphs = body.split(/\n\s*\n/).filter((item) => item && !item.startsWith('##'));
  const opening = paragraphs.slice(0, 3).join('\n');
  if (h1.length !== 1) { issues.push('必须且只能有一个 H1 标题'); blockingIssues.push('必须且只能有一个 H1 标题'); }
  if (h2.length < 3 || h2.length > 5) { issues.push('正文需要 3-5 个 H2 推进同一主线'); blockingIssues.push('正文需要 3-5 个 H2 推进同一主线'); }
  if (paragraphs.length < 8) { issues.push('正文段落过少，论证没有充分展开'); blockingIssues.push('正文段落过少，论证没有充分展开'); }
  if (opening.length < 180) issues.push('前三段背景与冲突信息不足');
  const hasHook = /[？?]/.test(opening) || /(为什么|究竟|谁能|能否|关键在于|真正(?:值得|的问题|刺眼|的冲突)|问题是|意味着什么|不是.{0,40}而是|最值得讨论|更严重的是|反常之处|这(?:说明|意味着|暴露出)|值得关注|背后(?:是|连接|指向)|最有冲击力)/.test(opening);
  if (!hasHook) issues.push('前三段缺少明确的读者悬念或核心问题');
  if (!/(判断|问题|意味着|真正|核心|我认为|在我看来)/.test(opening)) issues.push('第二段前后没有清晰亮明作者判断');
  if (!(links.length || rawUrls.length || footnotes.length)) issues.push('关键事实没有来源链接或脚注');
  if (/近年(?:来)?，?随着|综上所述|让我们拭目以待|在未来的格局中/.test(text)) issues.push('存在模板化表达');
  return { pass: issues.length === 0, blocking: blockingIssues.length > 0, issues, blockingIssues, h1Count: h1.length, h2Count: h2.length, linkCount: links.length + rawUrls.length, footnoteCount:footnotes.length };
}

export function buildQualityRepairPrompt(report) {
  return `以下文章未通过公众号成稿结构门禁：\n${report.issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\n请完整重写文章以修复问题。必须保留已核验事实、来源链接、作者立场和风险边界；不得新增日期、数字、人物行为或来源。只输出完整 Markdown。`;
}
