import { request, securityHeaders } from "../core/http.js";
import { escapeHtml, toast } from "../core/ui.js";

let bound = false;
let feedbackMode = "article";
let pageData = null;

const fmt = (value) => new Intl.NumberFormat("zh-CN").format(Number(value || 0));
const levelLabel = (value) => ({ high: "高", medium: "中", low: "低" }[value] || "低");

async function generateAdjustmentWithProgress(onProgress, scope = feedbackMode) {
  const headers = { ...(await securityHeaders()), "content-type": "application/json" };
  const response = await fetch("/api/wechat/feedback/adjustments/generate", { method: "POST", credentials: "same-origin", headers, body: JSON.stringify({ scope }) });
  if (!response.ok) {
    let data = {};
    try { data = await response.json(); } catch { /* 下面给出状态码 */ }
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;
  const consume = (text) => {
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "progress") onProgress(event);
      else if (event.type === "complete") result = event.draft;
      else if (event.type === "error") throw new Error(event.error || "生成草案失败");
    }
  };
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    consume(decoder.decode(chunk.value, { stream: true }));
  }
  consume(decoder.decode());
  if (buffer.trim()) {
    const event = JSON.parse(buffer);
    if (event.type === "complete") result = event.draft;
    else if (event.type === "error") throw new Error(event.error || "生成草案失败");
  }
  return result;
}

function feedbackSignal(signal, extra = "") {
  const performanceText = signal.avg_reads !== undefined
    ? `${fmt(signal.avg_reads)} 阅读/篇 · ${Number(signal.follows_per_thousand_reads || 0).toFixed(2)}/千阅读后关注`
    : "";
  return `<div class="wechat-feedback-signal"><div><b>${escapeHtml(signal.label || "未命名信号")}</b><span class="wechat-feedback-level ${signal.confidence || "low"}">${levelLabel(signal.confidence)}置信</span></div><small>${escapeHtml(performanceText || extra || signal.hypothesis || "")}</small>${signal.hypothesis ? `<p>${escapeHtml(signal.hypothesis)}</p>` : ""}</div>`;
}

function socialArtifactSignal(signal) {
  const present = signal.present || {};
  const absent = signal.absent || {};
  const presentText = `${fmt(present.avg_reads)} 阅读 · ${fmt(present.avg_shares)} 分享 · ${Number(present.follows_per_thousand_reads || 0).toFixed(2)} 关注/千阅读`;
  const absentText = absent.sample_count ? `${fmt(absent.avg_reads)} 阅读 · ${fmt(absent.avg_shares)} 分享 · ${Number(absent.follows_per_thousand_reads || 0).toFixed(2)} 关注/千阅读` : "无对照样本";
  return `<div class="wechat-feedback-signal social-artifact-signal"><div><b>${escapeHtml(signal.label || "未命名特征")}</b><span class="wechat-feedback-level ${signal.confidence || "low"}">${levelLabel(signal.confidence)}置信</span></div><small>有该特征 ${signal.sample_count || 0} 条：${escapeHtml(presentText)}</small><small>无该特征 ${absent.sample_count || 0} 条：${escapeHtml(absentText)}</small><p>${escapeHtml(signal.hypothesis || "")} ${signal.read_delta ? `阅读差 ${signal.read_delta > 0 ? "+" : ""}${fmt(signal.read_delta)}` : ""}</p></div>`;
}

function renderRecommendation(item) {
  const flow = item.type === "topic" ? "选题池评分" : item.type === "title" ? "标题生成技能" : item.type === "body" ? "写作技能" : item.type === "copy" ? "图文文案生成技能" : item.type === "storyboard" ? "图文故事板技能" : "内容规划流程";
  return `<div><span>${escapeHtml(item.target || "提示")}</span><p>${escapeHtml(item.text || "")}</p><em>${escapeHtml(item.basis || "")} · ${levelLabel(item.confidence)}置信 · 参考方向：${flow}</em></div>`;
}

function renderArticleFeedback(feedback) {
  const summary = document.getElementById("content-feedback-summary");
  const content = document.getElementById("content-feedback-content");
  const rebuild = document.getElementById("content-feedback-rebuild");
  const socialRebuild = document.getElementById("content-feedback-social-rebuild");
  if (rebuild) rebuild.hidden = false;
  if (socialRebuild) socialRebuild.hidden = true;
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
  const socialRebuild = document.getElementById("content-feedback-social-rebuild");
  if (rebuild) rebuild.hidden = true;
  if (socialRebuild) socialRebuild.hidden = false;
  if (!track?.count) {
    if (summary) summary.textContent = "暂无图文样本";
    if (content) content.innerHTML = '<div class="empty-state">暂无已确认的图文复盘样本。请先到“复盘数据台”确认图文发布文案与公众号数据的关联。</div>';
    return;
  }
  const artifactFeedback = track.content_feedback || {};
  if (summary) summary.textContent = `${track.count} 条图文 · 已分析文案 ${artifactFeedback.copy_ready_count || 0} · 故事板 ${artifactFeedback.storyboard_ready_count || 0}`;
  const insights = track.insights || {};
  const copySummary = artifactFeedback.copy_summary || {};
  const storyboardSummary = artifactFeedback.storyboard_summary || {};
  const layoutSummary = artifactFeedback.layout_summary || {};
  if (content) content.innerHTML = `<div class="wechat-feedback-meta"><span>样本范围：${escapeHtml(artifactFeedback.metric_window_start || "-")} — ${escapeHtml(artifactFeedback.metric_window_end || "-")}</span><span>文案成品：${artifactFeedback.copy_ready_count || 0}/${track.count} · 平均 ${fmt(copySummary.avg_chars || 0)} 字</span><span>故事板：${artifactFeedback.storyboard_ready_count || 0}/${track.count} · 平均 ${fmt(storyboardSummary.avg_pages || 0)} 页</span><span>布局报告：${artifactFeedback.layout_ready_count || 0}/${track.count}</span></div><div class="wechat-feedback-grid"><section><header><b>图文选题表现</b><small>反馈到图文选题池</small></header>${insights.topics?.length ? insights.topics.slice(0, 5).map((item) => feedbackSignal(item)).join("") : '<div class="empty-state">暂无题材样本</div>'}</section><section><header><b>发布文案成品</b><small>分析实际 copy.txt</small></header><div class="wechat-feedback-note-grid"><span>平均 ${fmt(copySummary.avg_paragraphs || 0)} 段</span><span>${Math.round(Number(copySummary.cta_rate || 0) * 100)}% 有行动提示</span><span>${Math.round(Number(copySummary.boundary_rate || 0) * 100)}% 有边界说明</span></div>${artifactFeedback.copy_signals?.length ? artifactFeedback.copy_signals.slice(0, 5).map(socialArtifactSignal).join("") : '<div class="empty-state">暂无文案成品特征</div>'}</section><section><header><b>故事板成品</b><small>分析实际 card-plan.json</small></header><div class="wechat-feedback-note-grid"><span>${Math.round(Number(storyboardSummary.complete_narrative_rate || 0) * 100)}% 有问题→能力叙事链</span><span>${Math.round(Number(storyboardSummary.evidence_binding_rate || 0) * 100)}% 有事实绑定</span><span>平均 ${fmt(storyboardSummary.avg_blocks_per_page || 0)} 块/页</span></div>${artifactFeedback.storyboard_signals?.length ? artifactFeedback.storyboard_signals.slice(0, 6).map(socialArtifactSignal).join("") : '<div class="empty-state">暂无故事板成品特征</div>'}</section><section><header><b>布局交付观察</b><small>只判断交付质量，不等同传播效果</small></header><div class="wechat-social-feedback-note"><b>已纳入布局报告</b><p>${escapeHtml(`报告覆盖 ${artifactFeedback.layout_ready_count || 0} 条，门禁通过率 ${Math.round(Number(layoutSummary.valid_rate || 0) * 100)}%，平均利用率 ${layoutSummary.avg_utilization || 0}%；发现 ${layoutSummary.issue_count || 0} 个问题、${layoutSummary.overflow_page_count || 0} 个溢出页。布局通过只能说明可交付，不能单独证明更涨粉。`)}</p></div></section></div><div class="wechat-feedback-recommendations"><header><b>图文下一轮可验证提示</b><small>作为故事板与文案技能调整的证据，不自动改写</small></header>${artifactFeedback.recommendations?.length ? artifactFeedback.recommendations.map(renderRecommendation).join("") : '<div class="empty-state">样本不足，暂不生成推荐。</div>'}</div>${artifactFeedback.unresolved_questions?.length ? `<details class="wechat-feedback-questions"><summary>分析边界（${artifactFeedback.unresolved_questions.length}）</summary><ul>${artifactFeedback.unresolved_questions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>` : ""}`;
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

function diffOps(oldText, newText) {
  const before = String(oldText || '').split(/\r?\n/); const after = String(newText || '').split(/\r?\n/);
  const rows = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));
  for (let i = before.length - 1; i >= 0; i -= 1) for (let j = after.length - 1; j >= 0; j -= 1) rows[i][j] = before[i] === after[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  const ops = []; let i = 0; let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) { ops.push({ type: 'equal', oldLine: i + 1, newLine: j + 1, oldText: before[i], newText: after[j] }); i += 1; j += 1; }
    else if (j >= after.length || (i < before.length && rows[i + 1][j] >= rows[i][j + 1])) { ops.push({ type: 'removed', oldLine: i + 1, newLine: null, oldText: before[i], newText: '' }); i += 1; }
    else { ops.push({ type: 'added', oldLine: null, newLine: j + 1, oldText: '', newText: after[j] }); j += 1; }
  }
  return ops;
}

function visibleDiffOps(ops, context = 2) {
  const changed = ops.map((item, index) => item.type !== 'equal' ? index : -1).filter((index) => index >= 0);
  if (!changed.length) return ops;
  const visible = new Set();
  for (const index of changed) for (let cursor = Math.max(0, index - context); cursor <= Math.min(ops.length - 1, index + context); cursor += 1) visible.add(cursor);
  const output = []; let collapsed = false;
  ops.forEach((item, index) => {
    if (visible.has(index)) { output.push(item); collapsed = false; }
    else if (!collapsed) { output.push({ type: 'collapsed' }); collapsed = true; }
  });
  return output;
}

function pairDiffOps(ops) {
  const rows = [];
  for (let index = 0; index < ops.length; index += 1) {
    const item = ops[index];
    if (item.type === 'removed') {
      const removed = []; const added = [];
      while (ops[index]?.type === 'removed') { removed.push(ops[index]); index += 1; }
      while (ops[index]?.type === 'added') { added.push(ops[index]); index += 1; }
      index -= 1;
      const count = Math.max(removed.length, added.length);
      for (let cursor = 0; cursor < count; cursor += 1) rows.push({ type: removed[cursor] && added[cursor] ? 'changed' : removed[cursor] ? 'removed' : 'added', old: removed[cursor] || null, next: added[cursor] || null });
    } else if (item.type === 'added') rows.push({ type: 'added', old: null, next: item });
    else if (item.type === 'equal') rows.push({ type: 'equal', old: item, next: item });
    else if (item.type === 'collapsed') rows.push(item);
  }
  return rows;
}

function sideDiff(oldText, newText, { oldLabel = '原文件', newLabel = '修改后草案' } = {}) {
  const ops = diffOps(oldText, newText); const rows = pairDiffOps(visibleDiffOps(ops));
  const header = `<div class="adjustment-diff-head"><div><b>${escapeHtml(oldLabel)}</b><span>当前版本</span></div><div><b>${escapeHtml(newLabel)}</b><span>待确认版本</span></div></div>`;
  const body = rows.map((row) => {
    if (row.type === 'collapsed') return '<div class="adjustment-diff-collapsed"><span>···</span><small>中间内容未变化</small><span>···</span></div>';
    const oldCell = row.old ? `<span class="adjustment-diff-number">${row.old.oldLine}</span><code>${escapeHtml(row.old.oldText)}</code>` : '<span class="adjustment-diff-number">·</span><code></code>';
    const newCell = row.next ? `<span class="adjustment-diff-number">${row.next.newLine}</span><code>${escapeHtml(row.next.newText)}</code>` : '<span class="adjustment-diff-number">·</span><code></code>';
    return `<div class="adjustment-diff-row ${row.type}"><div class="adjustment-diff-side old">${oldCell}</div><div class="adjustment-diff-side new">${newCell}</div></div>`;
  }).join('');
  return `${header}${body || '<div class="adjustment-diff-empty">没有文本变化</div>'}`;
}

function changeDiff(change) {
  let oldText = change.old_content; let newText = change.new_content;
  if (change.kind === 'json') {
    try { oldText = JSON.stringify(JSON.parse(oldText || '{}'), null, 2); newText = JSON.stringify(JSON.parse(newText || '{}'), null, 2); } catch { /* Fall back to the raw JSON text. */ }
  }
  return sideDiff(oldText, newText, { oldLabel: change.source_path || '原文件', newLabel: change.path || '修改后草案' });
}

function adjustmentSelection(draft, skillLabels) {
  const scope = draft.source?.scope === 'social' ? 'social' : 'article';
  if (scope === 'social') {
    const targets = (draft.source?.targets || []).map((item) => `${item.role === 'storyboard' ? '故事板' : '文案'}：${item.skill_id}`);
    return { scope, label: 'AI 判定的图文技能', value: targets.join('、') || '图文故事板与文案技能', reason: '故事板负责页面结构与节奏，文案技能负责标题、逐页文案和发布文案。' };
  }
  const writerSkillId = draft.source?.writer_skill_id || '';
  const writerSkillLabel = skillLabels[writerSkillId] || writerSkillId || '本次不修改正文技能';
  const writerSkillMode = draft.source?.writer_skill_selection_source === 'ai_inference' ? '（AI 推断）' : '';
  return { scope, label: 'AI 判定的正文写作技能', value: writerSkillLabel + writerSkillMode, reason: draft.source?.writer_skill_reason || '正文样本没有足够的题材与正文结构信号，暂不修改正文技能。' };
}

function renderAdjustments(data = {}) {
  const skillLabels = Object.fromEntries((data.writerSkills || []).map((item) => [item.id || item, item.label || item.id || item]));
  const version = data.version || 'v6';
  const list = document.getElementById('content-feedback-adjustment-list');
  if (!list) return;
  const items = data.items || [];
  if (!items.length) { list.innerHTML = '<div class="empty-state">还没有调整草案。生成后会先在这里展示 diff，不会立即修改文件。</div>'; return; }
  list.innerHTML = items.slice(0, 5).map((draft) => { const selection = adjustmentSelection(draft, skillLabels); const stale = draft.status === 'pending' && draft.source?.adjustment_version !== version; const status = stale ? '已过期' : draft.status === 'pending' ? '待确认' : draft.status === 'confirmed' ? '已写入' : '已跳过'; return `<article class="feedback-adjustment-draft ${draft.status} ${stale ? 'stale' : ''}"><header><div><b>${escapeHtml(draft.summary || '复盘调整草案')}</b><span class="feedback-adjustment-scope">${selection.scope === 'social' ? '图文' : '文章'}</span><span class="feedback-adjustment-status ${stale ? 'stale' : draft.status}">${status}</span></div><small>${escapeHtml(String(draft.generated_at || '').slice(0, 16).replace('T', ' '))} · ${draft.changes?.length || 0} 个文件</small></header><div class="feedback-adjustment-selection"><b>${escapeHtml(selection.label)}</b><strong>${escapeHtml(selection.value)}</strong><span>${escapeHtml(selection.reason)}</span></div>${draft.warnings?.length ? `<div class="feedback-adjustment-warnings">${draft.warnings.map((item) => `<span>· ${escapeHtml(item)}</span>`).join('')}</div>` : ''}<div class="feedback-adjustment-changes">${(draft.changes || []).map((change) => `<details><summary><b>${escapeHtml(change.label || change.path)}</b><span>${escapeHtml(change.path)}</span></summary>${change.reason ? `<div class="feedback-adjustment-rationale"><small>调整依据（不写入文件）</small><p>${escapeHtml(change.reason)}</p></div>` : ''}<div class="adjustment-diff"><small class="feedback-adjustment-diff-label">变更对照</small>${changeDiff(change)}</div></details>`).join('')}</div>${stale ? `<div class="feedback-adjustment-actions"><span class="feedback-adjustment-stale-note">这份草案由旧版规则生成，请重新生成。</span><button type="button" class="text-button" data-feedback-adjustment-action="reject" data-feedback-adjustment-id="${Number(draft.id)}">移除旧草案</button></div>` : draft.status === 'pending' ? `<div class="feedback-adjustment-actions"><button type="button" class="primary-button" data-feedback-adjustment-action="confirm" data-feedback-adjustment-id="${Number(draft.id)}">确认写入</button><button type="button" class="text-button" data-feedback-adjustment-action="reject" data-feedback-adjustment-id="${Number(draft.id)}">跳过草案</button></div>` : draft.status === 'rejected' ? `<div class="feedback-adjustment-actions"><span class="feedback-adjustment-stale-note">已跳过，仅保留草案记录。</span><button type="button" class="text-button" data-feedback-adjustment-action="delete" data-feedback-adjustment-id="${Number(draft.id)}">删除记录</button></div>` : ''}</article>`; }).join('');
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
  renderAdjustments(data.adjustments || {});
  const fixedTargets = document.getElementById('content-feedback-fixed-targets');
  const autoTarget = document.getElementById('content-feedback-auto-target');
  const socialMode = feedbackMode === 'social';
  if (fixedTargets) fixedTargets.innerHTML = socialMode ? '<b>图文反哺目标</b><span>故事板技能</span><span>文案生成技能</span>' : '<b>固定检查目标</b><span>账号策略与选题评分</span><span>标题生成技能</span>';
  if (autoTarget) autoTarget.innerHTML = socialMode ? '<b>技能定位方式</b><strong>按实际执行记录自动判定</strong><small>第一阶段识别真实使用的故事板与文案技能，第二阶段只融合到对应技能原有章节。</small>' : '<b>正文写作技能</b><strong>由 AI 自动判定落点</strong><small>第一阶段选择最匹配的正文技能，第二阶段只修改该技能原有章节，不新增复盘章节。</small>';
  const strategyPanel = document.getElementById('content-strategy-panel');
  if (strategyPanel) strategyPanel.hidden = feedbackMode === 'social';
  if (feedbackMode === "social") renderSocialFeedback(social);
  else renderArticleFeedback(feedback);
}

function setMode(mode) {
  feedbackMode = mode === "social" ? "social" : "article";
  const generateButton = document.getElementById('content-feedback-generate-adjustment');
  if (generateButton && !generateButton.disabled) generateButton.textContent = feedbackMode === 'social' ? 'AI 生成图文技能草案' : 'AI 两阶段生成草案';
  document.querySelectorAll("[data-content-feedback-mode]").forEach((button) => {
    const active = button.dataset.contentFeedbackMode === feedbackMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (pageData) render(pageData);
}

async function load() {
  const [feedback, strategy, review, adjustments] = await Promise.all([
    request("/api/wechat/feedback"),
    request("/api/wechat/strategy"),
    request("/api/wechat/review"),
    request("/api/wechat/feedback/adjustments"),
  ]);
  render({ feedback: feedback.feedback, feedbackStats: feedback.stats, strategy, review, adjustments });
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
  document.getElementById("content-feedback-social-rebuild")?.addEventListener("click", async () => {
    const button = document.getElementById("content-feedback-social-rebuild");
    button.disabled = true; button.textContent = "提取中…";
    try { const result = await request("/api/wechat/feedback/rebuild-social", { method: "POST", body: "{}" }); toast(`图文反馈已重新生成：${result.count || 0} 条样本`, "success"); await load(); }
    catch (error) { toast(error.message, "error"); }
    finally { button.disabled = false; button.textContent = "重新生成图文反馈"; }
  });
  document.getElementById('content-feedback-generate-adjustment')?.addEventListener('click', async () => {
    const button = document.getElementById('content-feedback-generate-adjustment');
    const progress = document.getElementById('content-feedback-adjustment-progress');
    button.disabled = true; button.textContent = '生成中…';
    if (progress) { progress.hidden = false; progress.className = 'feedback-adjustment-progress active'; progress.textContent = '正在准备…'; }
    try {
      const generated = await generateAdjustmentWithProgress((event) => {
        if (progress) { progress.hidden = false; progress.className = `feedback-adjustment-progress active ${event.stage || ''}`; progress.textContent = event.message || '处理中…'; }
        button.textContent = event.stage === 'planning' ? '判断目标…' : event.stage === 'patch' ? '生成 diff…' : event.stage === 'validate' ? '保存草案…' : '处理中…';
      }, feedbackMode);
      if (progress) { progress.className = 'feedback-adjustment-progress done'; progress.textContent = generated?.status === 'no_change' ? '✓ 未发现需要调整的规则，未创建草案' : '✓ 草案已生成，请检查 diff'; }
      toast(generated?.status === 'no_change' ? 'AI 判断当前没有可安全写入的规则修改，未创建草案' : 'AI 已完成两阶段判断和精确修改草案，请检查 diff 后确认写入', 'success'); await load();
    }
    catch (error) { if (progress) { progress.className = 'feedback-adjustment-progress error'; progress.textContent = `生成失败：${error.message}`; } toast(error.message, 'error'); }
    finally { button.disabled = false; button.textContent = feedbackMode === 'social' ? 'AI 生成图文技能草案' : 'AI 两阶段生成草案'; }
  });
  document.getElementById('content-feedback-adjustment-list')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-feedback-adjustment-action]'); if (!button) return;
    const action = button.dataset.feedbackAdjustmentAction; const id = button.dataset.feedbackAdjustmentId;
    button.disabled = true;
    if (action === 'delete' && !window.confirm('删除这份已跳过的草案记录？不会影响已写入的配置和技能文件。')) { button.disabled = false; return; }
    try { await request(`/api/wechat/feedback/adjustments/${id}/${action}`, { method: 'POST', body: '{}' }); toast(action === 'confirm' ? '草案已确认写入' : action === 'delete' ? '草案记录已删除' : '草案已跳过', 'success'); await load(); }
    catch (error) { toast(error.message, 'error'); button.disabled = false; }
  });
}

export default async function loadContentFeedback() { bind(); await load(); }
