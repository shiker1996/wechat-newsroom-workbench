import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDITORIAL_AGENT_CAPABILITIES } from '../lib/agent/editorial-adapter.mjs';
import { TUTORIAL_AGENT_CAPABILITIES } from '../lib/agent/tutorial-adapter.mjs';
import { CUSTOM_SOCIAL_AGENT_CAPABILITIES } from '../lib/agent/custom-social-adapter.mjs';
import { CONVERSATION_AGENT_ENTRY_POINTS } from '../lib/agent/contracts.mjs';
import { getToolRegistry } from '../lib/tools/index.mjs';
import { buildCapabilityGraph } from '../lib/tools/capability-graph.mjs';
import { readCapabilityCatalog } from '../lib/tools/capability-catalog.mjs';
import { readActiveSkillConfig } from '../lib/skills/configuration.mjs';

// 阶段 0 基线：扫描三个 Agent Adapter 的能力常量、资源适配分支与运行时可用的工具实现，
// 生成"消费者—能力—实现"只读基线。不修改任何运行时行为。
// 适配现状（resolveArguments 是否有专用分支、资源类型、触发策略、授权动作）来自对
// 三个 Adapter 源码的人工核查，以静态表记录；代码变更后需同步更新并重新生成基线。

const SEARCH_ADAPTATION = Object.freeze({
  branch: true,
  resourceKinds: [],
  triggerPolicy: 'model-request',
  authorizationAction: null,
  resultPolicy: 'query-clamped-passthrough',
  note: 'resolveArguments 仅做 query 清洗与长度截断',
});

const CONSUMERS = Object.freeze([
  {
    consumerId: 'agent.editorial',
    name: '编辑室 Agent',
    entryPoint: 'editorial',
    adapterModule: 'lib/agent/editorial-adapter.mjs',
    capabilityConstant: 'EDITORIAL_AGENT_CAPABILITIES',
    declaredCapabilities: EDITORIAL_AGENT_CAPABILITIES,
    runtimeSkillIds: ['editorial-room-chat'],
    adaptation: {
      'filesystem.project.read': {
        branch: true, resourceKinds: ['local-project'], triggerPolicy: 'deterministic-first-step',
        authorizationAction: 'local-project-read', resultPolicy: 'sanitized-project-summary',
        note: '用户提供 projectPath 时 step 0 确定性发起；结果裁剪为 summary/files 摘要；projectPath 缺失时报错拦截',
      },
      'content.url.fetch': {
        branch: true, resourceKinds: ['event-source', 'supplied-url'], triggerPolicy: 'explicit-resource',
        authorizationAction: null, resultPolicy: 'passthrough',
        note: 'resourceId 必须命中当前事件来源或用户提供的 URL，否则 RESOURCE_NOT_ALLOWED',
      },
      'content.passage.retrieve': {
        branch: true, resourceKinds: ['source-content'], triggerPolicy: 'explicit-resource',
        authorizationAction: null, resultPolicy: 'passthrough',
        note: 'resourceIds 必须命中已抓取来源正文；query 清洗截断、k 限制在 1-8',
      },
      'content.web.search': SEARCH_ADAPTATION,
      'content.news.search': SEARCH_ADAPTATION,
    },
    gaps: [],
  },
  {
    consumerId: 'agent.independent-writing',
    name: '自主写作 Agent',
    entryPoint: 'independent-writing',
    adapterModule: 'lib/agent/tutorial-adapter.mjs',
    capabilityConstant: 'TUTORIAL_AGENT_CAPABILITIES',
    declaredCapabilities: TUTORIAL_AGENT_CAPABILITIES,
    runtimeSkillIds: ['wechat-mp-tutorial', 'wechat-mp-personal-writing'],
    adaptation: {
      'filesystem.project.read': {
        branch: true, resourceKinds: ['local-project'], triggerPolicy: 'deterministic-first-step',
        authorizationAction: 'local-project-read', resultPolicy: 'sanitized-project-summary+fact-attachment',
        note: 'step 0 确定性发起；结果按 pathKey 存入事实附件缓存，二次会话直接复用',
      },
      'content.url.fetch': {
        branch: true, resourceKinds: ['material-url'], triggerPolicy: 'explicit-resource',
        authorizationAction: null, resultPolicy: 'fact-attachment',
        note: 'resourceId 必须命中素材 URL 目录（草稿 materialUrls 或回答中的 URL，上限 5 条）',
      },
      'content.document.search': {
        branch: true, resourceKinds: ['document-root'], triggerPolicy: 'explicit-resource',
        authorizationAction: 'document-root-read', resultPolicy: 'fact-attachment',
        note: 'resourceId 必须命中已授权 documentRoots；query 截断 300、maxResults 固定 5',
      },
      'content.web.search': SEARCH_ADAPTATION,
      'content.news.search': SEARCH_ADAPTATION,
      'content.passage.retrieve': {
        branch: true, resourceKinds: [], triggerPolicy: 'model-request',
        authorizationAction: null, resultPolicy: 'fact-attachment',
        note: '阶段 5 起由通用层适配：resourceIds 非空时严格映射资源目录（缺正文则 RESOURCE_NOT_ALLOWED），否则按插件原生 documents 入参透传',
      },
    },
    gaps: [],
  },
  {
    consumerId: 'agent.custom-social',
    name: '自定义图文 Agent',
    entryPoint: 'custom-social',
    adapterModule: 'lib/agent/custom-social-adapter.mjs',
    capabilityConstant: 'CUSTOM_SOCIAL_AGENT_CAPABILITIES',
    declaredCapabilities: CUSTOM_SOCIAL_AGENT_CAPABILITIES,
    runtimeSkillIds: ['custom-card-storyboard'],
    adaptation: {
      'filesystem.project.read': {
        branch: true, resourceKinds: ['local-project'], triggerPolicy: 'explicit-resource',
        authorizationAction: 'local-project-read', resultPolicy: 'sanitized-project-summary+fact-attachment',
        note: '扩展方案阶段 A 接入：用户提供 projectPath 才注册资源（无确定性首步）；结果裁剪为摘要并计入 externalSources 之外的事实附件',
      },
      'content.url.fetch': {
        branch: true, resourceKinds: ['material-url'], triggerPolicy: 'explicit-resource',
        authorizationAction: null, resultPolicy: 'fact-attachment+source-url-tracking',
        note: 'resourceId 必须命中素材 URL 目录（上限 8 条）；结果中的公开 URL 回收进 externalSources',
      },
      'content.repository.inspect': {
        branch: true, resourceKinds: ['github-repository-url'], triggerPolicy: 'explicit-resource',
        authorizationAction: null, resultPolicy: 'fact-attachment+source-url-tracking',
        note: 'resourceId 必须是已授权素材中的 github.com URL，否则 RESOURCE_NOT_ALLOWED',
      },
      'content.document.search': {
        branch: true, resourceKinds: ['document-root'], triggerPolicy: 'explicit-resource',
        authorizationAction: 'document-root-read', resultPolicy: 'fact-attachment+source-url-tracking',
        note: 'resourceId 必须命中已授权 documentRoots；query 截断 300、maxResults 固定 5',
      },
      'content.web.search': SEARCH_ADAPTATION,
      'content.news.search': SEARCH_ADAPTATION,
      'content.passage.retrieve': {
        branch: true, resourceKinds: [], triggerPolicy: 'model-request',
        authorizationAction: null, resultPolicy: 'fact-attachment+source-url-tracking',
        note: '阶段 5 起由通用层适配：resourceIds 非空时严格映射资源目录（缺正文则 RESOURCE_NOT_ALLOWED），否则按插件原生 documents 入参透传',
      },
    },
    gaps: [],
  },
]);

function readRoutes(root) {
  const file = path.join(root, 'data', 'capability-routes.json');
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return parsed.routes || {};
}

export async function buildConsumerCapabilityBaseline(root) {
  const catalog = readCapabilityCatalog(root);
  const registry = await getToolRegistry();
  const listed = registry.listCapabilities({ includeDisabled: true });
  const routes = readRoutes(root);

  const graph = buildCapabilityGraph({
    root,
    tools: listed.map((item) => ({
      id: item.plugin, name: item.plugin, version: item.version,
      capabilities: [item.capability], enabled: item.enabled,
      priority: item.priority, riskLevel: item.riskLevel,
    })),
    routes,
  });
  const graphByCapability = new Map(graph.capabilities.map((item) => [item.id, item]));

  const implementationsFor = (capability) => listed
    .filter((item) => item.capability === capability)
    .map(({ plugin, version, enabled, priority, riskLevel }) => ({ plugin, version, enabled, priority, riskLevel }))
    .sort((left, right) => left.plugin.localeCompare(right.plugin));

  const consumers = CONSUMERS.map((consumer) => ({
    consumerId: consumer.consumerId,
    name: consumer.name,
    type: 'agent',
    entryPoint: consumer.entryPoint,
    entryPointRegistered: CONVERSATION_AGENT_ENTRY_POINTS.includes(consumer.entryPoint),
    adapterModule: consumer.adapterModule,
    capabilityConstant: consumer.capabilityConstant,
    runtimeSkillIds: consumer.runtimeSkillIds,
    skillAuthorization: Object.fromEntries(consumer.runtimeSkillIds.map((skillId) => {
      const active = readActiveSkillConfig(root, skillId);
      return [skillId, active?.allowedTools?.length ? [...active.allowedTools] : null];
    })),
    declaredCapabilities: [...consumer.declaredCapabilities],
    capabilities: consumer.declaredCapabilities.map((capability) => {
      const adaptation = consumer.adaptation[capability] || { branch: false, resourceKinds: [], triggerPolicy: 'model-request', authorizationAction: null, resultPolicy: 'unknown', note: '未记录适配信息' };
      const graphNode = graphByCapability.get(capability);
      return {
        capability,
        registered: Boolean(catalog.capabilities[capability]),
        declared: true,
        adapterStatus: adaptation.branch ? 'ready' : 'degraded',
        resourceKinds: adaptation.resourceKinds,
        triggerPolicy: adaptation.triggerPolicy,
        authorizationAction: adaptation.authorizationAction,
        resultPolicy: adaptation.resultPolicy,
        adaptationNote: adaptation.note,
        preferredImplementationId: routes[capability]?.preferredImplementationId || '',
        implementations: implementationsFor(capability),
        graphStatus: graphNode?.status || 'unknown',
        graphConsumers: (graphNode?.consumers || []).map((item) => item.consumerId).sort(),
      };
    }),
    gaps: consumer.gaps,
  }));

  return {
    schemaVersion: 1,
    source: 'docs/design/consumer-capability-adaptation-design.md 阶段 0：冻结基线',
    generatedBy: 'scripts/snapshot-consumer-capability-baseline.mjs',
    routes,
    consumers,
    graphComparison: {
      agentConsumersRegistered: graph.consumers.some((item) => item.type === 'agent'),
      note: 'capability-graph 的消费者维度聚合技能、功能消费者、采集来源与 agent 消费者（阶段 1 起，'
        + '来自 config/capability-consumers.json 的 type:\'agent\' 登记）；graphConsumers 为引用同一能力的全部消费者。',
    },
  };
}

if (import.meta.main) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const baseline = await buildConsumerCapabilityBaseline(root);
  const output = path.join(root, 'data', 'capability-consumer-baseline.json');
  fs.writeFileSync(output, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(`已写入 ${path.relative(root, output)}：${baseline.consumers.length} 个 Agent 消费者、`
    + `${baseline.consumers.reduce((sum, item) => sum + item.capabilities.length, 0)} 条消费者—能力关系`);
}
