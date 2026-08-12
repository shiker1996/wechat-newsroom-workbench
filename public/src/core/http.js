// src/core/http.js — 网络请求
export async function request(url, options = {}) {
  const method = String(options.method ?? "GET").toUpperCase();
  const headers = { ...(options.headers ?? {}) };
  // GET 不带多余 content-type；非 GET 且调用方未指定时默认 JSON
  if (method !== "GET" && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(url, { ...options, headers });
  if (response.status === 204) return null;
  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  const text = await response.text();
  let data = {};
  if (isJson && text) {
    try { data = JSON.parse(text); } catch { data = {}; }
  }
  if (!response.ok) {
    // 非 JSON 响应（如 HTML 错误页）：给出状态码和可读摘要
    const summary = !isJson && text ? `：${text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)}` : "";
    const error=new Error(data.error ?? `HTTP ${response.status}${summary}`);error.status=response.status;error.code=data.code||'';error.issues=data.issues||[];error.data=data;throw error;
  }
  return isJson && text ? data : null;
}
