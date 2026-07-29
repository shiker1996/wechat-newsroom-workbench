import { request } from "./http.js";
import { escapeHtml } from "./ui.js";

function sourceLabel(item) {
  if (item.isDefault) return "工作区默认";
  if (item.isRecommended) return "系统推荐";
  return item.thirdParty ? "已安装" : "内置";
}

export async function loadSkillSelect(select, url) {
  if (!select) return null;
  select.disabled = true;
  select.innerHTML = '<option value="">正在读取可用技能…</option>';
  const result = await request(url);
  const available = result.items.filter((item) => item.available);
  const unavailable = result.items.filter((item) => !item.available);
  select.innerHTML = [
    '<option value="">系统自动选择（推荐）</option>',
    ...available.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${sourceLabel(item)}</option>`),
    ...unavailable.map((item) => `<option value="${escapeHtml(item.id)}" disabled>${escapeHtml(item.name)} · ${escapeHtml(item.unavailableReason)}</option>`),
  ].join("");
  select.disabled = false;
  const note = select.closest(".writer-skill-picker")?.querySelector("[data-skill-note]");
  if (note) note.textContent = available.length
    ? `系统会从 ${available.length} 个兼容技能中按内容类型选择。`
    : "当前没有可用技能，请前往技能与插件检查状态和必需工具。";
  return result;
}

export async function loadStageSkillControls(container, url) {
  if (!container) return null;
  container.setAttribute("aria-busy","true");
  const result=await request(url);
  container.innerHTML=result.slots.map((slot)=>`
    <label class="stage-skill-row">
      <span><b>${escapeHtml(slot.name)}</b><small>${escapeHtml(slot.kind)} · ${escapeHtml(slot.inputContract)} → ${escapeHtml(slot.outputContract)}</small></span>
      <select data-stage-skill="${escapeHtml(slot.id)}" aria-label="${escapeHtml(slot.name)}技能">
        <option value="">使用默认技能</option>
        ${slot.items.filter((item)=>item.available&&!item.isDefault).map((item)=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${item.thirdParty?"已安装":"内置"}</option>`).join("")}
        ${slot.items.filter((item)=>!item.available).map((item)=>`<option value="${escapeHtml(item.id)}" disabled>${escapeHtml(item.name)} · ${escapeHtml(item.unavailableReason)}</option>`).join("")}
      </select>
    </label>`).join("");
  container.setAttribute("aria-busy","false");
  container.dispatchEvent(new CustomEvent("stage-skills-loaded",{bubbles:true}));
  return result;
}

export function selectedStageSkills(container) {
  return Object.fromEntries([...container?.querySelectorAll("[data-stage-skill]")||[]]
    .map((select)=>[select.dataset.stageSkill,select.value]));
}
