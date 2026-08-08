import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const skills=fs.readFileSync(new URL('../public/src/views/skills.js',import.meta.url),'utf8');
const main=fs.readFileSync(new URL('../public/src/main.js',import.meta.url),'utf8');
const routes=fs.readFileSync(new URL('../lib/http/routes/system-routes.mjs',import.meta.url),'utf8');
const styles=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');

test('技能与工具页展示工具健康状态',()=>{
  assert.match(html,/id="tool-capability-list"/);
  assert.match(skills,/Boolean\(tool\.health\)/);
  assert.match(skills,/依赖正常/);
  assert.match(skills,/服务尚未返回健康检查结果，请重启工作台服务后刷新/);
  assert.match(skills,/"待检查"/);
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
  assert.match(html,/<section class="view skill-registry-view" id="view-skills">/);
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
  assert.match(skills,/data-tool-priority=/);
  assert.match(skills,/data-tool-test=/);
  assert.match(skills,/data-tool-history=/);
  assert.match(skills,/async function updateToolPlugin/);
  assert.match(skills,/async function loadToolHistory/);
  assert.match(html,/id="tool-execution-panel"/);
  assert.match(html,/仅记录参数名，不保存输入正文或密钥/);
});

test('远程工具入口明确要求 Manifest 而不是单独 URL',()=>{
  assert.match(html,/导入远程工具连接声明/);
  assert.match(html,/这里不能直接粘贴 API 或 MCP 地址/);
  assert.match(html,/MCP 还必须声明 toolName/);
  assert.match(html,/暂不支持[^<]*<\/b>从 URL 自动发现工具、读取远程技能、GET 路径模板 API/);
  assert.match(html,/placeholder='\{\s*"schemaVersion": 1,[\s\S]*"capabilities": \["content\.web\.search"\][\s\S]*"compatibleApp": ">=0\.1\.0"\s*\}'/);
  assert.match(html,/保存远程工具/);
  assert.match(styles,/\.remote-manifest-notice/);
});
