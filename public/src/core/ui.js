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
export function toast(message) {
  const node = document.getElementById("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 2600);
}
export function providerOptions(selected) {
  const providers = window.__models?.providers ?? [];
  return providers.map((item) =>
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
