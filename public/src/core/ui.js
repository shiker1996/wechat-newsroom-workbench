// src/core/ui.js — UI 工具
import { state } from "./state.js";
import { request } from "./http.js";

export function debounce(fn, delay = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// 模型列表全局只拉一次，缓存于 state.models（编辑室/写作台切换候选时复用）
export async function ensureModelOptions() {
  if (!state.models) {
    try { state.models = await request("/api/models"); } catch {}
  }
}

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])
  );
}
export function formatDate(value, options = {}) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", ...options }).format(new Date(value));
}
// 容错时间格式化：非 ISO/不可解析输入原样返回（空值给占位），避免 Invalid Date 乱码
export function formatTime(value, options = { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", options);
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
  button.setAttribute("aria-busy", "true");
  try { return await fn(); }
  finally { button.disabled = false; button.textContent = original; button.removeAttribute("aria-busy"); }
}

// tablist 键盘导航（roving tabindex）：ArrowLeft/Right 循环移动焦点并激活，
// Home/End 跳首尾。全局委托；激活复用各视图已有的 click 处理（由它们同步 aria-selected）
export function bindTablistKeyboardNavigation() {
  const syncTabStops = (list) => {
    list.querySelectorAll('[role="tab"]').forEach((tab) => {
      tab.tabIndex = tab.getAttribute("aria-selected") === "true" ? 0 : -1;
    });
  };
  document.querySelectorAll('[role="tablist"]').forEach(syncTabStops);
  document.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tab = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
    const list = tab?.closest('[role="tablist"]');
    if (!list) return;
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const current = tabs.indexOf(tab);
    if (tabs.length < 2 || current < 0) return;
    let next;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else next = (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next].focus();
    tabs[next].click();
    syncTabStops(list);
  });
}

// 弹层式 details（候选卡“更多”菜单、创作配置弹层）支持 Esc / 外部点击关闭；
// .nav-group 导航分组与其余内联折叠面板是常驻内容，不受影响
const popupDetailsSelector = 'details:is(.candidate-more, .creation-skill-settings)[open]';
export function bindDismissableDetails() {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(popupDetailsSelector).forEach((node) => { node.open = false; });
  });
  document.addEventListener("click", (event) => {
    document.querySelectorAll(popupDetailsSelector).forEach((node) => {
      if (!node.contains(event.target)) node.open = false;
    });
  });
}

// 产物/日历共用的 iframe 预览：打开时显示加载态（load 后隐藏），关闭时清空 src，
// 避免大文件在后台继续加载、下次打开时闪现旧内容；加载失败给出最小兜底提示
let previewBound = false;
export function openArtifactPreview(url, { originalUrl } = {}) {
  const dialog = document.getElementById("artifact-dialog");
  const iframe = dialog.querySelector("iframe");
  const status = dialog.querySelector(".preview-status");
  if (!previewBound) {
    previewBound = true;
    iframe.addEventListener("load", () => {
      if (!dialog.open || !iframe.src || iframe.src === "about:blank") return;
      status.hidden = true;
      // 同源接口出错时返回的是 JSON 错误体而非可预览内容
      try {
        if (iframe.contentDocument?.contentType === "application/json") {
          status.textContent = "预览加载失败，可尝试「打开原始文件」。";
          status.hidden = false;
        }
      } catch {}
    });
    iframe.addEventListener("error", () => {
      if (!dialog.open) return;
      status.textContent = "预览加载失败，可尝试「打开原始文件」。";
      status.hidden = false;
    });
    dialog.addEventListener("close", () => {
      iframe.src = "about:blank";
      status.hidden = true;
    });
  }
  const original = document.getElementById("artifact-open-original");
  if (original) original.href = originalUrl || url;
  status.textContent = "正在加载预览…";
  status.hidden = false;
  iframe.src = url;
  dialog.showModal();
  // 初始焦点落在关闭按钮，键盘用户无需穿越 iframe
  dialog.querySelector(".preview-close")?.focus();
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
