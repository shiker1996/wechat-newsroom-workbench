import { state } from "../core/state.js";
import { $ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, formatDate } from "../core/ui.js";

export const stages = {
  collect: ["采集", 12], synthesis: ["研判", 32], editorial: ["编辑会", 48],
  drafting: ["成稿", 68], review: ["审稿", 82], typeset: ["排版", 92], preview: ["预览完成", 100],
};

export function activeBatch() {
  return state.batches.find((batch) => batch.id === state.activeBatchId) ?? null;
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function renderBatchSwitcher() {
  const switcher = $("#batch-switcher");
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  // batch_date 是本地日期，比较必须用本地日期串，不能用 toISOString()（UTC 截断会让负时区用户少看一天）
  const recent = state.batches.filter((b) => b.batch_date >= localDate(weekAgo) && (b.lifecycle_status||"active")==="active");
  switcher.innerHTML = recent.length
    ? recent.map((batch) => `<option value="${escapeHtml(batch.id)}" ${batch.id === state.activeBatchId ? "selected" : ""}>${escapeHtml(batch.batch_date)} · ${escapeHtml(batch.title)}</option>`).join("")
    : state.batches.length ? '<option value="">选择批次</option>' : '<option value="">暂无批次</option>';
}

function renderLatest(batch) {
  const node = $("#latest-batch");
  if (!batch) { node.className = "empty-state"; node.textContent = "还没有批次，先建立今天的编辑任务。"; return; }
  const [stageName, progress] = stages[batch.stage] ?? [batch.stage, 5];
  node.className = "";
  node.innerHTML = `<article class="latest-row" data-batch="${escapeHtml(batch.id)}">
    <div class="date-block">${formatDate(batch.batch_date)}<small>${escapeHtml(batch.batch_date)}</small></div>
    <div><h4>${escapeHtml(batch.title)}</h4><p>${stageName} · ${batch.hotspot_count} 条热点 · ${batch.artifact_count} 份产物</p><div class="progress-line"><i style="width:${progress}%"></i></div></div>
    <button class="outline-button">打开批次</button>
  </article>`;
}

function renderSources(sources) {
  const defaults = ["reddit", "rsshub", "github"];
  const byName = new Map(sources.map((item) => [item.source, item]));
  $("#source-health").innerHTML = defaults.map((source) => {
    const item = byName.get(source) ?? { status: "unknown", item_count: 0 };
    const note = item.status === "unknown" ? "尚未执行" : item.error || `${formatDate(item.ended_at, { hour: "2-digit", minute: "2-digit" })} 更新`;
    const labels = { reddit: "Reddit", rsshub: "RSSHub", github: "GitHub" };
    return `<div class="source-row ${item.status}"><i></i><div><strong>${labels[source]}</strong><small>${escapeHtml(note)}</small></div><b>${item.item_count ?? 0}</b></div>`;
  }).join("");
}

function renderAttention(overview) {
  const current = overview.current || {};
  const latest = overview.latest;
  const [stageName] = latest ? (stages[latest.stage] ?? [latest.stage]) : ["未开始"];
  const signals = [
    {
      label: "采集状态", value: current.sourceTotal ? `${current.sourceOk} / ${current.sourceTotal}` : "未采集",
      note: current.sourceTotal && current.sourceOk >= current.sourceTotal ? "采集源运行正常" : "有来源未完成或尚未运行",
      tone: current.sourceTotal && current.sourceOk >= current.sourceTotal ? "ok" : "warn", go: "sources",
    },
    { label: "当前流程", value: stageName, note: latest ? latest.title : "建立今日批次后开始", tone: latest ? "active" : "warn", batch: latest?.id },
    {
      label: "待确认选题", value: current.pendingArticleCandidates ?? 0, note: "文章候选等待编辑判断",
      tone: current.pendingArticleCandidates ? "active" : "ok", go: "topics",
    },
    {
      label: "成稿门禁", value: current.blockedBriefs ?? 0, note: current.blockedBriefs ? "编辑简报尚未通过" : "暂无未通过简报",
      tone: current.blockedBriefs ? "warn" : "ok", go: "editorial",
    },
    {
      label: "失败任务", value: current.failedRuns ?? 0, note: current.failedRuns ? "需要查看错误并重试" : "当前批次运行正常",
      tone: current.failedRuns ? "bad" : "ok", go: "logs",
    },
  ];
  $("#dashboard-attention").innerHTML = signals.map((item) => `<button class="attention-card ${item.tone}" ${item.batch ? `data-batch="${escapeHtml(item.batch)}"` : `data-go="${item.go}"`}>
    <span>${item.label}</span><strong>${escapeHtml(String(item.value))}</strong><small>${escapeHtml(item.note)}</small>
  </button>`).join("");
}

function formatDuration(milliseconds) {
  const seconds=Math.max(0,Math.round(Number(milliseconds||0)/1000));
  if(!seconds)return "—";
  if(seconds<60)return `${seconds} 秒`;
  const minutes=Math.round(seconds/60);
  return minutes<60?`${minutes} 分钟`:`${Math.floor(minutes/60)} 小时 ${minutes%60} 分`;
}

function renderEfficiency(overview) {
  const data=overview.efficiency||{};
  const baseline=overview.efficiencyBaseline||{};
  const baselineNote=(value,formatter=(item)=>String(item))=>baseline.sampleSize&&value!=null
    ? `近 ${baseline.sampleSize} 批均值 ${formatter(value)}`
    : "暂无历史批次基线";
  const cards=[
    {label:"采集到研判耗时",value:data.collectToResearchDurationMs==null?"—":formatDuration(data.collectToResearchDurationMs),note:baselineNote(baseline.collectToResearchDurationMs,formatDuration),go:"sources"},
    {label:"AI 任务成功率",value:data.aiSuccessRate==null?"—":`${data.aiSuccessRate}%`,note:baselineNote(baseline.aiSuccessRate,(value)=>`${value}%`),go:"logs"},
    {label:"选题推进率",value:data.candidateConversionRate==null?"—":`${data.candidateConversionRate}%`,note:baselineNote(baseline.candidateConversionRate,(value)=>`${value}%`),go:"topics"},
    {label:"产物输出",value:String(data.artifactCount??0),note:baselineNote(baseline.artifactCount),go:"artifacts"},
  ];
  $("#dashboard-efficiency").innerHTML=cards.map((item)=>`<button type="button" class="efficiency-card" data-go="${item.go}"><span>${item.label}</span><strong>${escapeHtml(item.value)}</strong><small>${item.note}</small></button>`).join("");
  $("#efficiency-insight").innerHTML=`<b>当前瓶颈</b><span>${escapeHtml(data.bottleneck||"暂无反馈")}</span>`;
}

export default async function loadOverview() {
  const [overview, batches] = await Promise.all([request("/api/overview"), request("/api/batches?limit=20")]);
  state.overview = overview;
  state.batches = batches;
  if (!state.activeBatchId && batches.length) state.activeBatchId = batches[0].id;
  renderBatchSwitcher();
  $("#edition-number").textContent = String(overview.hotspots).padStart(3, "0");
  const current = overview.current || {};
  const dashboardBrief = $("#dashboard-brief");
  if (dashboardBrief) dashboardBrief.textContent = overview.latest
    ? `${overview.latest.title}正在${(stages[overview.latest.stage] ?? [overview.latest.stage])[0]}阶段；${current.failedRuns ? `有 ${current.failedRuns} 个失败任务需要处理。` : "当前没有失败任务。"}`
    : "今天还没有编辑批次，建立后即可开始采集与研判。";
  const primary = $("#dashboard-primary-action");
  if (primary) {
    primary.textContent = overview.latest ? "查看当前批次 →" : "建立今日批次 →";
    primary.dataset.dashboardAction = overview.latest ? "batch" : "new";
  }
  $("#metrics").innerHTML = [
    ["今日文章", overview.articleInProgress, "生产中的文章"],
    ["今日图文", overview.socialInProgress, "生产中的图文"],
    ["累计热点", overview.hotspots, "已归档"],
    ["累计产物", overview.artifacts, "可追溯"],
  ].map(([label, value, note]) => `<article class="metric"><small>${label}</small><strong>${value}</strong><span>${note}</span></article>`).join("");
  renderAttention(overview);
  renderEfficiency(overview);
  renderLatest(overview.latest);
  renderSources(overview.sourceHealth);
}
