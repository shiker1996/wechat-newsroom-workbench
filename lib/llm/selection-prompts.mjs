import { loadSkillBundle } from './skill-runtime.mjs';

// 选题阶段 prompt 统一入口：优先从项目技能目录加载（含配置覆盖与安全门禁），
// 技能缺失或被禁用时回退到代码内联原文，保证行为不变。
// workspaceRoot 缺省时与 lib/domain/account-context.mjs 一致用 process.cwd() 兜底。
export function selectionPrompt({ workspaceRoot, skillName, fallback }) {
  const bundle = loadSkillBundle({ workspaceRoot: workspaceRoot || process.cwd(), skillName });
  if (bundle.fallback) return { prompt: fallback, bundle };
  return { prompt: bundle.prompt, bundle };
}
