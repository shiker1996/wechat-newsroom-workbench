import { state } from "./core/state.js";
import { $, $$ } from "./core/dom.js";
import { request } from "./core/http.js";
import { escapeHtml, formatDate, toast, providerOptions } from "./core/ui.js";

const viewModules = {
  dashboard: "", batches: "", overview: "./views/atlas.js",
  topics: "./views/topics.js", editorial: "./views/editorial.js",
  editor: "./views/editor.js", preview: "./views/preview.js",
  hotspots: "./views/hotspots.js", artifacts: "./views/artifacts.js",
  system: "./views/system.js", sources: "./views/subscriptions.js",
  models: "./views/models.js", logs: "./views/logs.js",
  calendar: "./views/calendar.js",
};

// 视图与其旧系统全局入口函数的映射
const legacyLoaders = {
  dashboard: "loadOverview",
  batches: "loadBatches",
  
};

const titles = {
  dashboard: "今日值班", batches: "每日批次", overview: "热点全景",
  topics: "选题池", editorial: "编辑室", editor: "文章编辑器",
  preview: "排版预览", hotspots: "热点档案", artifacts: "产物柜",
  system: "采集控制", sources: "订阅源台账", models: "模型中心",
  logs: "日志", calendar: "内容日历",
};

async function go(view) {
  if (!(view in titles)) return;
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $$(".view").forEach((item) => item.classList.toggle("active", item.id === `view-${view}`));
  document.getElementById("page-title").textContent = titles[view];
  history.replaceState(null, "", `#${view}`);
  const modPath = viewModules[view];
  if (modPath && !legacyLoaders[view]) {
    try {
      const mod = await import(modPath);
      if (mod.default) { await mod.default(); return; }
    } catch (err) {
      console.error(`ESM 视图 ${view} 加载失败:`, err);
    }
  }
  // 回退到旧系统全局函数
  const loader = legacyLoaders[view];
  if (loader && typeof window[loader] === "function") {
    try { await window[loader](); } catch (err) { console.error(`旧系统 ${loader} 调用失败:`, err); }
  }
}

async function init() {
  window.go = go;
  window.toast = toast;
  window.request = request;
  window.escapeHtml = escapeHtml;
  window.formatDate = formatDate;
  window.providerOptions = providerOptions;
  window.$ = $;
  window.$$ = $$;
  try {
    const res = await request("/api/models");
    window.__models = res;
    state.models = res;
  } catch {}
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}