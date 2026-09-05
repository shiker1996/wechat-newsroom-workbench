// src/core/constants.js — 前端共享常量：跨视图复用的上限与节奏集中于此，避免魔法数字散落
export const AUTOSAVE_DELAY_MS = 1200;         // 编辑器草稿自动保存延迟
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 单张配图本地上限（8MB）
export const LOG_LIST_LIMIT = 150;             // 日志视图单次拉取条数
export const LOG_POLL_INTERVAL_MS = 5000;      // 日志视图自动刷新间隔
export const RUN_TRACE_POLL_INTERVAL_MS = 2000; // 打开 Run Trace 时的实时事件同步间隔
export const JOB_POLL_INTERVAL_MS = 1500;      // 任务结果轮询起始间隔（poll.js 默认值与各处显式传参统一）
export const GRAPH_ZOOM_STEP = 1.12;           // 热点全景图谱缩放步进（按钮与滚轮统一，取滚轮实际生效值）
