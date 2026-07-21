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

// 回退到旧系统处理的视图（使用旧系统的全局函数 + ensureModule）
const legacyViews = new Set(["dashboard", "batches"]);

const titles = {
  dashboard: "今日值班", batches: "批次归档", overview: "热点全景",
  topics: "选题池", editorial: "编辑室", editor: "文章编辑器",
  preview: "排版预览", hotspots: "热点档案", artifacts: "产物柜",
  system: "采集控制", sources: "订阅源台账", models: "模型中心",
  logs: "日志", calendar: "内容日历",
};

async function go(view) {
  if (!(view in titles)) return;
  var bs = document.getElementById("batch-switcher");
  if (bs) bs.style.display = ["overview","topics","editorial","editor","preview","artifacts"].includes(view) ? "block" : "none";
  // 旧系统回退视图：调用旧 go() 处理导航和数据加载
  if (legacyViews.has(view)) {
    const oldGo = window.__oldGo;
    if (oldGo) {
      oldGo(view);
      if (view === "dashboard" && typeof window.loadOverview === "function") {
        await window.loadOverview();
      }
      return;
    }
  }

  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $$(".view").forEach((item) => item.classList.toggle("active", item.id === `view-${view}`));
  document.getElementById("page-title").textContent = titles[view];
  history.replaceState(null, "", `#${view}`);

  const modPath = viewModules[view];
  if (modPath && !legacyViews.has(view)) {
    try {
      const mod = await import(modPath);
      if (mod.default) await mod.default();
    } catch (err) {
      console.error(`ESM 视图 ${view} 加载失败:`, err);
    }
  }
}

async function init() {
  // 保存旧 go() 引用，供 legacy 视图回退使用
  window.__oldGo = window.go;
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

async function onReady() {
  await init();
  // 初始化后根据当前视图设置 batch-switcher 显隐
  var current = document.querySelector(".nav-item.active")?.dataset.view || "dashboard";
  var bs = document.getElementById("batch-switcher");
  if (bs) bs.style.display = ["overview","topics","editorial","editor","preview","artifacts"].includes(current) ? "block" : "none";
  // 非 legacy 视图：页面刷新时主动加载数据
  if (!legacyViews.has(current) && viewModules[current]) {
    try { var mod = await import(viewModules[current]); if (mod.default) mod.default(); } catch {}
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", onReady);
} else {
  onReady();
}