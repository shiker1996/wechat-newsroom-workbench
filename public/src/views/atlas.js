import { state } from "../core/state.js";
import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast } from "../core/ui.js";

function externalUrl(value) { return /^https?:\/\//.test(value) ? value : null; }

function atlasEvents() {
  if (!state.atlas) return [];
  let events = state.atlas.events || [];
  const f = state.atlasFilters;
  if (f.scope !== "全部") events = events.filter((e) => e.market_scope === f.scope);
  if (f.category !== "全部") events = events.filter((e) => e.topic_category === f.category);
  if (f.multi) events = events.filter((e) => e.source_count > 1);
  if (f.query) {
    const q = f.query.toLowerCase();
    events = events.filter((e) => (e.keywords || []).some((kw) => kw.toLowerCase().includes(q)) || e.representative_title?.toLowerCase().includes(q));
  }
  return events;
}

function atlasWords(events) {
  const freq = {};
  events.forEach((e) => (e.keywords || []).forEach((kw) => { freq[kw] = (freq[kw] || 0) + 1; }));
  return Object.entries(freq).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 40);
}

async function loadAtlas() {
  const batch = state.batches.find((b) => b.id === state.activeBatchId);
  if (!batch) return toast("请先选择一个批次");
  try {
    const atlas = await request(`/api/batches/${encodeURIComponent(batch.id)}/overview`);
    state.atlas = atlas;
    try {
      const kw = await request(`/api/batches/${encodeURIComponent(batch.id)}/candidates`);
      state.atlas.keywords = atlas.keywords || [];
    } catch {}
    renderAtlas();
  } catch (err) { toast("加载热点全景失败: " + err.message); }
}

function renderAtlas() {
  const atlas = state.atlas;
  if (!atlas) return;
  const events = atlasEvents();
  document.getElementById("atlas-filter-count").textContent = `显示 ${events.length} / ${atlas.eventCount} 个事件`;

  // Scope distribution
  const scopeTotal = Math.max(1, events.length);
  const scopeColors = { 国内: "var(--red)", 全球性: "var(--yellow)", 国外: "var(--mint)" };
  const sd = document.getElementById("scope-distribution");
  if (sd) {
    sd.innerHTML = ["国内", "全球性", "国外"].map((scope) => {
      const count = events.filter((e) => e.market_scope === scope).length;
      return `<div class="scope-meter"><span>${scope}</span><div><i style="width:${(count / scopeTotal * 100)}%;background:${scopeColors[scope]}"></i></div><b>${count}</b></div>`;
    }).join("");
  }

  // Channel bars
  const sourceMap = new Map();
  events.forEach((event) => [...new Set(event.articles.map((a) => a.source).filter(Boolean))].forEach((src) => sourceMap.set(src, (sourceMap.get(src) || 0) + 1)));
  const sources = [...sourceMap].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14);
  const maxSource = sources[0]?.[1] || 1;
  const cb = document.getElementById("channel-bars");
  if (cb) {
    cb.innerHTML = sources.length
      ? sources.map(([name, count]) => `<div class="bar-row"><span>${escapeHtml(name)}</span><div class="bar-track"><i style="width:${Math.max(3, count / maxSource * 100)}%"></i></div><b>${count}</b></div>`).join("")
      : '<div class="empty-state">当前筛选下没有来源</div>';
  }

  // Keyword cloud
  const words = atlasWords(events);
  const maxWord = words[0]?.[1] || 1;
  const wordSummaries = state.atlas.keywords || [];
  const cloud = document.getElementById("keyword-cloud");
  if (cloud) {
    cloud.innerHTML = words.map(([word, weight], index) => {
      const ws = wordSummaries.find((w) => w.name === word);
      const summary = ws?.summary || "";
      const isActive = state.atlasSelectedWord === word;
      return `<button style="font-size:${12 + Math.round(Math.sqrt(weight / maxWord) * 30)}px;--word-delay:${Math.min(index, 18) * 18}ms${isActive ? ";--word-active:true" : ""}" title="${summary ? escapeHtml(summary.slice(0, 100)) : "事件覆盖权重 " + weight.toFixed(1)}" class="${isActive ? "cloud-word-active" : ""}" data-atlas-word="${escapeHtml(word)}">${escapeHtml(word)}</button>`;
    }).join("");
  }

  // Coverage list (hotword summary + cards)
  const selectedWord = state.atlasSelectedWord;
  let hwHTML = "";
  if (selectedWord) {
    const ws = wordSummaries.find((w) => w.name === selectedWord);
    const matchedCount = events.filter((e) => (e.keywords || []).some((kw) => kw.toLowerCase().includes(selectedWord.toLowerCase()))).length;
    const hwPanel = document.getElementById("hotword-summary-panel");
    if (ws?.summary) {
      hwHTML = `<div class="hotword-summary-panel"><div class="hotword-summary-head"><span class="kicker">HOTWORD OVERVIEW</span><h3>"${escapeHtml(selectedWord)}" 热词综述</h3></div><p>${escapeHtml(ws.summary)}</p><div class="hotword-actions"><button class="ink-button" data-hotword-composite="${escapeHtml(selectedWord)}">从"${escapeHtml(selectedWord)}"创建综合选题 →</button><span class="muted">覆盖 ${matchedCount} 个关联事件</span></div></div>`;
    } else {
      hwHTML = `<div class="hotword-summary-panel dim"><div class="hotword-summary-head"><span class="kicker">HOTWORD OVERVIEW</span><h3>"${escapeHtml(selectedWord)}"</h3></div><p>该热词尚无 AI 综述。</p><div class="hotword-actions"><button class="outline-button" data-hotword-composite="${escapeHtml(selectedWord)}">以此热词创建综合选题 →</button><button class="text-button" data-hotword-gen-summary="${escapeHtml(selectedWord)}">生成 AI 综述</button><span class="muted">覆盖 ${matchedCount} 个关联事件</span></div></div>`;
    }
  }
  let wordCards = wordSummaries.filter((w) => w.summary);
  if (!wordCards.length) wordCards = wordSummaries.slice(0, 20);
  if (selectedWord) wordCards = wordCards.filter((w) => w.name === selectedWord);
  const indexHTML = wordCards.map((kw) => {
    const matchedEvents = events.filter((e) => (e.keywords || []).some((w) => w.toLowerCase() === kw.name.toLowerCase()));
    const count = matchedEvents.length;
    const isActive = kw.name === selectedWord;
    const refs = isActive && matchedEvents.length
      ? `<details class="hotword-index-refs" open><summary>${count} 个关联事件</summary>${matchedEvents.map((event) => {
          const links = event.articles.map((a) => {
            const url = externalUrl(a.url);
            const origin = a.channel && a.channel !== a.source ? `${a.source} · ${a.channel}` : a.source;
            return url ? `<a href="${escapeHtml(url)}" target="_blank"><span>${escapeHtml(a.title)}</span><b>${escapeHtml(origin)}</b></a>` : `<span class="event-source-static"><span>${escapeHtml(a.title)}</span><b>${escapeHtml(origin)}</b></span>`;
          }).join("");
          return `<div class="hotword-event-ref"><span>${escapeHtml(event.representative_title)}</span><div class="hotword-event-links">${links}</div></div>`;
        }).join("")}</details>`
      : "";
    return `<article class="hotword-index-card${isActive ? " hotword-index-active" : ""}" data-atlas-word="${escapeHtml(kw.name)}"><div class="hotword-index-head"><h4>${escapeHtml(kw.name)}</h4><span class="muted">${count} 个事件</span></div><p>${kw.summary ? escapeHtml(kw.summary) : '<span class="muted">尚无 AI 综述。点击词云中的热词查看关联事件，或生成综述。</span>'}</p>${refs}</article>`;
  }).join("");
  const cl = document.getElementById("coverage-list");
  if (cl) cl.innerHTML = hwHTML + indexHTML;
}

async function createCompositeFromEvent(batchId, eventIndex, eventTitle) {
  const title = prompt("综合选题名称（可选，默认以事件标题命名）：", eventTitle) || eventTitle;
  const event = state.atlas?.events?.[eventIndex - 1];
  if (!event?.hotspot_ids?.length) return toast("该事件簇没有关联的热点");
  const candidate = await request(`/api/batches/${encodeURIComponent(batchId)}/candidates/composite`, {
    method: "POST", body: JSON.stringify({ hotspotIds: event.hotspot_ids, title, poolRole: "综合选题" }),
  });
  toast(`已从事件簇创建综合选题：${candidate.candidate_id}`);
  // refresh
  const { default: loadTopicPool } = await import("./topics.js");
  loadTopicPool();
  if (document.querySelector(".nav-item.active")?.dataset.view === "overview") await loadAtlas();
}

async function createCompositeFromHotword(batchId, hotword) {
  if (!state.atlas) return toast("请先加载热点全景");
  const needle = hotword.toLowerCase();
  const matchedEvents = state.atlas.events.filter((e) => (e.keywords || []).some((kw) => kw.toLowerCase().includes(needle)));
  const hotspotIds = [...new Set(matchedEvents.flatMap((e) => e.hotspot_ids || []))];
  if (hotspotIds.length < 2) return toast("该热词关联的热点不足以创建综合选题");
  const candidate = await request(`/api/batches/${encodeURIComponent(batchId)}/candidates/composite`, {
    method: "POST", body: JSON.stringify({ hotspotIds, title: `关于"${hotword}"的近期热点综述`, poolRole: "综合选题" }),
  });
  toast(`已创建综合选题：${candidate.candidate_id}（${hotspotIds.length} 个来源）`);
  const { default: loadTopicPool } = await import("./topics.js");
  loadTopicPool();
}

async function generateHotwordSummary(batchId, hotword) {
  return await request(`/api/batches/${encodeURIComponent(batchId)}/hotword-summary/${encodeURIComponent(hotword)}`, { method: "POST" });
}

// Expose for inline events
window.renderAtlas = renderAtlas;
window.externalUrl = externalUrl;
window.atlasEvents = atlasEvents;
window.createCompositeFromEvent = createCompositeFromEvent;
window.createCompositeFromHotword = createCompositeFromHotword;
window.generateHotwordSummary = generateHotwordSummary;

export default loadAtlas;