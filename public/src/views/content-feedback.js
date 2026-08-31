import { request } from "../core/http.js";
import { escapeHtml, toast } from "../core/ui.js";

let bound = false;
let feedbackMode = "article";
let pageData = null;

const fmt = (value) => new Intl.NumberFormat("zh-CN").format(Number(value || 0));
const levelLabel = (value) => ({ high: "高", medium: "中", low: "低" }[value] || "低");

function feedbackSignal(signal, extra = "") {
  const performanceText = signal.avg_reads !== undefined
    ? `${fmt(signal.avg_reads)} 阅读/篇 · ${Number(signal.follows_per_thousand_reads || 0).toFixed(2)}/千阅读后关注`
    : "";
  return `<div class="wechat-feedback-signal"><div><b>${escapeHtml(signal.label || "未命名信号")}</b><span class="wechat-feedback-level ${signal.confidence || "low"}">${levelLabel(signal.confidence)}置信</span></div><small>${escapeHtml(performanceText || extra || signal.hypothesis || "")}</small>${signal.hypothesis ? `<p>${escapeHtml(signal.hypothesis)}</p>` : ""}</div>`;
}

function renderRecommendation(item) {
  const flow = item.type === "topic" ? "选题池评分" : item.type === "title" ? "标题生成技能" : item.type === "body" ? "写作技能" : "内容规划流程";
  return `<div><span>${escapeHtml(item.target || "提示")}</span><p>${escapeHtml(item.text || "")}</p><em>${escapeHtml(item.basis || "")} · ${levelLabel(item.confidence)}置信 · 参考方向：${flow}</em></div>`;
}

function renderArticleFeedback(feedback) {
  const summary = document.getElementById("content-feedback-summary");
  const content = document.getElementById("content-feedback-content");
  const rebuild = document.getElementById("content-feedback-rebuild");
  if (rebuild) rebuild.hidden = false;
  if (!feedback) {
    if (summary) summary.textContent = "尚未生成";
    if (content) content.innerHTML = '<div class="empty-state">先到“复盘数据台”关联文章正文，再生成文章反馈快照。</div>';
    return;
  }
  if (summary) summary.textContent = `${feedback.linked_article_count || 0} 篇正文 · ${levelLabel(feedback.confidence)}置信 · ${String(feedback.generated_at || "").slice(0, 16).replace("T", " ")}`;
  const topicSignals = feedback.topic_signals || [];
  const titleSignals = feedback.title_signals || [];
  const bodySignals = feedback.body_signals || [];
  const recommendations = feedback.recommendations || [];
  const unresolved = feedback.unresolved_questions || [];
  if (content) content.innerHTML = `<div class="wechat-feedback-meta"><span>样本范围：${escapeHtml(feedback.metric_window_start || "-")} — ${escapeHtml(feedback.metric_window_end || "-")}</span><span>正文特征：${fmt(feedback.feature_count)} 条</span><span>供 AI 调整账号策略与技能文件参考</span></div><div class="wechat-feedback-grid"><section><header><b>选题表现</b><small>选题池评分依据</small></header>${topicSignals.length ? topicSignals.slice(0, 5).map((item) => feedbackSignal(item)).join("") : '<div class="empty-state">暂无题材样本</div>'}</section><section><header><b>标题结构</b><small>标题生成技能依据</small></header>${titleSignals.length ? titleSignals.slice(0, 5).map((item) => feedbackSignal(item)).join("") : '<div class="empty-state">暂无标题样本</div>'}</section><section><header><b>正文结构</b><small>写作技能依据</small></header>${bodySignals.length ? bodySignals.slice(0, 5).map((item) => feedbackSignal(item)).join("") : '<div class="empty-state">暂无正文特征</div>'}</section></div><div class="wechat-feedback-recommendations"><header><b>下一轮可带走的提示</b><small>作为 AI 调整账号策略与技能文件的参考，不自动改写</small></header>${recommendations.length ? recommendations.map(renderRecommendation).join("") : '<div class="empty-state">样本不足，暂不生成推荐。</div>'}</div><details class="wechat-feedback-questions"><summary>待确认问题（${unresolved.length}）</summary><ul>${unresolved.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>`;
}

function renderSocialFeedback(track) {
  const summary = document.getElementById("content-feedback-summary");
  const content = document.getElementById("content-feedback-content");
  const rebuild = document.getElementById("content-feedback-rebuild");
  if (rebuild) rebuild.hidden = true;
  if (!track?.count) {
    if (summary) summary.textContent = "暂无图文样本";
    if (content) content.innerHTML = '<div class="empty-state">暂无已确认的图文复盘样本。请先到“复盘数据台”确认图文发布文案与公众号数据的关联。</div>';
    return;
  }
  if (summary) summary.textContent = `${track.count} 条图文 · 传播信号`;
  const insights = track.insights || {};
  if (content) content.innerHTML = `<div class="wechat-feedback-meta"><span>样本范围：已确认的图文发布文案</span><span>反馈边界：发布文案、阅读、分享和阅读后关注</span><span>视觉模板暂不做因果判断</span></div><div class="wechat-feedback-grid"><section><header><b>图文选题表现</b><small>反馈到图文选题池</small></header>${insights.topics?.length ? insights.topics.slice(0, 5).map((item) => feedbackSignal(item)).join("") : '<div class="empty-state">暂无题材样本</div>'}</section><section><header><b>发布文案结构</b><small>反馈到标题技能</small></header>${insights.title_structures?.length ? insights.title_structures.slice(0, 5).map((item) => feedbackSignal(item)).join("") : '<div class="empty-state">暂无文案结构样本</div>'}</section><section><header><b>图文实验边界</b><small>暂不修改视觉配置</small></header><div class="wechat-social-feedback-note"><b>先沿用文案匹配链路</b><p>当前样本可以反哺图文题材和发布文案结构。封面、页面节奏、卡片模板等视觉字段积累足够样本后，再单独做视觉专项反馈。</p></div></section></div>`;
}

function renderStrategy(strategy) {
  const summary = document.getElementById("content-strategy-summary");
  const content = document.getElementById("content-strategy-content");
  if (!summary || !content) return;
  if (!strategy?.ready) {
    summary.textContent = `已积累 ${strategy?.cycle_count || 0}/${strategy?.required_cycles || 2} 个周期`;
    content.innerHTML = `<div class="empty-state">${escapeHtml(strategy?.caveats?.[0] || "至少需要两个不同指标周期后才能生成账号级建议。")}<br>${escapeHtml(strategy?.caveats?.[1] || "")}</div>`;
    return;
  }
  summary.textContent = `${strategy.cycle_count} 个周期 · 待确认草案`;
  const level = { high: "高", medium: "中", low: "低" };
  const renderPairs = (value) => Object.entries(value || {}).map(([key, item]) => `<span><b>${escapeHtml(key)}</b>${escapeHtml(item)}</span>`).join("");
  content.innerHTML = `${(strategy.suggestions || []).map((item) => `<article class="wechat-strategy-card"><header><div><b>${escapeHtml(item.title || "策略建议")}</b><span class="wechat-feedback-level ${item.level || "low"}">${level[item.level] || "低"}置信</span></div><small>${escapeHtml(item.evidence || "")}</small></header>${item.type === "contentRatio" ? `<div class="wechat-strategy-ratio"><div><strong>当前</strong>${renderPairs(item.current)}</div><div><strong>建议草案</strong>${renderPairs(item.proposed)}</div></div>` : item.type === "columnPriority" ? (item.proposed?.length ? `<ol class="wechat-strategy-columns">${item.proposed.map((column) => `<li><b>${escapeHtml(column.column)}</b><span>${fmt(column.avg_reads)} 阅读/篇 · ${fmt(column.sample_count)} 篇</span></li>`).join("")}</ol>` : `<p class="empty-state">暂无可比较的栏目样本。</p>`) : item.type === "packaging" ? `<p class="wechat-strategy-follow">${escapeHtml(item.proposed?.followReason || "")}</p>` : `<div class="wechat-strategy-pairs">${renderPairs(item.proposed)}</div>`}<p class="wechat-strategy-reason">${escapeHtml(item.reason || "")}</p></article>`).join("")}<div class="wechat-strategy-caveat">${(strategy.caveats || []).map((item) => `<span>· ${escapeHtml(item)}</span>`).join("")}</div>`;
}

function render(data) {
  pageData = data;
  const feedback = data.feedback;
  const review = data.review || {};
  const social = review.review_tracks?.social || {};
  const strategy = data.strategy || {};
  const metrics = [
    ["已关联文章正文", fmt(feedback?.linked_article_count || 0), "正文反馈样本"],
    ["文章反馈信号", fmt((feedback?.recommendations || []).length), "选题 · 标题 · 正文"],
    ["图文传播样本", fmt(social.count || 0), "题材 · 发布文案"],
    ["策略观察周期", `${strategy.cycle_count || 0}/${strategy.required_cycles || 2}`, strategy.ready ? "已形成草案" : "积累中"],
  ];
  document.getElementById("content-feedback-metrics").innerHTML = metrics.map(([label, value, note]) => `<article class="content-feedback-metric"><span>${escapeHtml(label)}</span><strong>${value}</strong><small>${escapeHtml(note)}</small></article>`).join("");
  renderStrategy(strategy);
  if (feedbackMode === "social") renderSocialFeedback(social);
  else renderArticleFeedback(feedback);
}

function setMode(mode) {
  feedbackMode = mode === "social" ? "social" : "article";
  document.querySelectorAll("[data-content-feedback-mode]").forEach((button) => {
    const active = button.dataset.contentFeedbackMode === feedbackMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (pageData) render(pageData);
}

async function load() {
  const [feedback, strategy, review] = await Promise.all([
    request("/api/wechat/feedback"),
    request("/api/wechat/strategy"),
    request("/api/wechat/review"),
  ]);
  render({ feedback: feedback.feedback, feedbackStats: feedback.stats, strategy, review });
}

function bind() {
  if (bound) return;
  bound = true;
  document.querySelectorAll("[data-content-feedback-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.contentFeedbackMode)));
  document.getElementById("content-feedback-rebuild")?.addEventListener("click", async () => {
    const button = document.getElementById("content-feedback-rebuild");
    button.disabled = true;
    button.textContent = "提取中…";
    try {
      const result = await request("/api/wechat/feedback/rebuild", { method: "POST", body: "{}" });
      toast(`文章反馈快照已生成：${result.extracted || 0} 篇正文`, "success");
      await load();
    } catch (error) { toast(error.message, "error"); }
    finally { button.disabled = false; button.textContent = "重新生成文章反馈"; }
  });
}

export default async function loadContentFeedback() { bind(); await load(); }
