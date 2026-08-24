import { loadSkillBundle } from '../../../platform/llm/skill-runtime.mjs';

// 研究/选题阶段 prompt 的唯一入口：优先从项目技能目录加载，缺失时按调用方策略回退。
export function selectionPrompt({ workspaceRoot, skillName, fallback }) {
  const bundle = loadSkillBundle({ workspaceRoot: workspaceRoot || process.cwd(), skillName });
  if (bundle.fallback) {
    if (fallback === undefined) throw new Error(`技能缺失或被禁用：skills/${skillName}/SKILL.md 无法加载`);
    return { prompt: fallback, bundle };
  }
  return { prompt: bundle.prompt, bundle };
}
