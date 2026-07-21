// src/core/state.js — 共享状态
// 由 app-core.js 的 var state = {...} 创建，挂在 window 上
// 确保 ESM 视图和旧系统操作同一份数据
export const state = window.state;