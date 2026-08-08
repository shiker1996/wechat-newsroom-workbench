import { request } from "../core/http.js";
import { escapeHtml, toast, confirmAction } from "../core/ui.js";

let bound = false;
let skillRegistryData = null;
let selectedSkillId = "";
let credentialPluginId = "";

function bindSkills() {
  if (bound) return;
  bound = true;
  document.getElementById("skill-registry-list")?.addEventListener("click", (event) => {
    const item = event.target.closest("[data-skill-edit]");
    if (item) openSkillConfig(item.dataset.skillEdit).catch((error) => toast(error.message));
  });
  document.getElementById("tool-capability-list")?.addEventListener("click", (event) => {
    const testButton = event.target.closest("[data-tool-test]");
    const historyButton = event.target.closest("[data-tool-history]");
    const versionsButton = event.target.closest("[data-tool-versions]");
    const uninstallButton = event.target.closest("[data-tool-uninstall]");
    const credentialButton = event.target.closest("[data-tool-credential]");
    const firstRunButton = event.target.closest("[data-tool-first-run]");
    if (testButton) testToolPlugin(testButton.dataset.toolTest, testButton).catch((error) => toast(error.message));
    if (historyButton) loadToolHistory(historyButton.dataset.toolHistory).catch((error) => toast(error.message));
    if (versionsButton) manageToolPluginVersions(versionsButton.dataset.toolVersions).catch((error) => toast(error.message));
    if (uninstallButton) uninstallManagedToolPlugin(uninstallButton.dataset.toolUninstall).catch((error) => toast(error.message));
    if (credentialButton) openRemoteCredential(credentialButton.dataset.toolCredential);
    if (firstRunButton) confirmRemoteFirstRun(firstRunButton.dataset.toolFirstRun).catch((error) => toast(error.message));
  });
  document.getElementById("tool-capability-list")?.addEventListener("change", (event) => {
    const toggle = event.target.closest("[data-tool-enabled]");
    const priority = event.target.closest("[data-tool-priority]");
    if (toggle) updateToolPlugin(toggle.dataset.toolEnabled, { enabled: toggle.checked }, toggle)
      .catch((error) => { toggle.checked = !toggle.checked; toast(error.message); });
    if (priority) updateToolPlugin(priority.dataset.toolPriority, { priority: Number(priority.value) }, priority)
      .catch((error) => toast(error.message));
  });
  document.getElementById("information-slot-list")?.addEventListener("change", (event) => {
    const select = event.target.closest("[data-information-slot]");
    if (select) updateInformationSlot(select.dataset.informationSlot, select.value, select).catch((error) => toast(error.message));
  });
  document.getElementById("information-slot-list")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-connect-information-tool]")) selectCapabilityTab("extensions");
  });
  document.getElementById("tool-execution-close")?.addEventListener("click", () => {
    document.getElementById("tool-execution-panel").hidden = true;
  });
  document.getElementById("skill-search")?.addEventListener("input", () => renderSkillList());
  document.getElementById("skill-status-filter")?.addEventListener("change", () => renderSkillList());
  const skillStatusFilter = document.getElementById("skill-status-filter");
  if (skillStatusFilter && !skillStatusFilter.querySelector('[value="installed"]')) {
    skillStatusFilter.insertAdjacentHTML("beforeend", '<option value="installed">第三方</option>');
  }
  document.getElementById("validate-skill-package")?.addEventListener("click", () => submitSkillDirectory(false).catch((error) => toast(error.message)));
  document.getElementById("install-skill-package")?.addEventListener("click", () => submitSkillDirectory(true).catch((error) => toast(error.message)));
  document.getElementById("skill-package-zip")?.addEventListener("change", (event) => submitSkillZip(event.target.files?.[0], event.target).catch((error) => toast(error.message)));
  document.getElementById("skill-package-actions")?.addEventListener("click", (event) => {
    const defaultButton = event.target.closest("[data-skill-default-entry]");
    if (defaultButton) {
      setSkillDefault(defaultButton).catch((error) => toast(error.message));
      return;
    }
    const button = event.target.closest("[data-skill-package-action]");
    if (button) manageSkillPackage(button).catch((error) => toast(error.message));
  });
  document.getElementById("validate-tool-package")?.addEventListener("click", () => submitToolPackage(false).catch((error) => toast(error.message)));
  document.getElementById("install-tool-package")?.addEventListener("click", () => submitToolPackage(true).catch((error) => toast(error.message)));
  document.getElementById("validate-remote-plugin")?.addEventListener("click", () => submitRemotePlugin(false).catch((error) => toast(error.message)));
  document.getElementById("install-remote-plugin")?.addEventListener("click", () => submitRemotePlugin(true).catch((error) => toast(error.message)));
  document.getElementById("save-remote-credential")?.addEventListener("click", () => saveRemoteCredential().catch((error) => toast(error.message)));
  document.getElementById("cancel-remote-credential")?.addEventListener("click", () => closeRemoteCredential());
  document.querySelector(".capability-section-tabs")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-capability-tab]");
    if (button) selectCapabilityTab(button.dataset.capabilityTab);
  });
}

async function loadSkillRegistry() {
  const [data, slotData] = await Promise.all([
    request("/api/system/skills"),
    request("/api/system/information-capability-slots"),
  ]);
  skillRegistryData = data;
  const summary = document.getElementById("skill-registry-summary");
  const availableTools = data.tools.filter((tool) => tool.health?.status === "ok" && tool.health.data?.available !== false).length;
  const configuredSkills = data.skills.filter((skill) => skill.configured).length;
  const thirdPartySkills = data.skills.filter((skill) => skill.thirdParty).length;
  const connectedSlots = (slotData.items || []).filter((slot) => slot.available).length;
  if (summary) {
    summary.innerHTML = `<span><b>${data.total}</b><small>创作技能</small><em>${thirdPartySkills ? `${thirdPartySkills} 个已安装` : "全部为内置"}</em></span><span><b>${connectedSlots}/${slotData.items.length}</b><small>信息能力就绪</small><em>${connectedSlots === slotData.items.length ? "写作资料能力完整" : `${slotData.items.length - connectedSlots} 项可继续连接`}</em></span><span><b>${configuredSkills}</b><small>自定义配置</small><em>任务启动后冻结</em></span>`;
  }
  const toolSummary = document.getElementById("tool-capability-summary");
  if (toolSummary) toolSummary.textContent = availableTools === data.tools.length ? `${data.tools.length} 个工具运行正常` : `${data.tools.length - availableTools} 个工具需要处理`;
  const disclosure = document.querySelector(".tool-capability-disclosure");
  if (disclosure && availableTools < data.tools.length) disclosure.open = true;
  const toolList = document.getElementById("tool-capability-list");
  if (toolList) {
    toolList.innerHTML = data.tools.length ? data.tools.map((tool) => {
      const checked = Boolean(tool.health);
      const healthy = checked && tool.health.status === "ok" && tool.health.data?.available !== false;
      const status = !tool.enabled ? "已停用" : checked ? (healthy ? "可用" : "不可用") : "待检查";
      const detail = !tool.enabled ? "不会参与新任务的能力解析" : checked ? (healthy ? "依赖正常" : (tool.health.error?.message || "依赖不可用")) : "服务尚未返回健康检查结果，请重启工作台服务后刷新";
      const recent = tool.recentExecution;
      const audit = recent ? `最近执行：${recent.status} · ${new Date(recent.finished_at || recent.started_at).toLocaleString("zh-CN")}${recent.error_code ? ` · ${recent.error_code}` : ""}` : "尚无执行记录";
      const permissionSummary = tool.thirdParty ? `来源：${tool.source?.type || "未声明"} ${tool.source?.url || ""} · 兼容 ${tool.compatibleApp || "未声明"} · 完整性 ${tool.contentHash || "未记录"} · 网络域名 ${(tool.permissions?.networkDomains || []).join("、") || "无"} · 路径 ${(tool.permissions?.pathAccess || []).join("、") || "无"} · 外部写入 ${tool.permissions?.externalWrite ? "是" : "否"}${tool.remote ? ` · 端点 ${tool.endpointHost || "未声明"} · 首次执行 ${tool.firstRunConfirmedAt ? "已确认" : "待确认"}` : ""}` : "内置受信实现";
      return `<article class="runtime-model-item tool-plugin-item ${tool.enabled ? "" : "disabled"}">
        <div class="tool-plugin-title"><div><b>${escapeHtml(tool.capability)}</b><small>${escapeHtml(tool.plugin)} @ ${escapeHtml(tool.version)} · ${escapeHtml(tool.riskLevel)}</small></div><em class="${tool.enabled ? (checked ? (healthy ? "ok" : "bad") : "unknown") : "unknown"}">${status}</em></div>
        <small>${escapeHtml(detail)}</small><small>${escapeHtml(audit)}</small>
        <small>${escapeHtml(permissionSummary)}${tool.restartRequired ? " · 需要重启" : ""}</small>
        <div class="tool-plugin-controls">
          <label class="tool-plugin-toggle"><input type="checkbox" data-tool-enabled="${escapeHtml(tool.plugin)}" ${tool.enabled ? "checked" : ""}><span>启用工具</span></label>
          ${tool.thirdParty ? "" : `<label>优先级 <input type="number" min="-100" max="100" value="${Number(tool.priority) || 0}" data-tool-priority="${escapeHtml(tool.plugin)}"></label>`}
          <button type="button" class="ghost-button" data-tool-test="${escapeHtml(tool.plugin)}">检查依赖</button>
          <button type="button" class="text-button" data-tool-history="${escapeHtml(tool.capability)}">执行历史</button>
          ${tool.remote ? `${!tool.firstRunConfirmedAt ? `<button type="button" class="ghost-button" data-tool-first-run="${escapeHtml(tool.plugin)}">确认首次执行</button>` : ""}<button type="button" class="text-button" data-tool-credential="${escapeHtml(tool.plugin)}">配置凭据</button><button type="button" class="text-button" data-tool-uninstall="${escapeHtml(tool.plugin)}">删除连接</button>` : tool.thirdParty ? `<button type="button" class="text-button" data-tool-versions="${escapeHtml(tool.plugin)}">版本与回滚</button><button type="button" class="text-button" data-tool-uninstall="${escapeHtml(tool.plugin)}">卸载</button>` : ""}
        </div>
      </article>`;
    }).join("") : '<div class="kv-empty">没有已注册的工具能力。</div>';
  }
  renderInformationSlots(slotData.items || []);
  renderSkillList();
}

function renderInformationSlots(items) {
  const node = document.getElementById("information-slot-list");
  if (!node) return;
  const connected = items.filter((slot) => slot.available).length;
  const summary = document.getElementById("information-slot-summary");
  if (summary) summary.innerHTML = `<b>${connected}/${items.length}</b><span>已就绪</span>`;
  const ordered = [...items].sort((a, b) => Number(b.available) - Number(a.available));
  node.innerHTML = ordered.map((slot) => {
    const enabled = slot.implementations.filter((item) => item.enabled);
    return `<article class="information-slot-card ${slot.available ? "available" : "missing"}">
      <div><span>${escapeHtml(slot.stage)}</span><b>${escapeHtml(slot.name)}</b><small>${escapeHtml(slot.description)}</small></div>
      <em>${escapeHtml(slot.available ? "已就绪" : "待连接")}</em>
      ${slot.available ? `<label>使用的服务<select data-information-slot="${escapeHtml(slot.id)}">
        <option value="">系统自动选择</option>
        ${enabled.map((item) => `<option value="${escapeHtml(item.plugin)}" ${slot.preferredPlugin === item.plugin ? "selected" : ""}>${escapeHtml(item.plugin)} @ ${escapeHtml(item.version)}</option>`).join("")}
      </select></label>` : '<button type="button" class="outline-button information-slot-connect" data-connect-information-tool>连接可用工具</button>'}
      <details class="information-slot-technical"><summary>技术标识</summary><code>${escapeHtml(slot.capability)}</code></details>
    </article>`;
  }).join("");
}

async function updateInformationSlot(slotId, pluginId, control) {
  control.disabled = true;
  try {
    const result = await request(`/api/system/information-capability-slots/${encodeURIComponent(slotId)}`, {
      method: "PUT", body: JSON.stringify({ pluginId }),
    });
    toast(result.available ? `${result.name} 已使用 ${result.selectedPlugin}` : `${result.name} 当前没有可用实现`);
    await loadSkillRegistry();
  } finally {
    control.disabled = false;
  }
}

function selectCapabilityTab(tab) {
  const selected = ["skills", "tools", "extensions"].includes(tab) ? tab : "skills";
  document.querySelectorAll("[data-capability-tab]").forEach((button) => {
    const active = button.dataset.capabilityTab === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-capability-section]").forEach((section) => {
    section.hidden = section.dataset.capabilitySection !== selected;
  });
  try { sessionStorage.setItem("capability-section", selected); } catch {}
}

async function submitSkillDirectory(install) {
  const directory = document.getElementById("skill-package-directory").value.trim();
  if (!directory) throw new Error("请输入技能包目录");
  if (install && !await confirmAction("仅管理员可以安装技能包。确认该技能包已完成代码审查？", { confirmText: "受信安装" })) return;
  const result = await request(`/api/system/skill-packages/${install ? "install" : "validate"}`, {
    method: "POST", headers: install ? { "x-admin-confirm": "TRUSTED-LOCAL-PLUGIN" } : {},
    body: JSON.stringify({ directory }),
  });
  toast(install ? `已安装 ${result.name || result.id}` : `校验通过：${result.manifest?.name || result.manifest?.id}`);
  if (install) await loadSkillRegistry();
}

async function submitToolPackage(install) {
  const directory = document.getElementById("tool-package-directory").value.trim();
  if (!directory) throw new Error("请输入工具包目录");
  if (install && !await confirmAction("仅管理员可以安装本地 adapter。确认该工具已完成代码审查，并接受页面展示的权限范围？", { confirmText: "受信安装" })) return;
  const result = await request(`/api/system/tool-plugin-packages/${install ? "install" : "validate"}`, {
    method: "POST", headers: install ? { "x-admin-confirm": "TRUSTED-LOCAL-PLUGIN" } : {},
    body: JSON.stringify({ directory }),
  });
  const manifest = result.manifest || result;
  const permissions = manifest.permissions || {};
  toast(install ? `已安装 ${manifest.name || manifest.id}，重启后可加载`
    : `校验通过：${manifest.name}；网络域名 ${(permissions.networkDomains || []).length}，路径权限 ${(permissions.pathAccess || []).length}，外部写入 ${permissions.externalWrite ? "是" : "否"}`);
  if (install) await loadSkillRegistry();
}

function remoteManifestInput() {
  const text = document.getElementById("remote-plugin-manifest").value.trim();
  if (!text) throw new Error("请输入远程工具连接声明");
  try { return JSON.parse(text); } catch { throw new Error("远程工具连接声明不是有效 JSON"); }
}

async function submitRemotePlugin(install) {
  const manifest = remoteManifestInput();
  const result = await request(`/api/system/remote-tool-plugins${install ? "" : "/validate"}`, { method: "POST", body: JSON.stringify({ manifest }) });
  toast(install ? `已保存 ${result.name || result.id}，请配置凭据并启用` : `校验通过：${result.name} · ${new URL(result.endpoint).hostname}`);
  if (install) await loadSkillRegistry();
}

function openRemoteCredential(pluginId) {
  credentialPluginId = pluginId;
  document.getElementById("remote-credential-panel").hidden = false;
  const input = document.getElementById("remote-credential-token");
  input.value = "";
  input.focus();
}

function closeRemoteCredential() {
  credentialPluginId = "";
  document.getElementById("remote-credential-token").value = "";
  document.getElementById("remote-credential-panel").hidden = true;
}

async function saveRemoteCredential() {
  const token = document.getElementById("remote-credential-token").value;
  if (!credentialPluginId || !token.trim()) throw new Error("请输入凭据");
  await request(`/api/system/remote-tool-plugins/${encodeURIComponent(credentialPluginId)}/credentials`, { method: "PUT", body: JSON.stringify({ token }) });
  closeRemoteCredential();
  toast("凭据已安全保存，页面不会回读原文");
  await loadSkillRegistry();
}

async function submitSkillZip(file, input) {
  if (!file) return;
  if (!await confirmAction("仅管理员可以安装技能包。确认该技能包已完成代码审查？", { confirmText: "受信安装" })) { input.value = ""; return; }
  // 二进制 zip 直接作为 body 上传，request() 支持自定义 content-type，无需绕开
  const result = await request("/api/system/skill-packages/install", { method: "POST", headers: { "content-type": "application/zip", "x-admin-confirm": "TRUSTED-LOCAL-PLUGIN" }, body: file });
  toast(`已安装 ${result.name || result.id}`);
  input.value = "";
  await loadSkillRegistry();
}

async function manageSkillPackage(button) {
  const id = button.dataset.skillId;
  const action = button.dataset.skillPackageAction;
  if (action === "uninstall") {
    if (!await confirmAction(`卸载 ${id}？历史版本和审计记录会保留。`, { confirmText: "卸载" })) return;
    await request(`/api/system/skills/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-admin-confirm": "TRUSTED-LOCAL-PLUGIN" } });
  } else {
    await request(`/api/system/skills/${encodeURIComponent(id)}/status`, { method: "PATCH", headers: { "x-admin-confirm": "TRUSTED-LOCAL-PLUGIN" }, body: JSON.stringify({ status: action }) });
  }
  toast(action === "enabled" ? "技能已启用" : action === "disabled" ? "技能已停用" : "技能已卸载");
  selectedSkillId = "";
  await loadSkillRegistry();
}

async function setSkillDefault(button) {
  const id = button.dataset.skillId;
  const entryPoint = button.dataset.skillDefaultEntry;
  const slot = button.dataset.skillDefaultSlot;
  const isDefault = button.dataset.skillDefaultActive === "true";
  const endpoint = slot === "writer"
    ? `/api/system/skill-entry-defaults/${encodeURIComponent(entryPoint)}`
    : `/api/system/skill-stage-defaults/${encodeURIComponent(entryPoint)}/${encodeURIComponent(slot)}`;
  button.disabled = true;
  try {
    await request(endpoint, { method: "PUT", body: JSON.stringify({ skillId: isDefault ? "" : id }) });
    toast(isDefault ? "已恢复系统默认技能" : "已设为该入口的默认技能");
    await loadSkillRegistry();
    await openSkillConfig(id);
  } finally {
    button.disabled = false;
  }
}

async function manageToolPluginVersions(pluginId) {
  const result = await request(`/api/system/tool-plugins/${encodeURIComponent(pluginId)}/versions`);
  if (!result.items.length) {
    toast("暂无可回滚的历史版本");
    return;
  }
  const version = result.items[0];
  if (!await confirmAction(`将 ${pluginId} 回滚到 ${version}？回滚后保持停用，并需重启加载。`, { confirmText: "回滚" })) return;
  await request(`/api/system/tool-plugins/${encodeURIComponent(pluginId)}/rollback`, { method: "POST", headers: { "x-admin-confirm": "TRUSTED-LOCAL-PLUGIN" }, body: JSON.stringify({ version }) });
  toast(`已回滚到 ${version}，请重启工作台`);
  await loadSkillRegistry();
}

async function uninstallManagedToolPlugin(pluginId) {
  const remote = skillRegistryData?.tools.some((tool) => tool.plugin === pluginId && tool.remote);
  if (!await confirmAction(`卸载 ${pluginId}？依赖其能力的技能将无法启动，历史归档和审计记录会保留。`, { confirmText: "确认卸载" })) return;
  await request(remote ? `/api/system/remote-tool-plugins/${encodeURIComponent(pluginId)}` : `/api/system/tool-plugins/${encodeURIComponent(pluginId)}`, {
    method: "DELETE", headers: remote ? {} : { "x-admin-confirm": "TRUSTED-LOCAL-PLUGIN" },
    body: JSON.stringify({ confirmImpact: true }),
  });
  toast(remote ? "远程连接已删除" : "工具已卸载，重启工作台后完成卸载");
  await loadSkillRegistry();
}

// 首次执行确认（开源清单 3.3）：展示域名与权限摘要，用户确认后该远程插件才允许真实调用。
async function confirmRemoteFirstRun(pluginId) {
  const tool = skillRegistryData?.tools.find((item) => item.plugin === pluginId && item.remote);
  const summary = tool
    ? `域名：${tool.endpointHost || "未声明"}\n风险等级：${tool.riskLevel}\n外部写入：${tool.permissions?.externalWrite ? "是（会向第三方发送内容）" : "否"}\n凭据：${(tool.permissions?.credentials || []).join("、") || "无"}\n超时：按插件声明（1–30 秒），响应上限 1–2 MB`
    : "";
  if (!await confirmAction(`确认允许远程插件「${pluginId}」首次执行？\n${summary}\n确认后，AI 任务调用该插件时会向上述域名发送请求。`, { confirmText: "确认允许" })) return;
  await request(`/api/system/remote-tool-plugins/${encodeURIComponent(pluginId)}/first-run-confirm`, { method: "POST", body: "{}" });
  toast("首次执行已确认，该插件现在可以被任务调用");
  await loadSkillRegistry();
}

async function updateToolPlugin(pluginId, changes, control) {
  const pluginView = skillRegistryData?.tools.find((tool) => tool.plugin === pluginId);
  if (pluginView?.thirdParty) {
    if (changes.enabled === false && !await confirmAction(`停用工具 ${pluginId} 后，依赖能力的新任务将被阻断。是否继续？`, { confirmText: "停用工具" })) {
      if (control?.matches("[type=checkbox]")) control.checked = true;
      return;
    }
    if (control) control.disabled = true;
    try {
      const endpoint = pluginView.remote ? `/api/system/remote-tool-plugins/${encodeURIComponent(pluginId)}/status` : `/api/system/tool-plugins/${encodeURIComponent(pluginId)}/status`;
      await request(endpoint, { method: "PATCH", headers: pluginView.remote ? {} : { "x-admin-confirm": "TRUSTED-LOCAL-PLUGIN" }, body: JSON.stringify({ status: changes.enabled === false ? "disabled" : "enabled" }) });
      toast(pluginView.remote ? "远程连接状态已即时生效" : "工具状态已保存，重启工作台后生效");
      await loadSkillRegistry();
    } finally {
      if (control) control.disabled = false;
    }
    return;
  }
  if (changes.enabled === false) {
    const confirmed = await confirmAction(`停用工具 ${pluginId} 后，依赖其能力的技能将无法启动。是否继续？`, { confirmText: "停用工具" });
    if (!confirmed) {
      if (control?.matches("[type=checkbox]")) control.checked = true;
      return;
    }
    changes.confirmDisable = true;
  }
  if (control) control.disabled = true;
  try {
    await request(`/api/system/tool-plugins/${encodeURIComponent(pluginId)}`, { method: "PATCH", body: JSON.stringify(changes) });
    toast(changes.enabled === false ? "工具已停用" : changes.enabled === true ? "工具已启用" : "工具优先级已更新");
    await loadSkillRegistry();
  } finally {
    if (control) control.disabled = false;
  }
}

async function testToolPlugin(pluginId, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "检查中…";
  try {
    const remote = skillRegistryData?.tools.some((tool) => tool.plugin === pluginId && tool.remote);
    const result = await request(remote ? `/api/system/remote-tool-plugins/${encodeURIComponent(pluginId)}/test` : `/api/system/tool-plugins/${encodeURIComponent(pluginId)}/test`, { method: "POST", body: "{}" });
    toast(result.pass ? `${pluginId} 依赖检查通过` : `${pluginId} 当前不可用`);
    await loadSkillRegistry();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function loadToolHistory(capability) {
  const result = await request(`/api/system/tool-executions?capability=${encodeURIComponent(capability)}&limit=50`);
  const panel = document.getElementById("tool-execution-panel");
  const list = document.getElementById("tool-execution-list");
  document.getElementById("tool-execution-title").textContent = `${capability} · 执行历史`;
  list.innerHTML = result.items.length ? result.items.map((item) => `<article class="runtime-model-item">
    <b>${escapeHtml(item.status)}${item.error_code ? ` · ${escapeHtml(item.error_code)}` : ""}</b>
    <small>${new Date(item.finished_at || item.started_at).toLocaleString("zh-CN")} · ${item.duration_ms} ms</small>
    <small>${escapeHtml(item.plugin || "未解析实现")} @ ${escapeHtml(item.plugin_version || "—")} · 技能 ${escapeHtml(item.skill_id || "未关联")}</small>
    <small>参数：${escapeHtml((item.input_keys || []).join("、") || "无")}</small>
  </article>`).join("") : '<div class="kv-empty">尚无执行记录。</div>';
  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

const SKILL_KIND_GROUPS = [
  { id: "writer", label: "主写作", hint: "文章正文生成" },
  { id: "storyboard", label: "故事板", hint: "图文逐页结构规划" },
  { id: "title", label: "标题", hint: "标题生成与筛选" },
  { id: "reviewer", label: "审阅", hint: "事实、逻辑与质量门禁" },
  { id: "humanizer", label: "自然化", hint: "表达与语气优化" },
  { id: "seo", label: "SEO", hint: "搜索可发现性优化" },
  { id: "image-planner", label: "配图规划", hint: "文章图片与占位规划" },
  { id: "typesetter", label: "排版", hint: "公众号成稿排版" },
  { id: "stage", label: "阶段技能", hint: "创作流程中的独立处理阶段" },
  { id: "legacy", label: "其他", hint: "旧版或未声明类型" },
];

function skillKindGroup(skill) {
  return SKILL_KIND_GROUPS.some((group) => group.id === skill.kind) ? skill.kind : "legacy";
}

function skillListItem(skill) {
  return `<button type="button" class="skill-list-item ${skill.id === selectedSkillId ? "active" : ""}" data-skill-edit="${escapeHtml(skill.id)}" aria-pressed="${skill.id === selectedSkillId}">
    <span class="skill-list-item-top"><b>${escapeHtml(skill.name || skill.id)}</b><em>${skill.manifestStatus === "invalid" ? "清单无效" : skill.kind || "stage"}</em></span>
    <small>${escapeHtml(skill.id)} · 包 v${escapeHtml(skill.packageVersion || "legacy")} · ${skill.fileCount} 文件</small>
    ${skill.description ? `<span>${escapeHtml(skill.description)}</span>` : ""}
    <code title="${escapeHtml(skill.promptHash)}">${escapeHtml(skill.promptHash.slice(0, 20))}…</code>
  </button>`;
}

function renderSkillList() {
  const list = document.getElementById("skill-registry-list");
  if (!list || !skillRegistryData) return;
  const query = String(document.getElementById("skill-search")?.value || "").trim().toLowerCase();
  const status = document.getElementById("skill-status-filter")?.value || "all";
  const skills = skillRegistryData.skills.filter((skill) => {
    const matchesStatus = status === "all" || (status === "configured" && skill.configured) || (status === "builtin" && !skill.thirdParty) || (status === "installed" && skill.thirdParty);
    const haystack = `${skill.name || ""} ${skill.id} ${skill.description || ""}`.toLowerCase();
    return matchesStatus && (!query || haystack.includes(query));
  });
  const count = document.getElementById("skill-filter-count");
  if (count) count.textContent = `${skills.length} / ${skillRegistryData.total}`;
  const grouped = new Map(SKILL_KIND_GROUPS.map((group) => [group.id, []]));
  for (const skill of skills) grouped.get(skillKindGroup(skill)).push(skill);
  list.innerHTML = skills.length ? SKILL_KIND_GROUPS.map((group) => {
    const items = grouped.get(group.id);
    if (!items.length) return "";
    return `<section class="skill-purpose-group" data-skill-kind="${group.id}">
      <header><span><b>${group.label}</b><small>${group.hint}</small></span><em>${items.length}</em></header>
      <div>${items.map(skillListItem).join("")}</div>
    </section>`;
  }).join("") : '<div class="skill-list-empty">没有匹配的技能。试试更短的关键词或切换状态筛选。</div>';
}

async function openSkillConfig(id) {
  const data = await request(`/api/system/skills/${encodeURIComponent(id)}`);
  const ownsRuntimePolicy = data.runtimePolicyOwner !== false;
  selectedSkillId = id;
  renderSkillList();
  document.getElementById("skill-detail-empty").hidden = true;
  document.getElementById("skill-config-editor").hidden = false;
  document.getElementById("skill-config-title").textContent = data.name || id;
  document.getElementById("skill-config-meta").textContent = `${id} · v${data.version} · ${data.fileCount} 个规则文件${data.configured ? " · 存在历史覆盖配置" : ""}`;
  const packageActions = document.getElementById("skill-package-actions");
  packageActions.hidden = !data.thirdParty;
  const entryLabels = { "hotspot-article": "热点文章", "independent-writing": "自主写作", "batch-daily": "批次早报", "social-tool": "工具图文", "social-custom": "自定义图文", "social-event": "事件图文", "wechat-typeset": "公众号排版" };
  const slotLabels = { writer: "主写作", storyboard: "故事板规划", title: "标题生成", reviewer: "审稿与门禁", humanizer: "表达自然化", seo: "SEO 优化" };
  const defaultActions = (data.defaultScopes || []).map((scope) => `<button class="${scope.isDefault ? "primary-button" : "outline-button"}" data-skill-default-entry="${escapeHtml(scope.entryPoint)}" data-skill-default-slot="${escapeHtml(scope.slot)}" data-skill-default-active="${scope.isDefault}" data-skill-id="${escapeHtml(id)}" ${data.status === "enabled" ? "" : "disabled"}>${scope.isDefault ? "✓ 已设默认" : "设为默认"} · ${escapeHtml(entryLabels[scope.entryPoint] || scope.entryPoint)} / ${escapeHtml(slotLabels[scope.slot] || scope.slot)}</button>`).join("");
  packageActions.innerHTML = data.thirdParty ? `<div class="skill-default-actions">${defaultActions || "<small>该技能没有可设置的创作入口。</small>"}</div><div class="skill-package-control"><button class="outline-button" data-skill-package-action="${data.status === "enabled" ? "disabled" : "enabled"}" data-skill-id="${escapeHtml(id)}">${data.status === "enabled" ? "停用" : "启用"}</button><button class="text-button" data-skill-package-action="uninstall" data-skill-id="${escapeHtml(id)}">卸载</button></div><small>默认技能按创作入口和阶段生效；单次手动选择仍具有更高优先级。</small>` : "";
  const policyNote = document.getElementById("skill-runtime-policy-note");
  policyNote.textContent = ownsRuntimePolicy ? "主技能：这里展示仓库内置契约；运行策略由程序和已发布历史配置共同决定。" : "子技能：这里展示阶段契约；模型、工具权限和质量门禁由调用它的主技能统一控制。";
  policyNote.classList.toggle("prompt-only", !ownsRuntimePolicy);
  document.getElementById("skill-source-path").textContent = data.sourcePath || "—";
  document.getElementById("skill-prompt-hash").textContent = data.promptHash || "—";
  const kindLabels = { writer: "主写作", storyboard: "故事板规划", reviewer: "审稿", title: "标题", humanizer: "表达优化", seo: "SEO", "image-planner": "配图规划", typesetter: "排版主技能", stage: "阶段子技能" };
  const capabilityState = (capability) => {
    const tool = skillRegistryData.tools.find((item) => item.capability === capability && item.enabled);
    return tool && tool.health?.status === "ok" && tool.health.data?.available !== false ? "可用" : "不可用";
  };
  const capabilityList = (items, type) => items.length ? items.map((capability) => `<span class="skill-capability-chip ${capabilityState(capability) === "可用" ? "ok" : "bad"}">${escapeHtml(capability)} · ${capabilityState(capability)} · ${type}</span>`).join("") : '<span class="muted">无</span>';
  document.getElementById("skill-contract-grid").innerHTML = `
    <article><b>角色</b><span>${escapeHtml(kindLabels[data.kind] || data.kind || "旧版")}</span></article>
    <article><b>技能包版本</b><span>${escapeHtml(data.packageVersion || "legacy")} · ${escapeHtml(data.manifestStatus || "missing")}</span></article>
    <article><b>适用入口</b><span>${(data.entryPoints || []).map((item) => escapeHtml(entryLabels[item] || item)).join("、") || "未声明"}</span></article>
    <article><b>内容类型</b><span>${(data.contentTypes || []).map((item) => escapeHtml(item)).join("、") || "未声明"}</span></article>
    <article><b>输入契约</b><code>${escapeHtml(data.inputContract || "未声明")}</code></article>
    <article><b>输出契约</b><code>${escapeHtml(data.outputContract || "未声明")}</code></article>
    <article class="wide"><b>必需工具</b><div>${capabilityList(data.requiredCapabilities || [], "必需")}</div></article>
    <article class="wide"><b>可选工具</b><div>${capabilityList(data.optionalCapabilities || [], "可选")}</div></article>
    <article><b>工作台兼容</b><code>${escapeHtml(data.compatibleApp || "未声明")}</code></article>
    <article><b>清单文件</b><code>${escapeHtml(data.manifestPath || "未提供")}</code></article>`;
  document.getElementById("skill-markdown-view").textContent = data.skillMarkdown || "未读取到 SKILL.md";
  document.getElementById("skill-file-list").innerHTML = (data.files || []).map((file, index) => `<article class="runtime-model-item">
    <b>${index === 0 ? "主契约" : "关联规则"}</b><code>${escapeHtml(file)}</code>
  </article>`).join("") || '<div class="kv-empty">没有关联规则文件。</div>';
}

export default async function loadSkillsView() {
  bindSkills();
  let capabilitySection = "skills";
  try { capabilitySection = sessionStorage.getItem("capability-section") || "skills"; } catch {}
  selectCapabilityTab(capabilitySection);
  await loadSkillRegistry();
}
