import { state } from "../core/state.js";
import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, withLoading } from "../core/ui.js";

let bound = false;
function bindAtlas() {
  if (bound) return;
  bound = true;
  document.getElementById("atlas-multisource").addEventListener("change", (event) => {
    state.atlasFilters.multi = event.target.checked;
    renderAtlas();
  });
  document.getElementById("atlas-query").addEventListener("input", (event) => {
    state.atlasFilters.query = event.target.value;
    renderAtlas();
  });
  document.addEventListener("click", (event) => {
    const scopeButton = event.target.closest("[data-atlas-scope]");
    if (scopeButton && state.atlas) {
      state.atlasFilters.scope = scopeButton.dataset.atlasScope;
      $$("[data-atlas-scope]").forEach((button) => button.classList.toggle("active", button === scopeButton));
      renderAtlas();
    }
    const lensButton = event.target.closest("[data-graph-lens]");
    if (lensButton && state.atlas) {
      state.atlasGraphLens = lensButton.dataset.graphLens;
      state.atlasSelectedDimension = null;
      $$("[data-graph-lens]").forEach((button) => button.classList.toggle("active", button === lensButton));
      renderAtlas();
    }
    const graphNode = event.target.closest("[data-graph-node]");
    if (graphNode && state.atlas) {
      const nodeId = graphNode.dataset.graphNode;
      state.atlasSelectedDimension = state.atlasSelectedDimension === nodeId ? null : nodeId;
      renderAtlas();
    }
    const dimensionCard = event.target.closest("[data-dimension-node]");
    if (dimensionCard && state.atlas && !event.target.closest("details") && !event.target.closest("[data-dimension-pool]") && !event.target.closest("summary")) {
      const nodeId = dimensionCard.dataset.dimensionNode;
      state.atlasSelectedDimension = state.atlasSelectedDimension === nodeId ? null : nodeId;
      renderAtlas();
    }
    const eventPool = event.target.closest("[data-event-pool]");
    if (eventPool && state.atlas && state.activeBatchId) {
      const eventId = eventPool.dataset.eventPool;
      const tracks = String(eventPool.dataset.eventTracks || "article").split(",").filter(Boolean);
      withLoading(eventPool, "合成中…", () => createCompositeFromEvent(state.activeBatchId, eventId, "", tracks)).catch((error) => toast(error.message));
    }
    const dimensionPool = event.target.closest("[data-dimension-pool]");
    if (dimensionPool && state.activeBatchId) {
      const nodeId = dimensionPool.dataset.dimensionPool;
      const tracks = String(dimensionPool.dataset.dimensionTracks || "article").split(",").filter(Boolean);
      withLoading(dimensionPool, "合成中…", () => createCompositeFromDimension(state.activeBatchId, nodeId, tracks)).catch((error) => toast(error.message));
    }
  });
}

const LENS_LABELS = { who: "主体", what: "对比", where: "场合" };
const DIMENSION_ROLES = { who: "主体动态", what: "横向对比", where: "场合盘点" };
const LENS_COLORS = { who: "#355f55", what: "#7a5c2e", where: "#6b4a7d" };

function externalUrl(value) { return /^https?:\/\//.test(value) ? value : null; }

function eventCardHtml(card) {
  if (!card?.conclusion) return "";
  const list = (label, items) => Array.isArray(items) && items.length
    ? `<div class="event-card-row"><b>${label}</b><ul>${items.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>` : "";
  const increments = Array.isArray(card.source_increment) && card.source_increment.length
    ? `<div class="event-card-row"><b>来源增量</b><ul>${card.source_increment.map((x) => `<li>${escapeHtml(x.source)}：${escapeHtml(x.adds)}</li>`).join("")}</ul></div>` : "";
  const timeline = Array.isArray(card.timeline) && card.timeline.length
    ? `<div class="event-card-row"><b>时间线</b><ul>${card.timeline.map((x) => `<li>${escapeHtml(x.time)} ${escapeHtml(x.fact)}</li>`).join("")}</ul></div>` : "";
  const background = card.background ? `<p class="event-card-bg">${escapeHtml(card.background)}</p>` : "";
  return `<details class="event-card"><summary>事件卡：${escapeHtml(card.conclusion)}</summary>${background}${list("已确认事实", card.confirmed_facts)}${increments}${list("分歧", card.disagreements)}${timeline}${list("待核内容", card.unverified)}${list("可写角度", card.angles)}</details>`;
}

function atlasEvents() {
  if (!state.atlas) return [];
  let events = state.atlas.events || [];
  const f = state.atlasFilters;
  if (f.scope !== "全部") events = events.filter((e) => e.market_scope === f.scope);
  if (f.multi) events = events.filter((e) => e.source_count > 1);
  if (f.query) {
    const q = f.query.toLowerCase();
    events = events.filter((e) => (e.keywords || []).some((kw) => kw.toLowerCase().includes(q)) || e.representative_title?.toLowerCase().includes(q));
  }
  return events;
}

function activeLens() {
  return state.atlasGraphLens || "who";
}

function dimensionGroups() {
  const graph = state.atlas?.graph;
  if (!graph?.nodes) return [];
  return graph.nodes
    .filter((node) => node.type !== "event")
    .map((node) => ({
      ...node,
      events: graph.edges
        .filter((edge) => edge.to === node.id)
        .map((edge) => {
          const eventId = edge.from.replace(/^event:/, "");
          return (state.atlas.events || []).find((event) => event.event_id === eventId)
            || graph.nodes.find((item) => item.id === edge.from);
        })
        .filter(Boolean),
    }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

async function loadAtlas() {
  const batch = state.batches.find((b) => b.id === state.activeBatchId);
  if (!batch) return toast("请先选择一个批次");
  try {
    state.atlas = await request(`/api/batches/${encodeURIComponent(batch.id)}/overview`);
    renderAtlas();
  } catch (err) { toast("加载热点全景失败: " + err.message); }
}

function renderGraph() {
  const container = document.getElementById("event-graph");
  if (!container) return;
  const graph = state.atlas?.graph;
  if (!graph?.nodes?.length) {
    container.innerHTML = '<div class="empty-state">暂无关系图数据。完成打标与研判后，主体、动作与场合维度会在这里连成图。</div>';
    return;
  }
  const lens = activeLens();
  const dimNodes = graph.nodes.filter((node) => node.type === lens);
  if (!dimNodes.length) {
    container.innerHTML = `<div class="empty-state">当前批次没有「${LENS_LABELS[lens]}」维度的分组。该维度依赖打标扩展字段，重新打标后可补齐。</div>`;
    return;
  }
  const lensEdges = graph.edges.filter((edge) => edge.to.startsWith(`${lens}:`));
  const connectedEventIds = new Set(lensEdges.map((edge) => edge.from));
  const eventNodes = graph.nodes.filter((node) => node.type === "event" && connectedEventIds.has(node.id));
  const width = Math.max(container.clientWidth || 0, 480);
  const rowHeight = 44;
  const height = Math.max(300, Math.max(dimNodes.length, eventNodes.length) * rowHeight + 60);
  const dimX = Math.min(190, width * 0.28);
  const eventX = Math.max(width - 230, width * 0.66);
  const spread = (count) => (count <= 1 ? [height / 2] : Array.from({ length: count }, (_, i) => 40 + (i * (height - 80)) / (count - 1)));
  const dimY = spread(dimNodes.length);
  const eventY = spread(eventNodes.length);
  const maxScore = Math.max(...dimNodes.map((node) => node.score || 1), 1);
  const maxReports = Math.max(...eventNodes.map((node) => node.reportCount || 1), 1);
  const positions = new Map();
  dimNodes.forEach((node, i) => positions.set(node.id, { x: dimX, y: dimY[i], r: 10 + (node.score / maxScore) * 14, node }));
  eventNodes.forEach((node, i) => positions.set(node.id, { x: eventX, y: eventY[i], r: 5 + ((node.reportCount || 1) / maxReports) * 6, node }));
  const selected = state.atlasSelectedDimension || null;
  const selectedEventIds = new Set(selected ? lensEdges.filter((edge) => edge.to === selected).map((edge) => edge.from) : []);
  const edgePaths = lensEdges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return "";
    const midX = (from.x + to.x) / 2;
    const isActive = selected && edge.to === selected;
    return `<path d="M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}" class="graph-edge${isActive ? " graph-edge-active" : ""}${selected && !isActive ? " graph-dimmed" : ""}" />`;
  }).join("");
  const dimSvg = dimNodes.map((node) => {
    const pos = positions.get(node.id);
    const active = selected === node.id;
    return `<g class="graph-node graph-dim${active ? " graph-active" : ""}${selected && !active ? " graph-dimmed" : ""}" data-graph-node="${escapeHtml(node.id)}" style="cursor:pointer">
      <title>${escapeHtml(node.label)}（${LENS_LABELS[lens]}维度 · 维度分 ${node.score} · ${node.eventCount} 个事件）</title>
      <rect x="${pos.x - pos.r - 8}" y="${pos.y - pos.r - 8}" width="${(pos.r + 8) * 2}" height="${(pos.r + 8) * 2 + 16}" fill="#000" fill-opacity="0" pointer-events="all"></rect>
      <circle cx="${pos.x}" cy="${pos.y}" r="${pos.r}" fill="${LENS_COLORS[lens]}" opacity="${active ? 1 : 0.82}"></circle>
      <text x="${pos.x}" y="${pos.y + 3}" class="graph-score">${node.score}</text>
      <text x="${pos.x}" y="${pos.y + pos.r + 14}" class="graph-label">${escapeHtml(node.label.length > 14 ? node.label.slice(0, 13) + "…" : node.label)}</text>
    </g>`;
  }).join("");
  const eventSvg = eventNodes.map((node) => {
    const pos = positions.get(node.id);
    const title = String(node.title || "");
    const summary = String(node.summary || "").trim();
    const label = summary || title;
    const isConnected = selected && selectedEventIds.has(node.id);
    const tooltip = summary ? `${summary}\n代表报道：${title}（${node.reportCount || 1} 条报道）` : `${title}（${node.reportCount || 1} 条报道）`;
    return `<g class="graph-node graph-event${isConnected ? " graph-event-active" : ""}${selected && !isConnected ? " graph-dimmed" : ""}">
      <title>${escapeHtml(tooltip)}</title>
      <rect x="${pos.x - pos.r - 6}" y="${pos.y - 12}" width="${pos.r * 2 + 190}" height="24" fill="#000" fill-opacity="0" pointer-events="all"></rect>
      <circle cx="${pos.x}" cy="${pos.y}" r="${pos.r}" fill="${isConnected ? "#e44b3f" : "#8fa9bd"}"></circle>
      <text x="${pos.x + pos.r + 6}" y="${pos.y + 3}" class="graph-label graph-event-label${isConnected ? " graph-event-label-active" : ""}">${escapeHtml(label.length > 16 ? label.slice(0, 15) + "…" : label)}</text>
    </g>`;
  }).join("");
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" class="event-graph-svg" role="img" aria-label="事件关系图">${edgePaths}${eventSvg}${dimSvg}</svg>`;
}

function renderDimensionCards() {
  const groups = dimensionGroups();
  const cl = document.getElementById("coverage-list");
  if (!cl) return;
  if (!groups.length) {
    cl.innerHTML = '<div class="empty-state">暂无维度分组。重新打标后，主体动态、横向对比与场合盘点候选会出现在这里。</div>';
    return;
  }
  const selected = state.atlasSelectedDimension;
  cl.innerHTML = groups.map((group) => {
    const isActive = selected === group.id;
    const eventRefs = group.events.map((event) => {
      const links = (event.articles || []).map((a) => {
        const url = externalUrl(a.url);
        const origin = a.channel && a.channel !== a.source ? `${a.source} · ${a.channel}` : a.source;
        return url ? `<a href="${escapeHtml(url)}" target="_blank"><span>${escapeHtml(a.title)}</span><b>${escapeHtml(origin)}</b></a>` : `<span class="event-source-static"><span>${escapeHtml(a.title)}</span><b>${escapeHtml(origin)}</b></span>`;
      }).join("");
      const summary = String(event.card?.conclusion || "").trim();
      const headline = event.representative_title || event.title || "";
      return `<div class="hotword-event-ref"><span class="event-ref-summary">${escapeHtml(summary || headline)}</span>${summary && headline ? `<small class="event-ref-title muted">${escapeHtml(headline)}</small>` : ""}${eventCardHtml(event.card)}<div class="hotword-event-links">${links}</div></div>`;
    }).join("");
    return `<article class="hotword-index-card dimension-card${isActive ? " hotword-index-active" : ""}" data-dimension-node="${escapeHtml(group.id)}">
      <div class="hotword-index-head"><h4><span class="dimension-tag dimension-${escapeHtml(group.type)}">${LENS_LABELS[group.type]}</span> ${escapeHtml(group.label)}</h4><span class="muted">维度分 ${group.score} · ${group.events.length} 个事件</span></div>
      <div class="hotword-actions"><button class="ink-button" data-dimension-pool="${escapeHtml(group.id)}" data-dimension-tracks="article">加入文章池</button><button class="outline-button" data-dimension-pool="${escapeHtml(group.id)}" data-dimension-tracks="social_cards">加入图文池</button></div>
      <details class="hotword-index-refs"${isActive ? " open" : ""}><summary>${group.events.length} 个关联事件</summary>${eventRefs}</details>
    </article>`;
  }).join("");
}

function renderAtlas() {
  const atlas = state.atlas;
  if (!atlas) return;
  const events = atlasEvents();
  document.getElementById("atlas-filter-count").textContent = `显示 ${events.length} / ${atlas.eventCount} 个事件`;

  const scopeTotal = Math.max(1, events.length);
  const scopeColors = { 国内: "var(--red)", 全球性: "var(--yellow)", 国外: "var(--mint)" };
  const sd = document.getElementById("scope-distribution");
  if (sd) {
    sd.innerHTML = ["国内", "全球性", "国外"].map((scope) => {
      const count = events.filter((e) => e.market_scope === scope).length;
      return `<div class="scope-meter"><span>${scope}</span><div><i style="width:${(count / scopeTotal * 100)}%;background:${scopeColors[scope]}"></i></div><b>${count}</b></div>`;
    }).join("");
  }

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

  renderGraph();
  renderDimensionCards();
}

async function createCompositeFromEvent(batchId, eventId, eventTitle, tracks = ['article']) {
  const event = state.atlas?.events?.find((item) => item.event_id === eventId);
  if (!event) return toast("没有找到该事件，请先刷新热点全景");
  const title = prompt("综合选题名称（可选，默认以事件标题命名）：", eventTitle || event.representative_title) || event.representative_title;
  const hotspotIds = event.hotspot_ids || [];
  if (!hotspotIds.length) return toast("该事件簇没有关联的热点");
  if (hotspotIds.length === 1) {
    await request(`/api/batches/${encodeURIComponent(batchId)}/candidates`, {
      method: "POST", body: JSON.stringify({ hotspotIds, tracks }),
    });
    toast(`已加入选题池：${event.representative_title}`);
  } else {
    const candidate = await request(`/api/batches/${encodeURIComponent(batchId)}/candidates/composite`, {
      method: "POST", body: JSON.stringify({ hotspotIds, title, poolRole: "综合选题", tracks }),
    });
    toast(`已从事件簇创建综合选题：${candidate.candidate_id}`);
  }
  const { default: loadTopicPool } = await import("./topics.js");
  loadTopicPool();
  if (document.querySelector(".nav-item.active")?.dataset.view === "overview") await loadAtlas();
}

async function createCompositeFromDimension(batchId, nodeId, tracks = ['article']) {
  const graph = state.atlas?.graph;
  const node = graph?.nodes.find((item) => item.id === nodeId);
  if (!node || node.type === "event") return toast("没有找到该维度分组，请先刷新热点全景");
  const eventIds = graph.edges.filter((edge) => edge.to === nodeId).map((edge) => edge.from.replace(/^event:/, ""));
  const hotspotIds = [...new Set(eventIds.flatMap((eventId) => (state.atlas.events || []).find((event) => event.event_id === eventId)?.hotspot_ids || []))];
  if (hotspotIds.length < 2) return toast("该维度分组关联的热点不足以创建综合选题");
  const candidate = await request(`/api/batches/${encodeURIComponent(batchId)}/candidates/composite`, {
    method: "POST", body: JSON.stringify({ hotspotIds, title: node.label, poolRole: DIMENSION_ROLES[node.type] || "维度选题", tracks }),
  });
  toast(`已创建${LENS_LABELS[node.type]}维度选题：${candidate.candidate_id}（${hotspotIds.length} 条报道）`);
  const { default: loadTopicPool } = await import("./topics.js");
  loadTopicPool();
}


export default async function loadAtlasView() {
  bindAtlas();
  return loadAtlas();
}
