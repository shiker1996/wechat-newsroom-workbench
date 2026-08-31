import { request } from "../core/http.js";
import { escapeHtml, toast } from "../core/ui.js";

let bound = false;
const fmt = (value) => new Intl.NumberFormat("zh-CN").format(Number(value || 0));
const matchMethod = { url_exact: "URL 精确", title_exact: "终稿标题精确", title_normalized: "终稿标题规范化", title_date_similarity: "终稿标题 + 日期相似", social_copy_exact: "图文发布文案精确", social_copy_normalized: "图文文案规范化", social_copy_similarity: "图文文案 + 日期相似", mixed_candidates: "终稿 / 图文文案相似" };
const matchStatus = { auto_confirmed: "已自动关联", confirmed: "已人工确认", pending: "待人工确认", rejected: "已拒绝", unmatched: "待判定" };
const contentSource = { local_final: "本地终稿", local_reviewed: "本地审阅稿", local_humanized: "本地去 AI 稿", local_draft: "本地初稿", local_html: "本地排版 HTML", external_url: "公开 URL" };

function renderMatches(data) {
  const stats = data?.stats || {};
  const summary = document.getElementById("wechat-prep-match-summary");
  if (summary) summary.textContent = `待确认 ${stats.pending || 0} · 自动关联 ${stats.auto_confirmed || 0} · 待判定 ${stats.unmatched || 0}`;
  const list = document.getElementById("wechat-prep-match-list");
  if (!list) return;
  const pending = (data?.items || []).filter((item) => item.status === "pending");
  const unmatched = (data?.items || []).filter((item) => item.status === "unmatched");
  if (!pending.length && !unmatched.length) {
    list.innerHTML = '<div class="empty-state">暂无需要人工确认的匹配。导入公众号数据并建立本地文章索引后，这里会出现匹配候选。</div>';
    return;
  }
  const pendingMarkup = pending.map((item) => `<article class="wechat-match-row"><header><div><strong>${escapeHtml(item.metric_title || "未命名内容")}</strong><small>${escapeHtml(item.published_date || "无日期")} · ${fmt(item.reads)} 阅读 · ${fmt(item.shares)} 分享 · ${fmt(item.follows_after_read)} 阅读后关注</small></div><span class="wechat-match-state pending">${escapeHtml(matchStatus[item.status] || item.status || "待确认")}</span></header><div class="wechat-match-meta"><span>识别方式：${escapeHtml(matchMethod[item.match_method] || item.match_method || "未知")}</span><span>置信度：${escapeHtml(item.confidence || "低")}</span><span>${item.notified ? "已通知" : "未通知"}</span></div><div class="wechat-match-candidates">${(item.candidate_snapshot || []).map((candidate) => `<button type="button" class="wechat-match-candidate" data-wechat-confirm="${item.id}" data-wechat-artifact="${candidate.id}"><span>${escapeHtml(candidate.title || "未命名产物")}</span><small>${escapeHtml(candidate.version_label || candidate.artifact_type || "文章产物")} · ${escapeHtml(candidate.article_date || "无日期")} · 相似度 ${Math.round(Number(candidate.score || 0) * 100)}%</small></button>`).join("")}</div><button type="button" class="text-button wechat-match-reject" data-wechat-reject="${item.id}">这不是同一篇内容</button></article>`).join("");
  const artifactOptions = (data?.artifacts || []).map((artifact) => { const social = artifact.artifact_type === "图文发布文案"; const daily = artifact.artifact_type === "早报终稿"; const label = social ? "图文" : daily ? "早报" : "文章"; return `<option value="${Number(artifact.id)}" data-wechat-artifact-type="${social ? "social" : "article"}">[${label}] ${escapeHtml(artifact.title || "未命名产物")} · ${escapeHtml(artifact.article_date || "无日期")}</option>`; }).join("");
  const unmatchedMarkup = unmatched.map((item) => `<article class="wechat-match-row wechat-match-row-unmatched" data-wechat-unmatched-row="${item.id}"><header><div><strong>${escapeHtml(item.metric_title || "未命名内容")}</strong><small>${escapeHtml(item.published_date || "无日期")} · ${fmt(item.reads)} 阅读 · ${fmt(item.shares)} 分享 · ${fmt(item.follows_after_read)} 阅读后关注</small></div><span class="wechat-match-state unmatched">${escapeHtml(matchStatus[item.status] || "待判定")}</span></header><div class="wechat-match-meta"><span>尚未找到本地产物</span><span>${item.notified ? "已通知" : "未通知"}</span><span>请选择内容类型后手动匹配，或跳过本地产物匹配</span></div><div class="wechat-match-manual"><label>内容类型<select data-wechat-type><option value="">请选择</option><option value="article">文章</option><option value="social">图文</option></select></label><label>本地产物<select data-wechat-artifact><option value="">选择可选产物（可不选）</option>${artifactOptions}</select></label><button type="button" class="outline-button" data-wechat-manual-match="${item.id}">匹配产物</button><button type="button" class="text-button" data-wechat-skip="${item.id}">跳过匹配</button></div></article>`).join("");
  list.innerHTML = `${pendingMarkup ? `<div class="wechat-match-group"><strong>待人工确认（${pending.length}）</strong>${pendingMarkup}</div>` : ""}${unmatchedMarkup ? `<div class="wechat-match-group"><strong>待判定（${unmatched.length}）</strong>${unmatchedMarkup}</div>` : ""}`;
}

function syncArtifactOptions(row) {
  const type = row.querySelector("[data-wechat-type]")?.value || "";
  const select = row.querySelector("[data-wechat-artifact]");
  if (!select) return;
  for (const option of select.querySelectorAll("option[data-wechat-artifact-type]")) {
    const visible = !type || option.dataset.wechatArtifactType === type;
    option.hidden = !visible;
    option.disabled = !visible;
  }
  if (select.selectedOptions[0]?.disabled) select.value = "";
}

function renderContentLinks(data) {
  const items = data?.items || [];
  const linked = items.filter((item) => item.content_status === "ok").length;
  const socialCopies = items.filter((item) => item.artifact_type === "图文发布文案").length;
  const evidenceCount = items.reduce((sum, item) => sum + (item.evidence_assets || []).length, 0);
  const externalErrors = items.filter((item) => item.content_status === "error").length;
  const summary = document.getElementById("wechat-prep-content-summary");
  if (summary) summary.textContent = `${linked} 篇已有正文 · ${socialCopies} 篇图文文案 · ${evidenceCount} 个证据${externalErrors ? ` · ${externalErrors} 条待处理` : ""}`;
  const list = document.getElementById("wechat-prep-content-list");
  if (!list) return;
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

async function loadMatches() { renderMatches(await request("/api/wechat/matches?limit=200")); }
async function loadContentLinks() { renderContentLinks(await request("/api/wechat/content-links?limit=200")); }
async function load() { await Promise.all([loadMatches(), loadContentLinks()]); }

function scrollToPrepSection(id, focusImport = false) {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  if (focusImport) window.setTimeout(() => document.getElementById("wechat-prep-import-file")?.focus(), 260);
}

function bind() {
  if (bound) return;
  bound = true;
  document.getElementById("wechat-prep-import-file")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    const status = document.getElementById("wechat-prep-import-status");
    if (!status) return;
    if (!file) { status.textContent = ""; return; }
    const type = document.getElementById("wechat-prep-import-type")?.selectedOptions?.[0]?.textContent || "当前类型";
    status.textContent = `已选择：${file.name} · ${type}，点击“导入并合并”继续`;
  });
  document.getElementById("wechat-prep-import-submit")?.addEventListener("click", async () => {
    const file = document.getElementById("wechat-prep-import-file")?.files?.[0];
    const type = document.getElementById("wechat-prep-import-type")?.value;
    const status = document.getElementById("wechat-prep-import-status");
    if (!file) { toast("请先选择一个导出文件", "error"); return; }
    if (status) status.textContent = "正在解析并合并…";
    try {
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",").pop()); reader.onerror = reject; reader.readAsDataURL(file); });
      const result = await request("/api/wechat/import", { method: "POST", body: JSON.stringify({ fileName: file.name, importType: type, data }) });
      if (status) status.textContent = `导入完成 · 自动关联 ${result.matches?.matched || 0} 条，待确认 ${result.matches?.pending || 0} 条`;
      toast("公众号数据已合并并完成初步匹配", "success");
      const input = document.getElementById("wechat-prep-import-file"); if (input) input.value = "";
      await load();
    } catch (error) { if (status) status.textContent = error.message; toast(error.message, "error"); }
  });
  document.getElementById("wechat-prep-rematch")?.addEventListener("click", async () => {
    const button = document.getElementById("wechat-prep-rematch"); button.disabled = true; button.textContent = "匹配中…";
    try { const result = await request("/api/wechat/matches/rematch", { method: "POST", body: "{}" }); toast(`重新匹配完成：自动关联 ${result.matched} 条，待确认 ${result.pending} 条`, "success"); await load(); }
    catch (error) { toast(error.message, "error"); }
    finally { button.disabled = false; button.textContent = "重新匹配"; }
  });
  document.getElementById("wechat-prep-content-relink")?.addEventListener("click", async () => {
    const button = document.getElementById("wechat-prep-content-relink"); button.disabled = true; button.textContent = "关联中…";
    try { const result = await request("/api/wechat/content-links/relink", { method: "POST", body: "{}" }); toast(`本地正文关联完成：${result.linked} 篇正文、${result.social_copy || 0} 篇图文文案${result.needs_external ? `，${result.needs_external} 篇可尝试公开 URL` : ""}`, "success"); await load(); }
    catch (error) { toast(error.message, "error"); }
    finally { button.disabled = false; button.textContent = "关联本地正文"; }
  });
  document.addEventListener("click", async (event) => {
    const anchor = event.target.closest("[data-wechat-prep-anchor]");
    const focusImport = event.target.closest("[data-wechat-focus-import]");
    if (anchor) { scrollToPrepSection(anchor.dataset.wechatPrepAnchor); return; }
    if (focusImport) { scrollToPrepSection("wechat-prep-import-panel", true); return; }
    const confirm = event.target.closest("[data-wechat-confirm]");
    const reject = event.target.closest("[data-wechat-reject]");
    const fetchContent = event.target.closest("[data-wechat-fetch-content]");
    const manualMatch = event.target.closest("[data-wechat-manual-match]");
    const skip = event.target.closest("[data-wechat-skip]");
    if (fetchContent) {
      fetchContent.disabled = true; fetchContent.textContent = "获取中…";
      try { const result = await request(`/api/wechat/content-links/${fetchContent.dataset.wechatFetchContent}/fetch`, { method: "POST", body: "{}" }); toast(result.status === "linked_external" ? "公开正文已保存" : result.status === "local_exists" ? "本地正文已存在，未覆盖" : result.error || "公开正文获取失败", result.status === "error" ? "error" : "success"); await load(); }
      catch (error) { toast(error.message, "error"); fetchContent.disabled = false; fetchContent.textContent = "获取公开正文"; }
      return;
    }
    if (manualMatch || skip) {
      const row = (manualMatch || skip).closest("[data-wechat-unmatched-row]");
      const contentType = row?.querySelector("[data-wechat-type]")?.value || "";
      const artifactId = Number(row?.querySelector("[data-wechat-artifact]")?.value || 0);
      if (!contentType) { toast("请先选择内容类型", "error"); return; }
      if (manualMatch && !artifactId) { toast("请选择要匹配的本地产物", "error"); return; }
      const button = manualMatch || skip; button.disabled = true;
      try {
        await request(`/api/wechat/matches/${manualMatch?.dataset.wechatManualMatch || skip.dataset.wechatSkip}`, { method: "PATCH", body: JSON.stringify({ action: manualMatch ? "confirm" : "skip", contentType, ...(manualMatch ? { articleArtifactId: artifactId } : {}) }) });
        toast(manualMatch ? "已手动匹配本地产物" : "已跳过本地产物匹配", "success"); await load();
      } catch (error) { toast(error.message, "error"); button.disabled = false; }
      return;
    }
    if (!confirm && !reject) return;
    const button = confirm || reject; button.disabled = true;
    try { await request(`/api/wechat/matches/${confirm?.dataset.wechatConfirm || reject.dataset.wechatReject}`, { method: "PATCH", body: JSON.stringify(confirm ? { action: "confirm", articleArtifactId: Number(confirm.dataset.wechatArtifact) } : { action: "reject" }) }); toast(confirm ? "已确认产物关联" : "已拒绝该候选", "success"); await load(); }
    catch (error) { toast(error.message, "error"); button.disabled = false; }
  });
  document.addEventListener("change", (event) => {
    const type = event.target.closest("[data-wechat-type]");
    if (type) syncArtifactOptions(type.closest("[data-wechat-unmatched-row]"));
  });
}

export default async function loadWechatReviewPrep() { bind(); await load(); }
