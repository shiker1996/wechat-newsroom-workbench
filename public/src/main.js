import { state } from "./core/state.js";
import { $$ } from "./core/dom.js";
import { request } from "./core/http.js";
import { toast } from "./core/ui.js";
import { bindBatchDrawer } from "./views/batch-drawer.js";
import loadOverview from "./views/dashboard.js";

const viewModules = {
  dashboard: "./views/dashboard.js", batches: "./views/batches.js", overview: "./views/atlas.js",
  topics: "./views/topics.js", "social-topics": "./views/topics.js", "social-editor": "./views/social-editor.js", "social-custom": "./views/social-editor.js", "social-event": "./views/social-editor.js", editorial: "./views/editorial.js",
  editor: "./views/editor.js", preview: "./views/preview.js",
  hotspots: "./views/hotspots.js", artifacts: "./views/artifacts.js",
  system: "./views/system.js", sources: "./views/subscriptions.js",
  models: "./views/models.js", logs: "./views/logs.js",
  calendar: "./views/calendar.js",
};

// 三个导航入口共用同一视图 DOM：工具图文 / 自定义图文 / 事件图文都落在 #view-social-editor
const viewSectionAliases = { "social-custom": "view-social-editor", "social-event": "view-social-editor" };

const jobNoticeState = new Map();
let jobNoticeTimer = null;
const moduleVersion = "20260725-channel-select-2";

const titles = {
  dashboard: "工作台总览", batches: "批次管理", overview: "热点全景",
  topics: "文章选题池", "social-topics": "图文选题池", "social-editor": "工具图文", "social-custom": "自定义图文", "social-event": "事件图文", editorial: "文章编辑室", editor: "文章编辑器",
  preview: "公众号排版", hotspots: "热点档案", artifacts: "产物中心",
  system: "采集控制", sources: "采集源", models: "模型中心",
  logs: "任务日志", calendar: "内容日历",
};

async function go(view) {
  if (!(view in titles)) return;
  var bs = document.getElementById("batch-switcher");
  if (bs) bs.style.display = ["overview","topics","social-topics","social-editor","social-custom","social-event","editorial","editor","preview","artifacts"].includes(view) ? "block" : "none";
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  const sectionId = viewSectionAliases[view] ? viewSectionAliases[view] : `view-${view}`;
  $$(".view").forEach((item) => item.classList.toggle("active", item.id === sectionId));
  document.getElementById("page-title").textContent = titles[view];
  history.replaceState(null, "", `#${view}`);

  const modPath = viewModules[view];
  if (modPath) {
    try {
      const mod = await import(`${modPath}?v=${moduleVersion}`);
      if (mod.default) await mod.default(view);
    } catch (err) {
      console.error(`ESM 视图 ${view} 加载失败:`, err);
    }
  }
}

async function init() {
  window.go = go;
  try {
    const res = await request("/api/models");
    window.__models = res;
    state.models = res;
  } catch {}
}

// 顶栏时钟（原 app-bind.js tick）
function tick() {
  const now = new Date();
  document.getElementById("clock").textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
    hour: "2-digit", minute: "2-digit",
  }).format(now);
  document.getElementById("today-label").textContent = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(now);
}

// 全局骨架绑定（原 app-bind.js 中与具体视图无关的部分）
function bindGlobal() {
  document.getElementById("nav").addEventListener("click", (event) => {
    const item = event.target.closest("[data-view]"); if (item) go(item.dataset.view);
  });
  document.addEventListener("click", (event) => {
    const goButton = event.target.closest("[data-go]"); if (goButton) go(goButton.dataset.go);
    if (event.target.closest("[data-close-batch-dialog]")) document.getElementById("batch-dialog").close();
    if (event.target.closest("[data-close-drawer]")) document.getElementById("batch-drawer").close();
    if (event.target.closest("[data-close-breaking-dialog]")) document.getElementById("breaking-batch-dialog").close();
    if (event.target.closest("#close-production-job")) document.getElementById("production-job-dialog").close();
    if (event.target.closest(".preview-close")) document.getElementById("artifact-dialog").close();
    const copy = event.target.closest("[data-copy]"); if (copy) navigator.clipboard.writeText(copy.dataset.copy).then(() => toast("启动命令已复制"));
    // 选题池卡片"进入文章编辑室"（模块在 go 过程中完成加载并注册 window.loadEditorialRoom）
    const editorialButton = event.target.closest("[data-editorial-id]");
    if (editorialButton) {
      const id = Number(editorialButton.dataset.editorialId);
      go("editorial").then(() => window.loadEditorialRoom?.(id));
    }
  });
  document.getElementById("batch-switcher").addEventListener("change", (event) => {
    state.activeBatchId = event.target.value;
    const current = document.querySelector(".nav-item.active")?.dataset.view || "dashboard";
    go(current);
  });
  window.addEventListener("hashchange", () => {
    const view = location.hash.slice(1);
    if (view in titles && !document.querySelector(".nav-item.active")?.matches(`[data-view="${view}"]`)) go(view);
  });
}

async function pollJobNotifications() {
  try {
    const jobs = await request("/api/jobs?limit=40");
    for (const job of jobs) {
      const previous = jobNoticeState.get(job.id);
      jobNoticeState.set(job.id, job.status);
      if (!previous || previous === job.status || !["completed", "failed", "interrupted"].includes(job.status)) continue;
      const labels = { tag: "打标", retag: "重新打标", research: "事件研判", article: "成稿", typeset: "排版", "social-card": "图文生成" };
      const label = job.run_kind === "source" ? `来源采集 · ${job.type || "source"}` : (labels[job.type] || job.type || "后台任务");
      toast(job.status === "completed" ? `${label}任务已完成` : `${label}任务${job.status === "interrupted" ? "已中断" : "失败"}${job.error ? `：${job.error}` : ""}`);
    }
  } catch {}
  jobNoticeTimer = setTimeout(pollJobNotifications, 4000);
}

async function onReady() {
  await init();
  bindGlobal();
  bindBatchDrawer();
  tick();
  setInterval(tick, 30000);
  pollJobNotifications();
  // 首屏视图激活：切导航/视图样式、设置标题、加载 ESM 视图（go 内部已处理 batch-switcher 显隐）
  const view = location.hash.slice(1);
  const current = view in titles ? view : "dashboard";
  // 批次切换器与各视图共用 state.batches/overview；dashboard 视图会由 go 自行加载，避免重复请求
  if (current !== "dashboard") {
    try { await loadOverview(); } catch (error) { toast("工作台加载失败：" + error.message); }
  }
  await go(current);
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", onReady);
} else {
  onReady();
}
