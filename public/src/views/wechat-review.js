import { request } from "../core/http.js";
import { escapeHtml } from "../core/ui.js";

let bound = false;
let reviewMode = "article";
let reviewData = null;
const fmt = (value) => new Intl.NumberFormat("zh-CN").format(Number(value || 0));
const rate = (value) => `${(Number(value || 0) * 100).toFixed(2)}%`;
const levelLabel = (value) => ({ high: "高", medium: "中", low: "低" }[value] || "低");

function labels(item) {
  return [...(item.topic_tags || []), item.title_structure].filter(Boolean).map((label) => `<span class="wechat-label">${escapeHtml(label)}</span>`).join("");
}

function insightRow(item) {
  return `<div class="wechat-insight-row"><span>${escapeHtml(item.label)}</span><b>${fmt(item.avg_reads)} 阅读/篇</b><small>${fmt(item.sample_count)} 篇 · ${fmt(item.total_follows)} 关注 · ${Number(item.follows_per_thousand_reads || 0).toFixed(2)}/千阅读</small></div>`;
}

function currentTrack(data) {
  return data?.review_tracks?.[reviewMode] || {
    articles: data?.articles || [], top_articles: data?.top_articles || [], weekly: data?.weekly || [], notified: data?.notified || {}, unnotified: data?.unnotified || {}, insights: data?.insights || {}, count: data?.articles?.length || 0,
  };
}

function render(data) {
  const track = currentTrack(data);
  const isSocial = reviewMode === "social";
  const metrics = [
    ["累计净增关注", fmt((data.growth || []).reduce((sum, item) => sum + Number(item.net_followers || 0), 0)), "用户分析"],
    [isSocial ? "图文通知池阅读" : "文章通知池阅读", fmt(track.notified?.reads), `${fmt(track.notified?.count)} 篇`],
    [isSocial ? "图文非通知池阅读" : "文章非通知池阅读", fmt(track.unnotified?.reads), `${fmt(track.unnotified?.count)} 篇`],
    [isSocial ? "最高阅读图文" : "最高阅读文章", fmt(track.top_articles?.[0]?.reads), track.top_articles?.[0]?.title || "暂无数据"],
  ];
  document.getElementById("wechat-review-metrics").innerHTML = metrics.map(([label, value, note]) => `<article class="wechat-metric"><span>${escapeHtml(label)}</span><strong>${value}</strong><small>${escapeHtml(note)}</small></article>`).join("");
  document.getElementById("wechat-top-title").textContent = isSocial ? "图文表现" : "文章表现";
  document.getElementById("wechat-top-articles").innerHTML = track.top_articles?.length ? track.top_articles.map((item, index) => `<div class="wechat-article-row"><b>${String(index + 1).padStart(2, "0")}</b><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.published_date)} · ${item.notified ? "已通知" : "未通知"}</small><span class="wechat-labels">${labels(item)}</span></div><span>${fmt(item.reads)} 阅读</span></div>`).join("") : `<div class="empty-state">暂无${isSocial ? "已确认的图文发布文案" : "文章终稿"}复盘样本。可先去“复盘数据台”完成关联。</div>`;
  document.getElementById("wechat-weekly-title").textContent = isSocial ? "图文周报" : "文章周报";
  document.getElementById("wechat-weekly-note").textContent = isSocial ? "按图文发布文案的发表日期聚合，观察分享与涨粉信号" : "按文章发表日期聚合，观察文章节奏和涨粉信号";
  document.getElementById("wechat-weekly-report").innerHTML = track.weekly?.length ? `<div class="wechat-weekly-head"><span>周次</span><span>篇数</span><span>阅读</span><span>分享</span><span>阅读后关注</span></div>${track.weekly.map((item) => `<div class="wechat-week-row"><b>${escapeHtml(item.week || "-")}</b><span>${fmt(item.articles)}</span><span>${fmt(item.reads)}</span><span>${fmt(item.shares)}</span><span>${fmt(item.follows)}</span></div>`).join("")}` : `<div class="empty-state">暂无${isSocial ? "图文" : "文章"}样本，导入并确认关联后这里会生成周报。</div>`;
  const insights = track.insights || {};
  const historicalArticles = (track.articles || []).slice(0, 12);
  document.getElementById("wechat-insights-title").textContent = isSocial ? "图文题材与文案结构" : "历史文章分析";
  document.getElementById("wechat-secondary-note").textContent = isSocial ? "图文题材、发布文案结构与渠道趋势" : "历史题材、标题结构与渠道趋势";
  document.getElementById("wechat-insights").innerHTML = `<div class="wechat-insight-grid"><div class="wechat-insight-group"><strong>${isSocial ? "图文题材表现" : "题材表现"}</strong>${insights.topics?.length ? insights.topics.slice(0, 6).map(insightRow).join("") : '<div class="empty-state">暂无题材样本。</div>'}</div><div class="wechat-insight-group"><strong>${isSocial ? "发布文案结构表现" : "标题结构表现"}</strong>${insights.title_structures?.length ? insights.title_structures.slice(0, 6).map(insightRow).join("") : '<div class="empty-state">暂无结构样本。</div>'}</div></div><small class="wechat-insight-caveat">${escapeHtml(insights.summary?.caveat || "")}</small><div class="wechat-history-articles"><strong>${isSocial ? "已确认图文样本" : "历史文章识别（规则初判）"}</strong>${historicalArticles.map((item) => `<div class="wechat-history-article"><div><b>${escapeHtml(item.title)}</b><span class="wechat-labels">${labels(item)}</span></div><em>${fmt(item.reads)} 阅读 · ${fmt(item.follows_after_read)} 关注</em></div>`).join("")}</div>`;
  const latest = data.growth?.at(-1); const regular = data.regular_readers?.at(-1);
  document.getElementById("wechat-growth-summary").innerHTML = latest ? `<div><b>最新累计关注</b><strong>${fmt(latest.total_followers)}</strong><small>${escapeHtml(latest.stat_date)} · 当日净增 ${fmt(latest.net_followers)}</small></div>` : '<div class="empty-state">还没有用户增长数据。</div>';
  document.getElementById("wechat-regular-readers").innerHTML = regular ? `<div><b>最近常读用户</b><strong>${fmt(regular.regular_readers)}</strong><small>${escapeHtml(regular.period)} · 占比 ${rate(regular.regular_reader_rate)}</small></div>` : "";
  document.getElementById("wechat-channels").innerHTML = data.channels?.length ? data.channels.map((item) => `<div class="wechat-channel-row"><span>${escapeHtml(item.channel || "其他")}</span><i><em style="width:${Math.min(100, Number(item.reads || 0) / Math.max(1, Number(data.channels[0]?.reads || 1)) * 100)}%"></em></i><b>${fmt(item.reads)}</b></div>`).join("") : '<div class="empty-state">导入内容趋势文件后，这里会显示阅读来源。</div>';
}

function setMode(mode) {
  reviewMode = mode === "social" ? "social" : "article";
  document.querySelectorAll("[data-wechat-review-mode]").forEach((button) => {
    const active = button.dataset.wechatReviewMode === reviewMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (reviewData) render(reviewData);
}

async function load() { reviewData = await request("/api/wechat/review"); render(reviewData); }

function bind() {
  if (bound) return;
  bound = true;
  document.querySelectorAll("[data-wechat-review-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.wechatReviewMode)));
}

export default async function loadWechatReview() { bind(); await load(); }
