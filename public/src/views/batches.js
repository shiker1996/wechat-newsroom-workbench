import { state } from "../core/state.js";
import { $ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml } from "../core/ui.js";
import { stages } from "./dashboard.js";

let lifecycleFilter="all";

function renderBatchRow(batch) {
  const [stage] = stages[batch.stage] ?? [batch.stage];
  const lifecycle=batch.lifecycle_status||"active";
  const statusLabel = { active:"进行中", completed:"已完成", archived:"已归档" }[lifecycle];
  return `<article class="ledger-row" data-batch="${escapeHtml(batch.id)}">
    <div class="ledger-date">${escapeHtml(batch.batch_date.slice(5).replace("-", " / "))}</div>
    <div class="ledger-title"><b>${escapeHtml(batch.title)}</b><small>${escapeHtml(batch.note || "暂无值班备注")}</small></div>
    <span class="stage-badge batch-status-${escapeHtml(lifecycle)}">${escapeHtml(statusLabel)} · ${escapeHtml(stage)}</span>
    <div class="ledger-count">${batch.hotspot_count}<small>热点</small></div>
    <div class="ledger-count">${batch.artifact_count}<small>产物</small></div>
  </article>`;
}

function renderBatchList() {
  const query=$("#batch-search")?.value.trim().toLocaleLowerCase("zh-CN")||"";
  const filtered=state.batches.filter((batch)=>{
    const lifecycle=batch.lifecycle_status||"active";
    const matchesStatus=lifecycleFilter==="all"||lifecycle===lifecycleFilter;
    const haystack=`${batch.title||""} ${batch.note||""} ${batch.batch_date||""}`.toLocaleLowerCase("zh-CN");
    return matchesStatus&&(!query||haystack.includes(query));
  });
  const groups=[
    ["completed","已完成待归档"],
    ["active","进行中"],
    ["archived","已归档"],
  ];
  const visibleGroups=lifecycleFilter==="all"?groups:groups.filter(([key])=>key===lifecycleFilter);
  $("#batch-list").innerHTML=filtered.length?visibleGroups.map(([key,label])=>{
    const items=filtered.filter((batch)=>(batch.lifecycle_status||"active")===key);
    if(!items.length)return "";
    return `<section class="batch-ledger-group" data-batch-group="${key}">
      <header class="batch-group-heading"><b>${label}</b><small>${items.length} 个批次</small></header>
      ${items.map(renderBatchRow).join("")}
    </section>`;
  }).join(""):'<div class="empty-state">没有符合条件的批次。</div>';
  const count=$("#batch-result-count");
  if(count)count.textContent=`${filtered.length} / ${state.batches.length} 个批次`;
}

function bindBatchFilters() {
  const search=$("#batch-search");
  if(search&&!search.dataset.bound){
    search.dataset.bound="true";
    search.addEventListener("input",renderBatchList);
  }
  const tabs=$("#batch-lifecycle-filter");
  if(tabs&&!tabs.dataset.bound){
    tabs.dataset.bound="true";
    tabs.addEventListener("click",(event)=>{
      const button=event.target.closest("[data-batch-filter]");
      if(!button)return;
      lifecycleFilter=button.dataset.batchFilter;
      tabs.querySelectorAll("[data-batch-filter]").forEach((item)=>item.classList.toggle("active",item===button));
      renderBatchList();
    });
  }
}

export default async function loadBatches() {
  state.batches = await request("/api/batches?limit=100");
  bindBatchFilters();
  renderBatchList();
}
