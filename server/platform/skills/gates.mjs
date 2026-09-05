import { AgentContractError } from '../agent/tool-protocol.mjs';

const BUILTIN_GATES = Object.freeze({
  'assistant-reply': Object.freeze({ version: '1', phase: 'output', check: ({ result }) => Boolean(String(result?.assistantReply || '').trim()) }),
});

export function resolveSkillGates(names = [], handlers = {}, frozenBindings = null) {
  const registry = { ...BUILTIN_GATES, ...handlers };
  const gates = names.map((name) => {
    const gate = registry[name];
    if (!gate || typeof gate.check !== 'function' || !gate.version || !['input', 'output'].includes(gate.phase)) {
      throw new AgentContractError('SKILL_GATE_UNAVAILABLE', `门禁未注册或定义无效：${name}`);
    }
    return { name, version: String(gate.version), phase: gate.phase, check: gate.check };
  });
  const bindings = gates.map(({ name, version, phase }) => ({ name, version, phase }));
  if (frozenBindings && JSON.stringify(bindings) !== JSON.stringify(frozenBindings)) {
    throw new AgentContractError('SKILL_SNAPSHOT_MISMATCH', '历史门禁版本不可用');
  }
  return {
    bindings,
    async run(phase, payload) {
      for (const gate of gates.filter((item) => item.phase === phase)) {
        const outcome = await gate.check(payload);
        if (outcome !== true && outcome?.ok !== true) throw new AgentContractError('SKILL_GATE_FAILED', outcome?.message || `技能门禁未通过：${gate.name}`);
      }
    },
  };
}
