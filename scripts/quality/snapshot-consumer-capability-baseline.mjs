import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDITORIAL_AGENT_CAPABILITIES } from '../../server/features/articles/application/agent/editorial-adapter.mjs';
import { TUTORIAL_AGENT_CAPABILITIES } from '../../server/features/articles/application/agent/tutorial-adapter.mjs';
import { CUSTOM_SOCIAL_AGENT_CAPABILITIES } from '../../server/features/social-cards/application/agent/custom-social-adapter.mjs';
import { CONVERSATION_AGENT_ENTRY_POINTS } from '../../server/platform/agent/contracts.mjs';
import { getToolRegistry } from '../../server/platform/tools/index.mjs';
import { buildCapabilityGraph } from '../../server/platform/tools/capability-graph.mjs';
import { readCapabilityCatalog } from '../../server/platform/tools/capability-catalog.mjs';
import { readActiveSkillConfig } from '../../server/platform/skills/configuration.mjs';

// 阶段 0 基线：扫描三个 Agent Adapter 的能力常量、资源适配分支与运行时可用的工具实现，
// 生成"消费者—能力—实现"只读基线。不修改任何运行时行为。
// 适配现状（adapterStatus、资源类型、触发策略、授权动作、结果策略）自 2026-08-15 起
// 从权威登记 config/capability-consumers.json 各 Agent 消费者的 dependencies 派生
// （与 server/platform/agent/entry-capabilities.mjs 一样直读 JSON，避免依赖闭环）；
// gaps 不再手工维护：声明的能力未登记或登记非 ready 时由比较自动产生。

const CONSUMERS = Object.freeze([
  {
    consumerId: 'agent.editorial',
    name: '编辑室 Agent',
    entryPoint: 'editorial',
    adapterModule: 'server/features/articles/application/agent/editorial-adapter.mjs',
    capabilityConstant: 'EDITORIAL_AGENT_CAPABILITIES',
    declaredCapabilities: EDITORIAL_AGENT_CAPABILITIES,
    runtimeSkillIds: ['editorial-room-chat'],
  },
  {
    consumerId: 'agent.independent-writing',
    name: '自主写作 Agent',
    entryPoint: 'independent-writing',
    adapterModule: 'server/features/articles/application/agent/tutorial-adapter.mjs',
    capabilityConstant: 'TUTORIAL_AGENT_CAPABILITIES',
    declaredCapabilities: TUTORIAL_AGENT_CAPABILITIES,
    runtimeSkillIds: ['wechat-mp-tutorial', 'wechat-mp-personal-writing'],
  },
  {
    consumerId: 'agent.custom-social',
    name: '自定义图文 Agent',
    entryPoint: 'custom-social',
    adapterModule: 'server/features/social-cards/application/agent/custom-social-adapter.mjs',
    capabilityConstant: 'CUSTOM_SOCIAL_AGENT_CAPABILITIES',
    declaredCapabilities: CUSTOM_SOCIAL_AGENT_CAPABILITIES,
    runtimeSkillIds: ['custom-card-storyboard'],
  },
]);

function readAgentRegistrations(root) {
  const file = path.join(root, 'config', 'capability-consumers.json');
  if (!fs.existsSync(file)) return new Map();
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return new Map((parsed.consumers || [])
    .filter((item) => item.type === 'agent')
    .map((item) => [item.id, new Map((item.dependencies || []).map((dep) => [dep.capability, dep]))]));
}

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
  const registrations = readAgentRegistrations(root);

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

  const consumers = CONSUMERS.map((consumer) => {
    const registration = registrations.get(consumer.consumerId);
    if (!registration) throw new Error(`agent 消费者未登记：${consumer.consumerId}`);
    return {
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
        const dependency = registration.get(capability);
        const graphNode = graphByCapability.get(capability);
        return {
          capability,
          registered: Boolean(catalog.capabilities[capability]),
          declared: true,
          adapterStatus: dependency?.adapterStatus || 'missing',
          resourceKinds: dependency?.resourceKinds || [],
          triggerPolicy: dependency?.triggerPolicy || 'model-request',
          authorizationAction: dependency?.authorizationAction ?? null,
          resultPolicy: dependency?.resultPolicy || 'unknown',
          preferredImplementationId: routes[capability]?.preferredImplementationId || '',
          implementations: implementationsFor(capability),
          graphStatus: graphNode?.status || 'unknown',
          graphConsumers: (graphNode?.consumers || []).map((item) => item.consumerId).sort(),
        };
      }),
      gaps: consumer.declaredCapabilities
        .filter((capability) => !registration.has(capability))
        .map((capability) => ({ capability, reason: '声明的能力未在 config/capability-consumers.json 登记适配' })),
    };
  });

  return {
    schemaVersion: 1,
    source: 'docs/design/consumer-capability-adaptation-design.md 阶段 0：冻结基线',
    generatedBy: 'scripts/quality/snapshot-consumer-capability-baseline.mjs',
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
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const baseline = await buildConsumerCapabilityBaseline(root);
  const output = path.join(root, 'test', 'fixtures', 'capability-consumer-baseline.json');
  fs.writeFileSync(output, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(`已写入 ${path.relative(root, output)}：${baseline.consumers.length} 个 Agent 消费者、`
    + `${baseline.consumers.reduce((sum, item) => sum + item.capabilities.length, 0)} 条消费者—能力关系`);
}
