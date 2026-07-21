// src/core/state.js — 共享状态
// 指向全局 state 对象（由 app-core.js 的 const state = {...} 创建）
// 确保 ESM 视图和旧系统操作同一份数据
export const state = typeof window !== "undefined" ? window.state : {};