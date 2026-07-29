import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const system=fs.readFileSync(new URL('../public/src/views/system.js',import.meta.url),'utf8');
const main=fs.readFileSync(new URL('../public/src/main.js',import.meta.url),'utf8');
const routes=fs.readFileSync(new URL('../lib/http/routes/system-routes.mjs',import.meta.url),'utf8');

test('技能与插件页展示工具健康状态',()=>{
  assert.match(html,/id="tool-capability-list"/);
  assert.match(system,/checked=Boolean\(tool\.health\)/);
  assert.match(system,/依赖正常/);
  assert.match(system,/服务尚未返回健康检查结果，请重启工作台服务后刷新/);
  assert.match(system,/"待检查"/);
});

test('内置技能详情直接只读展示 SKILL.md',()=>{
  assert.match(html,/BUILT-IN SKILL · READ ONLY/);
  assert.match(html,/id="skill-markdown-view"/);
  assert.match(html,/id="skill-source-path"/);
  assert.match(html,/id="skill-prompt-hash"/);
  assert.match(system,/data\.skillMarkdown/);
  assert.match(system,/data\.sourcePath/);
  assert.doesNotMatch(html,/id="skill-config-model"|id="skill-gate-suggestion"|id="skill-config-prompt"/);
  assert.match(routes,/readonly:true/);
  assert.match(routes,/skillMarkdown:sourceFile\?fs\.readFileSync/);
  assert.match(routes,/内置技能为只读，请通过代码仓库修改 SKILL\.md/);
});

test('技能详情展示关联规则文件且不提供发布恢复操作',()=>{
  assert.match(html,/id="skill-file-list"/);
  assert.match(system,/index===0\?"主契约":"关联规则"/);
  assert.doesNotMatch(html,/id="skill-publish"|id="skill-save-draft"|id="skill-dry-run"/);
  assert.doesNotMatch(system,/submitSkillConfig|restoreSkillVersion|skillVersionChanges/);
});

test('技能详情展示结构化角色、入口、输入输出契约和工具需求',()=>{
  assert.match(html,/id="skill-contract-grid"/);
  assert.match(system,/const kindLabels=/);
  assert.match(system,/const entryLabels=/);
  assert.match(system,/data\.requiredCapabilities/);
  assert.match(system,/data\.optionalCapabilities/);
  assert.match(system,/data\.inputContract/);
  assert.match(system,/data\.outputContract/);
  assert.match(system,/capabilityState/);
});

test('技能注册表支持搜索筛选与主从编辑',()=>{
  assert.match(html,/class="skill-management-layout"/);
  assert.match(html,/id="skill-search"/);
  assert.match(html,/id="skill-status-filter"/);
  assert.match(html,/id="skill-detail-empty"/);
  assert.match(system,/function renderSkillList\(/);
  assert.match(system,/selectedSkillId=id;renderSkillList\(\)/);
});

test('技能与插件作为独立一级页面而非运行配置标签',()=>{
  assert.match(html,/class="nav-item" data-view="skills">技能与插件<\/button>/);
  assert.match(html,/<section class="view skill-registry-view" id="view-skills">/);
  assert.doesNotMatch(html,/data-config-tab="skills"/);
  assert.doesNotMatch(html,/id="config-panel-skills"/);
  assert.match(main,/skills: "\.\/views\/system\.js"/);
  assert.match(main,/skills: "技能与插件"/);
  assert.match(system,/if\(view==="skills"\)\{[\s\S]*?await loadSkillRegistry\(\)/);
});

test('技能详情区分主技能和阶段子技能并展示工具最近执行结果',()=>{
  assert.match(html,/id="skill-runtime-policy-note"/);
  assert.match(system,/const ownsRuntimePolicy=data\.runtimePolicyOwner!==false/);
  assert.match(system,/子技能：这里展示阶段契约/);
  assert.match(system,/最近执行：/);
  assert.match(system,/tool\.recentExecution/);
});

test('插件管理支持启停、优先级、依赖检查和执行历史',()=>{
  assert.match(system,/data-tool-enabled=/);
  assert.match(system,/data-tool-priority=/);
  assert.match(system,/data-tool-test=/);
  assert.match(system,/data-tool-history=/);
  assert.match(system,/async function updateToolPlugin/);
  assert.match(system,/async function loadToolHistory/);
  assert.match(html,/id="tool-execution-panel"/);
  assert.match(html,/仅记录参数名，不保存输入正文或密钥/);
});
