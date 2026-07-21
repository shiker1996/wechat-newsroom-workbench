import { request } from "../core/http.js";
import { toast } from "../core/ui.js";

async function loadSystem() {
  toast("正在检查采集环境…");
  const health = await request("/api/system/health");
  const reddit = document.getElementById("reddit-status");
  const rss = document.getElementById("rsshub-status");
  if (reddit) {
    reddit.textContent = health.reddit.ok ? `已连接 · ${health.reddit.tabs} 个标签页` : "未连接";
    reddit.className = "status-pill " + (health.reddit.ok ? "ok" : "bad");
  }
  if (rss) {
    rss.textContent = health.rsshub.ok ? "已连接" : "未连接";
    rss.className = "status-pill " + (health.rsshub.ok ? "ok" : "bad");
  }
  toast("采集环境检查完成");
}
export default loadSystem;