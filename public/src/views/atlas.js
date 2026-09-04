import { state } from "../core/state.js";
import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { GRAPH_ZOOM_STEP } from "../core/constants.js";
import { escapeHtml, toast, withLoading, confirmAction, debounce } from "../core/ui.js";
import { dimensionLabels, dimensionRoles } from "../core/dimensions.js";

let bound = false;
const HOTLIST_DISPLAY_LIMIT = 50;
const graphView = { scale: 1, x: 0, y: 0, dragging: false, pointerX: 0, pointerY: 0 };
let graphAutoFocusPending = true;

function applyGraphTransform() {
  const content = document.getElementById("event-graph-content");
  if (!content) return;
  content.setAttribute("transform", `translate(${graphView.x} ${graphView.y}) scale(${graphView.scale})`);
  const reset = document.querySelector('[data-graph-zoom="reset"]');
  if (reset) reset.textContent = `${Math.round(graphView.scale * 100)}%`;
}

function zoomGraph(factor, clientX, clientY) {
  const svg = document.querySelector(".event-graph-svg");
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const pointX = ((clientX ?? rect.left + rect.width / 2) - rect.left) * ((Number(svg.dataset.width) || rect.width) / rect.width);
  const pointY = ((clientY ?? rect.top + rect.height / 2) - rect.top) * (500 / rect.height);
  const next = Math.max(0.45, Math.min(2.5, graphView.scale * factor));
  graphView.x = pointX - ((pointX - graphView.x) * next) / graphView.scale;
  graphView.y = pointY - ((pointY - graphView.y) * next) / graphView.scale;
  graphView.scale = next;
  applyGraphTransform();
}

function resetGraphView({ autoFocus = false } = {}) {
  graphView.scale = 1; graphView.x = 0; graphView.y = 0;
  graphAutoFocusPending = autoFocus;
  applyGraphTransform();
}

function bindAtlas() {
  if (bound) return;
  bound = true;
  document.getElementById("atlas-multisource").addEventListener("change", (event) => {
    state.atlasFilters.multi = event.target.checked;
    renderAtlas();
  });
  const renderAtlasDebounced = debounce(() => renderAtlas());
  document.getElementById("atlas-query").addEventListener("input", (event) => {
    state.atlasFilters.query = event.target.value;
    renderAtlasDebounced();
  });
  const eventDetailDialog = document.getElementById("event-detail-dialog");
  eventDetailDialog?.addEventListener("click", (event) => {
    if (event.target === eventDetailDialog) eventDetailDialog.close();
  });
  document.addEventListener("click", (event) => {
    const modeButton = event.target.closest("[data-atlas-mode]");
    if (modeButton && state.atlas) {
      state.atlasMode = modeButton.dataset.atlasMode || "hotlist";
      $$('[data-atlas-mode]').forEach((button) => {
        const active = button === modeButton;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
      });
      renderAtlas();
    }
    const insightTab = event.target.closest("[data-atlas-insight-tab]");
    if (insightTab && state.atlas) {
      setAtlasInsightTab(insightTab.dataset.atlasInsightTab);
    }
    const scopeButton = event.target.closest("[data-atlas-scope]");
    if (scopeButton && state.atlas) {
      state.atlasFilters.scope = scopeButton.dataset.atlasScope;
      $$("[data-atlas-scope]").forEach((button) => {
        button.classList.toggle("active", button === scopeButton);
        button.setAttribute("aria-selected", String(button === scopeButton));
      });
      renderAtlas();
    }
    const contentClassButton = event.target.closest("[data-atlas-content-class]");
    if (contentClassButton && state.atlas) {
      state.atlasFilters.contentClass = contentClassButton.dataset.atlasContentClass || "news_event";
      $$('[data-atlas-content-class]').forEach((button) => {
        const active = button === contentClassButton;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
      });
      renderAtlas();
    }
    const lensButton = event.target.closest("[data-graph-lens]");
    if (lensButton && state.atlas) {
      state.atlasGraphLens = lensButton.dataset.graphLens;
      state.atlasSelectedDimension = null;
      resetGraphView({ autoFocus: true });
      $$("[data-graph-lens]").forEach((button) => {
        button.classList.toggle("active", button === lensButton);
        button.setAttribute("aria-selected", String(button === lensButton));
      });
      renderAtlas();
    }
    const zoomButton = event.target.closest("[data-graph-zoom]");
    if (zoomButton) {
      if (zoomButton.dataset.graphZoom === "reset") resetGraphView();
      else zoomGraph(zoomButton.dataset.graphZoom === "in" ? GRAPH_ZOOM_STEP : 1 / GRAPH_ZOOM_STEP);
    }
    const graphNode = event.target.closest("[data-graph-node]");
    if (graphNode && state.atlas) {
      toggleGraphNode(graphNode.dataset.graphNode);
    }
    const eventNode = event.target.closest("[data-event-node]");
    if (eventNode && state.atlas) {
      openEventDetail(eventNode.dataset.eventNode);
    }
    const eventDetailCard = event.target.closest("[data-event-detail]");
    if (eventDetailCard && !event.target.closest("[data-event-hotlist-pool]") && state.atlas) {
      openEventDetail(eventDetailCard.dataset.eventDetail);
    }
    if (event.target.closest("[data-close-event-detail]")) {
      document.getElementById("event-detail-dialog")?.close();
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
      withLoading(eventPool, "合成中…", () => createCompositeFromEvent(state.activeBatchId, eventId, tracks)).catch((error) => toast(error.message, "error"));
    }
    const eventHotlistPool = event.target.closest("[data-event-hotlist-pool]");
    if (eventHotlistPool && state.atlas && state.activeBatchId) {
      const eventId = eventHotlistPool.dataset.eventHotlistPool;
      const tracks = String(eventHotlistPool.dataset.eventTracks || "article").split(",").filter(Boolean);
      withLoading(eventHotlistPool, "合成中…", () => createCompositeFromHotlist(state.activeBatchId, eventId, tracks)).catch((error) => toast(error.message, "error"));
    }
    const dimensionPool = event.target.closest("[data-dimension-pool]");
    if (dimensionPool && state.activeBatchId) {
      const nodeId = dimensionPool.dataset.dimensionPool;
      const tracks = String(dimensionPool.dataset.dimensionTracks || "article").split(",").filter(Boolean);
      withLoading(dimensionPool, "合成中…", () => createCompositeFromDimension(state.activeBatchId, nodeId, tracks)).catch((error) => toast(error.message, "error"));
    }
    const collectButton=event.target.closest("[data-atlas-collect]");
    if(collectButton&&state.activeBatchId){
      import("./batch-drawer.js").then(({openBatch})=>openBatch(state.activeBatchId)).catch((error)=>toast(error.message, "error"));
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const eventDetailCard = event.target.closest?.("[data-event-detail]");
    if (!eventDetailCard || event.target !== eventDetailCard || !state.atlas) return;
    event.preventDefault();
    openEventDetail(eventDetailCard.dataset.eventDetail);
  });
  const graph = document.getElementById("event-graph");
  graph.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomGraph(event.deltaY < 0 ? GRAPH_ZOOM_STEP : 1 / GRAPH_ZOOM_STEP, event.clientX, event.clientY);
  }, { passive: false });
  graph.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-graph-node],[data-event-node]")) return;
    graphView.dragging = true; graphView.pointerX = event.clientX; graphView.pointerY = event.clientY;
    graph.classList.add("is-panning");
    graph.setPointerCapture(event.pointerId);
  });
  graph.addEventListener("pointermove", (event) => {
    if (!graphView.dragging) return;
    const svg = graph.querySelector("svg");
    const rect = svg?.getBoundingClientRect();
    if (!rect) return;
    graphView.x += (event.clientX - graphView.pointerX) * ((Number(svg.dataset.width) || rect.width) / rect.width);
    graphView.y += (event.clientY - graphView.pointerY) * (500 / rect.height);
    graphView.pointerX = event.clientX; graphView.pointerY = event.clientY;
    applyGraphTransform();
  });
  const stopPanning = () => { graphView.dragging = false; graph.classList.remove("is-panning"); };
  graph.addEventListener("pointerup", stopPanning);
  graph.addEventListener("pointercancel", stopPanning);
  // SVG 维度节点带 role="button"，支持 Enter/Space 触发（与点击同逻辑）
  graph.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!(event.target instanceof Element) || !state.atlas) return;
    event.preventDefault();
    if (event.target.matches("[data-graph-node]")) toggleGraphNode(event.target.dataset.graphNode);
    else if (event.target.matches("[data-event-node]")) openEventDetail(event.target.dataset.eventNode);
  });
}

function renderAtlasInsightTabs() {
  const selected = state.atlasInsightTab === "dimensions" ? "dimensions" : "relations";
  $$('[data-atlas-insight-tab]').forEach((button) => {
    const active = button.dataset.atlasInsightTab === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$('[data-atlas-insight-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.atlasInsightPanel !== selected;
  });
}

function setAtlasInsightTab(tab, { scroll = false } = {}) {
  state.atlasInsightTab = tab === "dimensions" ? "dimensions" : "relations";
  renderAtlasInsightTabs();
  if (scroll) requestAnimationFrame(() => document.getElementById(`atlas-insight-${state.atlasInsightTab}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function focusSelectedDimension(nodeId) {
  requestAnimationFrame(() => document.querySelector(`[data-dimension-node="${CSS.escape(nodeId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
}

function toggleGraphNode(nodeId) {
  state.atlasSelectedDimension = state.atlasSelectedDimension === nodeId ? null : nodeId;
  setAtlasInsightTab("dimensions");
  // 重渲染会重建 SVG，键盘操作后把焦点还给新节点
  const hadFocus = document.activeElement?.matches?.("[data-graph-node]");
  renderAtlas();
  if (hadFocus) document.querySelector(`[data-graph-node="${CSS.escape(nodeId)}"]`)?.focus();
  focusSelectedDimension(nodeId);
}

const LENS_LABELS = { ...dimensionLabels, relation: "关系" };
const DIMENSION_ROLES = dimensionRoles;
const LENS_COLORS = { who: "#355f55", what: "#7a5c2e", where: "#6b4a7d", relation: "#9a4e42" };
const CONTENT_CLASS_LABELS = {
  github_project: "工具图文",
  open_source_technology: "开源技术",
  open_source_trend: "开源趋势",
  news_event: "普通事件",
};
const CLASSIFICATION_STATUS_LABELS = { auto: "规则确认", model_validated: "模型确认", needs_review: "待复核", manual: "人工确认" };

export function socialContentClassOf(item, fallback = "news_event") {
  return item?.content_class || item?.contentClass || item?.classification?.content_class || item?.classification?.contentClass || fallback;
}

export function socialPoolPresentation(contentClass, { eventSocial = false } = {}) {
  if (contentClass === "github_project") return { label: "工具图文", target: "social-editor", poolRole: "工具图文" };
  if (eventSocial || ["news_event", "open_source_technology", "open_source_trend"].includes(contentClass)) return { label: "事件图文", target: "social-event", poolRole: "事件热榜图文" };
  return { label: "图文选题池", target: "social-topics", poolRole: "" };
}

function externalUrl(value) { return /^https?:\/\//.test(value) ? value : null; }

function classificationHtml(classification) {
  const contentClass = classification?.content_class || classification?.contentClass;
  if (!contentClass) return "";
  const label = CONTENT_CLASS_LABELS[contentClass] || contentClass;
  const status = classification?.status || classification?.classification_status;
  const statusLabel = CLASSIFICATION_STATUS_LABELS[status];
  const route = classification?.default_route || classification?.defaultRoute;
  const routeLabel = route === "social_cards" ? "默认图文" : route === "editorial_review" ? "文章/图文" : "待定";
  const warning = classification?.reason || classification?.classification_reason || "";
  return `<span class="content-class-badge content-class-${escapeHtml(contentClass)}" title="${escapeHtml(warning)}">${escapeHtml(label)}</span><span class="content-route-badge">${escapeHtml(routeLabel)}${statusLabel ? ` · ${escapeHtml(statusLabel)}` : ""}</span>`;
}

function eventCardHtml(card) {
  if (!card?.conclusion) return "";
  const list = (label, items) => Array.isArray(items) && items.length
    ? `<div class="event-card-row"><b>${label}</b><ul>${items.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>` : "";
  const increments = Array.isArray(card.source_increment) && card.source_increment.length
    ? `<div class="event-card-row"><b>来源增量</b><ul>${card.source_increment.map((x) => `<li>${escapeHtml(x.source)}：${escapeHtml(x.adds)}</li>`).join("")}</ul></div>` : "";
  const timeline = Array.isArray(card.timeline) && card.timeline.length
    ? `<div class="event-card-row"><b>时间线</b><ul>${card.timeline.map((x) => `<li>${escapeHtml(x.time)} ${escapeHtml(x.fact)}</li>`).join("")}</ul></div>` : "";
  const background = card.background ? `<p class="event-card-bg">${escapeHtml(card.background)}</p>` : "";
  return `<details class="event-card"><summary>${classificationHtml(card.classification)} 事件卡：${escapeHtml(card.conclusion)}</summary>${background}${list("已确认事实", card.confirmed_facts)}${increments}${list("分歧", card.disagreements)}${timeline}${list("待核内容", card.unverified)}${list("可写角度", card.angles)}</details>`;
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

function atlasHotlistItems() {
  if (!state.atlas) return [];
  const contentClass = state.atlasFilters.contentClass || "news_event";
  let items = state.atlas.eventHeatRankings?.[contentClass]?.items || (state.atlas.eventHotlist || []).filter((item) => (item.content_class || item.contentClass) === contentClass);
  const f = state.atlasFilters;
  if (f.scope !== "全部") items = items.filter((item) => (item.marketScopes || []).includes(f.scope));
  if (f.multi) items = items.filter((item) => Number(item.sourceCount || 0) > 1);
  if (f.query) {
    const q = f.query.toLowerCase();
    items = items.filter((item) => [item.title, ...(item.keywords || []), ...(item.reason || [])]
      .filter(Boolean).some((value) => String(value).toLowerCase().includes(q)));
  }
  return items;
}

function activeLens() {
  return state.atlasGraphLens || "who";
}

function filteredGraph(events) {
  const graph = state.atlas?.graph;
  if (!graph?.nodes) return { nodes: [], edges: [] };
  const eventIds = new Set((events || []).map((event) => `event:${event.event_id}`));
  const edges = (graph.edges || []).filter((edge) => eventIds.has(edge.from));
  const dimensionIds = new Set(edges.map((edge) => edge.to));
  const visibleEventCount = new Map();
  for (const edge of edges) visibleEventCount.set(edge.to, (visibleEventCount.get(edge.to) || 0) + 1);
  const nodes = (graph.nodes || [])
    .filter((node) => eventIds.has(node.id) || dimensionIds.has(node.id))
    .map((node) => node.type === "event" ? node : { ...node, eventCount: visibleEventCount.get(node.id) || 0 });
  return { ...graph, nodes, edges };
}

function dimensionGroups(events) {
  const graph = filteredGraph(events);
  if (!graph?.nodes) return [];
  return graph.nodes
    .filter((node) => node.type !== "event" && node.type !== "relation")
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
  const graph = document.getElementById("event-graph");
  if (graph) {
    graph.setAttribute("aria-busy", "true");
    graph.innerHTML = '<div class="empty-state">正在加载热点全景…</div>';
  }
  try {
    state.atlas = await request(`/api/batches/${encodeURIComponent(batch.id)}/overview`);
    resetGraphView({ autoFocus: true });
    renderAtlas();
  } catch (err) { toast("加载热点全景失败: " + err.message, "error"); }
  finally { graph?.removeAttribute("aria-busy"); }
}

function renderGraph(events) {
  const container = document.getElementById("event-graph");
  if (!container) return;
  const graph = filteredGraph(events);
  if (!graph?.nodes?.length) {
    container.innerHTML = '<div class="empty-state">暂无关系图数据。完成打标与研判后，主体、动作、场合与讨论关系会在这里连成图。</div>';
    return;
  }
  const lens = activeLens();
  const dimNodes = graph.nodes
    .filter((node) => node.type === lens)
    .sort((a, b) => (b.score || 0) - (a.score || 0) || String(a.label).localeCompare(String(b.label), "zh-CN"));
  if (!dimNodes.length) {
    container.innerHTML = `<div class="empty-state">当前批次没有「${LENS_LABELS[lens]}」维度的分组。该维度依赖打标扩展字段，重新打标后可补齐。</div>`;
    return;
  }
  const lensEdges = graph.edges.filter((edge) => edge.to.startsWith(`${lens}:`));
  const connectedEventIds = new Set(lensEdges.map((edge) => edge.from));
  const dimensionOrder = new Map(dimNodes.map((node, index) => [node.id, index]));
  const eventOrder = new Map();
  lensEdges.forEach((edge) => eventOrder.set(edge.from, Math.min(eventOrder.get(edge.from) ?? Infinity, dimensionOrder.get(edge.to) ?? Infinity)));
  const eventNodes = graph.nodes
    .filter((node) => node.type === "event" && connectedEventIds.has(node.id))
    .sort((a, b) => (eventOrder.get(a.id) ?? Infinity) - (eventOrder.get(b.id) ?? Infinity)
      || (b.reportCount || 0) - (a.reportCount || 0)
      || String(a.title).localeCompare(String(b.title), "zh-CN"));
  const width = Math.max(container.clientWidth || 0, 480);
  const rowHeight = 44;
  const viewportHeight = 500;
  const contentHeight = Math.max(360, Math.max(dimNodes.length, eventNodes.length) * rowHeight + 60);
  const dimX = Math.min(190, width * 0.28);
  const eventX = Math.max(width - 230, width * 0.66);
  const spread = (count) => (count <= 1 ? [contentHeight / 2] : Array.from({ length: count }, (_, i) => 40 + (i * (contentHeight - 80)) / (count - 1)));
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
    return `<g class="graph-node graph-dim${active ? " graph-active" : ""}${selected && !active ? " graph-dimmed" : ""}" data-graph-node="${escapeHtml(node.id)}" style="cursor:pointer" tabindex="0" role="button" aria-label="${escapeHtml(node.label)}（${LENS_LABELS[lens]}维度 · 维度分 ${node.score} · ${node.eventCount} 个事件，回车选中）">
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
    const isFocus = node.priorityRank === Math.min(...eventNodes.map((item)=>Number(item.priorityRank??Infinity)));
    return `<g class="graph-node graph-event${isFocus ? " graph-event-focus" : ""}${isConnected ? " graph-event-active" : ""}${selected && !isConnected ? " graph-dimmed" : ""}" data-event-node="${escapeHtml(String(node.id).replace(/^event:/, ""))}" tabindex="0" role="button" aria-label="查看事件详情：${escapeHtml(title)}">
      <title>${escapeHtml(tooltip)}</title>
      <rect x="${pos.x - pos.r - 6}" y="${pos.y - 12}" width="${pos.r * 2 + 190}" height="24" fill="#000" fill-opacity="0" pointer-events="all"></rect>
      <circle cx="${pos.x}" cy="${pos.y}" r="${pos.r}" fill="${isConnected ? "#e44b3f" : "#8fa9bd"}"></circle>
      <text x="${pos.x + pos.r + 6}" y="${pos.y + 3}" class="graph-label graph-event-label${isConnected ? " graph-event-label-active" : ""}">${escapeHtml(label.length > 16 ? label.slice(0, 15) + "…" : label)}</text>
    </g>`;
  }).join("");
  container.innerHTML = `<svg viewBox="0 0 ${width} ${viewportHeight}" data-width="${width}" class="event-graph-svg" role="img" aria-label="按${LENS_LABELS[lens]}排序的事件关系图"><g id="event-graph-content">${edgePaths}${eventSvg}${dimSvg}</g></svg><span class="graph-pan-hint">滚轮缩放 · 拖动画布</span>`;
  if(graphAutoFocusPending&&eventNodes.length){
    const focusNode=[...eventNodes].sort((a,b)=>Number(a.priorityRank??Infinity)-Number(b.priorityRank??Infinity))[0];
    const focusPosition=positions.get(focusNode.id);
    if(focusPosition){
      graphView.scale=1.22;
      graphView.x=width*.58-focusPosition.x*graphView.scale;
      graphView.y=viewportHeight*.46-focusPosition.y*graphView.scale;
    }
    graphAutoFocusPending=false;
  }
  applyGraphTransform();
}

function renderDimensionCards(events) {
  const groups = dimensionGroups(events);
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
        return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(a.title)}</span><b>${escapeHtml(origin)}</b></a>` : `<span class="event-source-static"><span>${escapeHtml(a.title)}</span><b>${escapeHtml(origin)}</b></span>`;
      }).join("");
      const summary = String(event.card?.conclusion || "").trim();
      const headline = event.representative_title || event.title || "";
      return `<div class="hotword-event-ref"><span class="event-ref-summary">${classificationHtml(event.classification)} ${escapeHtml(summary || headline)}</span>${summary && headline ? `<small class="event-ref-title muted">${escapeHtml(headline)}</small>` : ""}${eventCardHtml(event.card)}<div class="hotword-event-links">${links}</div></div>`;
    }).join("");
    return `<article class="hotword-index-card dimension-card${isActive ? " hotword-index-active" : ""}" data-dimension-node="${escapeHtml(group.id)}">
      <div class="hotword-index-head"><h4><span class="dimension-tag dimension-${escapeHtml(group.type)}">${LENS_LABELS[group.type]}</span> ${escapeHtml(group.label)}</h4><span class="muted">维度分 ${group.score} · ${group.events.length} 个事件</span></div>
      <div class="hotword-actions"><button class="ink-button" data-dimension-pool="${escapeHtml(group.id)}" data-dimension-tracks="article">加入文章池</button><button class="outline-button" data-dimension-pool="${escapeHtml(group.id)}" data-dimension-tracks="social_cards">加入图文池</button></div>
      <details class="hotword-index-refs"${isActive ? " open" : ""}><summary>${group.events.length} 个关联事件</summary>${eventRefs}</details>
    </article>`;
  }).join("");
}

function renderEventHotlist() {
  const container = document.getElementById("event-hotlist");
  if (!container) return;
  const allItems = atlasHotlistItems();
  const items = allItems.slice(0, HOTLIST_DISPLAY_LIMIT);
  if (!allItems.length) {
    container.innerHTML = '<div class="empty-state">当前筛选下没有稳定事件热榜项。完成归并后，首次出现和有事实增量的事件会优先进入这里。</div>';
    return;
  }
  const stateLabels = { new_event: "新事件", new_update: "有增量", continuing: "持续", stale: "过时" };
  const modelLabels = { news_event: "T_news", open_source_technology: "T_technology", open_source_trend: "T_trend", github_project: "projectDiscoveryScore" };
  const contentClass = state.atlasFilters.contentClass || "news_event";
  const summary = `<div class="event-hotlist-summary">${escapeHtml(modelLabels[contentClass] || "分类评分")} 独立排序；默认展示前 ${Math.min(HOTLIST_DISPLAY_LIMIT, allItems.length)} 条，共 ${allItems.length} 条符合当前筛选。`;
  container.innerHTML = summary + items.map((item) => {
    const stateLabel = stateLabels[item.state] || item.state || "持续";
    const delta = item.rankDelta == null ? "新上榜" : (item.rankDelta > 0 ? `↑${item.rankDelta}` : item.rankDelta < 0 ? `↓${Math.abs(item.rankDelta)}` : "—");
    const scopes = (item.marketScopes || []).join(" / ") || "待标注";
    const reason = (item.reason || []).slice(0, 3).map((value) => `<span>${escapeHtml(value)}</span>`).join("");
    return `<article class="event-hotlist-item event-hotlist-${escapeHtml(item.state || "continuing")}" data-event-detail="${escapeHtml(item.eventId)}" tabindex="0" aria-label="查看事件详情：${escapeHtml(item.title || item.eventId)}">
      <div class="event-hotlist-rank"><b>${item.rank}</b><span>${escapeHtml(delta)}</span></div>
      <div class="event-hotlist-main"><h4>${classificationHtml(item)} ${escapeHtml(item.title || item.eventId)}</h4><div class="event-hotlist-meta"><span class="event-state">${escapeHtml(stateLabel)}</span><span>评分 ${item.scoreValue ?? item.heatScore}</span><span>${item.reportCount} 条报道</span><span>${item.sourceCount} 个来源</span><span>${escapeHtml(scopes)}</span></div><div class="event-hotlist-reasons">${reason}</div></div>
      <div class="event-hotlist-score"><strong>${item.scoreValue ?? item.heatScore}</strong><button class="ink-button" data-event-hotlist-pool="${escapeHtml(item.eventId)}" data-event-tracks="article">加入文章池</button><button class="outline-button" data-event-hotlist-pool="${escapeHtml(item.eventId)}" data-event-tracks="social_cards">加入图文池</button></div>
    </article>`;
  }).join("");
}

export function relationEvidenceCount(relation) {
  const evidence = relation?.evidence;
  if (Array.isArray(evidence)) {
    return evidence.reduce((sum, item) => {
      if (Array.isArray(item?.sources)) return sum + item.sources.length;
      if (Array.isArray(item?.source_ids)) return sum + item.source_ids.length;
      if (Array.isArray(item?.sourceIds)) return sum + item.sourceIds.length;
      return sum + (item?.source_id || item?.sourceId ? 1 : 0);
    }, 0);
  }
  if (evidence && typeof evidence === "object") {
    if (Array.isArray(evidence.source_ids)) return evidence.source_ids.length;
    if (Array.isArray(evidence.sourceIds)) return evidence.sourceIds.length;
    if (Array.isArray(evidence.sources)) return evidence.sources.length;
    return evidence.source_id || evidence.sourceId ? 1 : 0;
  }
  if (Array.isArray(relation?.evidence_source_ids)) return relation.evidence_source_ids.length;
  if (Array.isArray(relation?.evidenceSourceIds)) return relation.evidenceSourceIds.length;
  return 0;
}

function renderDiscussionRelations(events) {
  const container = document.getElementById("discussion-relation-list");
  const count = document.getElementById("discussion-relation-count");
  if (!container) return;
  const visibleIds = new Set((events || []).map((event) => String(event.event_id)));
  const relations = (state.atlas?.discussionRelations || []).filter((relation) => (relation.event_ids || []).every((id) => visibleIds.has(String(id))));
  const kindLabels = { sequence: "前后变化", response: "回应关系", comparison: "对比关系", trend: "趋势关系" };
  const counts = relations.reduce((map, item) => { const key = item.relation_kind || "comparison"; map.set(key, (map.get(key) || 0) + 1); return map; }, new Map());
  if (count) count.textContent = `${relations.length} 条可用于选题的研判 · ${[...counts].map(([key, value]) => `${kindLabels[key] || key} ${value}`).join(" · ")}`;
  if (!relations.length) {
    container.innerHTML = '<div class="empty-state">当前筛选下暂无前后、回应、对比或趋势研判。系统不会因为关键词相同强行生成选题。</div>';
    return;
  }
  const eventById = new Map((state.atlas?.events || []).map((event) => [String(event.event_id), event]));
  const labels = { sequence: "前后变化", response: "回应关系", comparison: "对比关系", trend: "趋势关系", same_subject_sequence: "前后变化", shared_object_comparison: "对比关系" };
  const visible = relations.slice(0, 40);
  container.innerHTML = `<div class="discussion-relation-guide">这些不是“关键词关系”，而是已经可以继续发展成选题的研判：事件内看反常、利益冲突和发散；事件间看前后、回应、对比和趋势。${relations.length > visible.length ? `当前先展示 ${visible.length} 条，另有 ${relations.length - visible.length} 条收进原始数据。` : ""}</div>` + visible.map((relation) => {
    const titles = (relation.event_ids || []).map((id) => eventById.get(String(id))?.representative_title || id);
    const evidenceCount = relationEvidenceCount(relation);
    return `<article class="discussion-relation-item"><div class="discussion-relation-score">${escapeHtml(relation.confidence || "待评估")}<br><small>${escapeHtml(relation.relation_kind === "trend" ? `${relation.event_ids.length} 个事件` : relation.days_apart == null ? "时间待核" : `${relation.days_apart} 天间隔`)}</small></div><div><h4><span class="research-relation-label">${escapeHtml(labels[relation.relation_kind] || labels[relation.relation_type] || "研判关系")}</span></h4><p class="discussion-relation-statement">${escapeHtml(relation.relationship_statement || "这组事件存在可继续验证的变化关系。")}</p><p class="discussion-relation-events">涉及事件：${escapeHtml(titles.join(" · "))}</p><small class="discussion-relation-basis">依据：${escapeHtml(relation.temporal_order === "ordered_by_event_time" ? "按事件时间顺序" : relation.temporal_order || "时间字段")} · ${evidenceCount} 个来源引用</small></div><span class="status-pill">可研判</span></article>`;
  }).join("");
}

function eventSourceKey(article) {
  return String(article?.source || article?.channel || article?.url || "未标注来源").trim();
}

function eventDetailHtml(event) {
  const articles = Array.isArray(event.articles) ? event.articles : [];
  const groups = new Map();
  for (const article of articles) {
    const key = eventSourceKey(article);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(article);
  }
  const card = event.card || {};
  const classification = classificationHtml(event.classification || card.classification);
  const facts = Array.isArray(card.confirmed_facts) && card.confirmed_facts.length
    ? `<section class="event-detail-section"><h3>已确认事实</h3><ul>${card.confirmed_facts.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>` : "";
  const increments = Array.isArray(card.source_increment) && card.source_increment.length
    ? `<section class="event-detail-section"><h3>来源增量</h3><ul>${card.source_increment.map((item) => `<li><b>${escapeHtml(item.source)}</b>${escapeHtml(item.adds)}</li>`).join("")}</ul></section>` : "";
  const timeline = Array.isArray(card.timeline) && card.timeline.length
    ? `<section class="event-detail-section"><h3>时间线</h3><ul>${card.timeline.map((item) => `<li><b>${escapeHtml(item.time)}</b>${escapeHtml(item.fact)}</li>`).join("")}</ul></section>` : "";
  const sources = [...groups.entries()].map(([source, items]) => `<section class="event-detail-source"><h4>${escapeHtml(source)}<span>${items.length} 条报道</span></h4>${items.map((article) => {
    const url = externalUrl(article.url);
    const title = escapeHtml(article.title || "未命名报道");
    const meta = [article.time, article.channel].filter(Boolean).map((value) => escapeHtml(value)).join(" · ");
    return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><b>${title}</b><small>${meta || "打开原文"}</small></a>` : `<div class="event-detail-source-static"><b>${title}</b><small>${meta}</small></div>`;
  }).join("")}</section>`).join("");
  return `<div class="event-detail-badges">${classification}<span>${articles.length} 条报道</span><span>${groups.size} 个独立来源</span><span>${escapeHtml(event.market_scope || "待标注")}</span></div><p class="event-detail-conclusion">${escapeHtml(card.conclusion || event.representative_title || event.title || "")}</p>${card.background ? `<p class="event-detail-background">${escapeHtml(card.background)}</p>` : ""}${facts}${increments}${timeline}<section class="event-detail-section"><h3>来源报道</h3>${sources || '<p class="muted">暂无关联报道</p>'}</section>`;
}

function openEventDetail(eventId) {
  const event = state.atlas?.events?.find((item) => item.event_id === eventId);
  if (!event) return toast("没有找到该事件，请先刷新热点全景");
  const dialog = document.getElementById("event-detail-dialog");
  const title = document.getElementById("event-detail-title");
  const content = document.getElementById("event-detail-content");
  if (!dialog || !title || !content) return;
  title.textContent = event.representative_title || event.title || "事件详情";
  content.innerHTML = eventDetailHtml(event);
  dialog.showModal();
}

function renderAtlasMode() {
  const mode = state.atlasMode || "hotlist";
  document.querySelectorAll("[data-atlas-mode-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.atlasModePanel !== mode;
  });
}

function renderAtlas() {
  const atlas = state.atlas;
  if (!atlas) return;
  const events = atlasEvents();
  const stageEmpty=document.getElementById("atlas-stage-empty");
  const noBatchData=Number(atlas.eventCount||0)===0;
  if(stageEmpty)stageEmpty.hidden=!noBatchData;
  [
    document.querySelector("#view-overview .atlas-notice"),
    document.getElementById("atlas-controls"),
    document.querySelector("#view-overview .atlas-mode-tabs"),
    ...document.querySelectorAll("#view-overview [data-atlas-mode-panel]"),
  ].forEach((section)=>{if(section)section.hidden=noBatchData;});
  if(noBatchData)return;
  renderAtlasMode();
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

  renderEventHotlist();
  renderGraph(events);
  renderDiscussionRelations(events);
  renderDimensionCards(events);
  renderAtlasInsightTabs();
}

async function createCompositeFromEvent(batchId, eventId, tracks = ['article']) {
  const event = state.atlas?.events?.find((item) => item.event_id === eventId);
  if (!event) return toast("没有找到该事件，请先刷新热点全景");
  const socialContentClass = socialContentClassOf(event);
  const socialPresentation = socialPoolPresentation(socialContentClass, { eventSocial: true });
  const title = event.representative_title;
  const hotspotIds = event.hotspot_ids || [];
  if (!hotspotIds.length) return toast("该事件簇没有关联的热点");
  let message;
  if (hotspotIds.length === 1) {
    await request(`/api/batches/${encodeURIComponent(batchId)}/candidates`, {
      method: "POST", body: JSON.stringify({ hotspotIds, tracks, socialContentClass: tracks.includes("social_cards") ? socialContentClass : undefined, poolRole: tracks.includes("social_cards") ? socialPresentation.poolRole : undefined }),
    });
    message = tracks.includes("social_cards") ? `已加入${socialPresentation.label}：${event.representative_title}` : `已加入选题池：${event.representative_title}`;
  } else {
    const candidate = await request(`/api/batches/${encodeURIComponent(batchId)}/candidates/composite`, {
      method: "POST", body: JSON.stringify({ hotspotIds, title, poolRole: tracks.includes("social_cards") ? socialPresentation.poolRole : "综合选题", tracks, socialContentClass: tracks.includes("social_cards") ? socialContentClass : undefined }),
    });
    message = tracks.includes("social_cards") ? `已从事件簇创建${socialPresentation.label}：${candidate.candidate_id}` : `已从事件簇创建综合选题：${candidate.candidate_id}`;
  }
  offerPoolExit(tracks, message, { eventSocial: tracks.includes("social_cards"), socialContentClass });
  const { default: loadTopicPool } = await import("./topics.js");
  loadTopicPool();
  if (document.querySelector(".nav-item.active")?.dataset.view === "overview") await loadAtlas();
}

async function createCompositeFromHotlist(batchId, eventId, tracks = ['article']) {
  const item = state.atlas?.eventHotlist?.find((entry) => entry.eventId === eventId);
  if (!item) return toast("没有找到该热榜事件，请先刷新热点全景");
  const socialContentClass = socialContentClassOf(item);
  const socialPresentation = socialPoolPresentation(socialContentClass, { eventSocial: true });
  const hotspotIds = item.hotspotIds || [];
  if (!hotspotIds.length) return toast("该事件没有可进入研判的当前报道");
  const title = item.title;
  let message;
  if (hotspotIds.length === 1) {
    await request(`/api/batches/${encodeURIComponent(batchId)}/candidates`, { method: "POST", body: JSON.stringify({ hotspotIds, tracks, socialContentClass: tracks.includes("social_cards") ? socialContentClass : undefined, poolRole: tracks.includes("social_cards") ? socialPresentation.poolRole : undefined }) });
    message = tracks.includes("social_cards") ? `已加入${socialPresentation.label}：${item.title}` : `已加入选题池：${item.title}`;
  } else {
    const candidate = await request(`/api/batches/${encodeURIComponent(batchId)}/candidates/composite`, {
      method: "POST", body: JSON.stringify({ hotspotIds, title, poolRole: tracks.includes("social_cards") ? socialPresentation.poolRole : "事件热榜研判", tracks, socialContentClass: tracks.includes("social_cards") ? socialContentClass : undefined }),
    });
    message = tracks.includes("social_cards") ? `已从事件热榜创建${socialPresentation.label}：${candidate.candidate_id}` : `已从事件热榜创建综合选题：${candidate.candidate_id}`;
  }
  offerPoolExit(tracks, message, { eventSocial: tracks.includes("social_cards"), socialContentClass });
  const { default: loadTopicPool } = await import("./topics.js");
  loadTopicPool();
}

// 创建成功后给出可跳转的出口，避免"成功了但不知道去哪看"的死路
async function offerPoolExit(tracks, message, { eventSocial = false, socialContentClass = "" } = {}) {
  const presentation = socialPoolPresentation(socialContentClass, { eventSocial });
  const target = tracks.includes("social_cards") ? presentation.target : "topics";
  const label = tracks.includes("social_cards") ? presentation.label : "文章选题池";
  if (await confirmAction(`${message}\n\n是否前往${label}查看？`, { confirmText: `前往${label}` })) window.go(target);
}

async function createCompositeFromDimension(batchId, nodeId, tracks = ['article']) {
  const graph = state.atlas?.graph;
  const node = graph?.nodes.find((item) => item.id === nodeId);
  if (!node || node.type === "event") return toast("没有找到该维度分组，请先刷新热点全景");
  const eventIds = graph.edges.filter((edge) => edge.to === nodeId).map((edge) => edge.from.replace(/^event:/, ""));
  const hotspotIds = [...new Set(eventIds.flatMap((eventId) => (state.atlas.events || []).find((event) => event.event_id === eventId)?.hotspot_ids || []))];
  if (hotspotIds.length < 2) return toast("该维度分组关联的热点不足以创建综合选题");
  const contentClasses = [...new Set(eventIds.map((eventId) => socialContentClassOf((state.atlas.events || []).find((event) => event.event_id === eventId), "")))];
  const socialContentClass = contentClasses.length === 1 ? contentClasses[0] : "";
  const candidate = await request(`/api/batches/${encodeURIComponent(batchId)}/candidates/composite`, {
    method: "POST", body: JSON.stringify({ hotspotIds, title: node.label, poolRole: DIMENSION_ROLES[node.type] || "维度选题", tracks, socialContentClass: tracks.includes("social_cards") && socialContentClass ? socialContentClass : undefined }),
  });
  offerPoolExit(tracks, `已创建${LENS_LABELS[node.type]}维度选题：${candidate.candidate_id}（${hotspotIds.length} 条报道）`, { socialContentClass });
  const { default: loadTopicPool } = await import("./topics.js");
  loadTopicPool();
}


export default async function loadAtlasView() {
  bindAtlas();
  return loadAtlas();
}
