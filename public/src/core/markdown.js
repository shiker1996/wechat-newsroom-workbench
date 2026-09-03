// src/core/markdown.js — 对话消息的安全 Markdown 渲染
// markdown-it 由 public/index.html 以本地 vendor 脚本加载；没有加载时保留纯文本降级。
import { escapeHtml } from "./ui.js";

let parser;

function getParser() {
  if (parser !== undefined) return parser;
  const factory = typeof window !== "undefined" ? window.markdownit : null;
  parser = typeof factory === "function"
    ? factory({ html: false, breaks: true, linkify: false, typographer: false })
    : null;
  return parser;
}

export function renderMarkdown(value = "") {
  const source = String(value ?? "");
  if (!source) return "";
  const md = getParser();
  if (md) return md.render(source);
  return `<p>${escapeHtml(source).replace(/\r?\n/g, "<br>")}</p>`;
}

export function setMarkdown(element, value = "") {
  if (!element) return;
  const source = String(value ?? "");
  element.dataset.markdownSource = source;
  element.innerHTML = renderMarkdown(source);
}

export function appendMarkdown(element, value = "") {
  if (!element) return;
  setMarkdown(element, `${element.dataset.markdownSource || ""}${String(value ?? "")}`);
}
