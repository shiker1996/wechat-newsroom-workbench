const PROFILES = [
  [/tagging|event-card/i, { adaptive: false }],
  [/article-planning/i, { initial: 6000, retry: 10000 }],
  [/article-fact-base|article-title-generation/i, { initial: 5000, retry: 8000 }],
  [/quality-gate/i, { initial: 3500, retry: 6000 }],
  [/article-image-plan/i, { initial: 3000, retry: 5000 }],
  [/article-visual-plan/i, { initial: 5000, retry: 8000 }],
  [/typeset-design|magazine-design/i, { initial: 3200, retry: 5000 }],
  [/typeset-html/i, { initial: 8000, retry: 12000 }],
  [/daily/i, { initial: 6000, retry: 10000 }],
  [/tutorial/i, { initial: 7000, retry: 11000 }],
  [/article-|breaking-analysis/i, { initial: 8000, retry: 12000 }],
  [/research-brainstorm|hotspot-brainstorm/i, { initial: 6500, retry: 10000 }],
  [/research-synthesis|hotspot-synthesis/i, { initial: 5000, retry: 8000 }],
  [/social-card-layout-repair/i, { initial: 8000, retry: 12000 }],
  [/social-card-content-planner/i, { initial: 6000, retry: 9000 }],
  [/social-card-copy/i, { initial: 3000, retry: 5000 }],
  [/editorial-room|custom-social-chat/i, { initial: 3500, retry: 6000 }],
];

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

export function outputBudgetFor({ purpose = '', providerMax, requested, adaptive = true } = {}) {
  const ceiling = positive(providerMax, 8192);
  const profile = PROFILES.find(([pattern]) => pattern.test(String(purpose)))?.[1];
  const hasExplicitCap = Number.isFinite(Number(requested)) && Number(requested) > 0;
  const explicitlyFixed = adaptive === false || profile?.adaptive === false || hasExplicitCap;
  const initial = Math.min(
    ceiling,
    explicitlyFixed
      ? positive(requested, positive(profile?.initial, ceiling))
      : positive(profile?.initial, positive(requested, Math.min(4000, ceiling))),
  );
  const retry = explicitlyFixed
    ? initial
    : Math.min(ceiling, Math.max(initial, positive(profile?.retry, Math.ceil(initial * 1.6))));
  return { initial, retry, adaptive: !explicitlyFixed && retry > initial, providerMax: ceiling };
}

export const TRUNCATION_RETRY_SYSTEM_PROMPT =
  '上一次输出因长度达到上限而被截断。请重新完整输出；压缩解释和重复内容，确保所有结构闭合。若要求 JSON，只返回合法且完整的 JSON，不要使用 Markdown 围栏。';
