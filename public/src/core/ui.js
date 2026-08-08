// src/core/ui.js — UI 工具
export function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])
  );
}
export function formatDate(value, options = {}) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", ...options }).format(new Date(value));
}
let toastTimer;
// type: success / info / error（error 停留更久）；不传保持原行为
const toastDurations = { success: 2600, info: 2600, error: 4500 };
export function toast(message, type = "info") {
  const node = document.getElementById("toast");
  node.textContent = message;
  node.classList.remove("toast-success", "toast-info", "toast-error");
  node.classList.add("show", `toast-${type}`);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), toastDurations[type] ?? 2600);
}
export function providerOptions(selected) {
  const providers = window.__models?.providers ?? [];
  return providers.filter((item)=>item.enabled!==false).map((item) =>
    `<option value="${escapeHtml(item.name)}" ${item.name === selected ? "selected" : ""}>${escapeHtml(item.label)} · ${escapeHtml(item.model)}${item.configured ? "" : "（未配置）"}</option>`
  ).join("");
}

// 包装一个异步操作，让按钮显示加载状态（原 app-core.js withLoading）
export async function withLoading(button, label, fn) {
  if (!button) return fn();
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try { return await fn(); }
  finally { button.disabled = false; button.textContent = original; }
}

// 统一确认对话框：覆盖、删除等危险操作都走这里，返回 Promise<boolean>
// 取消（含 Esc）一律视为放弃操作，不再被赋予"以非强制模式继续"之类的第二语义
export function confirmAction(message, { confirmText = "确认执行" } = {}) {
  const dialog = document.getElementById("confirm-dialog");
  if (!dialog) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => {
    dialog.querySelector(".confirm-message").textContent = message;
    const ok = dialog.querySelector("[data-confirm-ok]");
    const cancel = dialog.querySelector("[data-confirm-cancel]");
    ok.textContent = confirmText;
    const done = (value) => {
      ok.removeEventListener("click", onOk);
      cancel.removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancelNative);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onCancelNative = (event) => { event.preventDefault(); done(false); };
    ok.addEventListener("click", onOk);
    cancel.addEventListener("click", onCancel);
    dialog.addEventListener("cancel", onCancelNative);
    dialog.showModal();
  });
}
