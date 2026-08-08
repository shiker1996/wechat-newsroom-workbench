// src/core/poll.js — 轮询工具：带超时上限、指数退避、可取消
// task 返回 true 表示完成（结束轮询），返回 false 继续；抛错则整体失败。
// cancel() 后 promise 以 null 静默结束，不再执行 task。
import { JOB_POLL_INTERVAL_MS } from "./constants.js";

export function poll(task, { interval = JOB_POLL_INTERVAL_MS, factor = 1.5, maxInterval = 8000, timeout = 10 * 60 * 1000 } = {}) {
  let timer = null;
  let stopped = false;
  const startedAt = Date.now();
  const promise = new Promise((resolve, reject) => {
    let delay = interval;
    const tick = async () => {
      if (stopped) { resolve(null); return; }
      if (Date.now() - startedAt > timeout) { reject(new Error("等待任务结果超时，请稍后在任务日志中查看")); return; }
      try {
        const done = await task();
        if (stopped) { resolve(null); return; }
        if (done) { resolve(true); return; }
      } catch (error) { reject(error); return; }
      delay = Math.min(delay * factor, maxInterval);
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
  });
  return {
    promise,
    cancel() { stopped = true; clearTimeout(timer); },
  };
}
