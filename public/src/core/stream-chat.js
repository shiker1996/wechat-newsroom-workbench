// src/core/stream-chat.js — 流式对话公共逻辑（editorial / social-editor 共用）
// 负责：流式消息气泡（含思考过程折叠）、NDJSON 逐行消费、按钮忙态与失败态。
// 差异通过参数传入：title（气泡标题）、errorLabel（错误文案前缀）、
// onDone（收到 done 事件后的回调，参数为 event.data，无 data 时为 {}）、
// rethrow（失败时是否把错误抛给调用方，true 时不再 toast）。
import { toast } from "./ui.js";
import { consumeAgentEvent } from "./agent-events.js";
import { securityHeaders } from "./http.js";
// Unified stream contract: tool.requested, assistant.delta.

export async function streamChat({ url, body, messages, button, busyLabel, doneLabel, title, errorLabel, onDone, rethrow = false, confirmation = "" }) {
  const sm = document.createElement("div");
  sm.className = "editorial-message assistant streaming";
  sm.innerHTML = `<b>${title} · 实时回应</b><details class="thinking-box" hidden><summary>思考过程</summary><div class="thinking-text"></div></details><p class="reply-text"></p>`;
  messages.append(sm);
  messages.scrollTop = messages.scrollHeight;
  const st = sm.querySelector(".reply-text");
  const thinkingText = sm.querySelector(".thinking-text");
  const thinkingBox = sm.querySelector(".thinking-box");
  const toolCards = document.createElement("div");
  toolCards.className = "agent-tool-cards";
  sm.insertBefore(toolCards, st);
  button.disabled = true;
  button.textContent = busyLabel;
  let done = null;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await securityHeaders({ confirmation })) },
      body: JSON.stringify(body),
    });
    if (!response.ok) { const d = await response.json().catch(() => ({})); throw new Error(d.error || `HTTP ${response.status}`); }
    if (!response.body) throw new Error("浏览器未收到流式响应");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const consume = (line) => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      const completed=consumeAgentEvent(event,{toolCards,replyText:st,thinkingBox,thinkingText,errorLabel});
      if(completed)done=completed;
      messages.scrollTop = messages.scrollHeight;
    };
    while (true) {
      const { done: end, value } = await reader.read();
      if (end) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() || "";
      for (const line of parts) consume(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!done) throw new Error(`${errorLabel}连接提前结束，请重试`);
    sm.classList.remove("streaming");
    await onDone?.(done === true ? {} : done);
    return done;
  } catch (error) {
    sm.classList.remove("streaming");
    sm.classList.add("failed");
    if (rethrow) {
      if (st && !st.textContent) st.textContent = `调用失败：${error.message}`;
      throw error;
    }
    if (st && !st.textContent) st.textContent = `调用失败：${error.message}`;
    else toast(error.message);
    return null;
  } finally {
    button.disabled = false;
    button.textContent = doneLabel;
  }
}
