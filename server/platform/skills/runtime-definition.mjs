export const SKILL_RUN_KINDS = Object.freeze(['prompt-skill', 'stage-skill', 'agent-skill']);

// Domain roles (writer/reviewer/...) and execution kinds are separate: the same
// writing skill can support a planning conversation and a deterministic stage.
export function normalizeSkillDefinition(manifest = {}, { id = manifest.id, kind = manifest.runtimeKind || 'stage-skill' } = {}) {
  if (!id || !SKILL_RUN_KINDS.includes(kind)) throw new TypeError('技能 ID 或运行类型无效');
  return Object.freeze({
    id, kind, role: manifest.kind || 'stage', version: manifest.version || 'legacy',
    entryPoints: [...(kind === 'agent-skill' ? manifest.agentEntryPoints || manifest.entryPoints || [] : manifest.entryPoints || [])],
    inputContract: manifest.inputContract || 'skill_input', outputContract: manifest.outputContract || 'skill_output',
    requiredCapabilities: [...(manifest.requiredCapabilities || [])], optionalCapabilities: [...(manifest.optionalCapabilities || [])],
    budget: { ...manifest.budget }, gates: [...(kind === 'agent-skill' ? manifest.agentGates || manifest.gates || [] : manifest.gates || [])],
  });
}
