import { request } from "../core/http.js";
import { escapeHtml, formatDate, openArtifactPreview, toast } from "../core/ui.js";

const formatMetric = (value) => new Intl.NumberFormat("zh-CN").format(Number(value || 0));
const PUBLICATION_ARTIFACT_TYPES = new Set(["文章终稿", "图文发布文案"]);
let publicationItems = [];
let publicationFilter = "all";
let publicationQuery = "";

function articleStatus(status) {
  return { indexed: "已索引", ambiguous: "待确认", unreadable: "不可读取" }[status] || status || "未知";
}

function isPublicationArtifact(item) {
  return PUBLICATION_ARTIFACT_TYPES.has(item?.artifact_type);
}

function publicationState(item) {
  if (item.artifact_type === "图文发布文案") return { id: "social", label: "图文文案" };
  if (item.metric_match_count) return { id: "reviewed", label: "已复盘" };
  if (item.content_url) return { id: "published", label: "已发布" };
  return { id: "pending", label: "待发布" };
}

function visiblePublicationItems() {
  const query = publicationQuery.trim().toLowerCase();
  return publicationItems.filter((item) => {
    const state = publicationState(item);
    const searchable = `${item.title || ""} ${item.relative_path || item.file_path || ""}`.toLowerCase();
    return (publicationFilter === "all" || state.id === publicationFilter) && (!query || searchable.includes(query));
  });
}

function renderPublicationList() {
  const list = document.getElementById("article-index-list");
  if (!list) return;
  const items = visiblePublicationItems();
  const emptyText = publicationQuery.trim() || publicationFilter !== "all"
    ? "没有符合当前筛选的发布候选。可以切回“全部”，或前往产物中心查看所有中间产物。"
    : "点击“建立发布索引”，扫描本机终稿和图文发布文案。";
  list.innerHTML = items.length ? items.map((item) => {
    const state = publicationState(item);
    return `<article class="article-index-row ${item.status === "ambiguous" ? "is-ambiguous" : ""}">
      <div class="article-index-main"><div class="article-index-kicker"><time>${escapeHtml(item.article_date || "无日期")}</time><span>${escapeHtml(item.version_label || item.artifact_type)}</span><em class="article-index-status ${item.status}">${escapeHtml(articleStatus(item.status))}</em><em class="publication-state publication-state-${state.id}">${state.label}</em></div>
        <h3>${escapeHtml(item.title || "未识别标题")}</h3><p>${escapeHtml(item.relative_path || item.file_path || item.name || "")}</p>
        <div class="article-index-links">${item.artifact_type === "图文发布文案" ? "<span>图文发布文案</span>" : ""}${item.document_id ? "<span>文档已关联</span>" : ""}${item.plan_id ? `<span>计划：${escapeHtml(item.plan_title || "已关联")}</span>` : ""}${item.column_name ? `<span>栏目：${escapeHtml(item.column_name)}</span>` : ""}${item.evidence_paths?.length ? `<span>证据线索 ${item.evidence_paths.length} 个</span>` : ""}${item.metric_match_count ? `<span class="article-index-performance">公众号：${formatMetric(item.metric_reads)} 阅读 · ${formatMetric(item.metric_shares)} 分享 · ${formatMetric(item.metric_follows)} 关注</span>` : "<span>尚未关联公众号数据</span>"}${item.content_url ? `<a href="${escapeHtml(item.content_url)}" target="_blank" rel="noopener">打开发布页 ↗</a>` : ""}</div>
      </div>${item.artifact_id ? `<button type="button" class="text-button article-index-open" data-article-artifact="${item.artifact_id}">打开产物</button>` : ""}
    </article>`;
  }).join("") : `<div class="empty-state">${emptyText}</div>`;
}

function renderArticleIndex(data) {
  const allItems = data?.items || [];
  publicationItems = allItems.filter(isPublicationArtifact);
  const items = publicationItems;
  const stats = data?.stats || {};
  const finalCount = items.filter((item) => item.artifact_type === "文章终稿").length;
  const copyCount = items.filter((item) => item.artifact_type === "图文发布文案").length;
  const linkedPlanCount = items.filter((item) => item.plan_id != null).length;
  const evidenceCount = items.filter((item) => item.evidence_paths?.length).length;
  const matchedCount = items.filter((item) => item.metric_match_count).length;
  const statsEl = document.getElementById("article-index-stats");
  if (statsEl) statsEl.innerHTML = [
    ["可发布终稿", finalCount], ["图文发布文案", copyCount],
    ["已关联计划", linkedPlanCount], ["含证据线索", evidenceCount], ["已有公众号数据", matchedCount || stats.matched_metrics || 0],
  ].map(([label, value]) => `<span><b>${value}</b>${label}</span>`).join("");
  const run = stats.latest_run;
  const statusEl = document.getElementById("article-index-status");
  if (statusEl) statusEl.textContent = run ? `上次扫描 ${formatDate(run.finished_at || run.started_at)} · ${run.indexed_count} 条` : "尚未扫描";
  renderPublicationList();
}

async function loadPublicationIndex() {
  const data = await request("/api/article-artifacts?limit=1000");
  renderArticleIndex(data);
}

async function reindexPublication() {
  const result = await request("/api/article-artifacts/reindex", { method: "POST" });
  toast(`发布索引已更新：${result.indexed} 条终稿/文案候选`, "success");
  await loadPublicationIndex();
}

let bound = false;
function bindPublication() {
  if (bound) return;
  bound = true;
  document.getElementById("publication-reindex-button")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "刷新中…";
    try { await reindexPublication(); }
    catch (error) { toast(error.message, "error"); }
    finally { button.disabled = false; button.textContent = "刷新发布索引"; }
  });
  document.getElementById("article-index-reindex")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "扫描中…";
    try { await reindexPublication(); }
    catch (error) { toast(error.message, "error"); }
    finally { button.disabled = false; button.textContent = "建立发布索引"; }
  });
  document.querySelectorAll("[data-publication-filter]").forEach((button) => button.addEventListener("click", () => {
    publicationFilter = button.dataset.publicationFilter || "all";
    document.querySelectorAll("[data-publication-filter]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    renderPublicationList();
  }));
  document.getElementById("publication-query")?.addEventListener("input", (event) => {
    publicationQuery = event.currentTarget.value || "";
    renderPublicationList();
  });
  document.addEventListener("click", (event) => {
    const indexedArtifact = event.target.closest("[data-article-artifact]");
    if (indexedArtifact && indexedArtifact.closest("#view-publication")) openArtifactPreview(`/api/artifacts/${indexedArtifact.dataset.articleArtifact}/preview`, {
      originalUrl: `/api/artifacts/${indexedArtifact.dataset.articleArtifact}/content`,
    });
  });
}

export default async function loadPublicationView() {
  bindPublication();
  const stats = await request("/api/articles/stats").catch(() => null);
  const statsEl = document.getElementById("publication-article-stats");
  if (stats && statsEl) statsEl.innerHTML = [
    ["累计", stats.totalFinal, "篇已完结文章"],
    ["本月", stats.thisMonth, "篇"],
    ["本周", stats.thisWeek, "篇"],
  ].map(([label, value, note]) => `<div class="article-stat"><strong>${value}</strong><span>${label}<br><small>${note}</small></span></div>`).join("");
  return loadPublicationIndex();
}
