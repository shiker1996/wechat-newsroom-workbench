import { loadSkillBundle } from '../llm/skill-runtime.mjs';
import { normalizeSkillDefinition } from './runtime-definition.mjs';

export function resolveSkillRuntime({ workspaceRoot, skillId, kind, bundle = null }) {
  const resolved = bundle || loadSkillBundle({ workspaceRoot, skillName: skillId });
  if (resolved.fallback || resolved.manifestStatus === 'invalid') throw new Error(`技能不可用：${skillId}`);
  return { bundle: resolved, definition: normalizeSkillDefinition(resolved.manifest || {}, { id: skillId, kind }) };
}

export function resolveSkillDefinition(options) { return resolveSkillRuntime(options).definition; }
