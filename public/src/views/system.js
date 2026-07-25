import { request } from "../core/http.js";
import { toast } from "../core/ui.js";

let bound = false;
function bindSystem() {
  if (bound) return;
  bound = true;
  document.getElementById("health-button").addEventListener("click", () => {
    // go('system') 会触发本模块 default 重新检查一次，无需重复调用
    window.go("system");
  });
  document.getElementById("system-health").addEventListener("click", () => {
    loadSystem().catch((error) => toast(error.message));
  });
}

async function loadSystem() {
  toast("正在检查采集环境…");
  const health = await request("/api/system/health");
  const reddit = document.getElementById("reddit-status");
  const rss = document.getElementById("rsshub-status");
  const github = document.getElementById("github-status");
  if (reddit) {
    reddit.textContent = health.reddit.ok ? `已连接 · ${health.reddit.tabs} 个标签页` : "未连接";
    reddit.className = "status-pill " + (health.reddit.ok ? "ok" : "bad");
  }
  if (rss) {
    rss.textContent = health.rsshub.ok ? "已连接" : "未连接";
    rss.className = "status-pill " + (health.rsshub.ok ? "ok" : "bad");
  }
  if(github){const gh=health.github||{};github.textContent=gh.status==='idle'?'尚未请求':gh.status==='ok'?'已连接':gh.status==='degraded'?'缓存降级':'请求失败';github.className='status-pill '+(gh.status==='ok'?'ok':gh.status==='idle'?'unknown':'bad');const quota=document.getElementById('github-quota');if(quota)quota.textContent=gh.limit?`REST ${gh.resource||'core'} · 剩余 ${gh.remaining}/${gh.limit} · 重置 ${gh.resetAt?new Date(gh.resetAt).toLocaleString():'未知'} · 缓存命中 ${gh.cacheHits||0}`:`${gh.authenticated?'Token 已配置':'未配置 Token'} · 缓存命中 ${gh.cacheHits||0}${gh.lastError?` · ${gh.lastError}`:''}`;}
  toast("采集环境检查完成");
}
export default async function loadSystemView() {
  bindSystem();
  return loadSystem();
}
