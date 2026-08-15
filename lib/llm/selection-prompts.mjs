import { loadSkillBundle } from './skill-runtime.mjs';

// 选题阶段 prompt 统一入口：优先从项目技能目录加载（含配置覆盖与安全门禁）。
// 传入 fallback 时技能缺失回退内联原文；未传 fallback（对话 agent）则技能即唯一事实源，缺失直接报错。
// workspaceRoot 缺省时与 lib/domain/account-context.mjs 一致用 process.cwd() 兜底。
export function selectionPrompt({ workspaceRoot, skillName, fallback }) {
  const bundle = loadSkillBundle({ workspaceRoot: workspaceRoot || process.cwd(), skillName });
  if (bundle.fallback) {
    if (fallback === undefined) throw new Error(`技能缺失或被禁用：skills/${skillName}/SKILL.md 无法加载`);
    return { prompt: fallback, bundle };
  }
  return { prompt: bundle.prompt, bundle };
}
