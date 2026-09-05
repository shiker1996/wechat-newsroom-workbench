import { readStyles } from "./style-fixture.mjs";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const skills=fs.readFileSync(new URL('../public/src/views/skills.js',import.meta.url),'utf8');
const main=fs.readFileSync(new URL('../public/src/main.js',import.meta.url),'utf8');
const routes=fs.readFileSync(new URL('../server/platform/http/routes/system-routes.mjs',import.meta.url),'utf8');
const styles=readStyles();

test('技能与工具页展示工具健康状态',()=>{
  assert.match(html,/id="tool-capability-list"/);
  assert.match(skills,/Boolean\(tool\.health\)/);
  assert.match(skills,/依赖正常/);
  assert.match(skills,/服务尚未返回健康检查结果/);
  assert.match(skills,/"待检查"/);
  assert.match(skills,/"待重启"/);
  assert.match(skills,/重启工作台后启用并加载此工具/);
});

test('内置技能详情直接只读展示 SKILL.md',()=>{
  assert.match(html,/BUILT-IN SKILL · READ ONLY/);
  assert.match(html,/id="skill-markdown-view"/);
  assert.match(html,/id="skill-source-path"/);
  assert.match(html,/id="skill-prompt-hash"/);
  assert.match(skills,/data\.skillMarkdown/);
  assert.match(skills,/data\.sourcePath/);
  assert.doesNotMatch(html,/id="skill-config-model"|id="skill-gate-suggestion"|id="skill-config-prompt"/);
  assert.match(routes,/readonly:true/);
  assert.match(routes,/skillMarkdown:sourceFile\?fs\.readFileSync/);
  assert.match(routes,/内置技能为只读，请通过代码仓库修改 SKILL\.md/);
});

test('技能详情展示关联规则文件且不提供发布恢复操作',()=>{
  assert.match(html,/id="skill-file-list"/);
  assert.match(skills,/index === 0 \? "主契约" : "关联规则"/);
  assert.doesNotMatch(html,/id="skill-publish"|id="skill-save-draft"|id="skill-dry-run"/);
  assert.doesNotMatch(skills,/submitSkillConfig|restoreSkillVersion|skillVersionChanges/);
});

test('技能详情展示结构化角色、入口、输入输出契约和工具需求',()=>{
  assert.match(html,/id="skill-contract-grid"/);
  assert.match(skills,/const kindLabels =/);
  assert.match(skills,/const entryLabels =/);
  assert.match(skills,/data\.requiredCapabilities/);
  assert.match(skills,/data\.optionalCapabilities/);
  assert.match(skills,/data\.inputContract/);
  assert.match(skills,/data\.outputContract/);
  assert.match(skills,/capabilityState/);
});

test('第三方技能可按创作入口和阶段设置默认',()=>{
  assert.match(skills,/data-skill-default-entry=/);
  assert.match(skills,/data-skill-default-slot=/);
  assert.match(skills,/async function setSkillDefault/);
  assert.match(skills,/skill-stage-defaults/);
  assert.match(skills,/单次手动选择仍具有更高优先级/);
  assert.match(routes,/setSkillStageDefault/);
  assert.match(routes,/defaultScopes/);
});

test('技能注册表支持搜索筛选与主从编辑',()=>{
  assert.match(html,/class="skill-management-layout"/);
  assert.match(html,/id="skill-search"/);
  assert.match(html,/class="skill-search-control"><span>⌕<\/span>/);
  assert.doesNotMatch(html,/<span>范围<\/span><select id="skill-status-filter"/);
  assert.match(html,/id="skill-status-filter"/);
  assert.match(html,/id="skill-detail-empty"/);
  assert.match(skills,/function renderSkillList\(/);
  assert.match(skills,/selectedSkillId = id;\s+renderSkillList\(\)/);
});

test('技能列表严格按 kind 分组且每个技能只出现一次',()=>{
  assert.match(skills,/const SKILL_KIND_GROUPS =/);
  for(const [kind,label] of [
    ["writer","主写作"],["storyboard","故事板"],["title","标题"],["reviewer","审阅"],
    ["humanizer","自然化"],["seo","SEO"],["image-planner","配图规划"],
    ["typesetter","排版"],["stage","阶段技能"],
  ])assert.match(skills,new RegExp(`\\{ id: "${kind}", label: "${label}"`));
  assert.match(skills,/function skillKindGroup\(skill\)/);
  assert.match(skills,/grouped\.get\(skillKindGroup\(skill\)\)\.push\(skill\)/);
  assert.doesNotMatch(skills,/function skillKindGroup\(skill\)\s*\{[^}]*entryPoints/s);
  assert.match(skills,/class="skill-purpose-group"/);
  assert.match(styles,/\.skill-purpose-group>header\{position:sticky;top:0;z-index:var\(--z-sticky\)/);
});

test('技能与工具作为独立一级页面而非运行配置标签',()=>{
  assert.match(html,/class="nav-utility" data-view="skills">[\s\S]*?<b>技能与工具<\/b>/);
  assert.match(html,/<section class="view skill-registry-view capability-studio" id="view-skills">/);
  assert.doesNotMatch(html,/data-config-tab="skills"/);
  assert.doesNotMatch(html,/id="config-panel-skills"/);
  assert.match(main,/skills: "\.\/views\/skills\.js"/);
  assert.match(main,/skills: "技能与工具"/);
  assert.match(skills,/export default async function loadSkillsView/);
  assert.doesNotMatch(fs.readFileSync(new URL('../public/src/views/system.js',import.meta.url),'utf8'),/loadSkillRegistry|openSkillConfig/);
});

test('技能详情区分主技能和阶段子技能并展示工具最近执行结果',()=>{
  assert.match(html,/id="skill-runtime-policy-note"/);
  assert.match(skills,/const ownsRuntimePolicy = data\.runtimePolicyOwner !== false/);
  assert.match(skills,/子技能：这里展示阶段契约/);
  assert.match(skills,/最近执行：/);
  assert.match(skills,/tool\.recentExecution/);
});

test('插件管理支持启停、优先级、依赖检查和执行历史',()=>{
  assert.match(skills,/data-tool-enabled=/);
  assert.match(skills,/function implementationDisableState/);
  assert.match(skills,/disableBlocked\?'disabled'/);
  assert.match(skills,/必需能力唯一实现/);
  assert.match(skills,/data-tool-priority=/);
  assert.match(skills,/data-tool-test=/);
  assert.match(skills,/data-tool-history=/);
  assert.match(skills,/async function updateToolPlugin/);
  assert.match(skills,/async function loadToolHistory/);
  assert.match(html,/id="tool-execution-panel"/);
  assert.match(skills,/placeRuntimeDetail\("tool-execution-panel","tool-capability-list"\)/);
  assert.match(skills,/placeExecutionHistory\("collector-runtime-list"\)/);
  assert.match(html,/仅记录参数名，不保存输入正文或密钥/);
});

test('远程工具入口明确要求 Manifest 而不是单独 URL',()=>{
  assert.match(html,/导入远程工具连接声明/);
  assert.match(html,/这里不能直接粘贴 API 或 MCP 地址/);
  assert.match(html,/MCP 还必须声明 toolName/);
  assert.match(html,/暂不支持[^<]*<\/b>从 URL 自动发现工具、读取远程技能、GET 路径模板 API/);
  assert.match(html,/placeholder='\{\s*"schemaVersion": 1,[\s\S]*"capabilities": \["cap_content_web_search"\][\s\S]*"compatibleApp": ">=0\.1\.0"\s*\}'/);
  assert.match(html,/保存远程工具/);
  assert.match(styles,/\.remote-manifest-notice/);
});

test('能力页签包含信息与采集能力，工具页签只保留信息工具运行操作',()=>{
  assert.match(html,/data-capability-tab="tools"[\s\S]*?<b>能力<\/b>/);
  assert.match(html,/data-capability-tab="collectors"[\s\S]*?<b>工具<\/b>/);
  const runtime=html.slice(html.indexOf('data-capability-section="collectors"'),html.indexOf('data-capability-section="extensions"'));
  assert.match(runtime,/id="tool-capability-list"/);
  assert.match(runtime,/id="collector-runtime-list"/);
  assert.doesNotMatch(runtime,/id="collector-plugin-list"/);
  const routing=html.slice(html.indexOf('data-capability-section="tools"'),html.indexOf('data-capability-section="skills"'));
  assert.match(routing,/id="information-slot-list"/);
  assert.doesNotMatch(routing,/id="collector-plugin-list"/);
  assert.doesNotMatch(routing,/id="tool-capability-list"/);
});

test('阶段 2 在能力配置和工具运行中可视化依赖链与影响范围',()=>{
  assert.match(html,/id="capability-graph-search"/);
  assert.match(html,/id="capability-impact-panel"/);
  assert.match(skills,/\/api\/system\/capability-graph/);
  assert.match(skills,/renderCapabilityGraph/);
  assert.match(skills,/openImplementationImpact/);
  assert.match(skills,/placeRuntimeDetail\('capability-impact-panel',afterElementId\|\|\(type==='collector'\?'collector-runtime-list':'tool-capability-list'\)\)/);
  assert.match(skills,/openImplementationImpact\(impact\.dataset\.consumerImpactType==="collector"\?"collector":"tool",impact\.dataset\.consumerImpact,"consumer-access-list"\)/);
  assert.match(styles,/\.collector-plugin-panel \.tool-execution-panel,\.collector-plugin-panel \.capability-impact-panel/);
  assert.match(skills,/data-tool-impact/);
  assert.match(skills,/data-collector-impact/);
  assert.match(styles,/\.capability-chain-card/);
  assert.doesNotMatch(styles,/\.capability-studio \.capability-section-tabs button\.active\{border-bottom-color/);
  assert.doesNotMatch(styles,/\.capability-studio \.information-slot-heading\{border-top/);
  assert.match(skills,/capability-route-control/);
  assert.match(skills,/tool-runtime-settings/);
  assert.match(skills,/tool-runtime-actions/);
  assert.match(styles,/\.capability-route-select select:focus-visible/);
  assert.match(styles,/\.tool-runtime-actions \.danger-action/);
});

test('消费者页默认聚焦 Agent，并提供搜索、类型与问题状态筛选',()=>{
  assert.match(html,/id="consumer-access-search"[^>]*aria-label="搜索消费者"/);
  assert.match(html,/data-consumer-type="agent"[^>]*aria-pressed="true"/);
  assert.match(html,/id="consumer-access-status"/);
  assert.match(skills,/let selectedConsumerType = "agent"/);
  assert.match(skills,/selectedConsumerType==='all'\|\|group\.key===selectedConsumerType/);
  assert.match(styles,/\.consumer-access-toolbar\{position:sticky/);
  assert.match(styles,/\.consumer-access-group\{display:grid;grid-template-columns:1fr/);
  assert.match(skills,/consumer\.type==='skill'\?'SKILL':consumer\.type==='collection-source'\?'SOURCE':'PIPELINE'/);
  // 采集源消费者分组与 tab（数量标签与列表同口径）
  assert.match(skills,/key:'source',label:'采集源消费者'/);
  assert.match(html,/data-consumer-type="source"[^>]*aria-pressed="false">采集源/);
});

test('阶段 3 停用前展示影响并携带影响版本执行',()=>{
  assert.match(skills,/confirmDisableImpact/);
  assert.match(skills,/impact\.canDisable/);
  assert.match(skills,/仅禁止新任务使用该工具/);
  assert.match(skills,/impactVersion/);
  assert.match(skills,/停用会造成必需能力断链/);
  assert.match(skills,/可停用，但部分能力将不可用/);
  assert.match(skills,/!item\.remainingImplementations\.length\?'将不可用'/);
});

test('阶段 5 执行历史展示候选尝试和兜底来源',()=>{assert.match(skills,/item\.attempt/);assert.match(skills,/item\.fallback_from/);assert.match(skills,/兜底/);});

test('技能与工具页面提供 Manifest 驱动的动态扩展配置表单',()=>{
  assert.match(skills,/renderExtensionConfigForm/);
  assert.match(skills,/data-tool-config/);
  assert.match(html,/skill-extension-config-form/);
  assert.match(html,/tool-extension-config-form/);
  assert.doesNotMatch(skills,/accessToken|secretKey/);
});
