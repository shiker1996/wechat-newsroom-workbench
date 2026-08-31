import { request } from "../core/http.js";
import { escapeHtml, toast } from "../core/ui.js";

const sourceNames = { conversation: "AI 会话", reading: "阅读", life: "生活", project: "项目", text: "文本" };
let bound = false;
let materials = [];
let columns = [];

function level(level) {
  const labels = { high: "高", medium: "中", low: "低" };
  return `<span class="material-level material-level-${level || 'medium'}">${labels[level] || '中'}</span>`;
}

function renderColumns(columns) {
  document.getElementById("column-list").innerHTML = columns.length ? columns.map((column) => `<article class="column-card"><div><b>${escapeHtml(column.name)}</b><small>${escapeHtml(column.description || "还没有栏目说明")}</small></div><span>${(column.writing_modes || []).map((mode) => mode === "tutorial" ? "教程" : "经验").join(" / ")}</span></article>`).join("") : '<div class="empty-state">还没有主动写作栏目。</div>';
}

function renderAssessment(assessment) {
  if (!assessment?.account_fit) return '<p class="material-unassessed">尚未评估：点击“分析与推荐”，查看账号切合度、内容完整度、话题潜力和深挖方向。</p>';
  const signal = assessment.historical_signal;
  const signalLine = signal ? `<div class="assessment-line historical-signal"><b>历史表现软信号</b>${level(signal.level)}<span>${escapeHtml(signal.reason || "")} · 仅作优先验证参考</span></div>` : "";
  return `<div class="material-assessment"><div class="assessment-line"><b>账号切合度</b>${level(assessment.account_fit.level)}<span>${escapeHtml(assessment.account_fit.reason || "")}</span></div><div class="assessment-line"><b>内容完整度</b>${level(assessment.completeness.level)}<span>${escapeHtml(assessment.completeness.reason || "")}</span></div><div class="assessment-line"><b>话题潜力</b>${level(assessment.topic_potential.level)}<span>${escapeHtml(assessment.topic_potential.reason || "")}</span></div>${signalLine}<div class="deepening-line"><b>深挖方向</b><ul>${(assessment.deepening_directions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div><div class="title-direction-box"><b>标题技能 · 方向建议</b>${(assessment.title_directions || []).map((item) => `<span><em>${escapeHtml(item.intent)}</em>${escapeHtml(item.direction)}</span>`).join("")}</div></div>`;
}

function renderPlanningRecommendation(recommendation) {
  if (!recommendation) return '';
  const labels = { high: '优先', medium: '可验证', low: '待补充' };
  return `<div class="material-planning-recommendation"><div><b>复盘反哺 · ${escapeHtml(recommendation.target_label || '实验')}</b><span class="material-level material-level-${escapeHtml(recommendation.priority || 'low')}">${labels[recommendation.priority] || '待补充'}</span></div><p>${escapeHtml(recommendation.reason || '')}</p><small>题材：${escapeHtml(recommendation.recommended_topic || '—')} · 标题结构：${escapeHtml(recommendation.recommended_title_structure || '—')}</small><small>验证：${escapeHtml(recommendation.validation_question || '')}</small></div>`;
}

function renderMaterials() {
  const list = document.getElementById("material-list");
  document.getElementById("material-count").textContent = `${materials.length} 条`;
  if (!materials.length) { list.innerHTML = '<div class="empty-state">素材箱还是空的。先粘贴一段你真实写过、读过或经历过的东西。</div>'; return; }
  list.innerHTML = materials.map((item) => {
    const title = item.title || String(item.raw_text || "").split(/[\n。！？]/).find(Boolean)?.slice(0, 36) || "未命名素材";
    const recommendation = item.planning_recommendation;
    const columnOptions = columns.map((column) => `<option value="${column.id}" ${Number(column.id) === Number(item.recommended_column_id || item.assessment?.recommended_column_id) ? 'selected' : ''}>${escapeHtml(column.name)}</option>`).join('');
    const titleDirection = item.assessment?.title_directions?.[0]?.direction || (recommendation ? `${recommendation.recommended_topic} · ${recommendation.recommended_title_structure}` : '');
    return `<article class="material-card"><header><div><span class="material-source">${escapeHtml(sourceNames[item.source_type] || "文本")}</span><h4>${escapeHtml(title)}</h4><small>${escapeHtml(item.captured_at || "")}${item.recommended_column_name ? ` · ${escapeHtml(item.recommended_column_name)}` : ""}</small></div><span class="material-status-badge">${item.status === "planned" ? "已排期" : item.status === "developing" ? "整理中" : "待整理"}</span></header><p class="material-excerpt">${escapeHtml(String(item.raw_text || "").slice(0, 260))}${String(item.raw_text || "").length > 260 ? "…" : ""}</p>${item.tags?.length ? `<div class="material-tags">${item.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>` : ""}${renderPlanningRecommendation(recommendation)}<div class="material-card-actions"><button type="button" class="outline-button" data-material-assess="${item.id}">分析与推荐</button><button type="button" class="text-button" data-material-plan-toggle="${item.id}">排进内容日历</button></div><div class="material-assessment-wrap" data-assessment-for="${item.id}">${renderAssessment(item.assessment)}</div><form class="material-plan-form" data-material-plan-form="${item.id}" hidden><select name="columnId" aria-label="主动写作栏目"><option value="">选择栏目</option>${columnOptions}</select><input name="titleDirection" placeholder="标题方向，例如：真实经历 + 读者问题" value="${escapeHtml(titleDirection)}"><select name="titleIntent"><option value="搜索型">搜索型</option><option value="分享型">分享型</option><option value="观点型">观点型</option><option value="系列承接">系列承接</option></select><input type="date" name="plannedDate"><input name="teaser" placeholder="下一篇预告或验证方向" value="${escapeHtml(recommendation?.next_teaser || '')}"><button class="primary-button" type="submit">加入日历</button></form></article>`;
  }).join("");
}

async function load() {
  const status = document.getElementById("material-status-filter")?.value || "";
  const sort = document.getElementById("material-sort-filter")?.value || "latest";
  const [loadedColumns, loaded] = await Promise.all([request("/api/content-columns"), request(`/api/writing-materials?${new URLSearchParams({ ...(status ? { status } : {}), ...(sort === 'feedback' ? { sort } : {}) })}`)]);
  columns = loadedColumns; renderColumns(columns); materials = loaded; renderMaterials();
}

function bind() {
  if (bound) return; bound = true;
  window.addEventListener("material-created", () => load().catch((error) => toast(error.message, "error")));
  document.getElementById("material-capture-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    try { await request("/api/writing-materials", { method: "POST", body: JSON.stringify({ sourceType: data.get("sourceType"), capturedAt: data.get("capturedAt"), title: data.get("title"), rawText: data.get("rawText"), tags: String(data.get("tags") || "").split(/[，,]/).map((item) => item.trim()).filter(Boolean) }) }); form.reset(); form.querySelector('[name="capturedAt"]').value = new Date().toISOString().slice(0, 10); toast("素材已放入素材箱", "success"); await load(); } catch (error) { toast(error.message, "error"); }
  });
  document.getElementById("material-status-filter").addEventListener("change", () => load().catch((error) => toast(error.message, "error")));
  document.getElementById("material-sort-filter")?.addEventListener("change", () => load().catch((error) => toast(error.message, "error")));
  document.getElementById("toggle-column-form").addEventListener("click", () => { const form = document.getElementById("column-form"); form.hidden = !form.hidden; });
  document.getElementById("column-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const modes = [data.get("experience") ? "experience" : "", data.get("tutorial") ? "tutorial" : ""].filter(Boolean); try { await request("/api/content-columns", { method: "POST", body: JSON.stringify({ name: data.get("name"), description: data.get("description"), writingModes: modes }) }); form.reset(); form.querySelector('[name="experience"]').checked = true; form.hidden = true; toast("栏目已保存", "success"); await load(); } catch (error) { toast(error.message, "error"); } });
  document.addEventListener("click", async (event) => {
    const assess = event.target.closest("[data-material-assess]");
    if (assess) { assess.disabled = true; assess.textContent = "正在判断…"; try { await request(`/api/writing-materials/${assess.dataset.materialAssess}/assessment`, { method: "POST", body: "{}" }); await load(); } catch (error) { toast(error.message, "error"); } finally { assess.disabled = false; } }
    const toggle = event.target.closest("[data-material-plan-toggle]"); if (toggle) { const form = document.querySelector(`[data-material-plan-form="${toggle.dataset.materialPlanToggle}"]`); if (form) { form.hidden = !form.hidden; if (!form.hidden && !form.querySelector('[name="plannedDate"]').value) form.querySelector('[name="plannedDate"]').value = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10); } }
  });
  document.addEventListener("submit", async (event) => { const form = event.target.closest("[data-material-plan-form]"); if (!form) return; event.preventDefault(); const data = new FormData(form); try { await request("/api/writing-material-plans", { method: "POST", body: JSON.stringify({ materialId: Number(form.dataset.materialPlanForm), columnId: data.get("columnId") ? Number(data.get("columnId")) : null, titleDirection: data.get("titleDirection"), titleIntent: data.get("titleIntent"), plannedDate: data.get("plannedDate"), teaser: data.get("teaser"), status: "planned" }) }); toast("已加入内容日历", "success"); await load(); } catch (error) { toast(error.message, "error"); } });
}

export default async function loadMaterialInbox() {
  bind(); const date = document.querySelector('#material-capture-form [name="capturedAt"]'); if (date && !date.value) date.value = new Date().toISOString().slice(0, 10); await load();
}
