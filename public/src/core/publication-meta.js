import { request } from "./http.js";
import { escapeHtml, toast } from "./ui.js";

const statusLabels = {
  pending: "待登记",
  registered: "已登记",
  awaiting_metrics: "等待数据",
  reviewed: "已复盘",
};

let bound = false;
let context = null;

function value(id) {
  return document.getElementById(id)?.value || "";
}

function setValue(id, next) {
  const node = document.getElementById(id);
  if (node) node.value = next || "";
}

function dateInputValue(value) {
  const text = String(value || "");
  return text.includes("T") ? text.slice(0, 10) : text.slice(0, 10);
}

function renderColumns(columns, selected) {
  const select = document.getElementById("publication-column");
  if (!select) return;
  select.innerHTML = `<option value="">未指定栏目</option>${(columns || []).map((column) => `<option value="${escapeHtml(column.id)}">${escapeHtml(column.name)}</option>`).join("")}`;
  select.value = selected == null ? "" : String(selected);
}

function renderStatus(publication) {
  const status = publication?.status || "pending";
  const node = document.getElementById("publication-status");
  if (node) node.textContent = statusLabels[status] || status;
  const note = document.getElementById("publication-status-note");
  if (note) note.textContent = status === "awaiting_metrics" ? "已有 URL 和发布日期，等待导入公众号数据。" : status === "reviewed" ? "已关联至少一轮公众号复盘数据。" : "发布后补充 URL 和发布日期，系统才能关联后台数据。";
}

export function renderPublicationSummary(publication, node = document.getElementById("publication-meta-summary")) {
  if (!node) return;
  if (!publication) {
    node.textContent = "发布信息未登记";
    node.className = "publication-meta-summary pending";
    return;
  }
  const label = statusLabels[publication.status] || "已登记";
  const date = publication.published_at ? ` · ${publication.published_at}` : "";
  node.textContent = `${label}${date}`;
  node.className = `publication-meta-summary ${publication.status || "pending"}`;
}

async function loadExistingPublication(input) {
  const query = input.documentId ? `documentId=${encodeURIComponent(input.documentId)}` : `planId=${encodeURIComponent(input.planId)}`;
  try { return await request(`/api/article-publications?${query}`); } catch (error) { if (error.status === 404 || /发布信息不存在/.test(error.message)) return null; throw error; }
}

export async function loadPublicationMeta(input = {}) {
  if (!input.documentId && !input.planId) return null;
  return loadExistingPublication(input);
}

function fillForm(input, publication, columns) {
  const data = publication || input;
  setValue("publication-url", data.content_url || data.contentUrl);
  setValue("publication-date", dateInputValue(data.published_at || data.publishedAt));
  setValue("publication-title", data.title_at_publish || data.titleAtPublish || input.title);
  setValue("publication-pillar", data.content_pillar || data.contentPillar);
  setValue("publication-role", data.content_role || data.contentRole);
  setValue("publication-lane", data.distribution_lane || data.distributionLane);
  renderColumns(columns, data.column_id ?? data.columnId ?? input.columnId);
  renderStatus(publication);
}

export async function openPublicationDialog(input = {}) {
  const dialog = document.getElementById("publication-dialog");
  if (!dialog || (!input.documentId && !input.planId)) return toast("缺少文章或内容计划关联");
  bindPublicationDialog();
  context = { ...input };
  const titleNode = document.getElementById("publication-dialog-title");
  if (titleNode) titleNode.textContent = input.title || "登记公众号发布信息";
  const contextNode = document.getElementById("publication-dialog-context");
  if (contextNode) contextNode.textContent = input.documentId ? "文章编辑器 · 当前文稿" : `内容日历 · ${input.columnName || "主动写作计划"}`;
  try {
    const [publication, columns] = await Promise.all([loadExistingPublication(input), request("/api/content-columns")]);
    context.publication = publication;
    fillForm(input, publication, columns);
    dialog.showModal();
    document.getElementById("publication-url")?.focus();
  } catch (error) { toast(error.message, "error"); }
}

export function bindPublicationDialog() {
  if (bound) return;
  bound = true;
  const dialog = document.getElementById("publication-dialog");
  const form = document.getElementById("publication-form");
  if (!dialog || !form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!context) return;
    const button = form.querySelector("button[type=submit]");
    if (button) { button.disabled = true; button.textContent = "保存中…"; }
    try {
      const publication = await request("/api/article-publications", { method: "POST", body: JSON.stringify({
        id: context.publication?.id || null,
        planId: context.planId || null,
        documentId: context.documentId || null,
        contentUrl: value("publication-url"),
        publishedAt: value("publication-date"),
        titleAtPublish: value("publication-title"),
        columnId: value("publication-column") || null,
        contentPillar: value("publication-pillar"),
        contentRole: value("publication-role"),
        distributionLane: value("publication-lane"),
      }) });
      context.publication = publication;
      renderPublicationSummary(publication);
      context.onSaved?.(publication);
      dialog.close();
      toast("发布信息已保存", "success");
    } catch (error) { toast(error.message, "error"); }
    finally { if (button) { button.disabled = false; button.textContent = "保存发布信息"; } }
  });
  dialog.querySelectorAll("[data-close-publication]").forEach((button) => button.addEventListener("click", () => dialog.close()));
}
