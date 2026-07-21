import { state } from "./core/state.js";
import { $, $$ } from "./core/dom.js";
import { request } from "./core/http.js";
import { escapeHtml, formatDate, toast, providerOptions } from "./core/ui.js";

// 视图模块映射
const viewModules = {
  dashboard: "",
  batches: "",
  overview: "./views/atlas.js",
  topics: "./views/topics.js",
  editorial: "./views/editorial.js",
  editor: "./views/editor.js",
  preview: "./views/preview.js",
  hotspots: "./views/hotspots.js",
  artifacts: "./views/artifacts.js",
  system: "./views/system.js",
  sources: "./views/subscriptions.js",
  models: "./views/models.js",
  logs: "./views/logs.js",
  calendar: "./views/calendar.js",
};

const titles = {
  dashboard: "今日值班", batches: "每日批次", overview: "热点全景",
  topics: "选题池", editorial: "编辑室", editor: "文章编辑器",
  preview: "排版预览", hotspots: "热点档案", artifacts: "产物柜",
  system: "采集控制", sources: "订阅源台账", models: "模型中心",
  logs: "日志", calendar: "内容日历",
};

// 导航
async function go(view) {
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $$(".view").forEach((item) => item.classList.toggle("active", item.id === `view-${view}`));
  document.getElementById("page-title").textContent = titles[view];
  const modPath = viewModules[view];
  if (modPath) {
    try {
      const mod = await import(modPath);
      if (mod.default) await mod.default();
    } catch (err) {
      console.error(`加载视图 ${view} 失败:`, err);
      toast(`加载失败: ${err.message}`);
    }
  }
  history.replaceState(null, "", `#${view}`);
}

// 初始化
async function init() {
  // expose for inline events
  window.go = go; window.toast = toast; window.request = request;
  window.escapeHtml = escapeHtml; window.formatDate = formatDate;
  window.providerOptions = providerOptions; window.state = state;
  window.$ = $; window.$$ = $$;

  // 绑定导航
  document.getElementById("nav").addEventListener("click", (e) => {
    const item = e.target.closest("[data-view]");
    if (item) go(item.dataset.view);
  });

  // 加载模型列表（供 providerOptions 使用）
  try {
    const res = await request("/api/models");
    window.__models = res;
    state.models = res;
  } catch {}

  // 进入首屏视图
  const initialView = location.hash.slice(1) in titles ? location.hash.slice(1) : "dashboard";
  // 预加载首屏视图模块
  if (viewModules[initialView]) {
    try { await import(viewModules[initialView]); } catch {}
  }
  await go(initialView);
}

// 页面完全加载后初始化
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}