// src/core/http.js — 网络请求
export async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) { const error=new Error(data.error ?? `HTTP ${response.status}`);error.status=response.status;error.code=data.code||'';error.issues=data.issues||[];throw error; }
  return data;
}
