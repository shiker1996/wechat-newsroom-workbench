import { state } from "./core/state.js";
import { $$ } from "./core/dom.js";
import { request } from "./core/http.js";
import { toast, bindTablistKeyboardNavigation, bindDismissableDetails } from "./core/ui.js";
import { bindBatchDrawer } from "./views/batch-drawer.js";
import loadOverview from "./views/dashboard.js";
import { hydrateThemePickers } from "./core/theme-catalog.js";

const viewModules = {
  dashboard: "./views/dashboard.js", batches: "./views/batches.js", overview: "./views/atlas.js",
  topics: "./views/topics.js", daily: "./views/daily.js", tutorial: "./views/tutorial.js", "social-topics": "./views/topics.js", "social-editor": "./views/social-editor.js", "social-custom": "./views/social-editor.js", "social-event": "./views/social-editor.js", editorial: "./views/editorial.js",
  editor: "./views/editor.js", preview: "./views/preview.js", cover: "./views/cover.js",
  hotspots: "./views/hotspots.js", artifacts: "./views/artifacts.js",
  system: "./views/system.js", skills: "./views/skills.js", sources: "./views/subscriptions.js",
  themes: "./views/theme-manager.js",
  models: "./views/models.js", logs: "./views/logs.js",
  calendar: "./views/calendar.js",
};

// 三个导航入口共用同一视图 DOM：工具图文 / 自定义图文 / 事件图文都落在 #view-social-editor
const viewSectionAliases = { "social-custom": "view-social-editor", "social-event": "view-social-editor" };

const jobNoticeState = new Map();
let jobNoticeTimer = null;
// 浏览器前进/后退触发 go 时不重复压栈
let navigatingFromHistory = false;
const moduleVersion = "20260816-intro-merge";

const titles = {
  dashboard: "工作台总览", batches: "批次管理", overview: "热点全景",
  topics: "文章选题池", daily: "批次早报", tutorial: "自主写作", "social-topics": "图文选题池", "social-editor": "工具图文", "social-custom": "自定义图文", "social-event": "事件图文", editorial: "热点事件创作", editor: "文章编辑器",
  preview: "公众号排版", cover: "文章封面图", hotspots: "热点档案", artifacts: "产物中心",
  system: "运行与配置中心", themes: "主题中心", skills: "技能与工具", sources: "采集源", models: "模型运行",
  logs: "任务日志", calendar: "内容日历",
};

async function go(route) {
  // 切换视图时退出任何沉浸式对话，避免全屏层残留并清除 body.chat-immersive
  exitImmersiveChats();
  const view = String(route || "").split("/")[0];
  if (!(view in titles)) return;
  if(view!=="editor")document.body.classList.remove("editor-focus");
  const previousView = document.querySelector(".nav-item.active,.nav-utility.active")?.dataset.view;
  const isViewChange = previousView !== view;
  const bs = document.getElementById("batch-switcher");
  if (bs) bs.classList.toggle("visible", ["overview","topics","daily","tutorial","social-topics","social-editor","social-custom","social-event","editorial","editor","preview","cover","artifacts"].includes(view));
  let activeNavItem = null;
  $$(".nav-item").forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle("active", active);
    if (active) {
      item.setAttribute("aria-current", "page");
      activeNavItem = item;
    } else item.removeAttribute("aria-current");
  });
  document.querySelectorAll(".nav-utility").forEach((item)=>{
    const active=item.dataset.view===view;item.classList.toggle("active",active);
    if(active){item.setAttribute("aria-current","page");activeNavItem=item;}else item.removeAttribute("aria-current");
  });
  // 桌面端侧栏是单开任务阶段：当前页面所属阶段始终可见，其余阶段收起。
  $$(".nav-group").forEach((group) => { group.open = Boolean(activeNavItem && group.contains(activeNavItem)); });
  const sectionId = viewSectionAliases[view] ? viewSectionAliases[view] : `view-${view}`;
  $$(".view").forEach((item) => item.classList.toggle("active", item.id === sectionId));
  document.getElementById("page-title").textContent = titles[view];
  // 主视图共享同一个文档滚动容器。进入新视图时必须从页面顶部开始，
  // 但批次切换等“刷新当前视图”的操作仍保留用户正在查看的位置。
  if (isViewChange) {
    const scroller = document.scrollingElement || document.documentElement;
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
  }
  // 保留浏览器前进/后退能力；hash 相同（如批次切换重载当前视图）不重复压栈
  const targetHash=`#${route}`;
  if (!navigatingFromHistory && location.hash !== targetHash) history.pushState(null, "", targetHash);

  const modPath = viewModules[view];
  if (modPath) {
    try {
      const mod = await import(`${modPath}?v=${moduleVersion}`);
      if (mod.default) await mod.default(view);
    } catch (err) {
      console.error(`ESM 视图 ${view} 加载失败:`, err);
      toast(`视图「${titles[view]}」加载失败，请刷新后重试`, "error");
    }
  }
}

async function init() {
  window.go = go;
  await hydrateThemePickers();
  try {
    const res = await request("/api/models");
    window.__models = res;
    state.models = res;
  } catch {
    toast("模型列表加载失败，模型下拉可能不可用", "error");
  }
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

// 对齐到下一分钟边界再刷新，避免固定间隔轮询让分钟显示滞后/漂移
function startClock() {
  tick();
  setTimeout(startClock, 60000 - (Date.now() % 60000) + 20);
}

// 沉浸式对话全局态：与 body.editor-focus 同一模式，由 body.chat-immersive 统一隐藏固定侧栏与顶栏，
// 避免 fixed 全屏层受祖先动画/层叠上下文影响时左侧侧边栏仍然可见。任何沉浸式状态变化后都要同步。
function syncImmersiveMode() {
  document.body.classList.toggle("chat-immersive", Boolean(document.querySelector(".editorial-chat.immersive")));
}
function exitImmersiveChats() {
  document.querySelectorAll(".editorial-chat.immersive").forEach((chat) => {
    chat.classList.remove("immersive");
    const btn = chat.querySelector("[data-immersive-chat]");
    if (btn) { btn.title = "沉浸式对话"; btn.setAttribute("aria-pressed", "false"); }
  });
  syncImmersiveMode();
}

// 全局骨架绑定（原 app-bind.js 中与具体视图无关的部分）
function bindGlobal() {
  bindTablistKeyboardNavigation();
  bindDismissableDetails();
  document.getElementById("nav").addEventListener("click", (event) => {
    const item = event.target.closest("[data-view]"); if (item) go(item.dataset.view);
  });
  document.addEventListener("click", (event) => {
    const utilityView = event.target.closest(".nav-utility[data-view]"); if (utilityView) go(utilityView.dataset.view);
    const goButton = event.target.closest("[data-go]"); if (goButton) go(goButton.dataset.go);
    const immersiveButton = event.target.closest("[data-immersive-chat]");
    if (immersiveButton) {
      const chat = immersiveButton.closest(".editorial-chat");
      if (chat) {
        const active = chat.classList.toggle("immersive");
        immersiveButton.title = active ? "退出沉浸式" : "沉浸式对话";
        immersiveButton.setAttribute("aria-pressed", String(active));
        syncImmersiveMode();
      }
    }
    if (event.target.closest("[data-close-batch-dialog]")) document.getElementById("batch-dialog").close();
    if (event.target.closest("[data-close-drawer]")) document.getElementById("batch-drawer").close();
    if (event.target.closest("[data-close-breaking-dialog]")) document.getElementById("breaking-batch-dialog").close();
    if (event.target.closest("#close-production-job")) document.getElementById("production-job-dialog").close();
    if (event.target.closest(".preview-close")) document.getElementById("artifact-dialog").close();
    const copy = event.target.closest("[data-copy]"); if (copy) navigator.clipboard.writeText(copy.dataset.copy).then(() => toast(copy.dataset.copyLabel || "已复制")).catch(() => toast("复制失败，请手动复制", "error"));
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
    const route = location.hash.slice(1);
    const view = route.split("/")[0];
    if (view in titles) {
      navigatingFromHistory = true;
      go(route).finally(() => { navigatingFromHistory = false; });
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    exitImmersiveChats();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    clearTimeout(jobNoticeTimer);
    jobNoticeDelay = JOB_NOTICE_INTERVAL;
    pollJobNotifications();
  });
}

const JOB_NOTICE_INTERVAL = 4000;
let jobNoticeDelay = JOB_NOTICE_INTERVAL;
async function pollJobNotifications() {
  // 页面隐藏时暂停轮询，恢复可见时立即补一轮
  if (document.visibilityState === "hidden") {
    jobNoticeTimer = setTimeout(pollJobNotifications, jobNoticeDelay);
    return;
  }
  try {
    const jobs = await request("/api/jobs?limit=40");
    jobNoticeDelay = JOB_NOTICE_INTERVAL;
    for (const job of jobs) {
      const previous = jobNoticeState.get(job.id);
      jobNoticeState.set(job.id, job.status);
      if (!previous || previous === job.status || !["completed", "failed", "interrupted"].includes(job.status)) continue;
      const labels = { tag: "打标", retag: "重新打标", research: "事件研判", article: "成稿", daily: "批次早报", tutorial: "教程成稿", typeset: "排版", "social-card": "图文生成", "cover-image": "封面图生成" };
      const label = job.run_kind === "source" ? `来源采集 · ${job.type || "source"}` : (labels[job.type] || job.type || "后台任务");
      toast(job.status === "completed" ? `${label}任务已完成` : `${label}任务${job.status === "interrupted" ? "已中断" : "失败"}${job.error ? `：${job.error}` : ""}`, job.status === "completed" ? "success" : "error");
    }
    // 定期清理：只保留最近一轮仍返回的任务，避免 Map 无限增长
    const activeIds = new Set(jobs.map((job) => job.id));
    for (const id of jobNoticeState.keys()) if (!activeIds.has(id)) jobNoticeState.delete(id);
  } catch { jobNoticeDelay = Math.min(jobNoticeDelay * 2, 60000); }
  jobNoticeTimer = setTimeout(pollJobNotifications, jobNoticeDelay);
}

async function onReady() {
  await init();
  bindGlobal();
  bindBatchDrawer();
  startClock();
  pollJobNotifications();
  // 首屏视图激活：切导航/视图样式、设置标题、加载 ESM 视图（go 内部已处理 batch-switcher 显隐）
  const route = location.hash.slice(1);
  const view = route.split("/")[0];
  const current = view in titles ? route : "dashboard";
  // 批次切换器与各视图共用 state.batches/overview；dashboard 视图会由 go 自行加载，避免重复请求
  if (current !== "dashboard") {
    try { await loadOverview(); } catch (error) { toast("工作台加载失败：" + error.message, "error"); }
  }
  await go(current);
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", onReady);
} else {
  onReady();
}
