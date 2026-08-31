import { request } from "../core/http.js";
import { escapeHtml, toast } from "../core/ui.js";

let bound = false;
const fmt = (value) => new Intl.NumberFormat("zh-CN").format(Number(value || 0));
const rate = (value) => `${(Number(value || 0) * 100).toFixed(2)}%`;
const levelLabel = (value) => ({ high: "高", medium: "中", low: "低" }[value] || "低");

function labels(item) {
  return [...(item.topic_tags || []), item.title_structure].filter(Boolean).map((label) => `<span class="wechat-label">${escapeHtml(label)}</span>`).join("");
}

function insightRow(item) {
  return `<div class="wechat-insight-row"><span>${escapeHtml(item.label)}</span><b>${fmt(item.avg_reads)} 阅读/篇</b><small>${fmt(item.sample_count)} 篇 · ${fmt(item.total_follows)} 关注 · ${Number(item.follows_per_thousand_reads || 0).toFixed(2)}/千阅读</small></div>`;
}

const matchMethod = { url_exact: "URL 精确", title_exact: "终稿标题精确", title_normalized: "终稿标题规范化", title_date_similarity: "终稿标题 + 日期相似", social_copy_exact: "图文发布文案精确", social_copy_normalized: "图文文案规范化", social_copy_similarity: "图文文案 + 日期相似", mixed_candidates: "终稿 / 图文文案相似" };
const matchStatus = { auto_confirmed: "已自动关联", confirmed: "已人工确认", pending: "待人工确认", rejected: "已拒绝", unmatched: "未找到候选" };
const contentSource = { local_final: "本地终稿", local_reviewed: "本地审阅稿", local_humanized: "本地去 AI 稿", local_draft: "本地初稿", local_html: "本地排版 HTML", external_url: "公开 URL" };

function renderMatches(data) {
  const stats = data?.stats || {};
  const summary = document.getElementById("wechat-match-summary");
  if (summary) summary.textContent = `待确认 ${stats.pending || 0} · 自动关联 ${stats.auto_confirmed || 0} · 未匹配 ${stats.unmatched || 0}`;
  const list = document.getElementById("wechat-match-list"); if (!list) return;
  const pending = (data?.items || []).filter((item) => item.status === "pending");
  if (!pending.length) {
    list.innerHTML = stats.unmatched ? `<div class="empty-state">当前没有待确认候选，仍有 ${stats.unmatched} 条公众号文章未找到本地产物。可以先在“发布中心”建立索引，再点击“重新匹配”。</div>` : '<div class="empty-state">暂无需要人工确认的匹配。导入文章数据并建立本地文章索引后，这里会出现匹配候选。</div>';
    return;
  }
  list.innerHTML = pending.map((item) => `<article class="wechat-match-row"><header><div><strong>${escapeHtml(item.metric_title || "未命名文章")}</strong><small>${escapeHtml(item.published_date || "无日期")} · ${fmt(item.reads)} 阅读 · ${fmt(item.shares)} 分享 · ${fmt(item.follows_after_read)} 阅读后关注</small></div><span class="wechat-match-state pending">${escapeHtml(matchStatus[item.status])}</span></header><div class="wechat-match-meta"><span>识别方式：${escapeHtml(matchMethod[item.match_method] || item.match_method || "未知")}</span><span>置信度：${escapeHtml(item.confidence || "低")}</span><span>${item.notified ? "已通知" : "未通知"}</span></div><div class="wechat-match-candidates">${(item.candidate_snapshot || []).map((candidate) => `<button type="button" class="wechat-match-candidate" data-wechat-confirm="${item.id}" data-wechat-artifact="${candidate.id}"><span>${escapeHtml(candidate.title || "未命名产物")}</span><small>${escapeHtml(candidate.version_label || candidate.artifact_type || "文章产物")} · ${escapeHtml(candidate.article_date || "无日期")} · 相似度 ${Math.round(Number(candidate.score || 0) * 100)}%</small></button>`).join("")}</div><button type="button" class="text-button wechat-match-reject" data-wechat-reject="${item.id}">这不是同一篇文章</button></article>`).join("");
}

function renderContentLinks(data) {
  const items = data?.items || [];
  const linked = items.filter((item) => item.content_status === "ok").length;
  const socialCopies = items.filter((item) => item.artifact_type === "图文发布文案").length;
  const evidenceCount = items.reduce((sum, item) => sum + (item.evidence_assets || []).length, 0);
  const externalErrors = items.filter((item) => item.content_status === "error").length;
  const summary = document.getElementById("wechat-content-summary");
  if (summary) summary.textContent = `${linked} 篇已有正文 · ${socialCopies} 篇图文文案 · ${evidenceCount} 个证据${externalErrors ? ` · ${externalErrors} 条待处理` : ""}`;
  const list = document.getElementById("wechat-content-list"); if (!list) return;
  if (!items.length) { list.innerHTML = '<div class="empty-state">暂无已确认的文章。先完成公众号数据与本地文章产物匹配。</div>'; return; }
  list.innerHTML = items.map((item) => {
    const isSocialCopy = item.artifact_type === "图文发布文案";
    const ok = item.content_status === "ok";
    const stateClass = isSocialCopy ? "linked" : ok ? "linked" : item.content_status === "error" ? "error" : "";
    const state = isSocialCopy ? "已关联发布文案" : ok ? (contentSource[item.source_kind] || "已关联正文") : item.content_status === "error" ? "获取失败" : "待关联正文";
    const evidence = (item.evidence_assets || []).map((asset) => `<span>${escapeHtml(asset.label || asset.asset_type)}</span>`).join("");
    const fetchButton = item.content_url && (!ok || item.source_kind === "external_url") ? `<button type="button" class="text-button" data-wechat-fetch-content="${item.match_id}">获取公开正文</button>` : "";
    const note = isSocialCopy ? "发布文案仅用于图文匹配，不进入文章正文特征分析" : item.content_error || (ok ? `${fmt(item.content_chars)} 字 · ${evidence ? `${item.evidence_assets.length} 个证据资产` : "暂无证据资产"}` : "本地产物索引中暂未找到正文");
    const copy = isSocialCopy && item.copy_content ? `<details class="wechat-copy-preview"><summary>查看发布文案</summary><pre>${escapeHtml(item.copy_content)}</pre></details>` : "";
    return `<article class="wechat-content-row"><header><div><strong>${escapeHtml(item.metric_title || "未命名文章")}</strong><small>${escapeHtml(item.published_date || "无日期")} · ${fmt(item.reads)} 阅读 · ${fmt(item.shares)} 分享 · ${fmt(item.follows_after_read)} 阅读后关注</small></div><span class="wechat-content-state ${stateClass}">${escapeHtml(state)}</span></header><div class="wechat-content-meta"><span>${escapeHtml(note)}</span>${item.artifact_title ? `<span>产物：${escapeHtml(item.artifact_title)} · ${escapeHtml(item.version_label || item.artifact_type || "")}</span>` : ""}${item.source_url ? `<span class="wechat-content-path">来源：${escapeHtml(item.source_url)}</span>` : item.source_path ? `<span class="wechat-content-path">来源：${escapeHtml(item.source_path)}</span>` : ""}</div>${copy}${evidence ? `<div class="wechat-content-evidence">${evidence}</div>` : ""}<div class="wechat-content-actions">${fetchButton}${item.content_error ? `<span class="muted">${escapeHtml(item.content_error)}</span>` : ""}</div></article>`;
  }).join("");
}

function feedbackSignal(signal, extra = "") {
  const confidence = levelLabel(signal.confidence);
  const performanceText = signal.avg_reads !== undefined ? `${fmt(signal.avg_reads)} 阅读/篇 · ${Number(signal.follows_per_thousand_reads || 0).toFixed(2)}/千阅读后关注` : "";
  return `<div class="wechat-feedback-signal"><div><b>${escapeHtml(signal.label || "未命名信号")}</b><span class="wechat-feedback-level ${signal.confidence || "low"}">${confidence}置信</span></div><small>${escapeHtml(performanceText || extra || signal.hypothesis || "")}</small>${signal.hypothesis ? `<p>${escapeHtml(signal.hypothesis)}</p>` : ""}</div>`;
}

function renderFeedback(data) {
  const feedback = data?.feedback;
  const summary = document.getElementById("wechat-feedback-summary");
  if (!feedback) { if (summary) summary.textContent = "尚未生成"; document.getElementById("wechat-feedback-content").innerHTML = '<div class="empty-state">先关联正文，再生成反馈快照。</div>'; return; }
  if (summary) summary.textContent = `${feedback.linked_article_count || 0} 篇正文 · ${levelLabel(feedback.confidence)}置信 · ${String(feedback.generated_at || "").slice(0, 16).replace("T", " ")}`;
  const topicSignals = feedback.topic_signals || [];
  const titleSignals = feedback.title_signals || [];
  const bodySignals = feedback.body_signals || [];
  const recommendations = feedback.recommendations || [];
  const unresolved = feedback.unresolved_questions || [];
  document.getElementById("wechat-feedback-content").innerHTML = `<div class="wechat-feedback-meta"><span>样本范围：${escapeHtml(feedback.metric_window_start || "-")} — ${escapeHtml(feedback.metric_window_end || "-")}</span><span>正文特征：${fmt(feedback.feature_count)} 条</span><span>只做相关性提示，不直接改写创作配置</span></div><div class="wechat-feedback-grid"><section><header><b>题材表现</b><small>选题候选</small></header>${topicSignals.length ? topicSignals.slice(0, 4).map((item) => feedbackSignal(item)).join("") : '<div class="empty-state">暂无题材样本</div>'}</section><section><header><b>标题结构</b><small>标题方向</small></header>${titleSignals.length ? titleSignals.slice(0, 4).map((item) => feedbackSignal(item)).join("") : '<div class="empty-state">暂无标题样本</div>'}</section><section><header><b>正文结构</b><small>可验证假设</small></header>${bodySignals.length ? bodySignals.slice(0, 4).map((item) => feedbackSignal(item)).join("") : '<div class="empty-state">暂无正文特征</div>'}</section></div><div class="wechat-feedback-recommendations"><header><b>下一轮可带走的提示</b><small>不会自动覆盖技能或账号定位</small></header>${recommendations.length ? recommendations.map((item) => `<div><span>${escapeHtml(item.target || "提示")}</span><p>${escapeHtml(item.text || "")}</p><em>${escapeHtml(item.basis || "")} · ${levelLabel(item.confidence)}置信</em></div>`).join("") : '<div class="empty-state">样本不足，暂不生成推荐。</div>'}</div><details class="wechat-feedback-questions"><summary>待确认问题（${unresolved.length}）</summary><ul>${unresolved.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>`;
}

function renderStrategy(data) {
  const summary = document.getElementById("wechat-strategy-summary");
  const content = document.getElementById("wechat-strategy-content");
  if (!summary || !content) return;
  if (!data?.ready) {
    summary.textContent = `已积累 ${data?.cycle_count || 0}/${data?.required_cycles || 2} 个周期`;
    content.innerHTML = `<div class="empty-state">${escapeHtml(data?.caveats?.[0] || "至少需要两个不同指标周期后才能生成账号级建议。")}<br>${escapeHtml(data?.caveats?.[1] || "")}</div>`;
    return;
  }
  summary.textContent = `${data.cycle_count} 个周期 · 待确认草案`;
  const level = { high: "高", medium: "中", low: "低" };
  const renderPairs = (value) => Object.entries(value || {}).map(([key, item]) => `<span><b>${escapeHtml(key)}</b>${escapeHtml(item)}</span>`).join("");
  content.innerHTML = `${(data.suggestions || []).map((item) => `<article class="wechat-strategy-card"><header><div><b>${escapeHtml(item.title || "策略建议")}</b><span class="wechat-feedback-level ${item.level || "low"}">${level[item.level] || "低"}置信</span></div><small>${escapeHtml(item.evidence || "")}</small></header>${item.type === "contentRatio" ? `<div class="wechat-strategy-ratio"><div><strong>当前</strong>${renderPairs(item.current)}</div><div><strong>建议草案</strong>${renderPairs(item.proposed)}</div></div>` : item.type === "columnPriority" ? (item.proposed?.length ? `<ol class="wechat-strategy-columns">${item.proposed.map((column) => `<li><b>${escapeHtml(column.column)}</b><span>${fmt(column.avg_reads)} 阅读/篇 · ${fmt(column.sample_count)} 篇</span></li>`).join("")}</ol>` : `<p class="empty-state">暂无可比较的栏目样本。</p>`) : item.type === "packaging" ? `<p class="wechat-strategy-follow">${escapeHtml(item.proposed?.followReason || "")}</p>` : `<div class="wechat-strategy-pairs">${renderPairs(item.proposed)}</div>`}<p class="wechat-strategy-reason">${escapeHtml(item.reason || "")}</p></article>`).join("")}<div class="wechat-strategy-caveat">${(data.caveats || []).map((item) => `<span>· ${escapeHtml(item)}</span>`).join("")}</div>`;
}

function render(data) {
  const metrics = [
    ["累计净增关注", fmt((data.growth || []).reduce((sum, item) => sum + Number(item.net_followers || 0), 0)), "用户分析"],
    ["通知池阅读", fmt(data.notified?.reads), `${fmt(data.notified?.count)} 篇`],
    ["非通知池阅读", fmt(data.unnotified?.reads), `${fmt(data.unnotified?.count)} 篇`],
    ["最高阅读单篇", fmt(data.top_articles?.[0]?.reads), data.top_articles?.[0]?.title || "暂无数据"],
  ];
  document.getElementById("wechat-review-metrics").innerHTML = metrics.map(([label, value, note]) => `<article class="wechat-metric"><span>${escapeHtml(label)}</span><strong>${value}</strong><small>${escapeHtml(note)}</small></article>`).join("");
  document.getElementById("wechat-top-articles").innerHTML = data.top_articles?.length ? data.top_articles.map((item, index) => `<div class="wechat-article-row"><b>${String(index + 1).padStart(2, "0")}</b><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.published_date)} · ${item.notified ? "已通知" : "未通知"}</small><span class="wechat-labels">${labels(item)}</span></div><span>${fmt(item.reads)} 阅读</span></div>`).join("") : '<div class="empty-state">导入内容分析文件后，这里会出现文章表现。</div>';
  document.getElementById("wechat-weekly-report").innerHTML = data.weekly?.length ? `<div class="wechat-weekly-head"><span>周次</span><span>篇数</span><span>阅读</span><span>分享</span><span>阅读后关注</span></div>${data.weekly.map((item) => `<div class="wechat-week-row"><b>${escapeHtml(item.week || "-")}</b><span>${fmt(item.articles)}</span><span>${fmt(item.reads)}</span><span>${fmt(item.shares)}</span><span>${fmt(item.follows)}</span></div>`).join("")}` : '<div class="empty-state">导入内容分析文件后，这里会生成周报。</div>';
  const insights = data.insights || {};
  const historicalArticles = (data.articles || []).slice(0, 12);
  document.getElementById("wechat-insights").innerHTML = data.insights ? `<div class="wechat-insight-grid"><div class="wechat-insight-group"><strong>题材表现</strong>${insights.topics?.length ? insights.topics.slice(0, 6).map(insightRow).join("") : '<div class="empty-state">暂无题材样本。</div>'}</div><div class="wechat-insight-group"><strong>标题结构表现</strong>${insights.title_structures?.length ? insights.title_structures.slice(0, 6).map(insightRow).join("") : '<div class="empty-state">暂无标题结构样本。</div>'}</div></div><small class="wechat-insight-caveat">${escapeHtml(insights.summary?.caveat || "")}</small><div class="wechat-history-articles"><strong>历史文章识别（规则初判）</strong>${historicalArticles.map((item) => `<div class="wechat-history-article"><div><b>${escapeHtml(item.title)}</b><span class="wechat-labels">${labels(item)}</span></div><em>${fmt(item.reads)} 阅读 · ${fmt(item.follows_after_read)} 关注</em></div>`).join("")}</div>` : '<div class="empty-state">导入内容分析文件后，这里会生成历史表现信号。</div>';
  const latest = data.growth?.at(-1); const regular = data.regular_readers?.at(-1);
  document.getElementById("wechat-growth-summary").innerHTML = latest ? `<div><b>最新累计关注</b><strong>${fmt(latest.total_followers)}</strong><small>${escapeHtml(latest.stat_date)} · 当日净增 ${fmt(latest.net_followers)}</small></div>` : '<div class="empty-state">还没有用户增长数据。</div>';
  document.getElementById("wechat-regular-readers").innerHTML = regular ? `<div><b>最近常读用户</b><strong>${fmt(regular.regular_readers)}</strong><small>${escapeHtml(regular.period)} · 占比 ${rate(regular.regular_reader_rate)}</small></div>` : "";
  document.getElementById("wechat-channels").innerHTML = data.channels?.length ? data.channels.map((item) => `<div class="wechat-channel-row"><span>${escapeHtml(item.channel || "其他")}</span><i><em style="width:${Math.min(100, Number(item.reads || 0) / Math.max(1, Number(data.channels[0]?.reads || 1)) * 100)}%"></em></i><b>${fmt(item.reads)}</b></div>`).join("") : '<div class="empty-state">导入内容趋势文件后，这里会显示阅读来源。</div>';
  document.getElementById("wechat-import-history").innerHTML = data.imports?.length ? `<small>最近导入：${data.imports.slice(0, 4).map((item) => `${escapeHtml(item.file_name)}（${fmt(item.row_count)} 行）`).join(" · ")}</small>` : "<small>尚未导入文件。</small>";
}

async function loadMatches() { renderMatches(await request("/api/wechat/matches?limit=200")); }
async function loadContentLinks() { renderContentLinks(await request("/api/wechat/content-links?limit=200")); }
async function loadFeedback() { renderFeedback(await request("/api/wechat/feedback")); }
async function loadStrategy() { renderStrategy(await request("/api/wechat/strategy")); }
async function load() { const [review] = await Promise.all([request("/api/wechat/review"), loadMatches(), loadContentLinks(), loadFeedback(), loadStrategy()]); render(review); }

function scrollToReviewSection(id, focusImport = false) {
  const target = document.getElementById(id);
  if (!target) return;
  const disclosure = target.closest("details");
  if (disclosure) disclosure.open = true;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  if (focusImport) window.setTimeout(() => document.getElementById("wechat-import-file")?.focus(), 260);
}

function bind() {
  if (bound) return; bound = true;
  document.getElementById("wechat-import-file")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0]; const status = document.getElementById("wechat-import-status");
    if (!status) return;
    if (!file) { status.textContent = ""; return; }
    const type = document.getElementById("wechat-import-type")?.selectedOptions?.[0]?.textContent || "当前类型";
    status.textContent = `已选择：${file.name} · ${type}，点击“导入并合并”继续`;
  });
  document.getElementById("wechat-import-submit").addEventListener("click", async () => {
    const file = document.getElementById("wechat-import-file").files[0]; const type = document.getElementById("wechat-import-type").value; const status = document.getElementById("wechat-import-status");
    if (!file) { toast("请先选择一个导出文件", "error"); return; }
    status.textContent = "正在解析并合并…";
    try { const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",").pop()); reader.onerror = reject; reader.readAsDataURL(file); }); const result = await request("/api/wechat/import", { method: "POST", body: JSON.stringify({ fileName: file.name, importType: type, data }) }); status.textContent = `导入完成 · 自动关联 ${result.matches?.matched || 0} 条，待确认 ${result.matches?.pending || 0} 条`; toast("公众号数据已合并并完成初步匹配", "success"); document.getElementById("wechat-import-file").value = ""; await load(); } catch (error) { status.textContent = error.message; toast(error.message, "error"); }
  });
  document.getElementById("wechat-rematch")?.addEventListener("click", async () => {
    const button = document.getElementById("wechat-rematch"); button.disabled = true; button.textContent = "匹配中…";
    try { const result = await request("/api/wechat/matches/rematch", { method: "POST", body: "{}" }); toast(`重新匹配完成：自动关联 ${result.matched} 条，待确认 ${result.pending} 条`, "success"); await load(); }
    catch (error) { toast(error.message, "error"); }
    finally { button.disabled = false; button.textContent = "重新匹配"; }
  });
  document.getElementById("wechat-content-relink")?.addEventListener("click", async () => {
    const button = document.getElementById("wechat-content-relink"); button.disabled = true; button.textContent = "关联中…";
    try { const result = await request("/api/wechat/content-links/relink", { method: "POST", body: "{}" }); toast(`本地正文关联完成：${result.linked} 篇正文、${result.social_copy || 0} 篇图文文案${result.needs_external ? `，${result.needs_external} 篇可尝试公开 URL` : ""}`, "success"); await load(); }
    catch (error) { toast(error.message, "error"); }
    finally { button.disabled = false; button.textContent = "关联本地正文"; }
  });
  document.getElementById("wechat-feedback-rebuild")?.addEventListener("click", async () => {
    const button = document.getElementById("wechat-feedback-rebuild"); button.disabled = true; button.textContent = "提取中…";
    try { const result = await request("/api/wechat/feedback/rebuild", { method: "POST", body: "{}" }); toast(`反馈快照已生成：${result.extracted || 0} 篇正文`, "success"); await load(); }
    catch (error) { toast(error.message, "error"); }
    finally { button.disabled = false; button.textContent = "生成本轮反馈"; }
  });
  document.addEventListener("click", async (event) => {
    const anchor = event.target.closest("[data-wechat-anchor]");
    const focusImport = event.target.closest("[data-wechat-focus-import]");
    if (anchor) { scrollToReviewSection(anchor.dataset.wechatAnchor); return; }
    if (focusImport) { scrollToReviewSection("wechat-import-panel", true); return; }
    const confirm = event.target.closest("[data-wechat-confirm]"); const reject = event.target.closest("[data-wechat-reject]");
    const fetchContent = event.target.closest("[data-wechat-fetch-content]");
    if (fetchContent) {
      fetchContent.disabled = true; fetchContent.textContent = "获取中…";
      try { const result = await request(`/api/wechat/content-links/${fetchContent.dataset.wechatFetchContent}/fetch`, { method: "POST", body: "{}" }); toast(result.status === "linked_external" ? "公开正文已保存" : result.status === "local_exists" ? "本地正文已存在，未覆盖" : result.error || "公开正文获取失败", result.status === "error" ? "error" : "success"); await load(); }
      catch (error) { toast(error.message, "error"); fetchContent.disabled = false; fetchContent.textContent = "获取公开正文"; }
      return;
    }
    if (!confirm && !reject) return;
    const button = confirm || reject; button.disabled = true;
    try { await request(`/api/wechat/matches/${confirm?.dataset.wechatConfirm || reject.dataset.wechatReject}`, { method: "PATCH", body: JSON.stringify(confirm ? { action: "confirm", articleArtifactId: Number(confirm.dataset.wechatArtifact) } : { action: "reject" }) }); toast(confirm ? "已确认文章关联" : "已拒绝该候选", "success"); await load(); }
    catch (error) { toast(error.message, "error"); button.disabled = false; }
  });
}

export default async function loadWechatReview() { bind(); await load(); }
