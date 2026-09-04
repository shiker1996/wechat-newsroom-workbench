import { request } from "../core/http.js";
import { escapeHtml, toast } from "../core/ui.js";
import { state } from "../core/state.js";

const sourceNames = { conversation: "AI 会话", reading: "阅读", life: "生活", project: "项目", text: "文本" };
const statusNames = { inbox: "待整理", developing: "整理中", planned: "已计划", archived: "归档" };
const statusLabels = ["inbox", "developing", "planned", "archived"];
let bound = false;
let materials = [];
let columns = [];
const selectedMaterialIds = new Set();
let editingMaterialId = null;

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

function mainlineBadge(material) {
  const status = material.mainline_status || "未提炼";
  const cls = status === "已锁定" ? "locked" : status === "有候选" ? "candidate" : "none";
  return `<span class="material-mainline-badge ${cls}">主线：${escapeHtml(status)}</span>`;
}

function renderMaterials() {
  const list = document.getElementById("material-list");
  document.getElementById("material-count").textContent = `${materials.length} 条`;
  syncSelectionToolbar();
  if (!materials.length) { list.innerHTML = '<div class="empty-state">素材箱还是空的。先粘贴一段你真实写过、读过或经历过的东西。</div>'; return; }
  list.innerHTML = materials.map((item) => {
    const title = item.title || String(item.raw_text || "").split(/[\n。！？]/).find(Boolean)?.slice(0, 36) || "未命名素材";
    return `<article class="material-card ${selectedMaterialIds.has(Number(item.id)) ? "material-card-selected" : ""}"><header><label class="material-select-control"><input type="checkbox" data-material-select="${item.id}" ${selectedMaterialIds.has(Number(item.id)) ? "checked" : ""}><span>选入自主写作</span></label><div><span class="material-source">${escapeHtml(sourceNames[item.source_type] || "文本")}</span><h4>${escapeHtml(title)}</h4><small>${escapeHtml(item.captured_at || "")}${item.recommended_column_name ? ` · ${escapeHtml(item.recommended_column_name)}` : ""}</small></div><span class="material-status-badge">${statusNames[item.status] || "待整理"}</span></header><p class="material-excerpt">${escapeHtml(String(item.raw_text || "").slice(0, 260))}${String(item.raw_text || "").length > 260 ? "…" : ""}</p>${item.tags?.length ? `<div class="material-tags">${item.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>` : ""}<div class="material-card-actions">${mainlineBadge(item)}<button type="button" class="outline-button" data-material-edit="${item.id}">编辑</button><button type="button" class="outline-button" data-material-assess="${item.id}">分析与推荐</button><button type="button" class="outline-button" data-material-social="${item.id}">用于自定义图文</button><button type="button" class="ink-button" data-material-write="${item.id}">用于自主写作</button></div><div class="material-assessment-wrap" data-assessment-for="${item.id}">${renderAssessment(item.assessment)}</div></article>`;
  }).join("");
}

function syncSelectionToolbar() {
  const toolbar = document.getElementById("material-selection-toolbar");
  const count = document.getElementById("material-selection-count");
  const selected = selectedMaterialIds.size;
  if (toolbar) toolbar.hidden = selected === 0;
  if (count) count.textContent = `已选 ${selected} 条素材`;
}

function selectedMaterials() {
  return materials.filter((item) => selectedMaterialIds.has(Number(item.id)));
}

async function startIndependentWriting(ids) {
  const selected = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!selected.length) { toast("请先选择至少一条素材", "error"); return; }
  state.pendingIndependentWritingMaterials = materials.filter((item) => selected.includes(Number(item.id)));
  const locked = state.pendingIndependentWritingMaterials.find((item) => item.mainline_status === "已锁定" && item.active_brief_id);
  state.pendingIndependentWritingBriefId = locked ? Number(locked.active_brief_id) : null;
  await window.go("tutorial");
}

async function startCustomSocial(ids) {
  const selected = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!selected.length) { toast("请先选择至少一条素材", "error"); return; }
  state.pendingCustomSocialMaterials = materials.filter((item) => selected.includes(Number(item.id)));
  const locked = state.pendingCustomSocialMaterials.find((item) => item.mainline_status === "已锁定" && item.active_brief_id);
  state.pendingCustomSocialBriefId = locked ? Number(locked.active_brief_id) : null;
  await window.go("social-custom");
}

function selectedSingleMaterial() {
  return materials.find((item) => selectedMaterialIds.has(Number(item.id)));
}

/* ---------- 编辑抽屉 ---------- */

function openEditDialog(material) {
  editingMaterialId = Number(material.id);
  document.getElementById("edit-title").value = material.title || "";
  document.getElementById("edit-capturedAt").value = String(material.captured_at || "").slice(0, 10);
  document.getElementById("edit-sourceType").value = material.source_type || "text";
  document.getElementById("edit-status").value = statusLabels.includes(material.status) ? material.status : "inbox";
  const columnSelect = document.getElementById("edit-recommendedColumnId");
  columnSelect.innerHTML = `<option value="">（未指定，沿用评估推荐）</option>${columns.map((column) => `<option value="${column.id}" ${Number(column.id) === Number(material.recommended_column_id || material.assessment?.recommended_column_id) ? "selected" : ""}>${escapeHtml(column.name)}</option>`).join("")}`;
  document.getElementById("edit-tags").value = (material.tags || []).join("，");
  document.getElementById("edit-rawText").value = material.raw_text || "";
  const iteration = material.iteration || {};
  document.getElementById("edit-problem").value = iteration.problem || "";
  document.getElementById("edit-options").value = Array.isArray(iteration.options) ? iteration.options.join("\n") : iteration.options || "";
  document.getElementById("edit-verdict").value = iteration.verdict || "";
  document.getElementById("edit-result").value = iteration.result || "";
  document.getElementById("edit-value").value = iteration.value || "";
  document.getElementById("edit-evidence").value = (material.evidence || []).join("\n");
  document.getElementById("edit-nextTeaser").value = material.next_teaser || "";
  document.getElementById("material-edit-subtitle").textContent = `素材 #${material.id} · ${material.assessment?.account_fit ? "已评估" : "尚未评估"}。修改不破坏来源追踪。`;
  document.getElementById("material-edit-dialog").showModal();
}

function collectEditPayload() {
  const get = (id) => document.getElementById(id).value.trim();
  return {
    title: get("edit-title"),
    capturedAt: get("edit-capturedAt"),
    sourceType: get("edit-sourceType"),
    status: get("edit-status"),
    recommendedColumnId: get("edit-recommendedColumnId") ? Number(get("edit-recommendedColumnId")) : null,
    tags: get("edit-tags").split(/[，,]/).map((item) => item.trim()).filter(Boolean),
    rawText: get("edit-rawText"),
    iteration: {
      problem: get("edit-problem"),
      options: get("edit-options").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      verdict: get("edit-verdict"),
      result: get("edit-result"),
      value: get("edit-value"),
    },
    evidence: get("edit-evidence").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    nextTeaser: get("edit-nextTeaser"),
  };
}

async function saveEdit() {
  if (!editingMaterialId) return;
  await request(`/api/writing-materials/${editingMaterialId}`, { method: "PATCH", body: JSON.stringify(collectEditPayload()) });
  const dialog = document.getElementById("material-edit-dialog");
  dialog.close();
  editingMaterialId = null;
  toast("素材已更新");
  await load();
}

/* ---------- 自主写作 / 自定义图文 ---------- */
async function load() {
  const status = document.getElementById("material-status-filter")?.value || "";
  const sort = document.getElementById("material-sort-filter")?.value || "latest";
  const [loadedColumns, loaded] = await Promise.all([request("/api/content-columns"), request(`/api/writing-materials?${new URLSearchParams({ ...(status ? { status } : {}), ...(sort === 'feedback' ? { sort } : {}) })}`)]);
  columns = loadedColumns; renderColumns(columns); materials = loaded;
  const visibleIds = new Set(materials.map((item) => Number(item.id)));
  for (const id of [...selectedMaterialIds]) if (!visibleIds.has(id)) selectedMaterialIds.delete(id);
  renderMaterials();
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
  document.getElementById("material-edit-form").addEventListener("submit", (event) => { event.preventDefault(); saveEdit().catch((error) => toast(error.message, "error")); });
  document.addEventListener("click", async (event) => {
    const closeButton = event.target.closest("[data-material-dialog-close]");
    if (closeButton) { closeButton.closest("dialog")?.close(); return; }
    const select = event.target.closest("[data-material-select]");
    if (select) {
      const id = Number(select.dataset.materialSelect);
      if (select.checked) selectedMaterialIds.add(id); else selectedMaterialIds.delete(id);
      select.closest(".material-card")?.classList.toggle("material-card-selected", select.checked);
      syncSelectionToolbar();
    }
    const writeOne = event.target.closest("[data-material-write]");
    if (writeOne) {
      selectedMaterialIds.add(Number(writeOne.dataset.materialWrite));
      await startIndependentWriting([...selectedMaterialIds]);
      return;
    }
    if (event.target.closest("[data-material-write-selected]")) {
      await startIndependentWriting([...selectedMaterialIds]);
      return;
    }
    const socialOne = event.target.closest("[data-material-social]");
    if (socialOne) {
      selectedMaterialIds.add(Number(socialOne.dataset.materialSocial));
      await startCustomSocial([...selectedMaterialIds]);
      return;
    }
    if (event.target.closest("[data-material-social-selected]")) {
      await startCustomSocial([...selectedMaterialIds]);
      return;
    }
    const edit = event.target.closest("[data-material-edit]");
    if (edit) {
      const material = materials.find((item) => Number(item.id) === Number(edit.dataset.materialEdit));
      if (material) openEditDialog(material);
      return;
    }
    const assess = event.target.closest("[data-material-assess]");
    if (assess) { assess.disabled = true; assess.textContent = "正在判断…"; try { await request(`/api/writing-materials/${assess.dataset.materialAssess}/assessment`, { method: "POST", body: "{}" }); await load(); } catch (error) { toast(error.message, "error"); } finally { assess.disabled = false; } }
  });
}

export default async function loadMaterialInbox() {
  bind(); const date = document.querySelector('#material-capture-form [name="capturedAt"]'); if (date && !date.value) date.value = new Date().toISOString().slice(0, 10); await load();
}
